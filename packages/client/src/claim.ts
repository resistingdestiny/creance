import { Wallet } from 'ethers';

/// The claim helper: build and sign the attestation, submit the packet, wait
/// for the decision.
///
/// It lives here rather than in apps/api because two things outside the API
/// need it and neither may import from it: the testnet script that proves the
/// flow, and the demo seed. The API imports the canonical message from here,
/// which is what keeps one definition of the bytes a wallet signs. A wallet
/// signing one sentence while the API checks another is the failure this file
/// exists to prevent.
///
/// The packet is DESIGN.md 3.9: a fresh live person check, an attestation
/// signed by the policy wallet, at least one document, and the statement that
/// the contents are true.

/** The four covered kinds, then the four this cover does not pay for. */
export const SEPARATION_TYPES = [
  'layoff',
  'redundancy',
  'position_eliminated',
  'site_closure',
  'resignation',
  'dismissal_for_cause',
  'fixed_term_end',
  'client_loss_self_employed',
] as const;

export type SeparationType = (typeof SEPARATION_TYPES)[number];

/** The sentence beside the checkbox on the review screen, verbatim. */
export const FRAUD_STATEMENT =
  "Everything here is true. I understand that a false claim is fraud.";

export interface ClaimAttestationFields {
  policyId: string;
  seriesId: string;
  fullName: string;
  employerName: string;
  jobTitle: string;
  groupKey: string;
  /** The last day of work, as a calendar date, YYYY-MM-DD. */
  lastDayOfWork: string;
  separationType: SeparationType;
}

/**
 * The exact bytes a wallet signs.
 *
 * Lines joined with a single newline and no trailing one. Every value is
 * trimmed and its internal whitespace collapsed first, so a stray space typed
 * into a form field cannot produce a message the API rebuilds differently from
 * the one the wallet showed.
 *
 * Human readable on purpose. The person is signing it in a wallet that will
 * show it to them, and a prompt reading `0x9f3c...` is a prompt nobody can
 * refuse meaningfully.
 */
export function claimAttestationMessage(fields: ClaimAttestationFields): string {
  return [
    'Creance claim attestation',
    `Policy: ${fields.policyId}`,
    `Series: ${fields.seriesId}`,
    `Name: ${tidy(fields.fullName)}`,
    `Employer: ${tidy(fields.employerName)}`,
    `Job title: ${tidy(fields.jobTitle)}`,
    `Occupation: ${fields.groupKey}`,
    `Last day of work: ${fields.lastDayOfWork.slice(0, 10)}`,
    `How it ended: ${fields.separationType}`,
    FRAUD_STATEMENT,
  ].join('\n');
}

export interface SignedAttestation {
  message: string;
  signature: string;
  method: 'eip191';
  /** The address the signature recovers to, so a caller can check the wallet. */
  address: string;
}

/**
 * Sign the attestation with an ECDSA key.
 *
 * EIP-191 `personal_sign`, which is what every EVM wallet produces and what the
 * API recovers against the policy's EVM address. On testnet every account's key
 * is HKDF-derived from the operator key (`roleKeyHex`), so a script can sign as
 * a policyholder without a new secret being stored anywhere.
 */
export async function signClaimAttestation(
  privateKeyHex: string,
  fields: ClaimAttestationFields,
): Promise<SignedAttestation> {
  const wallet = new Wallet(privateKeyHex.startsWith('0x') ? privateKeyHex : `0x${privateKeyHex}`);
  const message = claimAttestationMessage(fields);
  return {
    message,
    signature: await wallet.signMessage(message),
    method: 'eip191',
    address: wallet.address,
  };
}

export interface ClaimEvidenceFile {
  kind: string;
  filename: string;
  bytes: Buffer;
}

export interface ClaimPacket {
  attestation: {
    full_name: string;
    employer_name: string;
    job_title: string;
    group: string;
    last_day_of_work: string;
    separation_type: string;
    statement_accepted: boolean;
    method: string;
    signature: string;
  };
  evidence: { kind: string; filename: string; content_base64: string }[];
}

