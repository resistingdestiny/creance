// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The seven screens of the worker flow, against their own copy.
 *
 * Every string the copy deck fixes is asserted here, because "exactly as the
 * copy deck" is the acceptance and a paraphrase is the easiest thing in this
 * ticket to ship by accident. The figures come from the recorded testnet
 * responses in worker-fixtures.ts.
 *
 * The screens are rendered with their props. The routes above them fetch, and
 * what they fetch is tested through worker-model.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  openWithCoverKey: vi.fn(),
  payAndBind: vi.fn(),
  priceCover: vi.fn(),
  signInWithWorld: vi.fn(),
  signOutOfCover: vi.fn(),
  startAgain: vi.fn(),
  startSignInCheck: vi.fn(),
  startWorldCheck: vi.fn(),
  verifyPerson: vi.fn(),
}));

/**
 * The widget is the SDK's, not ours, and it opens a QR code and polls World.
 * The screen's contract with it is four callbacks, so it is stubbed here and
 * the SDK is exercised on the Sandbox App instead.
 */
const widgetProps: Record<string, unknown>[] = [];
vi.mock('../src/app/verify/world-check.js', () => ({
  WorldCheck: (props: Record<string, unknown>) => {
    widgetProps.push(props);
    return null;
  },
}));

const { AmountScreen } = await import('../src/app/amount/amount-screen.js');
const { IndexScreen } = await import('../src/app/cover/index/index-screen.js');
const { HomeScreen } = await import('../src/app/home/home-screen.js');
const { OccupationPicker } = await import(
  '../src/app/occupation/occupation-picker.js'
);
const { PayScreen } = await import('../src/app/pay/pay-screen.js');
const { VerifyScreen } = await import('../src/app/verify/verify-screen.js');
const { completeWorldCheck, startWorldCheck, verifyPerson } = await import(
  '../src/app/purchase-actions.js'
);
const { OCCUPATIONS } = await import('../src/lib/occupations.js');
const { homeStatus } = await import('../src/lib/claim-model.js');
const {
  bandLabelFor,
  chartDescription,
  chartPoints,
  chartThreshold,
  headlineReading,
  indexMargins,
  lineIsNegative,
  whatWouldHaveHappened,
} = await import('../src/lib/worker-model.js');
const { INDEX, openIndex } = await import('./worker-fixtures.js');
const { withWallet } = await import('./wallet-harness.js');

afterEach(() => {
  widgetProps.length = 0;
  cleanup();
});

describe('the occupation picker', () => {
  it('puts all fifteen in one list, with no heading over it at all', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('What do you do?');
    const rows = screen.getAllByRole('button').filter((node) => node.textContent !== 'Continue');
    // T38 grouped the list when one occupation was buyable and fourteen were
    // not. Every one carries a series now, so the open group holds all fifteen,
    // the no cover group is not rendered, and neither heading is drawn: they
    // name the two parts of a split list and there is no split.
    expect(rows).toHaveLength(15);
    expect(rows[0]?.textContent).toContain('Office and administrative support');
    expect(screen.queryByText(/Open to buy/)).toBeNull();
    expect(screen.queryByText(/No cover behind these yet/)).toBeNull();
    expect(screen.getByText('Office and administrative support')).toBeTruthy();
    expect(screen.getByText('Farming, fishing and forestry')).toBeTruthy();
  });

  it('offers every occupation, because every one has a series behind it', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    const selectable = screen
      .getAllByRole('button')
      .filter((node) => node.textContent !== 'Continue');
    expect(selectable[0]?.textContent).toContain('Office and administrative support');
    expect(selectable).toHaveLength(OCCUPATIONS.length);
  });

  it('has nothing left to say cannot be chosen', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    expect(screen.queryAllByText(/No cover behind this occupation yet\./)).toHaveLength(0);
  });

  it('is a list of names and nothing else', () => {
    // The rows carried two facts about each occupation's history, that claims
    // had never opened for it and that its level line had never been reached.
    // Five of fifteen carried one or both, which made a chooser read as a list
    // of warnings and made the ten with nothing said about them look like the
    // safe ones. Both facts are on the index pages, where somebody reading
    // about an index is.
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    const rows = screen
      .getAllByRole('button')
      .filter((node) => node.textContent !== 'Continue');
    expect(rows).toHaveLength(OCCUPATIONS.length);
    for (const row of rows) {
      const label = OCCUPATIONS.find((entry) => row.textContent === entry.label);
      expect(row.textContent, row.textContent ?? '').toBe(label?.label);
    }
  });

  it('disables Continue until a row is chosen', () => {
    const { unmount } = render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true);
    unmount();
    render(<OccupationPicker chosen="computer_math" rows={OCCUPATIONS} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', false);
  });

  it('has a search field labelled as the copy deck writes it', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    expect(screen.getByLabelText('Search occupations')).toBeTruthy();
  });
});

