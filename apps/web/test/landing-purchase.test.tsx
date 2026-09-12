// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rest of the purchase, taken on the landing page.
 *
 * landing-quote.test.tsx carries the two steps T35 and T36 moved. This is the
 * two T37 moved, the World check and the payment, and the covered card they
 * settle on. The point of the ticket is that they moved and not that they were
 * rewritten, so every string asserted here is the string worker-screens.test
 * already asserts for /verify and /pay, and the server actions are the same
 * ones those routes call.
 *
 * The widget is the SDK's and is stubbed the way every other check screen test
 * stubs it: it records what it was handed and gives the test the callbacks
 * IDKit would call, because a Selfie Check needs a phone and a World ID.
 *
 * Every test here runs under prefers-reduced-motion, which is the branch where
 * the card arrives at the new step rather than travelling to it. That is a
 * supported path and not a shortcut: the copy, the actions, the states and the
 * focus are the same under it, and it is the whole reason the reduced branch
 * exists. It is chosen because these are the longest journeys in the suite, six
 * half turns to reach the covered card, and at 480ms a turn they were the
 * slowest file by a distance and pushed their neighbours past the timeout when
 * the workers ran in parallel. The turn itself is held at full speed by
 * landing-quote.test.tsx and landing-motion.test.tsx.
 */

/**
 * The whole landing page renders for every one of these, and the journeys on it
 * are long. Vitest's five second default is not enough for that once the
 * workers are running in parallel, and a test that fails only when its
 * neighbours are busy is worse than a slow one.
 */
vi.setConfig({ testTimeout: 20_000 });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
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

/** The widget is the SDK's. Here it records what it was handed and stands still. */
const widgetProps: Record<string, unknown>[] = [];
vi.mock('../src/app/verify/world-check.js', () => ({
  WorldCheck: (props: Record<string, unknown>) => {
    widgetProps.push(props);
    return <div data-testid="world-widget" />;
  },
}));

const { LandingScreen } = await import('../src/components/landing/landing-screen.js');
const { CONNECTED_ACCOUNT, fakeWallet, withWallet } = await import('./wallet-harness.js');
type WalletProvider = import('../src/lib/wallet.js').WalletProvider;
const {
  completeWorldCheck,
  continueToPay,
  continueToVerify,
  openPayment,
  payAndBind,
  priceCover,
  quoteOccupation,
  startWorldCheck,
  verifyPerson,
} = await import('../src/app/purchase-actions.js');
const { LIVE } = await import('./landing-fixtures.js');

const PRICE = {
  limit: '5,000',
  premium: '4.25',
  sentence:
    'Claims open in two ways: a sudden jump of 2 points above trend, or staying within 0.68 points of average. A jump of 4 pays in full.',
  usedPercent: 6,
  full: false,
  error: null,
};

/** The five rows of the pay sheet, as /pay is handed them. */
const CONFIRMATION = {
  cover: '5,000',
  occupation: 'Computer and mathematical',
  premium: '4.25',
  paysFrom: '0.0.10366453',
  walletLabel: 'Demo wallet. Testnet only.',
  heldIn: null,
  heldInLabel: null,
  receiptWarning: null,
};

/** The signed context the API answers with, as T11's own test records it. */
const CONTEXT = {
  app_id: 'app_8569aa8d1bbfb24b1243e86d4fc34adc',
  action: 'occupation-cover-eligibility',
  environment: 'staging',
  preset: 'selfieCheckLegacy',
  signal: '0.0.10366453',
  require_user_presence: false,
  rp_id: 'rp_d6ae9b4ff2018a15',
  nonce: '0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd',
  created_at: 1_700_000_000,
  expires_at: 1_700_000_300,
  signature: `0x${'a'.repeat(130)}`,
};

function page(interim = false, wallet?: WalletProvider) {
  return render(withWallet(<LandingScreen data={LIVE} interim={interim} />, wallet));
}

function panel() {
  return within(document.querySelector('[data-testid="landing-quote"]') as HTMLElement);
}

