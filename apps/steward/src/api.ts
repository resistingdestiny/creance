import { readSettlement, type X402Payer, type X402Settlement } from '@creance/client';

/// The four endpoints, from the paying side.
///
/// Three of them are x402 gated (DESIGN.md 3.7) and one is free. The payer is
/// the wrapped fetch from packages/client: it makes the call, reads the 402,
/// builds and partially signs a `TransferTransaction` for exactly the
/// advertised amount, retries with the `PAYMENT-SIGNATURE` header and hands
/// back the 200. It never touches `Authorization`, which is where the bind
/// carries the eligibility credential.
///
/// Every paid call returns its settlement beside the body, because the
/// settlement transaction id is the evidence: it goes in the transcript, in the
/// journal and into HashScan.

/** Only the fields the agent reads. The endpoint returns more. */
export interface IndexResponse {
  group: string;
  as_of: string;
  reading: { period: string; odi: string | null; ebar: string | null };
  trigger: { open: boolean; open_reason: string | null; level_line: string; attachment_shock: string };
  history: { period: string; odi: string | null }[];
}

export interface Amount {
  amount: string;
  asset: string;
  decimals: number;
  display: string;
}

export interface QuoteResponse {
  quote_id: string;
  series_id: string;
  premium: Amount;
  limit: Amount;
  term_months: number;
  expires_at: string;
  capacity: { free_before: string; free_after: string; used_pct: number };
}

export interface PolicyResponse {
  policy_id: string;
  series_id: string;
  status: string;
  premium: Amount;
  limit: Amount;
  cover_starts: string;
  cover_ends: string;
  next_payment_due: string | null;
  paid_through: string;
  holder_account: string;
  nft: { token_id: string | null; serial: number | null };
  hcs_receipt: { topic_id: string | null; sequence_number: number | null };
}

export interface CredentialResponse {
  eligibility: string;
  jti: string;
  series_id: string;
  expires_at: string;
}

export interface Paid<T> {
  body: T;
  settlement: X402Settlement;
}

/** A refusal from the API, carrying the problem document's own code and title. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Problem {
  code?: string;
  title?: string;
  detail?: string;
}

async function readBody<T>(response: Response, what: string, expected: number): Promise<T> {
  const text = await response.text();
  if (response.status !== expected) {
    let problem: Problem = {};
    try {
      problem = JSON.parse(text) as Problem;
    } catch {
      problem = {};
    }
    const code = problem.code ?? String(response.status);
    const detail = problem.detail ?? problem.title ?? text.slice(0, 200);
    throw new ApiError(response.status, code, `${what} answered ${response.status} ${code}: ${detail}`);
  }
  return JSON.parse(text) as T;
}

function settlementOf(response: Response, what: string): X402Settlement {
  const settlement = readSettlement(response);
  if (settlement === null) {
    throw new Error(`${what} came back with no PAYMENT-RESPONSE header: the gate is not on`);
  }
  if (!settlement.success || settlement.transactionId === '') {
    throw new Error(`${what} did not settle: ${settlement.errorMessage ?? 'no transaction id'}`);
  }
  return settlement;
}

export class StewardApi {
  constructor(
    private readonly baseUrl: string,
    private readonly payer: X402Payer,
  ) {}

  /** Paid, per call: the metered index feed. */
  async index(group: string): Promise<Paid<IndexResponse>> {
    const response = await this.payer.fetch(`${this.baseUrl}/v1/index/${group}`);
    const body = await readBody<IndexResponse>(response, `GET /v1/index/${group}`, 200);
    return { body, settlement: settlementOf(response, 'the index read') };
  }

  /** Paid: a price for a limit of cover on a wallet. */
  async quote(input: { group: string; limit: string; wallet: string }): Promise<Paid<QuoteResponse>> {
    const response = await this.payer.fetch(`${this.baseUrl}/v1/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group: input.group, limit: input.limit, wallet: input.wallet }),
    });
    const body = await readBody<QuoteResponse>(response, 'POST /v1/quote', 201);
    return { body, settlement: settlementOf(response, 'the quote') };
  }

  /**
   * Paid with the first month's premium. The credential travels in
   * `Authorization`, the payment in `PAYMENT-SIGNATURE`, and the NFT is minted
   * to the principal's wallet named in the credential, never to the agent's.
   */
  async bind(input: { quoteId: string; credential: string }): Promise<Paid<PolicyResponse>> {
    const response = await this.payer.fetch(`${this.baseUrl}/v1/bind`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.credential}`,
      },
      body: JSON.stringify({ quote_id: input.quoteId }),
    });
    const body = await readBody<PolicyResponse>(response, 'POST /v1/bind', 201);
    return { body, settlement: settlementOf(response, 'the first premium') };
  }

  /** Free. The agent reads it to answer "is there an active policy". */
  async policy(policyId: string): Promise<PolicyResponse | null> {
    const response = await fetch(`${this.baseUrl}/v1/policy/${policyId}`, {
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) {
      await response.text();
      return null;
    }
    return readBody<PolicyResponse>(response, `GET /v1/policy/${policyId}`, 200);
  }

  /**
   * The API's interim eligibility issuer, `POST /v1/demo/eligibility`. It is
   * free and it is not a World Selfie Check: it mints the credential a bind
   * needs without one, so that the agent path can be proved before T11 wires
   * IDKit. Every line this build prints about it says so.
   */
  async demoEligibility(input: {
    group: string;
    wallet: string;
    walletEvm: string;
    nullifier: string;
  }): Promise<CredentialResponse> {
    const response = await fetch(`${this.baseUrl}/v1/demo/eligibility`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        group: input.group,
        wallet: input.wallet,
        wallet_evm: input.walletEvm,
        nullifier: input.nullifier,
      }),
    });
    return readBody<CredentialResponse>(response, 'POST /v1/demo/eligibility', 201);
  }
}
