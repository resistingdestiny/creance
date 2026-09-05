/// The pieces both OpenAPI documents are built from.
///
/// There are two documents. recipes/bazantic/openapi.yaml is the whole product
/// gateway, quote and bind and the reads around them. recipes/bazantic/agentify/
/// openapi.yaml is the index feed on its own, imported as a gateway of its own,
/// because the feed is a product in its own right and not an endpoint of this
/// one. Two documents that describe the same operation differently would be
/// worse than one document that describes too much, so everything they share
/// is here and neither of them restates it.
///
/// OpenAPI 3.0.3, and nothing exotic in the schemas: no top level `oneOf` in a
/// request body, no recursive `$ref`, money as an object of three strings and
/// one integer. Every importer accepts 3.0, and 3.1's JSON Schema alignment
/// buys these documents nothing. A test enforces the absence of `allOf`,
/// `anyOf` and `oneOf` in both.

export const PUBLIC_ORIGIN = 'https://creance.co';

/**
 * The version both documents carry.
 *
 * Here rather than in the generator script because the API serves the index
 * document at runtime as well as writing it to a file, and a served document
 * that versions itself differently from the committed one is the sort of
 * difference nobody notices until an importer has both.
 */
export const DOCUMENT_VERSION = '0.1.0';

export const MONEY = {
  type: 'object',
  required: ['amount', 'asset', 'decimals', 'display'],
  properties: {
    amount: {
      type: 'string',
      description: 'An integer in the asset smallest unit. 28.00 TUSD is 28000000.',
      example: '28000000',
    },
    asset: { type: 'string', description: 'The HTS token id.', example: '0.0.10366463' },
    decimals: { type: 'integer', example: 6 },
    display: {
      type: 'string',
      description: 'For a human reading the JSON. Never parsed.',
      example: '28.00',
    },
  },
};

export const PROBLEM = {
  type: 'object',
  description: 'RFC 9457 problem document. Every non-2xx response has this shape.',
  required: ['type', 'title', 'status', 'code', 'request_id', 'retryable'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    code: {
      type: 'string',
      description: 'The machine-readable reason. Switch on this, never on detail.',
      example: 'insufficient_capacity',
    },
    request_id: { type: 'string' },
    retryable: { type: 'boolean' },
  },
};

export const GROUP_KEYS = [
  'management_business_financial',
  'professional_related',
  'service',
  'sales_related',
  'office_admin_support',
  'farming_fishing_forestry',
  'construction_extraction',
  'installation_maintenance_repair',
  'production',
  'transportation_material_moving',
  'computer_math',
  'legal',
  'arts_design_ent_media',
  'business_financial_ops',
  'education_training_library',
];

export const PAYMENT_SIGNATURE_HEADER = {
  name: 'PAYMENT-SIGNATURE',
  in: 'header',
  required: false,
  description:
    'x402 version 2 payment payload, network hedera:testnet, scheme exact. Required: an unpaid call is refused with 402.',
  schema: { type: 'string' },
};

export const PAYMENT_RESPONSE_HEADER = {
  description: [
    'x402 version 2 settlement receipt, base64 of a JSON object with `success`,',
    '`transaction`, `network` and `payer`. The transaction id starts with the',
    'facilitator fee payer account, not with the payer, because the facilitator',
    'pays the Hedera fee; that is the id to look up on HashScan.',
  ].join(' '),
  schema: { type: 'string' },
  example:
    'eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjAuMC43MTYyNzg0QDE3ODg2MTI3MDYuNTY3NjkyNjIzIn0=',
};

export const PAYMENT_REQUIRED_HEADER = {
  description: [
    'x402 version 2 payment requirements for this resource, base64 of the JSON',
    '`{"x402Version":2,"error":"Payment required","resource":{...},"accepts":[{"scheme":"exact",',
    '"network":"hedera:testnet","amount":"10000","asset":"0.0.10366463","payTo":"0.0.10366450",',
    '"maxTimeoutSeconds":60,"extra":{"feePayer":"0.0.7162784"}}]}`. The body carries the same',
    'terms in readable fields.',
  ].join(' '),
  schema: { type: 'string' },
};

