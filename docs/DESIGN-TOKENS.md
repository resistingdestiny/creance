# Creance, engineering handoff

Direction 1a (wallet card). Next.js + Tailwind. Light mode only. Screens of record: `Full Set 1a.dc.html`, `Web 1a.dc.html`, `Landing v2.dc.html`.

## 1. Colour tokens

```js
// tailwind.config.js → theme.extend.colors
colors: {
  canvas:    '#FFFFFF', // page background
  surface:   '#F4F5F7', // grouped sections, sheets, form fills
  hairline:  '#E4E6EA', // all separation and depth, always 1px
  ink:       '#000000', // text, primary actions
  'ink-2':   '#6B6F76', // secondary text, labels
  'ink-3':   '#A3A7AE', // placeholder, disabled, axis labels
  covered:   '#0B8A4E', // state only: money in, active cover, paid
  watch:     '#C77A00', // state only: index rising, payment due
  triggered: '#D13B3B', // state only: trigger fired, lapsed, failed
}
```

Rules: no brand accent. Green/amber/red appear only when they carry state, never as decoration. No drop shadows anywhere — depth is hairline + grouping. Contrast floor 4.5:1 (ink-2 on canvas and surface passes; ink-3 is never used for essential text).

## 2. Type

Option A (shipped in the mocks): **Inter Tight** for display + numbers, **Inter** for text.
Option B: **Geist** for everything (or General Sans). Pick one option and commit.

```css
--font-display: 'Inter Tight', 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif;
--font-text:    'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif;
/* Option B */
--font-all:     'Geist', 'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif;
```

Scale (size/line-height, weight, letter-spacing):

| role       | size/lh  | weight | tracking  | use                          |
|------------|----------|--------|-----------|------------------------------|
| display-xl | 64/68    | 600    | -0.02em   | hero amount, index reading   |
| display-l  | 56/60    | 600    | -0.02em   | card amount (mobile)         |
| headline   | 36/40    | 600    | -0.015em  | start screen                 |
| title      | 26/32    | 600    | -0.01em   | screen titles                |
| body-lg    | 18/24    | 500    | 0         | sheet titles, field values   |
| body       | 16/24    | 400    | 0         | rows, links, values          |
| button     | 17/22    | 500    | 0         | pill labels                  |
| secondary  | 14/20    | 400    | 0         | labels, helper lines         |
| caption    | 13/18    | 400    | 0         | floor — nothing smaller      |

Landing (web) adds: hero 104/1.02 600 -0.035em, section head 44/1.15 600 -0.02em, ledger line 56 600 -0.025em, step numeral 72 600 -0.03em in `#C9CDD4`.

`font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) everywhere a figure appears — amounts, dates, readings, wallet addresses. Sentence case throughout; no all caps.

## 3. Spacing, radii, hairlines

- 8px grid: 4 8 12 16 20 24 32 40 48. Side margins: 20 (mobile), 64 (web page), 40 (desktop app frames).
- Row height 52 mobile / 48–52 desktop; tap targets ≥ 44px.
- Radii: group 16, card 20 (32 on the landing hero card), sheet 20 top corners, field 12, pill 999.
- Hairlines: `1px solid #E4E6EA`. Separators run inside groups, inset 16px from group edges (`divide-y divide-hairline` inside `px-4`).

## 4. The card gradient (signature element)

```css
.cover-card {
  border: 1px solid #E4E6EA;            /* #DDE0E5 at landing size */
  border-radius: 20px;                   /* 32px on landing */
  background: linear-gradient(118deg,
    #FDFDFE 0%, #E9EBEF 36%, #F7F8FA 58%, #DFE2E7 100%);
  overflow: hidden;
  position: relative;
}
/* diagonal sheen */
.cover-card::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(118deg,
    transparent 40%, rgba(255,255,255,.85) 48%, transparent 58%);
}
/* landing size only: brushing + inner edge light */
.cover-card--hero::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  border-radius: inherit;
  border: 1px solid rgba(255,255,255,.85);
  background: repeating-linear-gradient(118deg,
    rgba(255,255,255,.35) 0 1px, transparent 1px 5px);
}
```

