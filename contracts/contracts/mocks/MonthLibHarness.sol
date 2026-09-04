// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MonthLib} from "../MonthLib.sol";

/// @notice Test-only wrapper so the pure library can be called from a test.
contract MonthLibHarness {
    function toIndex(uint32 yyyymm) external pure returns (uint32) {
        return MonthLib.toIndex(yyyymm);
    }

    function toYyyymm(uint32 monthIndex) external pure returns (uint32) {
        return MonthLib.toYyyymm(monthIndex);
    }

    function monthIndexOf(uint64 timestamp) external pure returns (uint32) {
        return MonthLib.monthIndexOf(timestamp);
    }

    function startOfMonth(uint32 monthIndex) external pure returns (uint64) {
        return MonthLib.startOfMonth(monthIndex);
    }
}
