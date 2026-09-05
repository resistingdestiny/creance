# Index operations

How the index is published, watched and rebuilt. docs/INDEX-SPEC.md is the
specification; this is the runbook for the parts of it that run every day.

## The daily check

    pnpm oracle:schedule

One invocation is one check, and then it exits. It resolves the dataset, asks
whether the source carries a period newer than the newest one already
published, runs the full pipeline when it does, and writes a row to the runs
table whether it published anything or not.

The deploy compose runs the oracle as a service whose command loops
`pnpm run oracle:schedule` and then sleeps a day, so the loop is the schedule.
docs/INDEX-SPEC.md section 5 asks for a check at 14:10 UTC; on the deployed
service that is the hour the container was started at, and the check is safe at
any hour because it publishes only what the source has and the store does not.
A process that has to hit 14:10 itself runs `pnpm oracle:schedule --wait`,
which sleeps until the next `--at` time, 14:10 UTC by default, and then does its
one check.

Useful flags:

    --source archive     run against the committed snapshot, no network
    --series LABEL       check only the group that cover series settles
    --no-submit          publish to the topic and make no contract call
    --dry-run            compute, gate, sign and encode everything, send nothing
    --at 12:40 --wait    sleep until 12:40 UTC, then check

The states a run walks are fetch, verify, compute, qa, publish, submit, done and
failed. The row keeps the state the run died on, so `qa` or `publish` in the
runs table is a diagnosis and not a guess.

## What is watched

    GET /v1/index/health

The last run and its state, whether the gates passed and which failed if they
did not, the newest published month for every group, how old the newest month
is, and whether the feed is live or replaying. It is free, and the x402 gate
exempts it by name even though it sits under the metered prefix.

`GET /health` carries a summary of the same document in its `index` block, so
the deploy health check and the container health check both see it. A stale
source does not change the status code: restarting the container would not make
the Bureau of Labor Statistics publish.

The last run, the gates and the mode are read from the oracle's files, and only
the published periods come from the database, so an unreachable database
degrades the document rather than ending it: `status` and `database` both say
`unreachable`, the periods are absent rather than empty, and everything the
files carry is still reported. `GET /health` keeps returning the git SHA, the
replay state and `deps.db` in that case, which is the case it exists for.

The alerts of docs/INDEX-SPEC.md section 9 are posted to `NOTIFY_URL`, one HTTP
POST per alert with a body of event, group, period, message and run id:

    run_failed          a run reached the failed state
    qa_failed           a gate failed, so nothing was published or submitted
    source_stale        the newest period is more than 45 days old
    revision_detected   the source moved under a period that already settled
    first_open_month    a group opened for the first time, a product event

With `NOTIFY_URL` unset every alert is written to the run log instead, which is
what a clone and `pnpm test` do. A delivery that fails is logged and the run
carries on: losing an alert must not also lose the run.

The specification also sends alerts to STATUS.md. That file is the board's and
lives outside this repository, so nothing here writes it; the daily status job
is what carries index health into STATUS.md, by reading
`GET /v1/index/health` and pasting the block.

## When a QA gate fails

Nothing was published and nothing was submitted. The gates run over the whole
window before the first message goes out, so a failed run has put nothing on the
topic and made no contract call, and the run row carries every gate result.

Look at the gate that failed before doing anything else. A bounds failure or a
jump failure is either a source anomaly or a bug, and docs/INDEX-SPEC.md section
8 says a human looks either way. The gates are not overridable: a month that
fails one is not published, because the first value published for a period
settles it forever.

If the window spans a legitimate anomaly, the run log names the longest prefix
that passes and the command that publishes it.

## When the source revises a published month

The pipeline publishes a revision record to the index topic referencing the
original sequence number, stores it beside the row that settled, alerts, and
makes no contract call. Settlement never moves. Nothing has to be done by hand.

This is normal at this source. Every January carries the annual population
control update and corrections to earlier months are routine, which is why the
first final rule exists rather than a restatement path.

## When the source goes stale

`source_stale` fires when the newest reference month is more than 45 days old,
measured from the end of that month and never from the last successful run. In
normal operation the newest period is at most about five weeks old, so 46 days
means the release that should have happened did not.

It is usually true rather than wrong. During the 2025 lapse in appropriations
the September release moved by seven weeks and the October release was cancelled
outright, and an index that quietly stopped alerting through that would have
been worse than one that paged. Confirm against the Bureau's release schedule
and say so in the status entry; the check keeps running and publishes as soon as
a new period appears.

## Rebuilding the history

    pnpm oracle:backfill                 rebuild docs/INDEX.md from data/bls
    pnpm oracle:backfill --check         regenerate and compare, write nothing

Backfill reads the committed archive first, then the cache under var/cache/bls,
then the API. It computes every period from 2000-01, publishes nothing and
submits nothing, and regenerates docs/INDEX.md. Re-running it is idempotent: the
same archive produces the same bytes, and the command prints the sha256 of what
it wrote and says whether the rerun was byte identical.

Backfill writes a file and no observation rows. History before a series existed
is context and not settlement, so there is nothing for the observations table to
hold: what settles is what the topic carries, and backfill never publishes. See
docs/DECISIONS.md.

## Common failures

**403 from the Bureau of Labor Statistics.** Both download.bls.gov and
www.bls.gov refuse a client that does not identify itself. Set `BLS_CONTACT` to
a contact address; it is sent as the User-Agent on every request. Without it the
flat file downloads and the release calendar pages return 403, with or without a
browser-like User-Agent. The keyless API endpoint the archive was collected with
still answers, so `--source archive` and `--source cache` are unaffected.

**The keyless API allowance is spent.** It is 25 requests a day, pooled across
everything sharing the address. Run with `--source archive` or set `BLS_API_KEY`,
which raises the allowance and moves the client to the v2 endpoint.

**The run publishes nothing on a fresh machine.** A clone has no store, so the
first check reads the index topic through the mirror node to find out what
already settled. If the mirror node is unreachable the check refuses to guess
and fails rather than publishing a second message for a month that is already
there.

**`GET /v1/index/health` answers `never_run`.** No runs file on that deployment.
Check `ORACLE_RUNS_PATH` names the same file in both containers; in the compose
file both services set it to `/repo/var/oracle/runs.json` on the shared volume.

**`GET /v1/index/health` answers `degraded` with `database: unreachable`.** The
oracle is fine and Postgres is not: the last run and the gates in the same
document were read from files. `newest_period` is null because nothing could be
asked, not because nothing has been published, so the staleness line says
nothing until the database is back. Look at `deps.db` on `GET /health` and at
the db service.
