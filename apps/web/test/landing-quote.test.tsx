// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The quote, taken on the landing page.
 *
 * landing.test.tsx is the page's markup, rendered to a string in node. This is
 * the same page with a DOM under it, because a quote that happens in place is a
 * sequence of clicks and there is nothing to assert about it in static markup.
 *
 * The strings asserted here are the copy deck's, exactly as worker-screens.test
 * asserts them for the two routes these steps came from: the point of the ticket
 * is that they moved and not that they were rewritten. The figures come from the
 * recorded testnet responses in worker-fixtures.ts, through the same
 * PriceResult the two server actions return.
 */

/**
 * The whole landing page renders for every one of these, and the journeys on it
 * are long. Vitest's five second default is not enough for that once the
 * workers are running in parallel, and a test that fails only when its
 * neighbours are busy is worse than a slow one.
 */
vi.setConfig({ testTimeout: 20_000 });

/** One spy across every useRouter call, so a navigation can be asserted. */
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('../src/app/purchase-actions.js', () => ({
  connectWallet: vi.fn(),
  useDemoWallet: vi.fn(),
  beginPurchase: vi.fn(),
  chooseOccupation: vi.fn(),
  completeWorldCheck: vi.fn(),
  continueToPay: vi.fn(),
  continueToVerify: vi.fn(),
  goToCover: vi.fn(),
  openPayment: vi.fn(),
  payAndBind: vi.fn(),
  priceCover: vi.fn(),
  quoteOccupation: vi.fn(),
  startAgain: vi.fn(),
  startWorldCheck: vi.fn(),
  verifyPerson: vi.fn(),
}));

/** The widget is the SDK's, and no test in this file runs a check. */
vi.mock('../src/app/verify/world-check.js', () => ({ WorldCheck: () => null }));

const { LandingScreen } = await import('../src/components/landing/landing-screen.js');
const { withWallet } = await import('./wallet-harness.js');
const { continueToVerify, priceCover, quoteOccupation } = await import(
  '../src/app/purchase-actions.js'
);
const { formatPeriod } = await import('../src/lib/format.js');
const { LIVE } = await import('./landing-fixtures.js');

const PRICE = {
  limit: '5,000',
  premium: '4.25',
  sentence:
    'Pays out if the index for Computer and mathematical rises 2 points above its trend. Full payout at 4 points.',
  usedPercent: 6,
  full: false,
  error: null,
};

const DEARER = { ...PRICE, limit: '7,000', premium: '5.95' };

function page() {
  return render(withWallet(<LandingScreen data={LIVE} />));
}

/**
 * The quote itself. Several of its strings are also on the page around it: the
 * explorer has its own "Search occupations" and the footer bar its own "How the
 * index works", and both are meant to be there. The queries are scoped so that
 * a test about the quote is about the quote.
 */
function panel() {
  return within(document.querySelector('[data-testid="landing-quote"]') as HTMLElement);
}

/**
 * "Get a quote", from the navigation, which is the first of the three, and the
 * turn that follows it.
 *
 * The awaits through this file are the card turning. A step arrives when the
 * card is edge on and not when the button is pressed: until then the face the
 * visitor is looking at is still the one they pressed it from, and the step
 * being turned to is not on screen, in the tab order or in the accessibility
 * tree. Every query here goes through that tree, so each one waits for the same
 * moment a person would.
 */
async function getAQuote(): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);
  await turned('What do you do?');
}

/** Waits for the card to finish turning to the face that carries this. */
async function turned(text: string): Promise<void> {
  await waitFor(
    () => expect(document.querySelector('[data-facing="viewer"]')?.textContent).toContain(text),
    { timeout: 3000 },
  );
}

function row(label: string): HTMLElement {
  return screen
    .getAllByRole('button')
    .find((button) => button.textContent?.startsWith(label) === true) as HTMLElement;
}

function continueButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Continue' });
}

