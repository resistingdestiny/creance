import { AppFrame } from '../components/app-frame';
import { PillButton } from '../components/pill-button';

/**
 * A holding page in the product voice. The purchase flow is T15's, the index
 * page is T16's and the landing page has no owner yet, so this says what the
 * product is, in the sheet's copy, and does nothing else.
 *
 * It does not link to /gallery. The gallery is the review surface for T10 and
 * is deliberately unlinked.
 */
export default function Home() {
  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-headline font-display font-semibold tracking-headline text-ink">
            Cover for the day your job is automated.
          </h1>
          <p className="text-body-lg text-ink-2">
            A monthly payment now. A payout if your occupation is displaced.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <PillButton disabled>Get a quote</PillButton>
          <PillButton disabled variant="secondary">
            I want to invest
          </PillButton>
        </div>
      </main>
    </AppFrame>
  );
}
