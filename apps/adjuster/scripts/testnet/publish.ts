import { claimDecisionMessage, encodeTopicMessage } from '@creance/api/src/audit/messages.js';

import { FIXTURE_NOW, packetA } from '../../fixtures/index.js';
import { toRuleInput } from '../../src/adapt.js';
import { adjusterClient, publishToTopic } from '../../src/chain.js';
import { loadAdjusterConfig } from '../../src/config.js';
import { decide } from '../../src/decide.js';

/// `pnpm --filter @creance/adjuster testnet:publish`
///
/// One real decision hash on the claims topic, from the committed packet A.
///
/// It proves the one thing the unit tests cannot: that the adjuster account's
/// key opens the claims topic, that the version 1 `claim_decision` message fits
/// inside the roughly 1 KB an HCS message carries, and that the sequence number
/// comes back to be stored on the claim. It writes to testnet and costs a fee,
/// so it is a command and never part of `pnpm test`.
///
/// The message carries a hash, an id and the decision word. Never a reason,
/// never an employer, never a date, never a file name, never a nullifier.

const config = loadAdjusterConfig();
const packet = packetA();
const outcome = decide(toRuleInput(packet.claim, packet.extractions, FIXTURE_NOW), {
  asset: { id: config.settlementToken.tokenId, decimals: config.settlementToken.decimals },
});

const message = encodeTopicMessage(
  claimDecisionMessage({
    policyId: packet.claim.policy_id,
    claimId: packet.claim.claim_id,
    decisionHash: outcome.decisionHash,
    decision: outcome.decision,
  }),
);

console.log(`decision      ${outcome.decision}`);
console.log(`confidence    ${outcome.confidence ?? 'none'}`);
console.log(`decision hash ${outcome.decisionHash}`);
console.log(`message       ${Buffer.byteLength(message, 'utf8')} bytes`);
console.log(`message       ${message}`);

const client = adjusterClient(
  config.adjuster.accountId,
  config.adjuster.privateKey,
  config.network,
);
try {
  const receipt = await publishToTopic(client, config.claimsTopicId, message);
  console.log(`\ntopic         ${receipt.topicId}`);
  console.log(`sequence      ${receipt.sequenceNumber}`);
  console.log(`transaction   ${receipt.transactionId}`);
  console.log(`hashscan      ${receipt.link}`);
} finally {
  client.close();
}