/** Picks an occupation and takes the quote through to the cover amount step. */
async function toAmount(label = 'Computer and mathematical'): Promise<void> {
  await getAQuote();
  fireEvent.click(row(label));
  fireEvent.click(continueButton());
  await turned('Cover amount');
}

/** The whole quote, which is three half turns of the card. */
async function toSettled(): Promise<void> {
  await toAmount();
  fireEvent.click(continueButton());
  await turned('Monthly payment');
}

beforeEach(() => {
  vi.mocked(quoteOccupation).mockResolvedValue(PRICE);
  vi.mocked(priceCover).mockResolvedValue(DEARER);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the quote starts in place', () => {
  it('shows the cover card until it is asked for', () => {
    page();
    expect(document.querySelector('[data-testid="landing-quote"]')).toBeNull();
    expect(document.querySelector('.cover-card')).not.toBeNull();
  });

  it('puts the first step where the card stood, with no navigation', async () => {
    page();
    await getAQuote();

    expect(document.querySelector('[data-testid="landing-quote"]')).not.toBeNull();
    // The hero, the questions and the index section are all still on the page:
    // the quote is a section of it and not a screen that replaced it.
    expect(screen.getByText('Cover for the day your job is automated.')).toBeDefined();
    expect(screen.getByText('Track if you are eligible to get paid')).toBeDefined();
  });

  it('opens from any of the three places the deck puts the button', async () => {
    page();
    expect(screen.getAllByRole('button', { name: 'Get a quote' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' }).at(-1)!);
    expect(await screen.findByText('What do you do?')).toBeDefined();
  });
});

describe('the occupation step keeps the deck', () => {
  it('asks the deck question and labels the deck field', async () => {
    page();
    await getAQuote();
    expect(panel().getByRole('heading', { level: 2, name: 'What do you do?' })).toBeDefined();
    expect(panel().getByLabelText('Search occupations')).toBeDefined();
  });

  it('puts all fifteen under the open heading, with no empty second heading', async () => {
    page();
    await getAQuote();
    const rows = [
      ...(document.querySelector('[data-testid="landing-quote"]') as HTMLElement).querySelectorAll(
        'button',
      ),
    ].filter((button) => button.textContent !== 'Continue');
    expect(rows).toHaveLength(15);
    // T38 grouped the list when one occupation was buyable. Every one carries
    // a series now, so they stay in the addendum order under the open heading
    // and the no cover heading is not rendered.
    expect(rows[0]?.textContent).toContain('Office and administrative support');
    expect(rows.at(-1)?.textContent).toContain('Farming, fishing and forestry');
    expect(panel().getByText('Open to buy (15)')).toBeDefined();
    expect(panel().queryByText(/No cover behind these yet/)).toBeNull();
  });

  /**
   * The card has no experience step and quotes with no band at all, so an
   * occupation whose capital has all been committed to particular lengths of
   * experience has nothing to quote against here. That is not a dead end and it
   * is not a refusal: the occupation can be bought, the person simply has to
   * say how long they have worked, and the screen that asks that is a route.
   * The session already holds the occupation, so it opens on it.
   */
  it('sends an occupation sold by length of experience to the screen that asks', async () => {
    vi.mocked(quoteOccupation).mockResolvedValue({
      limit: '5,000',
      premium: '',
      sentence: '',
      usedPercent: 0,
      full: true,
      error: 'Nobody is funding that length of experience any more. Choose another.',
      needsBand: true,
    });
    page();
    await getAQuote();
    const legal = panel()
      .getAllByRole('button')
      .find((button) => button.textContent?.startsWith('Legal') === true) as HTMLElement;
    fireEvent.click(legal);
    fireEvent.click(continueButton());

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/experience'));
    // The card does not turn to a cover amount it has no price for, and the
    // sentence about choosing another length of experience, which is written
    // for a screen that asked about experience, is never read here.
    expect(document.querySelector('[data-facing="viewer"]')?.textContent).toContain(
      'What do you do?',
    );
    expect(panel().queryByText(/length of experience any more/)).toBeNull();
  });

  it('keeps a search under the heading for the part it matched', async () => {
    page();
    await getAQuote();
    const search = panel().getByLabelText('Search occupations');
    fireEvent.change(search, { target: { value: 'legal' } });
    expect(panel().getByText('Open to buy (1)')).toBeDefined();
    expect(panel().queryByText(/No cover behind these yet/)).toBeNull();
    expect(panel().getByText('Legal')).toBeDefined();
  });

  it('filters on the label and says when nothing matches', async () => {
    page();
    await getAQuote();
    const search = panel().getByLabelText('Search occupations');

    fireEvent.change(search, { target: { value: 'legal' } });
    expect(panel().queryByText('Office and administrative support')).toBeNull();

    fireEvent.change(search, { target: { value: 'astronaut' } });
    expect(
      panel().getByText(
        'Nothing matches that. This cover is sold by occupation group, not by job title.',
      ),
    ).toBeDefined();
  });

  it('carries the line the route screen carries under the rows', async () => {
    page();
    await getAQuote();
    expect(
      screen.getByText('You tell us your occupation. We do not check it against an employer.'),
    ).toBeDefined();
  });

  it('disables Continue until an occupation is chosen', async () => {
    page();
    await getAQuote();
    expect(continueButton()).toHaveProperty('disabled', true);
    fireEvent.click(row('Computer and mathematical'));
    expect(continueButton()).toHaveProperty('disabled', false);
  });
});

describe('every occupation has capacity behind it', () => {
  it('says nothing about cover being absent, because none is', async () => {
    page();
    await getAQuote();
    expect(panel().queryAllByText(/^No cover behind this occupation yet\./)).toHaveLength(0);
  });

  it('quotes the occupation that could not be bought before, in place', async () => {
    page();
    await getAQuote();
    fireEvent.click(row('Office and administrative support'));

    expect(continueButton()).toHaveProperty('disabled', false);
    fireEvent.click(continueButton());
    await waitFor(() => expect(quoteOccupation).toHaveBeenCalled());
  });
});

describe('the occupation and the index are one act', () => {
  it('moves the explorer to the occupation the quote is for', async () => {
    // The panel opens on its own occupation, which is the one nearest its
    // line rather than the one the hero card speaks for, so what this asserts
    // is the move: whatever it was showing, it is showing Legal afterwards.
    page();
    expect(screen.queryByText(/^Legal, /)).toBeNull();

    await getAQuote();
    fireEvent.click(row('Legal'));

    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
  });

  it('moves it before anything is quoted, so an occupation can be read first', async () => {
    page();
    await getAQuote();
    fireEvent.click(row('Production'));

    expect(screen.getByText(`Production, ${formatPeriod('2026-07')}`)).toBeDefined();
    expect(quoteOccupation).not.toHaveBeenCalled();
  });
});

describe('the cover amount step keeps the deck', () => {
  it('writes the premium as "{premium} a month" and carries the sentence', async () => {
    page();
    await toAmount();

    expect(quoteOccupation).toHaveBeenCalledWith('computer_math');
    expect(screen.getByTestId('landing-quote-premium').textContent).toBe('4.25 a month');
    expect(screen.getByText(PRICE.sentence)).toBeDefined();
  });

  it('runs the slider over the offered range in steps of 500', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });
    expect(slider.getAttribute('min')).toBe('1000');
    expect(slider.getAttribute('max')).toBe('10000');
    expect(slider.getAttribute('step')).toBe('500');
  });

  it('opens the index section on this page rather than leaving for a route', async () => {
    page();
    await toAmount();
    const link = panel().getByRole('link', { name: 'How the index works' });
    expect(link.getAttribute('href')).toBe('#the-index');
    expect(document.querySelector('#the-index')).not.toBeNull();
  });

  it('turns to the settled quote rather than leaving the page', async () => {
    page();
    await toAmount();
    // The cover amount step's Continue is one more half turn (T36), not a
    // navigation. The card settles on the quote before anything leaves.
    expect(continueButton()).toHaveProperty('disabled', false);
    expect(continueButton().getAttribute('type')).toBe('button');
    fireEvent.click(continueButton());
    await turned('Monthly payment');
    expect(screen.getByText('Monthly payment')).toBeDefined();
  });

  it('refuses to continue on a price it could not take', async () => {
    vi.mocked(quoteOccupation).mockResolvedValue({
      ...PRICE,
      premium: '',
      sentence: '',
      full: true,
      error: 'This series is full. Choose a smaller amount or try again later.',
    });
    page();
    await toAmount();

    expect(screen.getByRole('status').textContent).toContain('This series is full.');
    expect(continueButton()).toHaveProperty('disabled', true);
  });

  it('goes back to the question without losing the answer', async () => {
    page();
    await toAmount();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await turned('What do you do?');

    expect(screen.getByRole('heading', { level: 2, name: 'What do you do?' })).toBeDefined();
    expect(continueButton()).toHaveProperty('disabled', false);
  });
});

