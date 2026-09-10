import { describe, expect, it } from 'vitest';

import {
  EXCLUDED_NOTE,
  SEPARATION_OPTIONS,
  claimCheckCopy,
  claimDay,
  claimIsDecided,
  claimReference,
  claimScreenOf,
  claimsOpenLine,
  evidenceKind,
  fallbackReasonLines,
  homeStateOf,
  homeStatus,
  indexRow,
  isExcludedSeparation,
  lapsedCopy,
  paymentFailedCopy,
  replayBadgeLabel,
  separationLabel,
  waitingPeriodDays,
} from '../src/lib/claim-model.js';
import { verifyCopy } from '../src/lib/worker-model.js';
import { SEPARATION_TYPES } from '@creance/client/src/claim';
import {
  DECLINED_CLAIM,
  LIVE_REPLAY,
  OPEN_POLICY,
  PAID_CLAIM,
  PAID_POLICY,
  REFERRED_CLAIM,
  REPLAY,
  SUBMITTED_CLAIM,
} from './claim-fixtures.js';

/**
 * The claim model, against the payloads the API actually sent.
 *
 * Every string the addendum fixes is asserted somewhere here or in
 * claim-screens.test.tsx, because "with the verbatim copy" is the acceptance
 * and a paraphrase is the easiest thing in this ticket to ship by accident.
 */

describe('the C2 select', () => {
  it('offers the five choices the addendum names, in its order', () => {
    expect(SEPARATION_OPTIONS.map((option) => option.label)).toEqual([
      'Laid off or made redundant',
      'Position eliminated or workplace closed',
      'Dismissed',
      'I resigned',
      'My contract ended',
    ]);
  });

  it('maps every choice onto a separation type the API takes', () => {
    for (const option of SEPARATION_OPTIONS) {
      expect(SEPARATION_TYPES).toContain(option.value);
    }
  });

  it('marks the three the cover does not pay for', () => {
    expect(SEPARATION_OPTIONS.filter((option) => option.excluded).map((o) => o.value)).toEqual([
      'dismissal_for_cause',
      'resignation',
      'fixed_term_end',
    ]);
    expect(isExcludedSeparation('resignation')).toBe(true);
    expect(isExcludedSeparation('redundancy')).toBe(false);
  });

  it('says the rule and offers the claim anyway', () => {
    expect(EXCLUDED_NOTE).toBe(
      "Cover doesn't pay for this. You can still submit and a person will look at it.",
    );
  });

  it('says a choice back the way it was offered', () => {
    expect(separationLabel('resignation')).toBe('I resigned');
  });
});

describe('the evidence kind', () => {
  it('reads the four documents C3 names out of a file name', () => {
    expect(evidenceKind('termination-letter.pdf')).toBe('termination_letter');
    expect(evidenceKind('P45.pdf')).toBe('p45');
    expect(evidenceKind('benefit-determination.png')).toBe('benefit_determination');
    expect(evidenceKind('final pay statement.pdf')).toBe('final_pay_statement');
  });

  it('sends anything else as other, because the document is what is read', () => {
    expect(evidenceKind('letter.pdf')).toBe('other');
    expect(evidenceKind('scan_0001.jpg')).toBe('other');
  });
});

describe('the Home states', () => {
  it('is Claims open when the chain says so and this browser has no claim', () => {
    expect(homeStateOf(OPEN_POLICY, null)).toBe('claims_open');
    expect(homeStatus('claims_open')).toEqual({
      state: 'claims_open',
      pill: 'watch',
      label: 'Claims open',
    });
  });

  it('is Claim in progress while one is being decided', () => {
    expect(homeStateOf(OPEN_POLICY, SUBMITTED_CLAIM)).toBe('claim_in_progress');
    expect(homeStateOf(OPEN_POLICY, REFERRED_CLAIM)).toBe('claim_in_progress');
    expect(homeStatus('claim_in_progress').pill).toBe('watch');
  });

  it('is Paid out once the money has moved, and red', () => {
    expect(homeStateOf(PAID_POLICY, PAID_CLAIM)).toBe('paid');
    expect(homeStatus('paid')).toEqual({ state: 'paid', pill: 'triggered', label: 'Paid out' });
  });

  it('goes back to Covered after a decline, because the cover is still cover', () => {
    expect(homeStateOf({ ...OPEN_POLICY, claims: undefined }, DECLINED_CLAIM)).toBe('covered');
  });

  it('is Payment due when the cover has lapsed', () => {
    expect(homeStateOf({ ...OPEN_POLICY, status: 'lapsed', claims: undefined }, null)).toBe(
      'lapsed',
    );
    expect(homeStatus('lapsed').pill).toBe('triggered');
  });
});

describe('the Claims open line', () => {
  it('interpolates the date a claim becomes payable and the cover amount', () => {
    expect(claimsOpenLine(OPEN_POLICY)).toBe(
      'If you lost your job on or after 30 January, you can claim 1,000.',
    );
  });

  it('counts the waiting period from the cover dates, never from a constant', () => {
    expect(waitingPeriodDays(OPEN_POLICY)).toBe(60);
  });
});

