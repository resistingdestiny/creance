import { parseArgs } from 'node:util';

import { closeWindows } from '../src/claims/close-windows.js';
import { loadApiConfig } from '../src/config.js';
import { EthersChainGateway } from '../src/chain/cover-pool.js';
import { createPool, PostgresRepository } from '../src/db/postgres.js';
import { MemoryRepository } from '../src/db/memory.js';
import { buildServices } from '../src/services.js';

/// `pnpm --filter @creance/api claims:close-windows`
///
/// Reads `seriesOf(...).windowEndsAt` for every registered series and calls
/// `closeWindow` on the ones whose window has ended, so the unclaimed reserve
/// returns to the vault (DESIGN.md 3.2).
///
///     --dry-run    read and report, send nothing
///
/// It is a command rather than a loop inside the API on purpose. The call is
/// permissionless and happens once per window, so a cron entry or a person
/// running this is the right shape, and a background timer inside a web process
/// is a thing that fails silently. Wiring it into a schedule belongs with
/// whoever owns the deployment files.
///
/// It writes to testnet when it closes a window, so it is not part of
/// `pnpm test`. The unit test beside it drives the same function with a
/// recorded chain.

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });

const config = loadApiConfig();
if (config.network !== 'testnet') throw new Error('this build is testnet only');

const databaseUrl = config.databaseUrl;
const pool = databaseUrl === undefined || databaseUrl === '' ? null : createPool(databaseUrl);

const services = await buildServices({
  config,
  // The cached series row is refreshed after a close. Without a database the
  // job still closes the window: the chain is the record and the row is a copy.
  repository: pool === null ? new MemoryRepository() : new PostgresRepository(pool),
  prepareDatabase: false,
  loadIndex: false,
  chain: new EthersChainGateway(
    config.coverPoolAddress,
    config.vaultAddress,
    config.rpcUrl,
    config.chainId,
    config.api.key,
  ),
});

const results = await closeWindows(services, {
  dryRun: values['dry-run'] === true,
  log: (line) => console.log(line),
});

for (const result of results) {
  if (!result.closed) continue;
  console.log(`  transaction ${result.transactionHash}`);
  console.log(`  hashscan    ${result.hashscan}`);
  console.log(`  gas used    ${result.gasUsed}`);
}

await pool?.end();
