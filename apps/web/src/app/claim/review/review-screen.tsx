'use client';

import { useState, useTransition } from 'react';

import { AppFrame } from '../../../components/app-frame';
import { CheckboxRow } from '../../../components/checkbox-row';
import { ListRow } from '../../../components/list-row';
import { PillButton } from '../../../components/pill-button';
import { SurfaceGroup } from '../../../components/surface-group';
import { TextLink } from '../../../components/text-link';
import { submitPacket } from '../../claim-actions';
import { ClaimSteps } from '../claim-steps';

/**
 * C5, Review and submit. The surface group, the checkbox row and the primary,
 * from docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * The last of the four steps, and the step bar above the heading is what says
 * so. See src/app/claim/claim-steps.tsx.
 *
 * The sentence beside the checkbox is the last line of the message the wallet
 * signs, byte for byte (packages/client/src/claim.ts). Ticking the box and
 * signing the attestation are one action here, which is why the button is
 * disabled until it is ticked: the API stores `statement_accepted` and
 * `signature_verified` as two different facts, and a signature that nobody
 * agreed to would make one of them a lie.
 */

/** The one string this screen shares with the signed message. Never reworded. */
const STATEMENT = 'Everything here is true. I understand that a false claim is fraud.';

export function ReviewScreen({
  employer,
  jobTitle,
  lastDayOfWork,
  separation,
  files,
  payout,
}: {
  employer: string;
  jobTitle: string;
  lastDayOfWork: string;
  separation: string;
  files: number;
  payout: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitPacket();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <AppFrame>
      <main className="flex min-h-frame flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4">
            <ClaimSteps current={4} />
            <h1 className="text-title font-display font-semibold tracking-title text-ink">
              Review your claim
            </h1>
          </header>

          <SurfaceGroup>
            <ListRow label="Employer" value={employer} />
            <ListRow label="Job title" value={jobTitle} />
            <ListRow
              label="Last day of work"
              value={<span className="tabular-nums">{lastDayOfWork}</span>}
            />
            <ListRow label="How it ended" value={separation} />
            <ListRow label="Proof" value={`${files} ${files === 1 ? 'file' : 'files'}`} />
            <ListRow
              label="Payout"
              value={<span className="tabular-nums">{payout}</span>}
            />
          </SurfaceGroup>

          <CheckboxRow checked={accepted} onChange={setAccepted}>
            {STATEMENT}
          </CheckboxRow>

          {error === null ? null : (
            <p className="text-secondary text-triggered" role="status">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-5">
          <PillButton
            className="w-full"
            disabled={!accepted}
            loading={pending}
            onClick={submit}
          >
            Submit claim
          </PillButton>
          <TextLink href="/claim/confirm">Back</TextLink>
        </div>
      </main>
    </AppFrame>
  );
}
