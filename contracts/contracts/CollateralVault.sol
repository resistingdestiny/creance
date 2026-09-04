// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ICollateralVault} from "./interfaces/ICollateralVault.sol";

/// @title CollateralVault
/// @notice The only contract in this system that holds the settlement token.
/// It holds subscribed note principal and the premium account per series,
/// earmarks principal while a claim window is open, pays approved claims,
/// funds coupon transfers and returns the remaining principal at maturity.
///
/// The settlement token is reached through IERC20 and SafeERC20. On Hedera the
/// settlement asset is an HTS fungible token, which is callable through the
/// ERC-20 facade at its long-zero address, so the same bytecode runs against a
/// 6 decimal mock locally and against the real token on testnet.
/// https://docs.hedera.com/hedera/core-concepts/smart-contracts/hedera-token-service-hts-system-contract
///
/// The vault holds no HBAR: nothing here is payable and there is no receive or
/// fallback, so the 8 versus 18 decimal question never arises.
contract CollateralVault is AccessControl, Pausable, ICollateralVault {
    using SafeERC20 for IERC20;

    bytes32 public constant SUBSCRIPTION_ROLE = keccak256("SUBSCRIPTION_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    struct SeriesVault {
        uint256 principalFunded;
        uint256 principalPaid;
        uint256 principalRedeemed;
        uint256 reserved;
        uint256 premiumBalance;
        uint256 subscriptionsOutstanding;
        uint64 maturityAt;
        address atsToken;
    }

    /// @notice The settlement asset. One asset per vault by design.
    IERC20 public immutable settlementToken;

    /// @notice The CoverPool that may move money out of the reserve. Set once.
    address public coverPool;

    /// @notice Everything the vault believes it owes to somebody, summed over
    /// every series. `balanceOf(this) >= accounted` is the solvency assertion.
    uint256 public accounted;

    mapping(bytes32 seriesId => SeriesVault) private _series;
    mapping(bytes32 seriesId => mapping(address holder => uint256)) private _subscription;

    event SeriesOpened(bytes32 indexed seriesId, address atsToken, uint64 maturityAt);
    event CoverPoolSet(address indexed pool);
    event Subscribed(
        bytes32 indexed seriesId, address indexed holder, uint256 amount, uint256 principalFunded
    );
    event PremiumAttributed(bytes32 indexed seriesId, uint256 amount, uint256 premiumBalance);
    event CouponFunded(
        bytes32 indexed seriesId, bytes32 indexed couponId, address indexed to, uint256 amount
    );
    event Reserved(bytes32 indexed seriesId, uint256 amount, uint256 reserved);
    event Released(bytes32 indexed seriesId, uint256 amount, uint256 reserved);
    event ClaimPaidOut(
        bytes32 indexed seriesId, address indexed payee, uint256 amount, uint256 principalPaid
    );
    event MaturityRedeemed(bytes32 indexed seriesId, address indexed holder, uint256 amount);
    event DustSwept(bytes32 indexed seriesId, address indexed to, uint256 amount);

    error NotCoverPool();
    error SeriesUnknown(bytes32 seriesId);
    error SeriesExists(bytes32 seriesId);
    error CoverPoolAlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error MaturityInPast(uint64 maturityAt, uint64 nowAt);
    error SeriesMatured(bytes32 seriesId, uint64 maturityAt);
    error InsufficientFreePrincipal(bytes32 seriesId, uint256 requested, uint256 available);
    error InsufficientReserve(bytes32 seriesId, uint256 requested, uint256 available);
    error InsufficientPremium(bytes32 seriesId, uint256 requested, uint256 available);
    error UnbackedAttribution(uint256 balance, uint256 accountedNow, uint256 requested);
    error NotMatured(bytes32 seriesId, uint64 maturityAt);
    error ReserveOutstanding(bytes32 seriesId, uint256 reserved);
    error NothingSubscribed(bytes32 seriesId, address holder);
    error SubscriptionsOutstanding(bytes32 seriesId, uint256 outstanding);

    modifier onlyCoverPool() {
        if (msg.sender != coverPool) revert NotCoverPool();
        _;
    }

    modifier seriesExists(bytes32 seriesId) {
        if (_series[seriesId].maturityAt == 0) revert SeriesUnknown(seriesId);
        _;
    }

    constructor(IERC20 settlementToken_, address admin) {
        if (address(settlementToken_) == address(0) || admin == address(0)) revert ZeroAddress();
        settlementToken = settlementToken_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- admin

    function openSeries(bytes32 seriesId, address atsToken, uint64 maturityAt)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_series[seriesId].maturityAt != 0) revert SeriesExists(seriesId);
        if (maturityAt <= block.timestamp) revert MaturityInPast(maturityAt, uint64(block.timestamp));
        _series[seriesId].maturityAt = maturityAt;
        _series[seriesId].atsToken = atsToken;
        emit SeriesOpened(seriesId, atsToken, maturityAt);
    }

    /// @notice One shot. A setter that can be called twice is a way to redirect
    /// every payout, so the second call reverts.
    function setCoverPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (coverPool != address(0)) revert CoverPoolAlreadySet();
        if (pool == address(0)) revert ZeroAddress();
        coverPool = pool;
        emit CoverPoolSet(pool);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // -------------------------------------------------------------- money in

    /// @notice Record a noteholder subscription and pull the principal in.
    /// `holder` is separate from `msg.sender` because the API pays on the
    /// investor's behalf after the ATS mint, and the pro rata record at
    /// maturity has to name the investor.
    function subscribe(bytes32 seriesId, address holder, uint256 amount)
        external
        whenNotPaused
        onlyRole(SUBSCRIPTION_ROLE)
        seriesExists(seriesId)
    {
        if (amount == 0) revert ZeroAmount();
        if (holder == address(0)) revert ZeroAddress();
        SeriesVault storage s = _series[seriesId];
        if (block.timestamp >= s.maturityAt) revert SeriesMatured(seriesId, s.maturityAt);

        s.principalFunded += amount;
        s.subscriptionsOutstanding += amount;
        _subscription[seriesId][holder] += amount;
        accounted += amount;

        settlementToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Subscribed(seriesId, holder, amount, s.principalFunded);
    }

    /// @notice Credit a premium that already arrived in the vault's account.
    /// Premiums are native HTS transfers moved by Hedera Scheduled
    /// Transactions, which fire no EVM hook, so the vault has to be told. What
    /// makes this safe is not the role but the balance check: only money that
    /// is actually present can be credited.
    function attributePremium(bytes32 seriesId, uint256 amount)
        external
        whenNotPaused
        onlyRole(TREASURY_ROLE)
        seriesExists(seriesId)
    {
        if (amount == 0) revert ZeroAmount();
        _attribute(seriesId, amount);
    }

    /// @notice The same for the whole unaccounted balance. Correct only while
    /// there is one series; with more than one, attribution is ambiguous and
    /// the explicit form is the only right answer.
    function attributeAllUnaccounted(bytes32 seriesId)
        external
        whenNotPaused
        onlyRole(TREASURY_ROLE)
        seriesExists(seriesId)
        returns (uint256 credited)
    {
        uint256 balance = settlementToken.balanceOf(address(this));
        credited = balance > accounted ? balance - accounted : 0;
        if (credited > 0) _attribute(seriesId, credited);
    }

    function _attribute(bytes32 seriesId, uint256 amount) private {
        uint256 balance = settlementToken.balanceOf(address(this));
        if (balance < accounted + amount) revert UnbackedAttribution(balance, accounted, amount);
        SeriesVault storage s = _series[seriesId];
        s.premiumBalance += amount;
        accounted += amount;
        emit PremiumAttributed(seriesId, amount, s.premiumBalance);
    }

    // ------------------------------------------------------------- money out

    /// @notice Settle a declared ATS coupon out of the premium account. Coupons
    /// are never paid from principal.
    function fundCoupon(bytes32 seriesId, bytes32 couponId, address to, uint256 amount)
        external
        whenNotPaused
        onlyRole(TREASURY_ROLE)
        seriesExists(seriesId)
    {
        if (amount == 0) revert ZeroAmount();
        SeriesVault storage s = _series[seriesId];
        if (amount > s.premiumBalance) {
            revert InsufficientPremium(seriesId, amount, s.premiumBalance);
        }
        s.premiumBalance -= amount;
        accounted -= amount;
        settlementToken.safeTransfer(to, amount);
        emit CouponFunded(seriesId, couponId, to, amount);
    }

    /// @notice Return a noteholder's share of the remaining principal.
    /// Permissionless on purpose: the holder, a judge or the demo driver can
    /// finish the lifecycle and no keeper has to be running.
    function redeemAtMaturity(bytes32 seriesId, address holder)
        external
        seriesExists(seriesId)
        returns (uint256 amount)
    {
        SeriesVault storage s = _series[seriesId];
        if (block.timestamp < s.maturityAt) revert NotMatured(seriesId, s.maturityAt);
        if (s.reserved != 0) revert ReserveOutstanding(seriesId, s.reserved);
        uint256 subscribed = _subscription[seriesId][holder];
        if (subscribed == 0) revert NothingSubscribed(seriesId, holder);

        // Truncation leaves dust in the vault rather than over-paying, so the
        // last holder's redemption can never revert for want of a minor unit.
        amount = (subscribed * (s.principalFunded - s.principalPaid)) / s.principalFunded;

        _subscription[seriesId][holder] = 0;
        s.subscriptionsOutstanding -= subscribed;
        s.principalRedeemed += amount;
        accounted -= amount;

        settlementToken.safeTransfer(holder, amount);
        emit MaturityRedeemed(seriesId, holder, amount);
    }

    /// @notice Collect the truncation dust once every subscription is redeemed.
    function sweepDust(bytes32 seriesId, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        seriesExists(seriesId)
        returns (uint256 amount)
    {
        SeriesVault storage s = _series[seriesId];
        if (s.subscriptionsOutstanding != 0) {
            revert SubscriptionsOutstanding(seriesId, s.subscriptionsOutstanding);
        }
        if (s.reserved != 0) revert ReserveOutstanding(seriesId, s.reserved);
        amount = s.principalFunded - s.principalPaid - s.principalRedeemed;
        if (amount == 0) revert ZeroAmount();
        s.principalRedeemed += amount;
        accounted -= amount;
        settlementToken.safeTransfer(to, amount);
        emit DustSwept(seriesId, to, amount);
    }

    // ------------------------------------------------------ only the CoverPool

    /// @notice Earmark principal against an open claim window. No tokens move:
    /// a reserve does not change what the vault owes, only who it might owe it
    /// to, so `accounted` is untouched.
    function reserve(bytes32 seriesId, uint256 amount) external onlyCoverPool seriesExists(seriesId) {
        if (amount == 0) revert ZeroAmount();
        uint256 free = principalFree(seriesId);
        if (amount > free) revert InsufficientFreePrincipal(seriesId, amount, free);
        SeriesVault storage s = _series[seriesId];
        s.reserved += amount;
        emit Reserved(seriesId, amount, s.reserved);
    }

    /// @notice The exact arithmetic inverse of `reserve`. Not pausable: a pause
    /// stops new exposure, it must not trap money.
    function release(bytes32 seriesId, uint256 amount) external onlyCoverPool seriesExists(seriesId) {
        SeriesVault storage s = _series[seriesId];
        if (amount > s.reserved) revert InsufficientReserve(seriesId, amount, s.reserved);
        s.reserved -= amount;
        emit Released(seriesId, amount, s.reserved);
    }

    /// @notice Pay an approved claim out of the reserve.
    function payClaim(bytes32 seriesId, address payee, uint256 amount)
        external
        onlyCoverPool
        seriesExists(seriesId)
    {
        if (amount == 0) revert ZeroAmount();
        SeriesVault storage s = _series[seriesId];
        if (amount > s.reserved) revert InsufficientReserve(seriesId, amount, s.reserved);

        s.reserved -= amount;
        s.principalPaid += amount;
        accounted -= amount;

        settlementToken.safeTransfer(payee, amount);
        emit ClaimPaidOut(seriesId, payee, amount, s.principalPaid);
    }

    // ---------------------------------------------------------------- views

    function principalRemaining(bytes32 seriesId)
        public
        view
        seriesExists(seriesId)
        returns (uint256)
    {
        SeriesVault storage s = _series[seriesId];
        return s.principalFunded - s.principalPaid;
    }

    function principalFree(bytes32 seriesId) public view seriesExists(seriesId) returns (uint256) {
        SeriesVault storage s = _series[seriesId];
        return s.principalFunded - s.principalPaid - s.principalRedeemed - s.reserved;
    }

    function reservedOf(bytes32 seriesId) external view returns (uint256) {
        return _series[seriesId].reserved;
    }

    function premiumBalanceOf(bytes32 seriesId) external view returns (uint256) {
        return _series[seriesId].premiumBalance;
    }

    function subscriptionOf(bytes32 seriesId, address holder) external view returns (uint256) {
        return _subscription[seriesId][holder];
    }

    function seriesOf(bytes32 seriesId) external view returns (SeriesVault memory) {
        return _series[seriesId];
    }

    function accountedTotal() external view returns (uint256) {
        return accounted;
    }
}
