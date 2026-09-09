'use client';

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';

import { NO_COVER_YET, captionFor } from '../../app/occupation/occupation-picker';
import { continueToVerify, priceCover, quoteOccupation } from '../../app/purchase-actions';
import { AMOUNT_DEFAULT } from '../../lib/cover-amount';
import { formatAmount } from '../../lib/format';
import {
  filterOccupations,
  findOccupation,
  hasCover,
  occupationLabel,
} from '../../lib/occupations';
import type { PriceResult } from '../../lib/worker-model';
import { AmountSlider } from '../amount-slider';
import { FormField } from '../form-field';
import { ListRow } from '../list-row';
import { PillButton } from '../pill-button';
import { SurfaceGroup } from '../surface-group';
import { TextLink } from '../text-link';
import { useQuote } from './quote-state';

/**
 * The quote, on the landing page, where the hero card stands.
 *
 * The two steps are the /occupation and /amount screens with nothing added and
 * nothing rewritten: the same questions in the same words, the same rows, the
 * same slider and the same interpolated sentence. What changed is that they no
 * longer take the visitor off the page they are reading, and that the occupation
 * they pick moves the index explorer below them at the same time.
 *
 * Both routes are untouched and still hold the same session, so a link already
 * shared still opens the step it names and resumes the quote the landing page
 * started. Verification and payment are not here: a signature, a World proof and
 * a payment each deserve a screen, and "Continue" on the second step is the same
 * server action the Amount screen submits, which redirects to /verify.
 *
 * Every call to the API is still made on the server, in src/app/purchase-actions,
 * so the eligibility credential never reaches a browser.
 *
 * Motion is the sheet's: 200ms ease-out on a user action, and under reduced
 * motion the step is simply there. Focus follows the step, because a step that
 * changed somewhere else on the page is a step a keyboard user cannot find.
 */

/** How long after the slider is let go the price is asked for. */
const DEBOUNCE_MS = 250;

/** The index section on this page, which is what "How the index works" opens. */
const INDEX_ANCHOR = '#the-index';

/**
 * The hero's right hand column: the cover card, or the quote in its place.
 *
 * The card is passed in rather than imported so that it stays what the page
 * renders on the server, and so that the swap is one line a reader can check.
 */
export function QuoteSlot({ card }: { card: ReactNode }) {
  const { step } = useQuote();
  return step === 'closed' ? card : <QuotePanel step={step} />;
}

function QuotePanel({ step }: { step: 'occupation' | 'amount' }) {
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [limit, setLimit] = useState(AMOUNT_DEFAULT);

  return (
    <div
      className="relative w-full max-w-[620px] rounded-hero border border-hairline bg-canvas p-6 lg:p-8"
      data-testid="landing-quote"
    >
      {/* Keyed on the step, so the entrance runs again on every change rather
          than once for the panel. */}
      <div className="landing-quote-step motion-reduce:animate-none" key={step}>
        {step === 'occupation' ? (
          <OccupationStep
            onPriced={(result) => {
              setPrice(result);
              setLimit(AMOUNT_DEFAULT);
            }}
          />
        ) : (
          <AmountStep limit={limit} onLimit={setLimit} onPrice={setPrice} price={price} />
        )}
      </div>
    </div>
  );
}

/**
 * The step's title, and where focus lands when the step changes.
 *
 * The landing page's h1 is the hero headline, so these are h2s: the quote is a
 * section of that page and not a screen of its own. The heading is focused
 * rather than the first control, so a screen reader reads the question before
 * the answers.
 */
function StepHeading({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <h2
      className="font-display text-title font-semibold tracking-title text-ink"
      ref={heading}
      tabIndex={-1}
    >
      {children}
    </h2>
  );
}

/**
 * "What do you do?", docs/DESIGN-TOKENS.md section 8, with the picker's own
 * behaviour: a case-insensitive filter over the fifteen labels, a tap that
 * selects rather than navigates, and the picker's own sentence where nothing has
 * been committed to an occupation.
 *
 * Choosing a row moves the index explorer below at once, before "Continue" is
 * pressed and before anything is paid for, so a visitor can read the index for
 * an occupation and then decide. That is why all fifteen can be chosen here,
 * where the route's picker offers only the one with capacity behind it: an
 * occupation nobody can pick is an occupation the explorer can never be pointed
 * at. Nothing is quoted for the other fourteen. The row says so, the line under
 * the rows says so in the same words, and "Continue" is disabled.
 * docs/DECISIONS.md.
 */
