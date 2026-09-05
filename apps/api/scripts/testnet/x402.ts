import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';

import {
  createX402Payer,
  decodeJsonMessage,
  hashscanTransactionUrl,
  MirrorClient,
  pollMirror,
  readPaymentRequired,
  readSettlement,
  roleKeyHex,
  toDisplay,
  type X402Settlement,
} from '@creance/client';

import { loadApiConfig } from '../../src/config.js';
import { createPool, PostgresRepository } from '../../src/db/postgres.js';
import { migrate } from '../../src/db/migrate.js';
import { buildServer } from '../../src/server.js';
import { backfillObservations, syncSeries } from '../../src/services.js';
import type { SettlementMessage } from '../../src/x402/receipts.js';

/// One paid request of each kind against Hedera testnet, end to end.
///
/// Nothing here is mocked. The server is the real one with the real gate, the
/// facilitator is Blocky402's testnet instance, the payer is a real Hedera
/// account signing a real `TransferTransaction`, and the settlement is a real
/// transfer of the settlement token whose id is printed for HashScan. It is run
/// by `pnpm test:testnet`, never by `pnpm test`.
///
/// It proves the four things no unit test can. That an unpaid request comes
/// back as 402 carrying requirements a payer can build against, including the
/// facilitator's own fee payer account, which is not configured anywhere and
/// arrives from `GET /supported`. That the facilitator accepts a payment in
/// this build's own HTS token rather than the library's default asset. That the
/// money moves: `payTo` is credited exactly the advertised amount and the
/// network fee is paid by the facilitator, not by us. And that every settlement
/// reaches the payments topic, read back from the mirror node.
///
/// It buys the smallest cover the slider offers, because the exposure it
/// commits against the demo series is permanent and the payer's balance is not
/// large.

const PRINCIPAL_ROLE = 'policyholder-2';
const PAYER_ROLE = 'steward';
const LIMIT = '1000000000'; // 1,000 TUSD at six decimals.
const PORT = Number(process.env.X402_TEST_PORT ?? 4102);

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

function settlementOf(response: { headers: Headers }, what: string): X402Settlement {
  const settlement = readSettlement(response);
  assert.ok(settlement, `${what} came back with no PAYMENT-RESPONSE header`);
  assert.ok(settlement.success, `${what} did not settle: ${settlement.errorMessage ?? ''}`);
  assert.ok(settlement.transactionId !== '', `${what} settled with no transaction id`);
  console.log(`  settled ${settlement.transactionId}`);
  console.log(`  ${hashscanTransactionUrl(settlement.transactionId)}`);
  return settlement;
}