describe('the index row', () => {
  it('says claims are open when the cover is open and the month is under its line', () => {
    const reading = { value: '0.69, falling', caption: 'Points from opening claims.', open: false };
    expect(indexRow(reading, true, 'Computer and mathematical')).toEqual({
      value: '0.69, falling',
      caption: 'Claims are open for Computer and mathematical.',
    });
  });

  it('leaves the caption alone when claims are shut', () => {
    const reading = { value: '0.69, falling', caption: 'Points from opening claims.', open: false };
    expect(indexRow(reading, false, 'Computer and mathematical')?.caption).toBe(
      'Points from opening claims.',
    );
  });
});

describe('the lapsed and failed states', () => {
  it('says when to pay by and what the payment is', () => {
    const policy = { ...OPEN_POLICY, next_payment_due: '2026-10-19' };
    expect(lapsedCopy(policy)).toEqual({
      heading: 'Payment due',
      line: 'Pay by 19 October to stay covered.',
      action: 'Pay 28.00',
    });
  });

  it('says what happened, what to check and what is unchanged', () => {
    const policy = { ...OPEN_POLICY, next_payment_due: '2026-10-19' };
    expect(paymentFailedCopy(policy)).toEqual({
      title: "Your payment didn't go through.",
      body:
        'Check that your wallet has at least 28.00, then try again.' +
        ' Your cover is unchanged until 19 October.',
      action: 'Pay 28.00',
    });
  });
});

describe('which claim screen a claim is on', () => {
  it('is C6 until there is a decision', () => {
    expect(claimScreenOf(SUBMITTED_CLAIM)).toBe('received');
    expect(claimIsDecided(SUBMITTED_CLAIM)).toBe(false);
  });

  it('is C8 while a person has it', () => {
    expect(claimScreenOf(REFERRED_CLAIM)).toBe('under_review');
    expect(claimIsDecided(REFERRED_CLAIM)).toBe(true);
  });

  it('is C7 once it is approved or paid', () => {
    expect(claimScreenOf(PAID_CLAIM)).toBe('approved');
    expect(claimScreenOf({ ...PAID_CLAIM, status: 'approved' })).toBe('approved');
  });

  it('is C9 when it is declined', () => {
    expect(claimScreenOf(DECLINED_CLAIM)).toBe('declined');
  });

  it('shows a short reference a person can read out', () => {
    expect(claimReference(PAID_CLAIM.claim_id)).toBe('26KQDY');
  });

  it('says a date in en-GB and in UTC', () => {
    expect(claimDay(PAID_CLAIM.submitted_at ?? '')).toBe('5 September 2026');
  });
});

describe('the C4 copy', () => {
  it('asks for the check in the addendum words', () => {
    expect(claimCheckCopy('idle')).toEqual({
      heading: "Confirm it's you.",
      line: 'The same person who bought the cover has to claim it.',
      button: 'Verify with World ID',
    });
  });

  it('says what failed and what to do next, with no apology', () => {
    expect(claimCheckCopy('failed')).toEqual({
      heading: "We couldn't verify you.",
      line: 'Try again, or use a different device.',
      button: 'Try again',
    });
  });

  /** No second device to move to inside World App. docs/DECISIONS.md, T27. */
  it('drops the second device inside World App', () => {
    expect(claimCheckCopy('failed', 'world-app').line).toBe('Try again.');
    expect(claimCheckCopy('idle', 'world-app')).toEqual(claimCheckCopy('idle'));
  });

  /**
   * The same check refused for the same reason gets the same words here as at
   * purchase, taken from one place rather than written twice. T42.
   */
  it('names the check to run when the one that came back is of another kind', () => {
    expect(claimCheckCopy('wrong-check')).toEqual({
      heading: "That check isn't the one we asked for.",
      line: 'Open the World app and run the face check.',
      button: 'Verify with World ID',
    });
    expect(claimCheckCopy('wrong-check')).toEqual(verifyCopy('wrong-check'));
    expect(claimCheckCopy('wrong-check', 'world-app')).toEqual(
      verifyCopy('wrong-check', 'world-app'),
    );
  });
});

describe('the decline sentences of last resort', () => {
  it('turns the codes of a real decline into the same sentences without dates', () => {
    expect(fallbackReasonLines(DECLINED_CLAIM.reasons)).toEqual([
      "Resigning isn't covered. This cover pays when your employer ends your job.",
    ]);
  });

  it('puts the rule a person cannot argue with first', () => {
    expect(
      fallbackReasonLines(['evidence_unreadable', 'separation_type_not_covered'])[0],
    ).toBe("Resigning isn't covered. This cover pays when your employer ends your job.");
  });
});

describe('the replay badge', () => {
  it('names the month the clock is standing on, as the copy deck writes it', () => {
    expect(replayBadgeLabel(REPLAY)).toBe('Replay: Jul 2026');
  });

  it('is nothing at all while the clock is live', () => {
    expect(replayBadgeLabel(LIVE_REPLAY)).toBeNull();
    expect(replayBadgeLabel(null)).toBeNull();
  });

  it('prints the scenario label as it stands in scenario mode', () => {
    expect(
      replayBadgeLabel({
        ...REPLAY,
        mode: 'scenario',
        scenario_label: 'SCENARIO: sharp displacement',
        badge: { show: true, label: 'SCENARIO: sharp displacement' },
      }),
    ).toBe('SCENARIO: sharp displacement');
  });
});