describe('the slider is priced once per gesture', () => {
  it('asks for nothing while the thumb is moving', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });

    fireEvent.change(slider, { target: { value: '6000' } });
    fireEvent.change(slider, { target: { value: '6500' } });
    fireEvent.change(slider, { target: { value: '7000' } });
    await new Promise((resolve) => setTimeout(resolve, 400));

    // The label tracks the thumb, so the cover is on screen as a figure the
    // whole time. The price is what is not bought yet.
    expect(screen.getByRole('slider', { name: 'Cover 7,000' })).toBeDefined();
    expect(priceCover).not.toHaveBeenCalled();
  });

  it('takes one price when the drag ends, and no more', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });

    fireEvent.change(slider, { target: { value: '6000' } });
    fireEvent.change(slider, { target: { value: '7000' } });
    await act(async () => {
      fireEvent.pointerUp(slider);
    });
    await waitFor(() => expect(priceCover).toHaveBeenCalledTimes(1));
    expect(priceCover).toHaveBeenCalledWith(7000);

    await waitFor(() =>
      expect(screen.getByTestId('landing-quote-premium').textContent).toBe('5.95 a month'),
    );

    // Releasing again on a cover nothing changed about buys nothing.
    await act(async () => {
      fireEvent.pointerUp(slider);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(priceCover).toHaveBeenCalledTimes(1);
  });

  it('takes one price when a key is released, so the keyboard is not left out', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });

    fireEvent.change(slider, { target: { value: '5500' } });
    await act(async () => {
      fireEvent.keyUp(slider, { key: 'ArrowRight' });
    });

    await waitFor(() => expect(priceCover).toHaveBeenCalledWith(5500));
  });

  it('prices nothing when a nudge comes back before the debounce is up', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });

    // Up one step and let go, then straight back down and let go inside the
    // 250ms. The gesture ended where it started, so there is nothing to buy;
    // the timer the way out queued has to go with it, or the price, the
    // session's cover amount and the quote id all belong to a figure the
    // slider is not showing.
    fireEvent.change(slider, { target: { value: '5500' } });
    await act(async () => {
      fireEvent.keyUp(slider, { key: 'ArrowRight' });
    });
    fireEvent.change(slider, { target: { value: '5000' } });
    await act(async () => {
      fireEvent.keyUp(slider, { key: 'ArrowLeft' });
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(priceCover).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Cover 5,000' })).toBeDefined();
    // The figure on screen is the one the slider is showing, and it is not
    // left greyed out waiting for a price that is never coming.
    expect(screen.getByTestId('landing-quote-premium').textContent).toBe('4.25 a month');
    expect(screen.getByTestId('landing-quote-premium').className).toContain('text-ink');
    expect(screen.getByTestId('landing-quote-premium').className).not.toContain('text-ink-3');
  });

  it('prices the cover the gesture ended on when the nudge does not come back', async () => {
    page();
    await toAmount();
    const slider = screen.getByRole('slider', { name: 'Cover 5,000' });

    fireEvent.change(slider, { target: { value: '5500' } });
    await act(async () => {
      fireEvent.keyUp(slider, { key: 'ArrowRight' });
    });
    fireEvent.change(slider, { target: { value: '7000' } });
    await act(async () => {
      fireEvent.keyUp(slider, { key: 'ArrowRight' });
    });

    await waitFor(() => expect(priceCover).toHaveBeenCalledTimes(1));
    expect(priceCover).toHaveBeenCalledWith(7000);
    expect(priceCover).not.toHaveBeenCalledWith(5500);
  });
});

