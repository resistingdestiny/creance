import { GROUP_KEYS, PUBLIC_ORIGIN } from './openapi-shared.js';
import { PAYMENT_TERMS } from './openapi-index.js';

/// The two files an agent reads instead of a manual.
///
///     llms.txt   the index file, served at GET /llms.txt
///     SKILL.md   the skill, served at GET /skill.md
///
/// Both are built here and both are written to recipes/bazantic/agentify/ by
/// scripts/openapi.ts, so the served copy and the committed copy are the same
/// bytes and a test says so. Bazantic's provider page lists an "Optimized
/// Skills File" and an "LLM.txt file (coming soon)" among the things it
/// generates for a provider; these are ours, written to the shapes Bazantic
/// publishes for itself, so there is something to compare against when the
/// generated ones arrive.
///
/// The formats are copied from what is actually served today rather than from
/// a specification we would like to exist. https://bazantic.com/llms.txt is an
/// index file in the llmstxt.org shape: an H1, a blockquote summary, then H2
/// sections of annotated links. https://bazantic.com/skill is a SKILL.md with
/// YAML frontmatter carrying `name` and `description`, then markdown.
///
/// Everything a call costs is stated in both, in words, because an agent that
/// has to make an unpaid request to discover a price cannot decide whether to
/// make the request at all.
///
/// https://llmstxt.org
/// https://bazantic.com/llms.txt
/// https://bazantic.com/skill

export interface AgentDocsOptions {
  /** The origin every URL in the file points at. */
  origin?: string;
}

/** The one sentence both files open with, so they cannot describe two things. */
const SUMMARY =
  'A monthly index of how far a US occupation is losing ground against the labour market as a whole, published to a Hedera Consensus Service topic and sold per call over x402 on Hedera testnet.';

/** The frontmatter description: when an agent should reach for this skill. */
const DESCRIPTION = [
  'Read the Occupation Displacement Index for a US occupation group: whether the occupation is',
  'losing ground against the labour market, how far the reading sits from each of the two',
  'trigger lines, and whether displacement claims are open. Use it when a question is about an',
  'occupation rather than a person, and a published number is wanted rather than an opinion.',
  'Paid per call over x402 on Hedera testnet, 0.01 TUSD.',
].join(' ');

const WHAT_A_READING_IS = [
  'Take the unemployment rate for one occupation group in one month and subtract the rate',
  'across all occupations. That excess is smoothed over three months (`ebar`), and the index',
  '(`odi`) is the smoothed excess less its own value twelve months earlier. Subtracting the',
  'all-occupation rate removes the business cycle and most of the seasonality, so a recession',
  'does not move every occupation at once. What is left is the occupation against the market.',
  'Values are percentage points, and every one of them is a decimal string and never a JSON',
  'number: on chain the thresholds are int64 scaled by 1e4, and a float round trip is how a',
  'reader ends up with a number the contract never compared.',
].join('\n');

const TRIGGER_FORMS = [
  'A reading is a number against two frozen lines, and either one opening is what puts an',
  'occupation in trouble. Both lines are set when a series is issued and never move.',
  '',
  '- **Shock**, `odi >= attachment_shock`. An abrupt dislocation: the occupation has lost',
  '  ground fast over the last twelve months.',
  '- **Level**, `ebar >= level_line`. The slow grind that year on year differencing removes:',
  '  the occupation has settled at a worse level than its own history.',
  '',
  'A level line can be negative, and this is the reading most often got wrong. For an',
  'occupation with structurally low unemployment the trigger is deterioration against its own',
  'past, not high unemployment in absolute terms. On 5 September 2026 `computer_math` read',
  '`ebar` -1.37 against a level line of -0.68: claims closed, and the level form is the nearer',
  'of the two at 0.69 percentage points away. A reading of -0.60 against the same line would',
  'be close to opening even though the number is negative and looks benign.',
].join('\n');

const WHAT_IT_IS_NOT = [
  'It is not a forecast and it is not an unemployment rate. It says how an occupation is doing',
  'relative to all occupations, on data the US Bureau of Labor Statistics published, with the',
  'source series id and a hash of the source rows on every reading so anyone can recompute it.',
  'It says nothing about any individual person.',
].join('\n');

