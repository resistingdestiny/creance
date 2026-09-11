import { ListRow } from './list-row';
import { SurfaceGroup } from './surface-group';
import { TextLink } from './text-link';
import type { AuditEntry } from '../lib/audit-api';
import { formatDayWithYear, formatMoney } from '../lib/format';

/**
 * What has happened on one cover, from the audit trail and nothing else.
 *
 * The receipt screen has drawn this list since T18 and the dashboard needs the
 * same list, so it was moved here rather than written twice: two screens with
 * two ideas of what a topic message is called is exactly the drift the copy
 * rules exist to stop. The naming and the captions are unchanged.
 *
 * The voice rules in docs/DESIGN-TOKENS.md section 8 apply. It says payment,
 * payout and cover, never bind, settle or nullifier. What the API calls a
 * `policy` message is "Cover started" here and what it calls a `settlement` is
 * a payment named by what it bought.
 *
 * Every entry the API could not find on the topic says so. A list that quietly
 * showed a payment as recorded when the message never arrived would be the one
 * lie these screens must not tell.
 */

export function CoverHistory({
  entries,
  limit,
}: {
  entries: readonly AuditEntry[];
  /** The dashboard shows the newest few; the receipt shows all of them. */
  limit?: number;
}) {
  const shown = limit === undefined ? entries : entries.slice(-limit).reverse();
  return (
    <SurfaceGroup>
      {shown.map((entry, index) => (
        <EntryRow entry={entry} key={`${entry.kind}-${entry.hcs?.sequence_number ?? index}`} />
      ))}
    </SurfaceGroup>
  );
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const link = entry.tx?.hashscan ?? entry.hcs?.hashscan ?? null;
  return (
    <ListRow
      caption={entryCaption(entry)}
      label={entryTitle(entry)}
      value={
        <span className="flex items-center gap-3">
          {entry.amount === null
            ? null
            : formatMoney(BigInt(entry.amount.amount), entry.amount.decimals)}
          {/* The link is four words and never breaks across two lines: at the
              column's narrowest it used to wrap to "View on / HashScan" beside
              a wrapped caption, which made one row look like two. The label
              beside it has the room to wrap instead. */}
          {link === null ? null : (
            <TextLink
              className="shrink-0 whitespace-nowrap"
              href={link}
              rel="noreferrer"
              target="_blank"
            >
              View on HashScan
            </TextLink>
          )}
        </span>
      }
    />
  );
}

/** What each entry is called in the product's words, not the API's. */
export function entryTitle(entry: AuditEntry): string {
  switch (entry.kind) {
    case 'policy':
      return entry.detail['status'] === 'binding' ? 'Cover requested' : 'Cover started';
    case 'settlement':
      return endpointTitle(String(entry.detail['endpoint'] ?? ''));
    case 'premium':
      return 'Monthly payment';
    case 'payout':
      return 'Payout';
    case 'coupon':
      return 'Coupon';
    case 'claim_packet':
      return 'Claim sent';
    case 'claim_decision':
      return 'Claim decision';
    default:
      return 'Entry';
  }
}

function endpointTitle(endpoint: string): string {
  if (endpoint.includes('/v1/bind')) return 'First payment';
  if (endpoint.includes('/v1/quote')) return 'Price quote';
  if (endpoint.includes('/v1/index')) return 'Index reading';
  return 'Payment';
}

/** The date, and whether Hedera has it. Dates are en-GB in UTC, per T10. */
export function entryCaption(entry: AuditEntry): string {
  const at = entry.hcs?.consensus_at ?? entry.at;
  const day = at === null ? null : formatDayWithYear(at.slice(0, 10));
  const state =
    entry.source === 'topic'
      ? 'Recorded on Hedera'
      : entry.source === 'awaiting_mirror'
        ? 'Recording on Hedera'
        : entry.source === 'mirror_unavailable'
          ? 'Cannot reach Hedera'
          : 'Not recorded yet';
  return day === null ? state : `${day} · ${state}`;
}
