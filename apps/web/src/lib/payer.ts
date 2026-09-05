// The concrete modules, not the workspace's barrel. The barrel re-exports with
// explicit `.js` specifiers, which is right for the TypeScript runtime the API
// uses and which the bundler here cannot follow to a `.ts` file. These two
// modules import nothing of their own inside the package.
import { roleKeyHex } from '@creance/client/src/hedera/keys';
import {
  createX402Payer,
  hashscanTransactionUrl,
  readSettlement,
  type X402Payer,
} from '@creance/client/src/x402/payer';

import { DEMO_ACCOUNT } from './wallet';

/**
 * How the web app pays for a gated call.
 *
 * T08 put the Hedera x402 gate in front of `GET /v1/index/:group`,
 * `POST /v1/quote` and `POST /v1/bind`, so the worker flow is a paying client
 * of its own API. The index read and the quote have fixed prices and the bind
 * costs the first month's premium from the quote.
 *
 * DESIGN.md 3.6 mints the policy NFT to the person's own wallet and takes the
 * premium from it. There is no wallet in the browser that can sign, so this is
 * a server side payer holding the key of the same account the cover is bound
 * to, standing in for a wallet signature until HashPack is wired. No key ever
 * reaches the browser: every call in this flow is made from the server for
 * exactly this reason. Recorded in docs/DECISIONS.md.
 *
 * The key is derived rather than stored, with the same HKDF label the API uses
 * for its own account, so a clone with the operator key has it and no new
 * secret exists.
 *
 * https://docs.x402.org/schemes/exact
 */

/** The demo worker, whose wallet the cover is bound to. */
const WORKER_ROLE = 'policyholder-1';

/**
 * A ceiling, not a price. The server names the price and the payer refuses
 * anything above this. A first premium runs from under one to about fifty in an
 * open month, so 100 is well clear of it and well under the account's balance.
 */
const MAX_PER_PAYMENT = '100000000';

/** One payer per asset, built on the first 402 and kept for the process. */
const payers = new Map<string, X402Payer>();

/**
 * The operator key, from the process environment or from the repository's own
 * environment file.
 *
 * The framework reads environment files from the application directory, and
 * this is a workspace inside a monorepo whose one environment file sits at the
 * repository root, beside the example that documents it. The API loads that
 * file with node's own loader and this does the same, here rather than at
 * server startup, because this module is the only thing in the web app that
 * needs a secret and it is only ever loaded on the server.
 *
 * The loader does not overwrite a variable that is already set, so a deployment
 * that puts them in the process environment is unaffected, and a clone with no
 * file at all simply has no payer.
 *
 * https://nodejs.org/api/process.html#processloadenvfilepath
 */
function operatorKey(): string | null {
  const direct = process.env.HEDERA_OPERATOR_KEY;
  if (direct !== undefined && direct.trim() !== '') return direct.trim();
  try {
    process.loadEnvFile('../../.env');
  } catch {
    return null;
  }
  const loaded = process.env.HEDERA_OPERATOR_KEY;
  return loaded !== undefined && loaded.trim() !== '' ? loaded.trim() : null;
}

/**
 * The payer for an asset, or null when this deployment has no key.
 *
 * Null rather than a throw: a clone with no operator key still renders every
 * screen against an API whose gate is off, and a judge who has not filled in
 * the environment gets a screen that says the call could not be paid for rather
 * than a stack trace.
 */
export function workerPayer(asset: string): X402Payer | null {
  const cached = payers.get(asset);
  if (cached !== undefined) return cached;

  const operator = operatorKey();
  if (operator === null) return null;

  try {
    const payer = createX402Payer({
      accountId: DEMO_ACCOUNT.accountId,
      privateKey: roleKeyHex(operator, WORKER_ROLE),
      asset,
      maxAmountPerPayment: MAX_PER_PAYMENT,
    });
    payers.set(asset, payer);
    return payer;
  } catch (cause) {
    console.error(`[web] no x402 payer for ${asset}. ${String(cause)}`);
    return null;
  }
}

/**
 * The settlement receipt on a paid response, logged rather than shown.
 *
 * The worker flow keeps the chain invisible (docs/DESIGN-TOKENS.md section 9),
 * so the transaction id goes to the server log, where a judge running the flow
 * can follow it to HashScan while the screen says nothing about it.
 */
export function logSettlement(endpoint: string, response: Response): void {
  const settlement = readSettlement(response);
  if (settlement === null) return;
  if (!settlement.success || settlement.transactionId === '') {
    console.error(
      `[web] ${endpoint} did not settle. ${settlement.errorMessage ?? 'no reason given'}`,
    );
    return;
  }
  console.log(
    `[web] ${endpoint} settled ${settlement.transactionId} ${hashscanTransactionUrl(settlement.transactionId)}`,
  );
}
