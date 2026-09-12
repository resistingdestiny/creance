/**
 * What one line of the activity page is, and how each of the seven places this
 * product writes to Hedera is turned into that one line.
 *
 * The page exists because everything this product does happens on testnet and
 * none of it is visible from the outside. A reader could open the index and see
 * a month, or open a cover and see a receipt, but there was nowhere to stand and
 * watch the thing run. This module is the part of that page that decides what
 * happened, in words; src/lib/activity-data.ts is the part that reads it.
 *
 * Two kinds of record, one kind of line. A topic message and a contract call are
 * completely different objects: one is bytes on a consensus topic, the other is
 * a function call with a selector and a gas bill. A reader should not have to
 * know which is which, and on this page they do not: both become an entry with a
 * time, a sentence saying what happened, an amount where there is one, and a
 * link to the transaction that carries it. The distinction survives only in the
 * "Where" column, which names the topic or the contract it came off.
 *
 * Nothing here writes a figure of its own. Every sentence is composed from
 * fields the mirror node returned, every amount is the amount the record
 * carries, and a record whose fields cannot be read renders as the little that
 * can be: the codebase rule is that an unreadable value is not rendered, not
 * that it is guessed at.
 *
 * The message parser is @creance/client's, the same one apps/api uses to serve
 * GET /v1/audit/:policyId, so a coupon means the same thing on this page as it
 * does in the audit trail and the two cannot drift.
 */

import { auditFacts, parseTopicMessage, type TopicAuditMessage } from '@creance/client/src/audit';
import { decodeMessage, type MirrorTopicMessage } from '@creance/client/src/hedera/mirror';

import { formatIndexValue, formatMoney, formatPeriod } from './format';
import { OCCUPATIONS } from './occupations';

/**
 * The settlement token, from docs/hedera.testnet.json.
 *
 * Its scale is here because two of the message kinds name the token without
 * naming its scale: a `coupon` carries `token` and no `decimals`, and so does a
 * `policy` binding. An amount printed at the wrong scale is a thousand times
 * wrong, so the scale is applied only when the message names this exact token
 * and the amount is left off the line otherwise.
 * test/activity-model.test.ts holds this against the resources file.
 */
export const SETTLEMENT_TOKEN = { id: '0.0.10366463', decimals: 6 } as const;

export type ActivitySourceKey =
  | 'payments'
  | 'claims'
  | 'index'
  | 'journal'
  | 'cover'
  | 'capital'
  | 'market';

export interface ActivitySource {
  readonly key: ActivitySourceKey;
  /** The word in the "Where" column and on the filter. */
  readonly label: string;
  readonly kind: 'topic' | 'contract';
  /** The Hedera id, which is also what the provenance block prints. */
  readonly id: string;
  /** What this place is, in one clause, for the provenance block. */
  readonly what: string;
}

/**
 * The seven places, and the whole of what this page reads.
 *
 * The four topics and the three contracts this product writes to are all here.
 * Two things that are on chain are deliberately not.
 *
 * The settlement token's own transfers are not a source. Every movement of it
 * is already a line on this page in the product's own words, as a settlement, a
 * premium, a coupon or a payout, so a transfer feed beside them would print the
 * same event twice: once as a sentence and once as a ledger entry.
 *
 * The note contracts are not a source either. They are unmodified contracts the
 * ATS team deployed and this repository holds no interface for their facets, so
 * a call to one could be rendered as a four byte selector and nothing else,
 * which is not a sentence. What the notes do reads here in words anyway: their
 * coupons on the payments topic and their trades on the market.
 *
 * The ids are the deployment record's, contracts/deployments/testnet.json and
 * docs/hedera.testnet.json, and test/activity-model.test.ts reads both files and
 * holds every id here against them, so this list cannot drift from the
 * deployment it claims to be showing.
 */
