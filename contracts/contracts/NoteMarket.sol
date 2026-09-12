// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IAtsNote} from "./interfaces/IAtsNote.sol";

/// @title NoteMarket
/// @notice A secondary market for Displacement Bond Notes: a holder offers a
/// lot of note units at a price in the settlement asset, and anyone the note
/// will accept as a holder can take it.
///
/// The design decision worth stating is that this contract **custodies
/// nothing**. It never holds a note unit and it never holds a settlement
/// token. An offer is a standing instruction backed by an allowance the seller
/// granted on the note, and a fill is one transaction that moves both legs:
///
///     1. note.transferFrom(seller, buyer, units)
///     2. settlementToken.transferFrom(buyer, seller, price)
///
/// Both legs are in the same call, so either both happen or neither does and
/// there is no state in which one side has been paid and the other has not.
/// An escrow would have been the other way to get that, and it was rejected
/// for two reasons. A note is an ERC-3643 style security whose transfers are
/// refused unless both parties hold KYC on that note, so an escrow would have
/// had to be granted KYC itself and would then sit in the holder register as a
/// noteholder that is not an investor. And an escrow holding the settlement
/// asset, which is an HTS token, would have to associate it and would become
/// one more place money can be stranded. Allowances plus one atomic call have
/// neither problem.
///
/// **The compliance gate is the note's, not this contract's.** The note leg is
/// deliberately first. If the buyer holds no KYC on that note, `transferFrom`
/// reverts inside the ATS bond with its own error and the whole fill reverts
/// with it, before any money has moved. This contract does not re-implement,
/// wrap or soften that check, and it has no allow list of its own: what the
/// note refuses, the market refuses.
///
/// The venue takes no fee. Nothing is skimmed off either leg, and there is no
/// treasury address here to skim it to.
contract NoteMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum OfferStatus {
        None,
        Open,
        Filled,
        Cancelled
    }

    struct Offer {
        /// @dev The ATS note being sold.
        address note;
        address seller;
        /// @dev The account that filled it, zero while the offer is open.
        address buyer;
        /// @dev Note units in the note's own decimals.
        uint256 units;
        /// @dev What the whole lot costs, in settlement asset minor units.
        uint256 price;
        uint64 openedAt;
        /// @dev When it was filled or cancelled, zero while it is open.
        uint64 closedAt;
        OfferStatus status;
    }

    /// @notice The settlement asset every offer is priced in. One asset per
    /// market, for the same reason the vault holds one: two would mean a
    /// price on screen that does not say what it is in.
    IERC20 public immutable settlementToken;

    /// @dev Offer ids are one based, so zero is never a real offer.
    Offer[] private _offers;

    event OfferMade(
        uint256 indexed offerId,
        address indexed note,
        address indexed seller,
        uint256 units,
        uint256 price
    );
    event OfferCancelled(uint256 indexed offerId, address indexed seller);
    event OfferFilled(
        uint256 indexed offerId,
        address indexed note,
        address indexed buyer,
        address seller,
        uint256 units,
        uint256 price
    );

    error ZeroAddress();
    error ZeroAmount();
    error UnknownOffer(uint256 offerId);
    error OfferNotOpen(uint256 offerId);
    error NotTheSeller(uint256 offerId, address caller);
    error SellerCannotFill(uint256 offerId);
    error NoteTransferRefused(uint256 offerId);

    constructor(IERC20 settlementToken_) {
        if (address(settlementToken_) == address(0)) revert ZeroAddress();
        settlementToken = settlementToken_;
    }

    /// @notice Offer `units` of `note` for `price` in the settlement asset.
    /// @dev The seller must have approved this contract for at least `units`
    /// on the note before the offer can be filled. That approval is not
    /// checked here: an offer made before the approval is a valid standing
    /// instruction that simply cannot be filled yet, and `fillable` is what a
    /// screen reads to say so.
    function offer(address note, uint256 units, uint256 price)
        external
        returns (uint256 offerId)
    {
        if (note == address(0)) revert ZeroAddress();
        if (units == 0 || price == 0) revert ZeroAmount();
        _offers.push(
            Offer({
                note: note,
                seller: msg.sender,
                buyer: address(0),
                units: units,
                price: price,
                openedAt: uint64(block.timestamp),
                closedAt: 0,
                status: OfferStatus.Open
            })
        );
        offerId = _offers.length;
        emit OfferMade(offerId, note, msg.sender, units, price);
    }

    /// @notice Withdraw an offer. Only the seller can, and only while it is open.
    function cancel(uint256 offerId) external {
        Offer storage entry = _open(offerId);
        if (entry.seller != msg.sender) revert NotTheSeller(offerId, msg.sender);
        entry.status = OfferStatus.Cancelled;
        entry.closedAt = uint64(block.timestamp);
        emit OfferCancelled(offerId, msg.sender);
    }

    /// @notice Take an offer whole. The buyer must have approved this contract
    /// for at least `price` on the settlement asset.
    ///
    /// @dev The offer is closed before either transfer, so a note or a
    /// settlement asset that calls back in cannot fill the same offer twice;
    /// the guard is there because the note address is the seller's choice and
    /// this contract must not assume it is well behaved.
    function fill(uint256 offerId) external nonReentrant {
        Offer storage entry = _open(offerId);
        if (entry.seller == msg.sender) revert SellerCannotFill(offerId);
        entry.status = OfferStatus.Filled;
        entry.buyer = msg.sender;
        entry.closedAt = uint64(block.timestamp);

        // The note leg first, so that a buyer the note will not accept is
        // refused by the note itself and no money has moved when it is.
        if (!IAtsNote(entry.note).transferFrom(entry.seller, msg.sender, entry.units)) {
            revert NoteTransferRefused(offerId);
        }
        settlementToken.safeTransferFrom(msg.sender, entry.seller, entry.price);

        emit OfferFilled(
            offerId, entry.note, msg.sender, entry.seller, entry.units, entry.price
        );
    }

    // ----------------------------------------------------------------- views

    /// @notice How many offers have ever been made. Ids run from 1 to this.
    function offerCount() external view returns (uint256) {
        return _offers.length;
    }

    function offerAt(uint256 offerId) external view returns (Offer memory) {
        if (offerId == 0 || offerId > _offers.length) revert UnknownOffer(offerId);
        return _offers[offerId - 1];
    }

    /// @notice Whether an offer could be filled right now, and what is in the
    /// way if it could not.
    ///
    /// @dev A no custody market means an open offer is not a promise: the
    /// seller can move the units elsewhere or revoke the allowance, and the
    /// buyer may not have approved the price. Rather than let a screen guess,
    /// this reports the three preconditions separately. It does not and cannot
    /// report the note's compliance verdict, which is the note's to give: read
    /// `getKycStatusFor` on the note for that.
    function fillable(uint256 offerId)
        external
        view
        returns (bool open, bool sellerHolds, bool sellerApproved)
    {
        if (offerId == 0 || offerId > _offers.length) revert UnknownOffer(offerId);
        Offer storage entry = _offers[offerId - 1];
        open = entry.status == OfferStatus.Open;
        if (!open) return (false, false, false);
        sellerHolds = IAtsNote(entry.note).balanceOf(entry.seller) >= entry.units;
        sellerApproved =
            IAtsNote(entry.note).allowance(entry.seller, address(this)) >= entry.units;
    }

    function _open(uint256 offerId) private view returns (Offer storage entry) {
        if (offerId == 0 || offerId > _offers.length) revert UnknownOffer(offerId);
        entry = _offers[offerId - 1];
        if (entry.status != OfferStatus.Open) revert OfferNotOpen(offerId);
    }
}
