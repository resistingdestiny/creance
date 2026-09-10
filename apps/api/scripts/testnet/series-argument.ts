import { findSeries, type ApiConfig, type SeriesConfig } from '../../src/config.js';

/**
 * Which series a testnet script runs against.
 *
 * These scripts are demo evidence and their links are cited in docs/HEDERA.md,
 * so the no argument behaviour is exactly what it was when the deployment had
 * one series: the head of the list, which is the demo series. `--series` or
 * the `CREANCE_SERIES` environment variable names another, by label, group key
 * or bytes32 id.
 *
 *     pnpm --filter @creance/api run testnet:bind
 *     pnpm --filter @creance/api run testnet:bind --series office_admin_support
 */

/**
 * The series a name resolves to, or the head of the list for no name.
 *
 * A script that already parses its own arguments passes `values.series` here.
 * One that does not calls `chosenSeries`, which reads the same flag off argv.
 */
export function seriesNamed(
  config: ApiConfig,
  wanted: string | undefined,
): SeriesConfig | undefined {
  const named = (wanted ?? process.env.CREANCE_SERIES ?? '').trim();
  if (named === '') return config.series[0];
  const series = findSeries(config, named);
  if (series === undefined) {
    throw new Error(
      `no series "${named}" in the deployment record. One of: ` +
        config.series.map((entry) => entry.label).join(', '),
    );
  }
  return series;
}

function flagValue(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf('--series');
  return flag === -1 ? undefined : argv[flag + 1];
}

/** The series a run acts on, or undefined when the record has none at all. */
export function chosenSeries(
  config: ApiConfig,
  argv: readonly string[] = process.argv.slice(2),
): SeriesConfig | undefined {
  return seriesNamed(config, flagValue(argv));
}

/** The occupation group a run acts on. */
export function chosenGroup(
  config: ApiConfig,
  argv: readonly string[] = process.argv.slice(2),
): string | undefined {
  return chosenSeries(config, argv)?.groupKey;
}
