import type { FastifyBaseLogger } from 'fastify';

import { publishPayout } from '../audit/publish.js';
import {
  AUTHORISATION_TTL_SECONDS,
  digestToBytes32,
  separationAtOf,
} from '../chain/authorisation.js';
import { mapRevert } from '../chain/cover-pool.js';
import { findSeries } from '../config.js';
import type { ClaimRow, PaymentRow } from '../db/types.js';
import { AppError } from '../errors.js';
import { newId, nullifierToBytes32, toBytes32 } from '../ids.js';
import type { Services } from '../services.js';

/// The payout: the second key turning, after the decision.
///
/// DESIGN.md 3.6: "After adjudication the backend signs a claim authorisation
/// over the policy id, claim id, packet hash, decision hash, amount and
/// separation month, which the CoverPool checks before paying the wallet."
///
/// The order is the load-bearing part, and it is the same shape the bind route
/// takes for the same reason.
///
///   1  the amount is asked of the contract, never computed here
///   2  the authorisation is signed and stored, with a deadline
///   3  `payClaim` runs, and the money moves inside it or not at all
///   4  the claim and the cover reach `paid` in one transaction
///   5  the payout is written as a payments row and published to the topic
///
/// Step 2 before step 3 is what makes a failure recoverable. `payClaim` is
/// permissionless and the signature is what makes it safe, so a payout that
/// reverted for an environmental reason (the relay, the gas, a wallet that has
/// not associated the settlement token) can be retried by anybody with the same
/// signature until its deadline. Nothing is stored as paid that did not pay:
/// the transfer is inside the contract call, so a revert leaves the claim
/// approved and retryable rather than marked paid with no money moved.
///
/// Step 4 before step 5 is the line between the money and its receipt. Once
/// `payClaim` has returned the person has been paid, and nothing after that
/// point may turn the request into a failure. A topic message that does not
/// land is a claim row with a `paid_tx` and a payments row with a null
/// `hcs_seq`, which is a query; the outbox retries it, which is the same
/// treatment a settled x402 payment gets.
///
/// It is idempotent on `claims.paid_tx`. Two operators pressing the button
/// during a demo, or the Adjuster's approve racing a reviewer's, produce one
/// transfer, because the second call finds a transaction id already there and
/// says so.

export interface PayoutOutcome {
  paid: boolean;
  /** Why not, when not. A code, not a sentence: nothing here is shown to a person. */
  reason?: string;
  transactionHash?: string;
  hashscan?: string;
  amount?: string;
  idempotent?: boolean;
}