export const ACTIVITY_SOURCES: readonly ActivitySource[] = [
  {
    key: 'payments',
    label: 'Payments',
    kind: 'topic',
    id: '0.0.10366471',
    what: 'every paid call, premium, coupon and payout',
  },
  {
    key: 'claims',
    label: 'Claims',
    kind: 'topic',
    id: '0.0.10366473',
    what: 'claims filed and the decisions on them',
  },
  {
    key: 'index',
    label: 'Index',
    kind: 'topic',
    id: '0.0.10366470',
    what: 'each month of the index as it is published',
  },
  {
    key: 'journal',
    label: 'Agent',
    kind: 'topic',
    id: '0.0.10366475',
    what: "the agent's own record of what it decided and why",
  },
  {
    key: 'cover',
    label: 'Cover',
    kind: 'contract',
    id: '0.0.10367199',
    what: 'cover bound, months submitted, claims paid',
  },
  {
    key: 'capital',
    label: 'Capital',
    kind: 'contract',
    id: '0.0.10367194',
    what: 'money subscribed, reserved, released and redeemed',
  },
  {
    key: 'market',
    label: 'Market',
    kind: 'contract',
    id: '0.0.10495570',
    what: 'notes offered and sold between holders',
  },
];

export function activitySource(key: ActivitySourceKey): ActivitySource {
  const found = ACTIVITY_SOURCES.find((source) => source.key === key);
  // Every key in the type is in the list, and the test holds that.
  if (found === undefined) throw new RangeError(`no activity source ${key}`);
  return found;
}

/** A query string value, when it names one of the seven. Anything else is all of them. */
export function activityFilter(value: string | undefined): ActivitySourceKey | null {
  const found = ACTIVITY_SOURCES.find((source) => source.key === value);
  return found?.key ?? null;
}

/**
 * A paging cursor, when it is one.
 *
 * It is a mirror node consensus timestamp and it arrives off a query string, so
 * it is checked against the shape the mirror node uses rather than passed
 * through. Anything else is the newest page, which is the right way to be wrong.
 */
export function activityCursor(value: string | undefined): string | null {
  return value !== undefined && /^\d{1,12}\.\d{1,9}$/.test(value) ? value : null;
}

export interface ActivityEntry {
  /** Stable across renders: the source and the record's own place in it. */
  readonly key: string;
  readonly source: ActivitySourceKey;
  /** The consensus instant, as an ISO string. */
  readonly at: string;
  /** The mirror node's own timestamp, which is also the paging cursor. */
  readonly consensus: string;
  /** What happened, in a sentence. */
  readonly title: string;
  /** The one fact that tells this line apart from the one above it, or nothing. */
  readonly detail: string | null;
  /** The amount that moved, already formatted, where the record carries one. */
  readonly amount: string | null;
  /** The chain refused the call. The line still renders, because it is evidence. */
  readonly refused: boolean;
  /** The transaction on HashScan. Null only when the record names no transaction. */
  readonly href: string | null;
}

/** A contract call as the mirror node returns it. Only the fields this page reads. */
export interface MirrorContractResult {
  readonly timestamp: string;
  readonly hash: string;
  readonly function_parameters?: string | null;
  readonly error_message?: string | null;
}

export function hashscanTransactionUrl(transaction: string): string {
  return `https://hashscan.io/testnet/transaction/${transaction}`;
}

export function hashscanSourceUrl(source: ActivitySource): string {
  return `https://hashscan.io/testnet/${source.kind}/${source.id}`;
}

/**
 * A consensus timestamp to an instant.
 *
 * The mirror node counts seconds and nanoseconds since the epoch; JavaScript
 * counts milliseconds, so the nanoseconds are truncated rather than rounded. A
 * time on this page is therefore never later than the time consensus gave it.
 */
export function instantOf(consensus: string): string {
  const [seconds = '0', nanos = ''] = consensus.split('.');
  const millis = Number(seconds) * 1000 + Math.floor(Number(nanos.padEnd(9, '0')) / 1e6);
  return new Date(millis).toISOString();
}

