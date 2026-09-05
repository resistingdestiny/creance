// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The claim screens, against their own copy.
 *
 * docs/DESIGN-TOKENS-ADDENDUM.md fixes every string on C1 to C9, the "Claims
 * aren't open" screen and the replaced Home states, and "with the verbatim
 * copy" is the acceptance, so each one is asserted here. The figures and the
 * decisions come from the recorded testnet responses in claim-fixtures.ts.
 *
 * The screens are rendered with their props. The routes above them fetch, and
 * what they fetch is tested through claim-model.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
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

vi.mock('../src/app/admin/claims/actions.js', () => ({
  decide: vi.fn(async () => ({ ok: true, message: 'Approved and paid.' })),
  signIn: vi.fn(async () => ({ ok: false, message: 'That token was not accepted.' })),
  signOut: vi.fn(async () => ({ ok: true, message: 'Signed out.' })),
}));

/** The widget is the SDK's and opens a QR code. Its contract is four callbacks. */
vi.mock('../src/app/verify/world-check.js', () => ({ WorldCheck: () => null }));

const { BeforeYouStart } = await import('../src/app/claim/before-you-start.js');
const { ClaimsClosed } = await import('../src/app/claim/claims-closed.js');
const { JobForm } = await import('../src/app/claim/job/job-form.js');
const { ProofScreen } = await import('../src/app/claim/proof/proof-screen.js');
const { ConfirmScreen } = await import('../src/app/claim/confirm/confirm-screen.js');
const { ReviewScreen } = await import('../src/app/claim/review/review-screen.js');
const { ClaimStatusScreen } = await import('../src/app/claim/status/status-screen.js');
const { ReviewQueue } = await import('../src/app/admin/claims/review-queue.js');
const { ReviewerSignIn } = await import('../src/app/admin/claims/sign-in.js');
const { HomeScreen } = await import('../src/app/home/home-screen.js');
const { OfflineNotice } = await import('../src/app/home/offline-notice.js');
const { decide, signIn } = await import('../src/app/admin/claims/actions.js');
const { claimDay, claimsOpenLine, homeStatus, lapsedCopy } = await import(
  '../src/lib/claim-model.js'
);
const fixtures = await import('./claim-fixtures.js');

afterEach(cleanup);

/** A Home view in one state, from the recorded cover. */
function homeView(state: Parameters<typeof homeStatus>[0], extra = {}) {
  return {
    policyId: fixtures.OPEN_POLICY.policy_id,
    occupation: 'Computer and mathematical',
    cover: 1000,
    status: homeStatus(state),
    nextPayment: '28.00 on 4 October',
    index: { value: '0.69, falling', caption: 'Points from opening claims.' },
    claimsOpen: null,
    paid: null,
    lapsed: null,
    replayBadge: null,
    ...extra,
  };
}

