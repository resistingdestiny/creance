// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The HIP-719 facade every Hedera Token Service token exposes at its
/// own address. `associate` opts the calling account in to holding the token
/// and `isAssociated` reports whether the caller already has.
/// https://docs.hedera.com/hedera/core-concepts/smart-contracts/hedera-token-service-hts-system-contract
///
/// Both are caller scoped: there is no form that takes an account, so a
/// contract can only ask about itself.
interface IHRC719 {
    function associate() external returns (uint256 responseCode);

    function isAssociated() external view returns (bool);
}
