// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The part of an Asset Tokenization Studio bond that a market needs.
///
/// It is three functions of the Transfer facet, which is the ERC-20 shaped
/// surface the ATS resolver dispatches for a single partition security. The
/// full interface is IAsset in the published ATS contracts package, a union
/// over every facet, and it
/// is not imported here: this build compiles nothing of ATS, and a market that
/// declared the whole surface would imply it understood more of the note than
/// it uses.
///
/// `transferFrom` on an ATS bond is not a plain ERC-20 transfer. It runs the
/// note's compliance checks on both parties first, so it reverts for a holder
/// without KYC before it touches the allowance. That is the behaviour
/// NoteMarket depends on and does not reimplement.
interface IAtsNote {
    function transferFrom(address from, address to, uint256 value) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);
}
