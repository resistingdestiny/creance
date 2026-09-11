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
const { LEVEL_LINE_NEVER_REACHED, OccupationPicker } = await import(
  '../src/app/occupation/occupation-picker.js'
);
const { PayScreen } = await import('../src/app/pay/pay-screen.js');
const { VerifyScreen } = await import('../src/app/verify/verify-screen.js');
const { completeWorldCheck, startWorldCheck } = await import('../src/app/purchase-actions.js');
const { OCCUPATIONS } = await import('../src/lib/occupations.js');
const { homeStatus } = await import('../src/lib/claim-model.js');
const {
  bandLabelFor,
  chartDescription,
  chartPoints,
  chartThreshold,
  FIRST_VALUE_SETTLES,
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

  it('carries the honest line for the two that have never opened since 2010', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    expect(screen.getAllByText(/Claims have never opened here\./)).toHaveLength(2);
  });

  it('says where the level line has never been reached, beside the never-opened line', () => {
    render(<OccupationPicker chosen={null} rows={OCCUPATIONS} />);
    const rows = screen.getAllByText(new RegExp(LEVEL_LINE_NEVER_REACHED));
    expect(rows).toHaveLength(5);
    // Office and administrative support carries both facts in one caption,
    // the backtest's first and the whole history's second.
    const office = rows.find((node) => node.textContent?.startsWith('Claims have never opened'));
    expect(office?.textContent).toBe(
      `Claims have never opened here. ${LEVEL_LINE_NEVER_REACHED}`,
    );
    // Legal reached its line once, in 2007, and must not carry the sentence.
    const legal = screen.getByText('Legal').closest('button');
    expect(legal?.textContent).toBe('Legal');
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
      'Pays out if the index for Computer and mathematical rises 2 points above its trend. Full payout at 4 points.',
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

  it('carries the copy deck strings and says the check is the interim one', () => {
    render(<VerifyScreen alreadyVerified={false} interim />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      "Confirm you're a real person.",
    );
    expect(
      screen.getByText('One person, one cover. This stops bots and duplicate accounts.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
    expect(screen.getByText(/Interim check\. Testnet only\./)).toBeTruthy();
  });

  it('does not claim a Selfie Check it did not run', () => {
    render(<VerifyScreen alreadyVerified={false} interim />);
    expect(screen.getByText(/without running a World Selfie Check yet/)).toBeTruthy();
  });

  it('drops the interim line when the World check is the one running', () => {
    render(<VerifyScreen alreadyVerified={false} interim={false} />);
    expect(screen.queryByText(/Interim check\. Testnet only\./)).toBeNull();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
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
   * docs/DESIGN-TOKENS.md section 5: the Home row's chart is 64 by 20 and
   * carries no band unless the state is triggered, and never a gridline, a dot
   * or a legend.
   */
  it('draws the index line at the size the chart rules give the Home row', () => {
    renderHome(false);
    const svg = document.querySelector('svg');
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

  it('carries the three sentences from the copy deck', () => {
    renderIndex();
    expect(
      screen.getByText("It counts unemployment in your occupation, compared with everyone else's."),
    ).toBeTruthy();
    expect(
      screen.getByText('It is smoothed over three months, so one bad month does not move it.'),
    ).toBeTruthy();
    expect(
      screen.getByText('It is compared with a year ago, so it shows change, not level.'),
    ).toBeTruthy();
  });

  // The index reads unemployment and cannot see a cause. That is the one thing
  // a buyer worried about AI has to be told, and it belongs in the block that
  // explains the trigger rather than in an essay further down.
  it('says the index cannot see why the job went', () => {
    renderIndex();
    expect(
      screen.getByText('It cannot tell why anyone lost their job, and any cause counts.'),
    ).toBeTruthy();
  });

  it('carries no AI attribution essay under the index', () => {
    renderIndex();
    expect(screen.queryByText('What employers say about AI')).toBeNull();
  });

  it("carries the addendum's second explanation block", () => {
    renderIndex();
    expect(
      screen.getByText(
        "Claims open in two ways. A sudden jump past this occupation's trigger line, or staying worse than anything in the decade before AI.",
      ),
    ).toBeTruthy();
  });

  it('explains a negative line where the occupation has one', () => {
    renderIndex();
    expect(
      screen.getByText(
        'People in this occupation are usually unemployed less than average. The trigger is about getting worse than their own normal, not about being above zero.',
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
    expect(
      screen.getByText('This cover has never paid for this occupation since 2010.'),
    ).toBeTruthy();
  });

  // T56. The margins are the feed's own, and the screen only joins the
  // sentences the model wrote; what is asserted is that they reach the page,
  // that an absent shock margin prints nothing, and that the settle sentence
  // is beside them.
  it('says how close the call was, with the first published value settling', () => {
    renderIndex({ margins: indexMargins(INDEX) });
    expect(
      screen.getByText(
        `In July 2026 the index was 0.69 points short of the line for staying worse, and 2.07 points short of the line for a sudden jump. ${FIRST_VALUE_SETTLES}`,
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
      `In April 2026 the index was 0.08 points past the line for staying worse. ${FIRST_VALUE_SETTLES}`,
    );
    expect(caption.textContent).not.toContain('sudden jump');
    expect(caption.textContent).not.toContain('0.8 ');
  });

  it('shows no margin caption where none was published', () => {
    renderIndex({ margins: [] });
    expect(screen.queryByText(/the index was/)).toBeNull();
    expect(screen.queryByText(FIRST_VALUE_SETTLES)).toBeNull();
  });

  it('never puts a signed index value on the screen', () => {
    const { container } = renderIndex({ margins: indexMargins(INDEX) });
    const shown = container.textContent ?? '';
    expect(shown).not.toContain('-0.68');
    expect(shown).not.toContain('-1.37');
    expect(shown).not.toContain('-0.69');
    expect(shown).not.toContain('-2.07');
    expect(shown).toContain('Pays out within 0.68 of average');
  });
});
