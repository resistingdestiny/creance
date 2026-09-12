import { Contract, Wallet, type InterfaceAbi, type JsonRpcProvider } from 'ethers';

import { NoteMarket__factory } from '../types/ethers-contracts/index.js';
import { ASSET_ABI } from '../ats/abi.js';
import {
  contractIdOf,
  expectRevert,
  hashscan,
  noteAt,
  openSession,
  operatorKey,
  send,
  type Session,
} from '../ats/chain.js';
import { readResources } from '../ats/config.js';
import { createKycCredential, grantKycArguments, verifyCredential } from '../ats/credential.js';
import {
  findSeries,
  readRecord,
  recordPath,
  writeRecord,
  type DeploymentRecord,
  type SeriesRecord,
} from '../scripts/deploy/record.js';
import { MARKET_GAS, MARKET_SERIES, noteUnits, TRADES, tusd, type TradePlan } from './config.js';
import type { MarketBalances, MarketTradeRecord, SecondaryMarketRecord } from './record.js';

/// The secondary market, on testnet.
///
///     pnpm market:demo status
///     pnpm market:demo deploy
///     pnpm market:demo trade
///     pnpm market:demo            # all of it, in order
///
/// It is record driven the way `pnpm ats:issue` is: every step reads
/// contracts/deployments/testnet.json, skips what is already there and writes
/// back what it did, so a relay timeout half way through is recovered by
/// running the same command again. Nothing here can be run twice into a second
/// trade.

const STEPS = ['status', 'deploy', 'fund', 'trade', 'verify', 'all'] as const;
type Step = (typeof STEPS)[number];
const RUN: Exclude<Step, 'all'>[] = ['status', 'deploy', 'fund', 'trade', 'verify'];

/// The three functions of the settlement asset this run needs, through the
/// ERC-20 facade every HTS fungible token answers at its own address.
const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
] as const;

/**
 * The market ABI with the note's error fragments appended.
 *
 * A refused fill reverts inside the ATS bond, so the four bytes that come back
 * name an error the market contract has never heard of. Ethers decodes a
 * revert against the ABI of the contract it called and nothing else, so
 * without this the evidence would read as raw data rather than as
 * `InvalidKycStatus`. Only the error fragments are taken: the function
 * fragments of a union interface over every ATS facet would collide with the
 * market's own.
 */
function marketAbi(): InterfaceAbi {
  const own = NoteMarket__factory.abi as unknown as { type?: string; name?: string }[];
  const mine = new Set(own.filter((item) => item.type === 'error').map((item) => item.name));
  const borrowed = (ASSET_ABI as { type?: string; name?: string }[]).filter(
    (item) => item.type === 'error' && item.name !== undefined && !mine.has(item.name),
  );
  return [...own, ...borrowed] as unknown as InterfaceAbi;
}

function marketAt(address: string, runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, marketAbi(), runner);
}

function tokenAt(address: string, runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, ERC20_ABI as unknown as InterfaceAbi, runner);
}

interface Actor {
  role: string;
  accountId: string;
  address: string;
  wallet: Wallet;
}

/// Every account this run signs as, by the role name the trade plan uses. The
/// operator is in the list because the first lot is sold out of it.
function actors(session: Session): Map<string, Actor> {
  const resources = readResources();
  const all = new Map<string, Actor>();
  all.set('operator', {
    role: 'operator',
    accountId: resources.operator.accountId,
    address: session.operator.address,
    wallet: session.operator,
  });
  for (const investor of session.investors) {
    all.set(investor.role, {
      role: investor.role,
      accountId: investor.accountId,
      address: investor.address,
      wallet: investor.wallet,
    });
  }
  return all;
}

function actorFor(session: Session, role: string): Actor {
  const actor = actors(session).get(role);
  if (actor === undefined) throw new Error(`no signing account for the role "${role}"`);
  return actor;
}