/**
 * The transaction a topic message was submitted in.
 *
 * HashScan has no page for a topic message on its own: the topic page lists
 * them and each one has the transaction that carried it, which is the record
 * with the consensus time, the payer and the payload on it. So a message links
 * to its own submit transaction, which is the form docs/HEDERA.md already uses
 * whenever it cites a sequence number.
 *
 * A message the mirror node returns without chunk information names no
 * transaction, and then there is no link rather than a guessed one.
 */
export function submitTransactionOf(message: MirrorTopicMessage): string | null {
  const chunk = (message as { chunk_info?: { initial_transaction_id?: unknown } }).chunk_info;
  const id = chunk?.initial_transaction_id;
  if (typeof id !== 'object' || id === null) return null;
  const { account_id: account, transaction_valid_start: start } = id as Record<string, unknown>;
  if (typeof account !== 'string' || typeof start !== 'string') return null;
  const [seconds, nanos] = start.split('.');
  if (seconds === undefined || nanos === undefined) return null;
  return `${account}-${seconds}-${nanos}`;
}

/** The occupation group's on-screen name, or the key when it is not one of the fifteen. */
function occupationLabel(group: unknown): string | null {
  if (typeof group !== 'string' || group === '') return null;
  return OCCUPATIONS.find((entry) => entry.key === group)?.label.toLowerCase() ?? group;
}

/**
 * An amount, at the scale the record gives it.
 *
 * A record that names a scale is formatted at that scale. A record that names
 * only the settlement token is formatted at the settlement token's scale, which
 * is the one scale in this deployment that is a recorded fact rather than a
 * guess. Anything else carries no amount, because a figure at an unknown scale
 * is not a figure.
 */
function amountOf(facts: ReturnType<typeof auditFacts>): string | null {
  const money = facts.amount;
  if (money === null) return null;
  let value: bigint;
  try {
    value = BigInt(money.amount);
  } catch {
    return null;
  }
  if (money.decimals !== null) return formatMoney(value, money.decimals);
  if (money.asset === SETTLEMENT_TOKEN.id) return formatMoney(value, SETTLEMENT_TOKEN.decimals);
  return null;
}

/** "202605" to "May 2026". A premium message counts its month as a number. */
function periodOf(period: number): string | null {
  const text = String(period);
  if (!/^\d{6}$/.test(text)) return null;
  try {
    return formatPeriod(`${text.slice(0, 4)}-${text.slice(4)}`);
  } catch {
    return null;
  }
}

/**
 * What a paid call was for.
 *
 * The three gated endpoints are the three things an agent can buy here, and
 * saying which one in the sentence is the difference between a page a judge can
 * read and a page of identical rows. An endpoint this does not recognise is
 * described by its own path rather than by a word this file made up.
 */
function settlementTitle(endpoint: string): string {
  if (/\/v1\/index/.test(endpoint)) return 'An agent paid to read the index';
  if (/\/v1\/quote/.test(endpoint)) return 'An agent paid for a price';
  if (/\/v1\/bind/.test(endpoint)) return 'An agent paid to start cover';
  return 'An agent paid for a call';
}

interface Said {
  readonly title: string;
  readonly detail: string | null;
}

/** What a parsed topic message says, in words. */
function saidBy(message: TopicAuditMessage): Said {
  switch (message.kind) {
    case 'settlement':
      return { title: settlementTitle(message.endpoint), detail: message.endpoint };
    case 'premium':
      return {
        title: 'A monthly premium was collected',
        detail: periodOf(message.period) ?? message.policy,
      };
    case 'coupon':
      return { title: 'A coupon was paid to a noteholder', detail: message.series };
    case 'payout':
      return { title: 'A claim was paid', detail: message.claimId };
    case 'policy':
      return message.status === 'binding'
        ? { title: 'Cover was priced and sent to the chain', detail: message.policy }
        : message.status === 'bound'
          ? { title: 'Cover started', detail: message.policy }
          : { title: 'Cover did not start', detail: message.reason ?? message.policy };
    case 'claim_packet':
      return { title: 'A claim was filed, with its evidence hashed', detail: message.claimId };
    case 'claim_decision':
      return {
        title:
          message.decision === 'approve'
            ? 'A claim was approved'
            : message.decision === 'decline'
              ? 'A claim was declined'
              : 'A claim was sent for review',
        detail: message.claimId,
      };
    default:
      return saidByUnknown(message.declaredKind, message.fields);
  }
}

