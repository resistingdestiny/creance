import { expect } from 'chai';
import { network } from 'hardhat';

import { deployVault, PRINCIPAL, SERIES_ID } from './fixtures.js';
import { assertSolvent, tusd } from './helpers.js';

const OTHER_SERIES = '0x' + '11'.repeat(32);
const COUPON_ID = '0x' + '22'.repeat(32);

describe('CollateralVault', () => {
  let fixture: Awaited<ReturnType<typeof deployVault>>;

  beforeEach(async () => {
    const { networkHelpers } = await network.getOrCreate();
    fixture = await networkHelpers.loadFixture(deployVault);
  });

  // I8, run after every test in this file.
  afterEach(async () => {
    await assertSolvent(fixture.token, fixture.vault);
  });

  describe('series and wiring', () => {
    it('records a series and rejects a duplicate id', async () => {
      const { vault, admin, maturityAt, ethers } = fixture;
      expect((await vault.seriesOf(SERIES_ID)).maturityAt).to.equal(BigInt(maturityAt));
      await expect(vault.connect(admin).openSeries(SERIES_ID, ethers.ZeroAddress, maturityAt))
        .to.be.revertedWithCustomError(vault, 'SeriesExists');
    });

    it('rejects a maturity in the past', async () => {
      const { vault, admin, ethers, networkHelpers } = fixture;
      const past = (await networkHelpers.time.latest()) - 1;
      await expect(vault.connect(admin).openSeries(OTHER_SERIES, ethers.ZeroAddress, past))
        .to.be.revertedWithCustomError(vault, 'MaturityInPast');
    });

    it('sets the cover pool once and reverts on the second call', async () => {
      const { vault, admin, outsider } = fixture;
      await expect(vault.connect(admin).setCoverPool(outsider.address))
        .to.be.revertedWithCustomError(vault, 'CoverPoolAlreadySet');
    });

    it('reverts on an unknown series', async () => {
      const { vault } = fixture;
      await expect(vault.principalRemaining(OTHER_SERIES))
        .to.be.revertedWithCustomError(vault, 'SeriesUnknown');
    });
  });

  describe('money in', () => {
    it('pulls tokens and credits the funded principal, the holder and the accounted total', async () => {
      const { vault, api, investor1, token } = fixture;
      await expect(vault.connect(api).subscribe(SERIES_ID, investor1.address, tusd(50_000)))
        .to.emit(vault, 'Subscribed')
        .withArgs(SERIES_ID, investor1.address, tusd(50_000), tusd(50_000));

      expect(await vault.subscriptionOf(SERIES_ID, investor1.address)).to.equal(tusd(50_000));
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(50_000));
      expect(await vault.accountedTotal()).to.equal(tusd(50_000));
      expect(await token.balanceOf(await vault.getAddress())).to.equal(tusd(50_000));
    });

    it('credits the named holder, not the payer', async () => {
      const { vault, api, investor1 } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, tusd(1_000));
      expect(await vault.subscriptionOf(SERIES_ID, investor1.address)).to.equal(tusd(1_000));
      expect(await vault.subscriptionOf(SERIES_ID, api.address)).to.equal(0n);
    });

    it('rejects an unknown series, a zero amount and a caller without the role', async () => {
      const { vault, api, outsider, investor1 } = fixture;
      await expect(vault.connect(api).subscribe(OTHER_SERIES, investor1.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'SeriesUnknown');
      await expect(vault.connect(api).subscribe(SERIES_ID, investor1.address, 0))
        .to.be.revertedWithCustomError(vault, 'ZeroAmount');
      await expect(vault.connect(outsider).subscribe(SERIES_ID, investor1.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'AccessControlUnauthorizedAccount');
    });

    it('refuses to attribute a premium the vault does not hold', async () => {
      const { vault, api } = fixture;
      await expect(vault.connect(api).attributePremium(SERIES_ID, tusd(100)))
        .to.be.revertedWithCustomError(vault, 'UnbackedAttribution');
    });

    it('credits a premium that arrived as a direct transfer, exactly once', async () => {
      const { vault, api, token } = fixture;
      await token.connect(api).transfer(await vault.getAddress(), tusd(100));
      await expect(vault.connect(api).attributePremium(SERIES_ID, tusd(100)))
        .to.emit(vault, 'PremiumAttributed')
        .withArgs(SERIES_ID, tusd(100), tusd(100));
      expect(await vault.premiumBalanceOf(SERIES_ID)).to.equal(tusd(100));
      expect(await vault.accountedTotal()).to.equal(tusd(100));
      await expect(vault.connect(api).attributePremium(SERIES_ID, tusd(100)))
        .to.be.revertedWithCustomError(vault, 'UnbackedAttribution');
    });

    it('sweeps the whole unaccounted balance and then credits nothing', async () => {
      const { vault, api, token } = fixture;
      await token.connect(api).transfer(await vault.getAddress(), tusd(84));
      await vault.connect(api).attributeAllUnaccounted(SERIES_ID);
      expect(await vault.premiumBalanceOf(SERIES_ID)).to.equal(tusd(84));
      await vault.connect(api).attributeAllUnaccounted(SERIES_ID);
      expect(await vault.premiumBalanceOf(SERIES_ID)).to.equal(tusd(84));
    });
  });

  describe('coupons', () => {
    it('pays a coupon out of the premium balance and carries the coupon id', async () => {
      const { vault, api, token, investor1 } = fixture;
      await token.connect(api).transfer(await vault.getAddress(), tusd(1_000));
      await vault.connect(api).attributeAllUnaccounted(SERIES_ID);

      await expect(vault.connect(api).fundCoupon(SERIES_ID, COUPON_ID, investor1.address, tusd(333)))
        .to.emit(vault, 'CouponFunded')
        .withArgs(SERIES_ID, COUPON_ID, investor1.address, tusd(333));

      expect(await vault.premiumBalanceOf(SERIES_ID)).to.equal(tusd(667));
      expect(await token.balanceOf(investor1.address)).to.equal(tusd(333));
    });

    it('never pays a coupon from principal, however ample the principal is', async () => {
      const { vault, api, investor1 } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, PRINCIPAL);
      await expect(vault.connect(api).fundCoupon(SERIES_ID, COUPON_ID, investor1.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'InsufficientPremium');
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(PRINCIPAL);
    });
  });

  describe('reserve and release', () => {
    beforeEach(async () => {
      const { vault, api, investor1 } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, PRINCIPAL);
    });

    it('rejects reserve and release from anyone but the cover pool, including the admin', async () => {
      const { vault, admin, outsider } = fixture;
      await expect(vault.connect(admin).reserve(SERIES_ID, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'NotCoverPool');
      await expect(vault.connect(outsider).release(SERIES_ID, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'NotCoverPool');
      await expect(vault.connect(admin).payClaim(SERIES_ID, outsider.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'NotCoverPool');
    });

    it('earmarks without moving tokens or changing what the vault owes', async () => {
      const { vault, coverPool, token } = fixture;
      const before = await token.balanceOf(await vault.getAddress());
      await expect(vault.connect(coverPool).reserve(SERIES_ID, tusd(15_000)))
        .to.emit(vault, 'Reserved')
        .withArgs(SERIES_ID, tusd(15_000), tusd(15_000));
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(15_000));
      expect(await vault.accountedTotal()).to.equal(PRINCIPAL);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(before);
      expect(await vault.principalFree(SERIES_ID)).to.equal(PRINCIPAL - tusd(15_000));
    });

    it('refuses to reserve past the free principal and to release past the reserve', async () => {
      const { vault, coverPool } = fixture;
      await expect(vault.connect(coverPool).reserve(SERIES_ID, PRINCIPAL + 1n))
        .to.be.revertedWithCustomError(vault, 'InsufficientFreePrincipal');
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(10));
      await expect(vault.connect(coverPool).release(SERIES_ID, tusd(11)))
        .to.be.revertedWithCustomError(vault, 'InsufficientReserve');
    });

    it('I7: reserve then release restores every counter exactly', async () => {
      const { vault, coverPool, token } = fixture;
      const before = {
        free: await vault.principalFree(SERIES_ID),
        reserved: await vault.reservedOf(SERIES_ID),
        accounted: await vault.accountedTotal(),
        remaining: await vault.principalRemaining(SERIES_ID),
        balance: await token.balanceOf(await vault.getAddress()),
      };
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(15_000));
      await vault.connect(coverPool).release(SERIES_ID, tusd(15_000));
      expect(await vault.principalFree(SERIES_ID)).to.equal(before.free);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(before.reserved);
      expect(await vault.accountedTotal()).to.equal(before.accounted);
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(before.remaining);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(before.balance);
    });

    it('moves a paid claim from the reserve to the paid principal and transfers it', async () => {
      const { vault, coverPool, token, outsider } = fixture;
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(15_000));
      await expect(vault.connect(coverPool).payClaim(SERIES_ID, outsider.address, tusd(5_000)))
        .to.emit(vault, 'ClaimPaidOut')
        .withArgs(SERIES_ID, outsider.address, tusd(5_000), tusd(5_000));

      expect(await token.balanceOf(outsider.address)).to.equal(tusd(5_000));
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(10_000));
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(tusd(95_000));
      expect(await vault.accountedTotal()).to.equal(tusd(95_000));
    });

    it('refuses to pay past the reserve even when the raw balance would cover it', async () => {
      const { vault, coverPool, outsider, token } = fixture;
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(1_000));
      expect(await token.balanceOf(await vault.getAddress())).to.equal(PRINCIPAL);
      await expect(vault.connect(coverPool).payClaim(SERIES_ID, outsider.address, tusd(1_001)))
        .to.be.revertedWithCustomError(vault, 'InsufficientReserve');
    });
  });

  describe('maturity', () => {
    beforeEach(async () => {
      const { vault, api, investor1, investor2 } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, tusd(50_000));
      await vault.connect(api).subscribe(SERIES_ID, investor2.address, tusd(50_000));
    });

    it('reverts before maturity and pays after it', async () => {
      const { vault, investor1, networkHelpers, maturityAt } = fixture;
      await expect(vault.redeemAtMaturity(SERIES_ID, investor1.address))
        .to.be.revertedWithCustomError(vault, 'NotMatured');
      await networkHelpers.time.increaseTo(maturityAt);
      await expect(vault.redeemAtMaturity(SERIES_ID, investor1.address))
        .to.emit(vault, 'MaturityRedeemed')
        .withArgs(SERIES_ID, investor1.address, tusd(50_000));
    });

    it('refuses to redeem while a claim window still holds a reserve', async () => {
      const { vault, coverPool, investor1, networkHelpers, maturityAt } = fixture;
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(15_000));
      await networkHelpers.time.increaseTo(maturityAt);
      await expect(vault.redeemAtMaturity(SERIES_ID, investor1.address))
        .to.be.revertedWithCustomError(vault, 'ReserveOutstanding');
    });

    it('returns the whole subscription when no claim was paid', async () => {
      const { vault, investor1, investor2, networkHelpers, maturityAt, token } = fixture;
      await networkHelpers.time.increaseTo(maturityAt);
      await vault.redeemAtMaturity(SERIES_ID, investor1.address);
      await vault.redeemAtMaturity(SERIES_ID, investor2.address);
      expect(await token.balanceOf(investor1.address)).to.equal(tusd(50_000));
      expect(await token.balanceOf(investor2.address)).to.equal(tusd(50_000));
      expect(await vault.accountedTotal()).to.equal(0n);
    });

    it('pays 47,500 each after the demo claim of 5,000 against a 100,000 principal', async () => {
      const { vault, coverPool, investor1, investor2, outsider, networkHelpers, maturityAt, token } =
        fixture;
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(15_000));
      await vault.connect(coverPool).payClaim(SERIES_ID, outsider.address, tusd(5_000));
      await vault.connect(coverPool).release(SERIES_ID, tusd(10_000));

      await networkHelpers.time.increaseTo(maturityAt);
      await vault.redeemAtMaturity(SERIES_ID, investor1.address);
      await vault.redeemAtMaturity(SERIES_ID, investor2.address);

      expect(await token.balanceOf(investor1.address)).to.equal(tusd(47_500));
      expect(await token.balanceOf(investor2.address)).to.equal(tusd(47_500));
      expect(await vault.accountedTotal()).to.equal(0n);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
    });

    it('is callable by anyone and always pays the holder', async () => {
      const { vault, outsider, investor1, networkHelpers, maturityAt, token } = fixture;
      await networkHelpers.time.increaseTo(maturityAt);
      await vault.connect(outsider).redeemAtMaturity(SERIES_ID, investor1.address);
      expect(await token.balanceOf(investor1.address)).to.equal(tusd(50_000));
      expect(await token.balanceOf(outsider.address)).to.equal(0n);
    });

    it('reverts on a second redemption for the same holder', async () => {
      const { vault, investor1, networkHelpers, maturityAt } = fixture;
      await networkHelpers.time.increaseTo(maturityAt);
      await vault.redeemAtMaturity(SERIES_ID, investor1.address);
      await expect(vault.redeemAtMaturity(SERIES_ID, investor1.address))
        .to.be.revertedWithCustomError(vault, 'NothingSubscribed');
    });
  });

  describe('truncation dust', () => {
    it('leaves dust in the vault, never blocks the last holder, and sweeps only when empty', async () => {
      const { vault, admin, api, coverPool, investor1, investor2, outsider, networkHelpers, token } =
        fixture;
      // Three unequal subscriptions and a claim that does not divide evenly.
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, 1n);
      await vault.connect(api).subscribe(SERIES_ID, investor2.address, 1n);
      await vault.connect(api).subscribe(SERIES_ID, outsider.address, 1n);
      await vault.connect(coverPool).reserve(SERIES_ID, 1n);
      await vault.connect(coverPool).payClaim(SERIES_ID, admin.address, 1n);

      await expect(vault.connect(admin).sweepDust(SERIES_ID, admin.address))
        .to.be.revertedWithCustomError(vault, 'SubscriptionsOutstanding');

      await networkHelpers.time.increaseTo(fixture.maturityAt);
      for (const holder of [investor1, investor2, outsider]) {
        // 1 * (3 - 1) / 3 truncates to zero for each holder.
        await vault.redeemAtMaturity(SERIES_ID, holder.address);
      }
      expect(await token.balanceOf(await vault.getAddress())).to.equal(2n);

      await expect(vault.connect(admin).sweepDust(SERIES_ID, admin.address))
        .to.emit(vault, 'DustSwept')
        .withArgs(SERIES_ID, admin.address, 2n);
      expect(await vault.accountedTotal()).to.equal(0n);
    });
  });

  describe('pausing', () => {
    it('stops money in and coupons but never the reserve, release or a redemption', async () => {
      const { vault, admin, api, coverPool, investor1, networkHelpers, maturityAt } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, PRINCIPAL);
      await vault.connect(admin).pause();

      await expect(vault.connect(api).subscribe(SERIES_ID, investor1.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'EnforcedPause');
      await expect(vault.connect(api).attributePremium(SERIES_ID, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'EnforcedPause');
      await expect(vault.connect(api).fundCoupon(SERIES_ID, COUPON_ID, investor1.address, tusd(1)))
        .to.be.revertedWithCustomError(vault, 'EnforcedPause');

      await vault.connect(coverPool).reserve(SERIES_ID, tusd(10));
      await vault.connect(coverPool).release(SERIES_ID, tusd(10));
      await networkHelpers.time.increaseTo(maturityAt);
      await vault.redeemAtMaturity(SERIES_ID, investor1.address);
    });
  });

  describe('a transfer that fails', () => {
    it('reverts the whole call and leaves every counter untouched', async () => {
      const { vault, api, coverPool, investor1, outsider, token } = fixture;
      await vault.connect(api).subscribe(SERIES_ID, investor1.address, PRINCIPAL);
      await vault.connect(coverPool).reserve(SERIES_ID, tusd(5_000));

      await token.setFailTransfers(true);
      await expect(
        vault.connect(coverPool).payClaim(SERIES_ID, outsider.address, tusd(5_000)),
      ).to.be.revert(fixture.ethers);
      expect(await vault.reservedOf(SERIES_ID)).to.equal(tusd(5_000));
      expect(await vault.principalRemaining(SERIES_ID)).to.equal(PRINCIPAL);

      await token.setFailTransfers(false);
      await vault.connect(coverPool).payClaim(SERIES_ID, outsider.address, tusd(5_000));
      expect(await token.balanceOf(outsider.address)).to.equal(tusd(5_000));
    });
  });

  describe('the settlement token association', () => {
    it('is admin gated and reverts against a token with no HIP-719 facade', async () => {
      const { vault, admin, outsider, ethers } = fixture;
      await expect(vault.connect(outsider).associateSettlementToken())
        .to.be.revertedWithCustomError(vault, 'AccessControlUnauthorizedAccount');
      // The local network has no token service, so the facade call finds no
      // function to run. On testnet this is the deploy step that opts the vault
      // in to holding TUSD.
      await expect(vault.connect(admin).associateSettlementToken()).to.be.revert(ethers);
    });
  });

  it('has no way to receive HBAR', async () => {
    const { vault, deployer, ethers } = fixture;
    await expect(
      deployer.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther('1') }),
    ).to.be.revert(ethers);
  });
});
