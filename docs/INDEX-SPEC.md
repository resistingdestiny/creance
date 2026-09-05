# ODI specification and operations

The Occupation Displacement Index, specified to settlement grade. DESIGN.md 3.3 is the summary; this file is the contract the index code is built to. T02 builds the computation, T12 the publication paths, T26 the operations. Every deviation goes to docs/DECISIONS.md.

## 1. What the index must be

Public inputs, deterministic computation, reproducible by an outsider from the cited source files, published with signatures and hashes, and fixed once used for settlement. A trigger index that can be recomputed to a different value after money moved is not an index, it is an argument.

## 2. Series universe

Trigger series: unemployment rates by occupation, monthly, not seasonally adjusted, from the CPS (BLS LN program), plus the all-occupation rate. Bindable: the ten A-13 sub-groups and five detailed groups (computer and mathematical; legal; arts, design, entertainment, sports and media; business and financial operations; education, training and library), sixteen series including the aggregate. The archive under data/bls carries the catalogue, the ids and the full history from 2000; docs/INDEX-FINDINGS.md carries the pre-event calibration that T02 must reproduce.

Companion series, used for pricing and context, never for the trigger: JOLTS layoffs and discharges rate by industry; job postings indices later. Keep companions in separate modules so nothing about them can leak into settlement.

## 3. Series identification

The mapping lives in packages/index-model/src/series-map.json:

    {"group_key":"office_admin_support","label":"Office and administrative support",
     "bls_series_id":"LNU0...","source":"CPS LN","selected_by":"T02","notes":""}

Resolution procedure (T02, once): download ln.series from the BLS flat files, filter to monthly, not seasonally adjusted, unemployment rate, occupation-group dimension, and match the fifteen bindable series plus the all-occupation rate, sixteen in all. Record the chosen series ids and the ln.series file hash in the mapping and in docs/INDEX.md. The mapping is then frozen: any change is a decision with a reason, and changing a series id after any observation was submitted for settlement is forbidden for that series' history.

## 4. Computation

For group g in month t, with u the unemployment rate:

    e_g,t     = u_g,t - u_all,t
    ebar_g,t  = mean(e_g,t, e_g,t-1, e_g,t-2)
    ODI_g,t   = ebar_g,t - ebar_g,t-12

Claims open for the group in month t when either form holds:

    shock   ODI_g,t  >= A_g
    level   ebar_g,t >= L_g

