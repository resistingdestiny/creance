import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';

import { EthersChainGateway } from '../../src/chain/cover-pool.js';
import { SdkHederaGateway } from '../../src/chain/hedera.js';
import { loadApiConfig } from '../../src/config.js';
import { createPool } from '../../src/db/postgres.js';
import { migrate } from '../../src/db/migrate.js';
import { newId, nullifierToBytes32, toBytes32 } from '../../src/ids.js';
import { encodeTopicMessage, policyBindingMessage, policyBoundMessage } from '../../src/receipts.js';

/// `pnpm --filter @creance/api testnet:bind-backdated`
///
/// One policy on the demo series with a start date in the past, so that a
/// separation inside the April 2026 loss window can be claimed on testnet.
///
/// Why this exists, plainly, because it is a demonstration artefact and not a
/// product path. `CoverPool.bind` does not validate `startAt`: the BINDER role
/// is trusted to state when cover began. Every policy this build has bound
/// through `POST /v1/bind` started at the moment of binding, in September 2026,
/// so its waiting period ends in November and `payClaim` reverts
/// `SeparationInWaitingPeriod` for any separation in the loss window the
/// replayed history opened. The window closes on 5 October 2026, before any
/// separation that would qualify under a September start could occur, so no
/// policy bound today can ever be paid on this series.
///
/// The honest fix for a demonstration is to say so and to bind one policy whose
/// cover really did begin earlier, which is what this does. It is recorded in
/// docs/DECISIONS.md and docs/HEDERA.md as an artefact of the replay, and the
/// route a person uses is untouched.
///
///     --holder ROLE        policyholder-1, -2 or -3, default policyholder-1
///     --start YYYY-MM-DD   UTC midnight the cover began, default 2025-12-01
///     --limit MINOR        cover limit in minor units, default 1000000000
///     --premium MINOR      the monthly premium, default 28000000
///
/// It writes to testnet and to the database, so it is a command and never part
/// of `pnpm test`.

const { values } = parseArgs({
  options: {
    holder: { type: 'string', default: 'policyholder-1' },
    start: { type: 'string', default: '2025-12-01' },
    limit: { type: 'string', default: '1000000000' },
    premium: { type: 'string', default: '28000000' },
  },
});

const config = loadApiConfig();
assert.equal(config.network, 'testnet', 'this run is testnet only');
assert.ok(config.api.key, 'the api account has no key: set HEDERA_OPERATOR_KEY or HEDERA_API_KEY');
assert.ok(config.operator.key, 'the operator key is not set');
const databaseUrl = config.databaseUrl;
assert.ok(databaseUrl, 'DATABASE_URL is not set, so there is nowhere to write a policy');

const resources = JSON.parse(
  readFileSync(new URL('../../../../docs/hedera.testnet.json', import.meta.url), 'utf8'),
) as { accounts: Record<string, { accountId: string; evmAddress: string }> };
const holder = resources.accounts[values.holder as string];
assert.ok(holder, `docs/hedera.testnet.json has no ${String(values.holder)}`);

const startAt = Math.floor(Date.parse(`${values.start as string}T00:00:00Z`) / 1000);
assert.ok(Number.isFinite(startAt), `--start takes a calendar date, got ${String(values.start)}`);
const limit = BigInt(values.limit as string);
const premium = BigInt(values.premium as string);

const series = config.series[0];
assert.ok(series, 'the deployment record has no registered series');

const pool = createPool(databaseUrl);
await migrate(pool);

const chain = new EthersChainGateway(
  config.coverPoolAddress,
  config.vaultAddress,
  config.rpcUrl,
  config.chainId,
  config.api.key,
);
const state = await chain.seriesState(series.seriesId);
console.log(`series ${series.label}: ${state.status}, free capacity ${state.freeCapacity}`);
assert.ok(
  state.freeCapacity >= limit,
  `the series has ${state.freeCapacity} free and this policy needs ${limit}`,
);
assert.ok(
  state.status === 'active' || state.status === 'claims_open',
  `the series is ${state.status} and takes no new cover`,
);

const endsAt = startAt + state.termSeconds;
const payableFrom = startAt + state.waitingPeriodSeconds;
console.log(`cover ${values.start} to ${new Date(endsAt * 1000).toISOString().slice(0, 10)}`);
console.log(`claims payable from ${new Date(payableFrom * 1000).toISOString().slice(0, 10)}`);