Card anatomy: occupation top-left (14/500, max-w ~190px), status pill top-right, "Cover" label + amount bottom-left (display-l, tabular). Status pill: `bg-white/78 border border-hairline rounded-full px-2.5 py-[5px] text-[13px] font-medium` with a 6px dot in the state colour.

## 5. Chart rules (index line)

- Line: `#000`, 1.25px small / 1.5px large / 1.75px landing, round joins and caps. No area fill, no dots, no gridlines, no legend.
- Trigger band: from attachment (2.0) upward — `rgba(209,59,59,0.06–0.07)` fill with a 1px `rgba(209,59,59,0.4–0.45)` line on its lower edge.
- Axis labels: max two (start date, end date), 13–14px `ink-3`; the band label "Pays out above 2.0" in `triggered` sits between them.
- Small (Home row): 64×20, no band unless triggered state.
- Large (Index screen): full content width, 24 months, ~180px tall mobile / 300px web.
- Triggered state: the line enters the band; current reading renders in `triggered`.

## 6. Motion

- Everything on user action: 200ms ease-out (sheets, state changes, slider value).
- One orchestrated moment, once, after payment confirm: card slides up into Home (420ms ease-out) while the amount counts up (600ms).
- `@media (prefers-reduced-motion: reduce)`: replace both with instant state change.
- No entrance-on-scroll animations, no hover effects beyond link colour and button opacity.

## 7. Components (states in `Full Set 1a.dc.html`)

- **Pill button** — primary: h-56 black/white text 17/500, label names the outcome ("Pay 28.00"); secondary: white + hairline border; disabled: `bg-surface text-ink-3`; loading: label swaps to a 6px pulsing dot row, width unchanged.
- **Text link** — 16px underline, offset 3px, ≥44px hit area.
- **List row** — label 14 `ink-2` left, value 16 `ink` right; optional chevron/check (black, 2px stroke); min-h 52.
- **Surface group** — `bg-surface rounded-2xl px-4`, hairline separators between rows.
- **Bottom sheet** — white, top radius 20, grabber 36×4 `hairline`, scrim `rgba(0,0,0,0.32)`.
- **Display number** — tabular, tight tracking; counts up only in the orchestrated moment.
- **Amount slider** — track 3px (`hairline` / filled `ink`), thumb 28px black circle; range 1,000–10,000 step 500.
- **Status pill** — covered/watch/triggered dot + label, white ground.
- **Tab bar** — 2 tabs only (Cover, Index), h-80 with hairline top; active `ink`, inactive `ink-3`.
- **Toast / failure sheet** — states in screens 09.
- **Form field** — h-52, radius 12, hairline border, 16–18px value; focus: 2px black ring.
- **Table row** — date left, state + amount right, 48px, hairline bottom.

Focus states: `outline: 2px solid #000; outline-offset: 2px` on all interactive elements.

## 8. Copy deck (verbatim strings)

