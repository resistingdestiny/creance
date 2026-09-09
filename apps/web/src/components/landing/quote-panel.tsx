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
import { CoverCardShell } from '../cover-card';
import { FormField } from '../form-field';
import { ListRow } from '../list-row';
import { PillButton } from '../pill-button';
import { TextLink } from '../text-link';
import { CardTurn } from './card-turn';
import { HeroCardStack } from './hero-card-stack';
import { stepIndex, useQuote, type QuoteStep } from './quote-state';

/**
 * The quote, on the landing page, on the card that was already standing there.
 *
 * T35 put the two steps on this page and swapped the hero card out for a
 * bordered panel. This is the same two steps on the card itself: pressing "Get
 * a quote" turns the card over on its vertical axis and the question is on the
 * face that comes round. Each step turns it again, forward one way and back the
 * other, and the last turn settles on the quote laid out the way the card lays
 * out a policy.
 *
 * The steps are the /occupation and /amount screens with nothing added and
 * nothing rewritten: the same questions in the same words, the same rows, the
 * same slider and the same interpolated sentence. Both routes are untouched and
 * still hold the same session, so a link already shared still opens the step it
 * names and resumes the quote the landing page started. Verification and payment
 * are not here: a signature, a World proof and a payment each deserve a screen,
 * and "Continue" on the settled quote is the same server action the Amount
 * screen submits, which redirects to /verify.
 *
 * Every call to the API is still made on the server, in src/app/purchase-actions,
 * so the eligibility credential never reaches a browser.
 *
 * Everything a step has been told lives here rather than on a face, because a
 * face is unmounted and remounted as the card turns through it and an answer
 * that did not survive going back would be an answer lost. The card only ever
 * has two faces, so the step being turned to is written onto whichever of the
 * two is about to point at the viewer, and the step being turned away from
 * keeps the other until it is needed again.
 */

/** How long after the slider is let go the price is asked for. */
const DEBOUNCE_MS = 250;

/** The index section on this page, which is what "How the index works" opens. */
const INDEX_ANCHOR = '#the-index';

/**
 * The hero's right hand column: the card, with the quote on its other face.
 *
 * The card at rest is passed in rather than imported so that it stays what the
 * page renders on the server. The frame around it is the same stack the hero
 * card has always stood in, so the drift, the pointer tilt and the entrance are
 * exactly what they were and the turn is one more transform inside them.
 *
 * The drift stops for as long as the quote is open. A card nobody is using can
 * sway; a card with a search field and a slider on it cannot, because the sway
 * is then working against the thing the card is for. The shimmer does not stop,
 * so the surface is still alive under the step.
 */
export function QuoteSlot({ card }: { card: ReactNode }) {
  const { step } = useQuote();
  const at = stepIndex(step);

  // The two faces, and which step each is currently carrying. Adjusted during
  // render rather than in an effect so the face turning towards the viewer has
  // the new step on it from the first frame of the turn, never a frame later.
  const [faces, setFaces] = useState<{ front: QuoteStep; back: QuoteStep | null }>({
    front: 'closed',
    back: null,
  });
  const onFront = at % 2 === 0;
  if (onFront ? faces.front !== step : faces.back !== step) {
    setFaces(onFront ? { ...faces, front: step } : { ...faces, back: step });
  }

  const [price, setPrice] = useState<PriceResult | null>(null);
  const [limit, setLimit] = useState(AMOUNT_DEFAULT);
  const [query, setQuery] = useState('');

  const face = (on: QuoteStep | null) => {
    if (on === null || on === 'closed') return null;
    if (on === 'occupation') {
      return (
        <OccupationFace
          current={step === on}
          onPriced={(result) => {
            setPrice(result);
            setLimit(AMOUNT_DEFAULT);
          }}
          onQuery={setQuery}
          query={query}
        />
      );
    }
    if (on === 'amount') {
      return (
        <AmountFace
          current={step === on}
          limit={limit}
          onLimit={setLimit}
          onPrice={setPrice}
          price={price}
        />
      );
    }
    return <CompleteFace current={step === on} limit={limit} price={price} />;
  };

  return (
    <HeroCardStack
      className="cover-card-enter relative w-full max-w-[620px] motion-reduce:animate-none"
      still={step !== 'closed'}
    >
      <CardTurn
        at={at}
        back={face(faces.back)}
        front={faces.front === 'closed' ? card : face(faces.front)}
      />
    </HeroCardStack>
  );
}

/**
 * One face of the card with a step written on it.
 *
 * It is the card, not a panel over the card: the same shell, the same
 * gradient, the same thickness, the same glare and the same shimmer, with the
 * step where the occupation and the amount would be. The padding is the
 * caller's because the card face gives a step less room at 390 than the hero
 * card's own 32 does.
 */
function QuoteFace({ children, current }: { children: ReactNode; current: boolean }) {
  return (
    <CoverCardShell className="w-full" depth hero metal padded={false}>
      <div
        className="cover-card__content flex flex-col gap-5 p-6 lg:p-8"
        data-testid={current ? 'landing-quote' : undefined}
      >
        {children}
      </div>
    </CoverCardShell>
  );
}