/// The 402 body, which is not the plain problem document the other refusals
/// return: it repeats the price and the payment terms as readable fields,
/// because the person debugging an agent reads the body and not the base64
/// header. Written out field by field rather than composed with `allOf`, which
/// an importer is free to flatten badly.
export const PAYMENT_REQUIRED_BODY = {
  type: 'object',
  description: 'RFC 9457 problem document with the x402 terms repeated in readable fields.',
  required: [
    'type',
    'title',
    'status',
    'code',
    'retryable',
    'price',
    'x402_version',
    'scheme',
    'network',
    'pay_to',
    'facilitator',
  ],
  properties: {
    ...PROBLEM.properties,
    code: { type: 'string', example: 'payment_required' },
    price: { $ref: '#/components/schemas/Money' },
    x402_version: { type: 'integer', example: 2 },
    scheme: { type: 'string', example: 'exact' },
    network: { type: 'string', example: 'hedera:testnet' },
    pay_to: {
      type: 'string',
      description: 'The Hedera account the transfer has to credit.',
      example: '0.0.10366450',
    },
    facilitator: {
      type: 'string',
      description: 'The x402 facilitator that settles the transfer.',
      example: 'https://api.testnet.blocky402.com',
    },
  },
};

export function paymentRequired(price: string): Record<string, unknown> {
  return {
    description: `Payment required. Price ${price}.`,
    headers: { 'PAYMENT-REQUIRED': PAYMENT_REQUIRED_HEADER },
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/PaymentRequired' } },
    },
  };
}

export function problemResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  };
}

/// The index reading and one month of it, shared because both documents serve
/// the same response from the same handler.
export const INDEX_SCHEMAS = {
  IndexReading: {
    type: 'object',
    required: ['group', 'as_of', 'reading', 'trigger', 'history'],
    properties: {
      group: { type: 'string', enum: GROUP_KEYS },
      group_label: { type: 'string', example: 'Computer and mathematical' },
      series_id: { type: 'string', nullable: true, example: 'ODI-COMP-2026-01' },
      as_of: { type: 'string', example: '2026-07' },
      reading: { $ref: '#/components/schemas/Observation' },
      trigger: {
        type: 'object',
        properties: {
          attachment_shock: { type: 'string', example: '2.00' },
          level_line: { type: 'string', example: '-0.68' },
          open: { type: 'boolean' },
          open_reason: {
            type: 'string',
            nullable: true,
            enum: ['shock', 'level', 'both', null],
          },
          shock_margin: {
            type: 'string',
            nullable: true,
            description: 'The ODI less the shock attachment.',
          },
          level_margin: {
            type: 'string',
            nullable: true,
            description: 'The smoothed excess less the level line.',
          },
        },
      },
      headline: {
        type: 'object',
        nullable: true,
        description:
          'Whichever form is nearer its line, chosen here so two screens cannot choose differently.',
        properties: {
          form: { type: 'string', enum: ['shock', 'level'] },
          distance: { type: 'string', example: '-0.08' },
          on_the_line: { type: 'boolean' },
          open: { type: 'boolean' },
        },
      },
      history: {
        type: 'array',
        description: 'Up to twenty-four months, oldest first.',
        items: { $ref: '#/components/schemas/Observation' },
      },
      source: {
        type: 'object',
        properties: {
          series: { type: 'string', nullable: true, example: 'bls:LNU04032215' },
          hash: {
            type: 'string',
            nullable: true,
            description:
              'sha256 over the source rows the observation was computed from, in canonical JSON.',
          },
          model_version: { type: 'string' },
          replay: { type: 'boolean' },
        },
      },
      publication: {
        type: 'object',
        description:
          'Where the observation was published. Null until the index oracle publishes it.',
        properties: {
          topic_id: { type: 'string', nullable: true },
          sequence_number: { type: 'integer', nullable: true },
          submit_transaction: { type: 'string', nullable: true },
        },
      },
      updated_at: { type: 'string', format: 'date-time' },
    },
  },
  Observation: {
    type: 'object',
    description:
      'One month. Every index value is a decimal string in percentage points, never a JSON number, because on chain they are int64 scaled by 1e4.',
    properties: {
      period: { type: 'string', example: '2026-07' },
      u_g: { type: 'string', nullable: true, example: '4.10' },
      u_all: { type: 'string', nullable: true, example: '4.50' },
      e: { type: 'string', nullable: true, example: '-0.40' },
      ebar: { type: 'string', nullable: true, example: '-0.60' },
      odi: { type: 'string', nullable: true, example: '0.30' },
      open: { type: 'boolean' },
      open_reason: { type: 'string', nullable: true, enum: ['shock', 'level', 'both', null] },
    },
  },
};

export interface DocumentOptions {
  version: string;
  /** The local server, for a judge running the API from a clean clone. */
  localUrl?: string;
}
