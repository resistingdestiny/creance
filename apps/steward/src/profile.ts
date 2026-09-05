/// The principal's profile.
///
/// DESIGN.md 3.7 starts the Steward's loop at "read the principal's profile".
/// This is that file: who the agent acts for, what occupation they declared,
/// which wallet the cover is bound to and how much of it to buy. It carries no
/// secret. The agent's own key is derived from the operator key, and the
/// principal's wallet is named rather than held: DESIGN.md 3.6 mints the policy
/// NFT to the principal's wallet, and the agent never signs for it.
///
/// The eligibility credential is the one field that cannot be committed. It
/// lives thirty minutes (DESIGN.md 3.6), so a profile either carries a fresh
/// one or says where to get one. Both forms are here.

/** Where the run gets the principal's eligibility credential. */
export type EligibilitySource =
  /** A credential pasted into the profile. Thirty minutes old at most. */
  | { kind: 'inline'; credential: string }
  /**
   * The API's interim issuer, `POST /v1/demo/eligibility`. It is not a World
   * Selfie Check and every line this build prints about it says so.
   */
  | { kind: 'api_demo_issuer' };

export interface Profile {
  /** The name this principal has in docs/HEDERA.md, used for the state file. */
  principal: string;
  /** The occupation group key, which is what every endpoint takes. */
  occupation: string;
  wallet: {
    accountId: string;
    evmAddress: string;
  };
  /** Cover limit in the settlement token's minor units, as an integer string. */
  coverLimit: string;
  eligibility: EligibilitySource;
}

const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const GROUP_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const MINOR_UNITS = /^[1-9]\d*$/;

function field(record: Record<string, unknown>, name: string): unknown {
  return record[name];
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`the profile field ${name} must be a non-empty string`);
  }
  return value.trim();
}

function requiredObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`the profile field ${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function matching(value: string, pattern: RegExp, name: string, expected: string): string {
  if (!pattern.test(value)) {
    throw new Error(`the profile field ${name} must be ${expected}, got ${value}`);
  }
  return value;
}

function parseEligibility(value: unknown): EligibilitySource {
  const record = requiredObject(value, 'eligibility');
  const source = requiredString(field(record, 'source'), 'eligibility.source');
  if (source === 'inline') {
    return { kind: 'inline', credential: requiredString(field(record, 'credential'), 'eligibility.credential') };
  }
  if (source === 'api_demo_issuer') {
    return { kind: 'api_demo_issuer' };
  }
  throw new Error(
    `the profile field eligibility.source must be inline or api_demo_issuer, got ${source}`,
  );
}

/**
 * Read a profile out of parsed JSON. Pure, so the shape is tested without a
 * file system: a profile that names the wrong wallet buys cover for a stranger,
 * which is worth failing on at the first line of the run rather than at the
 * bind.
 */
export function parseProfile(value: unknown): Profile {
  const record = requiredObject(value, 'profile');
  const wallet = requiredObject(field(record, 'wallet'), 'wallet');
  return {
    principal: requiredString(field(record, 'principal'), 'principal'),
    occupation: matching(
      requiredString(field(record, 'occupation'), 'occupation'),
      GROUP_KEY,
      'occupation',
      'an occupation group key such as computer_math',
    ),
    wallet: {
      accountId: matching(
        requiredString(field(wallet, 'account_id'), 'wallet.account_id'),
        ACCOUNT_ID,
        'wallet.account_id',
        'a Hedera account id in 0.0.x form',
      ),
      evmAddress: matching(
        requiredString(field(wallet, 'evm_address'), 'wallet.evm_address'),
        EVM_ADDRESS,
        'wallet.evm_address',
        'a 20 byte EVM address with a 0x prefix',
      ),
    },
    coverLimit: matching(
      requiredString(field(record, 'cover_limit'), 'cover_limit'),
      MINOR_UNITS,
      'cover_limit',
      "the settlement token's minor units as a positive integer string",
    ),
    eligibility: parseEligibility(field(record, 'eligibility')),
  };
}