function OccupationStep({ onPriced }: { onPriced: (price: PriceResult) => void }) {
  const { choose, go, group } = useQuote();
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  const visible = filterOccupations(query);
  const chosen = findOccupation(group);
  const buyable = chosen !== null && hasCover(chosen);

  function continueWith(selected: string): void {
    startTransition(async () => {
      const price = await quoteOccupation(selected);
      onPriced(price);
      go('amount');
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <StepHeading>What do you do?</StepHeading>

      <FormField
        autoComplete="off"
        label="Search occupations"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search occupations"
        type="search"
        value={query}
      />

      {visible.length === 0 ? (
        <p className="text-secondary text-ink-2">
          Nothing matches that. This cover is sold by occupation group, not by job title.
        </p>
      ) : (
        <SurfaceGroup className="max-h-[292px] overflow-y-auto">
          {visible.map((row) => {
            const available = hasCover(row);
            return (
              <ListRow
                caption={captionFor(row)}
                key={row.key}
                label={
                  <span className={available ? 'text-body text-ink' : 'text-body text-ink-2'}>
                    {row.label}
                  </span>
                }
                onSelect={() => choose(row.key)}
                trailing={group === row.key ? 'check' : 'none'}
              />
            );
          })}
        </SurfaceGroup>
      )}

      <p className="text-secondary text-ink-2">
        {chosen !== null && !buyable
          ? NO_COVER_YET
          : 'You tell us your occupation. We do not check it against an employer.'}
      </p>
      <PillButton
        disabled={!buyable}
        loading={pending}
        onClick={() => {
          if (chosen !== null && buyable) continueWith(chosen.key);
        }}
      >
        Continue
      </PillButton>
    </div>
  );
}

/**
 * "Cover amount", "{premium} a month" and the sentence that says when it pays,
 * docs/DESIGN-TOKENS.md section 8, with the group, the attachment and the
 * exhaustion interpolated as its engineering note requires.
 *
 * The price is a real quote and not an estimate, so it costs a metered call
 * every time it is taken. On a route behind a session that was one call per
 * pause of the thumb; on a public front door it is taken once per gesture, when
 * the drag or the key press ends, and the 250ms after that is the same debounce
 * the Amount screen uses. While the thumb is ahead of the price the figure stays
 * on screen in ink-3 rather than disappearing, which is what the Amount screen
 * does while a new price loads. Recorded in docs/DECISIONS.md.
 */
function AmountStep({
  limit,
  onLimit,
  onPrice,
  price,
}: {
  limit: number;
  onLimit: (limit: number) => void;
  onPrice: (price: PriceResult) => void;
  price: PriceResult | null;
}) {
  const { go, group } = useQuote();
  const [priced, setPriced] = useState(limit);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function commit(): void {
    // Cleared before the guard and never after it. A gesture that ends on the
    // cover the price is already for still has to cancel whatever an earlier
    // gesture queued: returning first would leave a timer holding the cover the
    // visitor moved away from, and that cover would be the one priced, the one
    // written to the session and the one carried into /verify while the slider
    // showed another.
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (limit === priced) return;
    timer.current = setTimeout(() => {
      setPriced(limit);
      startTransition(async () => {
        onPrice(await priceCover(limit));
      });
    }, DEBOUNCE_MS);
  }

  const stale = pending || limit !== priced;
  const premium = price === null || price.premium === '' ? '' : `${price.premium} a month`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <StepHeading>Cover amount</StepHeading>
        <p className="text-secondary text-ink-2">{group === null ? '' : occupationLabel(group)}</p>
      </div>

      <p
        aria-live="polite"
        className={[
          // The Amount route has the whole width of a phone for this figure and
          // the panel has a card's width inside it, so it is the sheet's
          // headline at 390 and its display-l from the landing breakpoint up.
          // The string is the deck's either way; only its size steps.
          'min-h-[60px] font-display text-headline font-semibold tracking-headline tabular-nums lg:text-display-l lg:tracking-display',
          stale ? 'text-ink-3' : 'text-ink',
        ].join(' ')}
        data-testid="landing-quote-premium"
      >
        {premium}
      </p>

      {/* The price is taken when the gesture ends, so these four events are the
          end of one: a pointer released, a key released, a touch lifted, and the
          slider losing focus with a value nobody asked a price for. They are
          taken on the wrapper because they all bubble from the input, which
          keeps the shared slider component exactly as every other screen has it. */}
      <div onBlurCapture={commit} onKeyUp={commit} onPointerUp={commit} onTouchEnd={commit}>
        <AmountSlider label={`Cover ${formatAmount(limit)}`} onChange={onLimit} value={limit} />
      </div>

      <p className="text-secondary text-ink-2">{price?.sentence ?? ''}</p>

      {price?.error == null ? null : (
        <p className="text-secondary text-triggered" role="status">
          {price.error}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <TextLink href={INDEX_ANCHOR}>How the index works</TextLink>
        <form action={continueToVerify}>
          <PillButton
            className="w-full"
            disabled={price === null || price.error !== null || price.premium === ''}
            loading={pending}
            type="submit"
          >
            Continue
          </PillButton>
        </form>
        {/* Not in the deck, because the deck's steps were separate screens and
            the browser's own back was the way back. Inline there is no such
            button, and a step nobody can leave is a trap. */}
        <button
          className="inline-flex min-h-11 items-center self-start text-body text-ink-2 underline underline-offset-[3px] transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none"
          onClick={() => go('occupation')}
          type="button"
        >
          Back
        </button>
      </div>
    </div>
  );
}
