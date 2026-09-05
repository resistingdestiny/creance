# Creance: rules for every agent session

This repository is a hackathon build (ETHOnline 2026, Start Fresh track). The product pays a worker when two keys hold: the occupation index is above attachment and the worker proves they lost their job (DESIGN.md 3.9). DESIGN.md says what to build, MISSION.md says how we work, PLAN.md and tickets/BACKLOG.md hold the work, docs/DESIGN-TOKENS.md and docs/DESIGN-TOKENS-ADDENDUM.md hold the visual system and copy deck (the addendum wins where they differ), the prize evidence sheet (kept outside the repository at /srv/dbond/board/PRIZES.md) holds the acceptance criteria that decide whether this was worth doing.

Hard rules:
- Testnet only. No mainnet endpoints, no mainnet keys, no real funds. If a command or config mentions mainnet, you are on the wrong path.
- Secrets live in .env, which is gitignored. Read them through process.env. Never print them, never paste them into a file, never commit them.
- Start Fresh: no code, designs or assets from any other project. Open-source starters are fine and go in docs/STARTERS.md with a link and what was taken.
- Small conventional commits scoped to the ticket: `feat(T07): ...`, `fix(T07): ...`, `test(T07): ...`, `docs(T07): ...`. Never squash a day into one commit. Never force push. Never push to main; branches are merged by the controller through pull requests.
- Nothing shown in a demo path runs against a mock. Local Hardhat is for unit tests. Anything in a video runs on Hedera testnet.
- The session that writes code never approves it.
- Read before writing: hedera-skills, hedera-code-snippets, the ATS docs, the World IDKit docs, the Blocky402 docs. Link what you relied on in the PR body.
- When documentation and reality disagree, reality wins; write the discrepancy into docs/harness-notes.md immediately. World friction goes into docs/FEEDBACK-WORLD.md. Deviations from DESIGN.md go into docs/DECISIONS.md with a reason.
- Keep main runnable from a clean clone: `pnpm install`, `pnpm test`, `pnpm dev`.
- Prose (docs, README, comments, commit messages) is plain and direct. No em dashes, no en dashes, no marketing language, sentence case headings.

The autopilot protocol (files under .autopilot/, gitignored):
- next.json is the ticket you are working on. Read it first.
- When finished: pr-body.md (What, Why, How to verify, Testnet links, Discrepancies found, Files outside scope, Root action needed) and done.json {"status":"done"|"blocked","summary":"..."}.
- If blocked: blocked.md with what you tried and what a human must do.
- Reviewers write review.json {"verdict":"approve"|"changes","summary":"...","required_changes":[...]}.
- Builders never edit PLAN.md or STATUS.md; the controller does.

Stack conventions (from T01 onward): pnpm workspace, TypeScript strict, vitest, Fastify for the API, Next.js with Tailwind for the web app, Hardhat for contracts, the Hedera JavaScript SDK for HTS, HCS and Scheduled Transactions, Postgres via the DATABASE_URL in .env.

Commit small and commit often. The event reads the history as evidence of how the work was done, so a day of work is many small commits, never one large one. One coherent step per commit, a conventional message scoped to the ticket, a handful of files, and a subject line that needs no "and". Nothing sits uncommitted for more than about fifteen minutes. Do not squash and do not amend anything already pushed.
