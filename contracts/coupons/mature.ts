import { contractIdOf, factoryAt, send } from '../ats/chain.js';
import { bondData, maxSupplyFor, principalFor, regulationData, type BondPlan } from '../ats/bond.js';
import { GAS as ATS_GAS, NOTE, PARTITION_1, ROLES } from '../ats/config.js';
import { createKycCredential, grantKycArguments, verifyCredential } from '../ats/credential.js';
import { testIsinFor } from '../ats/isin.js';
import { GAS, MATURITY_LEAD_SECONDS } from './config.js';
import {
  demoNoteAddress,
  noteContract,
  openCouponContext,
  type CouponContext,
} from './context.js';
import { toBytes32 } from './plan.js';
import type { MaturityDemoRecord, RedemptionRecord } from './record.js';
import { fundAccounts, subscribeInvestor, tokenBalanceOf } from './vault.js';

/// `pnpm coupons:mature` runs a maturity redemption on Hedera testnet.
///
/// It cannot run on the demo series. Both the vault series and its note mature
/// on 4 September 2027, the vault has no setter for a maturity date and the
/// note's `updateMaturityDate` only ever moves the date forward, so nothing can
/// bring either of them into the event. This script therefore opens a second,
/// short dated series with its own short dated note, subscribes both
/// noteholders, waits for it to mature and redeems it on both sides: ATS burns
/// the note holding and the vault returns the remaining principal.
///
/// It is a maturity demonstration and it is labelled as one everywhere. It is
/// not the demo series and no screen reads it.

const STEPS = [
  'status',
  'fund',
  'open',
  'bond',
  'subscribe',
  'wait',
  'redeem',
  'payout',
  'all',
] as const;
type Step = (typeof STEPS)[number];

const RUN: Step[] = ['fund', 'open', 'bond', 'subscribe', 'wait', 'redeem', 'payout'];

/// One unit of principal per holder, a fiftieth of the demo series, because
/// this series exists to show the lifecycle end and not to hold money.
const UNITS_PER_INVESTOR = 1n;
const SUBSCRIPTION_PER_INVESTOR = 1_000n * 1_000_000n;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function demoOf(context: CouponContext): MaturityDemoRecord {
  const demo = context.record.maturityDemo;
  if (demo === undefined) {
    throw new Error('no maturity series yet: run `pnpm coupons:mature open` first');
  }
  return demo;
}

// ------------------------------------------------------------------ open

/**
 * Open the short dated series in the vault. `openSeries` is under
 * DEFAULT_ADMIN_ROLE, which the operator holds, and it refuses a maturity in
 * the past, so the lead time is what the rest of this script has to fit inside.
 */
async function open(context: CouponContext): Promise<void> {
  if (context.record.maturityDemo !== undefined) {
    console.log(`  ${context.record.maturityDemo.label} is already open`);
    return;
  }
  const maturityAt = now() + MATURITY_LEAD_SECONDS;
  const label = `ODI-MAT-${maturityAt}`;
  const seriesId = toBytes32(label);
  const sent = await send(
    `openSeries ${label}`,
    (context.vault.connect(context.operator.wallet) as typeof context.vault).getFunction(
      'openSeries',
    )(seriesId, '0x0000000000000000000000000000000000000000', maturityAt, {
      gasLimit: GAS.openSeries,
    }),
  );
  console.log(`  ${label} matures at ${maturityAt} (${new Date(maturityAt * 1000).toISOString()})`);
  context.record.maturityDemo = {
    label,
    seriesId,
    maturityAt,
    openSeriesTx: sent.hash,
    subscriptions: [],
    redemptions: [],
  };
  context.save();
}

// ------------------------------------------------------------------ bond

/**
 * Deploy the matching short dated ATS bond and put both noteholders on it.
 *
 * The roles are granted one at a time, the credential issuer is registered
 * before the first KYC grant, and KYC is granted before the mint, which is the
 * order 8.0.0 requires. `fullRedeemAtMaturity` needs the holder to still hold
 * KYC when it is called, so nothing revokes it afterwards.
 */
