import { network } from 'hardhat';

import { at, DAY, PAYOUT_FULL, tusd } from './helpers.js';

/// The demo series, ODI-COMP-2026-01, for the detailed BLS group "computer and
/// mathematical". The frozen calibration is a shock attachment of 2.0 points
/// and a level line of -0.68 points, both scaled by 1e4. A negative level line
/// is real: for a profession with structurally low unemployment the trigger is
/// deterioration against its own history.
export const SERIES_ID = '0x' + Buffer.from('ODI-COMP-2026-01'.padEnd(32, '\0')).toString('hex');
export const GROUP = '0x' + Buffer.from('computer_math'.padEnd(32, '\0')).toString('hex');
export const ATTACHMENT_SHOCK = 20_000n;
export const LEVEL_LINE = -6_800n;
export const EXHAUSTION_SHOCK = 40_000n;
export const PRINCIPAL = tusd(100_000);
export const COVER_LIMIT = tusd(5_000);
export const MONTHLY_PREMIUM = tusd(28);

export const DEMO_TERMS = {
  seriesId: SERIES_ID,
  group: GROUP,
  attachmentShock: ATTACHMENT_SHOCK,
  levelLine: LEVEL_LINE,
  exhaustionShock: EXHAUSTION_SHOCK,
  payoutMode: PAYOUT_FULL,
  waitingPeriod: 60 * DAY,
  term: 365 * DAY,
  gracePeriod: 15 * DAY,
  claimWindowFromObservation: 30 * DAY,
  claimWindowFromSeparation: 60 * DAY,
  lookbackMonths: 2,
};

export async function deployVault() {
  const { ethers, networkHelpers } = await network.getOrCreate();
  const signers = await ethers.getSigners();
  const deployer = at(signers, 0, 'signer');
  const admin = at(signers, 1, 'signer');
  const api = at(signers, 2, 'signer');
  const coverPool = at(signers, 3, 'signer');
  const investor1 = at(signers, 4, 'signer');
  const investor2 = at(signers, 5, 'signer');
  const outsider = at(signers, 6, 'signer');

  const token = await ethers.deployContract('MockSettlementToken', ['Creance Test USD', 'TUSD', 6]);
  const vault = await ethers.deployContract('CollateralVault', [
    await token.getAddress(),
    admin.address,
  ]);

  await vault.connect(admin).grantRole(await vault.SUBSCRIPTION_ROLE(), api.address);
  await vault.connect(admin).grantRole(await vault.TREASURY_ROLE(), api.address);
  await vault.connect(admin).setCoverPool(coverPool.address);

  const maturityAt = (await networkHelpers.time.latest()) + 400 * DAY;
  await vault.connect(admin).openSeries(SERIES_ID, ethers.ZeroAddress, maturityAt);

  await token.mint(api.address, tusd(1_000_000));
  await token.connect(api).approve(await vault.getAddress(), ethers.MaxUint256);

  return {
    ethers,
    networkHelpers,
    deployer,
    admin,
    api,
    coverPool,
    investor1,
    investor2,
    outsider,
    token,
    vault,
    maturityAt,
  };
}

/// Month arithmetic mirrored in TypeScript so a test can say "three months
/// after the policy started" without asking the contract first.
export function monthIndexOf(timestamp: number | bigint): number {
  const d = new Date(Number(timestamp) * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function yyyymmOf(monthIndex: number): number {
  return Math.floor(monthIndex / 12) * 100 + (monthIndex % 12) + 1;
}

export function startOfMonth(monthIndex: number): number {
  return Math.floor(Date.UTC(Math.floor(monthIndex / 12), monthIndex % 12, 1) / 1000);
}

export const SERIES_B = '0x' + Buffer.from('ODI-OFFICE-2026-01'.padEnd(32, '\0')).toString('hex');

export const POLICY_IDS = [
  '0x' + 'a1'.repeat(32),
  '0x' + 'a2'.repeat(32),
  '0x' + 'a3'.repeat(32),
] as const;
export const NULLIFIERS = [
  '0x' + 'b1'.repeat(32),
  '0x' + 'b2'.repeat(32),
  '0x' + 'b3'.repeat(32),
] as const;

/// The pool fixture starts the clock at the first instant of a month, so every
/// "three months later" in the suite lands on a known boundary rather than on
/// whatever day the suite happened to run.
export async function deployPool() {
  const { ethers, networkHelpers } = await network.getOrCreate();
  const signers = await ethers.getSigners();
  const deployer = at(signers, 0, 'signer');
  const admin = at(signers, 1, 'signer');
  const oracle = at(signers, 2, 'signer');
  const api = at(signers, 3, 'signer');
  const claimsSigner = at(signers, 4, 'signer');
  const holder1 = at(signers, 5, 'signer');
  const holder2 = at(signers, 6, 'signer');
  const holder3 = at(signers, 7, 'signer');
  const investor1 = at(signers, 8, 'signer');
  const investor2 = at(signers, 9, 'signer');
  const outsider = at(signers, 10, 'signer');

  const monthStart = startOfMonth(monthIndexOf(await networkHelpers.time.latest()) + 1);
  await networkHelpers.time.increaseTo(monthStart);

  const token = await ethers.deployContract('MockSettlementToken', ['Creance Test USD', 'TUSD', 6]);
  const vault = await ethers.deployContract('CollateralVault', [
    await token.getAddress(),
    admin.address,
  ]);
  const pool = await ethers.deployContract('CoverPool', [await vault.getAddress(), admin.address]);

  await vault.connect(admin).setCoverPool(await pool.getAddress());
  await vault.connect(admin).grantRole(await vault.SUBSCRIPTION_ROLE(), api.address);
  await vault.connect(admin).grantRole(await vault.TREASURY_ROLE(), api.address);
  await pool.connect(admin).grantRole(await pool.ORACLE_ROLE(), oracle.address);
  await pool.connect(admin).grantRole(await pool.BINDER_ROLE(), api.address);
  await pool.connect(admin).grantRole(await pool.CLAIMS_ROLE(), claimsSigner.address);

  const startAt = monthStart;
  const maturityAt = startAt + 400 * DAY;
  await vault.connect(admin).openSeries(SERIES_ID, ethers.ZeroAddress, maturityAt);
  await pool.connect(admin).registerSeries(DEMO_TERMS);

  await token.mint(api.address, tusd(1_000_000));
  await token.connect(api).approve(await vault.getAddress(), ethers.MaxUint256);
  await vault.connect(api).subscribe(SERIES_ID, investor1.address, tusd(50_000));
  await vault.connect(api).subscribe(SERIES_ID, investor2.address, tusd(50_000));

  const holders = [holder1, holder2, holder3];
  for (let i = 0; i < 3; i += 1) {
    await pool.connect(api).bind({
      policyId: at(POLICY_IDS, i, 'policy id'),
      seriesId: SERIES_ID,
      holder: at(holders, i, 'holder').address,
      nullifierHash: at(NULLIFIERS, i, 'nullifier'),
      limit: COVER_LIMIT,
      premium: MONTHLY_PREMIUM,
      startAt,
      hcsReceiptSeq: 100n + BigInt(i),
    });
  }

  const baseMonth = monthIndexOf(startAt);

  return {
    ethers,
    networkHelpers,
    deployer,
    admin,
    oracle,
    api,
    claimsSigner,
    holders,
    holder1,
    holder2,
    holder3,
    investor1,
    investor2,
    outsider,
    token,
    vault,
    pool,
    startAt,
    maturityAt,
    baseMonth,
  };
}
