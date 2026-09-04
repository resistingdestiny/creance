# Index findings

Pre-kick-off design analysis of the real source data. The archive it used is committed under data/bls with provenance; every number here is recomputable from it, and T02 must reproduce these tables from the archive before extending them. This file is design input, not settlement output.

## 1. What the source actually offers

The LN catalogue publishes monthly, not seasonally adjusted unemployment rates from 2000 for the A-13 occupation structure: ten bindable sub-groups (management, business and financial; professional and related; service; sales and related; office and administrative support; farming, fishing and forestry; construction and extraction; installation, maintenance and repair; production; transportation and material moving), their four parent aggregates, and, unexpectedly, fifteen detailed occupation groups including Computer and mathematical, Legal, and Arts, design, entertainment, sports and media. Series ids are in data/bls/series-ids.txt with the catalogue itself in data/bls/raw. There is no armed forces unemployment series; the occupation picker copy that listed eleven groups including armed forces is corrected in docs/DESIGN-TOKENS-ADDENDUM.md: the picker offers the ten sub-groups plus five detailed series (Computer and mathematical; Legal; Arts, design, entertainment, sports and media; Business and financial operations; Education, training and library), fifteen rows.

## 2. What the backtest says about the year-on-year ODI

Computed exactly per the spec from 2010 to July 2026, per series, against the all-occupation rate. Outside the 2020 to 2021 dislocation, the ten major groups almost never reach 2.0 points: the maxima are 0.9 to 1.4 for eight of them, with only the small, noisy groups (farming; construction in the 2010 recession tail) exceeding it. Office and administrative support has a sixteen-year maximum of 0.93 and has never crossed 1.5. Two conclusions:

- A single 2.0 attachment across groups is wrong. Farming would open on sampling noise at 2.0 (28 open months since 2010) while office and administrative support could never open at any plausible shock level. Attachments must be per series, set at issuance from the published backtest. Suggested rule: shock attachment A = max(1.5, 3 sigma of the 2010 to 2026 ODI excluding 2020 to 2021, rounded to 0.5).
- The year-on-year form detects shocks, not grinds. Computer and mathematical drifted from a baseline excess of about minus 3.2 points to about minus 0.6 over 2023 to 2026, a structural deterioration of roughly 2.5 points, and the ODI never left the minus 1 to plus 1 band because a slow slide differences away. If AI displacement is gradual, the shock form alone never opens claims for exactly the groups the product is for.

## 3. The fix: a dual-form index key

Claims open for a group in month t when either form holds:

    shock   ODI_g,t  >= A_g          (year-on-year change in smoothed excess, as specified)
    level   ebar_g,t >= L_g          (smoothed excess itself crosses a sustained-deterioration line)

with L_g = p95 of ebar over the fixed baseline decade 2010 to 2019, plus 0.75 points. The baseline is frozen at issuance; a rolling baseline would quietly normalise displacement. Both forms use only the published inputs, both are deterministic, and the observation message states which form opened the month.

What the level form finds on real data: Computer and mathematical crossed its line in April and May 2026 (ebar minus 0.60 and minus 0.63 against a line of minus 0.68 derived from its own baseline). Arts, design, entertainment, sports and media crossed repeatedly through 2025 and again in January and February 2026. Note that a line can be negative: for professions with structurally low unemployment, the trigger is deterioration relative to their own history, not high unemployment in absolute terms; the copy on the index screen must say this plainly.

## 4. Per-series parameters (suggested at issuance; T02 recomputes and freezes)

    series                                A (shock)   L (level)   base p50   base p95
    Management, business, financial          1.5        -0.98       -2.97      -1.73
    Professional and related                 1.5        -0.62       -2.90      -1.37
    Service                                  1.5         2.28        1.03       1.53
    Sales and related                        1.5         1.15        0.00       0.40
    Office and administrative support        1.5         0.85       -0.37       0.10
    Farming, fishing, forestry               5.5        12.25        5.27      11.50
    Construction and extraction              3.5        12.78        3.87      12.03
    Installation, maintenance, repair        2.0         0.65       -1.20      -0.10
    Production                               2.5         3.72        0.93       2.97
    Transportation, material moving          1.5         4.35        1.70       3.60
    det Computer and mathematical            2.0        -0.68       -3.17      -1.43
    det Legal                                2.5        -1.32       -3.87      -2.07
    det Arts, design, ent., media            3.0         1.32       -0.57       0.57
    det Business and financial ops           1.5        -0.38       -2.47      -1.13
    det Education, training, library         2.0         1.62       -2.73       0.87

