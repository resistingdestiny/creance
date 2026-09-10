// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SubscribeScreen } from '../src/app/invest/subscribe/subscribe-screen.js';
import { DEMO_ACCOUNTS } from '../src/lib/wallet.js';
import { COUPONS, SERIES, unsubscribedSeries } from './investor-fixtures.js';

/**
 * The subscribe screen has three states and the interesting one is the last.
 *
 * The screen cannot sign. A subscription settles in two calls by two roles the
 * browser does not hold, so the confirm has to say who settles it before the
 * press, and the screen after the press has to report what the chain holds
 * rather than claim a transaction. These tests are what stops that promise
 * from quietly regressing into a fake receipt.
 */

afterEach(cleanup);

const investor = DEMO_ACCOUNTS['investor-1'];

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
    expect(visible()).toContain('This screen does not sign.');
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

  it('confirms into the position the chain holds, and says the screen sent nothing', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    const [openSheet] = screen.getAllByText('Subscribe 25,000');
    fireEvent.click(openSheet!);
    const buttons = screen.getAllByText('Subscribe 25,000');
    fireEvent.click(buttons[buttons.length - 1]!);

    const text = visible();
    expect(text).toContain("You're subscribed");
    expect(text).toContain('This screen does not sign.');
    // 50,000 is what `subscriptionOf` returns for this noteholder on testnet.
    // The 25,000 on the slider is never reported as having moved.
    expect(text).toContain('Subscribed 50,000');
    expect(text).toContain('First coupon 4 September 2026, 328.77');
    expect(text).toContain('View the series');
  });

  it('does not claim a subscription for an account that holds none', () => {
    render(
      <SubscribeScreen coupons={COUPONS} investor={investor} series={unsubscribedSeries()} />,
    );
    const [openSheet] = screen.getAllByText('Subscribe 25,000');
    fireEvent.click(openSheet!);
    const buttons = screen.getAllByText('Subscribe 25,000');
    fireEvent.click(buttons[buttons.length - 1]!);

    const text = visible();
    expect(text).toContain('Nothing was sent.');
    expect(text).not.toContain("You're subscribed");
  });

  it('carries no em dash, no en dash and no percent glyph', () => {
    render(<SubscribeScreen coupons={COUPONS} investor={investor} series={SERIES} />);
    expect(visible()).not.toMatch(/[–—%]/);
  });
});
