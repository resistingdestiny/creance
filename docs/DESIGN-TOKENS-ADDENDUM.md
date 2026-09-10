# Design tokens addendum: the claim flow

docs/DESIGN-TOKENS.md was produced before the trigger became two keys (DESIGN.md 3.9). This addendum replaces its "Triggered" screen and adds the claim screens. Same tokens, same components, same voice. Where the two documents disagree, this one wins.

House style note: docs/DESIGN-TOKENS.md is the design tool's export and contains em and en dashes in its own prose and copy strings. When lifting copy or writing new strings, apply CLAUDE.md's rule: no em or en dashes anywhere in the product; use a comma, a colon, or the word "to" for ranges (56 to 60). Tokens, measurements and CSS are unaffected.

## Replaced state: Home, claims open

The card status pill is amber "Claims open", not red "Paid out". The index row reads "2.3, above 2.0". Under the group a single line: "If you lost your job on or after 4 June, you can claim 5,000." Primary: "Start a claim". The red "Paid out" pill now appears only after a claim is paid.

If the person opens the claim flow while the index is below attachment, show one calm screen: "Claims aren't open." / "The index for your occupation is 1.1. Claims open above 2.0. We'll tell you here if that changes." / "Back to cover".

## New screens (mobile, 390 wide)

C1 Before you start. Plain list of what is covered and what is not, then the primary. Copy: "What cover pays for" / "Laid off, made redundant, your position eliminated, your workplace closed." / "What it doesn't pay for" / "Resigning, dismissal for misconduct, the end of a fixed-term contract, self-employed work drying up, or losing your job in the first 60 days of cover." / "Start a claim".

C2 Your job. Form fields: Employer; Job title; Last day of work (date); How did it end? (single select: "Laid off or made redundant", "Position eliminated or workplace closed", "Dismissed", "I resigned", "My contract ended"). Choosing an excluded reason shows an inline line in `triggered` under the field: "Cover doesn't pay for this. You can still submit and a person will look at it." Primary: "Continue".

C3 Add proof. Copy: "Add proof" / "One of these is enough:" / list: "A termination or redundancy letter", "An unemployment benefit decision", "A final pay statement showing the end date", "A P45 or Record of Employment" / upload area with a hairline border, radius 12, label "Add a file" / after upload a list row per file with the file name and a black check / footer line in `ink-2`: "We keep your documents private. Only a fingerprint of each file goes on the public record." Primary: "Continue".

C4 Confirm it's you. Same layout as the purchase Verify screen. Copy: "Confirm it's you." / "The same person who bought the cover has to claim it." / "Verify with World ID" / states "Waiting for the World app", "You're verified", "We couldn't verify you." "Try again, or use a different device."

C5 Review and submit. Surface group with rows: Employer; Job title; Last day of work; How it ended; Proof (n files); Payout "5,000". A checkbox row (28 px square, black check): "Everything here is true. I understand that a false claim is fraud." Primary, disabled until checked: "Submit claim".

C6 Claim received. Mostly empty screen. "Claim received." / "Most claims are decided in minutes. You'll see the answer here." / secondary "Back to cover". The decision replaces this screen when it arrives; the card status pill reads "Claim in progress" (amber) meanwhile.

C7 Approved. "Approved." / display number "5,000" / "On its way to your wallet." then the existing Paid state: card pill red "Paid out", row "5,000 received" with the date and "View receipt".

C8 Under review. "A person is checking your claim." / "Usually within one working day. There's nothing you need to do." / rows: Submitted (date); Reference (short id). Secondary: "Back to cover".

C9 Declined. "We can't pay this claim." / reasons as plain sentences, one per line, from the decision record, for example: "Your last day of work, 12 May, is before your cover started paying out on 4 June." or "Resigning isn't covered." / then "What you can do" / one or two lines: "If you have a document that shows a different end date, add it and submit again." / primary "Submit again" / secondary "Back to cover".

## Investor screen additions (desktop)