COVID-era distortions inflate the baselines of farming and construction, which correctly makes their level lines unreachable; those groups trade on the shock form with high attachments or are simply priced wide.

## 5. Demo recommendation

Demo series: det Computer and mathematical, working name ODI-COMP-2026-01. The replay runs real history from January 2025 to July 2026; claims open in April 2026 on the level form, on official data, in the AI era, for the most AI-facing occupation the source publishes. No scenario file. The claim in the demo is a redundancy letter with a last day of work in February or March 2026 (inside the loss window of the April opening), approved by the Adjuster; the declined claim is a resignation. Spare real window if ever needed: Food preparation and serving opened on the shock form in February and March 2025.

Office and administrative support stays first in the picker: the exposure cross-check below supports it as the group with the largest at-risk mass, and its cover simply has not been triggerable in sixteen years of history, which the index screen should say honestly per series ("this cover has never paid for this occupation since 2010" where true).

## 6. Cross-check against the private exposure tracker

The picker order puts the large white-collar groups first: office and administrative support, then management, business and financial, then professional and related. That is a product judgment about where displacement cover is most likely to be bought, and it supports the choice to carry the detailed white-collar series. Only the committed BLS data plays any role in the index and the trigger.

## 7. Honesty notes for the README and the video

The index does not attribute cause; a non-AI shock opens claims too, and the loss key does not distinguish. The detailed occupation series carry more sampling noise than the majors, which the per-series attachments price in. The dual-form parameters are fixed at issuance and published in full, so a buyer or noteholder can recompute every open month from public files. First published values settle; revisions never move money.

## 6. Required fixes before the index settles anything

An adversarial review of this index against the committed archive found three defects that change settlement outcomes. They are not optional refinements. Each is reproducible from data/bls, and the full review with sources is held with the project research notes.

### 6.1 The level form false-triggers on seasonality, and must use month matched lines

These series are not seasonally adjusted, and BLS publishes no seasonally adjusted occupation rates, so there is nothing to switch to. The year on year shock form cancels stable seasonality; the level form does not. On the real data every level form opening for education, training and library falls in August, the school year peak, and every farming opening falls between February and April. Those are calendar artifacts being read as displacement.

Fix: the level line L_g is computed per calendar month, from that month's values across the baseline decade, rather than once for the whole series. A January reading is compared with January history. Implement this before any level form opening is treated as real.

### 6.2 The October 2025 gap must have a stated rule

The CPS was not collected for October 2025. The specification says the smoothed excess is the mean over t-2, t-1 and t, which silently has two honest readings: strictly, November and December 2025 are uncomputable and so is the year on year value for October 2026; or the window hops the gap and takes the last three available months.

The choice is not cosmetic. Under the hop over reading, computer and mathematical opens in December 2025; under the strict reading it does not, and the first opening is in April 2026 as stated in section 3. Two correct implementations settle different months. The rule must be written into the specification, published on the methodology page, and tested both ways.

### 6.3 The shock form has base effects in both directions

The year on year form compares against a base that may itself be shocked. In 2021 it produced a large positive reading for computer and mathematical purely because the base a year earlier was depressed, while conditions were improving; through 2022 it printed negative while conditions were genuinely deteriorating. It measures anniversaries, not states. The dual form design already mitigates this, which is why it exists, but a base effect guard belongs in the specification: an opening on the shock form alone should require that the base period was not itself an open month.

## 7. Two things that came out better than expected

Not seasonally adjusted household data is not revised after first print, which is BLS policy. For this index that means the backtest was computed on the same numbers the product will settle on, and vintages are recoverable from public archives if anyone disputes a reading. That is an unusually strong position for a parametric trigger and it belongs in the methodology page.

The exception is January 2026, which was revised after its first print. Any replay or demo whose window crosses that month must be recomputed on the pre revision values before the result is shown or relied on.

## 8. Leading indicators, for pricing only

Job postings and layoff announcement series turned twelve to twenty four months before this index did for computer and mathematical work. They are not deterministic, not free of licence conditions, and not suitable for settlement. They are suitable for pricing, and for saying honestly on the index page that the index is a lagging measure by construction.
