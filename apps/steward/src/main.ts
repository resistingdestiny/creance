import { parseArgs } from 'node:util';

import { runCycle } from './run.js';
import type { Cadence } from './premiums.js';

/// `pnpm steward:run`, one cycle for the configured principal.
///
/// Defaults are the real product: the newest published month as the vantage, a
/// monthly premium cadence, three premiums planned after the one the bind pays.
/// The two options that change what a run means are both labelled wherever they
/// appear, in the transcript and in the journal entry on chain.
///
///     --profile PATH        the principal profile, default STEWARD_PROFILE
///     --as-of YYYY-MM       stand the decision rule in an earlier month, as
///                           the demo clock does, on the same published data
///     --cadence CADENCE     monthly, or demo for the compressed clock
///     --interval SECONDS    the demo cadence's spacing, default 90
///     --premiums N          how many premiums to plan, default 3
///     --wait                wait for the first premium to execute and report it

const usage = `usage: pnpm steward:run [--profile PATH] [--as-of YYYY-MM]
                       [--cadence monthly|demo] [--interval SECONDS]
                       [--premiums N] [--wait]`;

const { values } = parseArgs({
  options: {
    profile: { type: 'string' },
    'as-of': { type: 'string' },
    cadence: { type: 'string', default: 'monthly' },
    interval: { type: 'string', default: '90' },
    premiums: { type: 'string', default: '3' },
    wait: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  console.log(usage);
  process.exit(0);
}

const cadenceName = values.cadence ?? 'monthly';
if (cadenceName !== 'monthly' && cadenceName !== 'demo') {
  console.error(`unknown cadence ${cadenceName}\n${usage}`);
  process.exit(2);
}
const intervalSeconds = Number(values.interval);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
  console.error(`--interval takes whole seconds, got ${String(values.interval)}`);
  process.exit(2);
}
const premiums = Number(values.premiums);
if (!Number.isInteger(premiums) || premiums < 1) {
  console.error(`--premiums takes a whole number of months, got ${String(values.premiums)}`);
  process.exit(2);
}
const asOf = values['as-of'];
if (asOf !== undefined && !/^\d{4}-\d{2}$/.test(asOf)) {
  console.error(`--as-of takes a month as YYYY-MM, got ${asOf}`);
  process.exit(2);
}

const cadence: Cadence = cadenceName === 'demo' ? { kind: 'demo', intervalSeconds } : { kind: 'monthly' };

try {
  process.exitCode = await runCycle({
    profilePath: values.profile,
    asOf,
    cadence,
    premiums,
    wait: values.wait === true,
  });
} catch (error) {
  console.error(`\nthe cycle stopped: ${(error as Error).message}`);
  process.exitCode = 1;
}