/**
 * A button on the face being read, by the name it carries when it is idle.
 *
 * A PillButton that is working keeps its label in the layout and paints the
 * pulsing dots over it, and the dots carry an sr-only "Working", so a button
 * mid-transition is named "RetryWorking" rather than "Retry" and is disabled.
 * Asking for the settled name is therefore also the wait for the transition
 * behind it, which is a separate commit from the one that put the step on
 * screen and can outlive it when the vitest workers are busy.
 */
async function settledButton(name: string): Promise<HTMLElement> {
  // Longer than testing-library's own second, because the transition being
  // waited for is a server action and the workers are all busy.
  return await waitFor(() => panel().getByRole('button', { name }), { timeout: 5000 });
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

/** Landing, occupation, cover amount, settled quote, check. Five half turns. */
async function toCheck(): Promise<void> {
  fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);
  await turned('What do you do?');
  fireEvent.click(row('Computer and mathematical'));
  fireEvent.click(await settledButton('Continue'));
  await turned('Cover amount');
  fireEvent.click(await settledButton('Continue'));
  await turned('Monthly payment');
  fireEvent.click(await settledButton('Continue'));
  await turned("Confirm you're a real person.");
}

/** The check, run and answered, which is the widget's two callbacks in order. */
async function passTheCheck(): Promise<void> {
  fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
  await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
  const props = widgetProps.at(-1) as Record<string, (result: unknown) => Promise<void> | void>;
  await act(async () => {
    await props['handleVerify']?.({ proof: '0x01' });
    props['onSuccess']?.(undefined);
  });
}

/** Through the check to the pay step, with the five rows on it. */
async function toPayment(): Promise<void> {
  await toCheck();
  await passTheCheck();
  await waitFor(() => expect(panel().getByText("You're verified")).toBeDefined());
  fireEvent.click(await settledButton('Continue'));
  await turned('Confirm your cover');
}

