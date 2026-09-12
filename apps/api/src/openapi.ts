/// The OpenAPI document for recipes/bazantic/openapi.yaml.
///
/// Built here, in code, and written out by scripts/openapi.ts, with a test that
/// regenerates it and compares. A hand-maintained spec beside a running API
/// drifts within a day, and this one is imported into somebody else's product.
///
/// OpenAPI 3.0.3 rather than 3.1, and nothing exotic in the schemas: no top
/// level `oneOf` in a request body, no recursive `$ref`, money as an object of
/// three strings and one integer, dates as `string` with `format: date`. Every
/// importer accepts 3.0, and 3.1's JSON Schema alignment buys this document
/// nothing.
///
/// The three paid operations carry their 402 and their payment headers, because
/// an agent reading this document has to be able to find out what a call will
/// cost before it makes one. The gate is live: an unpaid call to any of them
/// comes back 402 with the requirements in `PAYMENT-REQUIRED`.
///
/// The six market operations carry no 402 and that is a decision rather than an
/// omission: this venue charges no fee, so there is no fee to meter, and a book
/// nobody may read is not an order book. The reasoning is in
/// apps/api/src/market/index.ts and in docs/ATS.md, "The secondary market".

import { HISTORY_MONTHS, HISTORY_MONTHS_MAX } from './routes/index-feed.js';
import {
  GROUP_KEYS,
  INDEX_SCHEMAS,
  MONEY,
  PAYMENT_REQUIRED_BODY,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PROBLEM,
  PUBLIC_ORIGIN,
  paymentRequired,
  problemResponse,
  type DocumentOptions,
} from './openapi-shared.js';

/** The operations the Bazantic gateway imports. */
export const OPERATIONS = [
  'GET /v1/index/{group}',
  'POST /v1/quote',
  'POST /v1/bind',
  'GET /v1/policy/{policyId}',
  'GET /v1/audit/{policyId}',
  'GET /v1/series',
  'GET /v1/series/{seriesId}',
  'GET /v1/series/{seriesId}/coupons',
  'GET /v1/market/offers',
  'POST /v1/market/offers',
  'GET /v1/market/offers/{id}',
  'POST /v1/market/offers/{id}/fill',
  'POST /v1/market/offers/{id}/cancel',
  'GET /v1/market/positions/{holder}',
] as const;

