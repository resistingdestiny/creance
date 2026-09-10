// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The chooser on the payment step.
 *
 * The point of T43 is that each label is true of what shipped, so most of what
 * is asserted here is copy: that the recommended option says the cover is held
 * in your wallet and the payment is still settled by us, that the demo option
 * is the one selected until somebody chooses otherwise, and that the World App
 * wallet's absence is explained rather than left looking like an oversight.
 *
 * The wallet itself is a fake. A WalletConnect session needs a phone, a wallet
 * application and a person to approve it, and the parts of it this app owns are
 * `testnetAccountId` and the provider factory, which wallet.test.ts covers.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));

vi.mock('../src/app/purchase-actions.js', () => ({
  connectWallet: vi.fn(),
  useDemoWallet: vi.fn(),
  payAndBind: vi.fn(),
}));

const { WalletChoice } = await import('../src/app/pay/wallet-choice.js');
const { useDemoWallet } = await import('../src/app/purchase-actions.js');
const { CONNECTED_ACCOUNT, fakeWallet, withWallet } = await import('./wallet-harness.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const own = () => screen.getByRole('radio', { name: /Your own wallet/ });
const demo = () => screen.getByRole('radio', { name: /Demo wallet/ });

describe('what the chooser offers', () => {
  beforeEach(() => {
    render(withWallet(<WalletChoice connectedAccount={null} onChanged={() => {}} />, fakeWallet()));
  });

  it('offers two options and no third one', () => {
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks the wallet option recommended and starts on the demo wallet all the same', () => {
    expect(own().textContent).toContain('Recommended');
    expect(demo().getAttribute('aria-checked')).toBe('true');
    expect(own().getAttribute('aria-checked')).toBe('false');
  });

  it('says what is yours and what is not, without claiming the payment is yours', () => {
    expect(
      screen.getByText(
        'The cover is held in your wallet. The monthly payment is still settled by us.',
      ),
    ).toBeTruthy();
  });

  it('explains the World App wallet rather than leaving it out', () => {
    expect(screen.getByText('World App holds your ID, Hedera holds the money.')).toBeTruthy();
  });

  it('warns that changing the wallet costs another check, before the tap', () => {
    expect(
      screen.getByText(
        "Changing this asks you to confirm you're a real person again, because the check is tied to the wallet that holds the cover.",
      ),
    ).toBeTruthy();
  });
});

describe('connecting', () => {
  it('names the account it connected and tells the step to turn back to the check', async () => {
    const onChanged = vi.fn();
    render(withWallet(<WalletChoice connectedAccount={null} onChanged={onChanged} />, fakeWallet()));

    fireEvent.click(own());

    await waitFor(() => expect(own().getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText(CONNECTED_ACCOUNT.accountId)).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('leaves the demo wallet selected when the wallet refuses, and says why', async () => {
    const onChanged = vi.fn();
    const refusing = fakeWallet({
      connect: async () => {
        throw new Error('The wallet did not approve the connection.');
      },
    });
    render(withWallet(<WalletChoice connectedAccount={null} onChanged={onChanged} />, refusing));

    fireEvent.click(own());

    await waitFor(() =>
      expect(screen.getByTestId('wallet-choice-error').textContent).toBe(
        'The wallet did not approve the connection.',
      ),
    );
    // Nothing was chosen, nothing was told to change, and the step is where it
    // was with everything on it intact.
    expect(demo().getAttribute('aria-checked')).toBe('true');
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('going back to the demo wallet', () => {
  it('ends the session on both sides and drops the cover from the connected account', async () => {
    const onChanged = vi.fn();
    const wallet = fakeWallet();
    render(
      withWallet(
        <WalletChoice connectedAccount={CONNECTED_ACCOUNT.accountId} onChanged={onChanged} />,
        wallet,
      ),
    );

    expect(own().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(demo());

    await waitFor(() => expect(demo().getAttribute('aria-checked')).toBe('true'));
    expect(useDemoWallet).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('a deployment with no Reown project id', () => {
  it('says so rather than offering an option it cannot honour', () => {
    render(withWallet(<WalletChoice connectedAccount={null} onChanged={() => {}} />));

    expect(
      screen.getByText(
        'This deployment has no WalletConnect project id, so only the demo wallet can be offered.',
      ),
    ).toBeTruthy();
    expect(own().hasAttribute('disabled')).toBe(true);
    expect(demo().getAttribute('aria-checked')).toBe('true');
  });
});
