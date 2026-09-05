// Day 0 Hedera testnet resources for Creance: the nine service and demo
// accounts, the settlement token, the policy NFT collection and the four
// consensus topics.
//
// The script is idempotent. It reads docs/hedera.testnet.json, verifies every
// id on the mirror node, and creates only what is missing, so a second run
// prints "nothing to do" and leaves the working tree clean. Account keys are
// not stored: they are derived from the operator key with HKDF-SHA256, so the
// whole account list is recoverable from the operator key alone.
//
// Run it with: pnpm hedera:setup   (add --plan to print the plan and stop)
//
// References, all read on 2026-09-04:
//   https://docs.hedera.com/hedera/sdks-and-apis/sdks/accounts-and-hbar/create-an-account
//   https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
//   https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account
//   https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/create-a-topic
//   https://docs.hedera.com/hedera/sdks-and-apis/rest-api
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenId,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TransferTransaction,
  type Transaction,
  type TransactionReceipt,
} from '@hiero-ledger/sdk';
import {
  ACCOUNT_ROLES,
  ROLE_FUNDING_HBAR,
  type AccountRole,
  entityIdToEvmAddress,
  envNamesForRole,
  evmAddressFromKey,
  hashscanUrl,
  isLongZeroAddress,
  normaliseRawKeyHex,
  roleKey,
  toMinorUnits,
  toMirrorTransactionId,
} from './hedera/derive.js';
import { Mirror, assertTestnetChainId, pollMirror } from './hedera/mirror.js';
import { mergeDocument, renderGeneratedBlock } from './hedera/document.js';
import {
  DISTRIBUTION_WHOLE_TOKENS,
  type FreezeDefaultFinding,
  type HederaRecord,
  TOPIC_NAMES,
  TOPIC_PLAN,
  type TopicName,
  describePlan,
  planIsEmpty,
  planSetup,
} from './hedera/plan.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECORD_PATH = resolve(REPO_ROOT, 'docs/hedera.testnet.json');
const DOCUMENT_PATH = resolve(REPO_ROOT, 'docs/HEDERA.md');

const SETTLEMENT_TOKEN_NAME = 'Creance Test USD';
const SETTLEMENT_TOKEN_SYMBOL = 'TUSD';
const SETTLEMENT_DECIMALS = 6;
const SETTLEMENT_INITIAL_SUPPLY = toMinorUnits(1_000_000, SETTLEMENT_DECIMALS);
const POLICY_NFT_NAME = 'Creance Occupation Cover Policy';
const POLICY_NFT_SYMBOL = 'CPOL';

const DEFAULT_RPC_URL = 'https://testnet.hashio.io/api';
const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com/api/v1';
const DEFAULT_FACILITATOR_URL = 'https://api.testnet.blocky402.com';

/** The label the probe account is derived under. It is not part of the demo. */
const PROBE_ROLE = 'probe/freeze-default';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value.trim();
}

function statusOf(error: unknown): string {
  const status = (error as { status?: { toString(): string } } | null)?.status;
  return status ? status.toString() : '';
}

interface Submitted {
  receipt: TransactionReceipt;
  transactionId: string;
  link: string;
}

/**
 * Freeze, sign with any extra key, execute, wait for the receipt. The operator
 * signs as fee payer inside execute, so only another account's key goes in
 * signers.
 */
async function submit(
  client: Client,
  transaction: Transaction,
  signers: PrivateKey[] = [],
): Promise<Submitted> {
  let prepared = transaction.freezeWith(client);
  for (const signer of signers) {
    prepared = await prepared.sign(signer);
  }
  const response = await prepared.execute(client);
  const receipt = await response.getReceipt(client);
  const transactionId = toMirrorTransactionId(response.transactionId.toString());
  return { receipt, transactionId, link: hashscanUrl('transaction', transactionId) };
}

function emptyRecord(operator: { accountId: string; evmAddress: string }): HederaRecord {
  return {
    network: 'testnet',
    operator,
    accounts: {},
    settlementToken: null,
    policyNft: null,
    topics: {},
    distributions: {},
    associations: {},
    findings: { freezeDefault: null },
    blocky402: null,
    operatorBalanceHbarAtLastChange: '0',
    lastChanged: '',
  };
}