/** The llms.txt index file. */
export function renderLlmsTxt(options: AgentDocsOptions = {}): string {
  const origin = options.origin ?? PUBLIC_ORIGIN;
  return [
    '# Occupation Displacement Index',
    '',
    `> ${SUMMARY}`,
    '',
    'Testnet only. No mainnet endpoints and no real funds anywhere in this feed.',
    '',
    '## What a reading is',
    '',
    WHAT_A_READING_IS,
    '',
    '## The two trigger forms',
    '',
    TRIGGER_FORMS,
    '',
    '## What it is not',
    '',
    WHAT_IT_IS_NOT,
    '',
    '## Start here',
    '',
    `- [The catalogue](${origin}/v1/index): free. The fifteen occupation group keys with their`,
    '  labels and source series, the frozen `attachment_shock` and `level_line` for each, which',
    '  groups have a reading published, and the price of a reading. Call this before paying for',
    '  anything.',
    `- [The clock](${origin}/v1/replay): free. Whether the feed is on the real calendar (\`mode\``,
    '  `live`) or replaying published history for a demo. A reading taken while the clock is',
    '  replaying is a real published month, but it is not this month.',
    '',
    '## The reading, which is the paid call',
    '',
    `- [A group's reading](${origin}/v1/index/computer_math): 0.01 TUSD. The latest published`,
    '  observation for one occupation group, the twenty-four months before it, whether claims',
    '  are open and on which form, and the source series and hash behind the number.',
    '',
    '## Payment',
    '',
    PAYMENT_TERMS,
    '',
    '## Description files',
    '',
    `- [OpenAPI 3.0.3](${origin}/openapi/index.json): every public index route, with the 402 and`,
    '  the payment headers on the metered one.',
    `- [SKILL.md](${origin}/skill.md): the same thing as a skill, with a worked call.`,
    '',
    '## The occupation groups',
    '',
    ...GROUP_KEYS.map((key) => `- \`${key}\``),
    '',
    '## The settled record',
    '',
    '- [Index topic 0.0.10366470](https://hashscan.io/testnet/topic/0.0.10366470): every monthly',
    '  observation as one signed message. The first value published for a period is the',
    '  settlement value forever; a later source revision is recorded and never resubmitted.',
    '- [Mirror node](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages?limit=5&order=desc):',
    '  read the same observations without trusting this API. The `message` field is base64 of',
    '  the JSON. The numbers there are JSON numbers where this API sends decimal strings, and a',
    '  closed month is `"open_reason":"none"` there and `null` here; both are the same answer.',
    '- [Payments topic 0.0.10366471](https://hashscan.io/testnet/topic/0.0.10366471): every',
    '  settled call for this feed, with the facilitator transaction id on each.',
    '',
  ].join('\n');
}

