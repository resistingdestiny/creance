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

T49 reversed the "landing page only" scope for the card's gradient, sheen, brushing and shimmer, which are now the product's material: see "The metal" below and docs/DECISIONS.md under T49. T52 took `night` to the header band on every route, and to nothing else: see "The chrome" below and docs/DECISIONS.md under T52. `night-2` and the one elevation stay as written here, and every worker and investor screen stays light below the header.

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


## Investor screen additions, T47 (desktop)

The coupon history moves above the series card, because what has been paid is
what an investor came to see. It opens with two rows in a surface group, in the
same register as the rows under Principal: "Earned to date", whose value is the
settled coupons paid to the account on screen and whose caption names that
account, and "Next payment", whose value is the date the next declared coupon
becomes payable and whose caption names the period it accrues over. Neither row
renders where there is nothing to say.

Each row of the table names the month the coupon accrued over rather than only
the day it was paid, so three settlements read as three periods. Where the
record dates were brought forward the screen says so, under the heading, at
`secondary` in `ink-2`.

The series chooser labels each series with the occupation it covers, from the
fifteen names in "Occupation picker correction". The identifier stays on screen
as the title of the series the choice opens.

## Copy deck additions, T47 (verbatim)

"Earned to date" / "Next payment" / "The record dates on these coupons were
brought forward so several months could be paid inside the demonstration. Every
payment below settled on Hedera testnet." / "Maturity demonstration" / table
columns: Period, Noteholder, State, Amount, Receipt

"Next payment" is the Home block's own string from docs/DESIGN-TOKENS.md section
8, reused here. Its value on this screen is a date alone, not "28.00 on 4
October": the note reports no entitlement for a coupon whose record date has not
been reached, so an amount there would have to be invented.

## The metal (T49)

The metal is the card's material, promoted from the landing page to the whole
product: the four stop gradient of docs/DESIGN-TOKENS.md section 4, its
diagonal sheen, the hero brushing, and the rainbow shimmer T34 added. In the
code it is `.cover-card` with the `metal` finish of `CoverCard` and
`CoverCardShell`. There is one implementation and every surface below is a
caller of it.

The card looks expensive because it is rare, so this is a promotion with
rules, not a licence.

What it may carry: identity and value. The cover card, the note or certificate
an investor holds, and a headline figure. Today that is the landing hero, the
card on Home, the note certificate on the investor screen, which carries
"Earned to date" and the "Next payment" row, and the payout on the approved
claim screen.

What it may not carry: ordinary content. List rows, form fields, tables,
navigation, body copy, and any error, declined, under review or waiting state.
A failure state is not the place for a moving light. The coupon history stays a
table and the series terms stay rows in a surface group.

