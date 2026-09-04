import { JsonRpcProvider, Wallet, type ContractTransactionResponse } from 'ethers';

import {
  CollateralVault__factory,
  CoverPool__factory,
} from '../../types/ethers-contracts/index.js';
import {
  ATTACHMENT_SHOCK,
  CHAIN_ID,
  EXHAUSTION_SHOCK,
  GAS,
  GROUP_LABEL,
  LEVEL_LINE,
  MIRROR_URL,
  RPC_URL,
  SERIES_LABEL,
  SERIES_TERMS,
  isLongZero,
  readResources,
} from './config.js';
import { readRecord, recordPath, writeRecord, type ContractRecord, type DeploymentRecord } from './record.js';

const STEPS = ['status', 'vault', 'associate', 'pool', 'wire', 'roles', 'series'] as const;
type Step = (typeof STEPS)[number];

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function operatorKey(): string {
  const raw = (process.env.HEDERA_OPERATOR_KEY ?? '').trim();
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'HEDERA_OPERATOR_KEY must be a raw 32 byte hex ECDSA key. The example environment file says where it goes.',
    );
  }
  return hex;
}

/// Right pad the ASCII label into 32 bytes. The API and the oracle have to use
/// the same encoding, so it is written into docs/HEDERA.md.
function toBytes32(label: string): string {
  const bytes = Buffer.from(label, 'ascii');
  if (bytes.length > 32) throw new Error(`label too long for bytes32: ${label}`);
  return `0x${Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString('hex')}`;
}

