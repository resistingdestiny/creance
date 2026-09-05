import { fmt2, periodIndex, toScaledInt, type Period } from '@creance/index-model';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import { COVER_POOL_ABI, VAULT_ABI, canAcceptObservation, seriesStatusName } from './abi.js';

/**
 * The on chain half: `submitObservation` with the ORACLE role.
 *
 * Three things about the contract shape the code here.
 *
 * It does not ignore a duplicate, it reverts. `ObservationExists`,
 * `PeriodNotAfterLast` and `PeriodInFuture` are all reachable from a rerun, so
 * idempotence is the worker's job: read `observationOf().present` and
 * `seriesOf().lastObservedMonth` before every call and treat an existing
 * observation as done rather than as an error.
 *
 * It decides `open` itself, from the thresholds frozen at registration. The
 * oracle sends two measurements and reads the decision back out of the event.
 *
 * It cannot be priced by `eth_estimateGas`, because an opening month reaches
 * the token service through the vault. The gas limit is explicit, from the
 * 271,024 measured on testnet; unused gas is refunded in full.
 */

/**
 * The int64 sent for a month whose ODI is not evaluable.
 *
 * docs/INDEX-SPEC.md section 4 publishes `"odi":null` when months t-12 to t-14
 * are missing, and the contract has no null. This is the smallest int64: it
 * cannot satisfy `odi >= attachmentShock` for any attachment (the smallest the
 * calibration produces is 1.5 points, 15000), it is not a value the index can
 * ever produce (the archive's extremes since 2000 are inside ten points), and
 * it is unmistakable in an event log. The indexed payout formula is the only
 * arithmetic the contract does on `odi` and it runs only on a shock opening,
 * which this value can never produce.
 */
export const NULL_ODI = -(2n ** 63n);

export interface SeriesState {
  status: number;
  statusName: string;
  acceptsObservations: boolean;
  activeExposure: bigint;
  exposureCovered: bigint;
  /** Month index, year * 12 + month - 1. Zero when nothing was ever observed. */
  lastObservedMonth: number;
  windowEndsAt: number;
  attachmentShock: bigint;
  levelLine: bigint;
}

export interface SubmitInput {
  seriesId: string;
  period: Period;
  odi: number | null;
  ebar: number;
  hcsSequence: number;
  /** sha256 hex of the source rows, with or without an 0x prefix. */
  sourceHash: string;
}

/** The tuple `submitObservation` takes, with every float already gone. */
export interface ObservationCall {
  seriesId: string;
  period: number;
  odi: bigint;
  ebar: bigint;
  hcsSequence: bigint;
  sourceHash: string;
}

export interface SubmitResult {
  hash: string;
  gasUsed: string;
  open: boolean;
  openReason: number;
  claimsOpened: { reserved: string; windowEndsAt: number } | null;
  reserveToppedUp: { added: string; reserved: string } | null;
  windowExtended: { windowEndsAt: number } | null;
}

export interface Submitter {
  seriesState(seriesId: string): Promise<SeriesState>;
  hasObservation(seriesId: string, period: Period): Promise<boolean>;
  reservedOf(seriesId: string): Promise<bigint>;
  submit(input: SubmitInput): Promise<SubmitResult>;
  /** The account the calls come from, so a run header can name it. */
  sender(): string;
}

/** `2026-04` as the `uint32` YYYYMM the contract speaks. */
export function toYyyymm(period: Period): number {
  return Number(period.replace('-', ''));
}

/** The month index the contract stores, `year * 12 + month - 1`. */
export function toMonthIndex(period: Period): number {
  return periodIndex(period);
}

/**
 * Build the call payload. Kept separate from sending it so the conversion from
 * a published two-decimal number to an int64 can be tested without a chain: it
 * goes through the decimal string, never through `value * 10000`, because
 * 0.29 * 10000 is 2899.9999999999995 in a double.
 */