/** The card arrives at the step rather than travelling to it. */
function stubReducedMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  stubReducedMotion();
  widgetProps.length = 0;
  vi.mocked(quoteOccupation).mockResolvedValue(PRICE);
  vi.mocked(priceCover).mockResolvedValue(PRICE);
  vi.mocked(startWorldCheck).mockResolvedValue(CONTEXT);
  vi.mocked(completeWorldCheck).mockResolvedValue({
    ok: true,
    error: null,
    alreadyCovered: false,
    wrongCheck: false,
  });
  vi.mocked(verifyPerson).mockResolvedValue({
    ok: true,
    error: null,
    alreadyCovered: false,
    wrongCheck: false,
  });
  vi.mocked(openPayment).mockResolvedValue(CONFIRMATION);
  vi.mocked(payAndBind).mockResolvedValue({ ok: true, error: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('the check step is the verify screen, on the card', () => {
  it('carries the deck copy and the deck button', async () => {
    page();
    await toCheck();

    expect(
      panel().getByRole('heading', { level: 2, name: "Confirm you're a real person." }),
    ).toBeDefined();
    expect(
      panel().getByText('One person, one cover. This stops bots and duplicate accounts.'),
    ).toBeDefined();
    expect(panel().getByRole('button', { name: 'Verify with World ID' })).toBeDefined();
  });

  it('asks the API for a fresh signed context and waits for the World app', async () => {
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() =>
      expect(screen.getByTestId('landing-verify-state').textContent).toBe(
        'Waiting for the World app',
      ),
    );
    expect(startWorldCheck).toHaveBeenCalledTimes(1);
  });

  it('hands the widget the request the route hands it, unchanged', async () => {
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    expect(widgetProps.at(-1)?.['context']).toEqual(CONTEXT);
  });

  it('hangs the widget beside the card and never on a face of it', async () => {
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));

    // A widget mounted on a face is a widget a turn can unmount while a check
    // is still out on somebody's phone.
    const widget = await screen.findByTestId('world-widget');
    expect(document.querySelector('.cover-card-turn')?.contains(widget)).toBe(false);
  });

  it('runs the demo issuer, and says so, where there is no World app id', async () => {
    page(true);
    await toCheck();

    expect(panel().getByText(/Demo check\. Testnet only\./)).toBeDefined();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() => expect(verifyPerson).toHaveBeenCalledTimes(1));
    expect(startWorldCheck).not.toHaveBeenCalled();
    expect(widgetProps).toHaveLength(0);
  });

  /**
   * The same step on two surfaces has to behave the same way. /verify offers
   * the labelled demo check once a real one has been opened and left with
   * nothing, and this card is that step, so it offers it too. Without it the
   * front door is where a purchase stops on a deployment whose Selfie Check
   * cannot be completed.
   */
  it('offers the demo check on the card, once a real check has come back with nothing', async () => {
    page();
    await toCheck();

    expect(panel().queryByRole('button', { name: 'Use the demo check' })).toBeNull();
    expect(panel().queryByText(/Demo check\. Testnet only\./)).toBeNull();

    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    const onOpenChange = widgetProps.at(-1)?.['onOpenChange'] as (open: boolean) => void;
    act(() => onOpenChange(false));

    const demo = await settledButton('Use the demo check');
    expect(panel().getByText(/Demo check\. Testnet only\./)).toBeDefined();
    // The World check keeps the primary. The demo path is never it.
    expect(panel().getByRole('button', { name: 'Verify with World ID' })).toBeDefined();

    fireEvent.click(demo);
    await waitFor(() => expect(verifyPerson).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(panel().getByText("You're verified")).toBeDefined());
    expect(panel().getByText(/Demo check\. Testnet only\./)).toBeDefined();
  });

  it('says nothing when the person cancels, and leaves them where they were', async () => {
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));

    const onError = widgetProps.at(-1)?.['onError'] as (code: string) => void;
    await act(async () => onError('user_rejected'));

    // Back on the check, not at the top of the page and not at the start of the
    // quote. The card has not turned and the button is offered again.
    expect(
      panel().getByRole('heading', { level: 2, name: "Confirm you're a real person." }),
    ).toBeDefined();
    expect(panel().getByRole('button', { name: 'Verify with World ID' })).toBeDefined();
    expect(panel().queryByText("We couldn't verify you.")).toBeNull();
  });

  it('keeps the whole quote through a cancellation', async () => {
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    const onError = widgetProps.at(-1)?.['onError'] as (code: string) => void;
    await act(async () => onError('verification_rejected'));

    fireEvent.click(panel().getByRole('button', { name: 'Back' }));
    await turned('Monthly payment');
    expect(screen.getByTestId('landing-quote-monthly').textContent).toBe('4.25');
    expect(panel().getByText('5,000')).toBeDefined();
  });

  it('shows the deck failure with its retry when the check does not come back', async () => {
    vi.mocked(startWorldCheck).mockResolvedValue(null);
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() =>
      expect(
        panel().getByRole('heading', { level: 2, name: "We couldn't verify you." }),
      ).toBeDefined(),
    );
    expect(panel().getByText('Try again, or use a different device.')).toBeDefined();
    const retry = await settledButton('Try again');
    expect(retry).toHaveProperty('disabled', false);
  });

  /**
   * The same second failure as the route's, on the card. The card does not turn
   * and the button offers the check again, because the answer is a different
   * check rather than a different device. T42.
   */
  it('names the check to run when the one that came back is of another kind', async () => {
    vi.mocked(completeWorldCheck).mockResolvedValue({
      ok: false,
      error: "That check isn't the one we asked for.",
      alreadyCovered: false,
      wrongCheck: true,
    });
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    const props = widgetProps.at(-1) as Record<string, (result: unknown) => Promise<void>>;
    await act(async () => {
      await props['handleVerify']?.({ proof: '0x01' }).catch(() => undefined);
    });

    await waitFor(() =>
      expect(
        panel().getByRole('heading', { level: 2, name: "That check isn't the one we asked for." }),
      ).toBeDefined(),
    );
    expect(panel().getByText('Open the World app and run the face check.')).toBeDefined();
    expect(panel().getByRole('button', { name: 'Verify with World ID' })).toBeDefined();
    expect(panel().queryByText("We couldn't verify you.")).toBeNull();
  });

  it('reads one person one cover as a rule and offers the cover they have', async () => {
    vi.mocked(completeWorldCheck).mockResolvedValue({
      ok: false,
      error: 'One person, one cover. This stops bots and duplicate accounts.',
      alreadyCovered: true,
      wrongCheck: false,
    });
    page();
    await toCheck();
    fireEvent.click(panel().getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    const props = widgetProps.at(-1) as Record<string, (result: unknown) => Promise<void>>;
    await act(async () => {
      await expect(props['handleVerify']?.({ proof: '0x01' })).rejects.toThrow();
    });

    expect(panel().getByRole('heading', { level: 2, name: 'Covered' })).toBeDefined();
    expect(panel().getByRole('button', { name: 'Cover' })).toBeDefined();
    expect(panel().queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('the pay step is the pay sheet, on the card', () => {
  it('takes a fresh quote before the card turns to it', async () => {
    page();
    await toCheck();
    await passTheCheck();
    await waitFor(() => expect(panel().getByText("You're verified")).toBeDefined());
    expect(openPayment).not.toHaveBeenCalled();

    fireEvent.click(await settledButton('Continue'));
    await turned('Confirm your cover');
    expect(openPayment).toHaveBeenCalledTimes(1);
  });

  it('carries the deck title, the five rows and the button that names the price', async () => {
    page();
    await toPayment();

    expect(panel().getByRole('heading', { level: 2, name: 'Confirm your cover' })).toBeDefined();
    for (const label of [
      'Cover',
      'Occupation',
      'Monthly payment',
      'First payment today',
      'Pays from',
    ]) {
      expect(panel().getByText(label)).toBeDefined();
    }
    expect(panel().getByText('0.0.10366453')).toBeDefined();
    expect(panel().getByText('Demo wallet. Testnet only.')).toBeDefined();
    expect(panel().getByRole('button', { name: 'Pay 4.25' })).toBeDefined();
  });

  it('says what the press does before the press', async () => {
    page();
    await toPayment();
    expect(
      panel().getByText(/The first payment leaves the wallet above as soon as you press/),
    ).toBeDefined();
  });

  it('binds through the same action the route binds through', async () => {
    page();
    await toPayment();
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));

    await waitFor(() => expect(payAndBind).toHaveBeenCalledTimes(1));
  });

  it('opens the deck payment failure in place, with the amount in it', async () => {
    vi.mocked(payAndBind).mockResolvedValue({
      ok: false,
      error: 'The payment did not settle.',
    });
    page();
    await toPayment();
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));

    await waitFor(() => expect(screen.getByTestId('landing-payment-failed')).toBeDefined());
    expect(panel().getByText("Your payment didn't go through.")).toBeDefined();
    expect(panel().getByText('The payment did not settle.')).toBeDefined();
    expect(panel().getByRole('button', { name: 'Pay 4.25' })).toBeDefined();
  });

  it('offers the wallet chooser above the rows, on the demo wallet', async () => {
    page(false, fakeWallet());
    await toPayment();

    expect(panel().getByRole('radio', { name: /Demo wallet/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(panel().getByRole('radio', { name: /Your own wallet/ })).toBeDefined();
    expect(panel().getByText('World App holds your ID, Hedera holds the money.')).toBeDefined();
  });

  it('turns back to the check when another wallet is chosen, because the check went with it', async () => {
    page(false, fakeWallet());
    await toPayment();

    fireEvent.click(panel().getByRole('radio', { name: /Your own wallet/ }));

    // Back on the check, and asking for it again rather than still claiming the
    // person is verified: the credential named the wallet they just put down.
    await turned("Confirm you're a real person.");
    expect(panel().queryByText("You're verified")).toBeNull();
    expect(panel().getByRole('button', { name: 'Verify with World ID' })).toBeDefined();
  });

  it('names the account it connected once the card comes back to the pay step', async () => {
    page(false, fakeWallet());
    await toPayment();

    fireEvent.click(panel().getByRole('radio', { name: /Your own wallet/ }));
    await turned("Confirm you're a real person.");

    vi.mocked(openPayment).mockResolvedValue({
      ...CONFIRMATION,
      heldIn: CONNECTED_ACCOUNT.accountId,
      heldInLabel: 'Your own wallet. Hedera testnet.',
      walletLabel: 'Settled by the service. Testnet only.',
    });
    await passTheCheck();
    await waitFor(() => expect(panel().getByText("You're verified")).toBeDefined());
    fireEvent.click(await settledButton('Continue'));
    await turned('Confirm your cover');

    // Two rows, because the cover and the premium name different accounts until
    // the x402 authorisation moves into the browser.
    expect(panel().getByText('Cover held in')).toBeDefined();
    // Twice: once on the chooser's own row and once on the sheet's.
    expect(panel().getAllByText(CONNECTED_ACCOUNT.accountId)).toHaveLength(2);
    expect(panel().getByText('Pays from')).toBeDefined();
    expect(panel().getByText('Settled by the service. Testnet only.')).toBeDefined();
  });

  it('says so on the card when there is no price to confirm', async () => {
    vi.mocked(openPayment).mockResolvedValue(null);
    page();
    await toCheck();
    await passTheCheck();
    await waitFor(() => expect(panel().getByText("You're verified")).toBeDefined());
    fireEvent.click(await settledButton('Continue'));
    await turned("We can't reach the index right now.");

    // No premium is invented and no button names one.
    expect(panel().queryByText(/^Pay /)).toBeNull();
    const retry = await settledButton('Retry');
    expect(retry).toHaveProperty('disabled', false);
  });
});

describe('the card settles into covered', () => {
  it('wears the pill it has earned, and only now', async () => {
    page();
    await toPayment();
    expect(panel().queryByText('Covered')).toBeNull();

    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));
    await turned('Covered');
    expect(panel().getByText('Covered')).toBeDefined();
  });

  it('holds the cover and the payment that was actually made', async () => {
    page();
    await toPayment();
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));
    await turned('Covered');

    expect(panel().getByTestId('display-number').textContent).toBe('5,000');
    expect(screen.getByTestId('landing-covered-monthly').textContent).toBe('4.25');
  });

  it('offers the cover as a link rather than as one more step', async () => {
    page();
    await toPayment();
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));
    await turned('Covered');

    const link = panel().getByRole('link', { name: 'See your cover' });
    // Plain /home. The query that makes Home perform the moment is not passed,
    // because the moment has just happened here and it happens once.
    expect(link.getAttribute('href')).toBe('/home');
  });

  it('sets the cover in one step, with no frames asked for', async () => {
    page();
    await toPayment();
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));
    await turned('Covered');

    expect(panel().getByTestId('display-number').textContent).toBe('5,000');
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
  });
});