/** The SKILL.md, frontmatter and all. */
export function renderSkillMd(options: AgentDocsOptions = {}): string {
  const origin = options.origin ?? PUBLIC_ORIGIN;
  return [
    '---',
    'name: occupation-displacement-index',
    `description: ${DESCRIPTION}`,
    '---',
    '',
    '# Occupation Displacement Index',
    '',
    SUMMARY,
    '',
    'Testnet only. No mainnet endpoints and no real funds.',
    '',
    '## When to use it',
    '',
    '- A person or an agent asks whether an occupation is being displaced, or how a named',
    '  occupation is doing against the labour market.',
    '- Something has to be priced or decided against occupational risk: cover, a renewal, a',
    '  reserve, a hiring plan.',
    '- A published number is needed rather than an opinion, and the caller wants to be able to',
    '  check it against a public record afterwards.',
    '',
    'Do not use it to predict an individual redundancy. It measures an occupation, not a person.',
    '',
    '## What a reading is',
    '',
    WHAT_A_READING_IS,
    '',
    '## The two trigger forms',
    '',
    TRIGGER_FORMS,
    '',
    '## What it is not',
    '',
    WHAT_IT_IS_NOT,
    '',
    '## How to call it',
    '',
    '**1. Read the catalogue. It is free.**',
    '',
    '```',
    `GET ${origin}/v1/index`,
    '```',
    '',
    'It answers the valid `group` keys, the frozen `attachment_shock` and `level_line` for each,',
    'a `latest_period` per group which is null when nothing has been published for it, and the',
    'price of a reading under `price`. Pick the group from this list. A paid call for a group',
    'with no `latest_period` is refused with 503 after the payment has been taken.',
    '',
    '**2. Buy the reading.**',
    '',
    '```',
    `GET ${origin}/v1/index/{group}`,
    '```',
    '',
    'Unpaid, it answers 402 with the terms in the `PAYMENT-REQUIRED` header and the same terms',
    'in readable fields in the body. Pay as described below and retry with the',
    '`PAYMENT-SIGNATURE` header; the settlement receipt comes back in `PAYMENT-RESPONSE`.',
    '',
    'The response carries `reading` (the newest month), `trigger` (the frozen lines, whether',
    'claims are open, and how far the reading sits from each line), `headline` (whichever form',
    'is nearer its line, decided server side so two readers cannot decide differently),',
    '`history` (up to twenty-four months, oldest first), and `source` (the series id and a hash',
    'of the source rows).',
    '',
    '**3. Say whether the clock is live.**',
    '',
    '```',
    `GET ${origin}/v1/replay`,
    '```',
    '',
    'Free. If `mode` is not `live`, the feed is replaying published history for a demo. Report',
    'the reading with the month it is from and say the clock is replaying, rather than calling',
    'it current.',
    '',
    '## Payment',
    '',
    PAYMENT_TERMS,
    '',
    'There is no faucet for the settlement token. A caller who needs some asks the operator,',
    'who mints and transfers it; the request path is in the repository under',
    '`recipes/bazantic/agentify/README.md`. HBAR for account fees comes from the Hedera portal',
    'faucet, and a payer needs almost none of it: the facilitator pays the network fee.',
    '',
    '## A worked call',
    '',
    'The 402 first, which needs nothing but curl:',
    '',
    '```',
    `curl -i ${origin}/v1/index/computer_math`,
    '',
    'HTTP/1.1 402 Payment Required',
    'content-type: application/problem+json',
    'PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwuLi59',
    '',
    '{"type":"https://creance.co/errors/payment-required","title":"Payment required",',
    ' "status":402,"code":"payment_required","retryable":false,',
    ' "price":{"amount":"10000","asset":"0.0.10366463","decimals":6,"display":"0.01"},',
    ' "x402_version":2,"scheme":"exact","network":"hedera:testnet",',
    ' "pay_to":"0.0.10366450","facilitator":"https://api.testnet.blocky402.com"}',
    '```',
    '',
    'Then pay and read. Any x402 version 2 client with a Hedera signer will do it. This is the',
    'shape of the answer, with the values of the month the demo series opened, published to the',
    'index topic at sequence 16:',
    '',
    '```json',
    '{',
    '  "group": "computer_math",',
    '  "group_label": "Computer and mathematical",',
    '  "series_id": "ODI-COMP-2026-01",',
    '  "as_of": "2026-04",',
    '  "reading": {',
    '    "period": "2026-04",',
    '    "u_g": "3.50", "u_all": "4.00", "e": "-0.50", "ebar": "-0.60", "odi": "0.30"',
    '  },',
    '  "trigger": {',
    '    "attachment_shock": "2.00", "level_line": "-0.68",',
    '    "open": true, "open_reason": "level",',
    '    "shock_margin": "-1.70", "level_margin": "0.08"',
    '  },',
    '  "headline": { "form": "level", "distance": "-0.08", "on_the_line": false, "open": true }',
    '}',
    '```',
    '',
    'Read that as: claims are open for computer and mathematical occupations, on the level form.',
    'The smoothed excess of -0.60 has crossed a level line of -0.68 by 0.08 percentage points,',
    'while the shock form is still 1.70 points away. Unemployment in these occupations is not',
    'high in absolute terms, 3.50 against 4.00 across all occupations; it is high against this',
    "occupation's own history, which is what the level form is for.",
    '',
    '**Watch the two sign conventions.** A margin is the reading less its line, so',
    '`level_margin` and `shock_margin` are negative while the form is closed and zero or',
    'positive once it has opened. `headline.distance` is the other way round, the line less the',
    'reading, so it is positive while the form is closed and negative once it has opened. The',
    'margins are the pair to compare across occupations; `headline` is the one to quote.',
    '',
    '## How to report a reading',
    '',
    '- Give the period. A reading is a month, not a moment.',
    '- Give the number and the line it is measured against, not the number alone.',
    '- Say which form is nearer, because that is the one that opens first.',
    '- Say whether claims are open, and on which form.',
    '- If the clock is not live, say so.',
    '',
    '## When to refuse',
    '',
    '- The group is not in the catalogue. Do not guess a key; the payment is taken before the',
    '  handler sees it, so a guess costs money and answers 402 or 400.',
    '- `latest_period` is null for the group. Nothing has been published, and the paid call',
    '  answers 503.',
    '- 503 `index_unavailable` came back anyway. Report it; do not retry with another group and',
    '  present that as the answer.',
    '- The payer holds no settlement token. Say so and stop rather than reporting a number from',
    '  memory.',
    '',
    '## Checking the answer without trusting this API',
    '',
    'Every observation is one message on the Hedera Consensus Service topic 0.0.10366470,',
    'signed by the publishing account. Read the same month from the mirror node:',
    '',
    '```',
    'GET https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10366470/messages?limit=5&order=desc',
    '```',
    '',
    'Decode `message` from base64. The topic carries JSON numbers where this API carries decimal',
    'strings, and a closed month is `"open_reason":"none"` there and `null` here; those are the',
    'same answer, not a disagreement. The first value published for a period settles forever, so',
    'a month read today reads the same next year.',
    '',
    'Every settled call is written to the payments topic 0.0.10366471 with its facilitator',
    'transaction id, so a caller can prove what it paid for without asking this API.',
    '',
  ].join('\n');
}
