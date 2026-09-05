'use server';

import { revalidatePath } from 'next/cache';

import { ApiError } from '../../../lib/api';
import { decideClaim } from '../../../lib/admin-api';
import { endReview, isReviewer, startReview } from '../../../lib/reviewer-session';

/**
 * The reviewer's two buttons, and the screen that lets them press either.
 *
 * The decision and the sentence go to `POST /v1/admin/claims/:id/decide`, which
 * is where the payout runs inside an approval, so a clean claim is decided and
 * paid in one request (DESIGN.md 3.9). The sentence is not optional on a
 * decline: it is what the person reads on screen C9.
 *
 * Every action here checks the reviewer session first. A server action is its
 * own endpoint, reachable without ever loading the page that renders the button,
 * so gating the page alone would leave `decide` open to anyone who could reach
 * the app, with the server's own admin token attached on their behalf and a
 * payout at the end of it. The check happens before the claim id is used for
 * anything at all.
 *
 * The API is the enforcement point beyond that, not this screen. It refuses an
 * approval when a hard rule failed, whoever asked, so nobody approves a
 * resignation from here either.
 */

export interface DecisionResult {
  readonly ok: boolean;
  /** What happened, in one line, for the reviewer to read on the row. */
  readonly message: string;
}

/** What a request with no reviewer session is told, and all it is told. */
const NOT_A_REVIEWER = 'Sign in as a reviewer first.';

/** The sign in screen: the token, compared in constant time on the server. */
export async function signIn(formData: FormData): Promise<DecisionResult> {
  const token = formData.get('token');
  const accepted = await startReview(typeof token === 'string' ? token : '');
  if (!accepted) return { ok: false, message: 'That token was not accepted.' };
  revalidatePath('/admin/claims');
  return { ok: true, message: 'Signed in.' };
}

/** Ends the session behind this browser's cookie. */
export async function signOut(): Promise<DecisionResult> {
  await endReview();
  revalidatePath('/admin/claims');
  return { ok: true, message: 'Signed out.' };
}

export async function decide(
  claimId: string,
  decision: 'approve' | 'decline',
  reason: string,
): Promise<DecisionResult> {
  if (!(await isReviewer())) return { ok: false, message: NOT_A_REVIEWER };

  const sentence = reason.trim();
  if (decision === 'decline' && sentence === '') {
    return { ok: false, message: 'A decline needs one plain sentence to show the person.' };
  }

  try {
    const result = await decideClaim(claimId, decision, sentence || approvalNote());
    revalidatePath('/admin/claims');
    if (decision === 'decline') return { ok: true, message: 'Declined.' };
    if (result.payout === undefined) return { ok: true, message: 'Approved.' };
    // A payout can refuse without failing the decision, the realistic reason on
    // Hedera being a wallet that has not associated the settlement token. The
    // decision stands, the authorisation is stored, and anyone can retry it, so
    // the screen says which of the two happened rather than implying money moved.
    return result.payout.paid
      ? { ok: true, message: `Approved and paid. ${result.payout.transactionHash ?? ''}`.trim() }
      : {
          ok: true,
          message: `Approved. The payout did not run: ${result.payout.reason ?? 'no reason given'}. Press Approve again to retry it.`,
        };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'hard_rule_failed') {
      return { ok: false, message: `That claim cannot be approved. ${cause.message}` };
    }
    return {
      ok: false,
      message: cause instanceof ApiError ? cause.message : 'The decision did not go through.',
    };
  }
}

/** An approval still carries a sentence, because the API stores one either way. */
function approvalNote(): string {
  return 'Approved on review.';
}