Start: "Cover for the day your job is automated." / "A monthly payment now. A payout if your occupation is displaced." / "Get a quote" / "I want to invest"
Occupation: "What do you do?" / "Search occupations" / the occupation group names as listed in docs/DESIGN-TOKENS-ADDENDUM.md, "Occupation picker correction": fifteen rows, in that order, with no Armed forces row.
Amount: "Cover amount" / "28.00 a month" / "Pays out if the index for Office and administrative support rises 2 points above its trend. Full payout at 4 points." / "How the index works" / "Continue"
Verify: "Confirm you're a real person." / "One person, one cover. This stops bots and duplicate accounts." / "Verify with World ID" / "Waiting for the World app" / "You're verified" / "We couldn't verify you." "Try again, or use a different device." / "Try again" / "That check isn't the one we asked for." "Open the World app and run the face check."
Pay sheet: "Confirm your cover" / rows: Cover · Occupation · Monthly payment · First payment today · Pays from / "Pay 28.00"
Home: "Cover" / "Covered" / "Next payment" "28.00 on 4 October" / "Index" "1.1, steady" / "See the index"
Index: "steady" / "It counts unemployment in your occupation, compared with everyone else's." / "It is smoothed over three months, so one bad month does not move it." / "It is compared with a year ago, so it shows change, not level." / "What would have happened" / "No payout" / "Paid out" / "Pays out above 2.0"
Triggered (superseded by docs/DESIGN-TOKENS-ADDENDUM.md, which replaces this state with the two-key claim flow; the strings below stay for the paid state that follows a paid claim): "Paid out" / "Payout" "2,500" / "Share of cover" "50 percent" / "Verify to receive it. You have 30 days." / "Verify and receive" / "2,500 received" / "View receipt"
Lapsed: "Payment due" / "Pay by 19 October to stay covered." / "Pay 28.00"
Payment failed: "Your payment didn't go through." / "Check that your wallet has at least 28.00, then try again. Your cover is unchanged until 19 October."
Offline: "You're offline." / "Your cover is unchanged. We'll update the index when you're back online." / "Retry"
Investor: "KYC approved" / "Verification needed" / "ODI-OFFICE-2026-01" / "Principal" / "Coupon" "8 percent a year, paid monthly" / "Term" "12 months" / "Matures" "4 September 2027" / "Capacity used" "45 percent" / "Subscribe" / "Principal at risk" / "Currently 100,000 — 100 percent intact" / "92,500 if triggered" / "Coupon history" / "You earn coupons from premiums. If the index for this occupation is triggered, part of your principal pays out to policyholders. Anything left is returned at maturity." / "Subscribe 25,000" / "You're subscribed" / "First coupon" / "View the series"
Replay badge: "Replay: Jul 2026"
Landing: "Index live, updated monthly from public data" / "Showing the last reading we published" / "Cover for the day your job is automated." / "A monthly payment now. A payout if your occupation is displaced." / "Get a quote" / "From 28.00 a month" / "When does it pay." "When the index for your occupation rises 2 points above its trend. Full payout at 4." / "One number decides. You can watch it." / "The quiet kind of ready." / "I want to invest" / "Investors fund the cover and earn 8 percent a year, paid monthly." / "How the index works"

Verify has two failures, not one, because they need different answers (T42). "We couldn't verify you." with "Try again, or use a different device." stays the default, for a check that was made and did not pass. "That check isn't the one we asked for." with "Open the World app and run the face check." is for a check of a kind this deployment does not accept, where the same device answers with the same kind every time and the default line sends a person to do the one thing that cannot work. Its button is "Verify with World ID", not "Try again", because what it asks for is a different check rather than the same one again. Inside World App the second line reads "Run the face check to continue.", for the reason the default failure drops its second half there: there is no other app to open.

Cut from the landing and not to be written again, because the page shows each of them instead: "Two minutes, start to covered." with its three steps, and "Unemployment in your occupation, compared with everyone, smoothed over three months, compared with a year ago. No adjuster, no claim forms." (T34, the quote and the explorer are on the page); "What does it cost." with "From 28.00 a month. The price comes from your occupation's index, nothing else.", and "Am I covered." with "Your card says so at all times. Green means yes." (T44, the hero prints the from price and the hero card wears the Covered pill).

Voice rules: sentence case; plain verbs; say "cover", "payout", "monthly payment", "the index"; never "policy bound", "bind", "settle", "parametric", "nullifier", "on-chain" in the worker flow. Buttons name the outcome. Errors say what happened and what to do next, without apology.

## 9. Engineering notes

- Wallet addresses shortened `0x7A3F…D21B` (first 4 + last 4, ellipsis U+2026), tabular.
- Numbers: no currency symbol anywhere in the worker flow; two decimals for money (28.00), thousands separators for cover amounts.
- Blockchain is invisible in the worker flow — "Pays from" + shortened address is the only trace.
- Tap targets ≥44px including text links (pad the hit area, not the glyph).
- The trigger attachment (2.0) and full-payout level (4.0) are per-series config, not constants in copy — interpolate.