function seriesOf(record: DeploymentRecord): SeriesRecord {
  const series = findSeries(record, MARKET_SERIES);
  if (series === undefined) {
    throw new Error(`no series "${MARKET_SERIES}" in the deployment record`);
  }
  if (series.ats?.note === undefined) {
    throw new Error(`series "${MARKET_SERIES}" has no note: run \`pnpm series:capacity notes\``);
  }
  return series;
}

function marketOf(record: DeploymentRecord): SecondaryMarketRecord {
  record.secondaryMarket ??= {};
  return record.secondaryMarket;
}

function settlementTokenAddress(record: DeploymentRecord): string {
  const address = record.settlementToken?.evmAddress ?? readResources().settlementToken.evmAddress;
  if (address === undefined || address === '') throw new Error('no settlement token address');
  return address;
}

/// The recorded trade for a plan, created on first sight so every later step
/// has somewhere to write.
function tradeFor(
  record: DeploymentRecord,
  session: Session,
  plan: TradePlan,
): MarketTradeRecord {
  const market = marketOf(record);
  market.trades ??= [];
  const existing = market.trades.find((trade) => trade.key === plan.key);
  if (existing !== undefined) return existing;
  const series = seriesOf(record);
  const note = series.ats!.note!;
  const seller = actorFor(session, plan.seller);
  const buyer = actorFor(session, plan.buyer);
  const units = noteUnits(plan.units);
  const price = tusd(plan.price);
  const created: MarketTradeRecord = {
    key: plan.key,
    purpose: plan.purpose,
    series: series.label,
    note: note.address,
    noteSymbol: note.symbol,
    seller: { role: seller.role, accountId: seller.accountId, address: seller.address },
    buyer: { role: buyer.role, accountId: buyer.accountId, address: buyer.address },
    units: units.toString(),
    unitsWhole: plan.units.toString(),
    price: price.toString(),
    pricePerUnit: (price / plan.units).toString(),
  };
  market.trades.push(created);
  return created;
}

/**
 * Whether the note holds a granted KYC record for an account.
 *
 * With attempts above one it polls. The JSON-RPC relay answers a read from the
 * mirror node, which trails consensus by a few seconds, so a `getKycStatusFor`
 * sent immediately after a grant whose receipt has already come back can still
 * read NOT_GRANTED. That is a stale read and not a failed grant, and treating
 * it as a failure is what stopped the first run of this script.
 */
async function kycGranted(bond: Contract, address: string, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (Number(await bond.getKycStatusFor!(address)) === 1) return true;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return false;
}

async function balancesOf(
  record: DeploymentRecord,
  session: Session,
  trade: MarketTradeRecord,
): Promise<MarketBalances> {
  const note = noteAt(trade.note, session.provider);
  const token = tokenAt(settlementTokenAddress(record), session.provider);
  const [sellerUnits, buyerUnits, sellerMoney, buyerMoney] = await Promise.all([
    note.balanceOf!(trade.seller.address) as Promise<bigint>,
    note.balanceOf!(trade.buyer.address) as Promise<bigint>,
    token.balanceOf!(trade.seller.address) as Promise<bigint>,
    token.balanceOf!(trade.buyer.address) as Promise<bigint>,
  ]);
  return {
    sellerUnits: sellerUnits.toString(),
    buyerUnits: buyerUnits.toString(),
    sellerMoney: sellerMoney.toString(),
    buyerMoney: buyerMoney.toString(),
  };
}

// ------------------------------------------------------------------- steps

async function status(session: Session, record: DeploymentRecord): Promise<void> {
  const series = seriesOf(record);
  const note = series.ats!.note!;
  const market = marketOf(record);
  const balance = await session.provider.getBalance(session.operator.address);
  console.log(`series        ${series.label}`);
  console.log(`note          ${note.address} ${note.contractId ?? ''} ${note.symbol}`);
  console.log(`settlement    ${settlementTokenAddress(record)}`);
  console.log(`market        ${market.market?.address ?? 'not deployed'}`);
  console.log(`operator      ${session.operator.address} ${balance / 10n ** 10n} tinybar`);
  const bond = noteAt(note.address, session.provider);
  for (const [role, actor] of actors(session)) {
    const held = (await bond.balanceOf!(actor.address)) as bigint;
    const kyc = Number(await bond.getKycStatusFor!(actor.address));
    const gas = await session.provider.getBalance(actor.address);
    console.log(
      `${role.padEnd(14)}${actor.address} units ${held} kyc ${kyc} gas ${gas / 10n ** 10n} tinybar`,
    );
  }
  for (const trade of market.trades ?? []) {
    console.log(
      `trade ${trade.key.padEnd(10)}offer ${trade.offerId ?? '-'} refused ${trade.refusedRevert ?? '-'} filled ${trade.fillTx ?? '-'}`,
    );
  }
}