describe('the settled quote is the card, carrying its own figures', () => {
  it('shows the occupation, the cover and the monthly payment', async () => {
    page();
    await toSettled();

    expect(panel().getByRole('heading', { level: 2, name: 'Computer and mathematical' })).toBeDefined();
    expect(panel().getByText('Cover')).toBeDefined();
    expect(panel().getByText('5,000')).toBeDefined();
    expect(screen.getByTestId('landing-quote-monthly').textContent).toBe('4.25');
  });

  it('claims no cover it does not have', async () => {
    page();
    await toSettled();
    // The card wears "Covered" on Home because there is cover behind it.
    // Nothing has been verified and nothing has been paid at this point.
    expect(panel().queryByText('Covered')).toBeNull();
  });

  it('turns to the check in the deck word, rather than leaving for it', async () => {
    page();
    await toSettled();
    // The primary was `continueToVerify`, which redirected to /verify. Since
    // T37 the check is one more half turn and the route still holds it for a
    // link already shared. landing-purchase.test.tsx carries the step itself.
    const primary = panel().getByRole('button', { name: 'Continue' });
    expect(primary.getAttribute('type')).toBe('button');
    expect(primary.closest('form')).toBeNull();

    fireEvent.click(primary);
    await turned("Confirm you're a real person.");
    expect(continueToVerify).not.toHaveBeenCalled();
  });

  it('turns back to the amount without losing the cover', async () => {
    page();
    await toSettled();
    fireEvent.click(panel().getByRole('button', { name: 'Back' }));
    await turned('Cover amount');

    expect(screen.getByRole('slider', { name: 'Cover 5,000' })).toBeDefined();
    expect(screen.getByTestId('landing-quote-premium').textContent).toBe('4.25 a month');
  });
});