describe('the journey never leaves the page', () => {
  it('reaches covered without either redirect being called', async () => {
    page();
    await toPayment();
    fireEvent.click(panel().getByRole('button', { name: 'Pay 4.25' }));
    await turned('Covered');

    // The two redirects are what the /amount and /verify routes submit. Nothing
    // on this page submits either of them.
    expect(continueToVerify).not.toHaveBeenCalled();
    expect(continueToPay).not.toHaveBeenCalled();
    // The page around the quote is still the page it was.
    expect(screen.getByText('Cover for the day your job is automated.')).toBeDefined();
  });

  it('completes the last three steps from the keyboard alone', async () => {
    page();
    await toCheck();

    const verify = panel().getByRole('button', { name: 'Verify with World ID' });
    verify.focus();
    expect(document.activeElement).toBe(verify);
    fireEvent.click(verify);
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));
    const props = widgetProps.at(-1) as Record<string, (result: unknown) => Promise<void> | void>;
    await act(async () => {
      await props['handleVerify']?.({ proof: '0x01' });
      props['onSuccess']?.(undefined);
    });

    const onward = await settledButton('Continue');
    onward.focus();
    fireEvent.click(onward);
    await turned('Confirm your cover');
    // Focus follows the card to the step that arrived, so a keyboard user is on
    // it rather than at the top of the page.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Confirm your cover'));

    const pay = panel().getByRole('button', { name: 'Pay 4.25' });
    pay.focus();
    fireEvent.click(pay);
    await turned('Covered');
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Computer and mathematical'),
    );
  });
});