async function bond(context: CouponContext): Promise<void> {
  const demo = demoOf(context);
  if (demo.note !== undefined) {
    console.log(`  note ${demo.note.address} already deployed`);
    return;
  }
  const ats = context.record.series?.ats;
  if (ats?.configVersion === undefined) {
    throw new Error('no ATS configuration version recorded: run `pnpm ats:issue` first');
  }
  const plan: BondPlan = {
    name: `Creance Maturity Demonstration ${demo.label}`,
    symbol: 'CDBNMAT',
    isin: testIsinFor(demo.label),
    decimals: NOTE.decimals,
    units: UNITS_PER_INVESTOR * BigInt(context.investors.length),
    nominalValue: NOTE.nominalValue,
    startingDate: now(),
    maturityDate: demo.maturityAt,
    owner: context.operator.address,
    configVersion: ats.configVersion,
    internalKycActivated: true,
    scaleMaxSupply: true,
  };
  const factory = factoryAt(context.operator.wallet);
  console.log(`  deploying ${plan.name}, max supply ${maxSupplyFor(plan)}`);
  const deployed = await send(
    'deployBond',
    factory.getFunction('deployBond')(
      bondData(plan, [{ role: `0x${'00'.repeat(32)}`, members: [plan.owner] }]),
      regulationData(`Creance maturity demonstration, ${demo.label}`),
      { gasLimit: ATS_GAS.deployBond },
    ),
  );
  const event = deployed.receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === 'BondDeployed');
  const address = event?.args?.[1] as string | undefined;
  if (address === undefined) throw new Error('no BondDeployed event in the deployment receipt');
  console.log(`  bond ${address}`);

  const note = noteContract(address, context.operator.wallet);
  for (const role of [
    'ROLE_SSI_MANAGER',
    'ROLE_KYC',
    'ROLE_ISSUER',
    'ROLE_MATURITY_REDEEMER',
  ] as const) {
    await send(
      `grantRole ${role}`,
      note.getFunction('grantRole')(ROLES[role], context.operator.address, {
        gasLimit: ATS_GAS.grantRole,
      }),
    );
  }
  await send(
    'addIssuer',
    note.getFunction('addIssuer')(context.operator.address, { gasLimit: ATS_GAS.addIssuer }),
  );

  demo.note = {
    ...(await contractIdOf(address).then((id) => (id === undefined ? {} : { contractId: id }))),
    address,
    name: plan.name,
    symbol: plan.symbol,
    isin: plan.isin,
    maturityDate: plan.maturityDate,
    deployTx: deployed.hash,
    gasUsed: deployed.gasUsed,
    minted: (UNITS_PER_INVESTOR * 10n ** BigInt(NOTE.decimals)).toString(),
  };
  context.save();

  for (const investor of context.investors) {
    const credential = await createKycCredential(
      `0x${context.operator.key.toStringRaw()}`,
      investor.address,
    );
    if (!(await verifyCredential(credential))) {
      throw new Error('the credential this build just signed does not verify');
    }
    const args = grantKycArguments(credential, investor.address, Date.now());
    const grant = await send(
      `grantKyc ${investor.role}`,
      note.getFunction('grantKyc')(
        args.account,
        args.vcId,
        args.validFrom,
        args.validTo,
        args.issuer,
        { gasLimit: ATS_GAS.grantKyc },
      ),
    );
    demo.note.kyc = { ...(demo.note.kyc ?? {}), [investor.role]: grant.hash };
    const mint = await send(
      `issueByPartition ${UNITS_PER_INVESTOR} unit to ${investor.role}`,
      note.getFunction('issueByPartition')(
        {
          partition: PARTITION_1,
          tokenHolder: investor.address,
          value: UNITS_PER_INVESTOR * 10n ** BigInt(NOTE.decimals),
          data: '0x',
        },
        { gasLimit: ATS_GAS.issue },
      ),
    );
    demo.note.mints = { ...(demo.note.mints ?? {}), [investor.role]: mint.hash };
    context.save();
  }
  console.log(`  principal on the note ${principalFor(plan)}`);
}

