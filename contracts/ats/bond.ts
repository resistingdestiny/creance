import { ATS, NOTE, PARTITION_1 } from './config.js';

/// The argument tuples for IFactory.deployBond, built here so the shape can be
/// asserted without a chain. The field order follows
/// contracts/factory/IFactory.sol at the 8.0.0 tag, which is what the ABI in
/// @hashgraph/asset-tokenization-contracts encodes.

export interface Rbac {
  role: string;
  members: string[];
}

export interface BondPlan {
  name: string;
  symbol: string;
  isin: string;
  decimals: number;
  units: bigint;
  nominalValue: bigint;
  startingDate: number;
  maturityDate: number;
  owner: string;
  configVersion: number;
  /// Internal KYC is the gate the blocked transfer demonstrates, and it cannot
  /// be turned off after deployment, so it is a plan input rather than a
  /// constant.
  internalKycActivated: boolean;
  /// The SDK sends the unit count unscaled. Setting this false reproduces that
  /// encoding, which is what the throwaway deployment is for.
  scaleMaxSupply: boolean;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/// A cap of zero means no cap at all, so the value has to be right rather than
/// generous: the contract accepts a mint while total supply plus the amount is
/// at or below it. Balances are held in the token's own decimals, so the cap
/// for a hundred units of a six decimal note is a hundred million, not a
/// hundred.
export function maxSupplyFor(plan: BondPlan): bigint {
  return plan.scaleMaxSupply ? plan.units * 10n ** BigInt(plan.decimals) : plan.units;
}

/// The nominal value is quoted at the note's own scale so the coupon fraction
/// ATS returns is in whole currency units and the API keeps one scale.
export function nominalValueFor(plan: BondPlan): bigint {
  return plan.nominalValue * 10n ** BigInt(plan.decimals);
}

export function principalFor(plan: BondPlan): bigint {
  return plan.units * plan.nominalValue;
}

export function bondData(plan: BondPlan, rbacs: Rbac[]) {
  if (plan.maturityDate <= plan.startingDate) {
    throw new Error(
      `maturity ${plan.maturityDate} must be after the start ${plan.startingDate}`,
    );
  }
  return {
    security: {
      resolver: ATS.resolver,
      maxSupply: maxSupplyFor(plan),
      resolverProxyConfiguration: { key: ATS.bondConfigId, version: BigInt(plan.configVersion) },
      erc20MetadataInfo: {
        name: plan.name,
        symbol: plan.symbol,
        isin: plan.isin,
        decimals: plan.decimals,
      },
      rbacs,
      externalPauses: [],
      externalControlLists: [],
      // Internal KYC and external lists combine as an AND, not the OR the
      // compliance guide describes, so the note uses one mechanism and leaves
      // this empty. See docs/harness-notes.md.
      externalKycLists: [],
      // Reading A of DESIGN.md 3.8: ATS's own compliance stack is the ERC-3643
      // surface. An external T-REX compliance module and identity registry
      // would have to be deployed first and are out of scope, see
      // docs/DECISIONS.md.
      compliance: ZERO_ADDRESS,
      identityRegistry: ZERO_ADDRESS,
      arePartitionsProtected: false,
      isMultiPartition: false,
      // Forced transfer is not needed: CollateralVault owns principal at risk.
      isControllable: false,
      isWhiteList: false,
      // Clearing adds a validator signature to every transfer and redemption,
      // and it blocks redemption at maturity.
      clearingActive: false,
      internalKycActivated: plan.internalKycActivated,
      erc20VotesActivated: false,
    },
    bondDetails: {
      currency: NOTE.currency,
      nominalValue: nominalValueFor(plan),
      nominalValueDecimals: plan.decimals,
      startingDate: BigInt(plan.startingDate),
      maturityDate: BigInt(plan.maturityDate),
    },
    proceedRecipients: [],
    proceedRecipientsData: [],
  };
}

export function regulationData(info: string) {
  return {
    regulationType: NOTE.regulationType,
    regulationSubType: NOTE.regulationSubType,
    additionalSecurityData: {
      countriesControlListType: false,
      listOfCountries: '',
      info,
    },
  };
}

/// The single partition every balance sits in, quoted here so callers do not
/// re-spell the constant.
export const partition = PARTITION_1;
