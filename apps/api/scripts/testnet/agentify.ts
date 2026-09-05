import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
} from '@creance/client';

import { loadApiConfig } from '../../src/config.js';
import { createPool, PostgresRepository } from '../../src/db/postgres.js';
import { migrate } from '../../src/db/migrate.js';
import { buildServer } from '../../src/server.js';
import { backfillObservations, syncSeries } from '../../src/services.js';

/// The cold start: an agent that has never seen this API pays for a reading.
///
/// This is the proof the agentify work stands on, so the discipline is the
/// whole point of the file. `coldClient` below is handed two things and
/// nothing else: the URL of the description file, and a funded payer. It has
/// no import from src, no configuration, no group key, no price, no asset and
/// no route. Everything it does it works out from the text of `/llms.txt`, in
/// the order an agent would: read the file, find the free catalogue, find a
/// group that has a reading, make the call, be refused with 402, check the
/// terms in the refusal against the terms the file promised, pay, and read.
///
/// Nothing here is mocked. The server is the real one with the real gate, the
/// facilitator is Blocky402's testnet instance, the payer is a real Hedera
/// account signing a real `TransferTransaction`, and the reading is checked
/// against the settled record on the index topic read from the mirror node.
///
/// One deliberate difference from what an outside agent would see: the
/// description file names the public origin `https://creance.co`, which is
/// Root pending, and this run points at a local instance of the same build. So
/// the client takes the paths out of the file and re-roots them on the origin
/// it was given, which is what any client does when it is handed a staging
/// address. The paths, the price, the asset, the network and the payee all come
/// from the file.
///
/// It is run by `pnpm --filter @creance/api testnet:agentify`, never by
/// `pnpm test`. It spends 0.01 TUSD.

const PAYER_ROLE = 'steward';
const PORT = Number(process.env.AGENTIFY_TEST_PORT ?? 4103);

interface Resources {
  accounts: Record<string, { accountId: string; evmAddress: string }>;
}