A_g = max(1.5, 3 sigma of the series' ODI from 2010 excluding 2020 to 2021, rounded to 0.5). L_g = p95 of ebar over the fixed baseline decade 2010 to 2019, plus 0.75. Both are set at issuance, published in the series terms and in every message, and frozen; the baseline never rolls. A negative L is meaningful: it is deterioration against the series' own history, not high unemployment in absolute terms. Precision: keep source rates as published (one decimal), compute in full float, publish e, ebar and ODI rounded to two decimals; the trigger comparison uses the published two-decimal ODI so that anyone recomputing from the message gets the same boolean. Availability is two independent checks, not one window. Months t, t-1 and t-2 give ebar and the level form; months t-12, t-13 and t-14 additionally give the ODI and the shock form. When the first set is incomplete the observation is published with "status":"insufficient_history", carries no ebar and no ODI, and is never submitted on chain. When the first set holds and the second does not, the observation is published with ebar, with "odi":null and "forms":["level"], and only the level form is evaluated. The published ODI is defined as pub(pub(ebar_t) - pub(ebar_t-12)), the difference of the two published smoothed values, so a reader recomputing it from the message gets the same number and the same boolean. Missing source months are never interpolated and the smoothing window never slides over a gap: it is t, t-1 and t-2 by the calendar.

## 5. Calendar and runs

The CPS releases with the Employment Situation, normally in the first week of the following month. The scheduler does not hard-code release dates: it checks daily at 14:10 UTC whether the source has a period newer than the newest stored one, and runs the pipeline when it does. Run states: fetch, verify, compute, qa, publish, submit, done, failed. Every run writes a row to the runs table whether or not it published. The replay and scenario modes from DESIGN.md 3.3 bypass fetch but still pass qa and still write runs, labelled mode replay.

As built, one invocation of `pnpm oracle:schedule` is one check and then it exits: the deploy compose runs the oracle as a service whose command loops that script and sleeps a day, so the loop owns the cadence. The check is safe at any hour and safe to run twice, because it publishes only what the source carries and the store and the topic do not. `--wait` makes a resident process sleep until the next 14:10 UTC itself. docs/INDEX-OPS.md is the runbook.

## 6. Revision and settlement policy: first final

The first value published for a period is the settlement value, forever.

- Publication is one HCS message per group per period; submission is one on-chain call per group per period. The contract ignores a second submission for the same (group, period).
- If a later fetch shows the source changed for an already published period (BLS revisions, annual population control updates), the pipeline publishes a revision record to HCS referencing the original sequence number, stores it, alerts, and does not resubmit. The web app can show revisions; settlement never moves.
- Revisions to periods never used in settlement and never published simply produce the normal first publication.
- A change is detected by the source hash: the published message commits to the sha256 of the six source rows the computation used, so comparing that against the same six rows in a fresh fetch asks exactly the right question. The window is the fifteen calendar months a period's computation can touch.
- The published message says `"status":"revision"`, which is the word section 7 uses; the stored row says `revised`, which is the word the observations table's status check uses. They are the same event.

This is the standard fixed-determination rule for parametric triggers and it is what makes the note investable: noteholders can price the index as published, not as it might be restated.

## 7. Message schema, v2

    {"v":2,"series":"ODI-COMP-2026-01","group":"computer_math","period":"2026-04",
     "u_g":4.1,"u_all":4.5,"e":-0.40,"ebar":-0.60,"odi":0.30,
     "attachment_shock":2.0,"level_line":-0.68,
     "open":true,"open_reason":"level",         // shock | level | both | none
     "status":"final",                          // final | insufficient_history | revision
     "revises_seq":null,                        // set on revision records
     "model_version":"odi-1.0.0",
     "source_files":[{"url":"...","sha256":"...","rows_used":24}],
     "computed_at":"2026-08-08T12:31:00Z","sig":"..."}

Under 1 KB, canonical JSON (sorted keys, no whitespace) signed by the oracle key. model_version changes only with a decision entry and never rewrites history.

## 8. QA gates

Run after compute, before publish. Any failure fails the run closed: nothing is published, nothing is submitted, an alert fires.

- Completeness: all sixteen series present for the target period.
- Bounds: 0 <= u <= 30 for every series; |ODI| <= 10.
- Jump: |ebar_g,t - ebar_g,t-1| <= 5 standard deviations of the trailing 24 months, per group. The window stays 24 calendar months and the gate runs on whatever those months collected, provided there are at least twelve; below that a standard deviation is a noisier test rather than a tighter one, and the gate abstains and says so. Demanding all 24 would switch the gate off for the fifteen months after the October 2025 lapse in appropriations, including the two the demo settles on. See docs/DECISIONS.md under T12.
- Consistency: u_all lies between the min and max of the group rates for the period.
- Mapping integrity: series-map.json hash matches the frozen hash.
- Provenance: every source file used has a stored sha256 and byte count.

A failed gate is a bug or a source anomaly; either way a human looks before anything reaches the topic.

## 9. Monitoring and alerting

- The runs table is the heartbeat. GET /v1/index/health returns last run, last period per group, qa status, staleness in days, and mode (live or replay). It is free, and because it sits under the prefix the x402 gate meters, the gate exempts that one path by name with a test holding it open. GET /health carries a summary of the same document in its `index` block, which is what "the deploy health check includes it" means in practice.
- Staleness is measured from the end of the newest reference month at the source, never from the last successful run: a run that succeeds every day while nothing new has been published is a heartbeat with nothing behind it.
- Alerts through NOTIFY_URL (and STATUS.md): failed run; qa failure; source stale (newest period older than 45 days); revision detected; and the first open month for any group, which is a product event, not only an ops event.
- The oracle runs in schedule mode as a service in the deploy compose (restart always); logs are retained for the event window; the daily status job includes index health in STATUS.md.

## 10. Storage

Postgres, apps/api schema, owned by the oracle. As built the oracle has no database connection, so `runs` and `observations` are JSON files the oracle writes and the API reads over the volume both containers mount, in the shapes below, with the period as the `YYYY-MM` string the rest of the oracle uses rather than the integer form of the Postgres column. See docs/DECISIONS.md, "The runs table is a file the API reads, not a Postgres table the oracle writes".


    runs(id, mode, started_at, finished_at, state, target_period, qa_json, notes)
    source_files(id, url, sha256, bytes, fetched_at, stored_path)
    observations(group_key, period, u_g, u_all, e, ebar, odi, open, status,
                 model_version, hcs_seq, submit_tx, revises_seq, run_id,
                 unique (group_key, period, status))

Raw fetched files are kept verbatim under var/cache/bls (gitignored). Archived snapshots committed to the repository live under data/bls with a PROVENANCE.txt (urls, sha256, fetch time, tool); committed archives are public source data only, never derived series.

## 11. Backfill

`pnpm oracle:backfill --from 2000-01` builds the full history in this order of preference: committed archive under data/bls, then var/cache/bls, then the BLS API (needs BLS_API_KEY, chunked by the API's year limits), then the flat files. Backfill verifies file hashes against PROVENANCE.txt where present, computes every period, submits nothing on chain (history before the series start is context, not settlement), and regenerates the tables in docs/INDEX.md. Re-running backfill is idempotent and byte-identical given the same archive. As built it writes the file and no observation rows: what settles is what the index topic carries, backfill publishes nothing, and a table of unpublished history would be a second answer to a question the topic already answers. See docs/DECISIONS.md.

## 12. Ops notes

- BLS flat file downloads reject anonymous clients; send a descriptive User-Agent with a contact address or requests return 403.
- The API rate limits by key and by day; the backfill sleeps between chunks and caches everything.
- January data carry annual population control updates; expect small level shifts, which the year-on-year differencing mostly absorbs; any resulting revision records are normal and settle nothing.
- If BLS restructures a series (occupation classification changes), the affected group is frozen (no new submissions), a decision entry records it, and a successor series is introduced under a new mapping entry rather than silently spliced.
