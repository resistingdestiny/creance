import { network } from 'hardhat';

import { DAY, PAYOUT_FULL, tusd } from './helpers.js';

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
  const [deployer, admin, api, coverPool, investor1, investor2, outsider] =
    await ethers.getSigners();

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
