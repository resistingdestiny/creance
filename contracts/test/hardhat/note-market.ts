import { expect } from 'chai';
import { network } from 'hardhat';

import { at, tusd } from './helpers.js';

/// The secondary market.
///
/// The one behaviour worth proving here rather than on testnet is that a fill
/// is all or nothing. A testnet run can show a refused fill and a settled one,
/// but it cannot show that the settlement asset did not move on the refused
/// one, because there is nothing to look at when nothing happened. A local
/// chain can assert the balance either side of the revert.

const NOTE_UNIT = 1_000_000n;

async function deployMarket() {
  const { ethers } = await network.getOrCreate();
  const signers = await ethers.getSigners();
  const issuer = at(signers, 0, 'signer');
  const seller = at(signers, 1, 'signer');
  const buyer = at(signers, 2, 'signer');
  const stranger = at(signers, 3, 'signer');

  const token = await ethers.deployContract('MockSettlementToken', ['Creance Test USD', 'TUSD', 6]);
  const note = await ethers.deployContract('MockCompliantNote', [
    'Creance Displacement Bond Note TEST',
    'CDBNT',
    6,
  ]);
  const market = await ethers.deployContract('NoteMarket', [await token.getAddress()]);

  await note.grantKyc(seller.address);
  await note.issue(seller.address, 10n * NOTE_UNIT);
  await token.mint(buyer.address, tusd(100_000));
  await token.mint(stranger.address, tusd(100_000));

  return { ethers, token, note, market, issuer, seller, buyer, stranger };
}

