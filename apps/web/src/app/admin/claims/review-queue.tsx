'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { BottomSheet } from '../../../components/bottom-sheet';
import { DesktopFrame } from '../../../components/desktop-frame';
import { PillButton } from '../../../components/pill-button';
import { claimDay, claimReference, separationLabel } from '../../../lib/claim-model';
import { shortenAddress } from '../../../lib/format';
import { occupationLabel } from '../../../lib/occupations';
import { decide } from './actions';

/**
 * The queue, as a plain table: reference, cover, occupation, last day of work,
 * how it ended, the evidence fingerprints, the Adjuster's reasons, the
 * confidence, and the two buttons.
 *
 * An overdue claim is flagged and sorted to the top, and that is all a deadline
 * ever does here: a timeout never decides a claim, in either direction
 * (docs/CLAIMS.md, "A timeout never decides a claim").
 *
 * Declining opens a sheet that asks for one plain sentence, because that
 * sentence is what the person reads on C9, and a decline with nothing to read
 * is a decision nobody can act on.
 *
 * The table is written out rather than built with the DataTable component: this
 * one has nine columns, two of which are a button pair and a wrapped list of
 * fingerprints, and squeezing that through a cells array would make both harder
 * to read.
 */

export interface QueueRow {
  claimId: string;
  policyId: string;
  status: string;
  submittedAt: string | null;
  decision: string | null;
  confidence: string | null;
  reasons: string[];
  overdue: boolean;
  group: string | null;
  lastDayOfWork: string | null;
  separationType: string | null;
  employer: string | null;
  evidence: string[];
  reasonLines: string[];
  /** False when the detail could not be read, so no decision is offered. */
  decidable: boolean;
}

export function ReviewQueue({ rows, status }: { rows: readonly QueueRow[]; status: string }) {
  const router = useRouter();
  const [declining, setDeclining] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const sorted = [...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue));

  const run = (row: QueueRow, decision: 'approve' | 'decline', sentence: string) => {
    startTransition(async () => {
      const result = await decide(row.claimId, decision, sentence);
      setNotes((held) => ({ ...held, [row.claimId]: result.message }));
      if (result.ok) {
        setDeclining(null);
        setReason('');
        router.refresh();
      }
    });
  };

  return (
    <DesktopFrame>
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            Review queue
          </h1>
          <p className="text-secondary text-ink-2">
            {rows.length} {rows.length === 1 ? 'claim' : 'claims'}, {status.replace('_', ' ')}
          </p>
        </div>

        <table className="w-full border-collapse text-body">
          <caption className="sr-only">Claims waiting for a person</caption>
          <thead>
            <tr className="border-b border-hairline">
              {[
                'Reference',
                'Cover',
                'Occupation',
                'Last day of work',
                'How it ended',
                'Evidence',
                'Reasons',
                'Confidence',
                'Decision',
              ].map((column) => (
                <th
                  className="h-10 px-3 first:pl-0 last:pr-0 text-left text-secondary font-normal text-ink-2"
                  key={column}
                  scope="col"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr className="border-b border-hairline align-top" key={row.claimId}>
                <td className="px-3 py-4 first:pl-0">
                  <span className="tabular-nums text-ink">{claimReference(row.claimId)}</span>
                  {row.overdue ? (
                    <span className="ml-2 text-caption text-triggered">Overdue</span>
                  ) : null}
                  {row.submittedAt === null ? null : (
                    <span className="block text-caption tabular-nums text-ink-2">
                      {claimDay(row.submittedAt)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-4 tabular-nums text-ink-2">
                  {shortenAddress(row.policyId.replace('pol_', ''))}
                </td>
                <td className="px-3 py-4 text-ink">
                  {row.group === null ? '' : occupationLabel(row.group)}
                  {row.employer === null ? null : (
                    <span className="block text-caption text-ink-2">{row.employer}</span>
                  )}
                </td>
                <td className="px-3 py-4 tabular-nums text-ink">
                  {row.lastDayOfWork === null ? '' : claimDay(row.lastDayOfWork)}
                </td>
                <td className="px-3 py-4 text-ink">{separationLabel(row.separationType)}</td>
                <td className="px-3 py-4">
                  <ul className="flex flex-col gap-1">
                    {row.evidence.map((sha) => (
                      <li className="text-caption tabular-nums text-ink-2" key={sha}>
                        {shortenAddress(sha.replace('sha256:', ''))}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-4">
                  <ul className="flex max-w-[280px] flex-col gap-1">
                    {(row.reasonLines.length > 0 ? row.reasonLines : row.reasons).map((line) => (
                      <li className="text-caption text-ink-2" key={line}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-4 tabular-nums text-ink">{row.confidence ?? ''}</td>
                <td className="px-3 py-4 last:pr-0">
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <PillButton
                        className="min-h-11 px-4 text-secondary"
                        disabled={!row.decidable}
                        loading={pending}
                        onClick={() => run(row, 'approve', '')}
                      >
                        Approve
                      </PillButton>
                      <PillButton
                        className="min-h-11 px-4 text-secondary"
                        disabled={!row.decidable}
                        onClick={() => {
                          setReason('');
                          setDeclining(row);
                        }}
                        variant="secondary"
                      >
                        Decline
                      </PillButton>
                    </div>
                    {notes[row.claimId] === undefined ? null : (
                      <p className="max-w-[240px] text-caption text-ink-2" role="status">
                        {notes[row.claimId]}
                      </p>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <p className="text-body text-ink-2">Nothing is waiting for a person.</p>
        ) : null}
      </div>

      <BottomSheet
        onClose={() => setDeclining(null)}
        open={declining !== null}
        title="Why can't this claim be paid?"
      >
        <div className="flex flex-col gap-4">
          <p className="text-secondary text-ink-2">
            One plain sentence. It is what the person reads, so it says what happened and what
            they can do next.
          </p>
          <textarea
            className="min-h-[104px] rounded-field border border-hairline bg-canvas p-4 text-body text-ink"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
          <PillButton
            disabled={reason.trim() === ''}
            loading={pending}
            onClick={() => {
              if (declining !== null) run(declining, 'decline', reason);
            }}
          >
            Decline
          </PillButton>
        </div>
      </BottomSheet>
    </DesktopFrame>
  );
}