/** The packet body, from the fields and the files. Base64, as the API takes it. */
export function claimPacket(
  fields: ClaimAttestationFields,
  signed: SignedAttestation,
  files: ClaimEvidenceFile[],
): ClaimPacket {
  return {
    attestation: {
      full_name: fields.fullName,
      employer_name: fields.employerName,
      job_title: fields.jobTitle,
      group: fields.groupKey,
      last_day_of_work: fields.lastDayOfWork,
      separation_type: fields.separationType,
      statement_accepted: true,
      method: signed.method,
      signature: signed.signature,
    },
    evidence: files.map((file) => ({
      kind: file.kind,
      filename: file.filename,
      content_base64: file.bytes.toString('base64'),
    })),
  };
}

export interface ClaimReceipt {
  claim_id: string;
  policy_id: string;
  status: string;
  packet_hash: string;
  evidence: { evidence_id: string; kind: string; sha256: string; size: number }[];
  window: { qualifying_month: string | null; claim_deadline: string | null };
}

export interface ClaimStatus {
  claim_id: string;
  policy_id: string;
  status: string;
  decision: 'approve' | 'refer' | 'decline' | null;
  reasons: string[];
  amount: { amount: string; asset: string; decimals: number } | null;
  packet_hash: string | null;
  decision_hash: string | null;
  claim_deadline: string | null;
  hcs: {
    topic_id: string | null;
    packet_sequence_number: number | null;
    decision_sequence_number: number | null;
  };
  payout: { transaction: string; hashscan: string } | null;
}

export class ClaimError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClaimError';
  }
}

/**
 * The three calls a claim takes, in order.
 *
 * `presence` is the labelled demo path, and it is here rather than hidden
 * because a caller should have to name it. The real path is a Selfie Check in
 * the World App with `require_user_presence`, which no script can run.
 */
export class ClaimClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** POST /v1/demo/claim-presence. Demo only, and it says so in its answer. */
  async demoPresence(policyId: string, nullifier?: string): Promise<string> {
    const body = await this.json<{ claim_credential: string }>(
      'POST',
      '/v1/demo/claim-presence',
      { policy_id: policyId, ...(nullifier === undefined ? {} : { nullifier }) },
      [201],
    );
    return body.claim_credential;
  }

  /** POST /v1/claims, with the claim credential as a bearer token. */
  async submit(credential: string, packet: ClaimPacket): Promise<ClaimReceipt> {
    return await this.json<ClaimReceipt>('POST', '/v1/claims', packet, [201], credential);
  }

  /** GET /v1/claims/:id. Free, and carries nothing about a person. */
  async status(claimId: string): Promise<ClaimStatus> {
    return await this.json<ClaimStatus>('GET', `/v1/claims/${claimId}`, undefined, [200]);
  }

  /**
   * Poll until the claim is decided, or give up.
   *
   * A timeout returns the last status rather than throwing: a claim that is
   * still waiting is not an error, it is a claim that is still waiting, and the
   * caller decides what to say about it.
   */
  async awaitDecision(
    claimId: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<ClaimStatus> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const intervalMs = options.intervalMs ?? 3_000;
    const until = Date.now() + timeoutMs;
    let last = await this.status(claimId);
    while (last.decision === null && Date.now() < until) {
      await new Promise((resolve) => {
        setTimeout(resolve, intervalMs).unref?.();
      });
      last = await this.status(claimId);
    }
    return last;
  }

  private async json<T>(
    method: string,
    path: string,
    body: unknown,
    expected: number[],
    bearer?: string,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!expected.includes(response.status)) {
      let problem: { code?: string; detail?: string } = {};
      try {
        problem = JSON.parse(text) as typeof problem;
      } catch {
        problem = {};
      }
      throw new ClaimError(
        response.status,
        problem.code ?? String(response.status),
        `${method} ${path} answered ${response.status}: ${problem.detail ?? text.slice(0, 200)}`,
      );
    }
    return JSON.parse(text) as T;
  }
}

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