describe('the card turns rather than swapping', () => {
  function turn(): HTMLElement {
    return document.querySelector('.cover-card-turn') as HTMLElement;
  }

  it('is one object with two faces, and one card until the quote is asked for', () => {
    page();
    expect(turn().style.transform).toBe('rotateY(0deg)');
    expect(document.querySelectorAll('.cover-card-face')).toHaveLength(1);
  });

  it('turns half a turn forward for each step and the other way back', async () => {
    page();
    // The rotation is written the moment the step changes, so it leads the
    // faces rather than following them: the card is already on its way.
    fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);
    expect(turn().style.transform).toBe('rotateY(180deg)');
    expect(document.querySelectorAll('.cover-card-face')).toHaveLength(2);

    await screen.findByRole('heading', { level: 2, name: 'What do you do?' });
    fireEvent.click(row('Computer and mathematical'));
    fireEvent.click(continueButton());
    await turned('Cover amount');
    expect(turn().style.transform).toBe('rotateY(360deg)');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(turn().style.transform).toBe('rotateY(180deg)');
  });

  it('holds the step it turned away from, out of reach and not thrown away', async () => {
    page();
    await toAmount();
    const away = document.querySelector('[data-facing="away"]') as HTMLElement;
    expect(away.getAttribute('aria-hidden')).toBe('true');
    expect(away.hasAttribute('inert')).toBe(true);
    // The question is still there with the answer on it, which is what makes
    // going back cost nothing.
    expect(away.textContent).toContain('What do you do?');
  });

  it('keeps the control that was pressed until the card has turned away from it', async () => {
    page();
    await toAmount();
    const pressed = screen.getByRole('button', { name: 'Back' });
    pressed.focus();
    fireEvent.click(pressed);

    // Part way through the turn the cover amount step is still the face on
    // screen, so it still holds focus. Focus moves when the card is edge on and
    // the face it was on stops being the one being read.
    expect(document.activeElement).toBe(pressed);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('What do you do?'));
  });
});

