/// What this deployment knows about its World ID app, read once at boot.
///
/// Six values come from the Developer Portal and one of them is a secret: the
/// RP signing key never leaves this process. The World docs are blunt about it,
/// "Never generate RP signatures on the client and never expose your RP signing
/// key", which is why the web app has no World credential at all and asks this
/// API for a signed rp_context instead.
///
/// The preset and the accepted credential identifiers are configuration rather
/// than constants, because the Selfie Check feature flag is granted per app by
/// a human at Tools for Humanity and DESIGN.md section 8 names a fallback for
/// the case where it has not landed. Moving between them is a `.env` edit.
///
/// https://docs.world.org/world-id/idkit/signatures
/// https://docs.world.org/world-id/idkit/credentials

export interface WorldConfig {
  /** `app_...`, the app the World ID App is handed off to. */
  appId: string;
  /** `rp_...`, the relying party the signature and the verify path name. */
  rpId: string;
  /** The id the verify path carries. `rp_id` when there is one. */
  verifyId: string;
  /** World's verify endpoint, without the trailing id. */
  verifyUrl: string;
  /** secp256k1, 32 bytes hex. Secret. Undefined when this clone has none. */
  signingKey: string | undefined;
  /** The address that key recovers to, so a swapped key is caught at boot. */
  signerAddress: string;
  /** The action scoping the nullifier at purchase. */
  actionEligibility: string;
  /** The action scoping the nullifier at claim. */
  actionClaim: string;
  /** Passed to IDKit untouched and compared against what the result carries. */
  environment: string;
  /** Which credential the widget asks for. */
  preset: string;
  /** The `identifier` values a response item may carry for that preset. */
  identifiers: string[];
  /** The life of an rp_context. World's own default is 300. */
  rpContextTtlSeconds: number;
  /** True once there is an app id and a signing key to sign a request with. */
  enabled: boolean;
}

/**
 * The identifiers each preset can return, from the credentials page read on
 * 5 September 2026. `selfieCheckLegacy` returns `selfie`, with the historical
 * `face` still accepted as an alias.
 */
const PRESET_IDENTIFIERS: Record<string, string[]> = {
  selfieCheckLegacy: ['selfie', 'face'],
  proofOfHuman: ['proof_of_human', 'orb'],
  orbLegacy: ['orb'],
  deviceLegacy: ['orb', 'device'],
};

export const DEFAULT_VERIFY_URL = 'https://developer.world.org/api/v4/verify';

function text(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function optional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

/**
 * The identifiers to accept, from `WORLD_IDENTIFIERS` when it is set and from
 * the preset otherwise. An unknown preset accepts nothing rather than
 * everything: a verify handler that accepts any credential it is handed is the
 * same as one that checks none.
 */
export function identifiersFor(preset: string, override: string | undefined): string[] {
  if (override !== undefined) {
    return override
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== '');
  }
  return PRESET_IDENTIFIERS[preset] ?? [];
}

export function loadWorldConfig(): WorldConfig {
  const appId = text('WORLD_APP_ID', '');
  const rpId = text('WORLD_RP_ID', '');
  const signingKey = optional('WORLD_RP_SIGNING_KEY');
  const preset = text('WORLD_PRESET', 'selfieCheckLegacy');
  return {
    appId,
    rpId,
    // The endpoint summary prefers `rp_id` and still accepts `app_id`, so the
    // form in the path is configuration: a deployment whose rp_id the endpoint
    // rejects swaps one variable rather than a line of code.
    verifyId: text('WORLD_VERIFY_ID', rpId === '' ? appId : rpId),
    verifyUrl: text('WORLD_VERIFY_URL', DEFAULT_VERIFY_URL).replace(/\/+$/, ''),
    signingKey,
    signerAddress: text('WORLD_RP_SIGNER_ADDRESS', ''),
    actionEligibility: text('WORLD_ACTION_ELIGIBILITY', 'occupation-cover-eligibility'),
    actionClaim: text('WORLD_ACTION_CLAIM', 'occupation-cover-claim'),
    environment: text('WORLD_ENVIRONMENT', 'staging'),
    preset,
    identifiers: identifiersFor(preset, optional('WORLD_IDENTIFIERS')),
    rpContextTtlSeconds: ttl(),
    enabled: appId !== '' && signingKey !== undefined,
  };
}

function ttl(): number {
  const raw = process.env['WORLD_RP_CONTEXT_TTL_SECONDS'];
  if (raw === undefined || raw.trim() === '') return 300;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`WORLD_RP_CONTEXT_TTL_SECONDS must be a positive whole number, got ${raw}`);
  }
  return value;
}

/**
 * True when purchase and claim run the same registered action, which is what
 * makes the two checks produce one nullifier and the continuity claim in
 * DESIGN.md 3.6 a check rather than a story. See docs/DECISIONS.md.
 */
export function continuityHolds(world: WorldConfig): boolean {
  return world.actionEligibility === world.actionClaim;
}
