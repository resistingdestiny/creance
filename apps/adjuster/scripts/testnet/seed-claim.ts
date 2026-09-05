import { parseArgs } from 'node:util';

import { EthersChainGateway } from '@creance/api/src/chain/cover-pool.js';
import {
  FileObjectStore,
  loadEvidenceKeys,
  sealEvidence,
  sealField,
} from '@creance/api/src/claims/evidence.js';
import { loadApiConfig } from '@creance/api/src/config.js';
import { createPool, PostgresRepository } from '@creance/api/src/db/postgres.js';
import { seriesRowFrom } from '@creance/api/src/series.js';

import { packetA, packetB } from '../../fixtures/index.js';

/// `pnpm --filter @creance/adjuster testnet:seed`
///
/// Writes one of the two committed packets into the local database as a
/// submitted claim, so `pnpm adjuster:run` has something real to decide against
/// a real API.
///
/// T13 owns the claim submission endpoint. Until it exists this is how the
/// review queue is driven end to end, and it deliberately uses the same
/// evidence helper T13 will, so the envelope it writes is the envelope the
/// admin route reads rather than a shape invented for a demonstration.
///
///     --packet a|b     which fixture to seed, default a
///
/// It writes to the local database and to the evidence store. It reads the
/// series terms off the chain and writes nothing to testnet.

const { values } = parseArgs({ options: { packet: { type: 'string', default: 'a' } } });
const packet = values.packet === 'b' ? packetB() : packetA();

const keys = loadEvidenceKeys();
if (keys === null) {
  throw new Error('EVIDENCE_KEK is not set, so there is nowhere to put a document');
}

const config = loadApiConfig();
if (config.databaseUrl === undefined || config.databaseUrl === '') {
  throw new Error('DATABASE_URL is not set, so there is nowhere to write a claim');
}
const pool = createPool(config.databaseUrl);
const repository = new PostgresRepository(pool);

const seriesConfig = config.series[0];
if (seriesConfig === undefined) throw new Error('no series is registered in the deployment record');

const chain = new EthersChainGateway(
  config.coverPoolAddress,
  config.vaultAddress,
  config.rpcUrl,
  config.chainId,
);
const state = await chain.seriesState(seriesConfig.seriesId);
await repository.upsertSeries(seriesRowFrom(seriesConfig, state, config));
console.log(`series ${seriesConfig.label} cached from the chain`);

const claim = packet.claim;
const file = claim.evidence[0];
if (file === undefined) throw new Error(`${packet.name} carries no evidence`);

const sealed = sealEvidence(keys, claim.claim_id, file.evidence_id, packet.document);
await new FileObjectStore().put(sealed.objectKey, sealed.ciphertext);

await pool.query(
  `INSERT INTO users (nullifier, group_key, wallet)
   VALUES ($1,$2,$3) ON CONFLICT (nullifier) DO NOTHING`,
  [claim.nullifier, claim.policy.group, '0.0.10366453'],
);

await pool.query(
  `INSERT INTO policies (policy_id, series_id, group_key, nullifier, wallet, wallet_evm,
                         cover_limit, premium, asset, asset_decimals, status,
                         starts_at, ends_at, claims_payable_from, paid_through)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'claims_open',$11,$12,$13,$14)
   ON CONFLICT (policy_id) DO UPDATE SET status = 'claims_open'`,
  [
    claim.policy.policy_id,
    seriesConfig.label,
    claim.policy.group,
    claim.nullifier,
    '0.0.10366453',
    '0xcad39730d48683b13e6077a70c6972add449b6f5',
    claim.policy.limit,
    '28000000',
    claim.policy.asset,
    claim.policy.asset_decimals,
    claim.policy.starts_at,
    claim.policy.ends_at,
    claim.policy.claims_payable_from,
    202609,
  ],
);

await pool.query(
  `INSERT INTO claims (claim_id, policy_id, series_id, nullifier, group_key, status,
                       employer_name_enc, claimant_name_enc, job_title,
                       separation_date, separation_type, attestation_method,
                       attestation_verified, statement_accepted, verified_at,
                       packet_hash, qualifying_month, claim_deadline, submitted_at)
   VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,$10,$11,true,true,$12,$13,$14,$15,$16)
   ON CONFLICT (claim_id) DO UPDATE
     SET status = 'submitted', decision = NULL, reasons = '{}', confidence = NULL,
         decision_record = NULL, decision_hash = NULL, hcs_decision_seq = NULL,
         decided_by = NULL, reviewer = NULL, decided_at = NULL`,
  [
    claim.claim_id,
    claim.policy.policy_id,
    seriesConfig.label,
    claim.nullifier,
    claim.policy.group,
    sealField(keys, claim.attestation.employer_name),
    sealField(keys, claim.attestation.full_name ?? ''),
    claim.attestation.job_title,
    claim.attestation.last_day_of_work,
    claim.attestation.separation_type,
    claim.attestation.method,
    claim.world.verified_at,
    claim.packet_hash,
    Number(claim.window.qualifying_month?.replace('-', '')) || null,
    claim.window.claim_deadline,
    claim.submitted_at,
  ],
);

await pool.query(
  `INSERT INTO claim_evidence (evidence_id, claim_id, kind, filename, content_type, size_bytes,
                               sha256, object_key, enc_iv, enc_tag, enc_dek, enc_kek_id, uploaded_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
   ON CONFLICT (claim_id, sha256) DO NOTHING`,
  [
    file.evidence_id,
    claim.claim_id,
    file.kind,
    file.filename,
    file.content_type,
    sealed.sizeBytes,
    sealed.sha256,
    sealed.objectKey,
    sealed.encIv,
    sealed.encTag,
    sealed.encDek,
    sealed.encKekId,
  ],
);

console.log(`seeded ${claim.claim_id} from ${packet.name} as submitted`);
console.log(`  document ${sealed.sizeBytes} bytes, ${sealed.sha256}`);
await pool.end();
