import { readClaim } from './claim-session';
import { readPurchase } from './purchase-session';

/**
 * Which cover the screen in front of the person is about.
 *
 * Three sources, in the order they win. An id in the address opens a cover
 * that is not this browser's, which is how a run through is reopened after the
 * session behind it has gone; the claim session names the cover a claim in
 * progress belongs to; the purchase session names the one this browser bought.
 *
 * Home already reads the first and the third. The claim screens read all three,
 * so the read lives here rather than in five routes.
 */
export async function currentPolicyId(requested?: string): Promise<string | null> {
  if (requested !== undefined && requested !== '') return requested;
  const claim = await readClaim();
  if (claim?.policyId != null) return claim.policyId;
  const purchase = await readPurchase();
  return purchase?.policyId ?? null;
}
