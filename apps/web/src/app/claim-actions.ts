'use server';

import { redirect } from 'next/navigation';

import { ApiError } from '../lib/api';
import { wrongKind } from '../lib/worker-model';
import { decisionForClaimant } from '../lib/admin-api';
import {
  demoClaimPresence,
  fetchClaim,
  requestClaimContext,
  submitClaim,
  verifyClaimCheck,
  type ClaimStatusView,
} from '../lib/claim-api';
import { signAttestationAs } from '../lib/claim-signer';
import {
  endClaim,
  readClaim,
  startClaim,
  updateClaim,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_FILES,
  type ClaimEvidence,
} from '../lib/claim-session';
import { claimSubmitRefusal, evidenceKind, separationOption } from '../lib/claim-model';
import { fetchPolicy, type WorldRequestContextView } from '../lib/worker-api';

/**
 * The claim flow's writes.
 *
 * Every call to the API is made here, on the server, so the claim credential
 * never reaches a browser and so the attestation can be signed by the account
 * the cover was bound to. The same rule the purchase flow follows, for the same
 * reasons (src/app/purchase-actions.ts).
 *
 * The evidence files cross from the browser to here and no further until C5:
 * they sit in the claim session until the packet is built, and the API is where
 * they are sealed.
 */

export interface ClaimStepResult {
  readonly ok: boolean;
  readonly error: string | null;
  /**
   * Whether the same action, repeated, could succeed. False on a refusal the
   * caller cannot argue with, so a screen can stop offering a button that
   * cannot work. See claimSubmitRefusal in src/lib/claim-model.ts.
   */
  readonly retry: boolean;
}

/**
 * What a live person check answered. The extra fact is the one refusal C4
 * cannot say in the deck's failure words: a check of a kind this deployment
 * does not accept, where trying again on the same device returns the same kind.
 * T42.
 */
export interface ClaimCheckResult extends ClaimStepResult {
  readonly wrongCheck: boolean;
}

/**
 * Home, "Start a claim". The claim belongs to one cover from here on.
 *
 * It goes to the gate, not past it. This redirected straight to the job form,
 * and since nothing else in the product links to /claim, the one screen that
 * says what this cover pays for and what it does not was unreachable by any
 * route a worker has. A person could file a claim for a resignation and first
 * hear that resignations are excluded from the Adjuster, days later. The gate
 * exists to be read before the form, so it is what "Start a claim" opens, and
 * continueToJob below is the button on it.
 */
export async function beginClaim(policyId: string): Promise<void> {
  await startClaim(policyId);
  redirect('/claim');
}

/** C1, "Start a claim". */
export async function continueToJob(): Promise<void> {
  redirect('/claim/job');
}

/**
 * C2, "Continue". Every field is required, because every one of them is a
 * field the rules read and a claim missing one cannot be decided.
 */
export async function saveJob(formData: FormData): Promise<ClaimStepResult> {
  const session = await readClaim();
  if (session === null) redirect('/home');

  const fullName = text(formData.get('full_name'));
  const employer = text(formData.get('employer'));
  const jobTitle = text(formData.get('job_title'));
  const lastDayOfWork = text(formData.get('last_day_of_work'));
  const separationType = text(formData.get('separation_type'));

  if (fullName === '' || employer === '' || jobTitle === '') {
    return { ok: false, error: 'Fill in your name, your employer and your job title.', retry: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDayOfWork)) {
    return { ok: false, error: 'Give the last day you worked, as a date.', retry: true };
  }
  if (separationOption(separationType) === null) {
    return { ok: false, error: 'Choose how the job ended.', retry: true };
  }

  await updateClaim({ fullName, employer, jobTitle, lastDayOfWork, separationType });
  redirect('/claim/proof');
}

/**
 * C3, "Add a file".
 *
 * The caps are the API's own, checked here so a file is refused on the screen
 * it was chosen on rather than after a person has filled in the rest of the
 * claim. The content type is sniffed from the bytes by the API and never taken
 * from the caller, so nothing here trusts the name either.
 */
