import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';

import { decodeJsonMessage, MirrorClient, pollMirror } from '@creance/client';

import { loadApiConfig } from '../../src/config.js';
import { chosenGroup } from './series-argument.js';
import { createPool, PostgresRepository } from '../../src/db/postgres.js';
import { migrate } from '../../src/db/migrate.js';
import { buildServer } from '../../src/server.js';
import { backfillObservations, syncSeries } from '../../src/services.js';

/// One bind against Hedera testnet, end to end, through the real server.
///
/// Nothing here is mocked: a real Postgres, the real JSON-RPC relay, the real
/// consensus service and the real HTS collection. It is run by
/// `pnpm test:testnet`, never by `pnpm test`, because CI has no database and no
/// keys.
///
/// It proves the three things the unit tests cannot. That the receipt reaches
/// the payments topic and carries the sequence number the contract was given,
/// read back from the mirror node rather than from our own return value. That
/// `CoverPool.bind` accepts a `bytes32` policy id derived from a ULID and an
/// EVM address derived from a Hedera account key. And that a serial of the
/// policy NFT collection ends up in the holder's account, frozen.
///
/// It binds the smallest limit the slider offers, 1,000, because the exposure
/// it commits against the demo series is permanent.

const HOLDER_ROLE = 'policyholder-3';
const LIMIT = '1000000000'; // 1,000 TUSD at six decimals.

interface Resources {
  accounts: Record<string, { accountId: string; evmAddress: string }>;
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
  // The api key is derived from the operator key when it is not set
  // explicitly, so the operator key is the only secret this run needs.
  requireEnv('HEDERA_OPERATOR_KEY');
  assert.ok(config.api.key, 'the api account has no key: set HEDERA_OPERATOR_KEY or HEDERA_API_KEY');

