// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The subscribe screen has three states and the interesting one is the last.
 *
 * The press settles a subscription now. It used to set a piece of local state
 * and nothing else, because there was no endpoint to call, and the screen after
 * it reported the position the chain already held; `POST /v1/subscribe` is that
 * endpoint and src/app/invest/subscribe/subscribe-actions.ts is what the button
 * posts to. So what these tests hold is the new promise rather than the old
 * one: the screen sends, it says who settles it before the press, it shows the
 * total the vault carries afterwards rather than the figure on the slider, and
 * a refusal is said in words instead of being dressed up as a subscription.
 *
 * The action is mocked. It is a server action and it makes the call; what
 * belongs here is what the screen does with each of its answers.
 */

vi.mock('../src/app/invest/subscribe/subscribe-actions.js', () => ({ subscribe: vi.fn() }));

const { SubscribeScreen } = await import('../src/app/invest/subscribe/subscribe-screen.js');
const { subscribe } = await import('../src/app/invest/subscribe/subscribe-actions.js');
const { DEMO_ACCOUNTS } = await import('../src/lib/wallet.js');
const { COUPONS, SERIES, unsubscribedSeries } = await import('./investor-fixtures.js');

afterEach(cleanup);

const investor = DEMO_ACCOUNTS['investor-1'];

/** 75,000: the 50,000 this noteholder carried plus the 25,000 on the slider. */
const LANDED = {
  ok: true,
  error: null,
  retry: false,
  subscribed: '75000000000',
  transaction: `https://hashscan.io/testnet/transaction/0x${'bb'.repeat(32)}`,
};

beforeEach(() => {
  vi.mocked(subscribe).mockResolvedValue(LANDED);
});

/** Everything a person reads, with the markup taken out. */
function visible(): string {
  return document.body.innerHTML
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Open the sheet and press the confirm inside it. */
function confirm(): void {
  const [openSheet] = screen.getAllByText('Subscribe 25,000');
  fireEvent.click(openSheet!);
  const buttons = screen.getAllByText('Subscribe 25,000');
  fireEvent.click(buttons[buttons.length - 1]!);
}

describe('the subscribe screen', () => {
  it('opens on the amount in the copy deck and names the outcome on the button', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(screen.getAllByText('Subscribe 25,000').length).toBeGreaterThan(0);
  });

  it('renames the button when the amount changes, so it always names the outcome', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40000' } });
    expect(screen.getAllByText('Subscribe 40,000').length).toBeGreaterThan(0);
  });

  it('says who settles a subscription before the press, not after it', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(visible()).toContain('This screen holds no key.');
    expect(visible()).toContain('under the subscription role');
  });

  it('names what the series covers, not only its identifier', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(visible()).toContain('ODI-COMP-2026-01');
    expect(visible()).toContain('Computer and mathematical');
  });

  it('shows the demo wallet label wherever the wallet shows', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(visible()).toContain('Demo wallet. Testnet only.');
  });

  it('sends the series and the amount on the slider, and nothing else', async () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '40000' } });
    const [openSheet] = screen.getAllByText('Subscribe 40,000');
    fireEvent.click(openSheet!);
    const buttons = screen.getAllByText('Subscribe 40,000');
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(vi.mocked(subscribe)).toHaveBeenCalledTimes(1));
    const form = vi.mocked(subscribe).mock.calls[0]![0];
    expect(form.get('series')).toBe('ODI-COMP-2026-01');
    expect(form.get('amount')).toBe('40000');
    // The account is the server's, never the form's: a body that could name its
    // own holder would let anybody have the API pay principal in for an address
    // of their choosing.
    expect(form.get('holder')).toBeNull();
  });

  it('reports the total the vault carries afterwards, not the amount on the slider', async () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    confirm();

    await waitFor(() => expect(visible()).toContain("You're subscribed"));
    const text = visible();
    // A subscription adds to what is already there, so 25,000 on top of the
    // 50,000 this noteholder carried reads 75,000 and never 25,000.
    expect(text).toContain('Subscribed 75,000');
    expect(text).toContain('This subscription on HashScan');
    expect(text).toContain('under the subscription role');
    // The settlement asset's own precision, not two decimals. Coupon amounts
    // are shown exactly everywhere now: a figure rounded for display sat
    // beside a HashScan receipt that disagreed with it, and six rows rounded
    // up summed to more than the total above them.
    expect(text).toContain('First coupon 4 September 2026, 328.767123');
    expect(text).toContain('View the series');
  });

  it('falls back to the position the page read where the answer carried no total', async () => {
    vi.mocked(subscribe).mockResolvedValue({ ...LANDED, subscribed: null });
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    confirm();

    await waitFor(() => expect(visible()).toContain("You're subscribed"));
    // 50,000 is what `subscriptionOf` returns for this noteholder on testnet.
    expect(visible()).toContain('Subscribed 50,000');
  });

  it('does not claim a subscription that was refused', async () => {
    vi.mocked(subscribe).mockResolvedValue({
      ok: false,
      error: 'That series has matured, so it takes no more money.',
      retry: false,
      subscribed: null,
      transaction: null,
    });
    render(
      <SubscribeScreen coupons={COUPONS} investor={investor} series={unsubscribedSeries()} />,
    );
    confirm();

    await waitFor(() =>
      expect(screen.getByText('That series has matured, so it takes no more money.')).toBeTruthy(),
    );
    expect(visible()).not.toContain("You're subscribed");
  });

  /**
   * The refusal a person cannot do anything about takes the button away. A
   * "Subscribe 25,000" button under a sentence saying it cannot be subscribed
   * is the screen telling somebody to do the one thing that cannot work.
   */
  it('takes the confirm away when another press cannot work', async () => {
    vi.mocked(subscribe).mockResolvedValue({
      ok: false,
      error: 'Subscriptions are not being settled here right now. Nothing was sent.',
      retry: false,
      subscribed: null,
      transaction: null,
    });
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    confirm();

    await waitFor(() => expect(screen.queryAllByText('Subscribe 25,000')).toHaveLength(1));
    expect(visible()).toContain('Nothing was sent.');
  });

  it('keeps the confirm where another press could work', async () => {
    vi.mocked(subscribe).mockResolvedValue({
      ok: false,
      error: 'The chain refused it. Nothing was subscribed.',
      retry: true,
      subscribed: null,
      transaction: null,
    });
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    confirm();

    await waitFor(() =>
      expect(screen.getByText('The chain refused it. Nothing was subscribed.')).toBeTruthy(),
    );
    // Waited for rather than read once: the refusal and the button are settled
    // inside the transition, and the pending flag clears on its own schedule.
    await waitFor(() => expect(screen.queryAllByText('Subscribe 25,000')).toHaveLength(2));
  });

  it('carries no em dash, no en dash and no percent glyph', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(visible()).not.toMatch(/[–—%]/);
  });
});
