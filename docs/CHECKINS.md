# ETHGlobal check-in drafts

Appended daily by the status job. Root pastes the current entry into the dashboard on check-in days.

## 2026-09-04

We started at 16:38 UTC today and merged six pull requests by the evening. The monorepo and CI are up. The Hedera testnet resources exist: the accounts, the tUSD settlement token, the policy NFT collection and the HCS topics, all recorded in docs/HEDERA.md. CoverPool and CollateralVault are deployed and verified as Sourcify exact matches, with the claim path run on testnet. The Scheduled Transactions spike measured the 62 day expiry window and gave us a premium helper. The demo note series ODI-COMP-2026-01 is issued through the Asset Tokenization Studio factory with KYC, pause, freeze and a declared coupon, and every step is linked to HashScan in docs/ATS.md. Each place where the documentation and the network disagreed is written up in docs/harness-notes.md.

Next is paying that coupon to the two noteholders through a Scheduled Transaction from the premium account, maturity redemption, and the investor endpoints. After that the API lane takes the quote, bind, policy NFT and HCS receipt core, then the x402 gating through Blocky402 so the Steward can make a real paid request. The web lane returns to the design system scaffold and then the World Selfie Check flow.

Two branches are stuck in review rather than blocked on a partner. The index model reproduces the backtest exactly, but its pushed head is an unfinished checkpoint and needs a rebase and a typecheck fix. The web scaffold passes every check and needs a rebase and one disclosure. Both are ours to fix and they gate the API and web lanes. We have no partner blockers so far, and we have not yet touched Blocky402, World or Bazantic.