export async function addEvidence(formData: FormData): Promise<ClaimStepResult> {
  const session = await readClaim();
  if (session === null) redirect('/home');

  const chosen = formData.getAll('files').filter((entry): entry is File => entry instanceof File);
  const files: ClaimEvidence[] = [];
  for (const file of chosen) {
    if (file.size === 0) continue;
    if (file.size > MAX_EVIDENCE_BYTES) {
      return { ok: false, error: `${file.name} is over 4 MB. Send a smaller file.`, retry: true };
    }
    if (session.evidence.length + files.length >= MAX_EVIDENCE_FILES) {
      return { ok: false, error: 'Four files is the most a claim can carry.', retry: true };
    }
    files.push({
      filename: file.name,
      kind: evidenceKind(file.name),
      bytes: file.size,
      contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    });
  }
  if (files.length === 0) return { ok: false, error: 'Choose a file to add.', retry: true };

  await updateClaim({ evidence: [...session.evidence, ...files] });
  return { ok: true, error: null, retry: true };
}

/** C3, "Continue". At least one document, which is the API's own rule. */
export async function continueToConfirm(): Promise<ClaimStepResult> {
  const session = await readClaim();
  if (session === null) redirect('/home');
  if (session.evidence.length === 0) {
    return { ok: false, error: 'Add at least one document.', retry: true };
  }
  redirect('/claim/confirm');
}

/**
 * C4, a fresh signed context for one IDKit request.
 *
 * The signal at claim is the cover's own id and the check runs with
 * `require_user_presence` on the claim action, both of which come back inside
 * the context the API signs. Never cached: World refuses a reused nonce.
 */
export async function startClaimCheck(): Promise<WorldRequestContextView | null> {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  try {
    return await requestClaimContext(session.policyId);
  } catch {
    return null;
  }
}

/** C4, the completed check, forwarded to the API, which forwards it to World. */
export async function completeClaimCheck(result: unknown): Promise<ClaimCheckResult> {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  try {
    const issued = await verifyClaimCheck({ policy_id: session.policyId, result });
    await updateClaim({
      credential: issued.claim_credential,
      credentialExpiresAt: issued.expires_at,
      credentialIssuer: issued.issuer,
    });
    return { ok: true, error: null, retry: true, wrongCheck: false };
  } catch (cause) {
    // A check of a kind this deployment does not accept returns the same kind
    // on the same device every time, so that one refusal is not worth repeating.
    const wrongCheck = wrongKind(cause);
    return { ok: false, error: checkFailure(cause), retry: !wrongCheck, wrongCheck };
  }
}

/**
 * C4, the labelled demo presence path.
 *
 * A camera cannot be automated and the Sandbox App has no Selfie Check
 * (docs/FEEDBACK-WORLD.md section 3), so this is how the claim leg runs on a
 * host with neither. The API's own warning is carried back and printed.
 */
export async function useDemoPresence(): Promise<ClaimCheckResult> {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  try {
    const issued = await demoClaimPresence(session.policyId);
    await updateClaim({
      credential: issued.claim_credential,
      credentialExpiresAt: issued.expires_at,
      credentialIssuer: issued.issuer,
    });
    return { ok: true, error: null, retry: true, wrongCheck: false };
  } catch (cause) {
    // A check of a kind this deployment does not accept returns the same kind
    // on the same device every time, so that one refusal is not worth repeating.
    const wrongCheck = wrongKind(cause);
    return { ok: false, error: checkFailure(cause), retry: !wrongCheck, wrongCheck };
  }
}

/** C4, "Continue". */
export async function continueToReview(): Promise<void> {
  redirect('/claim/review');
}

/**
 * C5, "Submit claim".
 *
 * The packet is built here: the attestation is signed as the account the cover
 * was bound to, the files go up as base64, and the credential goes in the
 * Authorization header. What comes back is a claim id, which is what the
 * session holds from here on and what proves this browser submitted it.
 */
