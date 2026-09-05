// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only stand-in for the HTS settlement token, with the same six
/// decimals. `failTransfers` reproduces the one on-chain failure the local
/// network cannot: a transfer to an account that has not associated the token.
contract MockSettlementToken is ERC20 {
    uint8 private immutable _decimals;
    bool public failTransfers;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!failTransfers, "MockSettlementToken: transfer failed");
        super._update(from, to, value);
    }
}