export async function payApprovedClaim(
  services: Services,
  claim: ClaimRow,
  log: FastifyBaseLogger,
): Promise<PayoutOutcome> {
  if (claim.paidTx !== null) {
    return { paid: true, idempotent: true, transactionHash: claim.paidTx };
  }
  if (claim.decisionHash === null || claim.packetHash === null) {
    return { paid: false, reason: 'no_decision_hash' };
  }

  const policy = await services.repository.policy(claim.policyId);
  if (policy === null) return { paid: false, reason: 'policy_not_found' };
  const seriesConfig = findSeries(services.config, claim.seriesId);
  if (seriesConfig === undefined) return { paid: false, reason: 'series_not_deployed' };

  const policyId = toBytes32(claim.policyId);
  const claimId = toBytes32(claim.claimId);
  const separationAt = separationAtOf(claim.separationDate);

  // The amount is the contract's arithmetic, asked for rather than repeated.
  // `payClaim` compares for equality, so a number computed here that differed
  // by one minor unit would revert AmountMismatch on the money path instead of
  // in a dry run.
  let expected: bigint;
  try {
    expected = await services.chain.expectedPayout(policyId, separationAt);
  } catch (error) {
    log.error(
      { err: error, claim_id: claim.claimId, policy_id: claim.policyId },
      'the cover pool would not price this claim',
    );
    return { paid: false, reason: mapRevert(error).code };
  }
  if (expected === 0n) return { paid: false, reason: 'zero_payout' };

  // The decision record carries the amount the Adjuster decided. A disagreement
  // is a bug in the Adjuster and never a discount to accept quietly, so it is
  // refused here rather than sent to a revert.
  if (claim.amount !== null && BigInt(claim.amount) !== expected) {
    log.error(
      { claim_id: claim.claimId, decided: claim.amount, expected: expected.toString() },
      'the decided amount is not the amount the cover pool computes',
    );
    return { paid: false, reason: 'amount_mismatch' };
  }

  const deadline = Math.floor(Date.now() / 1000) + AUTHORISATION_TTL_SECONDS;
  const authorisation = await services.chain.signAuthorisation({
    policyId,
    claimId,
    // The policy's nullifier, which is what `payClaim` reads off the policy and
    // hashes into the digest. Never the claim's own, when the two differ.
    nullifierHash: nullifierToBytes32(policy.nullifier),
    packetHash: digestToBytes32(claim.packetHash),
    decisionHash: digestToBytes32(claim.decisionHash),
    payee: policy.walletEvm,
    amount: expected,
    separationAt,
    deadline,
  });
  await services.repository.recordAuthorisation(
    claim.claimId,
    authorisation,
    new Date(deadline * 1000).toISOString(),
  );

  let write;
  try {
    write = await services.chain.payClaim(
      {
        policyId,
        claimId,
        separationAt,
        packetHash: digestToBytes32(claim.packetHash),
        decisionHash: digestToBytes32(claim.decisionHash),
        amount: expected,
        payee: policy.walletEvm,
        authDeadline: deadline,
      },
      authorisation,
    );
  } catch (error) {
    const mapped = error instanceof AppError ? error : mapRevert(error);
    log.error(
      { err: error, claim_id: claim.claimId, code: mapped.code },
      'the cover pool refused the payout; the authorisation is stored and can be retried',
    );
    return { paid: false, reason: mapped.code };
  }

  const paidAt = new Date();
  const stored = await services.repository.markClaimPaid({
    claimId: claim.claimId,
    amount: expected.toString(),
    paidTx: write.transactionHash,
    paidAt: paidAt.toISOString(),
  });

  await recordPayoutPayment(services, claim, policy.wallet, expected, write.transactionHash, paidAt, log);

  log.info(
    {
      claim_id: claim.claimId,
      policy_id: claim.policyId,
      amount: expected.toString(),
      tx: write.transactionHash,
      gas_used: write.gasUsed,
    },
    'a claim was paid out of the reserve',
  );

  return {
    paid: true,
    transactionHash: write.transactionHash,
    hashscan: write.hashscan,
    amount: stored?.amount ?? expected.toString(),
    idempotent: false,
  };
}

/**
 * The payout, as a payments row and a payments topic message.
 *
 * docs/DECISIONS.md, T18, "A payout is written as a payments row as well, so
 * the trail can find it": `GET /v1/audit/:policyId` assembles the trail from
 * the payments a policy carries, and a payout that existed only on the claim
 * row would be invisible to it. The `ref` is the policy id, which is the same
 * reference the first premium carries.
 *
 * Neither the row nor the message can fail the payout. The money has moved.
 */
async function recordPayoutPayment(
  services: Services,
  claim: ClaimRow,
  payeeAccountId: string,
  amount: bigint,
  transactionHash: string,
  at: Date,
  log: FastifyBaseLogger,
): Promise<void> {
  const payment: PaymentRow = {
    paymentId: newId('payment', at.getTime()),
    endpoint: 'CoverPool.payClaim',
    // The vault pays, through the pool. The api account is the one that sent
    // the transaction; the transfer itself is on chain in the receipt.
    payer: services.config.api.accountId,
    payTo: payeeAccountId,
    amount: amount.toString(),
    asset: services.config.settlementToken.tokenId,
    assetDecimals: services.config.settlementToken.decimals,
    facilitator: null,
    facilitatorTx: null,
    chainTxId: transactionHash,
    status: 'settled',
    ref: claim.policyId,
    settledAt: at.toISOString(),
    hcsTopic: null,
    hcsSeq: null,
    requestId: claim.claimId,
  };
  try {
    await services.repository.insertPayment(payment);
  } catch (error) {
    log.error({ err: error, claim_id: claim.claimId }, 'the payout was not written as a payment');
    return;
  }

  const receipt = await publishPayout(
    {
      writer: services.hedera,
      topicId: services.config.paymentsTopicId,
      log,
      outbox: services.outbox,
    },
    {
      policyId: claim.policyId,
      claimId: claim.claimId,
      packetHash: claim.packetHash ?? '',
      decisionHash: claim.decisionHash ?? '',
      amount,
      asset: services.config.settlementToken.tokenId,
      decimals: services.config.settlementToken.decimals,
      transactionId: transactionHash,
      at,
    },
  );
  if (receipt !== null) {
    await services.repository.updatePayment(payment.paymentId, {
      hcsTopic: receipt.topicId,
      hcsSeq: receipt.sequenceNumber,
    });
  }
}
