import { AppFrame } from '../components/app-frame';
import { PillLink } from '../components/pill-button';

/**
 * What a worker screen shows when the API does not answer.
 *
 * It says what happened and what to do next, without apology, which is the
 * sheet's rule for every error in this product. It invents no figures: a screen
 * that renders a premium from a cached guess is worse than one that says it
 * could not reach the source.
 */

export function WorkerUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <AppFrame>
      <main className="flex min-h-dvh flex-col justify-between px-5 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-title font-display font-semibold tracking-title text-ink">
            We can&apos;t reach the index right now.
          </h1>
          <p className="text-body-lg text-ink-2">
            The price and the index come from the API. Start it with pnpm api:dev, then try
            again.
          </p>
        </div>
        <PillLink href={retryHref}>Retry</PillLink>
      </main>
    </AppFrame>
  );
}
