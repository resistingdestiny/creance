import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from 'ethers';

import { AppError } from '../errors.js';
import { fromBytes32 } from '../ids.js';
import {
  claimAuthorisationDomain,
  CLAIM_AUTHORISATION_TYPES,
  type ClaimAuthorisation,
} from './authorisation.js';
import { COVER_POOL_ABI, periodFromMonthIndex, SERIES_STATUS, VAULT_PRINCIPAL_ABI } from './abi.js';

/// The chain half of the policy endpoints, behind one interface.
///
/// The routes never touch ethers directly, so `pnpm test` stays chain free and
/// the testnet stage swaps in the relay. The reads answer the capacity question
/// and the pricing's utilisation term; the one write is `bind`.

export interface SeriesChainState {
  /** As CoverPool reports it: none, active, claims_open, settling, matured. */
  status: (typeof SERIES_STATUS)[number];
  groupKey: string;
  /** Percentage points. The contract holds these as int64 scaled by 1e4. */
  attachmentShock: number;
  levelLine: number;
  exhaustionShock: number;
  payoutMode: 'full' | 'indexed';
  waitingPeriodSeconds: number;
  termSeconds: number;
  gracePeriodSeconds: number;
  claimWindowObsSeconds: number;
  claimWindowSepSeconds: number;
  lookbackMonths: number;
  /** Minor units of the settlement asset. */
  activeExposure: bigint;
  principalRemaining: bigint;
  freeCapacity: bigint;
  /** YYYYMM, or 0 when the series has never opened or never been observed. */
  firstOpenMonth: number;
  lastOpenMonth: number;
  lastObservedMonth: number;
  /**
   * When the current claim window closes, in seconds since the epoch, or 0 when
   * no window is open. `closeWindow` refuses before it and the reserve stays
   * with the exposed policies until it passes.
   */
  windowEndsAt: number;
}

/** What the window rules read, all of it off the chain rather than re-derived. */
export interface LossWindow {
  /** Every month this series has ever opened, YYYYMM, oldest first. */
  openMonths: number[];
  lastObservedMonth: number;
}

export interface BindCall {
  policyId: string;
  seriesId: string;
  holder: string;
  nullifierHash: string;
  limit: bigint;
  premium: bigint;
  startAt: number;
  hcsReceiptSeq: number;
}

/** `CoverPool.ClaimParams`, in the order the struct declares its fields. */
export interface ClaimCall {
  policyId: string;
  claimId: string;
  separationAt: number;
  packetHash: string;
  decisionHash: string;
  amount: bigint;
  payee: string;
  authDeadline: number;
}

/** The index key, as `isInLossWindow` answers it. Periods are YYYYMM. */
export interface LossWindowAnswer {
  inWindow: boolean;
  /** The earliest open month that qualifies the separation, or 0 when none. */
  qualifyingPeriod: number;
}

export interface ChainWrite {
  transactionHash: string;
  hashscan: string;
  gasUsed: string;
}

export interface ChainGateway {
  seriesState(seriesKey: string): Promise<SeriesChainState>;
  activePolicyOf(seriesKey: string, nullifierHash: string): Promise<string>;
  bind(call: BindCall): Promise<ChainWrite>;
  recordPremium(policyId: string, period: number): Promise<ChainWrite>;
  /**
   * The open months and the newest observed one, from the contract.
   *
   * The adjudication's loss window is read here rather than recomputed from the
   * observations table, because CoverPool is what `payClaim` checks against:
   * two implementations of "the separation month or one of the lookback months
   * is open" is how the review screen and the chain end up disagreeing while a
   * judge is watching.
   */
  lossWindow(seriesKey: string): Promise<LossWindow>;
  /**
   * `claimDeadline(seriesId, separationAt)`, as seconds since the epoch, or 0
   * when no month qualifies yet. Stored on the claim and never recomputed.
   */
  claimDeadline(seriesKey: string, separationAt: number): Promise<number>;
  /**
   * `isInLossWindow(seriesId, separationPeriod)`, which is the index key.
   *
   * Read from the contract rather than derived from `openMonths` in
   * TypeScript, for the reason docs/CLAIMS.md gives about the whole window:
   * `payClaim` checks its own answer, and two implementations of "the
   * separation month or one of the lookback months is open" is how the claim
   * screen and the chain end up disagreeing while somebody is watching.
   */
  isInLossWindow(seriesKey: string, separationPeriod: number): Promise<LossWindowAnswer>;
  /**
   * `expectedPayout(policyId, separationAt)`, in minor units.
   *
   * The amount is compared for equality inside `payClaim`, so it is asked for
   * rather than computed: a claim that would pay less than the contract
   * computes is a bug and not a discount to accept quietly.
   */
  expectedPayout(policyId: string, separationAt: number): Promise<bigint>;
  /**
   * The CLAIMS role's signature over one authorisation.
   *
   * The role grants no call rights at all. It is the set of addresses whose
   * EIP-712 signature `payClaim` accepts, so this is the whole of what holding
   * it means for this process.
   */
  signAuthorisation(authorisation: ClaimAuthorisation): Promise<string>;
  /** Pay an approved claim. Permissionless: the signature is what makes it safe. */
  payClaim(call: ClaimCall, authorisation: string): Promise<ChainWrite>;
  /** Return the unclaimed reserve to the vault once the window is over. */
  closeWindow(seriesKey: string): Promise<ChainWrite>;
}

