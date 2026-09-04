# Prize acceptance criteria

Copied from DESIGN.md section 5. Each line is a checkbox that must be true at submission. A line is ticked only when the evidence is in this repository or on testnet, and the evidence link follows the item. Lines that need a human step carry "Root pending" when T22 fills this in. The daily status job keeps this file current.

## Hedera: Tokenization of Anything

- [x] Note issued through ATS (SDK, web app, or both) on Hedera testnet; token address recorded. Evidence: note contract [0.0.10368240](https://hashscan.io/testnet/contract/0.0.10368240) at `0xBB14C072d2861B944C18e5f873C5aEa71c2F1f36`, [deploy transaction](https://hashscan.io/testnet/transaction/0x226d62fd0b562535baf1c027c8bd320df2b017326c56921328b6af27849ad398), recorded in [docs/HEDERA.md](HEDERA.md) under "The note" and in `series.ats` of `contracts/deployments/testnet.json`; run through in [docs/ATS.md](ATS.md); [PR #8](https://github.com/resistingdestiny/creance/pull/8).
- [x] CoverPool and CollateralVault verified on HashScan; ATS contracts deployed under our account verified where applicable. Evidence: CoverPool [0.0.10367199](https://hashscan.io/testnet/contract/0.0.10367199), [Sourcify exact match](https://sourcify.dev/server/repo-ui/296/0x6358ddd5AA2e1797ddA949D7d82eA86C9F89ff09); CollateralVault [0.0.10367194](https://hashscan.io/testnet/contract/0.0.10367194), [Sourcify exact match](https://sourcify.dev/server/repo-ui/296/0xD0473d355ECB299F2ECc0d92124bc8CF63554e60); [PR #4](https://github.com/resistingdestiny/creance/pull/4). The note is an unmodified ATS factory proxy dispatching to facets the ATS team deployed, so there is no source of ours to submit for it; its source is public at tag `v.8.0.0-ats` and its configuration is recorded field by field, see [docs/ATS.md](ATS.md) under "What verified on HashScan means for this note".
- [ ] Demo shows issuance, configuration (KYC list, transfer restriction, coupon schedule) and lifecycle operations: KYC grant, blocked then allowed transfer, coupon distribution, reserve on an open month, claim payout, reserve release, maturity redemption
- [ ] README section "Tokenization" with the exact steps a judge can repeat
- [ ] Video of five minutes or less (shared across the Hedera tracks)
- [ ] Extra points targeted: compliance controls in use; coupon distribution; oracle integration (the ODI); Scheduled Transactions for coupons; one stretch item (secondary market or upstream contribution)

## Hedera: AI and Agentic Payments

- [ ] Live x402-gated service on Hedera testnet (/index, /quote, /bind) settled through Blocky402
- [ ] Steward completes at least one real paid request end to end (index read, then bind with premium), with settlement transaction ids visible on HashScan
- [ ] README covers setup, architecture and the payment flow step by step
- [ ] Video shows the paid request executing
- [ ] Extra points targeted: per-call metered data feed; recurring premiums via Scheduled Transactions; payment and claims audit trail on HCS; the Adjuster agent's decision records on HCS; HTS token in the settlement path; optional HCS-14 identity; optional A2A capacity negotiation

## Hedera: Improve the Hedera Harness

- [ ] Open PR to hedera-dev/hedera-harness (or a new harness built on it) with a problem statement, how to run it, and tests or examples
- [ ] Before and after evidence of the developer experience gain in the PR description
- [ ] Clip in the video showing the improvement working

## World: Selfie Check

- [ ] Selfie Check (selfieCheckLegacy preset via IDKit) at purchase and at claim, used as eligibility, continuity and abuse-prevention signals; the claim check is bound to the proof of loss packet
- [ ] Proofs verified server-side against World's verify endpoint; one active policy per nullifier per series enforced and demonstrated
- [ ] All flows tested and demoed with the World ID Sandbox App
- [ ] docs/FEEDBACK-WORLD.md with the four required sections: Selfie Check docs and integration flow; Developer Portal navigation, search, product discovery and debugging guidance; Sandbox App states, proof flows, test users, errors and edge cases; what was confusing, missing, broken or hard to test
- [ ] Working app reachable by judges

## Bazantic: Best Recipe that uses Sponsor APIs

- [ ] Account on bazantic.com; username recorded in docs/SUBMISSION.md
- [ ] x402/MPP gateway in Bazantic for our API (import recipes/bazantic/openapi.yaml)
- [ ] Recipe "Buy displacement cover for my principal" using two services: the Hedera mirror node (read the latest index observation from the HCS topic) and our quote and bind gateway; the result depends on both
- [ ] Screen recording of the recipe running start to finish
- [ ] Recipe text committed under recipes/bazantic/

## ETHGlobal general

- [ ] Start Fresh: first commit on or after 4 September; continuous commit history; no single-day dumps
- [ ] Public repository, open-source licence, README that lets a judge run it in under fifteen minutes from a clean clone
- [ ] Showcase video of two to four minutes (a separate cut of the main video)
- [ ] Partner prizes selected on the submission form: Hedera, World, Bazantic
- [ ] Dashboard check-ins answered
