'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Where the inline quote is, held once for the whole landing page.
 *
 * Three parts of the page read it and they sit in three different sections:
 * "Get a quote", which appears in the navigation, in the hero and in the closing
 * band; the quote itself, which stands where the hero card stands; and the index
 * explorer further down, which follows the occupation the quote is for. Picking
 * an occupation to be quoted and looking at that occupation's index are one act,
 * so there is one selection and not two.
 *
 * It holds the step and the occupation and nothing else. The price, the cover
 * amount and the calls that fetch them belong to the panel, because nothing
 * outside it reads them. The purchase is not here at all: it is the same server
 * side session /occupation and /amount write, behind the same httpOnly cookie,
 * so a quote begun here can be finished on those routes and the eligibility
 * credential still never reaches a browser.
 */

/**
 * Closed, then every step of the purchase, in the order it happens.
 *
 * The order is the order the card turns through: each step is one half turn
 * from the one before it, so the index of a step in this list is the number of
 * half turns the card has taken to reach it. Forward and back are then the same
 * turn in opposite directions and nothing has to be told which way to go.
 *
 * The last three are T37. Each one is the screen of the same name with nothing
 * about it rewritten: `verify` runs the same World check `/verify` runs, `pay`
 * binds the same quote `/pay` binds, and `covered` is the card in the state
 * Home gives it once the bind has settled. The four routes still exist and
 * still hold the same session, so a link already shared opens the step it names.
 */
export const QUOTE_STEPS = [
  'closed',
  'occupation',
  'amount',
  'complete',
  'verify',
  'pay',
  'covered',
] as const;

export type QuoteStep = (typeof QUOTE_STEPS)[number];

/** Half turns from the card at rest. */
export function stepIndex(step: QuoteStep): number {
  return QUOTE_STEPS.indexOf(step);
}

export interface QuoteState {
  readonly step: QuoteStep;
  /** The occupation the quote is for, or null before one is picked. */
  readonly group: string | null;
  /** "Get a quote", from whichever of the three places it was pressed. */
  readonly start: () => void;
  readonly choose: (group: string) => void;
  readonly go: (step: QuoteStep) => void;
}

const Quote = createContext<QuoteState | null>(null);

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<QuoteStep>('closed');
  const [group, setGroup] = useState<string | null>(null);

  const value = useMemo<QuoteState>(
    () => ({
      step,
      group,
      // Whatever was already picked is kept, so a visitor who chose an
      // occupation, read its index and pressed "Get a quote" again is not asked
      // the same question twice.
      start: () => setStep('occupation'),
      choose: (next: string) => setGroup(next),
      go: (next: QuoteStep) => setStep(next),
    }),
    [group, step],
  );

  return <Quote.Provider value={value}>{children}</Quote.Provider>;
}

export function useQuote(): QuoteState {
  const value = useContext(Quote);
  if (value === null) {
    throw new Error('The inline quote is only available inside QuoteProvider.');
  }
  return value;
}
