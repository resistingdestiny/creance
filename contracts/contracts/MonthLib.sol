// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Calendar month arithmetic for the loss and claim windows.
/// @notice Every window rule in this system is arithmetic on a month index,
/// `year * 12 + (month - 1)`, so that "two months before" is a subtraction and
/// never a date library. The boundary form is `YYYYMM`, which is what the HCS
/// observation message and the database carry.
///
/// The civil date conversions are the standard days-from-civil and
/// civil-from-days algorithms, which are exact for every date in range and
/// contain no loops.
library MonthLib {
    /// @dev The first month this library accepts. Unix time starts in 1970 and
    /// the conversions below assume a non-negative year, so anything earlier is
    /// rejected rather than wrapped.
    uint32 internal constant MIN_INDEX = 1970 * 12;

    uint64 internal constant SECONDS_PER_DAY = 86_400;

    error BadPeriod(uint32 yyyymm);
    error MonthOutOfRange(uint32 monthIndex);

    /// @notice `202604` becomes `24315`.
    function toIndex(uint32 yyyymm) internal pure returns (uint32) {
        uint32 year = yyyymm / 100;
        uint32 month = yyyymm % 100;
        if (month < 1 || month > 12 || year < 1970 || year > 9999) {
            revert BadPeriod(yyyymm);
        }
        return year * 12 + (month - 1);
    }

    /// @notice `24315` becomes `202604`.
    function toYyyymm(uint32 monthIndex) internal pure returns (uint32) {
        if (monthIndex < MIN_INDEX) revert MonthOutOfRange(monthIndex);
        return (monthIndex / 12) * 100 + (monthIndex % 12) + 1;
    }

    /// @notice The month index containing a unix timestamp in seconds.
    function monthIndexOf(uint64 timestamp) internal pure returns (uint32) {
        // civil-from-days, shifted so that the era starts on 1 March.
        int256 z = int256(uint256(timestamp / SECONDS_PER_DAY)) + 719468;
        int256 era = (z >= 0 ? z : z - 146096) / 146097;
        uint256 dayOfEra = uint256(z - era * 146097);
        uint256 yearOfEra =
            (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
        int256 year = int256(yearOfEra) + era * 400;
        uint256 dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
        uint256 shiftedMonth = (5 * dayOfYear + 2) / 153;
        uint256 month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
        if (month <= 2) year += 1;
        if (year < 1970) revert MonthOutOfRange(0);
        return uint32(uint256(year) * 12 + (month - 1));
    }

    /// @notice The first instant of a month, in unix seconds. The inverse of
    /// `monthIndexOf` at the month boundary.
    function startOfMonth(uint32 monthIndex) internal pure returns (uint64) {
        if (monthIndex < MIN_INDEX) revert MonthOutOfRange(monthIndex);
        uint256 year = monthIndex / 12;
        uint256 month = (monthIndex % 12) + 1;
        // days-from-civil for the first day of the month.
        uint256 shiftedYear = month <= 2 ? year - 1 : year;
        uint256 era = shiftedYear / 400;
        uint256 yearOfEra = shiftedYear - era * 400;
        uint256 shiftedMonth = month > 2 ? month - 3 : month + 9;
        uint256 dayOfYear = (153 * shiftedMonth + 2) / 5;
        uint256 dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
        uint256 daysSinceEpoch = era * 146097 + dayOfEra - 719468;
        return uint64(daysSinceEpoch * SECONDS_PER_DAY);
    }
}
