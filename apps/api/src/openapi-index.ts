import { HISTORY_MONTHS, HISTORY_MONTHS_MAX } from './routes/index-feed.js';
import {
  GROUP_KEYS,
  INDEX_SCHEMAS,
  MONEY,
  PAYMENT_REQUIRED_BODY,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PROBLEM,
  PUBLIC_ORIGIN,
  paymentRequired,
  problemResponse,
  type DocumentOptions,
} from './openapi-shared.js';

/// The OpenAPI document for the index feed on its own.
///
/// Written out to recipes/bazantic/agentify/openapi.yaml by scripts/openapi.ts,
/// beside the whole-gateway document, from the same shared fragments and with
/// the same test regenerating both and comparing.
///
/// Why a second document. The Occupation Displacement Index is a data feed that
/// exists nowhere else, and it is useful to a caller who will never buy an
/// insurance policy: an occupation is either losing ground against the labour
/// market or it is not, and that is a number worth paying a cent for on its own.
/// So it is imported as its own gateway, with its own operations and its own
/// price, rather than as three of the seven operations in a cover gateway.
/// DESIGN.md section 4 draws it as the second gateway on the same API.
///
/// The four operations here are the whole public index surface. Three are free
/// and one is metered, and the free ones exist so the metered one can be called
/// correctly the first time and read correctly afterwards:
///
///     GET /v1/index          the catalogue: group keys, trigger lines, price
///     GET /v1/index/{group}  the reading, 0.01 TUSD over x402
///     GET /v1/index/health   whether the index is still being published
///     GET /v1/replay         whether the clock is live or replaying
///
/// `GET /v1/index/health` sits under the metered prefix and is free, which the
/// x402 gate carves out by name. An agent that is about to pay for a reading
/// should be able to find out for nothing whether the feed is stale, and an
/// operations endpoint that answers 402 is not an operations endpoint.
///
/// Every operation carries `x-agent-hint`, which is the extension Bazantic's
/// own provider example puts on an operation to tell an agent when to call it.
/// It is an OpenAPI specification extension, so an importer that does not know
/// it ignores it.
///
/// https://bazantic.com/become-a-provider
/// https://spec.openapis.org/oas/v3.0.3#specification-extensions

/** The operations the index gateway imports. */
export const INDEX_OPERATIONS = [
  'GET /v1/index',
  'GET /v1/index/{group}',
  'GET /v1/index/health',
  'GET /v1/replay',
] as const;

/** The price, in one place, so the description and the schema cannot disagree. */
const PRICE = {
  display: '0.01',
  amount: '10000',
  asset: '0.0.10366463',
  decimals: 6,
  symbol: 'TUSD',
  payTo: '0.0.10366450',
  network: 'hedera:testnet',
  facilitator: 'https://api.testnet.blocky402.com',
  feePayer: '0.0.7162784',
};

/** The terms, as prose, for a reader who will not decode a base64 header. */
export const PAYMENT_TERMS = [
  `Price: ${PRICE.display} ${PRICE.symbol} per call, which is \`${PRICE.amount}\` in the smallest`,
  `unit of the HTS token \`${PRICE.asset}\` at ${String(PRICE.decimals)} decimals.`,
  '',
  'Flow: x402 version 2, scheme `exact`, network `hedera:testnet`, settled through the',
  `Blocky402 testnet facilitator at ${PRICE.facilitator}. Call without paying and the`,
  'answer is 402 with the requirements in the `PAYMENT-REQUIRED` header and the same terms',
  'in readable fields in the body. Build a Hedera `TransferTransaction` against them, send',
  'it in `PAYMENT-SIGNATURE`, and the settlement receipt comes back in `PAYMENT-RESPONSE`.',
  '',
  `Pay to ${PRICE.payTo}. The facilitator adds its own signature and pays the Hedera fee,`,
  `so the settlement transaction id begins with its fee payer ${PRICE.feePayer} and not with`,
  'the paying account. That is the id to look up on HashScan.',
  '',
  'Testnet only. There are no real funds anywhere in this feed.',
].join('\n');

