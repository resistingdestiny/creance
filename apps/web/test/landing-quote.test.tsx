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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('../src/app/purchase-actions.js', () => ({
  beginPurchase: vi.fn(),
  chooseOccupation: vi.fn(),
  continueToVerify: vi.fn(),
  priceCover: vi.fn(),
  quoteOccupation: vi.fn(),
}));

const { LandingScreen } = await import('../src/components/landing/landing-screen.js');
const { priceCover, quoteOccupation } = await import('../src/app/purchase-actions.js');
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
  return render(<LandingScreen data={LIVE} />);
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

/** "Get a quote", from the navigation, which is the first of the three. */
function getAQuote(): void {
  fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);
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
  getAQuote();
  fireEvent.click(row(label));
  fireEvent.click(continueButton());
  await waitFor(() => expect(screen.getByText('Cover amount')).toBeDefined());
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

  it('puts the first step where the card stood, with no navigation', () => {
    page();
    getAQuote();

    expect(document.querySelector('[data-testid="landing-quote"]')).not.toBeNull();
    // The hero, the questions and the index section are all still on the page:
    // the quote is a section of it and not a screen that replaced it.
    expect(screen.getByText('Cover for the day your job is automated.')).toBeDefined();
    expect(screen.getByText('One number decides. You can watch it.')).toBeDefined();
  });

  it('opens from any of the three places the deck puts the button', () => {
    page();
    expect(screen.getAllByRole('button', { name: 'Get a quote' })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' }).at(-1)!);
    expect(screen.getByText('What do you do?')).toBeDefined();
  });
});

describe('the occupation step keeps the deck', () => {
  it('asks the deck question and labels the deck field', () => {
    page();
    getAQuote();
    expect(panel().getByRole('heading', { level: 2, name: 'What do you do?' })).toBeDefined();
    expect(panel().getByLabelText('Search occupations')).toBeDefined();
  });

  it('lists the fifteen rows in the addendum order', () => {
    page();
    getAQuote();
    const rows = [
      ...(document.querySelector('[data-testid="landing-quote"]') as HTMLElement).querySelectorAll(
        'button',
      ),
    ].filter((button) => button.textContent !== 'Continue');
    expect(rows).toHaveLength(15);
    expect(rows[0]?.textContent).toContain('Office and administrative support');
    expect(rows.at(-1)?.textContent).toContain('Farming, fishing and forestry');
  });

  it('filters on the label and says when nothing matches', () => {
    page();
    getAQuote();
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

  it('carries the line the route screen carries under the rows', () => {
    page();
    getAQuote();
    expect(
      screen.getByText('You tell us your occupation. We do not check it against an employer.'),
    ).toBeDefined();
  });

  it('disables Continue until an occupation is chosen', () => {
    page();
    getAQuote();
    expect(continueButton()).toHaveProperty('disabled', true);
    fireEvent.click(row('Computer and mathematical'));
    expect(continueButton()).toHaveProperty('disabled', false);
  });
});

describe('an occupation with no capacity behind it', () => {
  it('says so on its row, in the words the route screen uses', () => {
    page();
    getAQuote();
    // Two of the fourteen carry the backtest line in the same caption, so the
    // sentence is asserted where it starts rather than as the whole string.
    const said = panel()
      .getAllByText(/^No cover behind this occupation yet\./)
      .filter((node) => node.tagName === 'SPAN');
    expect(said).toHaveLength(14);
  });

  it('says so in place when it is the one in hand, and quotes nothing', () => {
    page();
    getAQuote();
    fireEvent.click(row('Legal'));

    expect(screen.getAllByText('No cover behind this occupation yet.').length).toBeGreaterThan(1);
    expect(continueButton()).toHaveProperty('disabled', true);
    expect(quoteOccupation).not.toHaveBeenCalled();
    expect(screen.queryByTestId('landing-quote-premium')).toBeNull();
  });
});

describe('the occupation and the index are one act', () => {
  it('moves the explorer to the occupation the quote is for', () => {
    page();
    expect(screen.getByText(/^Computer and mathematical, /)).toBeDefined();

    getAQuote();
    fireEvent.click(row('Legal'));

    expect(screen.getByText(`Legal, ${formatPeriod('2026-07')}`)).toBeDefined();
  });

  it('moves it before anything is quoted, so an occupation can be read first', () => {
    page();
    getAQuote();
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

  it('leaves verification on its own route', async () => {
    page();
    await toAmount();
    // The primary is the same server action the Amount screen submits, which
    // redirects to /verify. A signature and a World proof still get a screen.
    expect(continueButton()).toHaveProperty('disabled', false);
    expect(continueButton().getAttribute('type')).toBe('submit');
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

describe('motion and focus', () => {
  it('changes step instantly under reduced motion', () => {
    page();
    getAQuote();
    const step = document.querySelector('.landing-quote-step');
    expect(step?.className).toContain('motion-reduce:animate-none');
  });

  it('moves focus to the step, so a keyboard user can find it', async () => {
    page();
    getAQuote();
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

    const chosen = row('Computer and mathematical');
    chosen.focus();
    fireEvent.click(chosen);
    expect(document.activeElement).toBe(chosen);

    const next = continueButton();
    next.focus();
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText('Cover amount')).toBeDefined());
    expect(screen.getByRole('slider', { name: 'Cover 5,000' })).toBeDefined();
  });
});

describe('the words T34 removed stay removed', () => {
  it('does not grow them back when the quote is open', () => {
    page();
    getAQuote();
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