async function main(): Promise<void> {
  const config = loadApiConfig();
  assert.equal(config.network, 'testnet', 'this run is testnet only');
  const databaseUrl = requireEnv('DATABASE_URL');
  const operatorKey = requireEnv('HEDERA_OPERATOR_KEY');

  const resources = JSON.parse(
    await readFile(new URL('../../../../docs/hedera.testnet.json', import.meta.url), 'utf8'),
  ) as Resources;
  const principal = resources.accounts[PRINCIPAL_ROLE];
  const payerAccount = resources.accounts[PAYER_ROLE];
  assert.ok(principal, `docs/hedera.testnet.json has no ${PRINCIPAL_ROLE}`);
  assert.ok(payerAccount, `docs/hedera.testnet.json has no ${PAYER_ROLE}`);

  const token = config.settlementToken;
  const mirror = new MirrorClient({ baseUrl: config.mirrorUrl });

  // 1. Preflight. Every one of these is a failure that is unreadable later.
  const facilitatorUrl = (process.env.BLOCKY402_URL ?? 'https://api.testnet.blocky402.com').replace(
    /\/+$/,
    '',
  );
  const health = await fetch(`${facilitatorUrl}/health`);
  assert.equal(health.status, 200, `the facilitator health check answered ${health.status}`);
  const supported = (await (await fetch(`${facilitatorUrl}/supported`)).json()) as {
    kinds: { scheme: string; network: string; extra?: { feePayer?: string } }[];
  };
  const hederaKind = supported.kinds.find(
    (kind) => kind.network === 'hedera:testnet' && kind.scheme === 'exact',
  );
  assert.ok(hederaKind, 'the facilitator no longer advertises exact on hedera:testnet');
  const feePayer = hederaKind.extra?.feePayer;
  assert.ok(feePayer, 'the facilitator advertises no fee payer, so no payer can build a transfer');
  console.log(`facilitator ${facilitatorUrl} is up, fee payer ${feePayer}`);

  const balance = await mirror.tokenRelationship(payerAccount.accountId, token.tokenId);
  assert.ok(balance, `${PAYER_ROLE} ${payerAccount.accountId} is not associated with ${token.symbol}`);
  console.log(
    `payer ${payerAccount.accountId} holds ${toDisplay(String(balance.balance), token.decimals)} ${token.symbol}`,
  );
  const payTo = await mirror.tokenRelationship(config.api.accountId, token.tokenId);
  assert.ok(payTo, `the api account ${config.api.accountId} is not associated with ${token.symbol}`);
  const payToBefore = BigInt(payTo.balance);

  // 2. The real server, listening, because the payer is an HTTP client.
  const pool = createPool(databaseUrl);
  const applied = await migrate(pool);
  console.log(applied.length === 0 ? 'schema already up to date' : `applied ${applied.join(', ')}`);
  const app = await buildServer({ config, repository: new PostgresRepository(pool) });
  assert.ok(app.services.x402, 'the x402 gate is off: unset X402_ENABLED to run this');
  const gate = app.services.x402;
  console.log(`series synced from the chain: ${await syncSeries(app.services)}`);
  console.log(`observations loaded from the archive: ${await backfillObservations(app.services)}`);
  await app.listen({ port: PORT, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${PORT}`;

  const groupKey = config.series[0]?.groupKey;
  assert.ok(groupKey, 'the deployment record has no registered series');

  const payer = createX402Payer({
    accountId: payerAccount.accountId,
    privateKey: roleKeyHex(operatorKey, PAYER_ROLE),
    asset: token.tokenId,
    // A ceiling, well above the smallest premium and well below the balance.
    maxAmountPerPayment: '100000000',
  });

  try {
    // 3. The unpaid request, which is what an agent meets first.
    const unpaid = await fetch(`${base}/v1/index/${groupKey}`);
    assert.equal(unpaid.status, 402, 'the index feed is not gated');
    assert.ok(
      (unpaid.headers.get('content-type') ?? '').includes('application/problem+json'),
      'the 402 body is not a problem document',
    );
    const requirements = readPaymentRequired(unpaid);
    assert.ok(requirements, 'the 402 carried no PAYMENT-REQUIRED header');
    const accepts = requirements.accepts[0];
    assert.ok(accepts, 'the 402 advertised no way to pay');
    assert.equal(accepts.scheme, 'exact');
    assert.equal(accepts.network, 'hedera:testnet');
    assert.equal(accepts.asset, token.tokenId);
    assert.equal(accepts.payTo, config.api.accountId);
    assert.equal(accepts.extra?.['feePayer'], feePayer);
    console.log(
      `\n402 on GET /v1/index/${groupKey}: ${toDisplay(accepts.amount, token.decimals)} ${token.symbol} ` +
        `to ${accepts.payTo}, fee payer ${String(accepts.extra?.['feePayer'])}`,
    );

    // 4. The metered feed, paid.
    console.log(`\npaying for GET /v1/index/${groupKey}`);
    const index = await payer.fetch(`${base}/v1/index/${groupKey}`);
    // Read the body once: a Response body cannot be consumed twice, and an
    // assertion message that reads it is still a read.
    const indexBody = await index.text();
    assert.equal(index.status, 200, indexBody);
    const reading = JSON.parse(indexBody) as { as_of: string; reading: { ebar: string } };
    const indexSettlement = settlementOf(index, 'the index read');
    console.log(`  index as of ${reading.as_of}, ebar ${reading.reading.ebar}`);

    // 5. The quote, paid.
    console.log('\npaying for POST /v1/quote');
    const quoted = await payer.fetch(`${base}/v1/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ group: groupKey, limit: LIMIT, wallet: principal.accountId }),
    });
    const quotedBody = await quoted.text();
    assert.equal(quoted.status, 201, quotedBody);
    const quote = JSON.parse(quotedBody) as {
      quote_id: string;
      premium: { amount: string; display: string };
      issued_via?: string;
    };
    const quoteSettlement = settlementOf(quoted, 'the quote');
    console.log(`  quote ${quote.quote_id}, premium ${quote.premium.display} ${token.symbol}`);

    // 6. The eligibility credential for the principal. A fresh nullifier each
    // run, so the one active policy rule does not refuse a second run.
    const nullifier = `${Date.now()}${randomInt(100_000, 999_999)}`;
    const credentialResponse = await app.inject({
      method: 'POST',
      url: '/v1/demo/eligibility',
      payload: {
        group: groupKey,
        wallet: principal.accountId,
        wallet_evm: principal.evmAddress,
        nullifier,
      },
    });
    assert.equal(credentialResponse.statusCode, 201, credentialResponse.body);
    const credential = credentialResponse.json() as { eligibility: string };

    // 7. The bind, paid with the first month's premium. The credential travels
    // in Authorization, which the payer must not touch, and the payment in
    // PAYMENT-SIGNATURE, which it adds.
    console.log('\npaying for POST /v1/bind, the first month premium');
    const bound = await payer.fetch(`${base}/v1/bind`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${credential.eligibility}`,
      },
      body: JSON.stringify({ quote_id: quote.quote_id }),
    });
    const boundBody = await bound.text();
    assert.equal(bound.status, 201, boundBody);
    const policy = JSON.parse(boundBody) as {
      policy_id: string;
      status: string;
      premium: { amount: string; display: string };
      nft: { token_id: string | null; serial: number | null };
      hcs_receipt: { topic_id: string | null; sequence_number: number | null };
    };
    const bindSettlement = settlementOf(bound, 'the first premium');
    assert.equal(policy.status, 'bound');
    assert.equal(policy.premium.amount, quote.premium.amount);
    console.log(`  policy ${policy.policy_id}, NFT serial ${String(policy.nft.serial)}`);

    // 8. The database. Three settled rows, each carrying its facilitator
    // transaction id, and the bind's row is the one the bind itself wrote.
    await gate.outbox.drain();
    const repository = app.services.repository;
    const rows = await Promise.all(
      [indexSettlement, quoteSettlement, bindSettlement].map(async (settlement) => {
        const row = await repository.paymentByFacilitatorTx(settlement.transactionId);
        assert.ok(row, `no payments row for ${settlement.transactionId}`);
        assert.equal(row.status, 'settled');
        assert.equal(row.payTo, config.api.accountId);
        assert.equal(row.asset, token.tokenId);
        assert.ok(row.hcsSeq, `payment ${row.paymentId} never reached the payments topic`);
        return row;
      }),
    );
    const [indexRow, quoteRow, bindRow] = rows;
    assert.ok(indexRow && quoteRow && bindRow);
    assert.equal(indexRow.endpoint, 'GET /v1/index/:group');
    assert.equal(quoteRow.endpoint, 'POST /v1/quote');
    assert.equal(quoteRow.ref, quote.quote_id);
    assert.equal(bindRow.endpoint, 'POST /v1/bind');
    assert.equal(bindRow.ref, policy.policy_id);
    assert.equal(bindRow.amount, quote.premium.amount);
    // The row the bind wrote at uncollected is the row that settled: the payer
    // on it is the account that signed the transfer, not the holder.
    assert.equal(bindRow.payer, payerAccount.accountId);
    const storedQuote = await repository.quote(quote.quote_id);
    assert.equal(storedQuote?.issuedVia, 'x402', 'a paid quote was not filed as x402');

    // 9. The payments topic, read back from the mirror node rather than from
    // our own return value.
    console.log('\npayments topic');
    for (const row of rows) {
      const message = await pollMirror(`payments topic message ${String(row.hcsSeq)}`, () =>
        mirror.topicMessage(config.paymentsTopicId, row.hcsSeq as number),
      );
      const published = decodeJsonMessage<SettlementMessage>(message);
      assert.equal(published.kind, 'settlement');
      assert.equal(published.v, 1);
      assert.equal(published.tx, row.facilitatorTx);
      assert.equal(published.endpoint, row.endpoint);
      assert.equal(published.amount, row.amount);
      assert.equal(published.asset, token.tokenId);
      assert.equal(published.network, 'hedera:testnet');
      assert.equal(published.scheme, 'exact');
      console.log(`  ${message.sequence_number}  ${JSON.stringify(published)}`);
    }

    // 10. The chain. The transfer is real, the amount is exactly what was
    // advertised, and the network fee was paid by the facilitator.
    const settlementTransfer = await pollMirror(
      `the settlement transaction ${bindSettlement.transactionId}`,
      () =>
        mirror.get<{ transactions?: TransactionRecord[] }>(
          `/transactions/${bindSettlement.transactionId.replace('@', '-').replace(/\.(\d+)$/, '-$1')}`,
        ),
    );
    const transaction = settlementTransfer.transactions?.[0];
    assert.ok(transaction, 'the mirror node has no record of the settlement');
    assert.equal(transaction.result, 'SUCCESS');
    const credited = transaction.token_transfers?.find(
      (entry) => entry.account === config.api.accountId && entry.token_id === token.tokenId,
    );
    assert.ok(credited, 'the settlement credited nothing to the api account');
    assert.equal(String(credited.amount), quote.premium.amount);
    const feePaid = transaction.transfers?.find((entry) => entry.amount < 0);
    assert.equal(feePaid?.account, feePayer, 'the network fee was not paid by the facilitator');
    console.log(
      `\nthe premium of ${policy.premium.display} ${token.symbol} moved from ${payerAccount.accountId} ` +
        `to ${config.api.accountId}, network fee paid by ${feePayer}`,
    );

    const payToAfter = await mirror.tokenRelationship(config.api.accountId, token.tokenId);
    const moved = BigInt(payToAfter?.balance ?? 0) - payToBefore;
    console.log(
      `the api account took ${toDisplay(moved.toString(), token.decimals)} ${token.symbol} across the three calls`,
    );

    console.log('\nlinks');
    console.log(`  index read   ${hashscanTransactionUrl(indexSettlement.transactionId)}`);
    console.log(`  quote        ${hashscanTransactionUrl(quoteSettlement.transactionId)}`);
    console.log(`  first premium ${hashscanTransactionUrl(bindSettlement.transactionId)}`);
    console.log(`  payments topic https://hashscan.io/testnet/topic/${config.paymentsTopicId}`);
    console.log(`  policy       ${policy.policy_id}`);
  } finally {
    // The Hedera SDK client holds gRPC connections open, so it is closed before
    // the server: without it the run finishes its work and then never exits.
    app.services.hedera?.close();
    await app.close();
    await pool.end();
  }
}

interface TransactionRecord {
  result: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
  transfers?: { account: string; amount: number }[];
}

await main();
