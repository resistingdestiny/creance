// Placeholder bodies for the root commands listed in the README.
// Every command exists from the first commit so later tickets replace one body
// at a time without changing the command surface. Each stub prints what the
// real command will do and exits 0.

const commands = {
  'test:testnet': 'run the integration tests against Hedera testnet',
  dev: 'run the web app and the API together locally',
  'oracle:once': 'pull BLS data, compute the ODI, publish one observation to HCS',
  'oracle:replay': 'replay the demo clock from a start month',
  'oracle:backtest': 'print the backtest table per occupation group from 2010',
  'oracle:backfill': 'load the full index history from the archived BLS files',
  'oracle:schedule': 'run the daily index check and pipeline with QA gates and alerts',
  'steward:run': 'run one Steward cycle for the configured principal',
  'adjuster:run': 'decide the pending claims once',
  'contracts:deploy': 'deploy CoverPool and CollateralVault to Hedera testnet and verify them',
  'ats:issue': 'issue the demo Displacement Bond Note series through the ATS SDK',
  'demo:seed': 'seed the demo series, policyholders, investors and claim packets',
};

const name = process.argv[2];
const description = commands[name];

if (!description) {
  console.error(`stub: unknown command ${String(name)}`);
  console.error(`known commands: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

console.log(`${name}: not implemented yet. It will ${description}.`);

// The testnet suite needs operator credentials. Say so rather than failing, so
// that a clean clone with no local environment file still gets a clear answer.
if (name === 'test:testnet' && !process.env.HEDERA_OPERATOR_ID) {
  console.log('test:testnet: no operator credentials found. See the README setup section.');
}
