import { expect } from 'chai';
import { network } from 'hardhat';

import { claimDomain, signAuthorisation, type ClaimAuthorisation } from './authorisation.js';
import {
  ATTACHMENT_SHOCK,
  COVER_LIMIT,
  DEMO_TERMS,
  GROUP,
  LEVEL_LINE,
  MONTHLY_PREMIUM,
  NULLIFIERS,
  POLICY_IDS,
  PRINCIPAL,
  SERIES_B,
  SERIES_ID,
  deployPool,
  monthIndexOf,
  startOfMonth,
  yyyymmOf,
} from './fixtures.js';
import {
  DAY,
  PAYOUT_INDEXED,
  POLICY_ACTIVE,
  POLICY_EXPIRED,
  POLICY_LAPSED,
  POLICY_PAID,
  REASON_LEVEL,
  REASON_NONE,
  REASON_SHOCK,
  STATUS_ACTIVE,
  STATUS_CLAIMS_OPEN,
  STATUS_MATURED,
  STATUS_SETTLING,
  assertExposure,
  assertSolvent,
  tusd,
} from './helpers.js';

const PACKET_HASH = '0x' + 'c1'.repeat(32);
const DECISION_HASH = '0x' + 'd1'.repeat(32);
const SOURCE_HASH = '0x' + 'e1'.repeat(32);
const CLAIM_ID = '0x' + 'f1'.repeat(32);

type Fixture = Awaited<ReturnType<typeof deployPool>>;