describe('NoteMarket', () => {
  it('refuses a fill by a buyer the note holds no KYC for, and moves nothing', async () => {
    const { token, note, market, seller, buyer } = await deployMarket();
    const marketAddress = await market.getAddress();

    await note.connect(seller).approve(marketAddress, 5n * NOTE_UNIT);
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    await token.connect(buyer).approve(marketAddress, tusd(5_000));

    const buyerMoneyBefore = await token.balanceOf(buyer.address);
    const sellerMoneyBefore = await token.balanceOf(seller.address);

    await expect(market.connect(buyer).fill(1))
      .to.be.revertedWithCustomError(note, 'InvalidKycStatus')
      .withArgs(buyer.address);

    expect(await note.balanceOf(buyer.address)).to.equal(0n);
    expect(await note.balanceOf(seller.address)).to.equal(10n * NOTE_UNIT);
    expect(await token.balanceOf(buyer.address)).to.equal(buyerMoneyBefore);
    expect(await token.balanceOf(seller.address)).to.equal(sellerMoneyBefore);

    const offer = await market.offerAt(1);
    expect(offer.status).to.equal(1n);
    expect(offer.buyer).to.equal('0x0000000000000000000000000000000000000000');
  });

  it('settles both legs once the buyer holds KYC', async () => {
    const { token, note, market, seller, buyer } = await deployMarket();
    const marketAddress = await market.getAddress();

    await note.connect(seller).approve(marketAddress, 5n * NOTE_UNIT);
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    await token.connect(buyer).approve(marketAddress, tusd(5_000));
    await note.grantKyc(buyer.address);

    const sellerMoneyBefore = await token.balanceOf(seller.address);

    await expect(market.connect(buyer).fill(1))
      .to.emit(market, 'OfferFilled')
      .withArgs(
        1n,
        await note.getAddress(),
        buyer.address,
        seller.address,
        5n * NOTE_UNIT,
        tusd(5_000),
      );

    expect(await note.balanceOf(buyer.address)).to.equal(5n * NOTE_UNIT);
    expect(await note.balanceOf(seller.address)).to.equal(5n * NOTE_UNIT);
    expect(await token.balanceOf(seller.address)).to.equal(sellerMoneyBefore + tusd(5_000));

    const offer = await market.offerAt(1);
    expect(offer.status).to.equal(2n);
    expect(offer.buyer).to.equal(buyer.address);
  });

  it('holds no note units and no settlement asset of its own', async () => {
    const { token, note, market, seller, buyer } = await deployMarket();
    const marketAddress = await market.getAddress();

    await note.connect(seller).approve(marketAddress, 5n * NOTE_UNIT);
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    expect(await note.balanceOf(marketAddress)).to.equal(0n);

    await token.connect(buyer).approve(marketAddress, tusd(5_000));
    await note.grantKyc(buyer.address);
    await market.connect(buyer).fill(1);

    expect(await note.balanceOf(marketAddress)).to.equal(0n);
    expect(await token.balanceOf(marketAddress)).to.equal(0n);
  });

  it('refuses a second fill of the same offer', async () => {
    const { token, note, market, seller, buyer, stranger } = await deployMarket();
    const marketAddress = await market.getAddress();

    await note.connect(seller).approve(marketAddress, 10n * NOTE_UNIT);
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    await note.grantKyc(buyer.address);
    await note.grantKyc(stranger.address);
    await token.connect(buyer).approve(marketAddress, tusd(5_000));
    await token.connect(stranger).approve(marketAddress, tusd(5_000));

    await market.connect(buyer).fill(1);
    await expect(market.connect(stranger).fill(1))
      .to.be.revertedWithCustomError(market, 'OfferNotOpen')
      .withArgs(1n);
  });

  it('lets the seller cancel and nobody else', async () => {
    const { note, market, seller, buyer } = await deployMarket();
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));

    await expect(market.connect(buyer).cancel(1))
      .to.be.revertedWithCustomError(market, 'NotTheSeller')
      .withArgs(1n, buyer.address);

    await market.connect(seller).cancel(1);
    expect((await market.offerAt(1)).status).to.equal(3n);
    await expect(market.connect(buyer).fill(1))
      .to.be.revertedWithCustomError(market, 'OfferNotOpen')
      .withArgs(1n);
  });

  it('refuses a fill by the seller', async () => {
    const { note, market, seller } = await deployMarket();
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    await expect(market.connect(seller).fill(1))
      .to.be.revertedWithCustomError(market, 'SellerCannotFill')
      .withArgs(1n);
  });

  it('reports what is in the way of a fill', async () => {
    const { note, market, seller } = await deployMarket();
    const marketAddress = await market.getAddress();
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));

    let [open, holds, approved] = await market.fillable(1);
    expect([open, holds, approved]).to.deep.equal([true, true, false]);

    await note.connect(seller).approve(marketAddress, 5n * NOTE_UNIT);
    [open, holds, approved] = await market.fillable(1);
    expect([open, holds, approved]).to.deep.equal([true, true, true]);

    await market.connect(seller).cancel(1);
    [open, holds, approved] = await market.fillable(1);
    expect([open, holds, approved]).to.deep.equal([false, false, false]);
  });

  it('refuses an empty offer and an unknown id', async () => {
    const { ethers, market, note, seller } = await deployMarket();
    await expect(
      market.connect(seller).offer(await note.getAddress(), 0n, tusd(1)),
    ).to.be.revertedWithCustomError(market, 'ZeroAmount');
    await expect(
      market.connect(seller).offer(await note.getAddress(), NOTE_UNIT, 0n),
    ).to.be.revertedWithCustomError(market, 'ZeroAmount');
    await expect(
      market.connect(seller).offer(ethers.ZeroAddress, NOTE_UNIT, tusd(1)),
    ).to.be.revertedWithCustomError(market, 'ZeroAddress');
    await expect(market.offerAt(1)).to.be.revertedWithCustomError(market, 'UnknownOffer');
  });

  it('reverts the whole fill when the buyer cannot pay', async () => {
    const { token, note, market, seller, buyer } = await deployMarket();
    const marketAddress = await market.getAddress();

    await note.connect(seller).approve(marketAddress, 5n * NOTE_UNIT);
    await market.connect(seller).offer(await note.getAddress(), 5n * NOTE_UNIT, tusd(5_000));
    await note.grantKyc(buyer.address);
    // No approval on the settlement asset, so the second leg fails after the
    // first one has already succeeded inside the same transaction.
    await expect(market.connect(buyer).fill(1)).to.be.revertedWithCustomError(
      token,
      'ERC20InsufficientAllowance',
    );

    expect(await note.balanceOf(buyer.address)).to.equal(0n);
    expect(await note.balanceOf(seller.address)).to.equal(10n * NOTE_UNIT);
    expect(await token.balanceOf(buyer.address)).to.equal(tusd(100_000));
    expect((await market.offerAt(1)).status).to.equal(1n);
  });
});
