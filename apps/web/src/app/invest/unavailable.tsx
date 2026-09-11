import { DesktopFrame } from '../../components/desktop-frame';
import { PillLink } from '../../components/pill-button';

/**
 * What an investor screen shows when the API does not answer.
 *
 * It says what happened and what to do next, without apology, which is the
 * sheet's rule for every error in this product. It does not invent figures: a
 * screen that renders a principal from a cached guess is worse than one that
 * says it could not reach the source.
 *
 * "Retry" is a link back to the same address rather than a button, because the
 * page is rendered on the server with no cache and a fresh request is the
 * whole of the retry.
 */

export function InvestorUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <DesktopFrame current="invest">
      <main className="flex flex-col items-start gap-4">
        <h1 className="text-title font-display font-semibold tracking-title text-ink">
          We can&apos;t load the series right now.
        </h1>
        <p className="text-body-lg text-ink-2">
          The series data comes from the API. Start it with pnpm api:dev, then try again.
        </p>
        <PillLink href={retryHref}>Retry</PillLink>
      </main>
    </DesktopFrame>
  );
}