How it reads (T52). Machined, not iridescent. The edge is a deeper, cooler
grey (#b3bac4) and the card's thickness behind the face is darker still, so
the object has an edge before it has a colour. The shimmer is a reflection
and not a fill: a white core at 55 percent with the five pale hues fringing
it at 20 percent, across a fifth of the width T34 gave it, so the base
gradient's silver is what most of the face shows and the rainbow is the light
crossing it. The base gradient, the sheen and the brushing are the sheet's own
and are unchanged. With the animation off, the band stands at the centre of
the card, which is how a still frame and a reduced motion reader see it.

At landing size the occupation label and the "Cover" caption step up one
size, to body-lg and body (T52): a 14px label wrapping over two lines in the
corner of a 720px card left the face reading as empty. Every other card keeps
the sheet's secondary size.

The budget: at most one shimmering element in view at a time. The shimmer is
the accent and the accent is singular. The finish has two variants so that the
budget can be kept: `metal="shimmer"` carries the moving band, and a screen
passes it to exactly one component; `metal="still"` is the same edge and the
same sheen with no moving band, for any second metal object. Tests count the
band on every screen that carries it: apps/web/test/shimmer-budget.test.tsx for
Home and the claim, investor.test.tsx for the note, landing.test.tsx for the
hero.

Text never sits on a moving light. Every light layer on the card, the sheen,
the brushing, the glare and the shimmer, stays under `.cover-card__content`,
which is where every word and figure on the card goes. Nothing on the card is
ever coloured ink-2: the card's own rule turns it to ink, because the darkest
stop of any treatment fails the 4.5:1 floor for ink-2 and passes it for ink by
three times over.

The contrast floor, 4.5:1, holds across the whole shimmer cycle and not only at
rest. Every stop of the shimmer is a pale hue at 16 percent, so the composite
over the darkest stop of any treatment is lighter than the metal beneath it.
built-css.test.ts computes the worst case from the compiled stylesheet, above
12:1 for ink, and fails the build if a stop is darkened. A new metal surface
with a darker stop is added to that test; a colour other than ink on the metal
is composited there too.

Reduced motion: under `prefers-reduced-motion: reduce` the shimmer stops dead
and the card keeps its colour with the light standing still, the glare and the
turn stop, and the page is complete and legible, which is also how it looks in
a still screenshot. The shimmer also pauses, with `animation-play-state`, while
the card is out of the viewport, while the tab is hidden, and on the face of
the landing card that is turned away, so a nine second loop is never running
where nobody can see it. It animates transform only.

No scroll triggered reveals, anywhere, for the reason above: they read as
flicker on data dense pages and as rendering glitches in a screen recording.

The night grounds and the one elevation are not part of the metal and stay
marketing only. Light mode remains the product's mode.

## The chrome (T50)

The product has one header and one footer, `SiteHeader` and `SiteFooter` in
`src/components/site-chrome.tsx`, and every screen wears them: the landing,
the public explorer, every worker screen through `AppFrame` and every investor
screen through `DesktopFrame`. Nothing else may draw a header or a footer, and
nothing may draw a second wordmark.

The header carries the wordmark as a link to the front door, "The index" to
`/index` and "Investors" to `/invest`, hidden below the medium breakpoint as
the landing's navigation already hid them, and one action: "Get a quote", on
every route (T52). On the landing it is the quote button, which opens the
quote where the hero card stands; everywhere else it is a link to the front
door with the same words, in the same night primary pill. The explorer's
"Get cover" and the empty slot on the worker and investor screens went with
T52: one header means one label. The footer carries the wordmark, "How the
index works" and "Investors", and DESIGN.md's disclosure line. The footer is
rendered by the root layout once; the header is rendered by each frame,
because on the landing its action is the quote button and that button needs
the quote's own provider.

One tone (T52). The header band is `night` on every route, with the
addendum's text rules for that ground, and it is the only thing outside the
landing that is. T50 drew it in two tones, night on the landing and day on
canvas everywhere else, and the built site still read as three headers. The
content under the band is unchanged: every worker and investor screen is
light, on canvas and surface, and `night-2` and the elevation are still the
landing's alone.

The focus outline reads its colour off the ground (T52). The sheet's outline
is 2px solid black with a 2px offset everywhere; inside an element carrying
`data-tone="night"`, which the header carries, the same outline is white,
because black is invisible there and the header is now on every route. Width
and offset do not change; only the colour does. The landing's own night bands
do not carry it: their controls are the night pills, whose white fill is
visible against the ground, and the quote's steps stand on the card's light
face, where black is right.

The height is a token, `--spacing-chrome`, 72px: the 56px pill with 8px either
side, which is the height the landing's navigation already stood at. The worker
screens measure their column against the viewport with the header above it, so
`min-h-frame` in globals.css is `100dvh` less that token, and it replaces
`min-h-dvh` on every worker screen. A second header height is not to be
invented; change the token.

The margins are one set, `px-5 lg:px-10`, 20 at 390 and 40 from the landing
breakpoint, inside a centred 1280 frame (`CHROME_FRAME`), which is the desktop
app frame of docs/DESIGN-TOKENS.md section 3. The header, the footer, the explorer,
the investor sheet and the landing's hero all start on that line, so the
wordmark and the first heading under it are flush at every width. The landing's
64px web page margin is retired with this: it was the margin of a standalone
page, and the landing is a page of the product now.

The ground under the header depends on the frame (T52). The worker column
stands on `surface`, as a canvas sheet with hairline sides (`sm:border-x`),
because beside a 390 column at 1440 the ground is most of the screen and is
what stops the column reading as a bare column on white. The desktop pages,
the explorer and the investor screens, stand on continuous canvas from the
header to the footer with no sheet and no side hairlines: T50's 1280 sheet
with `xl:border-x` on surface left 80px of grey either side of a bordered box
at 1440, and read as a card floating in a browser rather than as an
application. The 1280 frame is a measure for the content there, exactly as it
is for the header. Depth is ground colour and hairline, as section 1 of the
sheet says; no shadow. At 390 either frame is the viewport. The landing keeps
its own grounds: the night ground of the header carried on through the main,
with the light sections between the hero and the closing line laid on it as
one canvas sheet with rounded corners, the sheet radius (20) at 390 and the
hero card's (32) from the landing breakpoint, so the boundary between the two
grounds is a drawn edge and never a seam.

## Copy deck additions, T50 (verbatim)

"See an example of cover"

The hero's way in to `/home/demo`, in the night secondary pill beside "Get a
quote", rendered only when `demonstrationOn()` is true. The sign in screen's
link to the same place reads "See a live cover" and keeps that string; the
landing's footer bar, which carried that link too, went with the shared footer.
The hero's says what it opens is an example, which is Root's wording.

## The hero (T52)

The from price is a figure, not a footnote. It stands between the lead and the
hero actions, "From 1.51 a month" at the headline scale in white, with what it
buys under it at body-lg in the addendum's secondary opacity: "for 1,000 of
cover", the cover the quote was asked for, built by src/lib/landing-model.ts
from that amount and never typed. The line was body type at the secondary
opacity under the buttons, which is how a footnote is drawn, and it is the most
persuasive fact on the page. When no quote could be taken both lines are absent
and no space is kept for them, as before.

The occupation picker on the explorer, which the landing carries too, is one
row naming the occupation on screen with a chooser under it: the search box
and the fifteen occupations as buttons, hidden until the row is opened. The
series chooser on the investor screens is the same shape as a native
disclosure with the series as links. Neither page opens with a wall of pills.

The investor overview leads with what the series covers and carries the
identifier under it in tabular figures. From the landing breakpoint the
certificate and the series terms share the first row, the coupon table takes
the full width under them, and the principal at risk closes the page with its
bar across the whole measure. "Series terms" is a visible heading beside
"Coupon history".

## Copy deck additions, T52 (verbatim)

"for 1,000 of cover"

The second line of the hero's from price, with the figure interpolated from
the cover the quote was taken for, in the explorer's own wording ("Monthly
premium for 5,000 of cover"). It is a figure, not copy, and it is counted with
the price and not against the landing's word budget: it is built the same way
on every render of the page.

