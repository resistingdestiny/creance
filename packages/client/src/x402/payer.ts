import { HEDERA_TESTNET_CAIP2, PrivateKey, createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import type { Network, PaymentRequired, PaymentRequirements } from '@x402/core/types';

/// The x402 payer.
///
/// One Hedera account key in, one `fetch` out. The wrapped fetch makes the
/// request, reads the 402, builds and partially signs a `TransferTransaction`
/// against the requirements the server advertised, retries with the
/// `PAYMENT-SIGNATURE` header, and hands back the 200. The facilitator adds its
/// own signature and pays the network fee, so the payer needs the settlement
/// token and not much else.
///
/// Protocol version 2: the requirements travel in `PAYMENT-REQUIRED`, the
/// payment in `PAYMENT-SIGNATURE` and the settlement receipt in
/// `PAYMENT-RESPONSE`, all base64 of JSON. Version 1 used `X-PAYMENT` and is a
/// different protocol; an example carrying `signature` and `authorization` in
/// the payload is the EVM binding and does not apply to Hedera.
///
/// https://docs.x402.org/schemes/exact
/// https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
///
/// Two things this helper does that the library does not do for you.
///
/// It never touches `Authorization`. `POST /v1/bind` takes the eligibility
/// credential as a bearer token and the caller owns that header; the wrapper
/// clones the original request and only adds the payment headers to the clone.
///
/// It sets the spend controls explicitly. The library's default allows only the
/// assets it ships as network defaults, which on `hedera:testnet` is USDC, and
/// caps a payment at one dollar. This build settles in its own HTS token and a
/// first premium is more than a dollar, so both defaults would refuse the
/// payment before it ever reached the facilitator.

export const HEDERA_TESTNET: Network = HEDERA_TESTNET_CAIP2;

export interface X402PayerOptions {
  /** The payer's Hedera account id, in `0.0.x` form. */
  accountId: string;
  /**
   * The payer's ECDSA private key as raw hex, with or without the `0x` prefix.
   * The x402 Hedera integration is built and tested against ECDSA keys, which
   * is what every account in this build carries.
   */
  privateKey: string;
  /** CAIP-2, colon and not a hyphen. Testnet only in this build. */
  network?: Network;
  /**
   * The settlement asset the payer is willing to spend, as a token id. Without
   * it the library's spend controls refuse anything that is not one of its own
   * default assets.
   */
  asset: string;
  /**
   * The most this payer will settle in one payment, in the asset's minor units.
   * A ceiling, not a price: the server names the price and the payer refuses
   * anything above this. Omit it for no ceiling.
   */
  maxAmountPerPayment?: string;
  /** Defaults to the global fetch. */
  fetchImpl?: typeof globalThis.fetch;
}

/** What the facilitator said about a settled payment. */
export interface X402Settlement {
  success: boolean;
  /**
   * The Hedera transaction id, `0.0.<feePayer>@<seconds>.<nanos>`. The x402
   * Hedera scheme calls this field `transactionId` and Blocky402's API
   * reference calls it `transaction`, so both are read.
   */
  transactionId: string;
  network: string;
  /** Whatever the facilitator returned; the spec and Blocky402 disagree on
   * whether it names the payer's wallet or the sponsoring fee payer, so it is
   * reported rather than interpreted. */
  payer: string | undefined;
  errorReason: string | undefined;
  errorMessage: string | undefined;
}

export interface X402Payer {
  accountId: string;
  network: Network;
  /** `fetch`, with the 402 flow completed transparently. */
  fetch: typeof globalThis.fetch;
}

export function createX402Payer(options: X402PayerOptions): X402Payer {
  const network = options.network ?? HEDERA_TESTNET;
  const signer = createClientHederaSigner(
    options.accountId,
    PrivateKey.fromStringECDSA(normaliseKey(options.privateKey)),
    { network },
  );
  const wrapped = wrapFetchWithPaymentFromConfig(options.fetchImpl ?? globalThis.fetch, {
    schemes: [{ network, client: new ExactHederaScheme(signer) }],
    spendControls: {
      allowedAssets: [
        {
          network,
          asset: options.asset,
          ...(options.maxAmountPerPayment === undefined
            ? {}
            : { maxAmountPerPayment: options.maxAmountPerPayment }),
        },
      ],
      // The dollar cap applies only to the library's own default assets, and
      // this build never pays in one. Leaving it on would cap nothing and
      // confuse the next reader.
      maxAmountPerPayment: false,
    },
  });
  return { accountId: options.accountId, network, fetch: wrapped as typeof globalThis.fetch };
}

/** The settlement receipt on a paid response, or null when there is none. */
export function readSettlement(response: {
  headers: { get(name: string): string | null };
}): X402Settlement | null {
  const header = response.headers.get('PAYMENT-RESPONSE') ?? response.headers.get('payment-response');
  if (header === null || header === '') return null;
  const decoded = decodePaymentResponseHeader(header) as Record<string, unknown>;
  const transactionId =
    stringOrUndefined(decoded.transaction) ?? stringOrUndefined(decoded.transactionId) ?? '';
  return {
    success: decoded.success === true,
    transactionId,
    network: stringOrUndefined(decoded.network) ?? '',
    payer: stringOrUndefined(decoded.payer),
    errorReason: stringOrUndefined(decoded.errorReason),
    errorMessage: stringOrUndefined(decoded.errorMessage),
  };
}

/** The payment requirements on a 402, or null when the header is absent. */
export function readPaymentRequired(response: {
  headers: { get(name: string): string | null };
}): PaymentRequired | null {
  const header = response.headers.get('PAYMENT-REQUIRED') ?? response.headers.get('payment-required');
  if (header === null || header === '') return null;
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as PaymentRequired;
}

/** The first requirement for a network and scheme, which is what a payer pays. */
export function chooseRequirement(
  paymentRequired: PaymentRequired,
  network: Network = HEDERA_TESTNET,
  scheme = 'exact',
): PaymentRequirements | undefined {
  return paymentRequired.accepts.find(
    (entry) => entry.network === network && entry.scheme === scheme,
  );
}

/**
 * The HashScan link for a settlement.
 *
 * HashScan takes a transaction id with the account separated by a hyphen and
 * the nanoseconds by a hyphen too, so `0.0.7162784@1756800000.000000000`
 * becomes `0.0.7162784-1756800000-000000000`. Pasting the `@` form returns
 * nothing, which is the sort of thing that eats ten minutes in front of a
 * judge.
 */
export function hashscanTransactionUrl(transactionId: string, network = 'testnet'): string {
  const normalised = transactionId.replace('@', '-').replace(/\.(\d+)$/, '-$1');
  return `https://hashscan.io/${network}/transaction/${normalised}`;
}

function normaliseKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