describe('motion and focus', () => {
  it('turns instantly under reduced motion, with no step left behind', () => {
    // The turn is a CSS transition on .cover-card-turn and the stylesheet
    // removes it under the preference, which built-css.test.ts asserts. What
    // this holds is the part JavaScript owns: the height and the hidden face
    // follow the step in the same tick rather than at the half turn.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    page();
    fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);

    // No turn to wait for: the face and the focus are there in the same tick
    // the button was pressed in.
    const faces = [...document.querySelectorAll('.cover-card-face')] as HTMLElement[];
    expect(faces.map((face) => face.dataset.facing)).toStrictEqual(['away', 'viewer']);
    expect(document.activeElement?.textContent).toBe('What do you do?');
    vi.unstubAllGlobals();
  });

  it('keeps focus in the quote while the price is being bought', async () => {
    // The primary is disabled while the quote is in flight, and a disabled
    // button that has focus loses it to the document. On testnet that is a
    // second or two of a keyboard user standing at the top of the page in the
    // middle of taking a quote.
    let settle: (price: typeof PRICE) => void = () => {};
    vi.mocked(quoteOccupation).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    page();
    await getAQuote();
    fireEvent.click(row('Computer and mathematical'));
    const pressed = continueButton();
    pressed.focus();
    fireEvent.click(pressed);

    // Back on the question, not on the document. The card has nothing to turn
    // to until the price comes back.
    expect(document.activeElement?.textContent).toBe('What do you do?');
    await act(async () => {
      settle(PRICE);
    });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cover amount'));
  });

  it('moves focus to the step, so a keyboard user can find it', async () => {
    page();
    await getAQuote();
    expect(document.activeElement?.textContent).toBe('What do you do?');

    fireEvent.click(row('Computer and mathematical'));
    fireEvent.click(continueButton());
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cover amount'));
  });

  it('completes the whole quote from the keyboard alone', async () => {
    page();
    // Every control is a button, an input or an anchor, so the tab order and
    // the focus outline are the platform's. Enter on a button is a click.
    const start = screen.getAllByRole('button', { name: 'Get a quote' })[0]!;
    start.focus();
    fireEvent.click(start);
    await screen.findByRole('heading', { level: 2, name: 'What do you do?' });

    const chosen = row('Computer and mathematical');
    chosen.focus();
    fireEvent.click(chosen);
    expect(document.activeElement).toBe(chosen);

    const next = continueButton();
    next.focus();
    fireEvent.click(next);
    await turned('Cover amount');
    expect(screen.getByRole('slider', { name: 'Cover 5,000' })).toBeDefined();
  });
});

describe('the words T34 removed stay removed', () => {
  it('does not grow them back when the quote is open', async () => {
    page();
    await getAQuote();
    for (const cut of [
      'Two minutes, start to covered.',
      'Pick your occupation',
      'Eleven groups, one tap. Each shows its index reading.',
      'Choose your cover',
      '1,000 to 10,000. The monthly payment updates as you slide.',
    ]) {
      expect(document.body.textContent).not.toContain(cut);
    }
  });
});