In the series card add two rows under Principal: "Reserved for claims" and "Paid to policyholders". The principal-at-risk bar shows three segments in this order: paid (ink), reserved (hairline-bordered white with a diagonal hatch in `hairline`), intact (surface). Copy under the bar: "100,000 principal. 15,000 reserved while claims are open. 5,000 paid so far."

## Admin review queue (desktop, internal)

A plain table: reference, policy, occupation, last day of work, how it ended, evidence fingerprints, the Adjuster's reasons in one column, confidence, and two pill buttons per row, "Approve" (black) and "Decline" (white, hairline). Declining opens a sheet that asks for one plain sentence to show the person. This screen is not part of the consumer design language review; it just has to be legible.

## Occupation picker correction

The purchase flow's occupation list is fifteen rows, not eleven, and there is no Armed forces row. Order: Office and administrative support; Computer and mathematical; Management, business and financial; Professional and related; Business and financial operations; Legal; Arts, design, entertainment and media; Education, training and library; Sales and related; Service; Production; Transportation and material moving; Installation, maintenance and repair; Construction and extraction; Farming, fishing and forestry. Detailed groups render exactly like majors; no section headers.

## Index screen, second explanation block

Under the existing three sentences on how the index is computed, add two in the same voice: "Claims open in two ways. A sudden jump past this occupation's trigger line, or staying worse than anything in the decade before AI." When an occupation's line is negative, the caption under the chart reads: "People in this occupation are usually unemployed less than average. The trigger is about getting worse than their own normal, not about being above zero." Where the backtest shows a series has never opened, the screen says so: "This cover has never paid for this occupation since 2010."

## Copy deck additions (verbatim)

"Claims open" / "Claim in progress" / "Claims aren't open." / "The index for your occupation is 1.1. Claims open above 2.0. We'll tell you here if that changes." / "If you lost your job on or after 4 June, you can claim 5,000." / "Start a claim" / "What cover pays for" / "Laid off, made redundant, your position eliminated, your workplace closed." / "What it doesn't pay for" / "Resigning, dismissal for misconduct, the end of a fixed-term contract, self-employed work drying up, or losing your job in the first 60 days of cover." / "Your job" / "Employer" / "Job title" / "Last day of work" / "How did it end?" / "Laid off or made redundant" / "Position eliminated or workplace closed" / "Dismissed" / "I resigned" / "My contract ended" / "Cover doesn't pay for this. You can still submit and a person will look at it." / "Add proof" / "One of these is enough:" / "A termination or redundancy letter" / "An unemployment benefit decision" / "A final pay statement showing the end date" / "A P45 or Record of Employment" / "Add a file" / "We keep your documents private. Only a fingerprint of each file goes on the public record." / "Confirm it's you." / "The same person who bought the cover has to claim it." / "Review your claim" / "Everything here is true. I understand that a false claim is fraud." / "Submit claim" / "Claim received." / "Most claims are decided in minutes. You'll see the answer here." / "Approved." / "On its way to your wallet." / "A person is checking your claim." / "Usually within one working day. There's nothing you need to do." / "We can't pay this claim." / "What you can do" / "If you have a document that shows a different end date, add it and submit again." / "Submit again" / "Reserved for claims" / "Paid to policyholders"

Dates, amounts, the attachment level and the waiting period are interpolated from series and policy config, never hard-coded in copy.

## Payment step: how do you want to pay?

Above the "Confirm your cover" rows, on the route and on the landing card alike. A heading at body-lg in `ink`, then two options as a radio group with a hairline between them, then the notes in `caption` and `ink-2`.

Each option is a row: the title at body in `ink`, a caption line under it, and a black check on the selected one. The recommended option carries a pill beside its title, hairline bordered, `caption` in `ink-2`, reading "Recommended". Once a wallet is connected its account id appears as a third line on that option, `caption`, `ink-2`, tabular.

Copy: "How do you want to pay?" / "Your own wallet" / "Recommended" / "The cover is held in your wallet. The monthly payment is still settled by us." / "Demo wallet" / "A Hedera testnet account we hold the key for. Nothing to install." / "Waiting for your wallet"

Under the group, two lines in `caption` and `ink-2`: "Changing this asks you to confirm you're a real person again, because the check is tied to the wallet that holds the cover." then "World App holds your ID, Hedera holds the money."