/// Measured on testnet, from docs/HEDERA.md "Measured gas". `eth_estimateGas`
/// cannot price a token service call, and unused gas is refunded in full, so a
/// generous explicit limit is free and an estimate is a coin toss.
export const BIND_GAS_LIMIT = 800_000n;
export const RECORD_PREMIUM_GAS_LIMIT = 200_000n;
/// `payClaim` measured 172,689 with the HTS transfer out through the vault.
export const PAY_CLAIM_GAS_LIMIT = 1_500_000n;
export const CLOSE_WINDOW_GAS_LIMIT = 1_500_000n;

/** Index values cross the ABI as int64 percentage points scaled by 1e4. */
export function fromScaled(value: bigint): number {
  return Number(value) / 10_000;
}

export class EthersChainGateway implements ChainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet | null;

  constructor(
    private readonly coverPoolAddress: string,
    private readonly vaultAddress: string,
    rpcUrl: string,
    private readonly chainId = 296,
    binderKey?: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.signer = binderKey === undefined || binderKey === '' ? null : new Wallet(binderKey, this.provider);
  }

  private pool(withSigner = false): Contract {
    if (withSigner && this.signer === null) {
      throw new AppError(
        503,
        'binder_key_missing',
        'Binding is not configured',
        'This API has no key for the account that holds BINDER_ROLE, so it cannot bind.',
      );
    }
    return new Contract(
      this.coverPoolAddress,
      COVER_POOL_ABI as unknown as InterfaceAbi,
      withSigner ? (this.signer as Wallet) : this.provider,
    );
  }

  async seriesState(seriesKey: string): Promise<SeriesChainState> {
    const pool = this.pool();
    const vault = new Contract(
      this.vaultAddress,
      VAULT_PRINCIPAL_ABI as unknown as InterfaceAbi,
      this.provider,
    );
    const [terms, free, principalRemaining] = await Promise.all([
      pool.getFunction('seriesOf')(seriesKey) as Promise<Record<string, bigint | string>>,
      pool.getFunction('quoteCapacity')(seriesKey) as Promise<bigint>,
      vault.getFunction('principalRemaining')(seriesKey) as Promise<bigint>,
    ]);
    return toSeriesState(terms, free, principalRemaining);
  }

  async activePolicyOf(seriesKey: string, nullifierHash: string): Promise<string> {
    return (await this.pool().getFunction('activePolicyOf')(seriesKey, nullifierHash)) as string;
  }

  async lossWindow(seriesKey: string): Promise<LossWindow> {
    const pool = this.pool();
    const [months, terms] = await Promise.all([
      pool.getFunction('openMonths')(seriesKey) as Promise<bigint[]>,
      pool.getFunction('seriesOf')(seriesKey) as Promise<Record<string, bigint | string>>,
    ]);
    return {
      openMonths: months.map((month) => Number(month)).sort((a, b) => a - b),
      lastObservedMonth: periodFromMonthIndex(Number(terms['lastObservedMonth'])),
    };
  }

  async claimDeadline(seriesKey: string, separationAt: number): Promise<number> {
    const value = (await this.pool().getFunction('claimDeadline')(
      seriesKey,
      separationAt,
    )) as bigint;
    return Number(value);
  }

  async bind(call: BindCall): Promise<ChainWrite> {
    const response = await this.pool(true).getFunction('bind')(
      [
        call.policyId,
        call.seriesId,
        call.holder,
        call.nullifierHash,
        call.limit,
        call.premium,
        call.startAt,
        call.hcsReceiptSeq,
      ],
      { gasLimit: BIND_GAS_LIMIT },
    );
    return await settled(response);
  }

  async recordPremium(policyId: string, period: number): Promise<ChainWrite> {
    const response = await this.pool(true).getFunction('recordPremium')(policyId, period, {
      gasLimit: RECORD_PREMIUM_GAS_LIMIT,
    });
    return await settled(response);
  }

  async isInLossWindow(seriesKey: string, separationPeriod: number): Promise<LossWindowAnswer> {
    const [inWindow, qualifyingPeriod] = (await this.pool().getFunction('isInLossWindow')(
      seriesKey,
      separationPeriod,
    )) as [boolean, bigint];
    return { inWindow, qualifyingPeriod: Number(qualifyingPeriod) };
  }

  async expectedPayout(policyId: string, separationAt: number): Promise<bigint> {
    return (await this.pool().getFunction('expectedPayout')(policyId, separationAt)) as bigint;
  }

  async signAuthorisation(authorisation: ClaimAuthorisation): Promise<string> {
    const signer = this.signer;
    if (signer === null) {
      throw new AppError(
        503,
        'claims_key_missing',
        'Paying is not configured',
        'This API has no key for the account that holds CLAIMS_ROLE, so it cannot authorise a payout.',
      );
    }
    return await signer.signTypedData(
      claimAuthorisationDomain(this.chainId, this.coverPoolAddress),
      CLAIM_AUTHORISATION_TYPES as unknown as Record<string, { name: string; type: string }[]>,
      authorisation,
    );
  }

  async payClaim(call: ClaimCall, authorisation: string): Promise<ChainWrite> {
    // Signed rather than sent from anywhere: `payClaim` is permissionless, and
    // this account is simply the one this process has a key for. A retry after
    // an environmental failure can come from any account at all.
    const response = await this.pool(true).getFunction('payClaim')(
      [
        call.policyId,
        call.claimId,
        call.separationAt,
        call.packetHash,
        call.decisionHash,
        call.amount,
        call.payee,
        call.authDeadline,
      ],
      authorisation,
      { gasLimit: PAY_CLAIM_GAS_LIMIT },
    );
    return await settled(response);
  }

  async closeWindow(seriesKey: string): Promise<ChainWrite> {
    const response = await this.pool(true).getFunction('closeWindow')(seriesKey, {
      gasLimit: CLOSE_WINDOW_GAS_LIMIT,
    });
    return await settled(response);
  }
}

