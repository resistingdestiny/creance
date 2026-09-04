import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/// Deploy and verify, one step at a time.
///
/// Each step is its own process on purpose. The public JSON-RPC relay rate
/// limits exactly this pattern, and a half finished run inside one process
/// leaves you guessing which transaction landed; separate processes plus the
/// deployment record mean a rerun picks up where the last one stopped.
const STEPS = ['status', 'vault', 'associate', 'pool', 'wire', 'roles', 'series'] as const;

const deployScript = fileURLToPath(new URL('./deploy.ts', import.meta.url));
const verifyScript = fileURLToPath(new URL('./verify.ts', import.meta.url));

function run(script: string, args: string[]): void {
  const label = [script.split('/').pop(), ...args].join(' ');
  console.log(`\n=== ${label} ===`);
  // The child inherits this process's environment, so the secrets stay where
  // they were loaded and are never passed on a command line.
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`step failed: ${label}`);
  }
}

for (const step of STEPS) {
  run(deployScript, [step]);
}
run(verifyScript, []);
console.log('\ndeploy complete. Copy the addresses into docs/HEDERA.md.');
