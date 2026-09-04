// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICollateralVault} from "./interfaces/ICollateralVault.sol";
import {MonthLib} from "./MonthLib.sol";

/// @title CoverPool
/// @notice The policy register, the observation history and the open month
/// bookkeeping for Occupation Cover. It is the only caller of the vault's
/// value moving functions and it never holds a token balance itself.
///
/// A payout needs two keys. The index key is held when the group's index is
/// open in the month of separation or in either of the two months after it,
/// which this contract stores and checks. The loss key is the adjudicated
/// proof of loss, which arrives as a CLAIMS role signature over the claim.
contract CoverPool is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using MonthLib for uint32;
    using MonthLib for uint64;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant BINDER_ROLE = keccak256("BINDER_ROLE");
    /// @notice The set of addresses whose signature `payClaim` accepts. It
    /// never appears in an `onlyRole` modifier: it grants no call rights at
    /// all, only the right to authorise a payout off chain.
    bytes32 public constant CLAIMS_ROLE = keccak256("CLAIMS_ROLE");

    /// @dev EIP-712 type hash for the claim authorisation the API signs.
    bytes32 public constant CLAIM_AUTHORISATION_TYPEHASH = keccak256(
        "ClaimAuthorisation(bytes32 policyId,bytes32 claimId,bytes32 nullifierHash,bytes32 packetHash,bytes32 decisionHash,address payee,uint256 amount,uint64 separationAt,uint64 deadline)"
    );

    uint8 public constant REASON_NONE = 0;
    uint8 public constant REASON_SHOCK = 1;
    uint8 public constant REASON_LEVEL = 2;

    /// @dev The lookback is a series parameter so the rule is visible in the
    /// terms, but the predicate has to stay constant bounded on the money path.
    uint8 public constant MAX_LOOKBACK_MONTHS = 3;

    enum SeriesStatus {
        None,
        Active,
        ClaimsOpen,
        Settling,
        Matured
    }

    enum PayoutMode {
        Full,
        Indexed
    }

    enum PolicyStatus {
        None,
        Active,
        Lapsed,
        Paid,
        Expired
    }

    struct SeriesTermsInput {
        bytes32 seriesId;
        bytes32 group;
        int64 attachmentShock;
        int64 levelLine;
        int64 exhaustionShock;
        uint8 payoutMode;
        uint32 waitingPeriod;
        uint32 term;
        uint32 gracePeriod;
        uint32 claimWindowFromObservation;
        uint32 claimWindowFromSeparation;
        uint8 lookbackMonths;
    }

    struct SeriesTerms {
        bytes32 group;
        int64 attachmentShock;
        int64 levelLine;
        int64 exhaustionShock;
        PayoutMode payoutMode;
        uint32 waitingPeriod;
        uint32 term;
        uint32 gracePeriod;
        uint32 claimWindowFromObservation;
        uint32 claimWindowFromSeparation;
        uint8 lookbackMonths;
        SeriesStatus status;
        SeriesStatus statusBeforeWindow;
        uint256 activeExposure;
        uint256 exposureCovered;
        uint32 firstOpenMonth;
        uint32 lastOpenMonth;
        uint32 lastObservedMonth;
        uint64 windowEndsAt;
    }

    struct Observation {
        int64 odi;
        int64 ebar;
        uint64 submittedAt;
        uint64 hcsSequence;
        bytes32 sourceHash;
        uint8 openReason;
        bool present;
    }

    struct Policy {
        bytes32 seriesId;
        address holder;
        bytes32 nullifierHash;
        uint256 limit;
        uint256 premium;
        uint64 startAt;
        uint32 paidThroughMonth;
        uint64 paidAt;
        PolicyStatus status;
    }

    struct BindParams {
        bytes32 policyId;
        bytes32 seriesId;
        address holder;
        bytes32 nullifierHash;
        uint256 limit;
        uint256 premium;
        uint64 startAt;
        uint64 hcsReceiptSeq;
    }

    struct ObservationInput {
        bytes32 seriesId;
        uint32 period;
        int64 odi;
        int64 ebar;
        uint64 hcsSequence;
        bytes32 sourceHash;
    }

    struct ClaimParams {
        bytes32 policyId;
        bytes32 claimId;
        uint64 separationAt;
        bytes32 packetHash;
        bytes32 decisionHash;
        uint256 amount;
        address payee;
        uint64 authDeadline;
    }

    /// @notice The vault that holds the money. Set once, in the constructor.
    ICollateralVault public immutable vault;

    mapping(bytes32 seriesId => SeriesTerms) private _series;
    mapping(bytes32 seriesId => mapping(uint32 monthIndex => Observation)) private _observations;
    mapping(bytes32 seriesId => mapping(uint32 monthIndex => bool)) public isOpenMonth;
    mapping(bytes32 seriesId => uint32[]) private _openMonths;
    mapping(bytes32 policyId => Policy) private _policies;
    mapping(bytes32 seriesId => mapping(bytes32 nullifierHash => bytes32)) public activePolicyOf;
    mapping(bytes32 seriesId => mapping(bytes32 nullifierHash => bool)) public nullifierClaimed;
    mapping(bytes32 claimId => bool) public usedClaimId;

    event SeriesRegistered(
        bytes32 indexed seriesId,
        bytes32 indexed group,
        int64 attachmentShock,
        int64 levelLine,
        uint8 payoutMode
    );
    event SeriesStatusChanged(bytes32 indexed seriesId, uint8 from, uint8 to);
    event PolicyBound(
        bytes32 indexed policyId,
        bytes32 indexed seriesId,
        address indexed holder,
        bytes32 nullifierHash,
        uint256 limit,
        uint256 premium,
        uint64 startAt,
        uint64 hcsReceiptSeq,
        uint256 activeExposure
    );
    event PremiumRecorded(bytes32 indexed policyId, uint32 period, uint32 paidThroughPeriod);
    event PolicyLapsed(bytes32 indexed policyId, uint256 activeExposure);
    event PolicyExpired(bytes32 indexed policyId, uint256 activeExposure);
    event ObservationSubmitted(
        bytes32 indexed seriesId,
        uint32 indexed period,
        int64 odi,
        int64 ebar,
        bool open,
        uint8 openReason,
        uint64 hcsSequence,
        bytes32 sourceHash
    );
    event ClaimsOpened(
        bytes32 indexed seriesId,
        uint32 indexed period,
        uint8 openReason,
        uint256 reserved,
        uint64 windowEndsAt
    );
    event ReserveToppedUp(
        bytes32 indexed seriesId, uint32 indexed period, uint256 added, uint256 reserved
    );
    event WindowExtended(bytes32 indexed seriesId, uint32 indexed period, uint64 windowEndsAt);
    event ClaimPaid(
        bytes32 indexed policyId,
        bytes32 indexed claimId,
        bytes32 indexed seriesId,
        address payee,
        uint256 amount,
        uint32 separationMonth,
        uint32 qualifyingMonth,
        bytes32 packetHash,
        bytes32 decisionHash
    );
    event WindowClosed(bytes32 indexed seriesId, uint256 released, uint32 lastOpenPeriod);

    error ZeroAddress();
    error SeriesUnknown(bytes32 seriesId);
    error SeriesExists(bytes32 seriesId);
    error SeriesNotActive(bytes32 seriesId, uint8 status);
    error SeriesInClaimWindow(bytes32 seriesId);
    error BadTerms(bytes32 seriesId);
    error PolicyExists(bytes32 policyId);
    error PolicyUnknown(bytes32 policyId);
    error PolicyNotActive(bytes32 policyId, uint8 status);
    error NullifierHasActivePolicy(bytes32 seriesId, bytes32 nullifierHash);
    error NullifierAlreadyClaimed(bytes32 seriesId, bytes32 nullifierHash);
    error ClaimIdUsed(bytes32 claimId);
    error PolicyAlreadyPaid(bytes32 policyId, uint64 paidAt);
    error CapacityExceeded(bytes32 seriesId, uint256 exposure, uint256 limit, uint256 principal);
    error PeriodNotAfterLast(bytes32 seriesId, uint32 period, uint32 lastObserved);
    error PeriodInFuture(bytes32 seriesId, uint32 period);
    error ObservationExists(bytes32 seriesId, uint32 period);
    error SeparationOutsideLossWindow(bytes32 seriesId, uint32 separationMonth);
    error SeparationInWaitingPeriod(uint64 separationAt, uint64 waitingEndsAt);
    error SeparationAfterTerm(uint64 separationAt, uint64 termEndsAt);
    error ClaimWindowClosed(uint64 deadline, uint64 nowAt);
    error AmountMismatch(uint256 submitted, uint256 expected);
    error ZeroPayout(bytes32 policyId);
    error PayeeIsNotHolder(address payee, address holder);
    error IndexedModeNeedsShockOpening(bytes32 seriesId, uint32 qualifyingMonth);
    error AuthorisationExpired(uint64 deadline);
    error BadSignature();
    error SignerLacksClaimsRole(address signer);
    error GraceNotOver(bytes32 policyId, uint64 lapsesAt);
    error TermNotOver(bytes32 policyId, uint64 termEndsAt);
    error WindowNotOver(bytes32 seriesId, uint64 windowEndsAt);
    error NoOpenWindow(bytes32 seriesId);

    constructor(ICollateralVault vault_, address admin) EIP712("DisplacementBond", "1") {
        if (address(vault_) == address(0) || admin == address(0)) revert ZeroAddress();
        vault = vault_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // --------------------------------------------------------------- series

    /// @notice Freeze a series' terms. Nothing here is mutable afterwards
    /// except the status: a settable attachment is a settable payout, and the
    /// whole basis on which a buyer is told what their cover does is that the
    /// trigger parameters were fixed at issuance.
    function registerSeries(SeriesTermsInput calldata t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SeriesTerms storage s = _series[t.seriesId];
        if (s.status != SeriesStatus.None) revert SeriesExists(t.seriesId);
        if (t.lookbackMonths > MAX_LOOKBACK_MONTHS) revert BadTerms(t.seriesId);
        if (t.waitingPeriod == 0 || t.term == 0) revert BadTerms(t.seriesId);
        if (t.claimWindowFromObservation == 0 || t.claimWindowFromSeparation == 0) {
            revert BadTerms(t.seriesId);
        }
        if (t.payoutMode > uint8(PayoutMode.Indexed)) revert BadTerms(t.seriesId);
        if (PayoutMode(t.payoutMode) == PayoutMode.Indexed && t.exhaustionShock <= t.attachmentShock)
        {
            revert BadTerms(t.seriesId);
        }
        // Reverts with SeriesUnknown when the vault has no such series, so the
        // two registers cannot drift apart.
        vault.principalRemaining(t.seriesId);

        s.group = t.group;
        s.attachmentShock = t.attachmentShock;
        s.levelLine = t.levelLine;
        s.exhaustionShock = t.exhaustionShock;
        s.payoutMode = PayoutMode(t.payoutMode);
        s.waitingPeriod = t.waitingPeriod;
        s.term = t.term;
        s.gracePeriod = t.gracePeriod;
        s.claimWindowFromObservation = t.claimWindowFromObservation;
        s.claimWindowFromSeparation = t.claimWindowFromSeparation;
        s.lookbackMonths = t.lookbackMonths;
        s.status = SeriesStatus.Active;

        emit SeriesRegistered(t.seriesId, t.group, t.attachmentShock, t.levelLine, t.payoutMode);
    }

    /// @notice Move a series between Active, Settling and Matured. A claim
    /// window is not an admin transition: it opens on an observation and
    /// closes on time.
    function setSeriesStatus(bytes32 seriesId, SeriesStatus status)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        SeriesTerms storage s = _series[seriesId];
        if (s.status == SeriesStatus.None) revert SeriesUnknown(seriesId);
        if (s.status == SeriesStatus.ClaimsOpen) revert SeriesInClaimWindow(seriesId);
        if (status == SeriesStatus.None || status == SeriesStatus.ClaimsOpen) {
            revert SeriesNotActive(seriesId, uint8(status));
        }
        emit SeriesStatusChanged(seriesId, uint8(s.status), uint8(status));
        s.status = status;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------- policies

    /// @notice Register a policy after its first premium has settled.
    /// Binding while a window is open is allowed and does not touch the
    /// reserve: the waiting period puts the earliest possible separation
    /// month beyond every month that is already open.
    function bind(BindParams calldata p) external whenNotPaused onlyRole(BINDER_ROLE) {
        SeriesTerms storage s = _series[p.seriesId];
        if (s.status != SeriesStatus.Active && s.status != SeriesStatus.ClaimsOpen) {
            revert SeriesNotActive(p.seriesId, uint8(s.status));
        }
        if (_policies[p.policyId].status != PolicyStatus.None) revert PolicyExists(p.policyId);
        if (p.limit == 0) revert BadTerms(p.seriesId);
        if (p.holder == address(0)) revert ZeroAddress();
        if (activePolicyOf[p.seriesId][p.nullifierHash] != bytes32(0)) {
            revert NullifierHasActivePolicy(p.seriesId, p.nullifierHash);
        }

        uint256 principal = vault.principalRemaining(p.seriesId);
        if (s.activeExposure + p.limit > principal) {
            revert CapacityExceeded(p.seriesId, s.activeExposure, p.limit, principal);
        }

        _policies[p.policyId] = Policy({
            seriesId: p.seriesId,
            holder: p.holder,
            nullifierHash: p.nullifierHash,
            limit: p.limit,
            premium: p.premium,
            startAt: p.startAt,
            paidThroughMonth: MonthLib.monthIndexOf(p.startAt),
            paidAt: 0,
            status: PolicyStatus.Active
        });
        s.activeExposure += p.limit;
        activePolicyOf[p.seriesId][p.nullifierHash] = p.policyId;

        emit PolicyBound(
            p.policyId,
            p.seriesId,
            p.holder,
            p.nullifierHash,
            p.limit,
            p.premium,
            p.startAt,
            p.hcsReceiptSeq,
            s.activeExposure
        );
    }

    /// @notice Record that a premium scheduled transaction was observed to have
    /// executed. Held on chain only so that lapsing can be a permissionless
    /// poke.
    function recordPremium(bytes32 policyId, uint32 period) external onlyRole(BINDER_ROLE) {
        Policy storage p = _policies[policyId];
        if (p.status == PolicyStatus.None) revert PolicyUnknown(policyId);
        uint32 m = MonthLib.toIndex(period);
        if (m > p.paidThroughMonth) p.paidThroughMonth = m;
        emit PremiumRecorded(policyId, period, MonthLib.toYyyymm(p.paidThroughMonth));
    }

    /// @notice Lapse a policy whose premium is unpaid past the grace period.
    /// Permissionless, so there is no keeper to fail, and blocked while a
    /// claim window is open, so no policy can leave the reserve except by
    /// being paid.
    function lapse(bytes32 policyId) external {
        Policy storage p = _policies[policyId];
        if (p.status == PolicyStatus.None) revert PolicyUnknown(policyId);
        if (p.status != PolicyStatus.Active) revert PolicyNotActive(policyId, uint8(p.status));
        SeriesTerms storage s = _series[p.seriesId];
        if (s.status == SeriesStatus.ClaimsOpen) revert SeriesInClaimWindow(p.seriesId);

        uint64 lapsesAt = MonthLib.startOfMonth(p.paidThroughMonth + 1) + s.gracePeriod;
        if (block.timestamp <= lapsesAt) revert GraceNotOver(policyId, lapsesAt);

        p.status = PolicyStatus.Lapsed;
        s.activeExposure -= p.limit;
        delete activePolicyOf[p.seriesId][p.nullifierHash];
        emit PolicyLapsed(policyId, s.activeExposure);
    }

    /// @notice Expire a policy whose term has run out.
    function expire(bytes32 policyId) external {
        Policy storage p = _policies[policyId];
        if (p.status == PolicyStatus.None) revert PolicyUnknown(policyId);
        if (p.status != PolicyStatus.Active && p.status != PolicyStatus.Lapsed) {
            revert PolicyNotActive(policyId, uint8(p.status));
        }
        SeriesTerms storage s = _series[p.seriesId];
        if (s.status == SeriesStatus.ClaimsOpen) revert SeriesInClaimWindow(p.seriesId);

        uint64 termEndsAt = p.startAt + s.term;
        if (block.timestamp <= termEndsAt) revert TermNotOver(policyId, termEndsAt);

        if (p.status == PolicyStatus.Active) {
            s.activeExposure -= p.limit;
            delete activePolicyOf[p.seriesId][p.nullifierHash];
        }
        p.status = PolicyStatus.Expired;
        emit PolicyExpired(policyId, s.activeExposure);
    }

    // ---------------------------------------------------------------- index

    /// @notice Record one monthly observation for a series.
    /// The oracle supplies the two measured quantities and this contract
    /// decides whether the month is open, against the thresholds frozen at
    /// registration. A wrong ODI is visible and disputable against the
    /// published source file; a correct ODI with a wrong open flag is not
    /// possible.
    function submitObservation(ObservationInput calldata o)
        external
        whenNotPaused
        onlyRole(ORACLE_ROLE)
    {
        SeriesTerms storage s = _series[o.seriesId];
        if (
            s.status != SeriesStatus.Active && s.status != SeriesStatus.ClaimsOpen
                && s.status != SeriesStatus.Settling
        ) {
            revert SeriesNotActive(o.seriesId, uint8(s.status));
        }

        uint32 m = MonthLib.toIndex(o.period);
        if (_observations[o.seriesId][m].present) revert ObservationExists(o.seriesId, o.period);
        // Strictly increasing. Back-filling an earlier month after a later one
        // has landed would move a loss window a claim was already judged
        // against.
        if (s.lastObservedMonth != 0 && m <= s.lastObservedMonth) {
            revert PeriodNotAfterLast(o.seriesId, o.period, s.lastObservedMonth);
        }
        if (MonthLib.startOfMonth(m) > block.timestamp) revert PeriodInFuture(o.seriesId, o.period);

        bool shock = o.odi >= s.attachmentShock;
        bool level = o.ebar >= s.levelLine;
        bool open = shock || level;
        uint8 openReason = shock ? REASON_SHOCK : (level ? REASON_LEVEL : REASON_NONE);

        _observations[o.seriesId][m] = Observation({
            odi: o.odi,
            ebar: o.ebar,
            submittedAt: uint64(block.timestamp),
            hcsSequence: o.hcsSequence,
            sourceHash: o.sourceHash,
            openReason: openReason,
            present: true
        });
        s.lastObservedMonth = m;

        emit ObservationSubmitted(
            o.seriesId, o.period, o.odi, o.ebar, open, openReason, o.hcsSequence, o.sourceHash
        );

        if (open) _openMonth(o.seriesId, s, m, o.period, openReason);
    }

    function _openMonth(
        bytes32 seriesId,
        SeriesTerms storage s,
        uint32 m,
        uint32 period,
        uint8 openReason
    ) private {
        isOpenMonth[seriesId][m] = true;
        _openMonths[seriesId].push(m);
        s.lastOpenMonth = m;
        if (s.firstOpenMonth == 0) s.firstOpenMonth = m;

        // The latest instant at which any claim qualifying through this month
        // can still be filed. The separation term usually dominates, because
        // the source publishes a month three to five weeks after it ends.
        uint64 fromObservation = uint64(block.timestamp) + s.claimWindowFromObservation;
        uint64 fromSeparation = MonthLib.startOfMonth(m + 1) + s.claimWindowFromSeparation;
        uint64 candidate = fromObservation > fromSeparation ? fromObservation : fromSeparation;
        if (candidate > s.windowEndsAt) {
            s.windowEndsAt = candidate;
            emit WindowExtended(seriesId, period, candidate);
        }

        if (s.status != SeriesStatus.ClaimsOpen) {
            s.statusBeforeWindow = s.status;
            s.status = SeriesStatus.ClaimsOpen;
            s.exposureCovered = s.activeExposure;
            if (s.activeExposure > 0) vault.reserve(seriesId, s.activeExposure);
            emit SeriesStatusChanged(seriesId, uint8(s.statusBeforeWindow), uint8(SeriesStatus.ClaimsOpen));
            emit ClaimsOpened(
                seriesId, period, openReason, vault.reservedOf(seriesId), s.windowEndsAt
            );
        } else if (s.activeExposure > s.exposureCovered) {
            // Top up rather than reserve again. Reserving activeExposure a
            // second time would double count; reserving nothing would leave
            // the reserve short of policies bound since the window opened.
            uint256 added = s.activeExposure - s.exposureCovered;
            s.exposureCovered = s.activeExposure;
            vault.reserve(seriesId, added);
            emit ReserveToppedUp(seriesId, period, added, vault.reservedOf(seriesId));
        }
    }

    // --------------------------------------------------------------- claims

    /// @notice Pay an approved claim. Anyone may call it; what makes it safe is
    /// the CLAIMS role signature over the whole parameter set, so a payout that
    /// fails for an environmental reason can be retried by anybody.
    function payClaim(ClaimParams calldata c, bytes calldata authorisation) external nonReentrant {
        _requireNotPaused();

        Policy storage p = _policies[c.policyId];
        if (p.status == PolicyStatus.None) revert PolicyUnknown(c.policyId);
        if (p.status != PolicyStatus.Active) revert PolicyNotActive(c.policyId, uint8(p.status));
        if (p.paidAt != 0) revert PolicyAlreadyPaid(c.policyId, p.paidAt);
        if (usedClaimId[c.claimId]) revert ClaimIdUsed(c.claimId);
        if (nullifierClaimed[p.seriesId][p.nullifierHash]) {
            revert NullifierAlreadyClaimed(p.seriesId, p.nullifierHash);
        }
        if (c.payee != p.holder) revert PayeeIsNotHolder(c.payee, p.holder);

        SeriesTerms storage s = _series[p.seriesId];
        if (s.status != SeriesStatus.ClaimsOpen) revert SeriesNotActive(p.seriesId, uint8(s.status));

        uint64 waitingEndsAt = p.startAt + s.waitingPeriod;
        if (c.separationAt < waitingEndsAt) {
            revert SeparationInWaitingPeriod(c.separationAt, waitingEndsAt);
        }
        uint64 termEndsAt = p.startAt + s.term;
        if (c.separationAt > termEndsAt) revert SeparationAfterTerm(c.separationAt, termEndsAt);

        uint32 separationMonth = MonthLib.monthIndexOf(c.separationAt);
        (bool inWindow, uint32 qualifyingMonth) = _isInLossWindow(p.seriesId, separationMonth);
        if (!inWindow) revert SeparationOutsideLossWindow(p.seriesId, separationMonth);

        uint64 deadline = _claimDeadline(p.seriesId, s, c.separationAt, qualifyingMonth);
        if (block.timestamp > deadline) revert ClaimWindowClosed(deadline, uint64(block.timestamp));

        uint256 expected = _payout(p.seriesId, s, p.limit, qualifyingMonth);
        if (c.amount != expected) revert AmountMismatch(c.amount, expected);
        if (c.amount == 0) revert ZeroPayout(c.policyId);
        if (c.authDeadline < block.timestamp) revert AuthorisationExpired(c.authDeadline);

        _checkAuthorisation(c, p.nullifierHash, authorisation);

        // Effects.
        usedClaimId[c.claimId] = true;
        nullifierClaimed[p.seriesId][p.nullifierHash] = true;
        p.status = PolicyStatus.Paid;
        p.paidAt = uint64(block.timestamp);
        s.activeExposure -= p.limit;
        s.exposureCovered -= p.limit;
        delete activePolicyOf[p.seriesId][p.nullifierHash];

        // Interaction. A failure here reverts everything, so there is never a
        // policy marked paid whose money did not move.
        vault.payClaim(p.seriesId, c.payee, c.amount);

        emit ClaimPaid(
            c.policyId,
            c.claimId,
            p.seriesId,
            c.payee,
            c.amount,
            MonthLib.toYyyymm(separationMonth),
            MonthLib.toYyyymm(qualifyingMonth),
            c.packetHash,
            c.decisionHash
        );
    }

    function _checkAuthorisation(
        ClaimParams calldata c,
        bytes32 nullifierHash,
        bytes calldata authorisation
    ) private view {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CLAIM_AUTHORISATION_TYPEHASH,
                    c.policyId,
                    c.claimId,
                    nullifierHash,
                    c.packetHash,
                    c.decisionHash,
                    c.payee,
                    c.amount,
                    c.separationAt,
                    c.authDeadline
                )
            )
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, authorisation);
        if (err != ECDSA.RecoverError.NoError) revert BadSignature();
        if (!hasRole(CLAIMS_ROLE, signer)) revert SignerLacksClaimsRole(signer);
    }

    /// @notice Return the unclaimed reserve to the vault once the window is
    /// over. Permissionless and not blocked by a pause: a pause stops new
    /// exposure, it must not trap money.
    function closeWindow(bytes32 seriesId) external {
        SeriesTerms storage s = _series[seriesId];
        if (s.status != SeriesStatus.ClaimsOpen) revert SeriesNotActive(seriesId, uint8(s.status));
        if (s.windowEndsAt == 0) revert NoOpenWindow(seriesId);
        if (block.timestamp < s.windowEndsAt) revert WindowNotOver(seriesId, s.windowEndsAt);

        uint256 remaining = vault.reservedOf(seriesId);
        SeriesStatus previous = s.statusBeforeWindow == SeriesStatus.None
            ? SeriesStatus.Active
            : s.statusBeforeWindow;
        s.status = previous;
        s.statusBeforeWindow = SeriesStatus.None;
        s.windowEndsAt = 0;
        s.exposureCovered = 0;

        if (remaining > 0) vault.release(seriesId, remaining);

        emit SeriesStatusChanged(seriesId, uint8(SeriesStatus.ClaimsOpen), uint8(previous));
        emit WindowClosed(seriesId, remaining, MonthLib.toYyyymm(s.lastOpenMonth));
    }

    // ----------------------------------------------------------------- views

    /// @notice The index key, in the YYYYMM form every caller outside this
    /// contract uses. A separation in month m qualifies when some month o with
    /// m <= o <= m + lookback is open, and the qualifying month is the earliest
    /// such month. Returns period 0 when none qualifies.
    function isInLossWindow(bytes32 seriesId, uint32 separationPeriod)
        external
        view
        returns (bool inWindow, uint32 qualifyingPeriod)
    {
        uint32 qualifying;
        (inWindow, qualifying) = _isInLossWindow(seriesId, MonthLib.toIndex(separationPeriod));
        return (inWindow, inWindow ? MonthLib.toYyyymm(qualifying) : 0);
    }

    /// @dev Three mapping reads and no loop over the open month list: the money
    /// path must stay constant bounded, which is why lookbackMonths is capped
    /// at registration.
    function _isInLossWindow(bytes32 seriesId, uint32 separationMonth)
        private
        view
        returns (bool, uint32 qualifyingMonth)
    {
        uint8 lookback = _series[seriesId].lookbackMonths;
        for (uint32 i = 0; i <= lookback; ++i) {
            if (isOpenMonth[seriesId][separationMonth + i]) return (true, separationMonth + i);
        }
        return (false, 0);
    }

    /// @notice The last instant at which a claim for this separation may be
    /// filed: 60 days from separation or 30 days from the observation that
    /// opened claims, whichever ends later. Zero when no month qualifies yet.
    function claimDeadline(bytes32 seriesId, uint64 separationAt) external view returns (uint64) {
        SeriesTerms storage s = _series[seriesId];
        if (s.status == SeriesStatus.None) revert SeriesUnknown(seriesId);
        (bool inWindow, uint32 qualifyingMonth) =
            _isInLossWindow(seriesId, MonthLib.monthIndexOf(separationAt));
        if (!inWindow) return 0;
        return _claimDeadline(seriesId, s, separationAt, qualifyingMonth);
    }

    function _claimDeadline(
        bytes32 seriesId,
        SeriesTerms storage s,
        uint64 separationAt,
        uint32 qualifyingMonth
    ) private view returns (uint64) {
        uint64 fromSeparation = separationAt + s.claimWindowFromSeparation;
        uint64 fromObservation =
            _observations[seriesId][qualifyingMonth].submittedAt + s.claimWindowFromObservation;
        return fromSeparation > fromObservation ? fromSeparation : fromObservation;
    }

    /// @notice What a claim on this policy would pay for this separation, so
    /// the API can dry run the arithmetic before it signs an authorisation.
    function expectedPayout(bytes32 policyId, uint64 separationAt) external view returns (uint256) {
        Policy storage p = _policies[policyId];
        if (p.status == PolicyStatus.None) revert PolicyUnknown(policyId);
        SeriesTerms storage s = _series[p.seriesId];
        uint32 separationMonth = MonthLib.monthIndexOf(separationAt);
        (bool inWindow, uint32 qualifyingMonth) = _isInLossWindow(p.seriesId, separationMonth);
        if (!inWindow) revert SeparationOutsideLossWindow(p.seriesId, separationMonth);
        return _payout(p.seriesId, s, p.limit, qualifyingMonth);
    }

    /// @dev Full pays the limit. Indexed pays
    /// limit * min(1, (ODI - A) / (E - A)) and is defined against the shock
    /// form only, so an indexed series whose qualifying month opened on the
    /// level form refuses to pay rather than inventing a number.
    function _payout(bytes32 seriesId, SeriesTerms storage s, uint256 limit, uint32 qualifyingMonth)
        private
        view
        returns (uint256)
    {
        if (s.payoutMode == PayoutMode.Full) return limit;

        Observation storage o = _observations[seriesId][qualifyingMonth];
        if (o.openReason != REASON_SHOCK) {
            revert IndexedModeNeedsShockOpening(seriesId, qualifyingMonth);
        }
        int256 num = int256(o.odi) - int256(s.attachmentShock);
        int256 den = int256(s.exhaustionShock) - int256(s.attachmentShock);
        if (num >= den) return limit;
        return (limit * uint256(num)) / uint256(den);
    }

    function quoteCapacity(bytes32 seriesId) external view returns (uint256 free) {
        SeriesTerms storage s = _series[seriesId];
        if (s.status == SeriesStatus.None) revert SeriesUnknown(seriesId);
        uint256 principal = vault.principalRemaining(seriesId);
        return principal > s.activeExposure ? principal - s.activeExposure : 0;
    }

    /// @notice Every month this series has ever opened, in YYYYMM order. The
    /// history is permanent: it is what the index page renders and what makes
    /// "this cover has never paid for this occupation" a checkable statement.
    function openMonths(bytes32 seriesId) external view returns (uint32[] memory periods) {
        uint32[] storage months = _openMonths[seriesId];
        periods = new uint32[](months.length);
        for (uint256 i = 0; i < months.length; ++i) {
            periods[i] = MonthLib.toYyyymm(months[i]);
        }
    }

    function observationOf(bytes32 seriesId, uint32 period)
        external
        view
        returns (Observation memory)
    {
        return _observations[seriesId][MonthLib.toIndex(period)];
    }

    function seriesOf(bytes32 seriesId) external view returns (SeriesTerms memory) {
        return _series[seriesId];
    }

    function policyOf(bytes32 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function activeExposureOf(bytes32 seriesId) external view returns (uint256) {
        return _series[seriesId].activeExposure;
    }

    function exposureCoveredOf(bytes32 seriesId) external view returns (uint256) {
        return _series[seriesId].exposureCovered;
    }

    function windowEndsAtOf(bytes32 seriesId) external view returns (uint64) {
        return _series[seriesId].windowEndsAt;
    }
}
