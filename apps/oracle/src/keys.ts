import { normaliseRawKeyHex, roleKeyHex } from '@creance/client';

/**
 * The oracle's own key handling.
 *
 * `HEDERA_ORACLE_KEY` is the normal path: `pnpm hedera:setup` prints it and a
 * judge pastes it into the environment file. Deriving from the operator key is
 * the fallback for a clone that has only that one, and the derivation itself
 * comes from `packages/client`, which is where T07 moved it. This module held a
 * copy of the HKDF loop while that package did not exist; two implementations
 * of a key derivation is two chances to derive a different account, so the copy
 * is gone and only the environment reading is left here.
 *
 * Testnet only. Every derived key is exactly as secret as the operator key.
 */

export { deriveRoleKeyHex, labelForRole, normaliseRawKeyHex } from '@creance/client';

/**
 * The oracle signing key as raw hex, from the environment.
 *
 * Never logged, never written to a file, never put in a message. The only
 * things that leave this module are a signature and, through
 * `oracleAddress`, a public address.
 */
export function oracleKeyHex(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.HEDERA_ORACLE_KEY?.trim();
  if (direct !== undefined && direct.length > 0) return normaliseRawKeyHex(direct);
  const operator = env.HEDERA_OPERATOR_KEY?.trim();
  if (operator !== undefined && operator.length > 0) {
    return roleKeyHex(operator, 'oracle');
  }
  throw new Error('set HEDERA_ORACLE_KEY, or HEDERA_OPERATOR_KEY to derive it');
}