/**
 * The two message shapes the shared parser does not know, and everything else.
 *
 * The index topic carries observations, which have no `kind` at all because
 * they predate the audit message convention, and the journal carries the
 * agent's own records under a kind the audit reader has no interest in. Both are
 * read here from their own fields, and anything else says only that a record was
 * written, which is true and is all that is known about it.
 */
function saidByUnknown(declared: string | null, fields: Record<string, unknown>): Said {
  const group = occupationLabel(fields['group']);
  const period = fields['period'];

  if (declared === null && typeof period === 'string' && group !== null) {
    const reading = typeof fields['odi'] === 'number' ? formatIndexValue(fields['odi']) : null;
    let month: string;
    try {
      month = formatPeriod(period);
    } catch {
      month = period;
    }
    return {
      title: `The index published ${month} for ${group}`,
      detail:
        reading === null
          ? null
          : fields['open'] === true
            ? `Reading ${reading}, claims open`
            : `Reading ${reading}, no claims`,
    };
  }

  if (declared === 'journal') {
    const principal = fields['principal'];
    const who =
      typeof principal === 'object' && principal !== null
        ? occupationLabel((principal as Record<string, unknown>)['group'])
        : null;
    const rule = fields['rule'];
    const decision =
      typeof rule === 'object' && rule !== null
        ? (rule as Record<string, unknown>)['decision']
        : null;
    return {
      title: who === null ? 'The agent reviewed its cover' : `The agent reviewed cover for ${who}`,
      detail:
        decision === 'buy'
          ? 'It decided to buy'
          : decision === 'hold'
            ? 'It decided to hold'
            : null,
    };
  }

  return { title: 'A record was written', detail: declared };
}

/** One topic message, as a line. */
export function topicEntry(
  source: ActivitySource,
  message: MirrorTopicMessage,
): ActivityEntry {
  const parsed = parseTopicMessage(decodeMessage(message));
  const said = saidBy(parsed);
  const transaction = submitTransactionOf(message);
  return {
    key: `${source.key}-${String(message.sequence_number)}`,
    source: source.key,
    at: instantOf(message.consensus_timestamp),
    consensus: message.consensus_timestamp,
    title: said.title,
    detail: said.detail,
    amount: amountOf(auditFacts(parsed)),
    refused: false,
    href: transaction === null ? null : hashscanTransactionUrl(transaction),
  };
}

/**
 * What each contract call does, by its four byte selector.
 *
 * The selectors are the compiled ones of the three contracts in
 * contracts/contracts, each written beside the signature it came from so that a
 * reader can check one without a compiler. They are constants here rather than
 * decoded from an interface at request time because this page never decodes an
 * argument: it needs the verb and nothing else, and shipping three ABIs to say
 * "notes changed hands" would be a hundred kilobytes for one sentence.
 *
 * Only the calls this product actually makes are named. The administrative ones
 * a deployment makes once, and anything an upgrade adds later, fall through to
 * the general sentence, which says a call was made and links to it: that is less
 * than the others say and it is still true, which is the trade this codebase
 * makes everywhere. A signature that changes therefore loses its sentence and
 * lands in the general case, which is the safe direction to be wrong in: the
 * line is still there and still links to the record.
 */
