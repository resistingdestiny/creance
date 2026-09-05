import { AppFrame } from '../components/app-frame';
import { PillButton, PillLink } from '../components/pill-button';
import { beginPurchase } from './purchase-actions';

/**
 * Start, the first screen of the worker flow, in the copy deck's own words
 * (docs/DESIGN-TOKENS.md section 8).
 *
 * "Get a quote" starts a purchase and moves to the occupation picker. The
 * purchase is a server side session from this press onward, because the
 * eligibility credential it will hold is a bearer token that binds a policy.
 *
 * It does not link to /gallery. The gallery is the review surface for T10 and
 * is deliberately unlinked.
 */
export default function Start() {
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
          <form action={beginPurchase}>
            <PillButton className="w-full" type="submit">
              Get a quote
            </PillButton>
          </form>
          <PillLink href="/invest" variant="secondary">
            I want to invest
          </PillLink>
        </div>
      </main>
    </AppFrame>
  );
}