// A fresh person every run, so the one-active-policy rule never refuses a
// repeat and the demo can be rebuilt from nothing.
const nullifier = `${Date.now()}${randomInt(100_000, 999_999)}`;
const policyId = newId('policy');

const hedera = new SdkHederaGateway({
  network: config.network,
  mirrorUrl: config.mirrorUrl,
  policyNftTokenId: config.policyNftTokenId,
  apiAccountId: config.api.accountId,
  apiKey: config.api.key,
  operatorAccountId: config.operator.accountId,
  operatorKey: config.operator.key,
});

try {
  // The receipt first, because `bind` takes its sequence number as an input.
  const receipt = await hedera.publish(
    config.paymentsTopicId,
    encodeTopicMessage(
      policyBindingMessage({
        seriesLabel: series.label,
        seriesKey: series.seriesId,
        policyId,
        groupKey: series.groupKey,
        holderAccountId: holder.accountId,
        holderAddress: holder.evmAddress,
        limit,
        premium,
        tokenId: config.settlementToken.tokenId,
        startAt: new Date(startAt * 1000),
        quotedAt: new Date(),
      }),
    ),
  );
  console.log(`binding receipt sequence ${receipt.sequenceNumber}`);

  const write = await chain.bind({
    policyId: toBytes32(policyId),
    seriesId: series.seriesId,
    holder: holder.evmAddress,
    nullifierHash: nullifierToBytes32(nullifier),
    limit,
    premium,
    startAt,
    hcsReceiptSeq: receipt.sequenceNumber,
  });
  console.log(`bind ${write.transactionHash}, gas ${write.gasUsed}`);

  await pool.query(
    `INSERT INTO users (nullifier, group_key, wallet, wallet_evm)
     VALUES ($1,$2,$3,$4) ON CONFLICT (nullifier) DO NOTHING`,
    [nullifier, series.groupKey, holder.accountId, holder.evmAddress],
  );
  await pool.query(
    `INSERT INTO policies (policy_id, series_id, group_key, nullifier, wallet, wallet_evm,
                           cover_limit, premium, asset, asset_decimals, status,
                           starts_at, ends_at, claims_payable_from, paid_through,
                           hcs_topic, hcs_receipt_seq, bind_tx_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13,$14,$15,$16,$17)`,
    [
      policyId,
      series.label,
      series.groupKey,
      nullifier,
      holder.accountId,
      holder.evmAddress,
      limit.toString(),
      premium.toString(),
      config.settlementToken.tokenId,
      config.settlementToken.decimals,
      new Date(startAt * 1000).toISOString(),
      new Date(endsAt * 1000).toISOString(),
      new Date(startAt * 1000).toISOString().slice(0, 10),
      Number(values.start?.slice(0, 4)) * 100 + Number(values.start?.slice(5, 7)),
      receipt.topicId,
      receipt.sequenceNumber,
      write.transactionHash,
    ],
  );

  // The receipt NFT, exactly as `POST /v1/bind` mints it. A mint that fails
  // leaves the cover in place, because the cover is the chain's and the NFT is
  // a receipt for it.
  let serial: number | null = null;
  try {
    const nft = await hedera.mintPolicyNft(
      holder.accountId,
      JSON.stringify({ p: policyId, s: series.label }),
    );
    serial = nft.serial;
    await pool.query('UPDATE policies SET nft_token_id = $2, nft_serial = $3 WHERE policy_id = $1', [
      policyId,
      nft.tokenId,
      nft.serial,
    ]);
    console.log(`policy receipt ${nft.tokenId} serial ${nft.serial}`);
  } catch (error) {
    console.log(`the policy receipt did not mint: ${(error as Error).message}`);
  }

  await hedera.publish(
    config.paymentsTopicId,
    encodeTopicMessage(
      policyBoundMessage({
        seriesLabel: series.label,
        policyId,
        receiptSeq: receipt.sequenceNumber,
        status: 'bound',
        bindTx: write.transactionHash,
        ...(serial === null ? {} : { nftTokenId: config.policyNftTokenId, serial }),
      }),
    ),
  );

  const after = await chain.seriesState(series.seriesId);
  console.log('');
  console.log(`policy      ${policyId}`);
  console.log(`holder      ${holder.accountId} ${holder.evmAddress}`);
  console.log(`nullifier   stored, ${nullifier.length} digits`);
  console.log(`bind        https://hashscan.io/testnet/transaction/${write.transactionHash}`);
  console.log(`exposure    ${after.activeExposure} of ${after.principalRemaining}`);
} finally {
  hedera.close();
  await pool.end();
}
