import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from 'ethers';

import { ASSET_ABI } from '../ats/abi.js';
import { CHAIN_ID, MIRROR_URL, RPC_URL, readResources, type HederaResources } from '../ats/config.js';
import { deriveRoleKeyHex, labelForRole, normaliseRawKeyHex } from '../scripts/hedera/derive.js';
import {
  defaultSeries,
  readRecord,
  writeRecord,
  type DeploymentRecord,
  type SeriesRecord,
} from '../scripts/deploy/record.js';
import { ERC20_ABI, VAULT_ABI } from './abi.js';

/// Everything a coupon settlement or a maturity redemption needs to reach the
/// network, opened once and passed down.
///
/// Two runtimes sit side by side here on purpose. The contract calls go through
/// ethers over the JSON-RPC relay, which is how the rest of the build talks to
/// the vault and to the ATS note. The Scheduled Transaction and the topic
/// message go through the Hedera SDK, because neither has an EVM form. The SDK
/// is `@hiero-ledger/sdk` and never `@hashgraph/sdk`: one protobuf runtime per
/// process. See docs/DECISIONS.md.

export interface Party {
  role: string;
  accountId: string;
  address: string;
  key: PrivateKey;
  wallet: Wallet;
}

export interface CouponContext {
  resources: HederaResources;
  record: DeploymentRecord;
  provider: JsonRpcProvider;
  client: Client;
  operator: Party;
  api: Party;
  investors: Party[];
  policyholder: Party;
  vault: Contract;
  token: Contract;
  tokenId: string;
  decimals: number;
  paymentsTopicId: string;
  mirrorUrl: string;
  save: () => void;
}

function operatorKeyHex(): string {
  return normaliseRawKeyHex(process.env.HEDERA_OPERATOR_KEY ?? '');
}

function partyFor(
  role: string,
  resources: HederaResources,
  provider: JsonRpcProvider,
  keyHex: string,
): Party {
  const account = role === 'operator' ? resources.operator : resources.accounts[role];
  if (account === undefined) {
    throw new Error(`${role} is missing from docs/hedera.testnet.json`);
  }
  const wallet = new Wallet(`0x${keyHex}`, provider);
  if (wallet.address.toLowerCase() !== account.evmAddress.toLowerCase()) {
    throw new Error(`the key for ${role} does not match its recorded EVM address`);
  }
  return {
    role,
    accountId: account.accountId,
    address: account.evmAddress,
    key: PrivateKey.fromStringECDSA(keyHex),
    wallet,
  };
}

/**
 * The client the schedules and the topic message go out through. The api
 * account is the operator of this client because it is the account that holds
 * TREASURY_ROLE on the vault and the submit key on the payments topic, so one
 * key signs the whole settlement half.
 */
function apiClient(api: Party): Client {
  const client = Client.forTestnet();
  client.setOperator(api.accountId, api.key);
  return client;
}

export function openCouponContext(): CouponContext {
  const resources = readResources();
  if (resources.network !== 'testnet') {
    throw new Error(`refusing to run against ${resources.network}: this build is testnet only`);
  }
  const record = readRecord();
  const vaultRecord = record.collateralVault;
  if (vaultRecord === undefined) {
    throw new Error('no vault in the deployment record: run `pnpm contracts:deploy` first');
  }

  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const keyHex = operatorKeyHex();
  const derived = (role: string): string => deriveRoleKeyHex(keyHex, labelForRole(role));

  const operator = partyFor('operator', resources, provider, keyHex);
  const api = partyFor('api', resources, provider, derived('api'));
  const investors = ['investor-1', 'investor-2'].map((role) =>
    partyFor(role, resources, provider, derived(role)),
  );
  const policyholder = partyFor('policyholder-1', resources, provider, derived('policyholder-1'));

  const paymentsTopicId = resources.topics?.payments?.topicId;
  if (paymentsTopicId === undefined) {
    throw new Error('no payments topic in docs/hedera.testnet.json: run `pnpm hedera:setup`');
  }

  return {
    resources,
    record,
    provider,
    client: apiClient(api),
    operator,
    api,
    investors,
    policyholder,
    // The vault is driven by the api account, which holds TREASURY_ROLE and
    // SUBSCRIPTION_ROLE. Only openSeries needs the operator, and it connects
    // its own runner.
    vault: new Contract(vaultRecord.address, VAULT_ABI as unknown as InterfaceAbi, api.wallet),
    token: new Contract(
      resources.settlementToken.evmAddress,
      ERC20_ABI as unknown as InterfaceAbi,
      operator.wallet,
    ),
    tokenId: resources.settlementToken.tokenId,
    decimals: resources.settlementToken.decimals,
    paymentsTopicId,
    mirrorUrl: MIRROR_URL,
    save: () => {
      writeRecord(record);
    },
  };
}

/** The ATS note, through the IAsset union ABI. */
export function noteContract(address: string, runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, ASSET_ABI as InterfaceAbi, runner);
}

/**
 * The demo series, which is the head of the record.
 *
 * The coupon and maturity scripts are the T14 demonstration and they run
 * against that one series. The record carries every series now, so the head is
 * named here rather than in each of them.
 */
export function demoSeries(record: DeploymentRecord): SeriesRecord {
  const series = defaultSeries(record);
  if (series === undefined) {
    throw new Error('no series in the deployment record: run `pnpm contracts:deploy` first');
  }
  return series;
}

/** The note issued for the demo series, from the deployment record. */
export function demoNoteAddress(record: DeploymentRecord): string {
  const address = demoSeries(record).ats?.note?.address;
  if (address === undefined) {
    throw new Error('no note in the deployment record: run `pnpm ats:issue` first');
  }
  return address;
}