// ------------------------------------------------------------- subscribe

async function subscribe(context: CouponContext): Promise<void> {
  const demo = demoOf(context);
  for (const investor of context.investors) {
    const subscription = await subscribeInvestor(
      context,
      demo.seriesId,
      investor,
      SUBSCRIPTION_PER_INVESTOR,
    );
    if (subscription === null) continue;
    demo.subscriptions = [
      ...demo.subscriptions.filter((entry) => entry.role !== investor.role),
      subscription,
    ];
    context.save();
  }
  const state = (await context.vault.getFunction('seriesOf')(demo.seriesId)) as {
    principalFunded: bigint;
  };
  console.log(`  principalFunded ${state.principalFunded}`);
}

// ------------------------------------------------------------------ wait

/**
 * Wait for the series to mature. The contract compares against the consensus
 * timestamp of the block the call lands in, so this waits a few seconds past
 * the maturity rather than up to it.
 */
async function wait(context: CouponContext): Promise<void> {
  const demo = demoOf(context);
  const target = demo.maturityAt + 5;
  while (now() < target) {
    const left = target - now();
    console.log(`  ${left} seconds to maturity`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 30) * 1000));
  }
  console.log(`  ${demo.label} matured at ${demo.maturityAt}`);
}

// ---------------------------------------------------------------- redeem

/**
 * Redeem both sides.
 *
 * ATS burns the holding with `fullRedeemAtMaturity` under
 * ROLE_MATURITY_REDEEMER, which needs the holder to still hold KYC at the
 * moment it is called and reverts if any partition balance is zero, so it runs
 * once per holder and the KYC status is asserted first. The vault returns the
 * money with `redeemAtMaturity`, which is permissionless on purpose: the holder,
 * a judge or the demo driver can finish the lifecycle with no keeper running.
 */
async function redeem(context: CouponContext): Promise<void> {
  const demo = demoOf(context);
  const note = demo.note === undefined ? undefined : noteContract(demo.note.address, context.operator.wallet);

  for (const investor of context.investors) {
    if (demo.redemptions.some((entry) => entry.role === investor.role)) {
      console.log(`  ${investor.role} already redeemed`);
      continue;
    }
    const entry: Partial<RedemptionRecord> = { role: investor.role, address: investor.address };

    if (note !== undefined) {
      const status = Number(await note.getFunction('getKycStatusFor')(investor.address));
      if (status !== 1) {
        throw new Error(
          `${investor.role} holds KYC status ${status} on the note and cannot be redeemed at maturity`,
        );
      }
      const held = (await note.getFunction('balanceOf')(investor.address)) as bigint;
      if (held > 0n) {
        const burn = await send(
          `fullRedeemAtMaturity ${investor.role}`,
          note.getFunction('fullRedeemAtMaturity')(investor.address, {
            gasLimit: GAS.redeemAtMaturityAts,
          }),
        );
        const after = (await note.getFunction('balanceOf')(investor.address)) as bigint;
        console.log(`  ${investor.role} note balance ${held} to ${after}`);
        entry.burnTx = burn.hash;
        entry.burnGasUsed = burn.gasUsed;
      }
    }

    const before = await tokenBalanceOf(context, investor.address);
    const redeemed = await send(
      `redeemAtMaturity ${investor.role}`,
      context.vault.getFunction('redeemAtMaturity')(demo.seriesId, investor.address, {
        gasLimit: GAS.redeemAtMaturity,
      }),
    );
    const after = await tokenBalanceOf(context, investor.address);
    const amount = after - before;
    console.log(`  ${investor.role} received ${amount} minor units`);
    demo.redemptions = [
      ...demo.redemptions.filter((item) => item.role !== investor.role),
      {
        role: investor.role,
        address: investor.address,
        amount: amount.toString(),
        tx: redeemed.hash,
        gasUsed: redeemed.gasUsed,
        ...(entry.burnTx === undefined ? {} : { burnTx: entry.burnTx }),
        ...(entry.burnGasUsed === undefined ? {} : { burnGasUsed: entry.burnGasUsed }),
      },
    ];
    context.save();
  }
}

