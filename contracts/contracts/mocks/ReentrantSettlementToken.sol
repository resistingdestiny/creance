// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only token that calls back into a target during a transfer, so
/// the reentrancy guard on the claim path is exercised rather than assumed.
contract ReentrantSettlementToken is ERC20 {
    address public target;
    bytes public payload;
    bool private _entered;

    constructor() ERC20("Reentrant", "RNT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && !_entered) {
            _entered = true;
            // Bubble the revert up so the test sees the guard, not a swallowed
            // failure.
            (bool ok, bytes memory reason) = target.call(payload);
            _entered = false;
            if (!ok) {
                assembly {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
        }
    }
}