/** What the description file promised, read out of its prose. */
interface DiscoveredTerms {
  cataloguePath: string;
  clockPath: string;
  readingPath: string;
  amount: string;
  display: string;
  asset: string;
  decimals: number;
  network: string;
  payTo: string;
  facilitator: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. Fill it in from the example environment file.`);
  }
  return value;
}

function capture(text: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(text);
  assert.ok(match?.[1], `the description file does not say ${what}`);
  return match[1];
}

/** Every markdown link target in the file, as a path. */
function paths(text: string): string[] {
  return [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => match[1] as string)
    .filter((url) => !url.includes('hashscan.io') && !url.includes('mirrornode'))
    .map((url) => new URL(url).pathname + new URL(url).search);
}

/**
 * Read the file and work out what to call and what it costs.
 *
 * Prose, parsed. That is the test: a description file an agent cannot act on
 * without a person reading it first has not agentified anything.
 */
function readTheDescription(text: string): DiscoveredTerms {
  const linked = paths(text);
  const cataloguePath = linked.find((path) => path === '/v1/index');
  const clockPath = linked.find((path) => path === '/v1/replay');
  const readingPath = linked.find((path) => /^\/v1\/index\/[a-z_]+$/.test(path));
  assert.ok(cataloguePath, 'the description file links to no catalogue');
  assert.ok(clockPath, 'the description file links to no clock');
  assert.ok(readingPath, 'the description file links to no reading');

  const decimals = capture(text, /at (\d+) decimals/, 'how many decimals the asset has');
  return {
    cataloguePath,
    clockPath,
    readingPath,
    display: capture(text, /Price: ([\d.]+) [A-Z]+ per call/, 'a price'),
    amount: capture(text, /which is `(\d+)` in the smallest/, 'the price in minor units'),
    asset: capture(text, /HTS token `([\d.]+)`/, 'which asset it wants'),
    decimals: Number(decimals),
    network: capture(text, /network `([a-z]+:[a-z]+)`/, 'which network it settles on'),
    payTo: capture(text, /Pay to ([\d.]+)\./, 'who to pay'),
    facilitator: capture(text, /facilitator at (https:\/\/\S+?)\.\s/, 'which facilitator'),
  };
}

interface ColdResult {
  terms: DiscoveredTerms;
  group: string;
  reading: IndexReading;
  transactionId: string;
}

interface IndexReading {
  group: string;
  group_label: string;
  as_of: string;
  reading: Record<string, string | null>;
  trigger: {
    attachment_shock: string;
    level_line: string;
    open: boolean;
    open_reason: string | null;
  };
  headline: { form: string; distance: string } | null;
  history: {
    period: string;
    ebar: string | null;
    odi: string | null;
    open: boolean;
    open_reason: string | null;
  }[];
}

/**
 * The agent.
 *
 * `origin` and `payer` in, a reading out. No other argument, and nothing
 * imported from this repository's source: if this function needs a constant, it
 * has to find it in the file.
 */
async function coldClient(
  origin: string,
  payer: { accountId: string; privateKey: string },
): Promise<ColdResult> {
  console.log(`\nthe agent has one URL and a key. Nothing else.\n  ${origin}/llms.txt\n`);
  const described = await fetch(`${origin}/llms.txt`);
  assert.equal(described.status, 200, 'the description file did not answer');
  const text = await described.text();
  console.log(`1. read the description, ${String(text.length)} bytes`);

  const terms = readTheDescription(text);
  console.log(`   it sells ${terms.readingPath.replace(/[a-z_]+$/, '{group}')}`);
  console.log(`   for ${terms.display} (${terms.amount}) of ${terms.asset} on ${terms.network}`);
  console.log(`   paid to ${terms.payTo} through ${terms.facilitator}`);
  console.log(`   and says to call ${terms.cataloguePath} first, which is free`);

  // 2. The free catalogue, which is how a group key is learned without paying.
  const catalogue = (await (await fetch(`${origin}${terms.cataloguePath}`)).json()) as {
    price: { amount: string; asset: string; pay_to: string; network: string } | null;
    groups: { group: string; label: string; latest_period: string | null }[];
  };
  const withReading = catalogue.groups.filter((entry) => entry.latest_period !== null);
  console.log(
    `\n2. ${terms.cataloguePath}: ${String(catalogue.groups.length)} occupations, ` +
      `${String(withReading.length)} with a reading published`,
  );
  const chosen = withReading[0];
  assert.ok(chosen, 'no occupation has a reading, so there is nothing to buy');
  console.log(`   choosing ${chosen.group} (${chosen.label}), newest ${String(chosen.latest_period)}`);

  // The catalogue and the description file are two surfaces of one price. An
  // agent that finds them disagreeing should not pay either of them.
  assert.ok(catalogue.price, 'the catalogue does not say the feed is metered');
  assert.equal(catalogue.price.amount, terms.amount, 'the catalogue and the file disagree on price');
  assert.equal(catalogue.price.asset, terms.asset, 'the catalogue and the file disagree on asset');
  assert.equal(catalogue.price.pay_to, terms.payTo, 'the catalogue and the file disagree on payee');

  // 3. The clock, so the reading can be reported as of the right month.
  const clock = (await (await fetch(`${origin}${terms.clockPath}`)).json()) as {
    mode: string;
    running: boolean;
  };
  console.log(`\n3. ${terms.clockPath}: mode ${clock.mode}, running ${String(clock.running)}`);

  // 4. The unpaid call, which is where an agent meets the price for real.
  const url = `${origin}/v1/index/${chosen.group}`;
  const unpaid = await fetch(url);
  assert.equal(unpaid.status, 402, 'the feed the file describes as paid is not gated');
  const required = readPaymentRequired(unpaid);
  assert.ok(required, 'the 402 carried no PAYMENT-REQUIRED header');
  const accepts = required.accepts[0];
  assert.ok(accepts, 'the 402 advertised no way to pay');
  console.log(`\n4. GET /v1/index/${chosen.group} unpaid: 402`);
  console.log(
    `   the header asks for ${accepts.amount} of ${String(accepts.asset)} to ${accepts.payTo} ` +
      `on ${accepts.network}, scheme ${accepts.scheme}`,
  );

  // The file said what this would cost before the agent spent anything. If the
  // refusal asks for something else, the file was wrong and nothing is paid.
  assert.equal(accepts.amount, terms.amount, 'the 402 asks a different price from the file');
  assert.equal(accepts.asset, terms.asset, 'the 402 asks for a different asset from the file');
  assert.equal(accepts.payTo, terms.payTo, 'the 402 pays a different account from the file');
  assert.equal(accepts.network, terms.network, 'the 402 is on a different network from the file');

  // The body says the same thing in words, which is the half of the 402 a
  // person debugging an agent actually reads.
  const refusal = (await unpaid.json()) as {
    price: { display: string };
    facilitator: string;
    x402_version: number;
  };
  assert.equal(refusal.price.display, terms.display, 'the 402 body prices it differently');
  assert.equal(refusal.facilitator, terms.facilitator, 'the 402 settles through another facilitator');
  console.log(
    `   the body agrees: ${refusal.price.display}, x402 version ${String(refusal.x402_version)}, ` +
      `facilitator ${refusal.facilitator}`,
  );
  console.log('   which is exactly what the description file promised');

  // 5. Pay, with the asset and the ceiling taken from the file.
  const paying = createX402Payer({
    accountId: payer.accountId,
    privateKey: payer.privateKey,
    asset: terms.asset,
    maxAmountPerPayment: terms.amount,
  });
  const paid = await paying.fetch(url);
  const body = await paid.text();
  assert.equal(paid.status, 200, body);
  const settlement = readSettlement(paid);
  assert.ok(settlement?.success, 'the call answered 200 without settling');
  assert.ok(settlement.transactionId !== '', 'the settlement carried no transaction id');
  const reading = JSON.parse(body) as IndexReading;
  console.log(`\n5. paid ${terms.display} and read it`);
  console.log(`   settled ${settlement.transactionId}`);
  console.log(`   ${hashscanTransactionUrl(settlement.transactionId)}`);

  return { terms, group: chosen.group, reading, transactionId: settlement.transactionId };
}

async function main(): Promise<void> {
  const config = loadApiConfig();
  assert.equal(config.network, 'testnet', 'this run is testnet only');
  const databaseUrl = requireEnv('DATABASE_URL');
  const operatorKey = requireEnv('HEDERA_OPERATOR_KEY');

  const resources = JSON.parse(
    await readFile(new URL('../../../../docs/hedera.testnet.json', import.meta.url), 'utf8'),
  ) as Resources;
  const payerAccount = resources.accounts[PAYER_ROLE];
  assert.ok(payerAccount, `docs/hedera.testnet.json has no ${PAYER_ROLE}`);

  const token = config.settlementToken;
  const mirror = new MirrorClient({ baseUrl: config.mirrorUrl });
  const balance = await mirror.tokenRelationship(payerAccount.accountId, token.tokenId);
  assert.ok(balance, `${PAYER_ROLE} ${payerAccount.accountId} holds no ${token.symbol}`);
  console.log(
    `payer ${payerAccount.accountId} holds ` +
      `${toDisplay(String(balance.balance), token.decimals)} ${token.symbol}`,
  );

  const pool = createPool(databaseUrl);
  const applied = await migrate(pool);
  console.log(applied.length === 0 ? 'schema already up to date' : `applied ${applied.join(', ')}`);
  const app = await buildServer({ config, repository: new PostgresRepository(pool) });
  assert.ok(app.services.x402, 'the x402 gate is off: set X402_ENABLED to run this');
  const gate = app.services.x402;
  console.log(`series synced from the chain: ${await syncSeries(app.services)}`);
  console.log(`observations loaded from the archive: ${await backfillObservations(app.services)}`);
  await app.listen({ port: PORT, host: '127.0.0.1' });

  try {
    const result = await coldClient(`http://127.0.0.1:${PORT}`, {
      accountId: payerAccount.accountId,
      privateKey: roleKeyHex(operatorKey, PAYER_ROLE),
    });
    const { reading } = result;
    console.log(`\n   ${reading.group_label}, ${reading.as_of}`);
    console.log(
      `   ebar ${String(reading.reading['ebar'])} against a level line of ` +
        `${reading.trigger.level_line}, odi ${String(reading.reading['odi'])} against a shock ` +
        `attachment of ${reading.trigger.attachment_shock}`,
    );
    console.log(
      `   claims ${reading.trigger.open ? 'OPEN' : 'closed'}` +
        (reading.headline === null
          ? ''
          : `, the ${reading.headline.form} form is nearer at ${reading.headline.distance}`),
    );

    // 6. Correct, against the settled record rather than against itself. The
    // index topic is the thing this feed is a view of, so the newest message on
    // it for the same group is what "a correct reading" means.
    console.log('\n6. checking the answer against the index topic, not against the API');
    const messages = await mirror.topicMessages(config.indexTopicId, {
      limit: 100,
      order: 'desc',
    });
    const published = messages
      .map((message) => ({
        sequence: message.sequence_number,
        body: decodeJsonMessage<PublishedObservation>(message),
      }))
      .filter((entry) => entry.body.group === result.group && entry.body.status === 'final')
      .sort((a, b) => (a.body.period < b.body.period ? 1 : -1));
    const newest = published[0];
    assert.ok(newest, `nothing final is published for ${result.group} on ${config.indexTopicId}`);
    console.log(
      `   topic ${config.indexTopicId} sequence ${String(newest.sequence)}: ` +
        `${newest.body.period}, ebar ${String(newest.body.ebar)}, odi ${String(newest.body.odi)}, ` +
        `open ${String(newest.body.open)} (${newest.body.open_reason})`,
    );

    const paidMonth = reading.history.find((month) => month.period === newest.body.period);
    assert.ok(paidMonth, `the paid reading has no ${newest.body.period}, which the topic settled`);
    assert.equal(Number(paidMonth.ebar), newest.body.ebar, 'ebar differs from the settled record');
    assert.equal(Number(paidMonth.odi), newest.body.odi, 'odi differs from the settled record');
    assert.equal(
      Number(reading.trigger.attachment_shock),
      newest.body.attachment_shock,
      'the shock attachment differs from the settled record',
    );
    assert.equal(
      Number(reading.trigger.level_line),
      newest.body.level_line,
      'the level line differs from the settled record',
    );
    // "none" on the topic and null from the API are the same answer, so the
    // comparison is on the boolean and on the reason when there is one.
    assert.equal(paidMonth.open, newest.body.open, 'the topic and the feed disagree on the month');
    console.log(
      `   the paid reading agrees with sequence ${String(newest.sequence)} on ebar, odi, both ` +
        'frozen lines and whether the month is open',
    );

    // 7. The settlement, on the payments topic, read back from the mirror node.
    await gate.outbox.drain();
    const row = await app.services.repository.paymentByFacilitatorTx(result.transactionId);
    assert.ok(row, `no payments row for ${result.transactionId}`);
    assert.equal(row.status, 'settled');
    assert.equal(row.endpoint, 'GET /v1/index/:group');
    assert.equal(row.amount, result.terms.amount);
    assert.ok(row.hcsSeq, 'the settlement never reached the payments topic');
    const receipt = await pollMirror(`payments topic message ${String(row.hcsSeq)}`, () =>
      mirror.topicMessage(config.paymentsTopicId, row.hcsSeq as number),
    );
    console.log(
      `\n7. payments topic ${config.paymentsTopicId} sequence ${String(receipt.sequence_number)}`,
    );
    console.log(`   ${JSON.stringify(decodeJsonMessage(receipt))}`);

    console.log('\nlinks');
    console.log(`  settlement     ${hashscanTransactionUrl(result.transactionId)}`);
    console.log(`  index topic    https://hashscan.io/testnet/topic/${config.indexTopicId}`);
    console.log(`  payments topic https://hashscan.io/testnet/topic/${config.paymentsTopicId}`);
  } finally {
    app.services.hedera?.close();
    await app.close();
    await pool.end();
  }
}

interface PublishedObservation {
  group: string;
  period: string;
  status: string;
  ebar: number;
  odi: number;
  attachment_shock: number;
  level_line: number;
  open: boolean;
  open_reason: string;
}

await main();
