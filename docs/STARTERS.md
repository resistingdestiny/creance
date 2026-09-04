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

## The web app

Nothing. No starter kit, no scaffold and no sample code. `apps/web` was created
by hand from the framework's own documentation, and every component in
docs/DESIGN-TOKENS.md was built from the token sheet during the event.

## The Creance mark and its icon sizes

Not a starter and not code, listed so the disclosure is complete.
`apps/web/public/favicon.ico`, `icon-16.png`, `icon-32.png`, `icon-180.png`,
`icon-192.png` and `creance-mon.svg` were drawn before kick-off. They are the
browser icon and the metadata icons and nothing else: no screen renders them and
no layout depends on them.
