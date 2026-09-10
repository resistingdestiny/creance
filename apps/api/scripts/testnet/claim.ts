import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { ClaimClient, claimPacket, roleKeyHex, signClaimAttestation } from '@creance/client';

import { loadApiConfig } from '../../src/config.js';
import { seriesNamed } from './series-argument.js';

/// `pnpm --filter @creance/api testnet:claim`
///
/// One proof of loss packet, submitted over HTTP to a running API, exactly as
/// the web app will submit it: a claim credential, an attestation signed by the
/// policy wallet, and one committed document.
///
///     --policy pol_...        the cover to claim on, required
///     --packet a|b            which committed packet, default a
///     --wait                  poll until the claim is decided
///     --url http://...        the API, default http://127.0.0.1:3210
///     --series label          the series, default the first in the record
///
/// Packet A is the clean redundancy that a reviewer approves and the pool pays.
/// Packet B is the resignation, which the Adjuster declines on the statement
/// alone in under a second and which needs no chain call at all.
///
/// The live person check is the labelled demo path, because a camera cannot be
/// automated: docs/FEEDBACK-WORLD.md records that nobody has run
/// `require_user_presence` on a phone and that the staging simulator has no
/// Selfie Check. The real path is `POST /v1/world/verify` with `purpose: claim`
/// and it is the same endpoint, the same credential and the same packet after
/// it.
///
/// The wallet's signature is real. Every account in this build carries an
/// HKDF-derived key over the operator key, so the script signs the attestation
/// with the policyholder's own key and the API recovers it against the address
/// the cover was bound to.

const FIXTURES = fileURLToPath(new URL('../../../adjuster/fixtures/', import.meta.url));

const PACKETS = {
  a: {
    directory: 'packet-a',
    kind: 'termination_letter',
    fullName: 'Alex Mercer',
    employerName: 'Northgate Systems Ltd',
    jobTitle: 'Software Engineer',
    lastDayOfWork: '2026-03-13',
    separationType: 'redundancy' as const,
  },
  b: {
    directory: 'packet-b',
    kind: 'other',
    fullName: 'Robin Vale',
    employerName: 'Calder & Finch LLP',
    jobTitle: 'Data Analyst',
    lastDayOfWork: '2026-03-06',
    separationType: 'resignation' as const,
  },
};

const { values } = parseArgs({
  options: {
    policy: { type: 'string' },
    packet: { type: 'string', default: 'a' },
    url: { type: 'string' },
    wait: { type: 'boolean', default: false },
    holder: { type: 'string', default: 'policyholder-1' },
    series: { type: 'string' },
  },
});

const policyId = values.policy;
assert.ok(policyId, '--policy is required: bind one with testnet:bind-backdated first');
const chosen = PACKETS[(values.packet as 'a' | 'b') ?? 'a'];
assert.ok(chosen, '--packet takes a or b');

const config = loadApiConfig();
assert.equal(config.network, 'testnet', 'this run is testnet only');
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
assert.ok(operatorKey, 'HEDERA_OPERATOR_KEY is not set, so the wallet cannot sign anything');
const series = seriesNamed(config, values.series);
assert.ok(series, 'the deployment record has no registered series');

const baseUrl = (values.url ?? process.env.CREANCE_API_URL ?? 'http://127.0.0.1:3210').replace(
  /\/+$/,
  '',
);
const client = new ClaimClient(baseUrl);

// 1. The live person check. Demo path, and it says so in its own answer.
const credential = await client.demoPresence(policyId);
console.log(`claim credential issued for ${policyId}`);

// 2. The attestation, signed by the wallet that holds the cover.
const fields = {
  policyId,
  seriesId: series.label,
  fullName: chosen.fullName,
  employerName: chosen.employerName,
  jobTitle: chosen.jobTitle,
  groupKey: series.groupKey,
  lastDayOfWork: chosen.lastDayOfWork,
  separationType: chosen.separationType,
};
const signed = await signClaimAttestation(roleKeyHex(operatorKey, values.holder as string), fields);
console.log(`attestation signed by ${signed.address}`);

// 3. The document, from the committed fixtures, so the bytes on testnet are
// the bytes anyone can rebuild from this repository.
const document = readFileSync(`${FIXTURES}${chosen.directory}/letter.pdf`);
const packet = claimPacket(fields, signed, [
  { kind: chosen.kind, filename: 'letter.pdf', bytes: document },
]);

const receipt = await client.submit(credential, packet);
console.log('');
console.log(`claim         ${receipt.claim_id}`);
console.log(`policy        ${receipt.policy_id}`);
console.log(`packet hash   ${receipt.packet_hash}`);
for (const file of receipt.evidence) {
  console.log(`evidence      ${file.evidence_id} ${file.sha256} ${file.size} bytes`);
}
console.log(`qualifying    ${receipt.window.qualifying_month ?? 'not yet'}`);
console.log(`deadline      ${receipt.window.claim_deadline ?? 'not yet'}`);
console.log('');
console.log('now run `pnpm adjuster:run` to put the packet hash on the claims topic and decide it');

if (values.wait === true) {
  const decided = await client.awaitDecision(receipt.claim_id, { timeoutMs: 300_000 });
  console.log('');
  console.log(`status        ${decided.status}`);
  console.log(`decision      ${decided.decision ?? 'still waiting'}`);
  console.log(`reasons       ${decided.reasons.join(', ') || 'none'}`);
  console.log(`decision hash ${decided.decision_hash ?? 'none'}`);
  console.log(`claims topic  ${decided.hcs.topic_id ?? 'none'}`);
  console.log(`  packet at   ${decided.hcs.packet_sequence_number ?? 'not yet'}`);
  console.log(`  decision at ${decided.hcs.decision_sequence_number ?? 'not yet'}`);
  if (decided.payout !== null) {
    console.log(`payout        ${decided.amount?.amount ?? '0'} ${decided.amount?.asset ?? ''}`);
    console.log(`payClaim      ${decided.payout.hashscan}`);
  }
}