  const resources = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../../../../docs/hedera.testnet.json', import.meta.url),
      'utf8',
    ),
  ) as Resources;
  const holder = resources.accounts[HOLDER_ROLE];
  assert.ok(holder, `docs/hedera.testnet.json has no ${HOLDER_ROLE}`);

  const pool = createPool(databaseUrl);
  const applied = await migrate(pool);
  console.log(applied.length === 0 ? 'schema already up to date' : `applied ${applied.join(', ')}`);

  // No x402 gate: this run proves the chain path, and the paid path is its own
  // script beside this one so that a rerun of either does not buy the other.
  const app = await buildServer({
    config,
    repository: new PostgresRepository(pool),
    x402: null,
  });
  console.log(`series synced from the chain: ${await syncSeries(app.services)}`);
  const written = await backfillObservations(app.services);
  console.log(`observations loaded from the archive: ${written} new`);

  const groupKey = chosenGroup(config);
  assert.ok(groupKey, 'the deployment record has no registered series');

  // 1. The index feed, which is what the Steward buys and what prices the quote.
  const index = await app.inject({ method: 'GET', url: `/v1/index/${groupKey}` });
  assert.equal(index.statusCode, 200, `the index feed answered ${index.statusCode}`);
  const reading = index.json();
  console.log(
    `index ${reading.group} as of ${reading.as_of}: ebar ${reading.reading.ebar}, ` +
      `line ${reading.trigger.level_line}, ${reading.trigger.open ? 'open' : 'closed'}`,
  );

  // 2. An eligibility credential for a fresh person, so the nullifier has no
  // active policy on chain and the run can be repeated.
  const nullifier = `${Date.now()}${randomInt(100_000, 999_999)}`;
  const credentialResponse = await app.inject({
    method: 'POST',
    url: '/v1/demo/eligibility',
    payload: {
      group: groupKey,
      wallet: holder.accountId,
      wallet_evm: holder.evmAddress,
      nullifier,
    },
  });
  assert.equal(credentialResponse.statusCode, 201, credentialResponse.body);
  const credential = credentialResponse.json();
  console.log(`credential ${credential.jti} for ${holder.accountId}, expires ${credential.expires_at}`);

  // 3. The quote, priced from the index and the committed capacity.
  const quoteResponse = await app.inject({
    method: 'POST',
    url: '/v1/quote',
    payload: { group: groupKey, limit: LIMIT, wallet: holder.accountId },
  });
  assert.equal(quoteResponse.statusCode, 201, quoteResponse.body);
  const quote = quoteResponse.json();
  console.log(
    `quote ${quote.quote_id}: ${quote.premium.display} a month for ${quote.limit.display} cover, ` +
      `${quote.annual_rate_bps} bps, free capacity ${quote.capacity.free_before}`,
  );

  // 4. The bind. This publishes the receipt, calls CoverPool and mints the NFT.
  const bindResponse = await app.inject({
    method: 'POST',
    url: '/v1/bind',
    headers: { authorization: `Bearer ${credential.eligibility}` },
    payload: { quote_id: quote.quote_id },
  });
  assert.equal(bindResponse.statusCode, 201, bindResponse.body);
  const policy = bindResponse.json();
  assert.equal(policy.status, 'bound');
  assert.ok(policy.nft.serial > 0, 'the bind returned no NFT serial');
  assert.ok(policy.hcs_receipt.sequence_number > 0, 'the bind returned no receipt sequence number');
  console.log(
    `bound ${policy.policy_id}: NFT serial ${policy.nft.serial}, ` +
      `receipt sequence ${policy.hcs_receipt.sequence_number}`,
  );

  const mirror = new MirrorClient({ baseUrl: config.mirrorUrl });

  // 5. The HCS receipt, read back from the mirror node rather than from our own
  // return value. The mirror lags consensus, so this is a poll.
  const message = await pollMirror(
    `payments topic message ${policy.hcs_receipt.sequence_number}`,
    () => mirror.topicMessage(policy.hcs_receipt.topic_id, policy.hcs_receipt.sequence_number),
  );
  const receipt = decodeJsonMessage<Record<string, unknown>>(message);
  assert.equal(receipt['kind'], 'policy');
  assert.equal(receipt['status'], 'binding');
  assert.equal(receipt['policy'], policy.policy_id);
  assert.equal(receipt['holder'], holder.accountId);
  assert.equal(receipt['limit'], LIMIT);
  console.log(`receipt read back at sequence ${message.sequence_number}: ${JSON.stringify(receipt)}`);

  // The outcome message resolves the binding one. It is found by reading
  // forward from the receipt and matching the policy, not by taking the next
  // sequence number: the payments topic carries every settlement this
  // deployment makes, so anything else running writes between the two.
  const outcome = await pollMirror(`the outcome message`, async () => {
    const window = await mirror.topicMessagesFrom(
      policy.hcs_receipt.topic_id,
      policy.hcs_receipt.sequence_number + 1,
    );
    return (
      window.find((candidate) => {
        const body = decodeJsonMessage<Record<string, unknown>>(candidate);
        return body['kind'] === 'policy' && body['policy'] === policy.policy_id;
      }) ?? null
    );
  });
  const resolved = decodeJsonMessage<Record<string, unknown>>(outcome);
  assert.equal(resolved['status'], 'bound');
  assert.equal(resolved['receiptSeq'], policy.hcs_receipt.sequence_number);
  assert.equal(resolved['serial'], policy.nft.serial);
  console.log(`outcome read back at sequence ${outcome.sequence_number}: ${JSON.stringify(resolved)}`);

  // 6. The NFT serial, in the holder's account, frozen.
  const nft = await pollMirror(`NFT ${policy.nft.token_id} serial ${policy.nft.serial}`, () =>
    mirror.nft(policy.nft.token_id, policy.nft.serial),
  );
  assert.equal(nft.account_id, holder.accountId, 'the serial is not in the holder account');
  const metadata = JSON.parse(Buffer.from(nft.metadata, 'base64').toString('utf8')) as {
    p: string;
    s: string;
  };
  assert.equal(metadata.p, policy.policy_id);
  assert.equal(metadata.s, policy.series_id);
  console.log(`NFT serial ${nft.serial_number} held by ${nft.account_id}, metadata ${JSON.stringify(metadata)}`);

  const relationship = await pollMirror(`the holder token relationship`, () =>
    mirror.tokenRelationship(holder.accountId, policy.nft.token_id),
  );
  assert.equal(relationship.freeze_status, 'FROZEN', 'the policy receipt is transferable');
  console.log('the holder is frozen against the collection, so the receipt cannot be moved');

  // 7. The free read, which is what a judge follows from the card.
  const read = await app.inject({ method: 'GET', url: `/v1/policy/${policy.policy_id}` });
  assert.equal(read.statusCode, 200);
  const served = read.json();
  assert.equal(served.nft.serial, policy.nft.serial);
  assert.ok(!read.body.includes(nullifier), 'the free policy read leaked the nullifier');
  assert.ok(
    !read.body.includes(holder.evmAddress),
    'the free policy read leaked the holder EVM address',
  );

  console.log('\nlinks');
  console.log(`  policy       ${policy.policy_id}`);
  console.log(`  bind         https://hashscan.io/testnet/transaction/${policy.chain.bind_transaction}`);
  console.log(`  NFT          https://hashscan.io/testnet/token/${policy.nft.token_id}/${policy.nft.serial}`);
  console.log(`  topic        https://hashscan.io/testnet/topic/${policy.hcs_receipt.topic_id}`);
  console.log(`  holder       https://hashscan.io/testnet/account/${holder.accountId}`);
  console.log(`  cover pool   https://hashscan.io/testnet/contract/${policy.chain.cover_pool}`);

  app.services.hedera?.close();
  await app.close();
  await pool.end();
}

await main();
