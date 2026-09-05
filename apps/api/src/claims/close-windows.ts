import { mapRevert } from '../chain/cover-pool.js';
import { seriesRowFrom } from '../series.js';
import type { Services } from '../services.js';

/// The job that closes a claim window.
///
/// DESIGN.md 3.2: "whatever is unclaimed when the claim window closes returns
/// to the vault". `CoverPool.closeWindow` does that, and nothing calls it on a
/// timer, so this is the timer.
///
/// Three properties, all of them the contract's rather than this file's.
///
/// It is permissionless. `closeWindow` takes no role, so this job can run from
/// any funded account and a judge can close the window themselves from a block
/// explorer if we are asleep. This process happens to hold a key already.
///
/// It is not stopped by a pause. "A pause stops new exposure and never traps
/// money" (docs/DECISIONS.md, T04), so `closeWindow` is outside
/// `whenNotPaused`, and a paused deployment still returns the reserve.
///
/// It refuses early rather than guessing. `windowEndsAt` is on the series and
/// the contract compares it against block time, so this reads the same value
/// and reports when it will work instead of sending a transaction that reverts
/// `WindowNotOver`. The demo series' window ends 2026-10-05T09:04:51Z, which is
/// after the event, so on the demo series this job reports exactly that: the
/// path is proved by the contract's own tests and by a unit test here with a
/// recorded chain.
///
/// It is not wired into `GET /healthz` and not into any compose file. It is a
/// command: `pnpm --filter @creance/api claims:close-windows`.

export interface WindowCloseResult {
  seriesId: string;
  seriesKey: string;
  status: string;
  /** Seconds since the epoch, or 0 when no window is open. */
  windowEndsAt: number;
  closed: boolean;
  /** A code, when nothing was closed. */
  reason?: string;
  transactionHash?: string;
  hashscan?: string;
  gasUsed?: string;
}

export interface CloseWindowsOptions {
  now?: Date;
  /** Report what would happen and send nothing. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function closeWindows(
  services: Services,
  options: CloseWindowsOptions = {},
): Promise<WindowCloseResult[]> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => undefined);
  const results: WindowCloseResult[] = [];

  for (const series of services.config.series) {
    const state = await services.chain.seriesState(series.seriesId);
    const base = {
      seriesId: series.label,
      seriesKey: series.seriesId,
      status: state.status,
      windowEndsAt: state.windowEndsAt,
    };

    if (state.status !== 'claims_open') {
      log(`${series.label}: ${state.status}, no window to close`);
      results.push({ ...base, closed: false, reason: 'series_not_in_claim_window' });
      continue;
    }
    if (state.windowEndsAt === 0) {
      log(`${series.label}: claims open with no window end recorded`);
      results.push({ ...base, closed: false, reason: 'no_open_window' });
      continue;
    }
    const endsAt = new Date(state.windowEndsAt * 1000);
    if (now.getTime() < endsAt.getTime()) {
      log(`${series.label}: the window is open until ${endsAt.toISOString()}`);
      results.push({ ...base, closed: false, reason: 'window_not_over' });
      continue;
    }
    if (options.dryRun === true) {
      log(`${series.label}: would close, the window ended ${endsAt.toISOString()}`);
      results.push({ ...base, closed: false, reason: 'dry_run' });
      continue;
    }

    try {
      const write = await services.chain.closeWindow(series.seriesId);
      // The cached row follows the chain, so the investor screen and the claim
      // screen stop saying claims are open in the same moment the chain does.
      const after = await services.chain.seriesState(series.seriesId);
      await services.repository.upsertSeries(seriesRowFrom(series, after, services.config));
      log(`${series.label}: window closed, ${write.transactionHash}`);
      results.push({
        ...base,
        status: after.status,
        closed: true,
        transactionHash: write.transactionHash,
        hashscan: write.hashscan,
        gasUsed: write.gasUsed,
      });
    } catch (error) {
      const mapped = mapRevert(error);
      log(`${series.label}: the pool refused the close, ${mapped.code}`);
      results.push({ ...base, closed: false, reason: mapped.code });
    }
  }

  return results;
}
