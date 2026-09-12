import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readRecord, writeRecord } from './record.js';

/// Verification goes through Sourcify, not HashScan: manual HashScan
/// verification is disabled and a Sourcify match appears on HashScan by itself.
/// Sourcify supports Hedera testnet on its default server, so no custom apiUrl
/// is needed.
/// https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-verify-a-smart-contract-on-hashscan
const hardhatBin = fileURLToPath(new URL('../../node_modules/.bin/hardhat', import.meta.url));

function verify(name: string, address: string, args: string[]): boolean {
  console.log(`\n=== verify ${name} at ${address} ===`);
  const result = spawnSync(hardhatBin, ['verify', '--network', 'hederaTestnet', address, ...args], {
    stdio: 'inherit',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  });
  return result.status === 0;
}

const record = readRecord();
const market = record.secondaryMarket?.market;
const targets: Array<[string, { address: string; constructorArgs: string[] } | undefined]> = [
  ['CollateralVault', record.collateralVault],
  ['CoverPool', record.coverPool],
  // The market takes the settlement token and nothing else, so its constructor
  // arguments are not on the record the way the other two are.
  [
    'NoteMarket',
    market === undefined
      ? undefined
      : { address: market.address, constructorArgs: [market.settlementToken] },
  ],
];

const verification: Record<string, string> = { ...record.verification };
let failed = false;
for (const [name, target] of targets) {
  if (target === undefined) {
    console.log(`${name} is not deployed yet, skipping`);
    continue;
  }
  const ok = verify(name, target.address, target.constructorArgs);
  verification[name] = ok
    ? `https://hashscan.io/testnet/contract/${target.address}`
    : 'failed, see the run log';
  if (!ok) failed = true;
}

record.verification = verification;
writeRecord(record);

if (failed) {
  // Not fatal: a contract that is already verified, or a Sourcify hiccup,
  // should not undo a good deployment. The run log says which one it was.
  console.error('\nat least one verification did not report success');
  process.exitCode = 1;
}