export async function submitPacket(): Promise<ClaimStepResult> {
  const session = await readClaim();
  if (session?.policyId == null) redirect('/home');
  if (session.credential === null) redirect('/claim/confirm');
  if (session.evidence.length === 0) redirect('/claim/proof');
  if (
    session.fullName === null ||
    session.employer === null ||
    session.jobTitle === null ||
    session.lastDayOfWork === null ||
    session.separationType === null
  ) {
    redirect('/claim/job');
  }

  try {
    const policy = await fetchPolicy(session.policyId);
    const fields = {
      policyId: policy.policy_id,
      seriesId: policy.series_id,
      fullName: session.fullName,
      employerName: session.employer,
      jobTitle: session.jobTitle,
      groupKey: policy.group,
      lastDayOfWork: session.lastDayOfWork,
      separationType: session.separationType as Parameters<
        typeof signAttestationAs
      >[1]['separationType'],
    };
    const signed = await signAttestationAs(policy.holder_account, fields);
    const receipt = await submitClaim(session.credential, {
      policy_id: policy.policy_id,
      attestation: {
        full_name: session.fullName,
        employer_name: session.employer,
        job_title: session.jobTitle,
        group: policy.group,
        last_day_of_work: session.lastDayOfWork,
        separation_type: session.separationType,
        statement_accepted: true,
        method: signed.method,
        signature: signed.signature,
      },
      evidence: session.evidence.map((file) => ({
        kind: file.kind,
        filename: file.filename,
        content_base64: file.contentBase64,
      })),
    });
    // The files are the API's from here, sealed in its own store, so the web
    // process stops holding a copy of somebody's documents.
    await updateClaim({ claimId: receipt.claim_id, credential: null, evidence: [] });
  } catch (cause) {
    // The reason is logged here because the screen deliberately never prints a
    // code, and a refusal a person cannot act on is one somebody on this side
    // has to be able to find.
    console.error(`[web] the claim packet was refused. ${String(cause)}`);
    const refusal = claimSubmitRefusal(cause);
    return { ok: false, error: refusal.message, retry: refusal.retry };
  }
  redirect('/claim/status');
}

/** C6, the poll. The decision replaces the screen when it arrives. */
export async function readClaimStatus(): Promise<ClaimStatusView | null> {
  const session = await readClaim();
  if (session?.claimId == null) return null;
  try {
    return await fetchClaim(session.claimId);
  } catch {
    return null;
  }
}

/**
 * C9, the sentences the decline is printed from.
 *
 * Read through the admin payload for the claim id in this browser's own
 * session, which is what proves this browser submitted it. See
 * src/lib/admin-api.ts.
 */
export async function readDecisionLines(): Promise<{ lines: string[]; why: string | null }> {
  const session = await readClaim();
  if (session?.claimId == null) return { lines: [], why: null };
  return await decisionForClaimant(session.claimId);
}

/** C9, "Submit again". The cover is the same; everything else starts over. */
export async function submitAgain(): Promise<void> {
  const session = await readClaim();
  const policyId = session?.policyId;
  if (policyId == null) redirect('/home');
  await startClaim(policyId);
  redirect('/claim/job');
}

/** "Back to cover", from any claim screen. */
export async function backToCover(): Promise<void> {
  redirect('/home');
}

/** Leaves the claim and forgets what it was holding. */
export async function abandonClaim(): Promise<void> {
  await endClaim();
  redirect('/home');
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** What a failed live person check says. No apology, and what to do next. */
function checkFailure(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'already_claimed':
        return 'You have already claimed on this cover.';
      case 'claims_not_open':
      case 'policy_not_claimable':
        return "Claims aren't open for this cover.";
      case 'world_credential_unaccepted':
        return "That check isn't the one we asked for. Open the World app and run the face check.";
      default:
        break;
    }
  }
  return "We couldn't verify you. Try again, or use a different device.";
}
