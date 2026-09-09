// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two check screens on the World App surface, against the browser flow they
 * have to keep.
 *
 * `window.WorldApp` is the object World App injects into its webview and the one
 * thing MiniKit reads to know where it is, so setting it is how these screens are
 * asked to render as a Mini App. What it cannot show is the native sheet itself:
 * that needs a phone, and the widget here is stubbed the way the other screen
 * tests stub it.
 *
 * The point of the file is that the surface changes the copy and nothing else.
 * The props the widget is handed are captured and compared between the two
 * surfaces, because "the same preset, rp_context and verify path as T11" is the
 * acceptance and a second configuration for World App would be the way to break
 * it.
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

vi.mock('../src/app/claim-actions.js', () => ({
  addEvidence: vi.fn(),
  backToCover: vi.fn(),
  beginClaim: vi.fn(),
  completeClaimCheck: vi.fn(),
  continueToConfirm: vi.fn(),
  continueToJob: vi.fn(),
  continueToReview: vi.fn(),
  readClaimStatus: vi.fn(async () => null),
  saveJob: vi.fn(),
  startClaimCheck: vi.fn(),
  submitAgain: vi.fn(),
  submitPacket: vi.fn(),
  useDemoPresence: vi.fn(),
}));

/** The widget is the SDK's. Here it only records what it was handed. */
const widgetProps: Record<string, unknown>[] = [];
vi.mock('../src/app/verify/world-check.js', () => ({
  WorldCheck: (props: Record<string, unknown>) => {
    widgetProps.push(props);
    return null;
  },
}));

const { Providers } = await import('../src/app/providers.js');
const { LandingScreen } = await import('../src/components/landing/landing-screen.js');
const { VerifyScreen } = await import('../src/app/verify/verify-screen.js');
const { ConfirmScreen } = await import('../src/app/claim/confirm/confirm-screen.js');
const { quoteOccupation, startWorldCheck } = await import('../src/app/purchase-actions.js');
const { startClaimCheck } = await import('../src/app/claim-actions.js');
const { LIVE } = await import('./landing-fixtures.js');

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

/** The shape World App injects, with the fields MiniKit reads at install. */
const WORLD_APP = {
  world_app_version: 2_500_000,
  device_os: 'ios',
  supported_commands: [],
  is_optional_analytics: false,
  safe_area_insets: { top: 47, right: 0, bottom: 34, left: 0 },
};

function enterWorldApp() {
  (window as unknown as Record<string, unknown>)['WorldApp'] = WORLD_APP;
}

beforeEach(() => {
  widgetProps.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(startWorldCheck).mockResolvedValue(CONTEXT);
  vi.mocked(startClaimCheck).mockResolvedValue({
    ...CONTEXT,
    action: 'occupation-cover-claim',
    require_user_presence: true,
    signal: 'pol_01JX8Z',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)['WorldApp'];
  delete (window as unknown as Record<string, unknown>)['MiniKit'];
});

async function openTheCheck(button = 'Verify with World ID') {
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
}

describe('the purchase check inside World App', () => {
  it('says the check is being confirmed rather than waited for', async () => {
    enterWorldApp();
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );

    await openTheCheck();

    expect(screen.getByRole('status').textContent).toBe('Confirming with World ID');
  });

  it('keeps the deck string in a browser', async () => {
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );

    await openTheCheck();

    expect(screen.getByRole('status').textContent).toBe('Waiting for the World app');
  });

  it('hands the widget the same request on both surfaces', async () => {
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );
    await openTheCheck();
    const inBrowser = widgetProps.at(-1)?.['context'];

    cleanup();
    enterWorldApp();
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );
    await openTheCheck();
    const inWorldApp = widgetProps.at(-1)?.['context'];

    expect(inWorldApp).toEqual(inBrowser);
    expect(inWorldApp).toEqual(CONTEXT);
  });

  it('does not offer a second device when there is no second device', async () => {
    enterWorldApp();
    vi.mocked(startWorldCheck).mockResolvedValue(null);
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() => expect(screen.getByText('Try again.')).toBeTruthy());
    expect(screen.queryByText('Try again, or use a different device.')).toBeNull();
  });
});

describe('the claim check inside World App', () => {
  it('says the check is being confirmed rather than waited for', async () => {
    enterWorldApp();
    render(
      <Providers>
        <ConfirmScreen alreadyVerified={false} demo={false} />
      </Providers>,
    );

    await openTheCheck();

    expect(screen.getByRole('status').textContent).toBe('Confirming with World ID');
  });

  it('keeps the deck string in a browser', async () => {
    render(
      <Providers>
        <ConfirmScreen alreadyVerified={false} demo={false} />
      </Providers>,
    );

    await openTheCheck();

    expect(screen.getByRole('status').textContent).toBe('Waiting for the World app');
  });
});

/**
 * The same check on the landing card, which is where T37 put it.
 *
 * The ticket's hard constraint is that the check was moved and not rewritten,
 * so the comparison that matters is between the request the route hands the
 * widget and the request the landing page hands it. They are the same object.
 * The surface still decides only the copy, on the card as on the route.
 */
describe('the purchase check on the landing page', () => {
  const PRICE = {
    limit: '5,000',
    premium: '4.25',
    sentence: 'Pays out if the index rises 2 points above its trend.',
    usedPercent: 6,
    full: false,
    error: null,
  };

  /** Waits for the card to finish turning to the face that carries this. */
  async function turned(text: string) {
    await waitFor(
      () => expect(document.querySelector('[data-facing="viewer"]')?.textContent).toContain(text),
      { timeout: 3000 },
    );
  }

  /**
   * Landing to the check step, which is four half turns of the card. Taken
   * under prefers-reduced-motion, where the card arrives at each step rather
   * than travelling to it, because what these three hold is the request and the
   * copy and not the turn. landing-quote.test.tsx holds the turn.
   */
  async function toTheCheck() {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.mocked(quoteOccupation).mockResolvedValue(PRICE);
    render(
      <Providers>
        <LandingScreen data={LIVE} interim={false} />
      </Providers>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Get a quote' })[0]!);
    await turned('What do you do?');
    fireEvent.click(
      screen
        .getAllByRole('button')
        .find((button) => button.textContent?.startsWith('Computer and mathematical') === true)!,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await turned('Cover amount');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await turned('Monthly payment');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await turned("Confirm you're a real person.");
  }

  it('hands the widget the request the route hands it, on either surface', async () => {
    render(
      <Providers>
        <VerifyScreen alreadyVerified={false} interim={false} />
      </Providers>,
    );
    await openTheCheck();
    const onTheRoute = widgetProps.at(-1)?.['context'];

    cleanup();
    enterWorldApp();
    await toTheCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(1));
    const onTheCard = widgetProps.at(-1)?.['context'];

    expect(onTheCard).toEqual(onTheRoute);
    expect(onTheCard).toEqual(CONTEXT);
  });

  it('says the check is being confirmed rather than waited for, inside World App', async () => {
    enterWorldApp();
    await toTheCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() =>
      expect(screen.getByTestId('landing-verify-state').textContent).toBe(
        'Confirming with World ID',
      ),
    );
  });

  it('keeps the deck string in a browser', async () => {
    await toTheCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));

    await waitFor(() =>
      expect(screen.getByTestId('landing-verify-state').textContent).toBe(
        'Waiting for the World app',
      ),
    );
  });
});
