import { CopyButton } from '../../../components/copy-button';
import { ListRow } from '../../../components/list-row';
import { StatusPill } from '../../../components/status-pill';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import { AppFrame } from '../../../components/app-frame';
import { formatDayWithYear, formatMoney, shortenAddress } from '../../../lib/format';
import type { AuditEntry, AuditTrail } from '../../../lib/audit-api';

/**
 * The receipt.
 *
 * docs/DESIGN-TOKENS.md section 8 has "View receipt" on the paid state and no
 * receipt screen behind it, so this is built from the components the sheet
 * already specifies: a surface group of list rows inside the 390 frame, with a
 * link out to HashScan on every entry that has one. The copy chosen here is
 * recorded in docs/DECISIONS.md.
 *
 * The voice rules in section 8 apply: it says payment, payout and receipt, and
 * never bind, settle or nullifier. What the API calls a `policy` message is
 * "Cover started" here, and what it calls a `settlement` is a payment named by
 * what it bought.
 *
 * Every entry the API could not find on the topic says so. A receipt that
 * quietly showed a payment as recorded when the message never arrived would be
 * the one lie this screen must not tell.
 */

export function ReceiptScreen({ trail }: { trail: AuditTrail }) {
  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col gap-6 px-5 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-headline font-display font-semibold tracking-headline text-ink">
            Receipt
          </h1>
          <p className="text-body-lg text-ink-2">
            Every payment on this cover, written to Hedera as it happened.
          </p>
        </header>

        <SurfaceGroup>
          <ListRow label="Cover" value={<StatusPill state={pillState(trail.status)}>{coverLabel(trail.status)}</StatusPill>} />
          <ListRow
            label="Reference"
            value={
              <span className="flex items-center gap-1">
                {shortenAddress(trail.policy_id)}
                <CopyButton value={trail.policy_id} what="reference" />
              </span>
            }
          />
          {trail.summary.policy_nft.hashscan === null ? null : (
            <ListRow
              label="Cover receipt"
              value={
                <TextLink
                  href={trail.summary.policy_nft.hashscan}
                  rel="noreferrer"
                  target="_blank"
                >
                  View on HashScan
                </TextLink>
              }
            />
          )}
        </SurfaceGroup>

        <section className="flex flex-col gap-3">
          <h2 className="text-secondary text-ink-2">Payments</h2>
          <SurfaceGroup>
            {trail.entries.map((entry, index) => (
              <EntryRow entry={entry} key={`${entry.kind}-${entry.hcs?.sequence_number ?? index}`} />
            ))}
          </SurfaceGroup>
        </section>

        {trail.summary.payments_topic === null ? null : (
          <TextLink
            href={trail.summary.payments_topic.hashscan}
            rel="noreferrer"
            target="_blank"
          >
            View every payment on HashScan
          </TextLink>
        )}
      </main>
    </AppFrame>
  );
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const link = entry.tx?.hashscan ?? entry.hcs?.hashscan ?? null;
  return (
    <ListRow
      caption={caption(entry)}
      label={title(entry)}
      value={
        <span className="flex items-center gap-3">
          {entry.amount === null
            ? null
            : formatMoney(BigInt(entry.amount.amount), entry.amount.decimals)}
          {link === null ? null : (
            <TextLink href={link} rel="noreferrer" target="_blank">
              View on HashScan
            </TextLink>
          )}
        </span>
      }
    />
  );
}

/** What each entry is called in the product's words, not the API's. */
export function title(entry: AuditEntry): string {
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
export function caption(entry: AuditEntry): string {
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

function coverLabel(status: string): string {
  if (status === 'paid') return 'Paid out';
  if (status === 'lapsed' || status === 'expired' || status === 'void') return 'Cover ended';
  if (status === 'payment_failed') return 'Payment due';
  return 'Covered';
}

function pillState(status: string): 'covered' | 'watch' | 'triggered' | 'none' {
  if (status === 'paid') return 'triggered';
  if (status === 'payment_failed' || status === 'claims_open') return 'watch';
  if (status === 'lapsed' || status === 'expired' || status === 'void') return 'none';
  return 'covered';
}