async function deploy(session: Session, record: DeploymentRecord): Promise<void> {
  const market = marketOf(record);
  if (market.market !== undefined) {
    console.log(`  market already at ${market.market.address}`);
    if (market.market.contractId === undefined) {
      market.market.contractId = await contractIdOf(market.market.address);
    }
    return;
  }
  const token = settlementTokenAddress(record);
  const deployed = await new NoteMarket__factory(session.operator).deploy(token, {
    gasLimit: MARKET_GAS.deploy,
  });
  const receipt = await deployed.deploymentTransaction()!.wait();
  if (receipt === null) throw new Error('no receipt for the NoteMarket deployment');
  const address = await deployed.getAddress();
  const contractId = await contractIdOf(address);
  console.log(`  NoteMarket ${address} ${contractId ?? '(mirror node not caught up)'}`);
  market.market = {
    address,
    ...(contractId === undefined ? {} : { contractId }),
    settlementToken: token,
    deployTx: receipt.hash,
    gasUsed: Number(receipt.gasUsed),
  };
}

/// Each side of a trade signs its own transactions, so each one needs gas of
/// its own. Day 0 funded the investor accounts for token transfers, not for
/// contract calls.
///
/// The target is high for a reason worth writing down. The relay refuses a
/// transaction whose sender cannot cover `gasLimit` times the quoted gas price
/// even though almost none of it will be spent, and the quote on Hashio has
/// been 2,400 tinybar a gas, so a call sent with a four million limit demands
/// 96 HBAR of headroom to use half a million. An account at twelve HBAR is
/// refused with "insufficient funds for intrinsic transaction cost" before the
/// call is priced at all.
async function fund(session: Session, record: DeploymentRecord): Promise<void> {
  const wanted = new Set(TRADES.flatMap((plan) => [plan.seller, plan.buyer]));
  const target = 120n * 10n ** 18n;
  for (const role of wanted) {
    if (role === 'operator') continue;
    const actor = actorFor(session, role);
    const held = await session.provider.getBalance(actor.address);
    if (held >= target) {
      console.log(`  ${role} holds ${held / 10n ** 10n} tinybar, enough`);
      continue;
    }
    const tx = await session.operator.sendTransaction({
      to: actor.address,
      value: target - held,
      gasLimit: 500_000,
    });
    await tx.wait();
    console.log(`  funded ${role} ${tx.hash}`);
  }
  void record;
}

/**
 * One trade, from the offer to the settled fill.
 *
 * The order is the demonstration. The seller's allowance and the offer come
 * first, then the buyer's allowance, so that when the buyer's first attempt is
 * refused there is nothing missing except the KYC record: the units are there,
 * the money is there, both allowances are in place, and the note still says no.
 * Then the grant, then the same call again.
 */
