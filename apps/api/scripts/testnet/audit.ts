import assert from 'node:assert/strict';

import { decodeJsonMessage, MirrorClient, pollMirror } from '@creance/client';

import { loadApiConfig } from '../../src/config.js';
import { createPool, PostgresRepository } from '../../src/db/postgres.js';
import { migrate } from '../../src/db/migrate.js';
import { buildServer } from '../../src/server.js';

/// The audit trail of a real policy, against Hedera testnet.
///
/// `GET /v1/audit/:policyId` is a read, so this stage proves the thing a unit
/// test cannot: that the sequence numbers in the database point at messages
/// that are really on the payments topic, and that what the endpoint returns is
/// what the mirror node returns for the same sequence numbers. Every entry it
/// reports as `topic` is fetched again here, independently, and compared.
///
/// It takes the policy id as an argument, falls back to `AUDIT_POLICY_ID`, and
/// otherwise audits the newest policy in the database, which is the one the
/// bind stage before it in `pnpm test:testnet` just created.
///
/// Mirror node REST: https://docs.hedera.com/hedera/sdks-and-apis/rest-api

interface Entry {
  kind: string;
  source: string;
  at: string | null;
  amount: { display: string; asset: string } | null;
  hcs: { topic_id: string; sequence_number: number | null; hashscan: string } | null;
  tx: { id: string; hashscan: string } | null;
  detail: Record<string, unknown>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Fill it in from the example environment file.`);
  }
  return value;
}

async function main(): Promise<void> {
  const config = loadApiConfig();
  assert.equal(config.network, 'testnet', 'this run is testnet only');
  const databaseUrl = requireEnv('DATABASE_URL');

  const pool = createPool(databaseUrl);
  await migrate(pool);

  const asked = process.argv[2] ?? process.env.AUDIT_POLICY_ID;
  const policyId =
    asked ??
    (
      await pool.query<{ policy_id: string }>(
        'SELECT policy_id FROM policies ORDER BY created_at DESC LIMIT 1',
      )
    ).rows[0]?.policy_id;
  assert.ok(policyId, 'no policy in the database: run pnpm --filter @creance/api testnet:bind');

  const app = await buildServer({ config, repository: new PostgresRepository(pool), x402: null });

  const response = await app.inject({ method: 'GET', url: `/v1/audit/${policyId}` });
  assert.equal(response.statusCode, 200, response.body);
  const trail = response.json() as {
    policy_id: string;
    status: string;
    summary: Record<string, { id?: string; hashscan?: string } | null>;
    entries: Entry[];
  };
  assert.equal(trail.policy_id, policyId);
  assert.ok(trail.entries.length > 0, 'the trail is empty');

  console.log(`audit ${trail.policy_id}, status ${trail.status}, ${trail.entries.length} entries`);
  for (const entry of trail.entries) {
    const sequence = entry.hcs?.sequence_number ?? null;
    console.log(
      `  ${entry.kind.padEnd(14)} ${entry.source.padEnd(17)} ` +
        `${sequence === null ? 'no sequence' : `sequence ${sequence}`} ` +
        `${entry.amount === null ? '' : entry.amount.display} ` +
        `${entry.tx === null ? '' : entry.tx.id}`,
    );
  }

  // Every entry that claims to be on a topic is fetched again from the mirror
  // node, so the endpoint cannot pass this stage by trusting its own database.
  const mirror = new MirrorClient({ baseUrl: config.mirrorUrl });
  let checked = 0;
  for (const entry of trail.entries) {
    if (entry.source !== 'topic') continue;
    const topicId = entry.hcs?.topic_id;
    const sequence = entry.hcs?.sequence_number ?? null;
    assert.ok(topicId, 'an entry read from a topic carries no topic');
    assert.ok(sequence !== null, 'an entry read from a topic carries no sequence number');
    const message = await pollMirror(`${topicId} message ${sequence}`, () =>
      mirror.topicMessage(topicId, sequence),
    );
    const body = decodeJsonMessage<Record<string, unknown>>(message);
    assert.equal(body['kind'], entry.kind, `sequence ${sequence} is not a ${entry.kind} message`);
    checked += 1;
  }
  console.log(`${checked} entries checked again against the mirror node`);

  // The policy receipt has to be one of them, and the trail reports how much of
  // what was paid reached the topic.
  const kinds = trail.entries.map((entry) => entry.kind);
  assert.ok(kinds.includes('policy'), 'the trail carries no policy receipt');
  const settlements = trail.entries.filter((entry) => entry.kind === 'settlement');
  const onTopic = settlements.filter((entry) => entry.source === 'topic').length;
  console.log(
    settlements.length === 0
      ? 'no settlement on this policy: it was bound with the gate off'
      : `${settlements.length} settlements, ${onTopic} of them on the topic`,
  );

  // The endpoint is free, so nothing about the person may be in it.
  const policy = await app.services.repository.policy(policyId);
  assert.ok(policy);
  assert.ok(!response.body.includes(policy.nullifier), 'the audit trail leaked the nullifier');
  assert.ok(!response.body.includes(policy.walletEvm), 'the audit trail leaked the holder address');

  console.log('\nlinks');
  for (const name of [
    'payments_topic',
    'claims_topic',
    'policy_nft',
    'bind_transaction',
    'cover_pool',
  ]) {
    const link = trail.summary[name];
    if (link?.hashscan !== undefined) console.log(`  ${name.padEnd(17)} ${link.hashscan}`);
  }

  // The Hedera SDK client holds gRPC connections open, so it is closed before
  // the server: without it the run finishes its work and then never exits.
  app.services.hedera?.close();
  await app.close();
  await pool.end();
}

await main();