export const ACTIVITY_CALLS: Record<string, string> = {
  // CoverPool, 0.0.10367199
  '0x0c4c100d': 'Cover was bound on chain', // bind
  '0x39cba198': 'A claim payout was released', // payClaim
  '0x3e84c588': 'A month of the index was submitted to the pool', // submitObservation
  '0x902363f4': 'A new series was registered', // registerSeries
  '0xa51aec49': 'A claim window was closed', // closeWindow
  '0x02fde518': 'A premium was recorded against cover', // recordPremium
  '0x62f3d075': 'The status of a series was changed', // setSeriesStatus
  '0x77c2498f': 'Cover lapsed for unpaid premium', // lapse
  '0xc6441798': 'Cover reached the end of its term', // expire
  // CollateralVault, 0.0.10367194
  '0x8d744dcd': 'An investor put money behind an occupation', // subscribe
  '0xe9d67ee3': 'A premium was credited to the money behind a series', // attributePremium
  '0x426c1d51': 'A coupon was funded', // fundCoupon
  '0x7137fd78': 'A claim was paid out of the vault', // payClaim
  '0xe7168ef1': 'Money was held back against an open month', // reserve
  '0x66afd8ef': 'Money held back was released', // release
  '0x12ed5cef': 'A note was redeemed at the end of its term', // redeemAtMaturity
  '0x41c07c59': 'A series was opened for subscription', // openSeries
  '0x79b11998': 'Unattributed premium was credited', // attributeAllUnaccounted
  '0x01a843b0': 'The vault took on the settlement token', // associateSettlementToken
  // NoteMarket, 0.0.10495570
  '0x74a46050': 'Notes were offered for sale', // offer
  '0x3fda5389': 'Notes changed hands', // fill
  '0x40e58ee5': 'An offer was withdrawn', // cancel
};

/** One contract call, as a line. */
export function contractEntry(
  source: ActivitySource,
  result: MirrorContractResult,
): ActivityEntry {
  const selector = (result.function_parameters ?? '').slice(0, 10).toLowerCase();
  const refused = typeof result.error_message === 'string' && result.error_message !== '';
  const said = ACTIVITY_CALLS[selector] ?? `Something was called on ${source.label.toLowerCase()}`;
  return {
    key: `${source.key}-${result.timestamp}`,
    source: source.key,
    at: instantOf(result.timestamp),
    consensus: result.timestamp,
    title: said,
    detail: refused ? 'The chain refused it' : null,
    amount: null,
    refused,
    href: hashscanTransactionUrl(result.hash),
  };
}

/**
 * Every source's lines as one stream, newest first, with no one place allowed to
 * fill the page.
 *
 * The consensus timestamp is a decimal count of seconds and it is compared as a
 * string only where the two have the same shape, so it is compared as a number
 * pair instead: seconds first, nanoseconds second. Two records cannot share a
 * consensus timestamp, so the order is total.
 *
 * The cap is the one thing on this page that is not simply "newest first", and
 * it is here because without it the page is useless. The payments topic carries
 * a settlement for every metered call this product makes, including the fifteen
 * the index explorer buys for itself every few minutes, so a straight newest
 * fifty is fifty lines of the same sentence and a reader learns nothing from it.
 * With the cap the same page carries the newest payments beside the months the
 * index published, the claims decided, the cover bound and the notes traded,
 * which is what somebody opening this page came to see.
 *
 * Nothing is invented by capping and nothing is hidden: the lines shown are real
 * and still in time order, the page says that a busy place is capped, and the
 * filter shows any one place with nothing left out.
 */
export function mergeActivity(
  lists: readonly (readonly ActivityEntry[])[],
  limit: number,
  perSource: number = limit,
): readonly ActivityEntry[] {
  const sorted = lists
    .flat()
    .sort((left, right) => compareConsensus(right.consensus, left.consensus));

  const taken = new Map<ActivitySourceKey, number>();
  const page: ActivityEntry[] = [];
  for (const entry of sorted) {
    if (page.length >= limit) break;
    const already = taken.get(entry.source) ?? 0;
    if (already >= perSource) continue;
    taken.set(entry.source, already + 1);
    page.push(entry);
  }
  return page;
}

function compareConsensus(left: string, right: string): number {
  const [leftSeconds = '0', leftNanos = ''] = left.split('.');
  const [rightSeconds = '0', rightNanos = ''] = right.split('.');
  if (leftSeconds !== rightSeconds) return Number(leftSeconds) - Number(rightSeconds);
  return Number(leftNanos.padEnd(9, '0')) - Number(rightNanos.padEnd(9, '0'));
}