async function runTrade(
  session: Session,
  record: DeploymentRecord,
  plan: TradePlan,
): Promise<void> {
  const market = marketOf(record).market;
  if (market === undefined) throw new Error('the market is not deployed yet');
  const trade = tradeFor(record, session, plan);
  if (trade.fillTx !== undefined) {
    console.log(`  ${plan.key} already settled ${trade.fillTx}`);
    return;
  }
  const seller = actorFor(session, plan.seller);
  const buyer = actorFor(session, plan.buyer);
  const units = BigInt(trade.units);
  const price = BigInt(trade.price);

  const note = noteAt(trade.note, seller.wallet);
  const token = tokenAt(settlementTokenAddress(record), buyer.wallet);

  trade.before ??= await balancesOf(record, session, trade);
  if (BigInt(trade.before.sellerUnits) < units) {
    throw new Error(
      `${seller.role} holds ${trade.before.sellerUnits} of ${trade.note} and the offer is ${units}`,
    );
  }

  if (trade.approveNoteTx === undefined) {
    const sent = await send(
      `approve ${units} of the note to the market, signed by ${seller.role}`,
      note.approve!(market.address, units, { gasLimit: MARKET_GAS.approveNote }),
    );
    trade.approveNoteTx = sent.hash;
    writeRecord(record);
  }

  if (trade.offerId === undefined) {
    const venue = marketAt(market.address, seller.wallet);
    const before = (await venue.offerCount!()) as bigint;
    const sent = await send(
      `offer ${plan.units} units for ${plan.price}, signed by ${seller.role}`,
      venue.offer!(trade.note, units, price, { gasLimit: MARKET_GAS.offer }),
    );
    const after = (await venue.offerCount!()) as bigint;
    if (after !== before + 1n) throw new Error('the offer did not land on the market');
    trade.offerId = after.toString();
    trade.offerTx = sent.hash;
    writeRecord(record);
  }

  if (trade.approveTokenTx === undefined) {
    const sent = await send(
      `approve ${price} of the settlement asset to the market, signed by ${buyer.role}`,
      token.approve!(market.address, price, { gasLimit: MARKET_GAS.approveToken }),
    );
    trade.approveTokenTx = sent.hash;
    writeRecord(record);
  }

  const bond = noteAt(trade.note, session.operator);
  const granted = await kycGranted(bond, buyer.address, 1);

  if (trade.refusedTx === undefined && trade.refusedRevert === undefined) {
    if (granted) {
      // A buyer that already holds KYC cannot be refused for the want of it,
      // and a refusal arranged by revoking a grant would be a different
      // demonstration. Say so rather than record a failure that proves
      // nothing.
      trade.refusedRevert = `not attempted: ${buyer.role} already held KYC on this note`;
    } else {
      const venue = marketAt(market.address, buyer.wallet);
      const failure = await expectRevert(
        `fill offer ${trade.offerId} by ${buyer.role}, which holds no KYC`,
        venue,
        'fill',
        [BigInt(trade.offerId!)],
        { gasLimit: MARKET_GAS.fill },
      );
      trade.refusedRevert = failure.revert;
      if (failure.hash !== undefined) trade.refusedTx = failure.hash;
    }
    writeRecord(record);
  }

  if (!granted) {
    // The signature is checked here, not on chain: the note stores the
    // credential id as an opaque string. Signing with the operator key is what
    // makes the issuer on the credential the issuer registered on the note.
    const credential = await createKycCredential(operatorKey(), buyer.address);
    if (!(await verifyCredential(credential))) {
      throw new Error('the credential this build just signed does not verify');
    }
    const args = grantKycArguments(credential, buyer.address, Date.now());
    const sent = await send(
      `grantKyc ${buyer.role} on ${trade.noteSymbol}`,
      bond.grantKyc!(args.account, args.vcId, args.validFrom, args.validTo, args.issuer, {
        gasLimit: MARKET_GAS.grantKyc,
      }),
    );
    if (!(await kycGranted(bond, buyer.address, 10))) {
      throw new Error(`${buyer.role} is still not granted after the grant`);
    }
    trade.kycTx = sent.hash;
    writeRecord(record);
  }
  // The credential id is read back off the note rather than kept from the
  // grant, so the record names the one the note actually stores whether this
  // run wrote it or an earlier one did.
  if (trade.kycVcId === undefined) {
    const stored = (await bond.getKycFor!(buyer.address)) as { vcId?: string };
    if (stored.vcId !== undefined && stored.vcId !== '') trade.kycVcId = stored.vcId;
    writeRecord(record);
  }

  const venue = marketAt(market.address, buyer.wallet);
  // Simulated first. A fill is two token transfers and a compliance pass in one
  // transaction and it either all happens or none of it does, so there is no
  // reason to pay for a send that eth_call already says will revert.
  await venue.fill!.staticCall(BigInt(trade.offerId!), { gasLimit: MARKET_GAS.fill });
  const sent = await send(
    `fill offer ${trade.offerId} by ${buyer.role}`,
    venue.fill!(BigInt(trade.offerId!), { gasLimit: MARKET_GAS.fill }),
  );
  trade.fillTx = sent.hash;
  trade.fillGasUsed = sent.gasUsed;
  trade.after = await balancesOf(record, session, trade);
  trade.at = new Date().toISOString();
  writeRecord(record);

  const moved = BigInt(trade.after.buyerUnits) - BigInt(trade.before.buyerUnits);
  const paid = BigInt(trade.after.sellerMoney) - BigInt(trade.before.sellerMoney);
  if (moved !== units) throw new Error(`the buyer gained ${moved} units, not ${units}`);
  if (paid !== price) throw new Error(`the seller gained ${paid}, not ${price}`);
  console.log(`  ${moved} units to ${buyer.role}, ${paid} to ${seller.role}`);
}

