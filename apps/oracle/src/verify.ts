import { canonicalize, sha256Hex, type JsonValue } from '@creance/index-model';
import { recoverAddress } from 'ethers';

import type { ObservationMessage } from './message.js';

/**
 * Reading the index topic back and checking it, with nothing but the bytes.
 *
 * This is the whole verification procedure a judge or T07's API follows, in one
 * place, deliberately written against the parsed JSON rather than against the
 * types the publisher used:
 *
 *   1. take the message bytes off the topic and parse them as JSON;
 *   2. remove `sig`;
 *   3. canonicalise what is left with JCS, RFC 8785;
 *   4. sha256 those bytes; that 32 byte digest is what was signed;
 *   5. recover the secp256k1 address from `sig`, which is 65 bytes r, s, v;
 *   6. it must be the oracle account's EVM address.
 *
 * No EIP-191 prefix and no EIP-712 domain: the digest is the plain hash of the
 * canonical bytes. Re-serialising and comparing to the original bytes is the
 * second check, and it is worth doing: it proves the message on the topic is
 * itself canonical, so a reader cannot be shown one ordering and a signature
 * over another.
 */

export interface VerificationResult {
  sequenceNumber: number;
  period: string | null;
  status: string | null;
  open: boolean | null;
  bytes: number;
  /** The address recovered from the signature, or null when it will not parse. */
  signer: string | null;
  signatureValid: boolean;
  /** False when the bytes on the topic are not their own canonical form. */
  canonical: boolean;
  problem: string | null;
}

export function verifyMessageBytes(
  text: string,
  expectedSigner: string,
  sequenceNumber: number,
): VerificationResult {
  const base = {
    sequenceNumber,
    period: null,
    status: null,
    open: null,
    bytes: Buffer.byteLength(text, 'utf8'),
    signer: null,
    signatureValid: false,
    canonical: false,
  };
  let parsed: ObservationMessage;
  try {
    parsed = JSON.parse(text) as ObservationMessage;
  } catch {
    return { ...base, problem: 'the message is not JSON' };
  }

  const canonical = canonicalize(parsed as unknown as JsonValue) === text;
  const rest = { ...(parsed as unknown as Record<string, unknown>) };
  const sig = rest.sig;
  delete rest.sig;
  if (typeof sig !== 'string') {
    return { ...base, canonical, problem: 'the message carries no signature' };
  }

  let signer: string;
  try {
    signer = recoverAddress(`0x${sha256Hex(canonicalize(rest as JsonValue))}`, sig);
  } catch {
    return { ...base, canonical, problem: 'the signature will not parse' };
  }
  const signatureValid = signer.toLowerCase() === expectedSigner.trim().toLowerCase();
  return {
    sequenceNumber,
    period: parsed.period ?? null,
    status: parsed.status ?? null,
    open: parsed.open ?? null,
    bytes: base.bytes,
    signer,
    signatureValid,
    canonical,
    problem: signatureValid
      ? canonical
        ? null
        : 'the bytes on the topic are not their own canonical form'
      : `signed by ${signer}, not ${expectedSigner}`,
  };
}

export interface MirrorMessage {
  sequence_number: number;
  message: string;
  consensus_timestamp: string;
  payer_account_id: string;
}

/** Every message on a topic, ascending, through the mirror node REST API. */
export async function readTopicMessages(
  mirrorUrl: string,
  topicId: string,
  limit = 100,
): Promise<MirrorMessage[]> {
  const base = mirrorUrl.replace(/\/$/, '');
  // docs/harness-notes.md: the message list answers 200 with an empty array for
  // a topic that does not exist, so the topic is confirmed on its own endpoint
  // first and an empty list then means an empty topic rather than a typo.
  const topic = await fetch(`${base}/topics/${topicId}`);
  if (!topic.ok) throw new Error(`no topic ${topicId} on this mirror node`);

  const messages: MirrorMessage[] = [];
  let next: string | null = `/api/v1/topics/${topicId}/messages?limit=${limit}&order=asc`;
  const origin = new URL(base).origin;
  while (next !== null) {
    const response = await fetch(`${origin}${next}`);
    if (!response.ok) throw new Error(`the mirror node answered ${response.status}`);
    const body = (await response.json()) as {
      messages?: MirrorMessage[];
      links?: { next?: string | null };
    };
    messages.push(...(body.messages ?? []));
    next = body.links?.next ?? null;
  }
  return messages;
}

export function decodeMirrorMessage(message: MirrorMessage): string {
  return Buffer.from(message.message, 'base64').toString('utf8');
}
