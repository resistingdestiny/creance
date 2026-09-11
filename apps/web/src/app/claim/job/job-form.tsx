'use client';

import { useId, useState, useTransition } from 'react';

import { AppFrame } from '../../../components/app-frame';
import { FormField } from '../../../components/form-field';
import { PillButton } from '../../../components/pill-button';
import { TextLink } from '../../../components/text-link';
import {
  EXCLUDED_NOTE,
  isExcludedSeparation,
  SEPARATION_OPTIONS,
} from '../../../lib/claim-model';
import { saveJob } from '../../claim-actions';
import { ClaimSteps } from '../claim-steps';

/**
 * C2, Your job. The four fields and the select, copy verbatim from
 * docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * The first of the four steps, and the step bar above the heading is what says
 * so. See src/app/claim/claim-steps.tsx.
 *
 * Choosing an excluded reason shows the inline line in `triggered` under the
 * field and changes nothing else. It is a warning, not a block: DESIGN.md 3.9
 * puts every one of these rules in the adjudication, so a resignation is
 * accepted and declined a second later with a reason a person can read, rather
 * than refused by a form that will not say why.
 *
 * "Your name" is not in the addendum's field list and is here because the
 * attestation is signed over it and the Adjuster's name rule reads it: a claim
 * with no name on it cannot be checked against the document at all. Recorded
 * in docs/DECISIONS.md.
 */

export function JobForm({
  fullName,
  employer,
  jobTitle,
  lastDayOfWork,
  separationType,
}: {
  fullName: string | null;
  employer: string | null;
  jobTitle: string | null;
  lastDayOfWork: string | null;
  separationType: string | null;
}) {
  const selectId = useId();
  const [separation, setSeparation] = useState(separationType ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (form: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await saveJob(form);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <AppFrame>
      <form action={submit} className="flex min-h-frame flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-4">
            <ClaimSteps current={1} />
            <h1 className="text-title font-display font-semibold tracking-title text-ink">
              Your job
            </h1>
          </header>

          <FormField
            autoComplete="name"
            defaultValue={fullName ?? ''}
            label="Your name"
            name="full_name"
            required
          />
          <FormField
            defaultValue={employer ?? ''}
            label="Employer"
            name="employer"
            required
          />
          <FormField
            defaultValue={jobTitle ?? ''}
            label="Job title"
            name="job_title"
            required
          />
          <FormField
            defaultValue={lastDayOfWork ?? ''}
            label="Last day of work"
            name="last_day_of_work"
            required
            type="date"
          />

          <div className="flex flex-col gap-2">
            <label className="text-secondary text-ink-2" htmlFor={selectId}>
              How did it end?
            </label>
            <select
              className="min-h-[52px] rounded-field border border-hairline bg-canvas px-4 text-body-lg text-ink"
              id={selectId}
              name="separation_type"
              onChange={(event) => setSeparation(event.target.value)}
              required
              value={separation}
            >
              <option disabled value="">
                Choose one
              </option>
              {SEPARATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isExcludedSeparation(separation) ? (
              <p className="text-secondary text-triggered" role="status">
                {EXCLUDED_NOTE}
              </p>
            ) : null}
          </div>

          {error === null ? null : (
            <p className="text-secondary text-triggered" role="status">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-5">
          <PillButton className="w-full" loading={pending} type="submit">
            Continue
          </PillButton>
          <TextLink href="/home">Back to cover</TextLink>
        </div>
      </form>
    </AppFrame>
  );
}