function loadRecord(operator: { accountId: string; evmAddress: string }): HederaRecord {
  if (!existsSync(RECORD_PATH)) {
    return emptyRecord(operator);
  }
  const parsed = JSON.parse(readFileSync(RECORD_PATH, 'utf8')) as HederaRecord;
  if (parsed.operator?.accountId !== operator.accountId) {
    throw new Error(
      `${RECORD_PATH} was written by operator ${parsed.operator?.accountId}, but HEDERA_OPERATOR_ID is ${operator.accountId}. ` +
        'The derived accounts belong to the other operator; move the file aside before running against a different one.',
    );
  }
  return { ...emptyRecord(operator), ...parsed };
}

/** Serialise with a fixed key order so the file is stable across runs. */
function serialiseRecord(record: HederaRecord): string {
  const accounts: HederaRecord['accounts'] = {};
  for (const role of ACCOUNT_ROLES) {
    if (record.accounts[role]) accounts[role] = record.accounts[role];
  }
  const topics: HederaRecord['topics'] = {};
  for (const name of TOPIC_NAMES) {
    if (record.topics[name]) topics[name] = record.topics[name];
  }
  const distributions: HederaRecord['distributions'] = {};
  const associations: HederaRecord['associations'] = {};
  for (const role of ACCOUNT_ROLES) {
    if (record.distributions[role]) distributions[role] = record.distributions[role];
    const list = record.associations[role];
    if (list && list.length > 0) associations[role] = [...list].sort();
  }
  const ordered: HederaRecord = {
    network: record.network,
    operator: record.operator,
    accounts,
    settlementToken: record.settlementToken,
    policyNft: record.policyNft,
    topics,
    distributions,
    associations,
    findings: record.findings,
    blocky402: record.blocky402,
    operatorBalanceHbarAtLastChange: record.operatorBalanceHbarAtLastChange,
    lastChanged: record.lastChanged,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function writeIfChanged(path: string, content: string): boolean {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (existing === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  return true;
}

async function facilitatorFeePayer(url: string): Promise<{ facilitator: string; feePayer: string }> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/supported`);
  if (!response.ok) {
    throw new Error(`the x402 facilitator at ${url} answered ${response.status}`);
  }
  const body = (await response.json()) as {
    kinds?: { network?: string; extra?: { feePayer?: string } }[];
  };
  const hedera = body.kinds?.find((kind) => kind.network === 'hedera:testnet');
  if (!hedera?.extra?.feePayer) {
    throw new Error(`the x402 facilitator at ${url} does not list hedera:testnet`);
  }
  return { facilitator: url, feePayer: hedera.extra.feePayer };
}

interface Context {
  client: Client;
  mirror: Mirror;
  operatorId: AccountId;
  operatorKey: PrivateKey;
  operatorKeyHex: string;
}

/**
 * Create one account with an ECDSA key whose EVM address is set at creation,
 * then read it back. A long-zero address here would silently break the
 * ECRECOVER check CoverPool uses to authorise a claim payment, so it is fatal.
 */
async function createAccount(
  context: Context,
  role: string,
  balanceHbar: number,
): Promise<{ accountId: string; evmAddress: string }> {
  const key = roleKey(context.operatorKeyHex, role);
  const expected = evmAddressFromKey(key);

  const existing = await context.mirror.account(expected);
  if (existing && !existing.deleted) {
    console.log(`  ${role}: already on chain as ${existing.account} (${expected})`);
    return { accountId: existing.account, evmAddress: expected };
  }

  const { receipt, link } = await submit(
    context.client,
    new AccountCreateTransaction()
      // Sets the key and derives the EVM address from the same ECDSA key.
      .setECDSAKeyWithAlias(key.publicKey)
      .setInitialBalance(new Hbar(balanceHbar))
      // -1 is unlimited automatic token associations, so a transfer to this
      // account never fails with TOKEN_NOT_ASSOCIATED_TO_ACCOUNT.
      .setMaxAutomaticTokenAssociations(-1),
  );
  const accountId = receipt.accountId?.toString();
  if (!accountId) {
    throw new Error(`no account id in the receipt for ${role}`);
  }

  const mirrored = await pollMirror(`account ${accountId} for ${role}`, () =>
    context.mirror.account(accountId),
  );
  const evmAddress = `0x${(mirrored.evm_address ?? '').replace(/^0x/, '')}`.toLowerCase();
  if (isLongZeroAddress(evmAddress)) {
    throw new Error(
      `${role} (${accountId}) came back with the long-zero address ${evmAddress}. ` +
        'A long-zero account cannot pass an ECRECOVER check, so it cannot hold the CLAIMS role.',
    );
  }
  if (evmAddress !== expected) {
    throw new Error(`${role} (${accountId}) has EVM address ${evmAddress}, expected ${expected}`);
  }
  if (mirrored.max_automatic_token_associations !== -1) {
    throw new Error(
      `${role} (${accountId}) has ${String(mirrored.max_automatic_token_associations)} auto-association slots, expected -1`,
    );
  }
  console.log(`  ${role}: ${accountId} (${evmAddress}), ${balanceHbar} HBAR, ${link}`);
  return { accountId, evmAddress };
}

async function createSettlementToken(context: Context) {
  const { receipt, link } = await submit(
    context.client,
    new TokenCreateTransaction()
      .setTokenName(SETTLEMENT_TOKEN_NAME)
      .setTokenSymbol(SETTLEMENT_TOKEN_SYMBOL)
      .setTokenType(TokenType.FungibleCommon)
      // Six decimals is the USDC convention and the unit the x402 exact scheme
      // settles in. It can never be changed after creation.
      .setDecimals(SETTLEMENT_DECIMALS)
      .setInitialSupply(Number(SETTLEMENT_INITIAL_SUPPLY))
      .setTreasuryAccountId(context.operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      // The key set is fixed at creation. A key not set here can never be added.
      .setAdminKey(context.operatorKey.publicKey)
      .setSupplyKey(context.operatorKey.publicKey)
      .setFreezeKey(context.operatorKey.publicKey)
      // Token creation is one of the pricier transactions and the 1 HBAR
      // default max fee can under-cover it.
      .setMaxTransactionFee(new Hbar(30)),
  );
  const tokenId = receipt.tokenId?.toString();
  if (!tokenId) throw new Error('no token id in the settlement token receipt');
  await pollMirror(`settlement token ${tokenId}`, () => context.mirror.token(tokenId));
  console.log(`  settlement token: ${tokenId}, ${link}`);
  return {
    tokenId,
    evmAddress: entityIdToEvmAddress(tokenId),
    name: SETTLEMENT_TOKEN_NAME,
    symbol: SETTLEMENT_TOKEN_SYMBOL,
    decimals: SETTLEMENT_DECIMALS,
    origin: 'created' as const,
  };
}

async function adoptSettlementToken(context: Context, tokenId: string) {
  const token = await context.mirror.token(tokenId);
  if (!token || token.deleted) {
    throw new Error(`TESTNET_USDC_TOKEN_ID names ${tokenId}, which the mirror node does not have`);
  }
  const decimals = Number(token.decimals);
  console.log(`  settlement token: adopting ${tokenId} (${token.symbol}, ${decimals} decimals)`);
  return {
    tokenId,
    evmAddress: entityIdToEvmAddress(tokenId),
    name: token.name,
    symbol: token.symbol,
    decimals,
    origin: 'provided' as const,
  };
}

async function createNftCollection(
  context: Context,
  name: string,
  symbol: string,
  freezeDefault: boolean,
) {
  const transaction = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.NonFungibleUnique)
    .setDecimals(0)
    // An NFT collection is required to start at zero supply; serials come from
    // mints.
    .setInitialSupply(0)
    .setSupplyType(TokenSupplyType.Infinite)
    .setTreasuryAccountId(context.operatorId)
    .setAdminKey(context.operatorKey.publicKey)
    .setSupplyKey(context.operatorKey.publicKey)
    .setFreezeKey(context.operatorKey.publicKey)
    .setMaxTransactionFee(new Hbar(30));
  if (freezeDefault) {
    // An account must be unfrozen before it can receive the token, which is how
    // the policy receipt stays non-transferable between binds.
    transaction.setFreezeDefault(true);
  }
  const { receipt, link } = await submit(context.client, transaction);
  const tokenId = receipt.tokenId?.toString();
  if (!tokenId) throw new Error(`no token id in the receipt for ${name}`);
  await pollMirror(`collection ${tokenId}`, () => context.mirror.token(tokenId));
  console.log(`  ${symbol}: ${tokenId}, freeze default ${freezeDefault}, ${link}`);
  return { tokenId, link };
}

/**
 * Two questions the documentation does not answer, settled on a throwaway
 * collection before the real one is created.
 *
 * 1. Does freezeDefault true compose with maxAutomaticTokenAssociations -1? If
 *    it does not, the real collection cannot use freezeDefault.
 * 2. Is the NFT metadata cap 100 characters or 100 bytes? The mint page says
 *    characters, the Solidity helper library says bytes.
 */
async function runFreezeDefaultProbe(context: Context): Promise<FreezeDefaultFinding> {
  console.log('Freeze default probe (throwaway collection, not used by the demo):');
  const holder = await createAccount(context, PROBE_ROLE, 1);
  const collection = await createNftCollection(
    context,
    'Creance Freeze Default Probe',
    'CPROBE',
    true,
  );
  const tokenId = TokenId.fromString(collection.tokenId);

  const mint = await submit(
    context.client,
    new TokenMintTransaction().setTokenId(tokenId).setMetadata([Buffer.from('creance-probe')]),
  );
  const serial = mint.receipt.serials[0];
  if (serial === undefined) throw new Error('the probe mint returned no serial');

  let composes = false;
  let detail: string;
  try {
    const transfer = await submit(
      context.client,
      new TransferTransaction().addNftTransfer(
        tokenId,
        serial,
        context.operatorId,
        AccountId.fromString(holder.accountId),
      ),
    );
    composes = true;
    detail = `serial ${serial.toString()} landed on the auto-associating account ${holder.accountId}, ${transfer.link}`;
  } catch (error) {
    const status = statusOf(error);
    detail = `the transfer to the auto-associating account ${holder.accountId} failed with ${status || String(error)}`;
  }
  console.log(`  freeze default composes with auto-association: ${composes}. ${detail}`);

  // 100 ASCII bytes is the documented cap and must pass.
  await submit(
    context.client,
    new TokenMintTransaction().setTokenId(tokenId).setMetadata([Buffer.from('a'.repeat(100))]),
  );
  // 60 characters of two-byte UTF-8 is 120 bytes. Passing means the cap counts
  // characters; failing means it counts bytes.
  let metadataLimit: FreezeDefaultFinding['metadataLimit'];
  let metadataDetail: string;
  try {
    await submit(
      context.client,
      new TokenMintTransaction().setTokenId(tokenId).setMetadata([Buffer.from('é'.repeat(60))]),
    );
    metadataLimit = 'characters';
    metadataDetail = '100 ASCII bytes and 60 two-byte characters (120 bytes) both minted';
  } catch (error) {
    const status = statusOf(error);
    metadataLimit = 'bytes';
    metadataDetail = `100 ASCII bytes minted, 60 two-byte characters (120 bytes) failed with ${status || String(error)}`;
  }
  console.log(`  metadata cap counts ${metadataLimit}: ${metadataDetail}`);

  return {
    composesWithAutoAssociation: composes,
    probeTokenId: collection.tokenId,
    probeAccountId: holder.accountId,
    detail,
    metadataLimit,
    metadataDetail,
  };
}

async function createTopic(context: Context, name: TopicName) {
  const plan = TOPIC_PLAN[name];
  const transaction = new TopicCreateTransaction()
    .setTopicMemo(plan.memo)
    // An admin key keeps a wrong memo fixable; the submit key is what makes the
    // topic a settlement record rather than an open log.
    .setAdminKey(context.operatorKey.publicKey);
  if (plan.submitKeyRole) {
    transaction.setSubmitKey(roleKey(context.operatorKeyHex, plan.submitKeyRole).publicKey);
  }
  const { receipt, link } = await submit(context.client, transaction);
  const topicId = receipt.topicId?.toString();
  if (!topicId) throw new Error(`no topic id in the receipt for ${name}`);
  await pollMirror(`topic ${topicId}`, () => context.mirror.topic(topicId));
  console.log(
    `  ${name}: ${topicId}, submit key ${plan.submitKeyRole ?? 'none (public)'}, ${link}`,
  );
  return { topicId, memo: plan.memo, submitKeyRole: plan.submitKeyRole };
}

async function distribute(
  context: Context,
  role: AccountRole,
  accountId: string,
  tokenId: string,
  decimals: number,
  whole: number,
): Promise<string> {
  const target = toMinorUnits(whole, decimals);
  const relationship = await context.mirror.tokenRelationship(accountId, tokenId);
  const held = BigInt(relationship?.balance ?? 0);
  if (held >= target) {
    console.log(`  ${role}: already holds ${held.toString()} minor units`);
    return held.toString();
  }
  const amount = target - held;
  const { link } = await submit(
    context.client,
    new TransferTransaction()
      // Amounts are signed integers in minor units and must net to zero.
      .addTokenTransfer(tokenId, context.operatorId, -Number(amount))
      .addTokenTransfer(tokenId, AccountId.fromString(accountId), Number(amount)),
  );
  const settled = await pollMirror(`the ${role} balance of ${tokenId}`, async () => {
    const current = await context.mirror.tokenRelationship(accountId, tokenId);
    return current && BigInt(current.balance) >= target ? current : null;
  });
  const slot = settled.automatic_association ? 'auto-association slot consumed' : 'already associated';
  console.log(`  ${role}: ${target.toString()} minor units, ${slot}, ${link}`);
  return target.toString();
}

/**
 * Associate explicitly, signed by the account's own key. Benign when the
 * association already exists, which is the case the idempotent re-run hits.
 */
async function associate(
  context: Context,
  role: AccountRole,
  accountId: string,
  tokenId: string,
): Promise<void> {
  try {
    const { link } = await submit(
      context.client,
      new TokenAssociateTransaction()
        .setAccountId(AccountId.fromString(accountId))
        .setTokenIds([tokenId]),
      [roleKey(context.operatorKeyHex, role)],
    );
    console.log(`  ${role} associated with ${tokenId}, ${link}`);
  } catch (error) {
    if (statusOf(error) === 'TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT') {
      console.log(`  ${role} was already associated with ${tokenId}`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const planOnly = process.argv.includes('--plan');
  const network = process.env.HEDERA_NETWORK ?? 'testnet';
  if (network !== 'testnet') {
    throw new Error(`HEDERA_NETWORK is ${network}. This project is testnet only.`);
  }

  const operatorId = AccountId.fromString(required('HEDERA_OPERATOR_ID'));
  const operatorKeyHex = normaliseRawKeyHex(required('HEDERA_OPERATOR_KEY'));
  const operatorKey = PrivateKey.fromStringECDSA(operatorKeyHex);
  const rpcUrl = process.env.HEDERA_RPC_URL ?? DEFAULT_RPC_URL;
  const mirrorUrl = process.env.HEDERA_MIRROR_URL ?? DEFAULT_MIRROR_URL;
  const facilitatorUrl = process.env.BLOCKY402_URL ?? DEFAULT_FACILITATOR_URL;

  // Nothing writes until the relay and the mirror node have both answered.
  const chainId = await assertTestnetChainId(rpcUrl);
  console.log(`Relay ${rpcUrl}: chain id ${chainId}`);
  const mirror = new Mirror(mirrorUrl);
  const operatorAccount = await mirror.account(operatorId.toString());
  if (!operatorAccount) {
    throw new Error(`the mirror node has no account ${operatorId.toString()}`);
  }
  const balanceHbar = (operatorAccount.balance?.balance ?? 0) / 1e8;
  console.log(
    `Operator ${operatorId.toString()} (${operatorAccount.evm_address}): ${balanceHbar} HBAR`,
  );
  const needed = Object.values(ROLE_FUNDING_HBAR).reduce((sum, hbar) => sum + hbar, 0);
  if (balanceHbar < needed + 20) {
    console.warn(
      `Warning: the operator holds ${balanceHbar} HBAR. A full first run funds ${needed} HBAR of accounts ` +
        'and should leave at least 20 HBAR for the T04 contract deploys. Top up at https://portal.hedera.com/faucet.',
    );
  }

  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  // The default cap is 1 HBAR, which token creation exceeds.
  client.setDefaultMaxTransactionFee(new Hbar(10));
  client.setDefaultMaxQueryPayment(new Hbar(5));

  const context: Context = { client, mirror, operatorId, operatorKey, operatorKeyHex };

  try {
    const record = loadRecord({
      accountId: operatorId.toString(),
      evmAddress: `0x${(operatorAccount.evm_address ?? '').replace(/^0x/, '')}`.toLowerCase(),
    });

    const providedSettlement = process.env.TESTNET_USDC_TOKEN_ID?.trim();
    const settlementDecimals = record.settlementToken?.decimals ?? SETTLEMENT_DECIMALS;

    // Verify every id the record claims, so a record that drifted from the
    // chain repairs itself instead of being trusted.
    const confirmed = { accounts: new Set<string>(), tokens: new Set<string>(), topics: new Set<string>() };
    for (const role of ACCOUNT_ROLES) {
      const entry = record.accounts[role];
      if (!entry) continue;
      const account = await mirror.account(entry.accountId);
      if (account && !account.deleted) confirmed.accounts.add(entry.accountId);
    }
    for (const tokenId of [record.settlementToken?.tokenId, record.policyNft?.tokenId]) {
      if (!tokenId) continue;
      const token = await mirror.token(tokenId);
      if (token && !token.deleted) confirmed.tokens.add(tokenId);
    }
    for (const name of TOPIC_NAMES) {
      const entry = record.topics[name];
      if (!entry) continue;
      const topic = await mirror.topic(entry.topicId);
      if (topic && !topic.deleted) confirmed.topics.add(entry.topicId);
    }

    const balances: Partial<Record<AccountRole, bigint>> = {};
    const associated: Partial<Record<AccountRole, Set<string>>> = {};
    for (const role of ACCOUNT_ROLES) {
      const entry = record.accounts[role];
      if (!entry || !confirmed.accounts.has(entry.accountId)) continue;
      const set = new Set<string>();
      for (const tokenId of confirmed.tokens) {
        const relationship = await mirror.tokenRelationship(entry.accountId, tokenId);
        if (!relationship) continue;
        set.add(tokenId);
        if (tokenId === record.settlementToken?.tokenId) {
          balances[role] = BigInt(relationship.balance);
        }
      }
      associated[role] = set;
    }

    const plan = planSetup({ record, confirmed, balances, associated, settlementDecimals });
    const steps = describePlan(plan);
    if (steps.length === 0) {
      console.log('Plan: nothing to create.');
    } else {
      console.log('Plan:');
      for (const step of steps) console.log(`  - ${step}`);
    }
    if (planOnly) {
      console.log('--plan given, stopping before any write.');
      return;
    }

    if (plan.accounts.length > 0) {
      console.log('Accounts:');
      for (const role of plan.accounts) {
        record.accounts[role] = await createAccount(context, role, ROLE_FUNDING_HBAR[role]);
      }
    }

    if (plan.settlementToken) {
      console.log('Settlement token:');
      record.settlementToken = providedSettlement
        ? await adoptSettlementToken(context, providedSettlement)
        : await createSettlementToken(context);
    }

    if (plan.freezeDefaultProbe) {
      record.findings.freezeDefault = await runFreezeDefaultProbe(context);
    }

    if (plan.policyNft) {
      console.log('Policy NFT collection:');
      const freezeDefault = record.findings.freezeDefault?.composesWithAutoAssociation ?? false;
      const collection = await createNftCollection(
        context,
        POLICY_NFT_NAME,
        POLICY_NFT_SYMBOL,
        freezeDefault,
      );
      record.policyNft = {
        tokenId: collection.tokenId,
        evmAddress: entityIdToEvmAddress(collection.tokenId),
        name: POLICY_NFT_NAME,
        symbol: POLICY_NFT_SYMBOL,
        decimals: 0,
        freezeDefault,
      };
    }

    if (plan.topics.length > 0) {
      console.log('Topics:');
      for (const name of plan.topics) {
        record.topics[name] = await createTopic(context, name);
      }
    }

    const settlement = record.settlementToken;
    if (!settlement) throw new Error('the settlement token is missing after the create step');

    if (plan.distributions.length > 0) {
      console.log('Demo balances:');
      for (const role of plan.distributions) {
        const account = record.accounts[role];
        const whole = DISTRIBUTION_WHOLE_TOKENS[role];
        if (!account || whole === undefined) continue;
        record.distributions[role] = await distribute(
          context,
          role,
          account.accountId,
          settlement.tokenId,
          settlement.decimals,
          whole,
        );
      }
    }

    if (plan.associations.length > 0) {
      console.log('Associations:');
      for (const { role, kind } of plan.associations) {
        const account = record.accounts[role];
        const tokenId = kind === 'settlement' ? settlement.tokenId : record.policyNft?.tokenId;
        if (!account || !tokenId) continue;
        await associate(context, role, account.accountId, tokenId);
        const list = new Set(record.associations[role] ?? []);
        list.add(tokenId);
        record.associations[role] = [...list];
      }
    }

    if (!record.blocky402) {
      record.blocky402 = await facilitatorFeePayer(facilitatorUrl);
      console.log(
        `x402 facilitator ${record.blocky402.facilitator}: hedera:testnet fee payer ${record.blocky402.feePayer}`,
      );
    }

    const changed = !planIsEmpty(plan) || record.lastChanged === '';
    if (changed) {
      record.operatorBalanceHbarAtLastChange = String(
        await mirror.operatorBalanceHbar(operatorId.toString()),
      );
      record.lastChanged = new Date().toISOString().slice(0, 10);
    }

    const wroteRecord = writeIfChanged(RECORD_PATH, serialiseRecord(record));
    const existingDocument = existsSync(DOCUMENT_PATH) ? readFileSync(DOCUMENT_PATH, 'utf8') : null;
    const wroteDocument = writeIfChanged(
      DOCUMENT_PATH,
      mergeDocument(existingDocument, renderGeneratedBlock(record)),
    );

    console.log('');
    console.log('Environment names later tickets read (add the values to your .env):');
    for (const role of ACCOUNT_ROLES) {
      const names = envNamesForRole(role);
      console.log(`  ${names.id}=${record.accounts[role]?.accountId ?? ''}`);
      console.log(`  ${names.key}=  # HKDF-SHA256 from the operator key, label creance/testnet/${role}`);
    }
    console.log(`  HEDERA_SETTLEMENT_TOKEN_ID=${settlement.tokenId}`);
    console.log(`  HEDERA_POLICY_NFT_ID=${record.policyNft?.tokenId ?? ''}`);
    console.log(`  HEDERA_TOPIC_INDEX=${record.topics.index?.topicId ?? ''}`);
    console.log(`  HEDERA_TOPIC_PAYMENTS=${record.topics.payments?.topicId ?? ''}`);
    console.log(`  HEDERA_TOPIC_CLAIMS=${record.topics.claims?.topicId ?? ''}`);
    console.log(`  HEDERA_TOPIC_JOURNAL=${record.topics['agent-journal']?.topicId ?? ''}`);
    console.log('  TESTNET_USDC_TOKEN_ID=  # leave blank to keep minting TUSD');

    console.log('');
    if (!wroteRecord && !wroteDocument) {
      console.log('nothing to do: every resource already exists and both files are unchanged.');
    } else {
      console.log(
        `wrote ${[wroteRecord ? 'docs/hedera.testnet.json' : null, wroteDocument ? 'docs/HEDERA.md' : null]
          .filter(Boolean)
          .join(' and ')}`,
      );
    }
  } finally {
    // The client keeps a network update timer alive; without this the script
    // never exits.
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
