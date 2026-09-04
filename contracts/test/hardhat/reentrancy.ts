import { expect } from 'chai';
import { network } from 'hardhat';

import { claimDomain, signAuthorisation, type ClaimAuthorisation } from './authorisation.js';
import { COVER_LIMIT, DEMO_TERMS, MONTHLY_PREMIUM, SERIES_ID, monthIndexOf, startOfMonth, yyyymmOf } from './fixtures.js';
import { DAY, tusd } from './helpers.js';

const POLICY_ID = '0x' + 'a1'.repeat(32);
const NULLIFIER = '0x' + 'b1'.repeat(32);
const CLAIM_ID = '0x' + 'f1'.repeat(32);
const PACKET_HASH = '0x' + 'c1'.repeat(32);
const DECISION_HASH = '0x' + 'd1'.repeat(32);
const SOURCE_HASH = '0x' + 'e1'.repeat(32);

// The claim path is the only place where CoverPool makes an external call while
// its own state is half written, so the guard on it is worth proving rather
// than assuming.
describe('CoverPool reentrancy', () => {
  it('blocks a settlement token that calls back into payClaim', async () => {
    const { ethers, networkHelpers } = await network.getOrCreate();
    const [, admin, oracle, api, claimsSigner, holder, investor] = await ethers.getSigners();

    const monthStart = startOfMonth(monthIndexOf(await networkHelpers.time.latest()) + 1);
    await networkHelpers.time.increaseTo(monthStart);

    const token = await ethers.deployContract('ReentrantSettlementToken');
    const vault = await ethers.deployContract('CollateralVault', [
      await token.getAddress(),
      admin.address,
    ]);
    const pool = await ethers.deployContract('CoverPool', [await vault.getAddress(), admin.address]);

    await vault.connect(admin).setCoverPool(await pool.getAddress());
    await vault.connect(admin).grantRole(await vault.SUBSCRIPTION_ROLE(), api.address);
    await pool.connect(admin).grantRole(await pool.ORACLE_ROLE(), oracle.address);
    await pool.connect(admin).grantRole(await pool.BINDER_ROLE(), api.address);
    await pool.connect(admin).grantRole(await pool.CLAIMS_ROLE(), claimsSigner.address);

    const startAt = monthStart;
    await vault.connect(admin).openSeries(SERIES_ID, ethers.ZeroAddress, startAt + 400 * DAY);
    await pool.connect(admin).registerSeries(DEMO_TERMS);

    await token.mint(api.address, tusd(1_000_000));
    await token.connect(api).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(api).subscribe(SERIES_ID, investor.address, tusd(100_000));
    await pool.connect(api).bind({
      policyId: POLICY_ID,
      seriesId: SERIES_ID,
      holder: holder.address,
      nullifierHash: NULLIFIER,
      limit: COVER_LIMIT,
      premium: MONTHLY_PREMIUM,
      startAt,
      hcsReceiptSeq: 1n,
    });

    const baseMonth = monthIndexOf(startAt);
    const separationMonth = baseMonth + 3;
    await networkHelpers.time.increaseTo(startOfMonth(separationMonth + 1) + 5 * DAY);
    await pool.connect(oracle).submitObservation({
      seriesId: SERIES_ID,
      period: yyyymmOf(separationMonth),
      odi: 3_000n,
      ebar: -6_000n,
      hcsSequence: 1n,
      sourceHash: SOURCE_HASH,
    });

    const value: ClaimAuthorisation = {
      policyId: POLICY_ID,
      claimId: CLAIM_ID,
      nullifierHash: NULLIFIER,
      packetHash: PACKET_HASH,
      decisionHash: DECISION_HASH,
      payee: holder.address,
      amount: COVER_LIMIT,
      separationAt: BigInt(startOfMonth(separationMonth) + 5 * DAY),
      deadline: BigInt((await networkHelpers.time.latest()) + 1800),
    };
    const domain = await claimDomain(pool, (await ethers.provider.getNetwork()).chainId);
    const signature = await signAuthorisation(claimsSigner, domain, value);
    const params = {
      policyId: value.policyId,
      claimId: value.claimId,
      separationAt: value.separationAt,
      packetHash: value.packetHash,
      decisionHash: value.decisionHash,
      amount: value.amount,
      payee: value.payee,
      authDeadline: value.deadline,
    };

    await token.arm(
      await pool.getAddress(),
      pool.interface.encodeFunctionData('payClaim', [params, signature]),
    );

    await expect(pool.payClaim(params, signature))
      .to.be.revertedWithCustomError(pool, 'ReentrancyGuardReentrantCall');

    // Nothing moved, and the same claim pays exactly once when the token stops
    // calling back.
    await token.arm(ethers.ZeroAddress, '0x');
    await pool.payClaim(params, signature);
    expect(await token.balanceOf(holder.address)).to.equal(COVER_LIMIT);
    expect(await vault.reservedOf(SERIES_ID)).to.equal(0n);
    expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(95_000));
  });
});