// ---------------------------------------------------------------- payout

/**
 * What a paid claim did to the principal, read off the chain.
 *
 * The T04 run through paid one 10,000 claim against a 30,000 principal on a
 * throwaway series, and `principalRemaining` has read 20,000 ever since. That
 * is the "principal reduced by payouts" half of the acceptance, read from
 * testnet rather than paid again: a second real claim belongs to T13, and the
 * arithmetic that ties a payout to each holder's redemption is covered against
 * every rounding case in contracts/test/hardhat/collateral-vault.ts.
 */
async function payout(context: CouponContext): Promise<void> {
  const demo = demoOf(context);
  const label = context.record.testnetRunthrough?.series;
  if (label === undefined) {
    console.log('  no run through series in the deployment record');
    return;
  }
  const seriesId = toBytes32(label);
  const state = (await context.vault.getFunction('seriesOf')(seriesId)) as {
    principalFunded: bigint;
    principalPaid: bigint;
  };
  const remaining = (await context.vault.getFunction('principalRemaining')(seriesId)) as bigint;
  console.log(
    `  ${label} funded ${state.principalFunded}, paid ${state.principalPaid}, remaining ${remaining}`,
  );
  demo.principalAfterPayout = {
    series: label,
    principalFunded: state.principalFunded.toString(),
    principalPaid: state.principalPaid.toString(),
    principalRemaining: remaining.toString(),
  };
  context.save();
}

// ---------------------------------------------------------------- status

async function status(context: CouponContext): Promise<void> {
  const demo = context.record.maturityDemo;
  if (demo === undefined) {
    console.log('  no maturity series yet');
    return;
  }
  const state = (await context.vault.getFunction('seriesOf')(demo.seriesId)) as {
    principalFunded: bigint;
    principalPaid: bigint;
    principalRedeemed: bigint;
    maturityAt: bigint;
  };
  console.log(`  ${demo.label} ${demo.seriesId}`);
  console.log(`  maturityAt ${state.maturityAt}, now ${now()}`);
  console.log(
    `  funded ${state.principalFunded}, paid ${state.principalPaid}, redeemed ${state.principalRedeemed}`,
  );
  if (demo.note !== undefined) {
    const note = noteContract(demo.note.address, context.provider);
    for (const investor of context.investors) {
      const held = (await note.getFunction('balanceOf')(investor.address)) as bigint;
      const subscription = (await context.vault.getFunction('subscriptionOf')(
        demo.seriesId,
        investor.address,
      )) as bigint;
      console.log(`  ${investor.role} note ${held}, subscription ${subscription}`);
    }
  }
}

// ------------------------------------------------------------------ main

const HANDLERS: Record<Exclude<Step, 'all'>, (context: CouponContext) => Promise<void>> = {
  status,
  fund: fundAccounts,
  open,
  bond,
  subscribe,
  wait,
  redeem,
  payout,
};

async function main(): Promise<void> {
  const requested = (process.argv[2] ?? 'all') as Step;
  if (!STEPS.includes(requested)) {
    throw new Error(`unknown step "${requested}". One of: ${STEPS.join(', ')}`);
  }
  const context = openCouponContext();
  // The demo note is only read for its address here, but reading it early fails
  // fast when the record is from before `pnpm ats:issue` ran.
  demoNoteAddress(context.record);
  const steps = requested === 'all' ? RUN : [requested];
  for (const name of steps) {
    console.log(name);
    try {
      await HANDLERS[name as Exclude<Step, 'all'>]!(context);
    } finally {
      context.save();
    }
  }
  context.client.close();
}

await main();
