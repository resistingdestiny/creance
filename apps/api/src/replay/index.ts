import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import { badgeFor, readReplayState, replayStatePath, type ReplayState } from './state.js';

/// The replay state endpoint.
///
///     GET /v1/replay
///
/// One route, no chain access and no database. The oracle writes its run state
/// to a JSON file and this serves it, so the web app can show the REPLAY badge
/// while the demo clock is walking and say which scenario is running when one
/// is. T21's GET /health and T26's GET /v1/index/health both include the same
/// state; both should call `readReplayState` rather than this endpoint.
///
/// The path is deliberately not under /v1/index/. The x402 gate meters
/// `GET /v1/index/*`, so a badge served from there would answer 402 as soon as
/// payments are configured. T26's health endpoint has to follow the same rule.
/// See docs/DECISIONS.md.
///
/// Self contained on purpose, in its own directory, registered from server.ts
/// with one line exactly as `investorRoutes` is. Nothing here writes.

export interface ReplayPluginOptions {
  /** Overridden in tests. Defaults to ORACLE_STATE_PATH. */
  statePath?: string;
  /** Injected in tests, so a route test needs no file on disk. */
  read?: () => ReplayState;
}

export interface ReplayView extends ReplayState {
  /** What the screen should show, or null when the clock is not running. */
  badge: { show: boolean; label: string } | null;
}

export function buildReplayView(state: ReplayState): ReplayView {
  return { ...state, badge: badgeFor(state) };
}

export const replayRoutes: FastifyPluginAsync<ReplayPluginOptions> = async (
  app: FastifyInstance,
  options: ReplayPluginOptions,
) => {
  const path = options.statePath ?? replayStatePath();
  const read = options.read ?? ((): ReplayState => readReplayState(path));

  app.get('/v1/replay', async (_request, reply) => reply.send(buildReplayView(read())));
};

export { badgeFor, idleReplayState, parseReplayState, readReplayState, replayStatePath } from './state.js';
export type { OracleMode, ReplayState } from './state.js';
