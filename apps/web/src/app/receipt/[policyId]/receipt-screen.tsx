import { CopyButton } from '../../../components/copy-button';
import { CoverHistory, entryCaption, entryTitle } from '../../../components/cover-history';
import { ListRow } from '../../../components/list-row';
import { StatusPill } from '../../../components/status-pill';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import { AppFrame } from '../../../components/app-frame';
import { shortenAddress } from '../../../lib/format';
import type { AuditTrail } from '../../../lib/audit-api';

/**
 * The list of entries is src/components/cover-history.tsx, shared with the
 * dashboard since T41 so the two screens cannot name a topic message
 * differently. `title` and `caption` are re-exported here because they are this
 * screen's contract with its own tests.
 */
export { entryCaption as caption, entryTitle as title };

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
          <CoverHistory entries={trail.entries} />
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
