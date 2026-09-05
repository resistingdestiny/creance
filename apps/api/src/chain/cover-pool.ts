import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from 'ethers';

import { AppError } from '../errors.js';
import { fromBytes32 } from '../ids.js';
import { COVER_POOL_ABI, SERIES_STATUS, VAULT_PRINCIPAL_ABI } from './abi.js';

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
}

/// Measured on testnet, from docs/HEDERA.md "Measured gas". `eth_estimateGas`
/// cannot price a token service call, and unused gas is refunded in full, so a
/// generous explicit limit is free and an estimate is a coin toss.
export const BIND_GAS_LIMIT = 800_000n;
export const RECORD_PREMIUM_GAS_LIMIT = 200_000n;

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
    chainId = 296,
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