interface TransactionResponse {
  hash: string;
  wait(): Promise<{ hash: string; gasUsed: bigint } | null>;
}

async function settled(response: TransactionResponse): Promise<ChainWrite> {
  const receipt = await response.wait();
  const hash = receipt?.hash ?? response.hash;
  return {
    transactionHash: hash,
    hashscan: `https://hashscan.io/testnet/transaction/${hash}`,
    gasUsed: (receipt?.gasUsed ?? 0n).toString(),
  };
}

/** The tuple `seriesOf` returns, named. */
export function toSeriesState(
  terms: Record<string, unknown>,
  freeCapacity: bigint,
  principalRemaining: bigint,
): SeriesChainState {
  const statusIndex = Number(terms['status']);
  return {
    status: SERIES_STATUS[statusIndex] ?? 'none',
    groupKey: fromBytes32(String(terms['group'])),
    attachmentShock: fromScaled(BigInt(String(terms['attachmentShock']))),
    levelLine: fromScaled(BigInt(String(terms['levelLine']))),
    exhaustionShock: fromScaled(BigInt(String(terms['exhaustionShock']))),
    payoutMode: Number(terms['payoutMode']) === 1 ? 'indexed' : 'full',
    waitingPeriodSeconds: Number(terms['waitingPeriod']),
    termSeconds: Number(terms['term']),
    gracePeriodSeconds: Number(terms['gracePeriod']),
    claimWindowObsSeconds: Number(terms['claimWindowFromObservation']),
    claimWindowSepSeconds: Number(terms['claimWindowFromSeparation']),
    lookbackMonths: Number(terms['lookbackMonths']),
    activeExposure: BigInt(String(terms['activeExposure'])),
    principalRemaining,
    freeCapacity,
    firstOpenMonth: periodFromMonthIndex(Number(terms['firstOpenMonth'])),
    lastOpenMonth: periodFromMonthIndex(Number(terms['lastOpenMonth'])),
    lastObservedMonth: periodFromMonthIndex(Number(terms['lastObservedMonth'])),
    windowEndsAt: Number(terms['windowEndsAt']),
  };
}

/**
 * A revert reaches the relay as a hex selector. These are the ones the API can
 * cause; anything else is a 502, with the selector in the log and never in the
 * response, because a caller cannot act on it.
 */
