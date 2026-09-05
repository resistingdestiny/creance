import type { Metadata } from 'next';

import { DesktopFrame } from '../../../components/desktop-frame';
import {
  fetchAdminClaim,
  fetchAdminQueue,
  hasAdminToken,
  type AdminClaimDetail,
  type AdminClaimSummary,
} from '../../../lib/admin-api';
import { reportUnreachable } from '../../../lib/api';
import { isReviewer } from '../../../lib/reviewer-session';
import { ReviewQueue, type QueueRow } from './review-queue';
import { ReviewerSignIn } from './sign-in';

/**
 * The review queue, docs/DESIGN-TOKENS-ADDENDUM.md, "Admin review queue".
 *
 * Internal, desktop, and not part of the consumer design language review: it
 * just has to be legible. It is the human half of adjudication, and the
 * addendum's own column list is what it shows, so a reviewer decides from the
 * statement, the fingerprints and the Adjuster's reasons rather than from a
 * claim id.
 *
 * Two requests per row, deliberately. The queue endpoint carries nothing about
 * a person, which is what makes it safe to read over somebody's shoulder, and
 * the columns the addendum asks for are on the detail endpoint. A queue of
 * twenty is twenty small reads on an internal screen, and the alternative is a
 * list endpoint that carries every claimant's employer.
 *
 * The token is a private server variable and the reads happen here, on the
 * server, so it never reaches the browser. Holding it is not the same as being
 * entitled to it: this page is served only to a request that carries a reviewer
 * session, and without one it is the sign in screen and nothing else. See
 * src/lib/reviewer-session.ts, and docs/DECISIONS.md, "A reviewer proves who
 * they are before the server spends its own admin token".
 */

export const metadata: Metadata = { title: 'Review queue' };

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status = 'under_review' } = await searchParams;
  if (!hasAdminToken()) return <NoToken />;
  // Before any read, and before the page names a single claim: the server's
  // token is not the visitor's authority to spend it.
  if (!(await isReviewer())) return <ReviewerSignIn />;

  try {
    const queue = await fetchAdminQueue(status);
    const rows = await Promise.all(queue.claims.map(rowFor));
    return <ReviewQueue rows={rows} status={status} />;
  } catch (cause) {
    reportUnreachable('the review queue', cause);
    return <Unreachable />;
  }
}

async function rowFor(summary: AdminClaimSummary): Promise<QueueRow> {
  let detail: AdminClaimDetail | null = null;
  try {
    detail = await fetchAdminClaim(summary.claim_id);
  } catch {
    // A row whose detail cannot be read still belongs in the queue. It shows
    // what the summary knows and offers no decision, because deciding from a
    // claim id alone is exactly what this screen exists to prevent.
  }
  return {
    claimId: summary.claim_id,
    policyId: summary.policy_id,
    status: summary.status,
    submittedAt: summary.submitted_at,
    decision: summary.decision,
    confidence: summary.confidence,
    reasons: [...summary.reasons],
    overdue: summary.overdue,
    group: detail?.attestation.group ?? null,
    lastDayOfWork: detail?.attestation.last_day_of_work ?? null,
    separationType: detail?.attestation.separation_type ?? null,
    employer: detail?.attestation.employer_name ?? null,
    evidence: (detail?.evidence ?? []).map((file) => file.sha256),
    // Several codes can compose the same sentence, and a reviewer reading
    // "Someone will look at your claim" twice learns nothing the second time.
    reasonLines: [...new Set((detail?.reason_lines ?? []).map((entry) => entry.line))],
    decidable: detail !== null,
  };
}

function NoToken() {
  return (
    <Frame>
      <h1 className="text-title font-display font-semibold tracking-title text-ink">
        Review queue
      </h1>
      <p className="text-body text-ink-2">
        This deployment holds no admin token, so it cannot read the queue. Set ADMIN_TOKEN in the
        environment file and restart the web server.
      </p>
    </Frame>
  );
}

function Unreachable() {
  return (
    <Frame>
      <h1 className="text-title font-display font-semibold tracking-title text-ink">
        Review queue
      </h1>
      <p className="text-body text-ink-2">
        The queue comes from the API. Start it with pnpm api:dev, then reload.
      </p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <DesktopFrame>
      <div className="flex flex-col gap-4">{children}</div>
    </DesktopFrame>
  );
}
