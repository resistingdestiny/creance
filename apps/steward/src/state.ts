import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/// What the agent remembers between runs.
///
/// "No active policy" is the first half of the decision rule and it is not a
/// question the API can answer: `GET /v1/policy/:id` needs an id, and there is
/// no endpoint that lists a wallet's policies. So the Steward keeps the id of
/// the last policy it bought for each principal, one small file per principal,
/// and reads the live status back from the API on the next run. The file is a
/// pointer, never a copy: status and dates always come from the API.
///
/// It holds nothing secret and it is not the record of anything. If it is lost
/// the agent buys again and the API refuses the bind with `already_covered`,
/// which is the safety net that actually enforces one policy per nullifier per
/// series.

export interface StewardState {
  principal: string;
  /** The last policy this agent bound for the principal, or null. */
  policy_id: string | null;
  /** When it was bound, RFC 3339, for a reader of the file. */
  bound_at: string | null;
}

function statePath(directory: string, principal: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(principal)) {
    throw new Error(`a principal name is 1 to 64 characters of [A-Za-z0-9_-], got ${principal}`);
  }
  return join(directory, `${principal}.json`);
}

/** The remembered state, or an empty one when this principal is new. */
export function readState(directory: string, principal: string): StewardState {
  const path = statePath(directory, principal);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      return {
        principal,
        policy_id: typeof record['policy_id'] === 'string' ? record['policy_id'] : null,
        bound_at: typeof record['bound_at'] === 'string' ? record['bound_at'] : null,
      };
    }
  } catch {
    // A missing or unreadable file means the agent has no memory of this
    // principal, which is the same as never having bought for them.
  }
  return { principal, policy_id: null, bound_at: null };
}

export function writeState(directory: string, state: StewardState): string {
  mkdirSync(directory, { recursive: true });
  const path = statePath(directory, state.principal);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}