/**
 * The step's title, and where focus lands when the card starts turning towards
 * this face. It moves at the start of the turn and not at the end, so a
 * keyboard user is on the new step for the whole of it and is never left on a
 * control that has just been turned away.
 *
 * The landing page's h1 is the hero headline, so these are h2s: the quote is a
 * section of that page and not a screen of its own. The heading is focused
 * rather than the first control, so a screen reader reads the question before
 * the answers.
 */
function StepHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="font-display text-title font-semibold tracking-title text-ink"
      data-quote-focus=""
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
 *
 * The rows sit on the metal rather than in a surface group. On every other
 * screen the group is what separates the list from the page; on the card the
 * card is already that, and a grey slab on a metal face is a form pasted over
 * a card. The rows and their separators are the sheet's, unchanged.
 */
function OccupationFace({
  current,
  onPriced,
  onQuery,
  query,
}: {
  current: boolean;
  onPriced: (price: PriceResult) => void;
  onQuery: (query: string) => void;
  query: string;
}) {
  const { choose, go, group } = useQuote();
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
    <QuoteFace current={current}>
      <StepHeading>What do you do?</StepHeading>

      <FormField
        autoComplete="off"
        label="Search occupations"
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search occupations"
        type="search"
        value={query}
      />

      {visible.length === 0 ? (
        <p className="text-secondary text-ink-2">
          Nothing matches that. This cover is sold by occupation group, not by job title.
        </p>
      ) : (
        <div className="max-h-[212px] divide-y divide-hairline overflow-y-auto lg:max-h-[268px]">
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
        </div>
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
    </QuoteFace>
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
function AmountFace({
  current,
  limit,
  onLimit,
  onPrice,
  price,
}: {
  current: boolean;
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
  const settled = price !== null && price.error === null && price.premium !== '';

  return (
    <QuoteFace current={current}>
      <div className="flex flex-col gap-2">
        <StepHeading>Cover amount</StepHeading>
        <p className="text-secondary text-ink-2">{group === null ? '' : occupationLabel(group)}</p>
      </div>

      <p
        aria-live="polite"
        className={[
          // The card face is narrower than a phone screen at 390, so this is
          // the sheet's headline there and its display-l from the landing
          // breakpoint up. The string is the deck's either way; only its size
          // steps.
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
        <PillButton
          className="w-full"
          disabled={!settled}
          loading={pending}
          onClick={() => go('complete')}
          type="button"
        >
          Continue
        </PillButton>
        <BackTo step="occupation" />
      </div>
    </QuoteFace>
  );
}

/**
 * The quote, settled, laid out the way the card lays out a policy: the
 * occupation where the card puts the occupation, the cover where the card puts
 * the amount, and the monthly payment beside it.
 *
 * There is no "Covered" pill on it. The card wears one on Home because there is
 * cover behind it; here nothing has been verified and nothing has been paid, and
 * a pill that said "Covered" would claim cover this visitor does not have. What
 * the card can honestly do at this point is hold the figures, so that is what it
 * holds. Recorded in docs/DECISIONS.md.
 *
 * "Cover" and "Monthly payment" are the deck's own labels, from the Home card
 * and the pay sheet's rows. The primary is "Continue", the deck's word on the
 * Amount screen, and it is the same `continueToVerify` the Amount route submits,
 * so verification and payment keep their own screens.
 */
function CompleteFace({
  current,
  limit,
  price,
}: {
  current: boolean;
  limit: number;
  price: PriceResult | null;
}) {
  const { group } = useQuote();

  return (
    <QuoteFace current={current}>
      <h2
        className="text-secondary font-medium text-ink"
        data-quote-focus=""
        tabIndex={-1}
      >
        {group === null ? '' : occupationLabel(group)}
      </h2>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1">
          <p className="text-secondary text-ink">Cover</p>
          <p className="font-display text-display-xl font-semibold tracking-display tabular-nums text-ink lg:text-landing-amount lg:tracking-landing-ledger">
            {formatAmount(limit)}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-secondary text-ink">Monthly payment</p>
          <p
            className="font-display text-title font-semibold tracking-title tabular-nums text-ink"
            data-testid="landing-quote-monthly"
          >
            {price?.premium ?? ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <form action={continueToVerify}>
          <PillButton className="w-full" type="submit">
            Continue
          </PillButton>
        </form>
        <BackTo step="amount" />
      </div>
    </QuoteFace>
  );
}

/**
 * The way back, on every face that has one.
 *
 * Not in the deck, because the deck's steps were separate screens and the
 * browser's own back was the way back. On a card that turns there is no such
 * button, and a step nobody can leave is a trap. It turns the card the other
 * way and nothing that was entered is lost, because nothing that was entered
 * lives on a face.
 */
function BackTo({ step }: { step: QuoteStep }) {
  const { go } = useQuote();
  return (
    <button
      className="inline-flex min-h-11 items-center self-start text-body text-ink-2 underline underline-offset-[3px] transition-opacity duration-200 ease-out hover:opacity-70 motion-reduce:transition-none"
      onClick={() => go(step)}
      type="button"
    >
      Back
    </button>
  );
}