async function trade(session: Session, record: DeploymentRecord): Promise<void> {
  for (const plan of TRADES) {
    console.log(`  ${plan.key}: ${plan.purpose}`);
    await runTrade(session, record, plan);
  }
}

/// Read the whole thing back off the chain, so the record is checked against
/// the ledger rather than against itself.
async function verify(session: Session, record: DeploymentRecord): Promise<void> {
  const market = marketOf(record).market;
  if (market === undefined) throw new Error('the market is not deployed yet');
  const venue = marketAt(market.address, session.provider);
  const count = (await venue.offerCount!()) as bigint;
  console.log(`  ${count} offers on ${market.address}`);
  for (const entry of marketOf(record).trades ?? []) {
    if (entry.offerId === undefined) continue;
    const offer = (await venue.offerAt!(BigInt(entry.offerId))) as {
      note: string;
      seller: string;
      buyer: string;
      units: bigint;
      price: bigint;
      status: bigint;
    };
    const filled = Number(offer.status) === 2;
    if (!filled) throw new Error(`offer ${entry.offerId} is not filled on chain`);
    if (offer.buyer.toLowerCase() !== entry.buyer.address.toLowerCase()) {
      throw new Error(`offer ${entry.offerId} names ${offer.buyer} as the buyer`);
    }
    if (offer.units !== BigInt(entry.units) || offer.price !== BigInt(entry.price)) {
      throw new Error(`offer ${entry.offerId} does not carry the recorded lot and price`);
    }
    console.log(
      `  offer ${entry.offerId} ${entry.unitsWhole} units of ${entry.noteSymbol} ` +
        `${entry.seller.role} to ${entry.buyer.role} for ${entry.price}`,
    );
    if (entry.refusedTx !== undefined) {
      console.log(`    refused  ${hashscan('transaction', entry.refusedTx)} ${entry.refusedRevert}`);
    }
    if (entry.kycTx !== undefined) console.log(`    kyc      ${hashscan('transaction', entry.kycTx)}`);
    if (entry.fillTx !== undefined) console.log(`    filled   ${hashscan('transaction', entry.fillTx)}`);
  }
  if (market.contractId !== undefined) {
    console.log(`  ${hashscan('contract', market.contractId)}`);
  }
}

const HANDLERS: Record<
  Exclude<Step, 'all'>,
  (session: Session, record: DeploymentRecord) => Promise<void>
> = { status, deploy, fund, trade, verify };

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const session = openSession();
  const record = readRecord();
  const steps = requested === 'all' ? RUN : [requested];
  for (const name of steps) {
    console.log(name);
    try {
      await HANDLERS[name as Exclude<Step, 'all'>]!(session, record);
    } finally {
      writeRecord(record);
    }
  }
  console.log(`record: ${recordPath()}`);
}

await main();
