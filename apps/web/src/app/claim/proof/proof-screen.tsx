'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { AppFrame } from '../../../components/app-frame';
import { PillButton } from '../../../components/pill-button';
import { TextLink } from '../../../components/text-link';
import { UploadArea, type UploadedFile } from '../../../components/upload-area';
import { addEvidence, continueToConfirm } from '../../claim-actions';

/**
 * C3, Add proof. The four documents, the upload area and the footer line,
 * verbatim from docs/DESIGN-TOKENS-ADDENDUM.md.
 *
 * The file goes to the web server the moment it is chosen rather than at
 * submit: the caps are the API's own and refusing a file on the screen it was
 * chosen on is the whole reason to check them twice. The bytes stop at the
 * claim session and reach the API with the packet, which is where they are
 * sealed.
 *
 * The footer line is the truth about what happens to the document, and it is
 * the one line on this screen that has to stay exactly as written: only the
 * SHA-256 of each file goes to the claims topic (DESIGN.md 3.9).
 */

const DOCUMENTS = [
  'A termination or redundancy letter',
  'An unemployment benefit decision',
  'A final pay statement showing the end date',
  'A P45 or Record of Employment',
];

export function ProofScreen({ files }: { files: readonly UploadedFile[] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = (data: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await addEvidence(data);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  };

  const next = () => {
    setError(null);
    startTransition(async () => {
      const result = await continueToConfirm();
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between gap-8 px-5 py-10">
        <div className="flex flex-col gap-6">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            Add proof
          </h1>

          <div className="flex flex-col gap-2">
            <p className="text-body text-ink">One of these is enough:</p>
            <ul className="flex flex-col gap-1">
              {DOCUMENTS.map((document) => (
                <li className="text-body text-ink-2" key={document}>
                  {document}
                </li>
              ))}
            </ul>
          </div>

          <form action={upload} ref={form}>
            <UploadArea
              busy={pending}
              files={files}
              name="files"
              onSelect={() => form.current?.requestSubmit()}
            />
          </form>

          {error === null ? null : (
            <p className="text-secondary text-triggered" role="status">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-5">
          <PillButton className="w-full" loading={pending} onClick={next}>
            Continue
          </PillButton>
          <TextLink href="/claim/job">Back</TextLink>
        </div>
      </main>
    </AppFrame>
  );
}