export function buildOpenApiDocument(options: DocumentOptions): Record<string, unknown> {
  const servers: Record<string, unknown>[] = [
    { url: PUBLIC_ORIGIN, description: 'Creance, Hedera testnet only.' },
  ];
  if (options.localUrl !== undefined) {
    servers.push({ url: options.localUrl, description: 'A local run from a clean clone.' });
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Creance',
      version: options.version,
      description: [
        'Parametric occupation cover funded by Displacement Bond Notes, on Hedera testnet.',
        '',
        'A worker buys cover against their occupation being displaced. Claims open when',
        'the Occupation Displacement Index says the occupation is being displaced, and a',
        'payout also needs proof that the person lost their job. Investors fund the',
        'payouts and earn the premiums as coupons.',
        '',
        'Testnet only. No mainnet endpoints, no real funds.',
        '',
        'Money: every amount is an integer string in the settlement asset smallest unit,',
        'with the asset and its decimals beside it. Never parse `display`.',
        '',
        'Errors: RFC 9457 `application/problem+json`, with a `code` to switch on and a',
        '`retryable` boolean for an agent retry loop.',
        '',
        'Payment: the three metered operations are x402 version 2, scheme `exact`,',
        'network `hedera:testnet`, settled through the Blocky402 testnet facilitator.',
        'An unpaid call is refused with 402 and the requirements in the',
        '`PAYMENT-REQUIRED` header; every settlement is written to the payments topic.',
        '',
        'The secondary market is free, to read and to trade. The venue takes no fee off',
        'either leg of a fill, so there is nothing to meter, and an order book behind a',
        'paywall is an order book nobody can price against.',
      ].join('\n'),
      license: { name: 'MIT' },
    },
    servers,
    tags: [
      { name: 'index', description: 'The Occupation Displacement Index.' },
      { name: 'cover', description: 'Quoting and binding a policy.' },
      { name: 'series', description: 'The Displacement Bond Note series.' },
      {
        name: 'market',
        description:
          "The secondary market in the notes. Free, and the compliance gate on a fill is the note's own KYC register rather than anything of this API.",
      },
      { name: 'audit', description: 'The trail on the Hedera Consensus Service topics.' },
    ],
    paths: {
      '/v1/index/{group}': {
        get: {
          tags: ['index'],
          operationId: 'getIndex',
          summary: 'The metered index feed for an occupation group',
          description: [
            'The latest published observation, the last twenty-four months and the',
            'trigger status, with the source series and the source file hash so a',
            'reader can recompute the number from the cited rows. `months` asks for a',
            'longer or shorter history at the same price.',
            '',
            'Price: 0.01 TUSD, smallest unit `10000`, asset `0.0.10366463`, decimals 6.',
            '',
            'The gate runs before the handler, so an unknown group is refused with 402',
            'and not with 400: the 400 is what a paid call to an unknown group answers.',
            'Send the group from the enum and the question does not arise.',
          ].join('\n'),
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
            '402': paymentRequired('0.01 TUSD'),
            '503': problemResponse('`index_unavailable`: no observation published yet.'),
          },
        },
      },
      '/v1/quote': {
        post: {
          tags: ['cover'],
          operationId: 'createQuote',
          summary: 'Price cover for an occupation and a limit',
          description: [
            'The binding price, with the capacity behind it checked against the series',
            'principal. A quote takes no capacity hold and is valid for fifteen minutes.',
            '',
            'Capacity is committed per occupation, so a group with no Displacement Bond',
            'Note series behind it answers `no_capacity_for_group` rather than quoting a',
            'price nobody can buy.',
            '',
            'Price: 0.05 TUSD, smallest unit `50000`, asset `0.0.10366463`, decimals 6.',
            'Nothing substitutes for it. An eligibility credential is not a payment here:',
            'the gate never reads the `Authorization` header on this operation, and an',
            'unpaid call carrying one is refused with the same 402 and the same price.',
            'The credential belongs on `POST /v1/bind`.',
          ].join('\n'),
          parameters: [PAYMENT_SIGNATURE_HEADER],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/QuoteRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'The quote.',
              headers: { 'PAYMENT-RESPONSE': PAYMENT_RESPONSE_HEADER },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Quote' } } },
            },
            '400': problemResponse(
              '`validation_failed` for a missing field, `group_unknown`, `limit_out_of_range`, or `body_required` and `body_malformed` for a body that is not JSON. Like the 400 on the index feed, these are refusals a paid call gets: the gate answers 402 first.',
            ),
            '402': paymentRequired('0.05 TUSD'),
            '404': problemResponse(
              '`series_not_found`: a `series_id` was sent and it does not cover that occupation.',
            ),
            '409': problemResponse(
              '`no_capacity_for_group`, `insufficient_capacity` or `series_not_open_for_binding`.',
            ),
            '503': problemResponse(
              '`index_unavailable`: no reading for that occupation, so cover cannot be priced.',
            ),
          },
        },
      },
      '/v1/bind': {
        post: {
          tags: ['cover'],
          operationId: 'bindPolicy',
          summary: 'Bind a quoted policy',
          description: [
            'Registers the policy in CoverPool, writes a receipt to the payments topic',
            'and mints the policy NFT to the holder wallet.',
            '',
            'The body is a quote id and nothing else: the amount, the wallet and the',
            'limit all come from the quote and from the eligibility credential, so a',
            'request cannot influence its own price.',
            '',
            'An eligibility credential is required. An agent gets one from its',
            'principal, after that person completes a World Selfie Check; the agent',
            'never performs the check itself, and the NFT is always minted to the',
            'principal wallet named in the credential.',
            '',
            'The credential is issued by POST /v1/world/verify, which forwards the',
            'complete IDKit result to World and checks it. That is the only issuer',
            'this API offers a person; it is not part of this gateway because a',
            'Selfie Check is completed in the World App and not by an agent.',
            '',
            'Price: the first month premium, taken from the quote. There is no static',
            'price for this operation.',
          ].join('\n'),
          parameters: [PAYMENT_SIGNATURE_HEADER],
          security: [{ eligibilityCredential: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BindRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'The bound policy.',
              headers: { 'PAYMENT-RESPONSE': PAYMENT_RESPONSE_HEADER },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } },
            },
            '400': problemResponse(
              '`validation_failed` for a missing `quote_id`, `body_required` or `body_malformed` for a body that is not JSON, or `credential_ambiguous` when the header and the body carry different credentials. Unlike the other two metered operations, these are refused before the payment: the price comes from the quote, so the body is read first.',
            ),
            '401': problemResponse(
              '`credential_missing`, `credential_invalid` or `credential_unknown`, which is a well-formed credential this API did not issue.',
            ),
            '402': paymentRequired('the first month premium from the quote'),
            '403': problemResponse('`credential_expired`. They last thirty minutes.'),
            '404': problemResponse(
              '`quote_not_found` or `series_not_found`. A quote that cannot be priced is refused before the 402, so the payer never signs anything.',
            ),
            '409': problemResponse(
              '`already_covered`, `credential_consumed`, `quote_consumed`, `wallet_mismatch`, `group_mismatch`, `series_mismatch`, `series_not_open_for_binding` or `insufficient_capacity`.',
            ),
            '410': problemResponse('`quote_expired`.'),
            '502': problemResponse('`chain_write_failed`: the pool refused the write.'),
            '503': problemResponse(
              '`hedera_not_configured`, the API has no Hedera keys and can neither publish a receipt nor mint one, or `upstream_unavailable`, the payment facilitator did not answer.',
            ),
          },
        },
      },
      '/v1/policy/{policyId}': {
        get: {
          tags: ['cover'],
          operationId: 'getPolicy',
          summary: 'A policy by its id',
          description: [
            'Free. The response carries the cover, the dates, the NFT serial, the HCS',
            'receipt sequence number and the bind transaction, and nothing that',
            'identifies the person.',
          ].join('\n'),
          parameters: [
            {
              name: 'policyId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^pol_[0-9A-HJKMNP-TV-Z]{26}$' },
              example: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
            },
          ],
          responses: {
            '200': {
              description: 'The policy.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } },
            },
            '400': problemResponse('`bad_id_prefix`: that is not a policy id.'),
            '404': problemResponse('`policy_not_found`.'),
          },
        },
      },
      '/v1/audit/{policyId}': {
        get: {
          tags: ['audit'],
          operationId: 'getAudit',
          summary: 'The audit trail for a policy, from the HCS topics',
          description: [
            'Free. Every message the payments topic and the claims topic carry for',
            'this policy, read back from the mirror node rather than from our',
            'database, each with its sequence number, its consensus timestamp and a',
            'HashScan link.',
            '',
            'The `source` on an entry says where it came from. `topic` is a message',
            'read back off the topic. `awaiting_mirror` is published and not yet',
            'visible on the mirror node, which lags consensus by seconds.',
            '`not_yet_on_topic` is a row with no message, which is what a settled',
            'payment whose publish failed looks like. `mirror_unavailable` is the',
            'mirror node not answering.',
            '',
            'Nothing here identifies a person. Claim entries carry hashes only.',
          ].join('\n'),
          parameters: [
            {
              name: 'policyId',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^pol_[0-9A-HJKMNP-TV-Z]{26}$' },
              example: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E',
            },
          ],
          responses: {
            '200': {
              description: 'The trail.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AuditTrail' } },
              },
            },
            '400': problemResponse('`bad_id_prefix`: that is not a policy id.'),
            '404': problemResponse('`policy_not_found`.'),
          },
        },
      },
      '/v1/series': {
        get: {
          tags: ['series'],
          operationId: 'listSeries',
          summary: 'Every Displacement Bond Note series this deployment serves',
          description: [
            'One series per occupation group that has capacity behind it. Free, and it',
            'reads no chain state: ask for the one series you are going to show.',
            '',
            '`has_note` is false where the series has capacity in the vault but no ATS',
            'note yet. Cover is buyable either way.',
          ].join('\n'),
          responses: {
            '200': {
              description: 'The series.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SeriesList' } },
              },
            },
          },
        },
      },
      '/v1/series/{seriesId}': {
        get: {
          tags: ['series'],
          operationId: 'getSeries',
          summary: 'A Displacement Bond Note series',
          description: [
            'The principal, the reserve, the paid claims and the noteholder positions,',
            'read from the chain. Free.',
            '',
            'It does not carry the frozen attachment and level line. Those are on the',
            'index: GET /v1/index/{group} answers them under `trigger`, and every',
            'observation on the index topic carries them too.',
          ].join('\n'),
          parameters: [
            {
              name: 'seriesId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              example: 'ODI-COMP-2026-01',
            },
          ],
          responses: {
            '200': {
              description: 'The series.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Series' } } },
            },
            '404': problemResponse('`series_not_found`.'),
          },
        },
      },
      '/v1/series/{seriesId}/coupons': {
        get: {
          tags: ['series'],
          operationId: 'getSeriesCoupons',
          summary: 'Every coupon declared on a series, with what was paid',
          description: 'Free.',
          parameters: [
            {
              name: 'seriesId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              example: 'ODI-COMP-2026-01',
            },
          ],
          responses: {
            '200': {
              description: 'The coupons.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SeriesCoupons' } },
              },
            },
            '404': problemResponse('`series_not_found`.'),
          },
        },
      },
      '/v1/market/offers': {
        get: {
          tags: ['market'],
          operationId: 'getOrderBook',
          summary: 'The order book',
          description: [
            'Free. Every offer ever made on the venue, newest first, with the venue',
            'address, the settlement asset and a count of each status.',
            '',
            'Filled and cancelled offers are in it by default. An order book showing',
            'only what is open would throw away the only record this system has of what',
            'a unit of a note last changed hands for, which is the number a holder',
            'deciding whether to sell actually wants. `status=open` narrows it.',
            '',
            "Naming a `buyer` adds `buyer_eligibility` to every offer: the note's own",
            'answer to whether that account may hold it. A screen greys its take button',
            'on that, and the note is what actually refuses.',
            '',
            'A deployment with no venue in its record answers an empty book rather than',
            'an error, because a venue that exists nowhere has no offers.',
          ].join('\n'),
          parameters: [
            {
              name: 'status',
              in: 'query',
              required: false,
              description: 'One status, or `all`, which is the default.',
              schema: { type: 'string', enum: ['all', 'open', 'filled', 'cancelled'] },
              example: 'open',
            },
            {
              name: 'series',
              in: 'query',
              required: false,
              description: 'One series, by its label, its id or its occupation group.',
              schema: { type: 'string' },
              example: 'ODI-ARTS-2026-01',
            },
            {
              name: 'holder',
              in: 'query',
              required: false,
              description:
                'Only offers this account made as a seller or took as a buyer. A demo role, a Hedera account id or an EVM address.',
              schema: { type: 'string' },
              example: '0.0.10366460',
            },
            {
              name: 'buyer',
              in: 'query',
              required: false,
              description:
                'An account a screen is about to offer a take button to. Adds `buyer_eligibility` to every offer.',
              schema: { type: 'string' },
              example: 'investor-1',
            },
          ],
          responses: {
            '200': {
              description: 'The book.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/OrderBook' } },
              },
            },
          },
        },
        post: {
          tags: ['market'],
          operationId: 'createOffer',
          summary: 'Offer a lot of note units at a price',
          description: [
            'Free. Raises the venue allowance on the note where it has to, then writes',
            'the offer, and answers the offer as the book now holds it with the',
            'transactions that made it.',
            '',
            'Nothing is escrowed. An offer is a standing instruction backed by an',
            'allowance, so a seller can move the units elsewhere or revoke the allowance',
            'and the offer stays on the book until it is taken or withdrawn. `readiness`',
            'on the offer reports whether the seller still holds the lot and whether the',
            'allowance is still in place, which is what a screen reads rather than',
            'guessing.',
            '',
            'The seller is named by its demo role and not by a key. This deployment',
            'signs only for the accounts in its own record, which is a demonstration',
            'posture and not a custody model; a deployment with no operator key answers',
            '503 here and serves the reads exactly as before.',
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/OfferRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'The offer, and the transactions that placed it.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Offer' } } },
            },
            '400': problemResponse(
              '`seller_missing` or `seller_unknown`, `series_missing` or `series_not_found`, `units_invalid` or `price_invalid` for anything that is not a whole number of minor units above nought.',
            ),
            '409': problemResponse(
              '`series_has_no_note`: that series has no note issued against it. `units_not_held`: the seller holds fewer units than the offer.',
            ),
            '503': problemResponse(
              '`market_writes_unavailable`: this deployment reads the market but cannot sign for an account.',
            ),
          },
        },
      },
      '/v1/market/offers/{id}': {
        get: {
          tags: ['market'],
          operationId: 'getOffer',
          summary: 'One offer',
          description: [
            'Free. The lot, the price, the parties, and what stands between the offer',
            'and a fill. `buyer` asks the note whether a named account may hold it.',
          ].join('\n'),
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'The offer id the venue gave it, counting from one.',
              schema: { type: 'integer', minimum: 1 },
              example: 1,
            },
            {
              name: 'buyer',
              in: 'query',
              required: false,
              description: 'An account to report `buyer_eligibility` for.',
              schema: { type: 'string' },
              example: 'investor-1',
            },
          ],
          responses: {
            '200': {
              description: 'The offer.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Offer' } } },
            },
            '400': problemResponse('`offer_id_invalid`: an offer id is a whole number of one or more.'),
            '404': problemResponse('`offer_not_found`.'),
          },
        },
      },
      '/v1/market/offers/{id}/fill': {
        post: {
          tags: ['market'],
          operationId: 'fillOffer',
          summary: 'Take an offer',
          description: [
            'Free. One transaction carries both legs, the note first and the settlement',
            'token second, so either both move or neither does and there is no state in',
            'which one side has been paid and the other has not.',
            '',
            "The compliance gate is the note's, and this is the operation it gates. A",
            'buyer with no granted KYC record on that note is refused with 409',
            '`fill_refused` before anything is signed, because a fill the note will',
            'refuse reverts the whole transaction and the buyer would still have paid',
            'for the approval that preceded it. Where a call does get past the read, the',
            'note reverts it and the revert reason is the same answer. Neither path is',
            'this API softening or re-implementing the check: the register is the',
            "note's own and there is no allow list here.",
            '',
            'A fill is whole lot. There is no partial fill and so no price rounding to',
            'argue about.',
          ].join('\n'),
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              example: 1,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/FillRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'The offer as it now stands, and the transactions that settled it.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Offer' } } },
            },
            '400': problemResponse('`buyer_missing` or `buyer_unknown`.'),
            '404': problemResponse('`offer_not_found`.'),
            '409': problemResponse(
              '`fill_refused`, which is the note refusing the transfer and carries the reason it refused with, `offer_not_open`, `seller_cannot_fill`, or `insufficient_settlement_balance`.',
            ),
            '503': problemResponse('`market_writes_unavailable`.'),
          },
        },
      },
      '/v1/market/offers/{id}/cancel': {
        post: {
          tags: ['market'],
          operationId: 'cancelOffer',
          summary: 'Withdraw an offer',
          description:
            'Free. Only the account that made an offer can withdraw it, and the venue holds nothing to give back: the units never left the seller.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 },
              example: 1,
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CancelRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'The offer, withdrawn, and the transaction that withdrew it.',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Offer' } } },
            },
            '400': problemResponse('`seller_missing` or `seller_unknown`.'),
            '403': problemResponse('`not_the_seller`.'),
            '404': problemResponse('`offer_not_found`.'),
            '503': problemResponse('`market_writes_unavailable`.'),
          },
        },
      },
      '/v1/market/positions/{holder}': {
        get: {
          tags: ['market'],
          operationId: 'getPositions',
          summary: 'What an account holds and what it has traded',
          description: [
            'Free. Every note this account holds a unit of, its settlement balance, and',
            'the offers it has open as a seller or filled as a buyer.',
            '',
            'A note with a zero balance is not a position and is not returned. Each',
            "position carries the note's own KYC record for this account, which is what",
            'decides whether the account can receive a unit of that note at all.',
          ].join('\n'),
          parameters: [
            {
              name: 'holder',
              in: 'path',
              required: true,
              description: 'A demo role, a Hedera account id or an EVM address.',
              schema: { type: 'string' },
              example: '0.0.10366460',
            },
          ],
          responses: {
            '200': {
              description: 'The positions.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Positions' } },
              },
            },
            '404': problemResponse(
              '`holder_not_found`: name a holder by its demo role, its account id or its EVM address.',
            ),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        eligibilityCredential: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: [
            'A short-lived eligibility credential, EdDSA over Ed25519, thirty minutes,',
            'carrying the nullifier, the occupation group, the series and the wallet.',
            'Verify it against GET /.well-known/jwks.json. An agent gets one from its',
            'principal after that person completes a World Selfie Check; the issuer is',
            'POST /v1/world/verify.',
          ].join(' '),
        },
      },
      schemas: {
        Money: MONEY,
        Problem: PROBLEM,
        PaymentRequired: PAYMENT_REQUIRED_BODY,
        AuditTrail: {
          type: 'object',
          description:
            'The audit trail for one policy. DESIGN.md 3.7: verifiable independently of this API, because every entry names the topic, the sequence number and the transaction.',
          required: ['policy_id', 'summary', 'entries'],
          properties: {
            policy_id: { type: 'string', example: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E' },
            series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
            group: { type: 'string', enum: GROUP_KEYS },
            status: { type: 'string', example: 'bound' },
            summary: {
              type: 'object',
              properties: {
                payments_topic: { $ref: '#/components/schemas/AuditLink' },
                claims_topic: { $ref: '#/components/schemas/AuditLink' },
                policy_nft: {
                  type: 'object',
                  properties: {
                    token_id: { type: 'string', nullable: true, example: '0.0.10366468' },
                    serial: { type: 'integer', nullable: true, example: 6 },
                    hashscan: { type: 'string', nullable: true },
                  },
                },
                bind_transaction: { $ref: '#/components/schemas/AuditLink' },
                cover_pool: { $ref: '#/components/schemas/AuditLink' },
                entries: { type: 'integer', example: 4 },
                entries_on_topic: { type: 'integer', example: 4 },
              },
            },
            entries: { type: 'array', items: { $ref: '#/components/schemas/AuditEntry' } },
          },
        },
        AuditLink: {
          type: 'object',
          nullable: true,
          description: 'An id and the HashScan page for it.',
          properties: {
            id: { type: 'string', example: '0.0.10366471' },
            hashscan: {
              type: 'string',
              example: 'https://hashscan.io/testnet/topic/0.0.10366471',
            },
          },
        },
        AuditEntry: {
          type: 'object',
          required: ['kind', 'source'],
          properties: {
            kind: {
              type: 'string',
              description:
                'The message kind. `policy` is the receipt the bind quoted and its outcome, `settlement` an x402 payment, `premium` a scheduled monthly premium, `coupon` a note coupon, `payout` a claim payment, `claim_packet` and `claim_decision` the two claims topic hashes, `unknown` a kind written by something newer than this reader.',
              enum: [
                'policy',
                'settlement',
                'premium',
                'coupon',
                'payout',
                'claim_packet',
                'claim_decision',
                'unknown',
              ],
            },
            source: {
              type: 'string',
              enum: ['topic', 'awaiting_mirror', 'not_yet_on_topic', 'mirror_unavailable'],
            },
            at: { type: 'string', format: 'date-time', nullable: true },
            amount: { $ref: '#/components/schemas/Money' },
            hcs: {
              type: 'object',
              nullable: true,
              properties: {
                topic_id: { type: 'string', example: '0.0.10366471' },
                sequence_number: { type: 'integer', nullable: true, example: 18 },
                consensus_at: { type: 'string', format: 'date-time', nullable: true },
                hashscan: { type: 'string' },
              },
            },
            tx: { $ref: '#/components/schemas/AuditLink' },
            detail: {
              type: 'object',
              description:
                'The fields this kind carries, named one by one per kind and never a copy of the message.',
              additionalProperties: true,
            },
          },
        },
        QuoteRequest: {
          type: 'object',
          required: ['group', 'limit', 'wallet'],
          properties: {
            group: { type: 'string', enum: GROUP_KEYS, example: 'computer_math' },
            limit: {
              type: 'string',
              description:
                'The cover limit in the settlement asset smallest unit. 1,000 to 10,000 in steps of 500.',
              example: '5000000000',
            },
            wallet: {
              type: 'string',
              description: 'The policyholder Hedera account id.',
              example: '0.0.10366453',
            },
            series_id: {
              type: 'string',
              description: 'Optional. When absent the API picks the active series for the group.',
              example: 'ODI-COMP-2026-01',
            },
            band: {
              type: 'string',
              enum: ['0_5', '5_25', '25_plus'],
              description:
                'Optional. Years of experience, as one of three bands. It changes the price and nothing else: the trigger, the settlement and the payout are identical in every band, because the published unemployment data has no occupation-by-age series and cannot measure a difference between them. What it changes is which capital the cover is written against, and so the capacity term of the rate. A band no capital has committed to is refused with `band_not_funded` rather than priced. Omit it to be priced against the capital that has named no band.',
              example: '5_25',
            },
          },
        },
        Quote: {
          type: 'object',
          required: ['quote_id', 'series_id', 'group', 'limit', 'premium', 'expires_at'],
          properties: {
            quote_id: { type: 'string', example: 'qte_01K4YBB2R9F3M0N7X5T8W1C4Q6' },
            series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
            group: { type: 'string', enum: GROUP_KEYS },
            band: {
              type: 'string',
              nullable: true,
              enum: ['0_5', '5_25', '25_plus', null],
              description: 'The experience band the price was struck in, or null for none.',
            },
            wallet: { type: 'string', example: '0.0.10366453' },
            limit: { $ref: '#/components/schemas/Money' },
            premium: { $ref: '#/components/schemas/Money' },
            annual_rate_bps: { type: 'integer', example: 2311 },
            pricing_basis: {
              type: 'object',
              description: 'Every assumption behind the rate, so nothing has to be taken on trust.',
            },
            term_months: { type: 'integer', example: 12 },
            waiting_period_days: { type: 'integer', example: 60 },
            cover_starts: { type: 'string', format: 'date' },
            cover_ends: { type: 'string', format: 'date' },
            claims_payable_from: { type: 'string', format: 'date' },
            first_payment_due: { type: 'string', format: 'date' },
            pays_from: { type: 'string', example: '0.0.10366453' },
            attachment_shock: {
              type: 'string',
              description: 'Percentage points, as a decimal string.',
              example: '2.00',
            },
            level_line: {
              type: 'string',
              description: 'Percentage points. Often negative, which is correct.',
              example: '-0.68',
            },
            payout_mode: { type: 'string', enum: ['full', 'indexed'] },
            capacity: {
              type: 'object',
              properties: {
                free_before: { type: 'string' },
                free_after: { type: 'string' },
                used_pct: { type: 'integer' },
              },
            },
            expires_at: { type: 'string', format: 'date-time' },
            issued_via: {
              type: 'string',
              description:
                'How the caller satisfied the gate. Always `x402` while the gate is on, which is how this API runs. The other two are what a build with the gate turned off records.',
              enum: ['x402', 'credential', 'open'],
            },
          },
        },
        BindRequest: {
          type: 'object',
          required: ['quote_id'],
          properties: {
            quote_id: { type: 'string', example: 'qte_01K4YBB2R9F3M0N7X5T8W1C4Q6' },
            eligibility: {
              type: 'string',
              description:
                'The eligibility credential, when a client cannot set the Authorization header. Sending both is refused unless they are identical.',
            },
          },
        },
        Policy: {
          type: 'object',
          required: ['policy_id', 'series_id', 'status', 'limit', 'premium'],
          properties: {
            policy_id: { type: 'string', example: 'pol_01K4YB9X3M8Q0RZ7T2VD6C5H9E' },
            series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
            group: { type: 'string', enum: GROUP_KEYS },
            status: {
              type: 'string',
              enum: [
                'binding',
                'bound',
                'active',
                'payment_failed',
                'lapsed',
                'claims_open',
                'claimed',
                'under_review',
                'approved',
                'paid',
                'declined',
                'expired',
                'void',
              ],
            },
            limit: { $ref: '#/components/schemas/Money' },
            premium: { $ref: '#/components/schemas/Money' },
            cover_starts: { type: 'string', format: 'date' },
            cover_ends: { type: 'string', format: 'date' },
            claims_payable_from: { type: 'string', format: 'date' },
            next_payment_due: { type: 'string', format: 'date', nullable: true },
            paid_through: { type: 'string', example: '2026-09' },
            holder_account: { type: 'string', example: '0.0.10366453' },
            nft: {
              type: 'object',
              properties: {
                token_id: { type: 'string', nullable: true, example: '0.0.10366468' },
                serial: { type: 'integer', nullable: true, example: 3 },
              },
            },
            hcs_receipt: {
              type: 'object',
              description:
                'The payments topic message that records the bind. Verify it on the mirror node at GET /topics/{topic_id}/messages?sequencenumber=eq:{sequence_number}.',
              properties: {
                topic_id: { type: 'string', nullable: true, example: '0.0.10366471' },
                sequence_number: { type: 'integer', nullable: true, example: 41 },
              },
            },
            chain: {
              type: 'object',
              properties: {
                cover_pool: { type: 'string' },
                bind_transaction: { type: 'string', nullable: true },
                hashscan: { type: 'string', nullable: true },
              },
            },
            premium_schedule: {
              type: 'object',
              properties: { status: { type: 'string' }, href: { type: 'string' } },
            },
          },
        },
        SeriesList: {
          type: 'object',
          description:
            'Every series this deployment serves, in the order they were issued. The first is the demo series.',
          required: ['network', 'count', 'series'],
          properties: {
            network: { type: 'string', example: 'testnet' },
            count: { type: 'integer', example: 15 },
            series: {
              type: 'array',
              items: {
                type: 'object',
                required: ['series_id', 'series_key', 'group', 'matures_at', 'has_note'],
                properties: {
                  series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
                  series_key: {
                    type: 'string',
                    description: 'The bytes32 key the contracts take.',
                    example:
                      '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
                  },
                  group: { type: 'string', enum: GROUP_KEYS },
                  matures_at: { type: 'string', format: 'date-time' },
                  has_note: { type: 'boolean' },
                  links: {
                    type: 'object',
                    properties: {
                      self: { type: 'string', example: '/v1/series/ODI-COMP-2026-01' },
                      coupons: { type: 'string', example: '/v1/series/ODI-COMP-2026-01/coupons' },
                    },
                  },
                },
              },
            },
          },
        },
        Series: {
          type: 'object',
          description:
            'A Displacement Bond Note series as the chain holds it: the vault that carries the principal, the note the investors hold, the pool that registers the cover, and the coupon summary.',
          required: ['series_id', 'group', 'settlement_asset', 'vault', 'note', 'cover_pool'],
          properties: {
            series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
            series_key: {
              type: 'string',
              description: 'The series id as the bytes32 the contracts index on.',
              example: '0x4f44492d434f4d502d323032362d303100000000000000000000000000000000',
            },
            group: { type: 'string', enum: GROUP_KEYS },
            network: { type: 'string', example: 'testnet' },
            settlement_asset: { $ref: '#/components/schemas/SettlementAsset' },
            vault: {
              type: 'object',
              description:
                'CollateralVault. Every amount is Money. `principal_free` is what is left to sell cover against once the reserve and the paid claims are taken off.',
              properties: {
                address: { type: 'string' },
                contract_id: { type: 'string', example: '0.0.10367194' },
                matures_at: { type: 'string', format: 'date-time' },
                principal_funded: { $ref: '#/components/schemas/Money' },
                principal_paid: { $ref: '#/components/schemas/Money' },
                principal_reserved: { $ref: '#/components/schemas/Money' },
                principal_redeemed: { $ref: '#/components/schemas/Money' },
                principal_remaining: { $ref: '#/components/schemas/Money' },
                principal_free: { $ref: '#/components/schemas/Money' },
                premium_balance: { $ref: '#/components/schemas/Money' },
                hashscan: { type: 'string' },
              },
            },
            note: {
              type: 'object',
              description: 'The ERC-3643 bond token issued through the Asset Tokenization Studio.',
              properties: {
                contract_id: { type: 'string', example: '0.0.10368240' },
                address: { type: 'string' },
                name: { type: 'string' },
                symbol: { type: 'string', example: 'CDBN01' },
                decimals: { type: 'integer', example: 6 },
                total_supply: { type: 'string' },
                units: { type: 'string' },
                matures_at: { type: 'string', format: 'date-time' },
                paused: { type: 'boolean' },
                hashscan: { type: 'string' },
              },
            },
            holders: {
              type: 'array',
              description: 'The noteholders, their positions and their KYC standing.',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', example: 'investor-1' },
                  account_id: { type: 'string', example: '0.0.10366460' },
                  address: { type: 'string' },
                  note_balance: { type: 'string' },
                  note_frozen: { type: 'string' },
                  note_position: { type: 'string' },
                  note_units: { type: 'string' },
                  subscription: { $ref: '#/components/schemas/Money' },
                  kyc: {
                    type: 'object',
                    properties: {
                      status: { type: 'integer', example: 1 },
                      granted: { type: 'boolean' },
                    },
                  },
                  hashscan: { type: 'string' },
                },
              },
            },
            cover_pool: {
              type: 'object',
              description: 'CoverPool. The capacity a quote is checked against.',
              properties: {
                address: { type: 'string' },
                contract_id: { type: 'string', example: '0.0.10367199' },
                registered: { type: 'boolean' },
                active_exposure: { $ref: '#/components/schemas/Money' },
                exposure_covered: { $ref: '#/components/schemas/Money' },
                capacity_used_percent: { type: 'integer', example: 17 },
                term_seconds: { type: 'integer', example: 31536000 },
                term_months: { type: 'integer', example: 12 },
                hashscan: { type: 'string' },
              },
            },
            coupons: {
              type: 'object',
              description: 'A summary. The coupons themselves are the next operation.',
              properties: {
                count: { type: 'integer', example: 1 },
                settled: { type: 'integer', example: 1 },
                latest_coupon_id: { type: 'string', nullable: true, example: '1' },
                rate_percent: { type: 'string', example: '8' },
              },
            },
            links: {
              type: 'object',
              properties: {
                coupons: { type: 'string', example: '/v1/series/ODI-COMP-2026-01/coupons' },
                payments_topic: {
                  type: 'string',
                  example: 'https://hashscan.io/testnet/topic/0.0.10366471',
                },
              },
            },
          },
        },
        SeriesCoupons: {
          type: 'object',
          description:
            'Every coupon declared on the series, each with the holders it was owed to and how it was paid.',
          required: ['series_id', 'coupons'],
          properties: {
            series_id: { type: 'string', example: 'ODI-COMP-2026-01' },
            series_key: { type: 'string' },
            settlement_asset: { $ref: '#/components/schemas/SettlementAsset' },
            payments_topic: { type: 'string' },
            coupons: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  coupon_id: { type: 'string', example: '1' },
                  coupon_ref: { type: 'string', example: 'ODI-COMP-2026-01#1' },
                  rate_percent: { type: 'string', example: '8' },
                  rate_bps: { type: 'integer', example: 800 },
                  accrual_start: { type: 'string', format: 'date-time' },
                  accrual_end: { type: 'string', format: 'date-time' },
                  record_date: { type: 'string', format: 'date-time' },
                  execution_date: { type: 'string', format: 'date-time' },
                  declared_by: { type: 'string', example: 'ats_corporate_action' },
                  paid_by: { type: 'string', example: 'hedera_scheduled_transaction' },
                  total: { $ref: '#/components/schemas/Money' },
                  holders: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        role: { type: 'string' },
                        account_id: { type: 'string' },
                        address: { type: 'string' },
                        entitlement: {
                          type: 'object',
                          description:
                            'The exact fraction the holder is owed, kept as a numerator and a denominator so nothing is rounded before the division.',
                          properties: {
                            numerator: { type: 'string' },
                            denominator: { type: 'string' },
                            record_date_reached: { type: 'boolean' },
                          },
                        },
                        amount: { $ref: '#/components/schemas/Money' },
                        remainder: { type: 'string' },
                        settlement: {
                          type: 'object',
                          description:
                            'The Scheduled Transaction that paid it, and the payments topic message that recorded it.',
                          properties: {
                            schedule_id: { type: 'string', example: '0.0.10368878' },
                            schedule_memo: { type: 'string' },
                            transaction_id: { type: 'string' },
                            result: { type: 'string', example: 'SUCCESS' },
                            settled: { type: 'boolean' },
                            paid_at: { type: 'string', format: 'date-time', nullable: true },
                            topic_sequence_number: { type: 'string', nullable: true },
                            hashscan: {
                              type: 'object',
                              properties: {
                                schedule: { type: 'string' },
                                transaction: { type: 'string' },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        MarketParty: {
          type: 'object',
          nullable: true,
          description:
            'An account on the venue. `role` and `account_id` are null for an address the deployment record has never named.',
          required: ['address'],
          properties: {
            role: { type: 'string', nullable: true, example: 'investor-1' },
            account_id: { type: 'string', nullable: true, example: '0.0.10366460' },
            address: { type: 'string', example: '0xb6c2ff466e3c73f1a49a3f1b936f8e3837112931' },
            hashscan: { type: 'string' },
          },
        },
        Offer: {
          type: 'object',
          description:
            "One offer on the venue. Amounts are Money, and `units` is in the note's own minor units, which carries the same six decimals as the settlement asset by design so a price never has to be rescaled between the two legs of a fill.",
          required: ['offer_id', 'status', 'units', 'price', 'seller', 'opened_at'],
          properties: {
            offer_id: { type: 'string', example: '1' },
            status: { type: 'string', enum: ['open', 'filled', 'cancelled', 'unknown'] },
            series_id: { type: 'string', nullable: true, example: 'ODI-ARTS-2026-01' },
            series_key: { type: 'string', nullable: true },
            group: { type: 'string', nullable: true, enum: [...GROUP_KEYS, null] },
            note: {
              type: 'object',
              properties: {
                address: { type: 'string' },
                contract_id: { type: 'string', nullable: true, example: '0.0.10455865' },
                symbol: { type: 'string', nullable: true, example: 'CDBN02' },
                decimals: { type: 'integer', example: 6 },
                hashscan: { type: 'string' },
              },
            },
            seller: { $ref: '#/components/schemas/MarketParty' },
            buyer: { $ref: '#/components/schemas/MarketParty' },
            units: { type: 'string', example: '5000000' },
            units_whole: { type: 'string', example: '5' },
            price: { $ref: '#/components/schemas/Money' },
            price_per_unit: { $ref: '#/components/schemas/Money' },
            opened_at: { type: 'string', format: 'date-time' },
            closed_at: { type: 'string', format: 'date-time', nullable: true },
            readiness: {
              type: 'object',
              nullable: true,
              description:
                'What stands between this offer and a fill, read off the chain rather than assumed. Null on an offer that is not open, because a closed offer cannot become fillable again. None of it is a compliance verdict: that is `buyer_eligibility`.',
              properties: {
                open: { type: 'boolean' },
                seller_holds: { type: 'boolean' },
                seller_approved: { type: 'boolean' },
              },
            },
            buyer_eligibility: {
              type: 'object',
              nullable: true,
              description:
                "Whether a named would-be buyer may hold this note at all. Present only when the request named a buyer. It is the note's own KYC register read back and nothing of this API.",
              properties: {
                address: { type: 'string' },
                role: { type: 'string', nullable: true },
                kyc_granted: { type: 'boolean' },
                reason: { type: 'string', nullable: true },
              },
            },
            transactions: {
              type: 'object',
              description:
                'The transactions a write made, present on the answer to POST and never on a read. `approve` is null where the allowance was already in place.',
              properties: {
                approve: { type: 'string', nullable: true },
                offer: { type: 'string' },
                fill: { type: 'string' },
                cancel: { type: 'string' },
              },
            },
            gas_used: {
              type: 'string',
              description: 'The gas a fill used. Present on the answer to a fill and nowhere else.',
              example: '564330',
            },
            hashscan: { type: 'string' },
          },
        },
        OrderBook: {
          type: 'object',
          required: ['network', 'settlement_asset', 'offers', 'counts'],
          properties: {
            network: { type: 'string', example: 'testnet' },
            market: {
              type: 'object',
              nullable: true,
              description: 'The venue, or null on a deployment where it was never deployed.',
              properties: {
                address: { type: 'string' },
                contract_id: { type: 'string', nullable: true, example: '0.0.10495570' },
                hashscan: { type: 'string' },
              },
            },
            settlement_asset: { $ref: '#/components/schemas/SettlementAsset' },
            offers: { type: 'array', items: { $ref: '#/components/schemas/Offer' } },
            counts: {
              type: 'object',
              description: 'Counted over the offers this request returned, not over the venue.',
              properties: {
                total: { type: 'integer' },
                open: { type: 'integer' },
                filled: { type: 'integer' },
                cancelled: { type: 'integer' },
              },
            },
          },
        },
        Position: {
          type: 'object',
          description:
            'What one account holds of one note. `units` is what the note reports as spendable and `units_frozen` what is frozen; `units_position` is the two added together, which is the holding.',
          required: ['series_id', 'group', 'units', 'units_position', 'kyc'],
          properties: {
            series_id: { type: 'string', example: 'ODI-OFFC-2026-01' },
            series_key: { type: 'string' },
            group: { type: 'string', enum: GROUP_KEYS },
            note: {
              type: 'object',
              properties: {
                address: { type: 'string' },
                contract_id: { type: 'string', nullable: true, example: '0.0.10455865' },
                symbol: { type: 'string', nullable: true, example: 'CDBN02' },
                decimals: { type: 'integer', example: 6 },
                hashscan: { type: 'string' },
              },
            },
            units: { type: 'string' },
            units_frozen: { type: 'string' },
            units_position: { type: 'string' },
            units_whole: { type: 'string', example: '5' },
            kyc: {
              type: 'object',
              description:
                "The note's own internal KYC register. Without a granted record this account cannot receive a unit of this note at all, whatever it offers.",
              properties: {
                status: { type: 'integer', example: 1 },
                granted: { type: 'boolean' },
              },
            },
          },
        },
        Positions: {
          type: 'object',
          required: ['network', 'holder', 'settlement_balance', 'positions', 'offers'],
          properties: {
            network: { type: 'string', example: 'testnet' },
            holder: { $ref: '#/components/schemas/MarketParty' },
            settlement_balance: { $ref: '#/components/schemas/Money' },
            positions: {
              type: 'array',
              description: 'Only the series this account holds a unit of.',
              items: { $ref: '#/components/schemas/Position' },
            },
            offers: {
              type: 'array',
              description:
                'The offers this account has open as a seller and the ones it has filled as a buyer, newest first.',
              items: { $ref: '#/components/schemas/Offer' },
            },
          },
        },
        OfferRequest: {
          type: 'object',
          required: ['seller', 'series', 'units', 'price'],
          properties: {
            seller: {
              type: 'string',
              description:
                'The account making the offer, by the demo role this deployment signs for. It signs for nothing else.',
              example: 'investor-1',
            },
            series: {
              type: 'string',
              description: 'The series whose note is being offered, by label, id or group.',
              example: 'ODI-OFFC-2026-01',
            },
            units: {
              type: 'string',
              description: "The lot, an integer in the note's smallest unit. 5 units is 5000000.",
              example: '5000000',
            },
            price: {
              type: 'string',
              description:
                'What the whole lot costs, an integer in the settlement asset smallest unit. The lot is taken entire or not at all.',
              example: '5000000000',
            },
          },
        },
        FillRequest: {
          type: 'object',
          required: ['buyer'],
          properties: {
            buyer: {
              type: 'string',
              description: 'The account taking the offer, by the demo role.',
              example: 'investor-2',
            },
          },
        },
        CancelRequest: {
          type: 'object',
          required: ['seller'],
          properties: {
            seller: {
              type: 'string',
              description:
                'The account that made the offer. Nobody else can withdraw it.',
              example: 'investor-1',
            },
          },
        },
        SettlementAsset: {
          type: 'object',
          description: 'The HTS token every amount on this series is denominated in.',
          properties: {
            token_id: { type: 'string', example: '0.0.10366463' },
            address: { type: 'string' },
            decimals: { type: 'integer', example: 6 },
            symbol: { type: 'string', example: 'TUSD' },
          },
        },
        ...INDEX_SCHEMAS,
      },
    },
  };
}