describe('the cover amount screen', () => {
  const price = {
    limit: '1,000',
    premium: '0.86',
    sentence:
      'Claims open in two ways: a sudden jump of 2 points above trend, or staying within 0.68 points of average. A jump of 4 pays in full.',
    usedPercent: 6,
    full: false,
    error: null,
  };

  it('writes the premium as "{premium} a month"', () => {
    render(<AmountScreen initial={price} limit={1000} occupation="Computer and mathematical" />);
    expect(screen.getByTestId('amount-premium').textContent).toBe('0.86 a month');
  });

  it('carries the interpolated sentence, the link and the primary', () => {
    render(<AmountScreen initial={price} limit={1000} occupation="Computer and mathematical" />);
    expect(screen.getByText(price.sentence)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'How the index works' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('runs the slider over the offered range in steps of 500', () => {
    render(<AmountScreen initial={price} limit={1000} occupation="Computer and mathematical" />);
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('min')).toBe('1000');
    expect(slider.getAttribute('max')).toBe('10000');
    expect(slider.getAttribute('step')).toBe('500');
  });

  it('stops at a series with no capacity and says why', () => {
    render(
      <AmountScreen
        initial={{ ...price, premium: '', sentence: '', full: true, error: 'This series is full. Choose a smaller amount or try again later.' }}
        limit={1000}
        occupation="Computer and mathematical"
      />,
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toContain('This series is full.');
  });
});

describe('the verify screen', () => {
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

  it('carries the copy deck strings and says the check is the demo one', () => {
    render(<VerifyScreen alreadyVerified={false} interim />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      "Confirm you're a real person.",
    );
    expect(
      screen.getByText('One person, one cover. This stops bots and duplicate accounts.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
    expect(screen.getByText(/Demo check\. Testnet only\./)).toBeTruthy();
  });

  it('does not claim a Selfie Check it did not run', () => {
    render(<VerifyScreen alreadyVerified={false} interim />);
    expect(screen.getByText(/without running a World Selfie Check/)).toBeTruthy();
  });

  it('drops the demo line when the World check is the one running', () => {
    render(<VerifyScreen alreadyVerified={false} interim={false} />);
    expect(screen.queryByText(/Demo check\. Testnet only\./)).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use the demo check' })).toBeNull();
  });

  /**
   * The dead end this screen must not have. The widget can be opened and shut
   * with nothing decided, which is what a device that cannot finish a Selfie
   * Check leaves behind, and without a second way through, a purchase stops
   * here for good. The demo check appears after the attempt and never before
   * it, it is the secondary, and it says what it is.
   */
  it('offers the demo check, labelled, once a real check has come back with nothing', async () => {
    vi.mocked(startWorldCheck).mockResolvedValue(CONTEXT);
    vi.mocked(verifyPerson).mockResolvedValue({
      ok: true,
      error: null,
      alreadyCovered: false,
      wrongCheck: false,
    });
    render(<VerifyScreen alreadyVerified={false} interim={false} />);

    expect(screen.queryByRole('button', { name: 'Use the demo check' })).toBeNull();
    expect(screen.queryByText(/Demo check\. Testnet only\./)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));

    // The sheet shut with nothing decided, which is what the widget reports
    // when a device cannot finish the check.
    const onOpenChange = widgetProps.at(-1)?.['onOpenChange'] as (open: boolean) => void;
    act(() => onOpenChange(false));

    const demo = await screen.findByRole('button', { name: 'Use the demo check' });
    expect(screen.getByText(/Demo check\. Testnet only\./)).toBeTruthy();
    // Still the secondary. The World check keeps the primary.
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();

    fireEvent.click(demo);
    await waitFor(() => expect(verifyPerson).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("You're verified"));
    // And it still says what verified them, on the screen where the next press
    // pays for cover.
    expect(screen.getByText(/Demo check\. Testnet only\./)).toBeTruthy();
  });

  it('shows the verified state when the credential is already held', () => {
    render(<VerifyScreen alreadyVerified interim />);
    expect(screen.getByRole('status').textContent).toBe("You're verified");
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  /**
   * The state the deck string was written for: the check has left for another
   * application and this screen is waiting for it to come back.
   */
  it('waits for the World app once the request context is signed', async () => {
    vi.mocked(startWorldCheck).mockResolvedValue(CONTEXT);
    render(<VerifyScreen alreadyVerified={false} interim={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Waiting for the World app'),
    );
    expect(startWorldCheck).toHaveBeenCalled();
  });

  it('falls to the failure copy when no context can be signed', async () => {
    vi.mocked(startWorldCheck).mockResolvedValue(null);
    render(<VerifyScreen alreadyVerified={false} interim={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        "We couldn't verify you.",
      ),
    );
    expect(screen.getByText('Try again, or use a different device.')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
  });

  /**
   * The second failure, and the one the deck gained in T42. "Try again, or use
   * a different device" is the wrong answer here: the device that answered will
   * answer with the same kind of check next time, so the screen names the check
   * to run instead and its button opens the widget rather than repeating.
   */
  it('names the check to run when the one that came back is of another kind', async () => {
    vi.mocked(startWorldCheck).mockResolvedValue(CONTEXT);
    vi.mocked(completeWorldCheck).mockResolvedValue({
      ok: false,
      error: "That check isn't the one we asked for.",
      alreadyCovered: false,
      wrongCheck: true,
    });
    render(<VerifyScreen alreadyVerified={false} interim={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify with World ID' }));
    await waitFor(() => expect(widgetProps.length).toBeGreaterThan(0));

    const handleVerify = widgetProps.at(-1)?.['handleVerify'] as (
      result: unknown,
    ) => Promise<void>;
    // It throws so that the widget never calls onSuccess, which is the contract
    // the hook keeps with the SDK. The state it left behind is what matters.
    await act(async () => {
      await handleVerify({ proof: '0x01' }).catch(() => undefined);
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
        "That check isn't the one we asked for.",
      ),
    );
    expect(screen.getByText('Open the World app and run the face check.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
    expect(screen.queryByText('Try again, or use a different device.')).toBeNull();
  });
});

describe('the pay sheet', () => {
  function renderSheet() {
    return render(
      withWallet(
        <PayScreen
          cover="1,000"
          heldIn={null}
          heldInLabel={null}
          occupation="Computer and mathematical"
          paysFrom="0.0.10366453"
          premium="0.86"
          receiptWarning={null}
          walletLabel="Demo wallet. Testnet only."
        />,
      ),
    );
  }

  it('is titled as the copy deck titles it and names the outcome on the button', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Confirm your cover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay 0.86' })).toBeTruthy();
  });

  it('carries the five rows in order', () => {
    renderSheet();
    const sheet = screen.getByRole('dialog');
    for (const label of [
      'Cover',
      'Occupation',
      'Monthly payment',
      'First payment today',
      'Pays from',
    ]) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
  });

  it('pays from the wallet account id, labelled as a demo', () => {
    renderSheet();
    expect(screen.getByText('0.0.10366453')).toBeTruthy();
    expect(screen.getByText('Demo wallet. Testnet only.')).toBeTruthy();
  });

  it('says what the press does before the press', () => {
    renderSheet();
    expect(screen.getByText(/The first payment leaves the wallet above as soon as you press/)).toBeTruthy();
  });
});

describe('home', () => {
  /** One recorded audit entry, the shape src/lib/audit-api.ts describes. */
  const ENTRY = {
    kind: 'premium',
    source: 'topic' as const,
    at: '2026-09-05T10:00:00Z',
    amount: { amount: '860000', asset: '0.0.10366465', decimals: 6, display: '0.86' },
    hcs: {
      topic_id: '0.0.10366471',
      sequence_number: 42,
      consensus_at: '2026-09-05T10:00:01Z',
      hashscan: 'https://hashscan.io/testnet/topic/0.0.10366471',
    },
    tx: null,
    detail: {},
  };

  function renderHome(
    bound: boolean,
    extras: Partial<Parameters<typeof HomeScreen>[0]> = {},
  ) {
    return render(
      <HomeScreen
        bound={bound}
        chart={{
          points: chartPoints(INDEX),
          threshold: chartThreshold(INDEX),
          bandLabel: bandLabelFor(INDEX),
          description: chartDescription(INDEX),
          open: false,
        }}
        view={{
          policyId: 'pol_01M1S3EBDQR3W79A9E8MR6MPYB',
          occupation: 'Computer and mathematical',
          cover: 1000,
          status: homeStatus('covered'),
          nextPayment: '0.86 on 5 October',
          index: { value: '0.69, falling', caption: 'Points from opening claims.' },
          claimsOpen: null,
          paid: null,
          lapsed: null,
          replayBadge: null,
        }}
        {...extras}
      />,
    );
  }

  it('shows the card, the state and the two rows', () => {
    renderHome(false);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Cover');
    expect(screen.getByText('Covered')).toBeTruthy();
    expect(screen.getByText('Next payment')).toBeTruthy();
    expect(screen.getByText('0.86 on 5 October')).toBeTruthy();
    // "Index" twice: the row label and the tab bar.
    expect(screen.getAllByText('Index')).toHaveLength(2);
    expect(screen.getByText('0.69, falling')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the index' })).toBeTruthy();
  });

  it('renders the cover amount with a thousands separator', () => {
    renderHome(false);
    expect(screen.getByTestId('display-number').textContent).toBe('1,000');
  });

  it('runs the orchestrated moment only on arriving from the pay sheet', () => {
    const { unmount } = renderHome(false);
    expect(screen.getByTestId('home-card').className).not.toContain('cover-card-enter');
    unmount();
    renderHome(true);
    const card = screen.getByTestId('home-card');
    expect(card.className).toContain('cover-card-enter');
    // The slide is a CSS animation, so reduced motion switches it off in CSS
    // and not in a script.
    expect(card.className).toContain('motion-reduce:animate-none');
  });

  it('drops the query that fires the moment, so a reload is not a second one', () => {
    renderHome(true);
    expect(window.location.pathname).toBe('/home');
    expect(window.location.search).toBe('');
  });

  /**
   * The card carries the state as a colour and a label. A colour is not a
   * sentence, so the dashboard says it in words as well.
   */
  it('says whether you are covered in words, in every state', () => {
    const sentences: Record<string, string> = {
      covered: "You're covered.",
      claims_open: 'Claims are open for your occupation.',
      claim_in_progress: 'Your claim is being decided.',
      paid: 'Your claim has been paid.',
      lapsed: 'Your cover needs a payment.',
    };
    for (const [state, sentence] of Object.entries(sentences)) {
      const { unmount } = renderHome(false, {
        view: {
          policyId: 'pol_01M1S3EBDQR3W79A9E8MR6MPYB',
          occupation: 'Computer and mathematical',
          cover: 1000,
          status: homeStatus(state as Parameters<typeof homeStatus>[0]),
          nextPayment: '0.86 on 5 October',
          index: { value: '0.69, falling', caption: 'Points from opening claims.' },
          claimsOpen: null,
          paid: null,
          lapsed: null,
          replayBadge: null,
        },
      });
      expect(screen.getByText(sentence)).toBeTruthy();
      unmount();
    }
  });

  /**
   * A fixture has no claim session and no purchase session, so the controls
   * that would need one do not move.
   *
   * They used to. "See your claim" followed /claim/status to the sign in
   * screen, and "Pay" followed /pay through /verify to "What do you do?", the
   * funnel for buying a cover the reader is already looking at. Landing
   * somebody in an unrelated flow is worse than a control that does nothing:
   * the screen says on its own face that it is drawn from fixtures.
   */
  it('does not let a fixture press a control that needs a session', () => {
    const base = {
      policyId: 'pol_01M1S3EBDQR3W79A9E8MR6MPYB',
      occupation: 'Computer and mathematical',
      cover: 1000,
      nextPayment: '0.86 on 5 October',
      index: { value: '0.69, falling', caption: 'Points from opening claims.' },
      claimsOpen: null,
      paid: null,
      replayBadge: null,
    };

    const claim = renderHome(false, {
      demo: true,
      view: { ...base, status: homeStatus('claim_in_progress'), lapsed: null },
    });
    const seeClaim = screen.getByRole('button', { name: 'See your claim' });
    expect(seeClaim.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('a[href="/claim/status"]')).toBeNull();
    claim.unmount();

    renderHome(false, {
      demo: true,
      view: {
        ...base,
        status: homeStatus('lapsed'),
        lapsed: {
          heading: 'Payment due',
          line: 'Your cover needs a payment.',
          action: 'Pay 4.25',
        },
      },
    });
    expect(screen.getByRole('button', { name: 'Pay 4.25' }).hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('a[href="/pay"]')).toBeNull();
  });

  /**
   * docs/DESIGN-TOKENS.md section 5: the Home row's chart is 64 by 20 and
   * carries no band unless the state is triggered, and never a gridline, a dot
   * or a legend.
   */
  it('draws the index line at the size the chart rules give the Home row', () => {
    renderHome(false);
    // Under main: the chrome's menu glyph is the first svg in the document.
    const svg = document.querySelector('main svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('20');
    expect(screen.queryByTestId('index-chart-band')).toBeNull();
    expect(document.querySelectorAll('circle')).toHaveLength(0);
    expect(document.querySelectorAll('svg line')).toHaveLength(0);
  });

  it('shows the band on the small chart only once the index is over the line', () => {
    renderHome(false, {
      chart: {
        points: chartPoints(INDEX),
        threshold: chartThreshold(INDEX),
        bandLabel: bandLabelFor(INDEX),
        description: chartDescription(INDEX),
        open: true,
      },
    });
    expect(screen.getByTestId('index-chart-band')).toBeTruthy();
  });

  it('shows what has happened, from the audit trail', () => {
    renderHome(false, { history: [ENTRY] });
    expect(screen.getByRole('heading', { level: 2, name: 'What has happened' })).toBeTruthy();
    expect(screen.getByText('Monthly payment')).toBeTruthy();
    // The settled state is the ordinary one and says nothing; the link beside
    // the row is what shows it reached the chain.
    expect(screen.queryByText(/Recorded on Hedera/)).toBeNull();
    expect(screen.getAllByText('View on HashScan').length).toBeGreaterThan(0);
  });

  it('says so plainly when nothing has happened yet', () => {
    renderHome(false, { history: [] });
    expect(screen.getByText('Nothing has happened on this cover yet.')).toBeTruthy();
  });

  /**
   * The key is a bearer key to this cover, so it is behind a disclosure rather
   * than printed on a screen somebody could be standing behind, and it is only
   * ever rendered from inside a session that already holds this cover.
   */
  it('holds the cover key behind a disclosure inside the session', () => {
    renderHome(false, { coverKey: '00001111222233334444' });
    const disclosure = screen.getByTestId('cover-key');
    expect(disclosure.tagName).toBe('DETAILS');
    expect((disclosure as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText('Show cover key')).toBeTruthy();
    expect(screen.getByText('0000 1111 2222 3333 4444')).toBeTruthy();
  });

  it('shows no cover key at all when the session has none to show', () => {
    renderHome(false, { coverKey: '' });
    expect(screen.queryByTestId('cover-key')).toBeNull();
  });

  it('offers a way out of this cover on this browser', () => {
    renderHome(false);
    expect(screen.getByRole('button', { name: 'Sign out of this cover' })).toBeTruthy();
  });
});

describe('the index tab', () => {
  function renderIndex(overrides: Partial<Parameters<typeof IndexScreen>[0]> = {}) {
    const reading = headlineReading(INDEX);
    return render(
      <IndexScreen
        bandLabel={bandLabelFor(INDEX)}
        description={chartDescription(INDEX)}
        distance={reading?.distance ?? null}
        months={whatWouldHaveHappened(INDEX)}
        negativeLine={lineIsNegative(INDEX)}
        neverOpened={false}
        occupation="Computer and mathematical"
        open={reading?.open ?? false}
        points={chartPoints(INDEX)}
        sentence={reading?.detail ?? null}
        threshold={chartThreshold(INDEX)}
        {...overrides}
      />,
    );
  }

  // Four items where there were five paragraphs of body type. The one that
  // went said the index is compared with a year ago, which is the sudden jump
  // form described a second time: the trigger item names it.
  it('says what the index is, as four short items', () => {
    renderIndex();
    const items = [...screen.getByTestId('index-about').children].map((item) => item.textContent);
    expect(items).toEqual([
      "Counts unemployment in your job against everyone else's.",
      'Smoothed over three months, so one bad month cannot move it.',
      'Claims open two ways: a sudden jump, or staying worse than anything in the decade before AI.',
      'Any cause counts. It cannot tell why anyone lost their job.',
    ]);
  });

  it('carries no AI attribution essay under the index', () => {
    renderIndex();
    expect(screen.queryByText('What employers say about AI')).toBeNull();
  });

  it('says a negative line in one line, where the occupation has one', () => {
    renderIndex();
    expect(
      screen.getByText(
        'This job is usually unemployed less than average, so the trigger is getting worse than its own normal.',
      ),
    ).toBeTruthy();
  });

  it('shows the backtest strip and its two item key', () => {
    renderIndex();
    expect(screen.getByRole('heading', { name: 'What would have happened' })).toBeTruthy();
    expect(screen.getByText('No payout')).toBeTruthy();
    expect(screen.getByText('Paid out')).toBeTruthy();
  });

  it('says so where claims have never opened since 2010', () => {
    const { unmount } = renderIndex();
    expect(screen.queryByText(/never paid for this occupation since 2010/)).toBeNull();
    unmount();
    renderIndex({ neverOpened: true });
    expect(screen.getByText('Never paid for this occupation since 2010.')).toBeTruthy();
  });

  // T56. The margins are the feed's own, and the screen only joins the
  // sentences the model wrote; what is asserted is that they reach the page
  // and that an absent shock margin prints nothing.
  it('says how close the call was, on both forms', () => {
    renderIndex({ margins: indexMargins(INDEX) });
    expect(
      screen.getByText(
        'In July 2026 the index was 0.69 points short of the line for staying worse, and 2.07 points short of the line for a sudden jump.',
      ),
    ).toBeTruthy();
  });

  it('reads 0.08 past the line for the open month, and no shock sentence when odi is null', () => {
    const april = openIndex();
    renderIndex({
      margins: indexMargins({
        ...april,
        reading: { ...april.reading, period: '2026-04', odi: null },
        trigger: { ...april.trigger, shock_margin: null },
      }),
    });
    const caption = screen.getByText(/the index was 0\.08 points past/);
    expect(caption.textContent).toBe(
      'In April 2026 the index was 0.08 points past the line for staying worse.',
    );
    expect(caption.textContent).not.toContain('sudden jump');
    expect(caption.textContent).not.toContain('0.8 ');
  });

  it('shows no margin caption where none was published', () => {
    renderIndex({ margins: [] });
    expect(screen.queryByText(/the index was/)).toBeNull();
  });

  it('never puts a signed index value on the screen', () => {
    const { container } = renderIndex({ margins: indexMargins(INDEX) });
    const shown = container.textContent ?? '';
    expect(shown).not.toContain('-0.68');
    expect(shown).not.toContain('-1.37');
    expect(shown).not.toContain('-0.69');
    expect(shown).not.toContain('-2.07');
    expect(shown).toContain('Staying within 0.68 of average');
  });
});
