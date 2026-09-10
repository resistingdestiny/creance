import type { Wallet } from 'ethers';

import { entryFor } from '../scripts/deploy/catalogue.js';
import type { SeriesRecord } from '../scripts/deploy/record.js';
import { bondData, maxSupplyFor, principalFor, regulationData, type BondPlan } from './bond.js';
import {
  ATS,
  ATS_TAG,
  ATS_VERSION,
  GAS,
  NOTE,
  noteNameFor,
  PARTITION_1,
  ROLES,
  type RoleName,
} from './config.js';
import {
  bondConfigVersion,
  checkAtsAddresses,
  contractIdOf,
  factoryAt,
  noteAt,
  send,
  type Session,
} from './chain.js';
import { createKycCredential, grantKycArguments, verifyCredential } from './credential.js';
import { testIsinFor } from './isin.js';
import type { AtsNoteRecord, AtsRecord } from './record.js';

/// Deploying a Displacement Bond Note, shared by `pnpm ats:issue`, which runs
/// the whole T06 compliance sequence against one note, and by the capacity
/// runner, which issues a note per occupation group and runs only the steps a
/// new series needs.

/// One deployBond call on the ATS factory, with the BondDeployed address read
/// back out of the receipt.
export async function deployNote(
  session: Session,
  plan: BondPlan,
  info: string,
): Promise<AtsNoteRecord> {
  await checkAtsAddresses();
  const factory = factoryAt(session.operator);
  // The only role set at creation is the diamond owner, which is what the SDK
  // sends; every other role is granted afterwards so each grant is its own
  // transaction on the record.
  const rbacs = [{ role: `0x${'00'.repeat(32)}`, members: [plan.owner] }];
  console.log(`  deploying ${plan.name}`);
  console.log(`  isin ${plan.isin}, decimals ${plan.decimals}, max supply ${maxSupplyFor(plan)}`);
  const sent = await send(
    'deployBond',
    factory.deployBond!(bondData(plan, rbacs), regulationData(info), { gasLimit: GAS.deployBond }),
  );
  const deployed = sent.receipt.logs
    .map((log) => {
      try {
        return factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === 'BondDeployed');
  const address = deployed?.args?.[1] as string | undefined;
  if (address === undefined) throw new Error('no BondDeployed event in the deployment receipt');
  const contractId = await contractIdOf(address);
  console.log(`  bond ${address} ${contractId ?? '(mirror node not caught up)'}`);
  return {
    contractId,
    address,
    name: plan.name,
    symbol: plan.symbol,
    isin: plan.isin,
    decimals: plan.decimals,
    units: plan.units.toString(),
    nominalValue: plan.nominalValue.toString(),
    principal: principalFor(plan).toString(),
    currency: NOTE.currency,
    maxSupply: maxSupplyFor(plan).toString(),
    startingDate: plan.startingDate,
    maturityDate: plan.maturityDate,
    internalKycActivated: plan.internalKycActivated,
    regulation: 'Regulation S',
    deployTx: sent.hash,
    gasUsed: sent.gasUsed,
  };
}

/// The empty ATS record a series starts from, so the factory pair a note was
/// issued against is on the record before the deploy rather than after it.
export function emptyAtsRecord(): AtsRecord {
  return {
    version: ATS_VERSION,
    tag: ATS_TAG,
    factoryId: ATS.factoryId,
    factory: ATS.factory,
    resolverId: ATS.resolverId,
    resolver: ATS.resolver,
    configId: ATS.bondConfigId,
  };
}

/// The plan for a series' note, from the catalogue and the vault's own
/// maturity. The two instruments have to agree on the day the principal comes
/// back, so the maturity is the vault's rather than a fresh twelve months.
export function planFor(series: SeriesRecord, owner: string, configVersion: number): BondPlan {
  const entry = entryFor(series.label);
  return {
    name: noteNameFor(series.label),
    symbol: entry.noteSymbol,
    isin: testIsinFor(series.label),
    decimals: NOTE.decimals,
    units: entry.noteUnits,
    nominalValue: NOTE.nominalValue,
    startingDate: Math.floor(Date.now() / 1000),
    maturityDate: series.maturityAt,
    owner,
    configVersion,
    internalKycActivated: true,
    scaleMaxSupply: true,
  };
}

/// The roles the seeding sequence needs, which is a subset of the eight the
/// T06 demonstration grants. Nothing here pauses, freezes or declares a
/// coupon, so those roles are left ungranted and the diamond owner can grant
/// them later if a series ever needs them.
const SEED_ROLES = ['ROLE_SSI_MANAGER', 'ROLE_KYC', 'ROLE_ISSUER'] as const;

function step(ats: AtsRecord, name: string, entry: { tx?: string; result: string; gasUsed?: number }) {
  ats.steps = { ...ats.steps, [name]: entry };
}

/**
 * Issue a series' note and mint its whole supply to the account that funded
 * the series in the vault.
 *
 * The vault and the note are the same instrument seen from two sides, so a
 * note with nothing minted against a vault holding 25,000 would make the
 * investor screen read a principal of zero. The seed holder is the operator,
 * which is the account whose settlement tokens are actually at risk in the
 * vault, and every unit it holds is a unit it paid for.
 *
 * Every step is guarded by what the chain already says, so an interrupted run
 * is resumed by calling this again.
 */
export async function seedNote(
  session: Session,
  series: SeriesRecord,
  ats: AtsRecord,
): Promise<void> {
  const owner = session.operator.address;
  if (ats.note === undefined) {
    const version = await bondConfigVersion(session.provider);
    ats.configVersion = version;
    ats.note = await deployNote(
      session,
      planFor(series, owner, version),
      `Creance Displacement Bond Note, series ${series.label}`,
    );
    step(ats, 'issue', {
      tx: ats.note.deployTx,
      result:
        `series ${series.label} issued as an ATS bond, principal ${ats.note.principal}, ` +
        `internal KYC on, clearing off, not controllable, Regulation S`,
      gasUsed: ats.note.gasUsed,
    });
  } else {
    console.log(`  note already at ${ats.note.address}`);
  }

  const bond = noteAt(ats.note.address, session.operator);

  // Nothing left to seed. The guard is here rather than after the roles so a
  // note that is already issued and fully subscribed is left completely
  // alone: the demo series went through the whole T06 sequence and this must
  // not grant it a role, a credential or a step line of its own.
  const supply = (await bond.totalSupply!()) as bigint;
  const cap = BigInt(ats.note.maxSupply);
  if (supply >= cap) {
    console.log(`  ${supply} of ${cap} already minted, nothing to seed`);
    return;
  }

  const granted: RoleName[] = [];
  for (const role of SEED_ROLES) {
    if ((await bond.hasRole!(ROLES[role], owner)) as boolean) continue;
    const sent = await send(
      `grantRole ${role}`,
      bond.grantRole!(ROLES[role], owner, { gasLimit: GAS.grantRole }),
    );
    ats.roles = { ...ats.roles, [role]: sent.hash };
    granted.push(role);
  }
  // Named as what this run granted, not as what the operator holds: a note
  // that already carries more roles than these must not have that written
  // down as fewer.
  if (granted.length > 0) {
    step(ats, 'roles', { result: `the operator was granted ${granted.join(', ')}` });
  }

  if (((await bond.isIssuer!(owner)) as boolean) !== true) {
    const sent = await send('addIssuer', bond.addIssuer!(owner, { gasLimit: GAS.addIssuer }));
    step(ats, 'issuer', {
      tx: sent.hash,
      result: `${owner} registered as the credential issuer, isIssuer reads true`,
      gasUsed: sent.gasUsed,
    });
  }
  ats.issuer = owner;

  if (Number(await bond.getKycStatusFor!(owner)) !== 1) {
    // The signature is checked here, not on chain: the contract stores the
    // credential id as an opaque string.
    const credential = await createKycCredential(session.operator.privateKey, owner);
    if (!(await verifyCredential(credential))) {
      throw new Error('the credential this build just signed does not verify');
    }
    const args = grantKycArguments(credential, owner, Date.now());
    const sent = await send(
      'grantKyc operator',
      bond.grantKyc!(args.account, args.vcId, args.validFrom, args.validTo, args.issuer, {
        gasLimit: GAS.grantKyc,
      }),
    );
    ats.kyc = {
      ...ats.kyc,
      operator: { vcId: args.vcId, validFrom: args.validFrom, validTo: args.validTo, tx: sent.hash },
    };
    step(ats, 'kyc-operator', {
      tx: sent.hash,
      result: `getKycStatusFor(${owner}) reads GRANTED (1)`,
      gasUsed: sent.gasUsed,
    });
  }

  const sent = await send(
    `issueByPartition ${cap - supply} to the operator`,
    bond.issueByPartition!(
      { partition: PARTITION_1, tokenHolder: owner, value: cap - supply, data: '0x' },
      { gasLimit: GAS.issue },
    ),
  );
  const after = (await bond.balanceOf!(owner)) as bigint;
  step(ats, 'mint-operator', {
    tx: sent.hash,
    result: `balanceOf(operator) ${supply} to ${after}, the whole ${ats.note.units} unit supply`,
    gasUsed: sent.gasUsed,
  });
}

/// The note contract for a runner that already has the record.
export function noteContractFor(ats: AtsRecord, runner: Wallet) {
  if (ats.note === undefined) throw new Error('the note is not issued yet');
  return noteAt(ats.note.address, runner);
}