const REVERT_CODES: Record<string, { status: number; code: string; title: string; detail: string }> =
  {
    PolicyExists: {
      status: 409,
      code: 'policy_exists',
      title: 'Policy exists',
      detail: 'A policy with that id is already registered.',
    },
    NullifierHasActivePolicy: {
      status: 409,
      code: 'already_covered',
      title: 'Already covered',
      detail: 'An active policy already exists for this person in this series.',
    },
    CapacityExceeded: {
      status: 409,
      code: 'insufficient_capacity',
      title: 'No capacity',
      detail: 'The series has no capacity left for a policy of that size.',
    },
    SeriesNotActive: {
      status: 409,
      code: 'series_not_open_for_binding',
      title: 'Series not open',
      detail: 'That series is not taking new cover.',
    },
    SeriesUnknown: {
      status: 404,
      code: 'series_not_found',
      title: 'Series not found',
      detail: 'No series with that key is registered in the pool.',
    },
    BadTerms: {
      status: 400,
      code: 'bad_terms',
      title: 'Bad terms',
      detail: 'The cover limit must be greater than zero.',
    },
    ZeroAddress: {
      status: 400,
      code: 'bad_holder',
      title: 'Bad holder',
      detail: 'The holder address is empty.',
    },
    PolicyNotActive: {
      status: 409,
      code: 'policy_not_claimable',
      title: 'Cover not claimable',
      detail: 'That cover is not active, so nothing can be paid on it.',
    },
    PolicyAlreadyPaid: {
      status: 409,
      code: 'already_paid',
      title: 'Already paid',
      detail: 'A claim on that cover has already been paid.',
    },
    ClaimIdUsed: {
      status: 409,
      code: 'already_paid',
      title: 'Already paid',
      detail: 'That claim has already been paid.',
    },
    NullifierAlreadyClaimed: {
      status: 409,
      code: 'already_claimed',
      title: 'Already claimed',
      detail: 'This person has already claimed once in this series, and one claim is all there is.',
    },
    SeparationInWaitingPeriod: {
      status: 409,
      code: 'separation_in_waiting_period',
      title: 'Too early',
      detail: 'The last day of work falls inside the first 60 days of cover, which is not covered.',
    },
    SeparationAfterTerm: {
      status: 409,
      code: 'separation_after_term',
      title: 'After the cover ended',
      detail: 'The last day of work falls after this cover ended.',
    },
    SeparationOutsideLossWindow: {
      status: 409,
      code: 'outside_loss_window',
      title: 'Claims not open for that month',
      detail: 'The index did not open for the month of the separation or the two months after it.',
    },
    ClaimWindowClosed: {
      status: 409,
      code: 'claim_window_closed',
      title: 'The claim window has closed',
      detail: 'The time to file a claim for that separation has passed.',
    },
    AmountMismatch: {
      status: 409,
      code: 'amount_mismatch',
      title: 'Amount mismatch',
      detail: 'The authorised amount is not the amount the cover computes for this claim.',
    },
    ZeroPayout: {
      status: 409,
      code: 'zero_payout',
      title: 'Nothing to pay',
      detail: 'This claim computes a payout of zero.',
    },
    PayeeIsNotHolder: {
      status: 409,
      code: 'payee_is_not_holder',
      title: 'Wrong wallet',
      detail: 'A payout goes to the wallet that holds the cover and to no other.',
    },
    AuthorisationExpired: {
      status: 409,
      code: 'authorisation_expired',
      title: 'Authorisation expired',
      detail: 'The authorisation for this payout has expired. A fresh one can be signed.',
    },
    BadSignature: {
      status: 502,
      code: 'authorisation_rejected',
      title: 'Authorisation rejected',
      detail: 'The cover pool could not read the authorisation for this payout.',
    },
    SignerLacksClaimsRole: {
      status: 502,
      code: 'authorisation_rejected',
      title: 'Authorisation rejected',
      detail: 'The account that signed this payout does not hold the claims role.',
    },
    IndexedModeNeedsShockOpening: {
      status: 409,
      code: 'payout_mode_not_supported',
      title: 'Amount not computable',
      detail: 'This series pays on the index and the qualifying month opened on the level form.',
    },
    WindowNotOver: {
      status: 409,
      code: 'window_not_over',
      title: 'The window is still open',
      detail: 'The claim window has not ended yet, so the reserve stays where it is.',
    },
    NoOpenWindow: {
      status: 409,
      code: 'no_open_window',
      title: 'No window to close',
      detail: 'That series has no claim window open.',
    },
  };

/** Turn a reverted contract call into the problem document a caller can act on. */
export function mapRevert(error: unknown): AppError {
  const name = revertName(error);
  const mapped = name === null ? undefined : REVERT_CODES[name];
  if (mapped !== undefined) {
    return new AppError(mapped.status, mapped.code, mapped.title, mapped.detail);
  }
  return new AppError(
    502,
    'chain_write_failed',
    'The chain refused the write',
    'The policy could not be registered on chain. Nothing was charged. Try again.',
  );
}

function revertName(error: unknown): string | null {
  const candidate = error as { revert?: { name?: string }; shortMessage?: string };
  if (typeof candidate?.revert?.name === 'string') return candidate.revert.name;
  // ethers puts the decoded name in shortMessage when the error came back from
  // a static call rather than from a receipt.
  const match = /reverted with custom error '([A-Za-z]+)\(/.exec(candidate?.shortMessage ?? '');
  return match?.[1] ?? null;
}