describe('CoverPool', () => {
  let f: Fixture;

  beforeEach(async () => {
    const { networkHelpers } = await network.getOrCreate();
    f = await networkHelpers.loadFixture(deployPool);
  });

  // I8 and I1, after every test in this file.
  afterEach(async () => {
    await assertSolvent(f.token, f.vault);
    await assertExposure(f.pool);
  });

  /// Submit one observation from the oracle account.
  async function observe(
    monthIndex: number,
    values: { odi: bigint; ebar: bigint },
    sequence = 1n,
  ) {
    return f.pool.connect(f.oracle).submitObservation({
      seriesId: SERIES_ID,
      period: yyyymmOf(monthIndex),
      odi: values.odi,
      ebar: values.ebar,
      hcsSequence: sequence,
      sourceHash: SOURCE_HASH,
    });
  }

  /// The demo opening: the smoothed excess crosses a negative level line while
  /// the year on year ODI stays well below the shock attachment.
  const LEVEL_OPENING = { odi: 3_000n, ebar: -6_000n };
  const CLOSED = { odi: 3_000n, ebar: -12_000n };
  const SHOCK_OPENING = { odi: 30_000n, ebar: -12_000n };

  /// Build the correct claim parameters and the matching signed value.
  async function makeClaim(overrides: Partial<ClaimAuthorisation> = {}) {
    const separationAt = overrides.separationAt ?? BigInt(startOfMonth(f.baseMonth + 3) + 5 * DAY);
    const value: ClaimAuthorisation = {
      policyId: overrides.policyId ?? POLICY_IDS[0],
      claimId: overrides.claimId ?? CLAIM_ID,
      nullifierHash: overrides.nullifierHash ?? NULLIFIERS[0],
      packetHash: overrides.packetHash ?? PACKET_HASH,
      decisionHash: overrides.decisionHash ?? DECISION_HASH,
      payee: overrides.payee ?? f.holder1.address,
      amount: overrides.amount ?? COVER_LIMIT,
      separationAt,
      deadline: overrides.deadline ?? BigInt((await f.networkHelpers.time.latest()) + 1800),
    };
    return { value, params: toParams(value) };
  }

  function toParams(value: ClaimAuthorisation) {
    return {
      policyId: value.policyId,
      claimId: value.claimId,
      separationAt: value.separationAt,
      packetHash: value.packetHash,
      decisionHash: value.decisionHash,
      amount: value.amount,
      payee: value.payee,
      authDeadline: value.deadline,
    };
  }

  async function sign(
    value: ClaimAuthorisation,
    domainOverride?: { chainId?: bigint; verifyingContract?: string },
    signer = f.claimsSigner,
  ) {
    const chainId = domainOverride?.chainId ?? (await f.ethers.provider.getNetwork()).chainId;
    const domain = await claimDomain(f.pool, chainId, domainOverride?.verifyingContract);
    return signAuthorisation(signer, domain, value);
  }

  async function authorise(
    overrides: Partial<ClaimAuthorisation> = {},
    domainOverride?: { chainId?: bigint; verifyingContract?: string },
  ) {
    const { value, params } = await makeClaim(overrides);
    return { params, signature: await sign(value, domainOverride), value };
  }

  /// The default claim scenario: stand five days into the month after the
  /// separation month, open that separation month on the level form.
  async function openDemoWindow() {
    const separationMonth = f.baseMonth + 3;
    await f.networkHelpers.time.increaseTo(startOfMonth(separationMonth + 1) + 5 * DAY);
    await observe(separationMonth, LEVEL_OPENING);
    return separationMonth;
  }

  describe('series registration', () => {
    it('stores the terms and rejects a duplicate', async () => {
      const { pool, admin } = f;
      const series = await pool.seriesOf(SERIES_ID);
      expect(series.group).to.equal(GROUP);
      expect(series.attachmentShock).to.equal(ATTACHMENT_SHOCK);
      expect(series.levelLine).to.equal(LEVEL_LINE);
      expect(series.status).to.equal(STATUS_ACTIVE);
      await expect(pool.connect(admin).registerSeries(DEMO_TERMS))
        .to.be.revertedWithCustomError(pool, 'SeriesExists');
    });

    it('rejects an indexed series whose exhaustion is not above its attachment', async () => {
      const { pool, admin, vault, ethers, maturityAt } = f;
      await vault.connect(admin).openSeries(SERIES_B, ethers.ZeroAddress, maturityAt);
      await expect(
        pool.connect(admin).registerSeries({
          ...DEMO_TERMS,
          seriesId: SERIES_B,
          payoutMode: PAYOUT_INDEXED,
          exhaustionShock: ATTACHMENT_SHOCK,
        }),
      ).to.be.revertedWithCustomError(pool, 'BadTerms');
    });

    it('rejects a lookback above three months', async () => {
      const { pool, admin, vault, ethers, maturityAt } = f;
      await vault.connect(admin).openSeries(SERIES_B, ethers.ZeroAddress, maturityAt);
      await expect(
        pool.connect(admin).registerSeries({ ...DEMO_TERMS, seriesId: SERIES_B, lookbackMonths: 4 }),
      ).to.be.revertedWithCustomError(pool, 'BadTerms');
    });

    it('rejects a series the vault does not know', async () => {
      const { pool, admin } = f;
      await expect(pool.connect(admin).registerSeries({ ...DEMO_TERMS, seriesId: SERIES_B }))
        .to.be.revertedWithCustomError(f.vault, 'SeriesUnknown');
    });

    it('exposes no function that can change a registered term', async () => {
      const { pool } = f;
      const mutating = pool.interface.fragments
        .filter((fragment) => fragment.type === 'function')
        .filter((fragment) => {
          const f2 = fragment as { stateMutability: string; name: string };
          return f2.stateMutability !== 'view' && f2.stateMutability !== 'pure';
        })
        .map((fragment) => (fragment as { name: string }).name)
        .sort();
      expect(mutating).to.deep.equal([
        'bind',
        'closeWindow',
        'expire',
        'grantRole',
        'lapse',
        'pause',
        'payClaim',
        'recordPremium',
        'registerSeries',
        'renounceRole',
        'revokeRole',
        'setSeriesStatus',
        'submitObservation',
        'unpause',
      ]);
    });

    it('lets the admin move the series to Settling and Matured but never into a claim window', async () => {
      const { pool, admin } = f;
      await pool.connect(admin).setSeriesStatus(SERIES_ID, STATUS_SETTLING);
      expect((await pool.seriesOf(SERIES_ID)).status).to.equal(STATUS_SETTLING);
      await pool.connect(admin).setSeriesStatus(SERIES_ID, STATUS_MATURED);
      await expect(pool.connect(admin).setSeriesStatus(SERIES_ID, STATUS_CLAIMS_OPEN))
        .to.be.revertedWithCustomError(pool, 'SeriesNotActive');
    });
  });

  describe('binding and capacity', () => {
    const FOURTH = '0x' + 'a4'.repeat(32);
    const FOURTH_NULLIFIER = '0x' + 'b4'.repeat(32);

    function bindParams(overrides: Record<string, unknown> = {}) {
      return {
        policyId: FOURTH,
        seriesId: SERIES_ID,
        holder: f.outsider.address,
        nullifierHash: FOURTH_NULLIFIER,
        limit: COVER_LIMIT,
        premium: MONTHLY_PREMIUM,
        startAt: f.startAt,
        hcsReceiptSeq: 200n,
        ...overrides,
      };
    }

    it('writes the policy and adds its limit to the exposure', async () => {
      const { pool } = f;
      const policy = await pool.policyOf(POLICY_IDS[0]);
      expect(policy.holder).to.equal(f.holder1.address);
      expect(policy.limit).to.equal(COVER_LIMIT);
      expect(policy.premium).to.equal(MONTHLY_PREMIUM);
      expect(policy.status).to.equal(POLICY_ACTIVE);
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(15_000));
      expect(await pool.quoteCapacity(SERIES_ID)).to.equal(tusd(85_000));
    });

    it('rejects a bind from anyone without the binder role', async () => {
      const { pool, outsider, admin } = f;
      await expect(pool.connect(outsider).bind(bindParams()))
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
      await expect(pool.connect(admin).bind(bindParams()))
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
    });

    it('binds exactly at the remaining principal and refuses one minor unit more', async () => {
      const { pool, api } = f;
      await expect(pool.connect(api).bind(bindParams({ limit: tusd(85_000) + 1n })))
        .to.be.revertedWithCustomError(pool, 'CapacityExceeded');
      await pool.connect(api).bind(bindParams({ limit: tusd(85_000) }));
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(PRINCIPAL);
      expect(await pool.quoteCapacity(SERIES_ID)).to.equal(0n);
    });

    it('refuses a second active policy for the same nullifier in the same series', async () => {
      const { pool, api } = f;
      await expect(pool.connect(api).bind(bindParams({ nullifierHash: NULLIFIERS[0] })))
        .to.be.revertedWithCustomError(pool, 'NullifierHasActivePolicy');
    });

    it('lets the same nullifier bind in a different series', async () => {
      const { pool, admin, api, vault, ethers, maturityAt, investor1 } = f;
      await vault.connect(admin).openSeries(SERIES_B, ethers.ZeroAddress, maturityAt);
      await pool.connect(admin).registerSeries({ ...DEMO_TERMS, seriesId: SERIES_B });
      await vault.connect(api).subscribe(SERIES_B, investor1.address, tusd(10_000));
      await pool.connect(api).bind(bindParams({ seriesId: SERIES_B, nullifierHash: NULLIFIERS[0] }));
      expect(await pool.activeExposureOf(SERIES_B)).to.equal(COVER_LIMIT);
    });

    it('rejects a duplicate policy id and a zero limit', async () => {
      const { pool, api } = f;
      await expect(pool.connect(api).bind(bindParams({ policyId: POLICY_IDS[0] })))
        .to.be.revertedWithCustomError(pool, 'PolicyExists');
      await expect(pool.connect(api).bind(bindParams({ limit: 0 })))
        .to.be.revertedWithCustomError(pool, 'BadTerms');
    });
  });

  describe('premiums, lapse and expiry', () => {
    it('advances the paid through month and never moves it backwards', async () => {
      const { pool, api, baseMonth } = f;
      await pool.connect(api).recordPremium(POLICY_IDS[0], yyyymmOf(baseMonth + 2));
      expect((await pool.policyOf(POLICY_IDS[0])).paidThroughMonth).to.equal(baseMonth + 2);
      await pool.connect(api).recordPremium(POLICY_IDS[0], yyyymmOf(baseMonth + 1));
      expect((await pool.policyOf(POLICY_IDS[0])).paidThroughMonth).to.equal(baseMonth + 2);
    });

    it('lapses only once the grace period is over, and from any address', async () => {
      const { pool, outsider, networkHelpers, baseMonth } = f;
      const lapsesAt = startOfMonth(baseMonth + 1) + DEMO_TERMS.gracePeriod;
      await networkHelpers.time.increaseTo(lapsesAt - 1);
      await expect(pool.connect(outsider).lapse(POLICY_IDS[0]))
        .to.be.revertedWithCustomError(pool, 'GraceNotOver');

      await networkHelpers.time.increaseTo(lapsesAt);
      await expect(pool.connect(outsider).lapse(POLICY_IDS[0]))
        .to.emit(pool, 'PolicyLapsed')
        .withArgs(POLICY_IDS[0], tusd(10_000));
      expect((await pool.policyOf(POLICY_IDS[0])).status).to.equal(POLICY_LAPSED);
      expect(await pool.activePolicyOf(SERIES_ID, NULLIFIERS[0])).to.equal(f.ethers.ZeroHash);
    });

    it('frees the lapsed capacity for a new bind by the same nullifier', async () => {
      const { pool, api, networkHelpers, baseMonth } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 1) + DEMO_TERMS.gracePeriod + 1);
      await pool.lapse(POLICY_IDS[0]);
      await pool.connect(api).bind({
        policyId: '0x' + 'a9'.repeat(32),
        seriesId: SERIES_ID,
        holder: f.holder1.address,
        nullifierHash: NULLIFIERS[0],
        limit: COVER_LIMIT,
        premium: MONTHLY_PREMIUM,
        startAt: await networkHelpers.time.latest(),
        hcsReceiptSeq: 300n,
      });
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(15_000));
    });

    it('expires after the term, reduces the exposure once, and reverts on a second call', async () => {
      const { pool, networkHelpers, startAt } = f;
      await expect(pool.expire(POLICY_IDS[0])).to.be.revertedWithCustomError(pool, 'TermNotOver');
      await networkHelpers.time.increaseTo(startAt + DEMO_TERMS.term + 1);
      await pool.expire(POLICY_IDS[0]);
      expect((await pool.policyOf(POLICY_IDS[0])).status).to.equal(POLICY_EXPIRED);
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(10_000));
      await expect(pool.expire(POLICY_IDS[0])).to.be.revertedWithCustomError(pool, 'PolicyNotActive');
    });

    it('blocks lapse and expire while a claim window is open and allows them after it closes', async () => {
      const { pool, networkHelpers, startAt } = f;
      const separationMonth = await openDemoWindow();
      await expect(pool.lapse(POLICY_IDS[0]))
        .to.be.revertedWithCustomError(pool, 'SeriesInClaimWindow');
      await expect(pool.expire(POLICY_IDS[0]))
        .to.be.revertedWithCustomError(pool, 'SeriesInClaimWindow');

      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));
      await pool.closeWindow(SERIES_ID);
      await networkHelpers.time.increaseTo(startAt + DEMO_TERMS.term + 1);
      await pool.expire(POLICY_IDS[0]);
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(10_000));
      expect(separationMonth).to.be.greaterThan(0);
    });
  });

  describe('observations and open months', () => {
    it('rejects a submission from anyone without the oracle role, including the admin', async () => {
      const { pool, admin, baseMonth } = f;
      await expect(
        pool.connect(admin).submitObservation({
          seriesId: SERIES_ID,
          period: yyyymmOf(baseMonth),
          odi: 0n,
          ebar: 0n,
          hcsSequence: 1n,
          sourceHash: SOURCE_HASH,
        }),
      ).to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
    });

    it('records a closed month and leaves the series Active', async () => {
      const { pool, baseMonth } = f;
      await expect(observe(baseMonth, CLOSED))
        .to.emit(pool, 'ObservationSubmitted')
        .withArgs(SERIES_ID, yyyymmOf(baseMonth), CLOSED.odi, CLOSED.ebar, false, REASON_NONE, 1n, SOURCE_HASH);
      expect(await pool.isOpenMonth(SERIES_ID, baseMonth)).to.equal(false);
      expect((await pool.seriesOf(SERIES_ID)).status).to.equal(STATUS_ACTIVE);
      expect(await f.vault.reservedOf(SERIES_ID)).to.equal(0n);
    });

    it('takes the opening decision itself: the input carries no open flag', async () => {
      const { pool } = f;
      const fragment = pool.interface.getFunction('submitObservation');
      const fields = fragment.inputs[0].components?.map((c) => c.name) ?? [];
      expect(fields).to.deep.equal([
        'seriesId',
        'period',
        'odi',
        'ebar',
        'hcsSequence',
        'sourceHash',
      ]);
    });

    it('opens on the shock form at the attachment exactly and not one unit below', async () => {
      const { pool, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 2) + DAY);
      await observe(baseMonth, { odi: ATTACHMENT_SHOCK - 1n, ebar: CLOSED.ebar });
      expect(await pool.isOpenMonth(SERIES_ID, baseMonth)).to.equal(false);
      await observe(baseMonth + 1, { odi: ATTACHMENT_SHOCK, ebar: CLOSED.ebar });
      expect(await pool.isOpenMonth(SERIES_ID, baseMonth + 1)).to.equal(true);
      expect((await pool.observationOf(SERIES_ID, yyyymmOf(baseMonth + 1))).openReason)
        .to.equal(REASON_SHOCK);
    });

    it('opens on a negative level line at the line exactly and not one unit below', async () => {
      const { pool, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 2) + DAY);
      await observe(baseMonth, { odi: CLOSED.odi, ebar: LEVEL_LINE - 1n });
      expect(await pool.isOpenMonth(SERIES_ID, baseMonth)).to.equal(false);
      await observe(baseMonth + 1, { odi: CLOSED.odi, ebar: LEVEL_LINE });
      expect(await pool.isOpenMonth(SERIES_ID, baseMonth + 1)).to.equal(true);
      expect((await pool.observationOf(SERIES_ID, yyyymmOf(baseMonth + 1))).openReason)
        .to.equal(REASON_LEVEL);
    });

    it('reports the shock form when both forms hold', async () => {
      const { pool, baseMonth } = f;
      await observe(baseMonth, { odi: ATTACHMENT_SHOCK, ebar: LEVEL_LINE });
      expect((await pool.observationOf(SERIES_ID, yyyymmOf(baseMonth))).openReason)
        .to.equal(REASON_SHOCK);
    });

    it('never overwrites a period and never accepts an earlier one', async () => {
      const { pool, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 2) + DAY);
      await observe(baseMonth + 1, CLOSED);
      await expect(observe(baseMonth + 1, LEVEL_OPENING))
        .to.be.revertedWithCustomError(pool, 'ObservationExists');
      await expect(observe(baseMonth, CLOSED))
        .to.be.revertedWithCustomError(pool, 'PeriodNotAfterLast');
      expect((await pool.observationOf(SERIES_ID, yyyymmOf(baseMonth + 1))).ebar)
        .to.equal(CLOSED.ebar);
    });

    it('rejects a period that has not started yet', async () => {
      const { pool, baseMonth } = f;
      await expect(observe(baseMonth + 1, CLOSED))
        .to.be.revertedWithCustomError(pool, 'PeriodInFuture');
    });

    it('reserves the whole exposure on the first open month', async () => {
      const { pool, vault, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 1) + DAY);
      await expect(observe(baseMonth, LEVEL_OPENING)).to.emit(pool, 'ClaimsOpened');
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));
      expect(await pool.exposureCoveredOf(SERIES_ID)).to.equal(tusd(15_000));
      expect((await pool.seriesOf(SERIES_ID)).status).to.equal(STATUS_CLAIMS_OPEN);
      expect(await vault.principalFree(SERIES_ID)).to.equal(tusd(85_000));
    });

    it('reserves nothing on a second open month that added no exposure', async () => {
      const { pool, vault, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 2) + DAY);
      await observe(baseMonth, LEVEL_OPENING);
      const reserved = await vault.reservedOf(SERIES_ID);
      const windowBefore = await pool.windowEndsAtOf(SERIES_ID);

      await expect(observe(baseMonth + 1, LEVEL_OPENING, 2n))
        .to.emit(pool, 'WindowExtended')
        .and.not.to.emit(pool, 'ReserveToppedUp');
      expect(await vault.reservedOf(SERIES_ID)).to.equal(reserved);
      expect(await pool.windowEndsAtOf(SERIES_ID)).to.be.greaterThan(windowBefore);
    });

    it('tops the reserve up by exactly the limit of a policy bound during the window', async () => {
      const { pool, vault, api, baseMonth, networkHelpers, outsider } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 2) + DAY);
      await observe(baseMonth, LEVEL_OPENING);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));

      await pool.connect(api).bind({
        policyId: '0x' + 'a5'.repeat(32),
        seriesId: SERIES_ID,
        holder: outsider.address,
        nullifierHash: '0x' + 'b5'.repeat(32),
        limit: tusd(7_000),
        premium: MONTHLY_PREMIUM,
        startAt: await networkHelpers.time.latest(),
        hcsReceiptSeq: 400n,
      });
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(22_000));

      await expect(observe(baseMonth + 1, LEVEL_OPENING, 2n))
        .to.emit(pool, 'ReserveToppedUp')
        .withArgs(SERIES_ID, yyyymmOf(baseMonth + 1), tusd(7_000), tusd(22_000));
      expect(await pool.exposureCoveredOf(SERIES_ID)).to.equal(tusd(22_000));
    });

    it('keeps the window open across a gap of months rather than restarting it', async () => {
      const { pool, vault, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 4) + DAY);
      await observe(baseMonth, LEVEL_OPENING);
      const reserved = await vault.reservedOf(SERIES_ID);
      await observe(baseMonth + 3, LEVEL_OPENING, 2n);
      expect((await pool.seriesOf(SERIES_ID)).status).to.equal(STATUS_CLAIMS_OPEN);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(reserved);
      expect(await pool.openMonths(SERIES_ID)).to.deep.equal([BigInt(baseMonth), BigInt(baseMonth + 3)]);
    });
  });

  describe('the loss window', () => {
    it('qualifies the open month itself and the two months before it', async () => {
      const { pool, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 4) + DAY);
      const open = baseMonth + 3;
      await observe(open, LEVEL_OPENING);

      for (const offset of [0, 1, 2]) {
        const [inWindow, qualifying] = await pool.isInLossWindow(SERIES_ID, open - offset);
        expect(inWindow, `offset ${offset}`).to.equal(true);
        expect(qualifying).to.equal(BigInt(open));
      }
      expect((await pool.isInLossWindow(SERIES_ID, open - 3))[0]).to.equal(false);
      expect((await pool.isInLossWindow(SERIES_ID, open + 1))[0]).to.equal(false);
    });

    it('returns the earliest qualifying month when two months are open', async () => {
      const { pool, baseMonth, networkHelpers } = f;
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 4) + DAY);
      await observe(baseMonth + 2, LEVEL_OPENING);
      await observe(baseMonth + 3, LEVEL_OPENING, 2n);
      const [inWindow, qualifying] = await pool.isInLossWindow(SERIES_ID, baseMonth + 1);
      expect(inWindow).to.equal(true);
      expect(qualifying).to.equal(BigInt(baseMonth + 2));
    });
  });

  describe('payClaim', () => {
    it('pays the full limit, marks the policy paid and moves every counter', async () => {
      const { pool, vault, token, holder1, outsider, baseMonth } = f;
      const separationMonth = await openDemoWindow();
      const { params, signature } = await authorise();

      await expect(pool.connect(outsider).payClaim(params, signature))
        .to.emit(pool, 'ClaimPaid')
        .withArgs(
          POLICY_IDS[0],
          CLAIM_ID,
          SERIES_ID,
          holder1.address,
          COVER_LIMIT,
          yyyymmOf(separationMonth),
          yyyymmOf(separationMonth),
          PACKET_HASH,
          DECISION_HASH,
        );

      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
      expect((await pool.policyOf(POLICY_IDS[0])).status).to.equal(POLICY_PAID);
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(10_000));
      expect(await pool.exposureCoveredOf(SERIES_ID)).to.equal(tusd(10_000));
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(10_000));
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(95_000));
      expect(await pool.nullifierClaimed(SERIES_ID, NULLIFIERS[0])).to.equal(true);
      expect(baseMonth).to.be.greaterThan(0);
    });

    it('refuses a replay of the same claim id and a second claim on the same policy', async () => {
      const { pool } = f;
      await openDemoWindow();
      const first = await authorise();
      await pool.payClaim(first.params, first.signature);
      await expect(pool.payClaim(first.params, first.signature))
        .to.be.revertedWithCustomError(pool, 'PolicyNotActive');

      const second = await authorise({ claimId: '0x' + 'f2'.repeat(32) });
      await expect(pool.payClaim(second.params, second.signature))
        .to.be.revertedWithCustomError(pool, 'PolicyNotActive');
    });

    it('refuses a second policy sharing the nullifier, even after the first policy is gone', async () => {
      const { pool, api, networkHelpers, holder1 } = f;
      await openDemoWindow();
      const first = await authorise();
      await pool.payClaim(first.params, first.signature);

      // The paid policy released the nullifier, so a fresh policy can be bound.
      const startAt = await networkHelpers.time.latest();
      await pool.connect(api).bind({
        policyId: '0x' + 'a6'.repeat(32),
        seriesId: SERIES_ID,
        holder: holder1.address,
        nullifierHash: NULLIFIERS[0],
        limit: COVER_LIMIT,
        premium: MONTHLY_PREMIUM,
        startAt,
        hcsReceiptSeq: 500n,
      });
      const second = await authorise({
        policyId: '0x' + 'a6'.repeat(32),
        claimId: '0x' + 'f3'.repeat(32),
      });
      await expect(pool.payClaim(second.params, second.signature))
        .to.be.revertedWithCustomError(pool, 'NullifierAlreadyClaimed');
    });

    it('rejects a separation inside the waiting period and accepts it at the boundary', async () => {
      const { pool, networkHelpers, startAt, token, holder1 } = f;
      const waitingEndsAt = startAt + DEMO_TERMS.waitingPeriod;
      const waitingMonth = monthIndexOf(waitingEndsAt);
      await networkHelpers.time.increaseTo(waitingEndsAt + DAY);
      await observe(waitingMonth, LEVEL_OPENING);

      const early = await authorise({ separationAt: BigInt(waitingEndsAt - 1) });
      await expect(pool.payClaim(early.params, early.signature))
        .to.be.revertedWithCustomError(pool, 'SeparationInWaitingPeriod');

      const onTime = await authorise({ separationAt: BigInt(waitingEndsAt) });
      await pool.payClaim(onTime.params, onTime.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
    });

    it('rejects a separation after the term ends', async () => {
      const { pool, startAt } = f;
      await openDemoWindow();
      const late = await authorise({ separationAt: BigInt(startAt + DEMO_TERMS.term + 1) });
      await expect(pool.payClaim(late.params, late.signature))
        .to.be.revertedWithCustomError(pool, 'SeparationAfterTerm');
    });

    it('reverts while the qualifying month is unobserved and pays once it lands', async () => {
      const { pool, networkHelpers, baseMonth, token, holder1 } = f;
      // A window opened on an earlier month, so the series is ClaimsOpen, but
      // the separation month is not covered by it yet.
      await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 4) + 5 * DAY);
      await observe(baseMonth, LEVEL_OPENING);

      const claim = await authorise();
      await expect(pool.payClaim(claim.params, claim.signature))
        .to.be.revertedWithCustomError(pool, 'SeparationOutsideLossWindow');

      await observe(baseMonth + 3, LEVEL_OPENING, 2n);
      await pool.payClaim(claim.params, claim.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
    });

    it('refuses a claim one second after the deadline', async () => {
      const { pool, networkHelpers } = f;
      await openDemoWindow();
      const probe = await makeClaim();
      const deadline = await pool.claimDeadline(SERIES_ID, probe.value.separationAt);
      await networkHelpers.time.increaseTo(Number(deadline) + 1);

      const expired = await authorise();
      await expect(pool.payClaim(expired.params, expired.signature))
        .to.be.revertedWithCustomError(pool, 'ClaimWindowClosed');
    });

    it('accepts a claim filed on the last permitted second', async () => {
      const { pool, networkHelpers, holder1, token } = f;
      await openDemoWindow();
      const probe = await makeClaim();
      const deadline = await pool.claimDeadline(SERIES_ID, probe.value.separationAt);
      await networkHelpers.time.increaseTo(Number(deadline) - 2);

      const onTime = await authorise();
      await pool.payClaim(onTime.params, onTime.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
    });

    it('takes the later of the two deadline rules', async () => {
      const { pool, networkHelpers, baseMonth } = f;
      const separationMonth = baseMonth + 3;
      const separationAt = startOfMonth(separationMonth) + 5 * DAY;

      // Observation submitted inside the separation month: the separation rule
      // ends later.
      await networkHelpers.time.increaseTo(startOfMonth(separationMonth) + 20 * DAY);
      await observe(separationMonth, LEVEL_OPENING);
      expect(await pool.claimDeadline(SERIES_ID, separationAt)).to.equal(
        BigInt(separationAt + DEMO_TERMS.claimWindowFromSeparation),
      );

      // Observation submitted nearly two months after the separation: the
      // observation rule ends later.
      await networkHelpers.loadFixture(deployPool);
      const observedAt = startOfMonth(separationMonth + 1) + 25 * DAY;
      await networkHelpers.time.increaseTo(observedAt);
      await observe(separationMonth, LEVEL_OPENING);
      const submittedAt = (await pool.observationOf(SERIES_ID, yyyymmOf(separationMonth))).submittedAt;
      expect(await pool.claimDeadline(SERIES_ID, separationAt)).to.equal(
        submittedAt + BigInt(DEMO_TERMS.claimWindowFromObservation),
      );
    });

    it('refuses an amount one minor unit either side of the expected payout', async () => {
      const { pool } = f;
      await openDemoWindow();
      for (const amount of [COVER_LIMIT - 1n, COVER_LIMIT + 1n]) {
        const claim = await authorise({ amount });
        await expect(pool.payClaim(claim.params, claim.signature))
          .to.be.revertedWithCustomError(pool, 'AmountMismatch');
      }
      expect(await pool.expectedPayout(POLICY_IDS[0], startOfMonth(f.baseMonth + 3) + 5 * DAY))
        .to.equal(COVER_LIMIT);
    });

    it('refuses a payee that is not the policy holder', async () => {
      const { pool, outsider } = f;
      await openDemoWindow();
      const claim = await authorise({ payee: outsider.address });
      await expect(pool.payClaim(claim.params, claim.signature))
        .to.be.revertedWithCustomError(pool, 'PayeeIsNotHolder');
    });

    it('rejects a signature over any changed field, one case per field', async () => {
      const { pool, outsider } = f;
      await openDemoWindow();
      const { value, params } = await makeClaim();

      const tamper: Array<[string, Partial<ClaimAuthorisation>]> = [
        ['policyId', { policyId: POLICY_IDS[1] }],
        ['claimId', { claimId: '0x' + 'f9'.repeat(32) }],
        ['nullifierHash', { nullifierHash: NULLIFIERS[1] }],
        ['packetHash', { packetHash: '0x' + 'c9'.repeat(32) }],
        ['decisionHash', { decisionHash: '0x' + 'd9'.repeat(32) }],
        ['payee', { payee: outsider.address }],
        ['amount', { amount: COVER_LIMIT - 1n }],
        ['separationAt', { separationAt: value.separationAt + BigInt(DAY) }],
        ['deadline', { deadline: value.deadline + 1n }],
      ];
      for (const [name, diff] of tamper) {
        const signature = await sign({ ...value, ...diff });
        await expect(pool.payClaim(params, signature), name)
          .to.be.revertedWithCustomError(pool, 'SignerLacksClaimsRole');
      }
    });

    it('rejects a signature from an address without the claims role', async () => {
      const { pool, outsider, ethers } = f;
      await openDemoWindow();
      const claim = await makeClaim();
      const signature = await sign(claim.value, undefined, outsider);
      await expect(pool.payClaim(claim.params, signature))
        .to.be.revertedWithCustomError(pool, 'SignerLacksClaimsRole')
        .withArgs(outsider.address);
      expect(ethers.isAddress(outsider.address)).to.equal(true);
    });

    it('rejects an authorisation bound to another deployment or another chain', async () => {
      const { pool, ethers } = f;
      await openDemoWindow();
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const otherContract = await authorise({}, { verifyingContract: ethers.ZeroAddress });
      await expect(pool.payClaim(otherContract.params, otherContract.signature))
        .to.be.revertedWithCustomError(pool, 'SignerLacksClaimsRole');

      const otherChain = await authorise({}, { chainId: chainId + 1n });
      await expect(pool.payClaim(otherChain.params, otherChain.signature))
        .to.be.revertedWithCustomError(pool, 'SignerLacksClaimsRole');
    });

    it('rejects an expired authorisation and a malformed signature', async () => {
      const { pool, networkHelpers } = f;
      await openDemoWindow();
      const now = await networkHelpers.time.latest();
      const expired = await authorise({ deadline: BigInt(now - 1) });
      await expect(pool.payClaim(expired.params, expired.signature))
        .to.be.revertedWithCustomError(pool, 'AuthorisationExpired');

      const good = await authorise();
      await expect(pool.payClaim(good.params, '0x' + '11'.repeat(64)))
        .to.be.revertedWithCustomError(pool, 'BadSignature');
      const badV = good.signature.slice(0, -2) + '05';
      await expect(pool.payClaim(good.params, badV))
        .to.be.revertedWithCustomError(pool, 'BadSignature');
    });

    it('refuses to pay while the series is not in a claim window, and while paused', async () => {
      const { pool, admin } = f;
      const early = await authorise();
      await expect(pool.payClaim(early.params, early.signature))
        .to.be.revertedWithCustomError(pool, 'SeriesNotActive');

      await openDemoWindow();
      await pool.connect(admin).pause();
      const claim = await authorise();
      await expect(pool.payClaim(claim.params, claim.signature))
        .to.be.revertedWithCustomError(pool, 'EnforcedPause');
    });

    it('leaves nothing behind when the settlement transfer fails, and pays on the retry', async () => {
      const { pool, vault, token, holder1 } = f;
      await openDemoWindow();
      const claim = await authorise();

      await token.setFailTransfers(true);
      await expect(pool.payClaim(claim.params, claim.signature)).to.be.revert(f.ethers);
      expect((await pool.policyOf(POLICY_IDS[0])).status).to.equal(POLICY_ACTIVE);
      expect(await pool.usedClaimId(CLAIM_ID)).to.equal(false);
      expect(await pool.activeExposureOf(SERIES_ID)).to.equal(tusd(15_000));
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));

      await token.setFailTransfers(false);
      await pool.payClaim(claim.params, claim.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
    });
  });

  describe('closeWindow', () => {
    it('refuses to close before the window ends and names the instant it will work', async () => {
      const { pool } = f;
      await openDemoWindow();
      const endsAt = await pool.windowEndsAtOf(SERIES_ID);
      await expect(pool.closeWindow(SERIES_ID))
        .to.be.revertedWithCustomError(pool, 'WindowNotOver')
        .withArgs(SERIES_ID, endsAt);
    });

    it('releases the whole reserve, is callable by anyone, and keeps the open month history', async () => {
      const { pool, vault, networkHelpers, outsider, baseMonth } = f;
      const separationMonth = await openDemoWindow();
      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));

      await expect(pool.connect(outsider).closeWindow(SERIES_ID))
        .to.emit(pool, 'WindowClosed')
        .withArgs(SERIES_ID, tusd(15_000), separationMonth);

      expect(await vault.reservedOf(SERIES_ID)).to.equal(0n);
      expect((await pool.seriesOf(SERIES_ID)).status).to.equal(STATUS_ACTIVE);
      expect(await pool.exposureCoveredOf(SERIES_ID)).to.equal(0n);
      expect(await pool.isOpenMonth(SERIES_ID, separationMonth)).to.equal(true);
      expect(await pool.openMonths(SERIES_ID)).to.deep.equal([BigInt(separationMonth)]);
      expect(baseMonth).to.be.greaterThan(0);
    });

    it('I6: what went into the reserve comes out as a payment plus a release', async () => {
      const { pool, vault, networkHelpers } = f;
      await openDemoWindow();
      const claim = await authorise();
      await pool.payClaim(claim.params, claim.signature);
      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));

      await expect(pool.closeWindow(SERIES_ID))
        .to.emit(pool, 'WindowClosed')
        .withArgs(SERIES_ID, tusd(10_000), await pool.seriesOf(SERIES_ID).then((s) => s.lastOpenMonth));
      expect(await vault.reservedOf(SERIES_ID)).to.equal(0n);
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(95_000));
    });

    it('takes a fresh reserve at the then current exposure when a later month opens', async () => {
      const { pool, vault, api, networkHelpers, outsider } = f;
      await openDemoWindow();
      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));
      await pool.closeWindow(SERIES_ID);

      await pool.connect(api).bind({
        policyId: '0x' + 'a7'.repeat(32),
        seriesId: SERIES_ID,
        holder: outsider.address,
        nullifierHash: '0x' + 'b7'.repeat(32),
        limit: tusd(2_000),
        premium: MONTHLY_PREMIUM,
        startAt: await networkHelpers.time.latest(),
        hcsReceiptSeq: 600n,
      });

      const later = monthIndexOf(await networkHelpers.time.latest());
      await observe(later, LEVEL_OPENING, 2n);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(17_000));
      expect(await pool.exposureCoveredOf(SERIES_ID)).to.equal(tusd(17_000));
    });

    it('I10: the window survives past the observation rule when the separation rule runs later', async () => {
      const { pool, networkHelpers, baseMonth, token, holder1 } = f;
      const separationMonth = baseMonth + 3;
      // Three weeks after the month ends, which is the real publication lag.
      const observedAt = startOfMonth(separationMonth + 1) + 21 * DAY;
      await networkHelpers.time.increaseTo(observedAt);
      await observe(separationMonth, LEVEL_OPENING);

      const expected = BigInt(
        startOfMonth(separationMonth + 1) + DEMO_TERMS.claimWindowFromSeparation,
      );
      expect(await pool.windowEndsAtOf(SERIES_ID)).to.equal(expected);

      // The observation rule alone would have closed the window here.
      await networkHelpers.time.increaseTo(observedAt + DEMO_TERMS.claimWindowFromObservation + 1);
      await expect(pool.closeWindow(SERIES_ID))
        .to.be.revertedWithCustomError(pool, 'WindowNotOver');

      const claim = await authorise({
        separationAt: BigInt(startOfMonth(separationMonth + 1) - 1),
      });
      await pool.payClaim(claim.params, claim.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
    });
  });

  describe('the demo lifecycle, end to end', () => {
    it('reserves 15,000, pays 5,000, releases 10,000 and redeems 47,500 each', async () => {
      const { pool, vault, token, networkHelpers, investor1, investor2, holder1, maturityAt } = f;
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(PRINCIPAL);

      await openDemoWindow();
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));

      const claim = await authorise();
      await pool.payClaim(claim.params, claim.signature);
      expect(await token.balanceOf(holder1.address)).to.equal(tusd(5_000));

      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));
      await pool.closeWindow(SERIES_ID);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(0n);
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(95_000));

      await networkHelpers.time.increaseTo(maturityAt);
      await vault.redeemAtMaturity(SERIES_ID, investor1.address);
      await vault.redeemAtMaturity(SERIES_ID, investor2.address);
      expect(await token.balanceOf(investor1.address)).to.equal(tusd(47_500));
      expect(await token.balanceOf(investor2.address)).to.equal(tusd(47_500));
      expect(await vault.accountedTotal()).to.equal(0n);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
    });
  });

  describe('the indexed payout mode', () => {
    const INDEXED_POLICY = '0x' + 'aa'.repeat(32);
    const INDEXED_NULLIFIER = '0x' + 'bb'.repeat(32);

    async function indexedSeries() {
      const { pool, admin, api, vault, ethers, maturityAt, investor1, outsider, startAt } = f;
      await vault.connect(admin).openSeries(SERIES_B, ethers.ZeroAddress, maturityAt);
      await pool.connect(admin).registerSeries({
        ...DEMO_TERMS,
        seriesId: SERIES_B,
        payoutMode: PAYOUT_INDEXED,
      });
      await vault.connect(api).subscribe(SERIES_B, investor1.address, tusd(50_000));
      await pool.connect(api).bind({
        policyId: INDEXED_POLICY,
        seriesId: SERIES_B,
        holder: outsider.address,
        nullifierHash: INDEXED_NULLIFIER,
        limit: COVER_LIMIT,
        premium: MONTHLY_PREMIUM,
        startAt,
        hcsReceiptSeq: 700n,
      });
    }

    it('interpolates between the attachment and the exhaustion', async () => {
      const { pool, oracle, networkHelpers, baseMonth } = f;
      await indexedSeries();
      const separationMonth = baseMonth + 3;
      await networkHelpers.time.increaseTo(startOfMonth(separationMonth + 1) + 5 * DAY);
      // Half way from 2.0 to 4.0 points, so half the cover limit.
      await pool.connect(oracle).submitObservation({
        seriesId: SERIES_B,
        period: yyyymmOf(separationMonth),
        odi: 30_000n,
        ebar: -12_000n,
        hcsSequence: 1n,
        sourceHash: SOURCE_HASH,
      });
      expect(await pool.expectedPayout(INDEXED_POLICY, startOfMonth(separationMonth) + 5 * DAY))
        .to.equal(COVER_LIMIT / 2n);
    });

    it('caps the payout at the limit above the exhaustion', async () => {
      const { pool, oracle, networkHelpers, baseMonth } = f;
      await indexedSeries();
      const separationMonth = baseMonth + 3;
      await networkHelpers.time.increaseTo(startOfMonth(separationMonth + 1) + 5 * DAY);
      await pool.connect(oracle).submitObservation({
        seriesId: SERIES_B,
        period: yyyymmOf(separationMonth),
        odi: 90_000n,
        ebar: -12_000n,
        hcsSequence: 1n,
        sourceHash: SOURCE_HASH,
      });
      expect(await pool.expectedPayout(INDEXED_POLICY, startOfMonth(separationMonth) + 5 * DAY))
        .to.equal(COVER_LIMIT);
    });

    it('refuses to pay a wrong number when the qualifying month opened on the level form', async () => {
      const { pool, oracle, networkHelpers, baseMonth } = f;
      await indexedSeries();
      const separationMonth = baseMonth + 3;
      await networkHelpers.time.increaseTo(startOfMonth(separationMonth + 1) + 5 * DAY);
      await pool.connect(oracle).submitObservation({
        seriesId: SERIES_B,
        period: yyyymmOf(separationMonth),
        odi: LEVEL_OPENING.odi,
        ebar: LEVEL_OPENING.ebar,
        hcsSequence: 1n,
        sourceHash: SOURCE_HASH,
      });
      await expect(pool.expectedPayout(INDEXED_POLICY, startOfMonth(separationMonth) + 5 * DAY))
        .to.be.revertedWithCustomError(pool, 'IndexedModeNeedsShockOpening');
    });
  });

  describe('roles and pausing', () => {
    it('gates every role gated function', async () => {
      const { pool, outsider, baseMonth } = f;
      await expect(pool.connect(outsider).registerSeries(DEMO_TERMS))
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
      await expect(pool.connect(outsider).setSeriesStatus(SERIES_ID, STATUS_SETTLING))
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
      await expect(pool.connect(outsider).recordPremium(POLICY_IDS[0], yyyymmOf(baseMonth)))
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
      await expect(pool.connect(outsider).pause())
        .to.be.revertedWithCustomError(pool, 'AccessControlUnauthorizedAccount');
    });

    it('a pause stops binding and observations but never closing a window', async () => {
      const { pool, admin, api, networkHelpers, baseMonth } = f;
      await openDemoWindow();
      await pool.connect(admin).pause();

      await expect(
        pool.connect(api).bind({
          policyId: '0x' + 'a8'.repeat(32),
          seriesId: SERIES_ID,
          holder: f.outsider.address,
          nullifierHash: '0x' + 'b8'.repeat(32),
          limit: COVER_LIMIT,
          premium: MONTHLY_PREMIUM,
          startAt: f.startAt,
          hcsReceiptSeq: 800n,
        }),
      ).to.be.revertedWithCustomError(pool, 'EnforcedPause');
      await expect(observe(baseMonth + 4, LEVEL_OPENING, 2n))
        .to.be.revertedWithCustomError(pool, 'EnforcedPause');

      await networkHelpers.time.increaseTo(await pool.windowEndsAtOf(SERIES_ID));
      await pool.closeWindow(SERIES_ID);
      expect(await f.vault.reservedOf(SERIES_ID)).to.equal(0n);
    });

    it('revoking the claims role invalidates a signature it already produced', async () => {
      const { pool, admin, claimsSigner } = f;
      await openDemoWindow();
      const claim = await authorise();
      await pool.connect(admin).revokeRole(await pool.CLAIMS_ROLE(), claimsSigner.address);
      await expect(pool.payClaim(claim.params, claim.signature))
        .to.be.revertedWithCustomError(pool, 'SignerLacksClaimsRole')
        .withArgs(claimsSigner.address);
    });

    it('accepts a second claims signer and keeps working when the first is revoked', async () => {
      const { pool, admin, claimsSigner, outsider, ethers, token, holder1 } = f;
      await pool.connect(admin).grantRole(await pool.CLAIMS_ROLE(), outsider.address);
      await openDemoWindow();
      await pool.connect(admin).revokeRole(await pool.CLAIMS_ROLE(), claimsSigner.address);

      const claim = await makeClaim();
      const signature = await sign(claim.value, undefined, outsider);
      await pool.payClaim(claim.params, signature);
      expect(await token.balanceOf(holder1.address)).to.equal(COVER_LIMIT);
      expect(ethers.isAddress(outsider.address)).to.equal(true);
    });

    it('has no way to receive HBAR', async () => {
      const { pool, deployer, ethers } = f;
      await expect(
        deployer.sendTransaction({ to: await pool.getAddress(), value: ethers.parseEther('1') }),
      ).to.be.revert(ethers);
    });
  });

  it('keeps the shock opening reason available for the indexed maths', async () => {
    const { pool, baseMonth, networkHelpers } = f;
    await networkHelpers.time.increaseTo(startOfMonth(baseMonth + 1) + DAY);
    await observe(baseMonth, SHOCK_OPENING);
    expect((await pool.observationOf(SERIES_ID, yyyymmOf(baseMonth))).openReason)
      .to.equal(REASON_SHOCK);
  });
});
