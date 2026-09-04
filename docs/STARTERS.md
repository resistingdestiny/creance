# Starters

Everything taken from outside this project, with the link and what was taken.
Nothing here is code from another project of ours; this build started from an
empty repository.

## OpenZeppelin Contracts 5.6.1

https://github.com/OpenZeppelin/openzeppelin-contracts

A dependency, not copied source. `CoverPool` and `CollateralVault` inherit
`AccessControl`, `Pausable`, `ReentrancyGuard` and `EIP712`, and use
`SafeERC20` and `ECDSA`. MIT licensed.

## The civil calendar conversions in contracts/contracts/MonthLib.sol

https://howardhinnant.github.io/date_algorithms.html

`monthIndexOf` and `startOfMonth` implement the published days-from-civil and
civil-from-days algorithms, which are the standard branch free, loop free way to
convert between a unix day count and a calendar date. The algorithms are taken
from that page and written in Solidity here; no source was copied. The page
places them in the public domain.