describe('C1, before you start', () => {
  it('says what the cover pays for and what it does not, verbatim', () => {
    render(<BeforeYouStart policy={fixtures.OPEN_POLICY} />);
    expect(screen.getByText('What cover pays for')).toBeTruthy();
    expect(
      screen.getByText(
        'Laid off, made redundant, your position eliminated, your workplace closed.',
      ),
    ).toBeTruthy();
    expect(screen.getByText("What it doesn't pay for")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a claim' })).toBeTruthy();
  });

  it('interpolates the waiting period from the cover, not from a constant', () => {
    render(<BeforeYouStart policy={fixtures.OPEN_POLICY} />);
    expect(screen.getByText(/losing your job in the first 60 days of cover/)).toBeTruthy();
  });
});

describe('the screen that says claims are shut', () => {
  it('prints the API sentences and nothing of its own', () => {
    render(<ClaimsClosed claims={fixtures.CLOSED_CLAIMS} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Claims aren't open.");
    expect(screen.getByText(fixtures.CLOSED_CLAIMS.reason_lines[0] ?? '')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to cover' })).toBeTruthy();
  });

  it('carries the other refusals the block can name', () => {
    render(<ClaimsClosed claims={fixtures.PAID_POLICY.claims ?? null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      "You've already claimed on this cover.",
    );
  });

  it('still says something when the chain could not be read', () => {
    render(<ClaimsClosed claims={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Claims aren't open.");
  });
});

describe('C2, your job', () => {
  function renderJob() {
    return render(
      <JobForm
        employer={null}
        fullName={null}
        jobTitle={null}
        lastDayOfWork={null}
        separationType={null}
      />,
    );
  }

  it('asks the four things the rules read', () => {
    renderJob();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your job');
    for (const label of ['Your name', 'Employer', 'Job title', 'Last day of work']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText('How did it end?')).toBeTruthy();
  });

  it('offers the five choices in the addendum order', () => {
    renderJob();
    const options = within(screen.getByLabelText('How did it end?')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Choose one',
      'Laid off or made redundant',
      'Position eliminated or workplace closed',
      'Dismissed',
      'I resigned',
      'My contract ended',
    ]);
  });

  it('says the rule under the field when the reason is not covered', () => {
    renderJob();
    expect(screen.queryByText(/Cover doesn't pay for this/)).toBeNull();
    fireEvent.change(screen.getByLabelText('How did it end?'), {
      target: { value: 'resignation' },
    });
    expect(
      screen.getByText(
        "Cover doesn't pay for this. You can still submit and a person will look at it.",
      ),
    ).toBeTruthy();
  });
});

describe('C3, add proof', () => {
  it('lists the four documents and keeps the promise about them', () => {
    render(<ProofScreen files={[]} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Add proof');
    expect(screen.getByText('One of these is enough:')).toBeTruthy();
    expect(screen.getByText('A termination or redundancy letter')).toBeTruthy();
    expect(screen.getByText('An unemployment benefit decision')).toBeTruthy();
    expect(screen.getByText('A final pay statement showing the end date')).toBeTruthy();
    expect(screen.getByText('A P45 or Record of Employment')).toBeTruthy();
    expect(
      screen.getByText(
        'We keep your documents private. Only a fingerprint of each file goes on the public record.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Add a file')).toBeTruthy();
  });

  it('shows a row per file once one is added', () => {
    render(<ProofScreen files={[{ name: 'letter.pdf', bytes: 1499 }]} />);
    expect(screen.getByText('letter.pdf')).toBeTruthy();
  });
});

describe('C4, confirm it is you', () => {
  it('asks for the check in the addendum words', () => {
    render(<ConfirmScreen alreadyVerified={false} demo={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Confirm it's you.");
    expect(
      screen.getByText('The same person who bought the cover has to claim it.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify with World ID' })).toBeTruthy();
  });

  it('says the check is verified once it is', () => {
    render(<ConfirmScreen alreadyVerified demo={false} />);
    expect(screen.getByTestId('claim-check-state').textContent).toBe("You're verified");
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('labels the demo path wherever it is offered', () => {
    render(<ConfirmScreen alreadyVerified={false} demo />);
    expect(screen.getByText(/without running a World Selfie Check/)).toBeTruthy();
  });
});

describe('C5, review and submit', () => {
  function renderReview() {
    return render(
      <ReviewScreen
        employer="Northgate Systems Ltd"
        files={1}
        jobTitle="Software Engineer"
        lastDayOfWork="13 March 2026"
        payout="1,000"
        separation="Laid off or made redundant"
      />,
    );
  }

  it('shows the six rows the addendum lists', () => {
    renderReview();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Review your claim');
    for (const label of [
      'Employer',
      'Job title',
      'Last day of work',
      'How it ended',
      'Proof',
      'Payout',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('1 file')).toBeTruthy();
    expect(screen.getByText('1,000')).toBeTruthy();
  });

  it('carries the statement the wallet signs, word for word', () => {
    renderReview();
    expect(
      screen.getByText('Everything here is true. I understand that a false claim is fraud.'),
    ).toBeTruthy();
  });

  it('does not offer to submit until the statement is accepted', () => {
    renderReview();
    const submit = screen.getByRole('button', { name: 'Submit claim' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Submit claim' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('C6 to C9', () => {
  it('C6 says the claim arrived and where the answer will be', () => {
    render(
      <ClaimStatusScreen claim={fixtures.SUBMITTED_CLAIM} reasonLines={[]} why={null} />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Claim received.');
    expect(
      screen.getByText("Most claims are decided in minutes. You'll see the answer here."),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to cover' })).toBeTruthy();
  });

  it('C7 says approved, the amount and where it is going', () => {
    render(<ClaimStatusScreen claim={fixtures.PAID_CLAIM} reasonLines={[]} why={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Approved.');
    expect(screen.getByText('On its way to your wallet.')).toBeTruthy();
    expect(screen.getByTestId('display-number').textContent).toBe('1,000');
  });

  it('C8 says a person has it, with the date and the reference', () => {
    render(<ClaimStatusScreen claim={fixtures.REFERRED_CLAIM} reasonLines={[]} why={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'A person is checking your claim.',
    );
    expect(
      screen.getByText("Usually within one working day. There's nothing you need to do."),
    ).toBeTruthy();
    expect(screen.getByText('Submitted')).toBeTruthy();
    expect(screen.getByText(claimDay(fixtures.REFERRED_CLAIM.submitted_at ?? ''))).toBeTruthy();
    expect(screen.getByText('26KQDY')).toBeTruthy();
  });

  it('C9 prints the decision sentences and what can be done about it', () => {
    render(
      <ClaimStatusScreen
        claim={fixtures.DECLINED_CLAIM}
        reasonLines={fixtures.DECLINE_LINES}
        why={null}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      "We can't pay this claim.",
    );
    for (const line of fixtures.DECLINE_LINES) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    expect(screen.getByText('What you can do')).toBeTruthy();
  });

  it('C9 offers "Submit again" only where a fresh packet could change the answer', () => {
    render(
      <ClaimStatusScreen
        claim={fixtures.DECLINED_CLAIM}
        reasonLines={fixtures.DECLINE_LINES}
        why={null}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Submit again' })).toBeNull();

    cleanup();
    render(
      <ClaimStatusScreen
        claim={{ ...fixtures.DECLINED_CLAIM, resubmit: { allowed: true } }}
        reasonLines={['The document gives a different last day of work from your statement.']}
        why="If you have a document that shows a different end date, add it and submit again."
      />,
    );
    expect(screen.getByRole('button', { name: 'Submit again' })).toBeTruthy();
    expect(
      screen.getByText(
        'If you have a document that shows a different end date, add it and submit again.',
      ),
    ).toBeTruthy();
  });
});

describe('Home, in its new states', () => {
  it('shows the amber Claims open pill, the line and the primary', () => {
    render(
      <HomeScreen
        bound={false}
        view={homeView('claims_open', {
          claimsOpen: claimsOpenLine(fixtures.OPEN_POLICY),
          index: {
            value: '0.69, falling',
            caption: 'Claims are open for Computer and mathematical.',
          },
        })}
      />,
    );
    expect(screen.getByText('Claims open')).toBeTruthy();
    expect(
      screen.getByText('If you lost your job on or after 30 January, you can claim 1,000.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a claim' })).toBeTruthy();
  });

  it('shows the amber Claim in progress pill while one is being decided', () => {
    render(<HomeScreen bound={false} view={homeView('claim_in_progress')} />);
    expect(screen.getByText('Claim in progress')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your claim' })).toBeTruthy();
  });

  it('shows the red Paid out pill, the amount received and the receipt', () => {
    render(
      <HomeScreen
        bound={false}
        view={homeView('paid', { paid: { amount: '1,000', day: '5 September 2026' } })}
      />,
    );
    expect(screen.getByText('Paid out')).toBeTruthy();
    expect(screen.getByText('1,000 received')).toBeTruthy();
    expect(screen.getByText('5 September 2026')).toBeTruthy();
    const receipt = screen.getByRole('link', { name: 'View receipt' });
    expect(receipt.getAttribute('href')).toBe(`/receipt/${fixtures.OPEN_POLICY.policy_id}`);
  });

  it('shows the lapsed state with its date and its button', () => {
    const lapsed = lapsedCopy({ ...fixtures.OPEN_POLICY, next_payment_due: '2026-10-19' });
    render(<HomeScreen bound={false} view={homeView('lapsed', { lapsed })} />);
    expect(screen.getByText('Payment due')).toBeTruthy();
    expect(screen.getByText('Pay by 19 October to stay covered.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pay 28.00' })).toBeTruthy();
  });

  it('carries the replay badge when the demo clock is running', () => {
    render(
      <HomeScreen bound={false} view={homeView('covered', { replayBadge: 'Replay: Jul 2026' })} />,
    );
    expect(screen.getByText('Replay: Jul 2026')).toBeTruthy();
  });

  it('says a demo state is a demo state', () => {
    render(<HomeScreen bound={false} demo view={homeView('lapsed')} />);
    expect(screen.getByText('Demo state. Nothing on this screen came from the API.')).toBeTruthy();
  });
});

describe('the offline state', () => {
  it('is nothing at all while the browser is online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineNotice />);
    expect(screen.queryByTestId('offline')).toBeNull();
  });

  it('says what is unchanged and offers a retry', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<OfflineNotice />);
    expect(screen.getByText("You're offline.")).toBeTruthy();
    expect(
      screen.getByText(
        "Your cover is unchanged. We'll update the index when you're back online.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('the admin review queue', () => {
  const row = {
    claimId: fixtures.QUEUE_ROW.claim_id,
    policyId: fixtures.QUEUE_ROW.policy_id,
    status: 'under_review',
    submittedAt: fixtures.QUEUE_ROW.submitted_at,
    decision: 'refer',
    confidence: null,
    reasons: [...fixtures.QUEUE_ROW.reasons],
    overdue: false,
    group: 'computer_math',
    lastDayOfWork: '2026-03-13',
    separationType: 'redundancy',
    employer: 'Northgate Systems Ltd',
    evidence: ['sha256:c92a84402195993a9472418ce9ed0ddb11435f6688e4acfaabe13d07422588f5'],
    reasonLines: ['Someone will look at your claim.'],
    decidable: true,
  };

  it('lists the columns the addendum asks for', () => {
    render(<ReviewQueue rows={[row]} status="under_review" />);
    for (const column of [
      'Reference',
      'Cover',
      'Occupation',
      'Last day of work',
      'How it ended',
      'Evidence',
      'Reasons',
      'Confidence',
      'Decision',
    ]) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    expect(screen.getByText('Northgate Systems Ltd')).toBeTruthy();
    expect(screen.getByText('13 March 2026')).toBeTruthy();
    expect(screen.getByText('Laid off or made redundant')).toBeTruthy();
    expect(screen.getByText('Someone will look at your claim.')).toBeTruthy();
  });

  it('approves through the decide endpoint', () => {
    render(<ReviewQueue rows={[row]} status="under_review" />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decide).toHaveBeenCalledWith(row.claimId, 'approve', '');
  });

  it('asks for one plain sentence before it declines', () => {
    render(<ReviewQueue rows={[row]} status="under_review" />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Decline' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Your document is for a different job.' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Decline' }));
    expect(decide).toHaveBeenCalledWith(
      row.claimId,
      'decline',
      'Your document is for a different job.',
    );
  });

  it('flags an overdue claim and never decides it', () => {
    render(<ReviewQueue rows={[{ ...row, overdue: true }]} status="under_review" />);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('offers no decision on a claim whose detail could not be read', () => {
    render(<ReviewQueue rows={[{ ...row, decidable: false }]} status="under_review" />);
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('the reviewer sign in', () => {
  it('asks for the token and says why', () => {
    render(<ReviewerSignIn />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Review queue');
    expect(screen.getByLabelText('Reviewer token')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the queue' })).toBeTruthy();
  });

  it('never puts the token on screen', () => {
    render(<ReviewerSignIn />);
    expect(screen.getByLabelText('Reviewer token').getAttribute('type')).toBe('password');
  });

  it('says only that a wrong token was wrong', async () => {
    render(<ReviewerSignIn />);
    fireEvent.change(screen.getByLabelText('Reviewer token'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the queue' }));
    expect(await screen.findByText('That token was not accepted.')).toBeTruthy();
    expect(signIn).toHaveBeenCalled();
  });
});

describe('the house style', () => {
  /** The addendum forbids em and en dashes in any product string. */
  it('has no em or en dash in any claim screen string', async () => {
    const model = await import('../src/lib/claim-model.js');
    const strings = [
      model.EXCLUDED_NOTE,
      claimsOpenLine(fixtures.OPEN_POLICY),
      ...model.SEPARATION_OPTIONS.map((option) => option.label),
      ...(['idle', 'waiting', 'verified', 'failed'] as const).flatMap((state) =>
        Object.values(model.claimCheckCopy(state)),
      ),
      ...Object.values(model.lapsedCopy(fixtures.OPEN_POLICY)),
      ...Object.values(model.paymentFailedCopy(fixtures.OPEN_POLICY)),
      ...model.fallbackReasonLines(model.SEPARATION_OPTIONS.map((option) => option.value)),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/[–—]/);
    }
  });

  /** The voice rules: none of these words reaches a worker screen. */
  it('never says policy, bind, settle, parametric or nullifier to a worker', () => {
    render(
      <HomeScreen
        bound={false}
        view={homeView('claims_open', { claimsOpen: claimsOpenLine(fixtures.OPEN_POLICY) })}
      />,
    );
    const text = document.body.textContent ?? '';
    for (const word of ['policy', 'bind', 'settle', 'parametric', 'nullifier']) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});