export function buildIndexOpenApiDocument(options: DocumentOptions): Record<string, unknown> {
  const servers: Record<string, unknown>[] = [
    { url: PUBLIC_ORIGIN, description: 'Creance, Hedera testnet only.' },
  ];
  if (options.localUrl !== undefined) {
    servers.push({ url: options.localUrl, description: 'A local run from a clean clone.' });
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Occupation Displacement Index',
      version: options.version,
      description: [
        'A monthly index of how far an occupation is losing ground against the labour',
        'market as a whole, published to a Hedera Consensus Service topic and served here',
        'per call over x402.',
        '',
        'What a reading is. For an occupation group g in month t, take the unemployment',
        'rate for that occupation and subtract the rate across all occupations. That',
        'excess is smoothed over three months, and the index is the smoothed excess less',
        'its own value twelve months earlier. Subtracting the all-occupation rate removes',
        'the business cycle and most of the seasonality, so a recession does not move',
        'every occupation at once; what is left is the occupation against the market.',
        'Every value is in percentage points and every value is a decimal string.',
        '',
        'The two trigger forms. A reading is not only a number, it is a number against two',
        'frozen lines, and either one opening is what puts an occupation in trouble.',
        'The shock form opens when `odi >= attachment_shock`, which is an abrupt',
        'dislocation: the occupation has lost ground fast in the last twelve months.',
        'The level form opens when `ebar >= level_line`, which is the slow grind that year',
        'on year differencing removes: the occupation has settled at a worse level than',
        'its own history. A level line can be negative, and that is the reading most often',
        'got wrong: for an occupation with structurally low unemployment the trigger is',
        'deterioration against its own past, not high unemployment in absolute terms.',
        'Both lines are set when a series is issued and never move.',
        '',
        'What it is not. This is not a forecast and not an unemployment rate. It says how',
        'an occupation is doing relative to all occupations, on data the US Bureau of',
        'Labor Statistics published, with the source series and a hash of the source rows',
        'on every reading so anyone can recompute it.',
        '',
        'Where it comes from. US Bureau of Labor Statistics, Current Population Survey,',
        'unemployment rate by occupation, monthly, not seasonally adjusted. Each monthly',
        'observation is published as one message on the Hedera Consensus Service topic',
        '0.0.10366470, signed by the publishing account, and the first value published for',
        'a period is the settlement value forever. A caller who does not want to trust',
        'this API can read the same observations off that topic through the Hedera mirror',
        'node and get the same numbers.',
        '',
        'Start here. `GET /v1/index` is free and lists the fifteen occupation groups, the',
        'frozen trigger lines for each, and which of them have a reading published. Then',
        'buy the reading for one group with `GET /v1/index/{group}`, adding `?months=` if',
        'twenty-four months of history is not enough.',
        '',
        PAYMENT_TERMS,
      ].join('\n'),
      license: { name: 'MIT' },
      contact: { url: PUBLIC_ORIGIN },
    },
    servers,
    tags: [{ name: 'index', description: 'The Occupation Displacement Index.' }],
    paths: {
      '/v1/index': {
        get: {
          tags: ['index'],
          operationId: 'getIndexCatalogue',
          summary: 'The occupation groups, their trigger lines and the price of a reading',
          description: [
            'Free, and the call to make first. It answers everything needed to make a paid',
            'call correctly: the fifteen group keys with their labels and their source',
            'series, the frozen `attachment_shock` and `level_line` for each, which groups',
            'have a published reading at all, and the price and payment terms of the',
            'metered route.',
            '',
            'It carries no index value. Nothing sold by `GET /v1/index/{group}` is given',
            'away here.',
            '',
            '`latest_period` is null for a group nothing has been published for. A paid',
            'call for such a group is refused with 503 after the payment, so read this',
            'first rather than guessing.',
          ].join('\n'),
          'x-agent-hint':
            'Call this before paying for anything. It gives the valid group keys, the price and the two trigger lines, and it costs nothing.',
          responses: {
            '200': {
              description: 'The catalogue.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/IndexCatalogue' } },
              },
            },
          },
        },
      },
      '/v1/index/{group}': {
        get: {
          tags: ['index'],
          operationId: 'getIndex',
          summary: 'The metered index reading for one occupation group',
          description: [
            'The latest published observation for the group, the twenty-four months before',
            'it, and whether claims are open on either trigger form. The source series and',
            'a hash of the source rows come with it, so a reader can recompute the number',
            'from the rows it cites.',
            '',
            '`headline` names whichever of the two forms is nearer its line and how far',
            'away it is, decided here so that two readers cannot decide differently.',
            '',
            `\`months\` asks for a longer or shorter history, from 1 to ${String(HISTORY_MONTHS_MAX)}. The price is per`,
            'call and does not change with it, so a chart of five years costs one reading.',
            '',
            `Price: ${PRICE.display} ${PRICE.symbol}, smallest unit \`${PRICE.amount}\`, asset \`${PRICE.asset}\`, decimals ${String(PRICE.decimals)}.`,
            '',
            'The payment gate runs before the handler, so an unknown group is refused with',
            '402 and not with 400: the 400 is what a paid call to an unknown group gets.',
            'Take the group from `GET /v1/index` and the question does not arise.',
          ].join('\n'),
          'x-agent-hint':
            'This call costs money. Take the group key from GET /v1/index first, and check there that the group has a latest_period, or the payment buys a 503.',
          parameters: [
            {
              name: 'group',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: GROUP_KEYS },
              example: 'computer_math',
            },
            {
              name: 'months',
              in: 'query',
              required: false,
              description: 'How many months of history to return. The reading itself is unaffected.',
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: HISTORY_MONTHS_MAX,
                default: HISTORY_MONTHS,
              },
              example: 60,
            },
            PAYMENT_SIGNATURE_HEADER,
          ],
          responses: {
            '200': {
              description: 'The reading, its history and the trigger status.',
              headers: { 'PAYMENT-RESPONSE': PAYMENT_RESPONSE_HEADER },
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/IndexReading' } },
              },
            },
            '400': problemResponse(
              '`group_unknown`: not one of the fifteen groups. `months_invalid`: not a whole number in range.',
            ),
            '402': paymentRequired(`${PRICE.display} ${PRICE.symbol}`),
            '503': problemResponse('`index_unavailable`: no observation published yet.'),
          },
        },
      },
      '/v1/index/health': {
        get: {
          tags: ['index'],
          operationId: 'getIndexHealth',
          summary: 'Whether the index is still being published, and how fresh it is',
          description: [
            'Free. The operations view of the feed: the last run and the state it reached,',
            'whether the QA gates passed and which failed if they did not, the newest',
            'published month for every group, and how many days old the newest month at',
            'the source is.',
            '',
            '`source.stale` is true when the newest reference month is more than 45 days',
            'old. It is measured from the end of that month and never from the last',
            'successful run, because a run that succeeds every day while the source has',
            'published nothing new is not a healthy index.',
            '',
            'It is under the metered prefix and it is free. Nothing here is an index',
            'value: it says whether the numbers are current, not what they are.',
            '',
            'It answers 200 even when the feed is unhealthy, including when the database',
            'behind the readings cannot be reached: `status` and `database` carry that,',
            'and the last run and the gates are read from files rather than from Postgres.',
          ].join('\n'),
          'x-agent-hint':
            'Call this before relying on a reading you paid for. If status is stale or the last run failed, the newest month may be older than it looks and the reading should be reported with its period, not as current.',
          responses: {
            '200': {
              description: 'The health of the index feed.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/IndexHealth' } },
              },
            },
          },
        },
      },
      '/v1/replay': {
        get: {
          tags: ['index'],
          operationId: 'getIndexClock',
          summary: 'Whether the feed is on the real calendar or replaying history',
          description: [
            'Free. The index has a demo clock: a mode that replays historical months at',
            'one month every few seconds so a full lifecycle fits inside a short video.',
            'A reading taken while that clock is running is a real published observation',
            'from a real month, but it is not this month, and an agent that reports it as',
            'current would be wrong.',
            '',
            '`mode` is `live` when the feed is on the real calendar, `replay` when it is',
            'walking published history, and `scenario` when it is walking a labelled',
            'scenario file. `running` says whether the clock is moving right now.',
            '',
            'It is outside the `/v1/index/` prefix, and so free, on purpose: the metered',
            'route sits under that prefix and this is not a reading.',
          ].join('\n'),
          'x-agent-hint':
            'Check this before reporting a reading as current. If mode is not live, say which month the reading is from and that the clock is replaying.',
          responses: {
            '200': {
              description: 'The clock.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/FeedClock' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Money: MONEY,
        Problem: PROBLEM,
        PaymentRequired: PAYMENT_REQUIRED_BODY,
        IndexCatalogue: {
          type: 'object',
          required: ['index', 'reading', 'trigger_forms', 'groups'],
          properties: {
            index: {
              type: 'object',
              description: 'What the feed is and where its settled record lives.',
              properties: {
                name: { type: 'string', example: 'Occupation Displacement Index' },
                unit: { type: 'string', example: 'percentage points' },
                cadence: { type: 'string', example: 'monthly' },
                source: { type: 'string' },
                topic_id: {
                  type: 'string',
                  nullable: true,
                  description:
                    'The Hedera Consensus Service topic every observation is published to.',
                  example: '0.0.10366470',
                },
                mirror_url: {
                  type: 'string',
                  description: 'The mirror node the same messages can be read from.',
                  example: 'https://testnet.mirrornode.hedera.com/api/v1',
                },
              },
            },
            reading: {
              type: 'object',
              description: 'What the metered route returns, and what each field means.',
              properties: {
                path: { type: 'string', example: '/v1/index/{group}' },
                history_months: { type: 'integer', example: HISTORY_MONTHS },
                history_months_max: { type: 'integer', example: HISTORY_MONTHS_MAX },
                describes: { type: 'string' },
                fields: {
                  type: 'object',
                  description: 'One sentence per index field, keyed by the field name.',
                  additionalProperties: { type: 'string' },
                },
              },
            },
            trigger_forms: {
              type: 'array',
              description: 'The two ways claims open. Either one is enough.',
              items: {
                type: 'object',
                properties: {
                  form: { type: 'string', enum: ['shock', 'level'] },
                  field: {
                    type: 'string',
                    description: 'The reading field this form compares.',
                    example: 'odi',
                  },
                  threshold: {
                    type: 'string',
                    description: 'The frozen line it is compared against.',
                    example: 'attachment_shock',
                  },
                  test: { type: 'string', example: 'odi >= attachment_shock' },
                  means: { type: 'string', description: 'What it means in plain words.' },
                },
              },
            },
            price: {
              type: 'object',
              nullable: true,
              description:
                'What a reading costs and how to pay for it. Null when a deployment serves the feed open, which a clone with no Hedera keys does.',
              properties: {
                amount: { type: 'string', example: '10000' },
                display: { type: 'string', example: '0.01' },
                asset: { type: 'string', example: '0.0.10366463' },
                decimals: { type: 'integer', example: 6 },
                symbol: { type: 'string', example: 'TUSD' },
                x402_version: { type: 'integer', example: 2 },
                scheme: { type: 'string', example: 'exact' },
                network: { type: 'string', example: 'hedera:testnet' },
                pay_to: { type: 'string', example: '0.0.10366450' },
                facilitator: { type: 'string', example: 'https://api.testnet.blocky402.com' },
              },
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  group: { type: 'string', enum: GROUP_KEYS },
                  label: { type: 'string', example: 'Computer and mathematical' },
                  bls_series: {
                    type: 'string',
                    description: 'The source series id at the Bureau of Labor Statistics.',
                    example: 'LNU04032215',
                  },
                  series_id: {
                    type: 'string',
                    nullable: true,
                    description: 'The cover series bound to this occupation, when there is one.',
                    example: 'ODI-COMP-2026-01',
                  },
                  attachment_shock: {
                    type: 'string',
                    nullable: true,
                    description: 'The frozen shock line, in percentage points.',
                    example: '2.00',
                  },
                  level_line: {
                    type: 'string',
                    nullable: true,
                    description: 'The frozen level line. It can be negative.',
                    example: '-0.68',
                  },
                  latest_period: {
                    type: 'string',
                    nullable: true,
                    description: 'The newest published month, or null when there is none.',
                    example: '2026-07',
                  },
                },
              },
            },
          },
        },
        FeedClock: {
          type: 'object',
          required: ['mode', 'running', 'updated_at'],
          properties: {
            mode: { type: 'string', enum: ['live', 'replay', 'scenario'] },
            running: { type: 'boolean' },
            series: { type: 'string', nullable: true, example: 'ODI-COMP-2026-01' },
            from: { type: 'string', nullable: true, example: '2025-08' },
            to: { type: 'string', nullable: true, example: '2026-07' },
            current_period: { type: 'string', nullable: true, example: '2026-04' },
            latest_published: { type: 'string', nullable: true, example: '2026-04' },
            started_at: { type: 'string', nullable: true, format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
            scenario_label: {
              type: 'string',
              nullable: true,
              description: 'Set only in scenario mode, and shown on screen when it is.',
            },
            badge: {
              type: 'object',
              nullable: true,
              description: 'What a screen shows while the clock runs. Null when it is not.',
              properties: { show: { type: 'boolean' }, label: { type: 'string' } },
            },
          },
        },
        IndexHealth: {
          type: 'object',
          required: ['status', 'mode', 'time', 'qa', 'database', 'source', 'model_version'],
          properties: {
            status: {
              type: 'string',
              enum: ['ok', 'stale', 'failed', 'degraded', 'never_run'],
              description:
                'One word for the whole feed. `failed` when the last run failed, `degraded` when the published periods could not be read, `stale` when nothing newer than 45 days has been published, `never_run` on a deployment whose oracle has not run yet.',
            },
            mode: {
              type: 'string',
              enum: ['live', 'replay', 'scenario'],
              description: 'Which calendar the feed is on, the same value GET /v1/replay serves.',
            },
            time: { type: 'string', format: 'date-time' },
            last_run: {
              type: 'object',
              nullable: true,
              description: 'The newest row of the runs table. Null when nothing has run here.',
              properties: {
                id: { type: 'integer', example: 12 },
                mode: { type: 'string', enum: ['live', 'replay', 'backfill', 'scenario'] },
                state: {
                  type: 'string',
                  enum: [
                    'fetch',
                    'verify',
                    'compute',
                    'qa',
                    'publish',
                    'submit',
                    'done',
                    'failed',
                  ],
                },
                started_at: { type: 'string', nullable: true, format: 'date-time' },
                finished_at: { type: 'string', nullable: true, format: 'date-time' },
                target_period: { type: 'string', nullable: true, example: '2026-07' },
                notes: { type: 'string', nullable: true },
                qa_passed: { type: 'boolean', nullable: true },
              },
            },
            qa: {
              type: 'object',
              description: 'The gate results of the last run.',
              properties: {
                status: { type: 'string', enum: ['pass', 'fail', 'unknown'] },
                period: { type: 'string', nullable: true, example: '2026-07' },
                failed_gates: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { gate: { type: 'string' }, detail: { type: 'string' } },
                  },
                },
              },
            },
            database: {
              type: 'string',
              enum: ['ok', 'unreachable'],
              description:
                'Where `last_period_by_group` and `source.newest_period` came from. When it is `unreachable` the periods are absent rather than empty: the run, the gates and the mode are read from files and are still reported.',
            },
            last_period_by_group: {
              type: 'object',
              description:
                'The newest published month for each group, keyed by group key. Empty when the database is unreachable.',
              additionalProperties: { type: 'string', example: '2026-07' },
            },
            source: {
              type: 'object',
              description: 'How fresh the published index is.',
              properties: {
                newest_period: { type: 'string', nullable: true, example: '2026-07' },
                stale_days: { type: 'integer', nullable: true, example: 35 },
                stale: { type: 'boolean' },
                stale_after_days: { type: 'integer', example: 45 },
              },
            },
            replay: { $ref: '#/components/schemas/FeedClock' },
            model_version: { type: 'string', example: 'odi-1.0.0' },
          },
        },
        ...INDEX_SCHEMAS,
      },
    },
  };
}