export function encodeObservation(input: SubmitInput): ObservationCall {
  const hash = input.sourceHash.startsWith('0x') ? input.sourceHash : `0x${input.sourceHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error(`source hash is not 32 bytes: ${input.sourceHash}`);
  }
  return {
    seriesId: input.seriesId,
    period: toYyyymm(input.period),
    odi: input.odi === null ? NULL_ODI : toScaledInt(fmt2(input.odi)),
    ebar: toScaledInt(fmt2(input.ebar)),
    hcsSequence: BigInt(input.hcsSequence),
    sourceHash: hash.toLowerCase(),
  };
}

export class CoverPoolSubmitter implements Submitter {
  private readonly wallet: Wallet;
  private readonly pool: Contract;
  private readonly vault: Contract;

  constructor(
    rpcUrl: string,
    privateKeyHex: string,
    coverPoolAddress: string,
    vaultAddress: string,
    private readonly gasLimit: number,
  ) {
    const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
    this.wallet = new Wallet(`0x${privateKeyHex.replace(/^0x/i, '')}`, provider);
    this.pool = new Contract(coverPoolAddress, COVER_POOL_ABI, this.wallet);
    this.vault = new Contract(vaultAddress, VAULT_ABI, provider);
  }

  sender(): string {
    return this.wallet.address;
  }

  async seriesState(seriesId: string): Promise<SeriesState> {
    const terms = await this.pool.seriesOf!(seriesId);
    const status = Number(terms.status);
    return {
      status,
      statusName: seriesStatusName(status),
      acceptsObservations: canAcceptObservation(status),
      activeExposure: BigInt(terms.activeExposure),
      exposureCovered: BigInt(terms.exposureCovered),
      lastObservedMonth: Number(terms.lastObservedMonth),
      windowEndsAt: Number(terms.windowEndsAt),
      attachmentShock: BigInt(terms.attachmentShock),
      levelLine: BigInt(terms.levelLine),
    };
  }

  async hasObservation(seriesId: string, period: Period): Promise<boolean> {
    const observation = await this.pool.observationOf!(seriesId, toYyyymm(period));
    return observation.present === true;
  }

  async reservedOf(seriesId: string): Promise<bigint> {
    return BigInt(await this.vault.reservedOf!(seriesId));
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const call = encodeObservation(input);
    const sent = await this.pool.submitObservation!(call, { gasLimit: this.gasLimit });
    const receipt = await sent.wait();
    if (receipt === null) throw new Error(`no receipt for ${sent.hash}`);

    let open = false;
    let openReason = 0;
    let claimsOpened: SubmitResult['claimsOpened'] = null;
    let reserveToppedUp: SubmitResult['reserveToppedUp'] = null;
    let windowExtended: SubmitResult['windowExtended'] = null;
    for (const log of receipt.logs) {
      let parsed;
      try {
        parsed = this.pool.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed === null) continue;
      if (parsed.name === 'ObservationSubmitted') {
        open = parsed.args.open as boolean;
        openReason = Number(parsed.args.openReason);
      } else if (parsed.name === 'ClaimsOpened') {
        claimsOpened = {
          reserved: String(parsed.args.reserved),
          windowEndsAt: Number(parsed.args.windowEndsAt),
        };
      } else if (parsed.name === 'ReserveToppedUp') {
        reserveToppedUp = {
          added: String(parsed.args.added),
          reserved: String(parsed.args.reserved),
        };
      } else if (parsed.name === 'WindowExtended') {
        windowExtended = { windowEndsAt: Number(parsed.args.windowEndsAt) };
      }
    }
    return {
      hash: receipt.hash,
      gasUsed: String(receipt.gasUsed),
      open,
      openReason,
      claimsOpened,
      reserveToppedUp,
      windowExtended,
    };
  }
}

/**
 * The submitter a dry run uses. It encodes the call, so the conversion and the
 * bounds are exercised, prints nothing and sends nothing.
 */
export class DryRunSubmitter implements Submitter {
  readonly calls: ObservationCall[] = [];

  constructor(private readonly state: Partial<SeriesState> = {}) {}

  sender(): string {
    return '0xdryrun';
  }

  async seriesState(): Promise<SeriesState> {
    return {
      status: 1,
      statusName: 'Active',
      acceptsObservations: true,
      activeExposure: 0n,
      exposureCovered: 0n,
      lastObservedMonth: 0,
      windowEndsAt: 0,
      attachmentShock: 20000n,
      levelLine: -6800n,
      ...this.state,
    };
  }

  async hasObservation(): Promise<boolean> {
    return false;
  }

  async reservedOf(): Promise<bigint> {
    return 0n;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const call = encodeObservation(input);
    this.calls.push(call);
    return {
      hash: `dry-run-${call.period}`,
      gasUsed: '0',
      open: false,
      openReason: 0,
      claimsOpened: null,
      reserveToppedUp: null,
      windowExtended: null,
    };
  }
}

export function transactionUrl(hash: string): string {
  return `https://hashscan.io/testnet/transaction/${hash}`;
}
