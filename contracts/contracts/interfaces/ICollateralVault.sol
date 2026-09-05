// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The part of CollateralVault that CoverPool depends on.
interface ICollateralVault {
    function reserve(bytes32 seriesId, uint256 amount) external;

    function release(bytes32 seriesId, uint256 amount) external;

    function payClaim(bytes32 seriesId, address payee, uint256 amount) external;

    function principalRemaining(bytes32 seriesId) external view returns (uint256);

    function principalFree(bytes32 seriesId) external view returns (uint256);

    function reservedOf(bytes32 seriesId) external view returns (uint256);
}
