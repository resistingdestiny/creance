// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only stand-in for an Asset Tokenization Studio bond, with the
/// one behaviour NoteMarket depends on: a transfer is refused unless both
/// parties hold KYC on this note, and that check runs **before** the allowance
/// check, which is the order `ERC1594StorageWrapper.isAbleToTransferFromByPartition`
/// uses on the real thing. The error name is ATS's own, so a local test and a
/// testnet run read the same word back.
///
/// Nothing else of ATS is imitated. Partitions, the SSI issuer registry, the
/// credential and the coupon facet are all absent, because a market never
/// touches them.
contract MockCompliantNote is ERC20 {
    uint8 private immutable _decimals;

    mapping(address holder => bool) public kyc;

    error InvalidKycStatus(address account);

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function grantKyc(address account) external {
        kyc[account] = true;
    }

    function revokeKyc(address account) external {
        kyc[account] = false;
    }

    /// @dev Issuance is the only way units come into being here, and it needs
    /// KYC exactly as `issueByPartition` does.
    function issue(address to, uint256 amount) external {
        if (!kyc[to]) revert InvalidKycStatus(to);
        _mint(to, amount);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        _requireCompliant(_msgSender(), to);
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value)
        public
        override
        returns (bool)
    {
        _requireCompliant(from, to);
        return super.transferFrom(from, to, value);
    }

    function _requireCompliant(address from, address to) private view {
        if (!kyc[from]) revert InvalidKycStatus(from);
        if (!kyc[to]) revert InvalidKycStatus(to);
    }
}