On a deployment with no WalletConnect project id the wallet option is present and not selectable, and the first of those two lines is replaced by: "This deployment has no WalletConnect project id, so only the demo wallet can be offered."

A connection that does not happen puts one line in `triggered` at `secondary` under the group, and the demo wallet stays selected. The two: "The wallet did not approve the connection." and "That wallet is not on Hedera testnet. Switch it to testnet and connect again."

The wallet option's second line is the whole point of the screen and may not be softened. The cover is held in the person's wallet; the monthly payment is not. When the payment authorisation moves to the wallet, that sentence changes and not before.

## Confirm your cover: the sixth row

Five rows on the demo path, exactly as docs/DESIGN-TOKENS.md section 8 has them. With a wallet connected a sixth appears between "First payment today" and "Pays from": label "Cover held in", value the account id, caption "Your own wallet. Hedera testnet.". The "Pays from" row keeps its place and its account and its caption becomes "Settled by the service. Testnet only." rather than "Demo wallet. Testnet only.".

Two rows because two accounts. One row captioned as the person's own wallet would say something untrue about where the money came from.

When the connected wallet will not accept the policy NFT, one line at `secondary` in `ink-2` under the line above the button: "Your wallet doesn't accept new tokens, so the cover receipt can't be sent to it. The cover itself is unaffected." It is a warning and not a block: the cover binds either way and only the receipt is missing.

## Copy deck additions, T43 (verbatim)

"How do you want to pay?" / "Your own wallet" / "Recommended" / "The cover is held in your wallet. The monthly payment is still settled by us." / "Demo wallet" / "A Hedera testnet account we hold the key for. Nothing to install." / "Waiting for your wallet" / "Changing this asks you to confirm you're a real person again, because the check is tied to the wallet that holds the cover." / "World App holds your ID, Hedera holds the money." / "This deployment has no WalletConnect project id, so only the demo wallet can be offered." / "The wallet did not approve the connection." / "That wallet is not on Hedera testnet. Switch it to testnet and connect again." / "Cover held in" / "Your own wallet. Hedera testnet." / "Settled by the service. Testnet only." / "Your wallet doesn't accept new tokens, so the cover receipt can't be sent to it. The cover itself is unaffected."

## If Claude Design should render these

Paste this into the same Claude Design session, direction 1a: "Add nine mobile screens for the claim flow and one desktop addition, in the shipped direction, same tokens and components. The trigger now has two keys: the index opens claims for an occupation, and the person proves they lost their job. Replace the Triggered Home state with a Claims open state (amber pill). Screens: Before you start, Your job, Add proof, Confirm it's you, Review and submit, Claim received, Approved, Under review, Declined. Investor screen gains reserved and paid rows and a three-segment principal bar. Copy is verbatim from the addendum below; do not rewrite it." Then paste the screens and copy sections above.

## Marketing surface tokens (landing page only)

Decided before kick-off. These two tokens exist for the landing page and the closing band on it. They are not available to any worker or investor screen, which stay light mode with hairline depth exactly as docs/DESIGN-TOKENS.md specifies.

```js
night:   '#0A0D12',  // marketing ground
night-2: '#11151C',  // marketing raised ground
```

```css
/* the single permitted elevation, landing hero card only */
--elevation-hero: 0 40px 80px -32px rgba(0,0,0,.55);
```

Rules that come with them. On the dark ground, body text is `rgba(255,255,255,.66)` and headings are pure white; the state colours are unchanged and still mean only what they mean. The card gradient, its sheen and its brushing are unchanged; every light layer sits beneath the card's content, never over the numbers. Motion on the landing page follows the sheet: on user action, plus one orchestrated moment on load. Scroll triggered reveal animations are not used anywhere, because they read as flicker on data dense pages and as rendering glitches in a screen recording, and the demo is a screen recording.

The three step titles on the landing page ("Pick your occupation", "Confirm you're a real person", "Pay monthly") are provisional. They were written in the deck's voice because the original landing file was not available. Replace them if the original wording surfaces.