/// The mirror node carries the consensus level view of an entity, including the
/// 0.0.x id that HashScan and the SDK use.
async function contractIdOf(address: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${MIRROR_URL}/contracts/${address}`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { contract_id?: string };
    return body.contract_id;
  } catch {
    return undefined;
  }
}

async function confirm(tx: ContractTransactionResponse): Promise<bigint> {
  const receipt = await tx.wait();
  if (receipt === null) throw new Error(`no receipt for ${tx.hash}`);
  return receipt.gasUsed;
}

type Resources = ReturnType<typeof readResources>;

async function main(): Promise<void> {
  const step = (process.argv[2] ?? 'status') as Step;
  if (!STEPS.includes(step)) {
    throw new Error(`unknown step "${step}". One of: ${STEPS.join(', ')}`);
  }

  const resources = readResources();
  if (resources.network !== 'testnet') {
    throw new Error(`refusing to run against ${resources.network}: this build is testnet only`);
  }

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const deployer = new Wallet(operatorKey(), provider);
  const record = readRecord();
  record.settlementToken = {
    tokenId: resources.settlementToken.tokenId,
    evmAddress: resources.settlementToken.evmAddress,
  };

  const handlers: Record<Step, () => Promise<void>> = {
    status: () => status(record, deployer, resources),
    vault: () => deployVault(record, deployer, resources),
    associate: () => associate(record, deployer),
    pool: () => deployPool(record, deployer, resources),
    wire: () => wire(record, deployer),
    roles: () => grantRoles(record, deployer, resources),
    series: () => registerSeries(record, deployer),
  };

  await handlers[step]();
  writeRecord(record);
  console.log(`record: ${recordPath()}`);
}

async function status(record: DeploymentRecord, deployer: Wallet, resources: Resources) {
  const balance = await deployer.provider!.getBalance(deployer.address);
  console.log(`network      testnet, chain id ${CHAIN_ID}, relay ${RPC_URL}`);
  console.log(`deployer     ${deployer.address}`);
  console.log(`operator     ${resources.operator.evmAddress} (${resources.operator.accountId})`);
  console.log(`balance      ${balance / 10n ** 10n} tinybar`);
  console.log(
    `token        ${resources.settlementToken.tokenId} ${resources.settlementToken.evmAddress}`,
  );
  console.log(`vault        ${record.collateralVault?.address ?? 'not deployed'}`);
  console.log(`pool         ${record.coverPool?.address ?? 'not deployed'}`);
  if (deployer.address.toLowerCase() !== resources.operator.evmAddress.toLowerCase()) {
    throw new Error(
      'the deploy key does not match the operator account in docs/hedera.testnet.json',
    );
  }
}

async function deployVault(record: DeploymentRecord, deployer: Wallet, resources: Resources) {
  if (record.collateralVault) {
    console.log(`vault already deployed at ${record.collateralVault.address}`);
    return;
  }
  const token = resources.settlementToken.evmAddress;
  // A token is always its long-zero form; a role holder never is. Mixing the
  // two is the most common Hedera integration bug.
  if (!isLongZero(token)) {
    throw new Error(`the settlement token address must be long-zero, got ${token}`);
  }
  const admin = resources.operator.evmAddress;
  const vault = await new CollateralVault__factory(deployer).deploy(token, admin, {
    gasLimit: GAS.deployVault,
  });
  record.collateralVault = await describe(vault.deploymentTransaction(), await vault.getAddress(), [
    token,
    admin,
  ]);
}

async function deployPool(record: DeploymentRecord, deployer: Wallet, resources: Resources) {
  const vaultRecord = required(record.collateralVault, 'run the vault step first');
  if (record.coverPool) {
    console.log(`pool already deployed at ${record.coverPool.address}`);
    return;
  }
  const admin = resources.operator.evmAddress;
  const pool = await new CoverPool__factory(deployer).deploy(vaultRecord.address, admin, {
    gasLimit: GAS.deployPool,
  });
  record.coverPool = await describe(pool.deploymentTransaction(), await pool.getAddress(), [
    vaultRecord.address,
    admin,
  ]);
}

async function describe(
  tx: ContractTransactionResponse | null,
  address: string,
  constructorArgs: string[],
): Promise<ContractRecord> {
  if (tx === null) throw new Error('no deployment transaction');
  const gasUsed = await confirm(tx);
  const contractId = await contractIdOf(address);
  console.log(`deployed at ${address} (${contractId ?? 'id pending'}) in ${tx.hash}`);
  console.log(`gas used ${gasUsed}`);
  return { address, contractId, deploymentTx: tx.hash, gasUsed: Number(gasUsed), constructorArgs };
}

async function associate(record: DeploymentRecord, deployer: Wallet) {
  const vaultRecord = required(record.collateralVault, 'run the vault step first');
  const vault = CollateralVault__factory.connect(vaultRecord.address, deployer);
  if (await vault.isSettlementTokenAssociated()) {
    console.log('vault already associated with the settlement token');
    record.settlementTokenAssociated = true;
    return;
  }
  const tx = await vault.associateSettlementToken({ gasLimit: GAS.associate });
  const gasUsed = await confirm(tx);
  console.log(`associated in ${tx.hash}, gas used ${gasUsed}`);
  // Assert it rather than trust the response code: a vault that cannot receive
  // the token fails at the first premium, which is much later.
  if (!(await vault.isSettlementTokenAssociated())) {
    throw new Error('association reported success but isAssociated() is still false');
  }
  record.settlementTokenAssociated = true;
  record.gasUsed = { ...record.gasUsed, associateSettlementToken: Number(gasUsed) };
}

async function wire(record: DeploymentRecord, deployer: Wallet) {
  const vaultRecord = required(record.collateralVault, 'run the vault step first');
  const poolRecord = required(record.coverPool, 'run the pool step first');
  const vault = CollateralVault__factory.connect(vaultRecord.address, deployer);
  const current = await vault.coverPool();
  if (current !== ZERO_ADDRESS) {
    if (current.toLowerCase() !== poolRecord.address.toLowerCase()) {
      throw new Error(`the vault already points at ${current}; redeploy the vault`);
    }
    console.log('vault already points at the pool');
    record.coverPoolWired = true;
    return;
  }
  const tx = await vault.setCoverPool(poolRecord.address, { gasLimit: GAS.setCoverPool });
  await confirm(tx);
  console.log(`vault wired to the pool in ${tx.hash}`);
  record.coverPoolWired = true;
}

async function grantRoles(record: DeploymentRecord, deployer: Wallet, resources: Resources) {
  const vaultRecord = required(record.collateralVault, 'run the vault step first');
  const poolRecord = required(record.coverPool, 'run the pool step first');
  const vault = CollateralVault__factory.connect(vaultRecord.address, deployer);
  const pool = CoverPool__factory.connect(poolRecord.address, deployer);

  const oracle = requireAccount(resources, 'oracle');
  const api = requireAccount(resources, 'api');
  const admin = resources.operator.evmAddress;

  // Key separation, asserted rather than assumed: the account that publishes
  // the index is not the account that authorises a payout, and neither is the
  // account that administers the contracts.
  for (const [label, address] of [
    ['admin', admin],
    ['oracle', oracle],
    ['api', api],
  ] as const) {
    if (isLongZero(address)) {
      throw new Error(`${label} is a long-zero address and cannot pass an ECRECOVER check`);
    }
  }
  if (new Set([admin.toLowerCase(), oracle.toLowerCase(), api.toLowerCase()]).size !== 3) {
    throw new Error('admin, oracle and api must be three distinct addresses');
  }

  const grants = [
    ['ORACLE_ROLE', await pool.ORACLE_ROLE(), pool, oracle, 'oracle'],
    ['BINDER_ROLE', await pool.BINDER_ROLE(), pool, api, 'api'],
    ['CLAIMS_ROLE', await pool.CLAIMS_ROLE(), pool, api, 'api'],
    ['SUBSCRIPTION_ROLE', await vault.SUBSCRIPTION_ROLE(), vault, api, 'api'],
    ['TREASURY_ROLE', await vault.TREASURY_ROLE(), vault, api, 'api'],
  ] as const;

  const roles: Record<string, string> = { ...record.roles, admin };
  for (const [name, role, contract, address, holder] of grants) {
    if (await contract.hasRole(role, address)) {
      console.log(`${name} already held by the ${holder} account`);
    } else {
      // One transaction at a time: a 429 in the middle of a batch leaves you
      // guessing which grant landed.
      const tx = await contract.grantRole(role, address, { gasLimit: GAS.grantRole });
      await confirm(tx);
      console.log(`${name} granted to the ${holder} account ${address} in ${tx.hash}`);
    }
    roles[name] = address;
  }
  record.roles = roles;
}

async function registerSeries(record: DeploymentRecord, deployer: Wallet) {
  const vaultRecord = required(record.collateralVault, 'run the vault step first');
  const poolRecord = required(record.coverPool, 'run the pool step first');
  const vault = CollateralVault__factory.connect(vaultRecord.address, deployer);
  const pool = CoverPool__factory.connect(poolRecord.address, deployer);

  const seriesId = toBytes32(SERIES_LABEL);
  const group = toBytes32(GROUP_LABEL);
  const existing = await vault.seriesOf(seriesId);
  const maturityAt =
    existing.maturityAt !== 0n
      ? Number(existing.maturityAt)
      : Math.floor(Date.now() / 1000) + SERIES_TERMS.term;

  const series = {
    id: seriesId,
    label: SERIES_LABEL,
    group: GROUP_LABEL,
    attachmentShock: ATTACHMENT_SHOCK.toString(),
    levelLine: LEVEL_LINE.toString(),
    exhaustionShock: EXHAUSTION_SHOCK.toString(),
    payoutMode: 'full',
    maturityAt,
    ...record.series,
  };

  if (existing.maturityAt === 0n) {
    // The ATS token address is recorded for the audit trail only; T06 fills it
    // in when the note is issued.
    const tx = await vault.openSeries(seriesId, ZERO_ADDRESS, maturityAt, {
      gasLimit: GAS.openSeries,
    });
    await confirm(tx);
    series.openSeriesTx = tx.hash;
    console.log(`series opened in the vault in ${tx.hash}, matures at ${maturityAt}`);
  } else {
    console.log('series already open in the vault');
  }

  const registered = await pool.seriesOf(seriesId);
  if (registered.status === 0n) {
    // Printed in both forms so a judge can check them against the published
    // calibration without decoding the scale.
    console.log(
      `registering ${SERIES_LABEL} (${GROUP_LABEL}): ` +
        `attachment ${Number(ATTACHMENT_SHOCK) / 10_000} points (${ATTACHMENT_SHOCK}), ` +
        `level line ${Number(LEVEL_LINE) / 10_000} points (${LEVEL_LINE}), ` +
        `exhaustion ${Number(EXHAUSTION_SHOCK) / 10_000} points (${EXHAUSTION_SHOCK})`,
    );
    const tx = await pool.registerSeries(
      {
        seriesId,
        group,
        attachmentShock: ATTACHMENT_SHOCK,
        levelLine: LEVEL_LINE,
        exhaustionShock: EXHAUSTION_SHOCK,
        ...SERIES_TERMS,
      },
      { gasLimit: GAS.registerSeries },
    );
    const gasUsed = await confirm(tx);
    series.registerSeriesTx = tx.hash;
    record.gasUsed = { ...record.gasUsed, registerSeries: Number(gasUsed) };
    console.log(`series registered in the pool in ${tx.hash}, gas used ${gasUsed}`);
  } else {
    console.log('series already registered in the pool');
  }
  record.series = series;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function requireAccount(resources: Resources, role: string): string {
  const account = resources.accounts[role];
  if (account === undefined) throw new Error(`docs/hedera.testnet.json has no ${role} account`);
  return account.evmAddress;
}

await main();
