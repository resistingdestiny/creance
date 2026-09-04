import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type ContractTransactionReceipt,
  type InterfaceAbi,
} from 'ethers';

import { deriveRoleKeyHex, labelForRole } from '../scripts/hedera/derive.js';
import { ASSET_ABI, FACTORY_ABI, RESOLVER_ABI } from './abi.js';
import { ATS, CHAIN_ID, MIRROR_URL, RPC_URL, pinnedBondConfigVersion, readResources } from './config.js';

/// Everything that talks to the chain. The path is ethers over the JSON-RPC
/// relay rather than the ATS SDK, because the SDK's SupportedWallets are
/// Metamask, WalletConnect and three custodial services and none of them can be
/// driven from a shell. See docs/DECISIONS.md.

export function operatorKey(): string {
  const raw = (process.env.HEDERA_OPERATOR_KEY ?? '').trim();
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'HEDERA_OPERATOR_KEY must be a raw 32 byte hex ECDSA key. The example environment file says where it goes.',
    );
  }
  return hex;
}

/// The investor keys are not stored: each one is HKDF-SHA256 over the operator
/// key with the label creance/testnet/<role>, the same derivation the day 0
/// setup used, so the accounts are recoverable from the operator key alone.
export function roleKeyHex(role: string): string {
  return `0x${deriveRoleKeyHex(operatorKey(), labelForRole(role))}`;
}

export interface Session {
  provider: JsonRpcProvider;
  operator: Wallet;
  investors: { role: string; accountId: string; address: string; wallet: Wallet }[];
  /// A funded account that holds no KYC on the note, used for the transfer that
  /// has to fail.
  outsider: { role: string; accountId: string; address: string };
}

export function openSession(): Session {
  const resources = readResources();
  if (resources.network !== 'testnet') {
    throw new Error(`refusing to run against ${resources.network}: this build is testnet only`);
  }
  const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const operator = new Wallet(operatorKey(), provider);
  if (operator.address.toLowerCase() !== resources.operator.evmAddress.toLowerCase()) {
    throw new Error('the operator key does not match the operator account in docs/hedera.testnet.json');
  }
  const investors = ['investor-1', 'investor-2'].map((role) => {
    const account = resources.accounts[role];
    if (account === undefined) throw new Error(`${role} is missing from docs/hedera.testnet.json`);
    const wallet = new Wallet(roleKeyHex(role), provider);
    if (wallet.address.toLowerCase() !== account.evmAddress.toLowerCase()) {
      throw new Error(`the derived key for ${role} does not match its recorded EVM address`);
    }
    return { role, accountId: account.accountId, address: account.evmAddress, wallet };
  });
  const outsiderAccount = resources.accounts['policyholder-3'];
  if (outsiderAccount === undefined) {
    throw new Error('policyholder-3 is missing from docs/hedera.testnet.json');
  }
  return {
    provider,
    operator,
    investors,
    outsider: {
      role: 'policyholder-3',
      accountId: outsiderAccount.accountId,
      address: outsiderAccount.evmAddress,
    },
  };
}

export function factoryAt(runner: Wallet): Contract {
  return new Contract(ATS.factory, FACTORY_ABI as InterfaceAbi, runner);
}

export function resolverAt(runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(ATS.resolver, RESOLVER_ABI as InterfaceAbi, runner);
}

export function noteAt(address: string, runner: Wallet | JsonRpcProvider): Contract {
  return new Contract(address, ASSET_ABI as InterfaceAbi, runner);
}

/// The configuration version the factory has to be told. The web application
/// leaves it empty and resolves it at submit time; a direct call cannot, so it
/// is read here and then written into the deployment record so the series stays
/// reproducible after the next resolver upgrade.
export async function bondConfigVersion(provider: JsonRpcProvider): Promise<number> {
  const pinned = pinnedBondConfigVersion();
  if (pinned !== undefined) return pinned;
  const resolver = resolverAt(provider);
  const version = (await resolver.getLatestVersionByConfiguration!(ATS.bondConfigId)) as bigint;
  if (version === 0n) throw new Error('the resolver reports no registered bond configuration');
  return Number(version);
}

export interface SentTransaction {
  hash: string;
  gasUsed: number;
  receipt: ContractTransactionReceipt;
}

export async function send(
  label: string,
  call: Promise<{ hash: string; wait: () => Promise<ContractTransactionReceipt | null> }>,
): Promise<SentTransaction> {
  const tx = await call;
  const receipt = await tx.wait();
  if (receipt === null) throw new Error(`no receipt for ${label} (${tx.hash})`);
  if (receipt.status !== 1) {
    throw new Error(`${label} reverted on chain: ${hashscan('transaction', tx.hash)}`);
  }
  console.log(`  ${label} ${tx.hash} gas ${receipt.gasUsed}`);
  return { hash: tx.hash, gasUsed: Number(receipt.gasUsed), receipt };
}

/// The name of the custom error a call reverts with. Every ATS facet error is
/// in the IAsset ABI, so a revert reads back as a name rather than as four
/// bytes of data.
export function revertNameOf(error: unknown): string {
  const wrapped = error as {
    revert?: { name?: string; args?: unknown[] };
    shortMessage?: string;
    message?: string;
  };
  if (wrapped.revert?.name !== undefined) {
    const args = (wrapped.revert.args ?? []).map((value) => String(value)).join(', ');
    return args.length > 0 ? `${wrapped.revert.name}(${args})` : wrapped.revert.name;
  }
  return wrapped.shortMessage ?? wrapped.message ?? String(error);
}

/// A step that has to fail. The call is replayed as eth_call first, which is
/// what carries the revert data back, and only then sent, so the evidence is
/// both a decoded error name and a failed transaction anyone can open.
export async function expectRevert(
  label: string,
  contract: Contract,
  method: string,
  args: unknown[],
  overrides: Record<string, unknown>,
): Promise<{ revert: string; hash?: string }> {
  let revert: string | undefined;
  try {
    await contract[method]!.staticCall(...args, overrides);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const decoded = (error as { revert?: { name?: string } }).revert?.name;
    // An argument the ABI cannot encode never reaches the chain, so it proves
    // nothing about compliance and must not be recorded as if it had.
    if (decoded === undefined && code !== 'CALL_EXCEPTION') {
      throw new Error(`${label} failed before it reached the chain: ${revertNameOf(error)}`);
    }
    revert = revertNameOf(error);
  }
  if (revert === undefined) {
    throw new Error(`${label} was expected to fail and did not`);
  }
  let hash: string | undefined;
  try {
    const tx = (await contract[method]!(...args, overrides)) as {
      hash: string;
      wait: () => Promise<ContractTransactionReceipt | null>;
    };
    hash = tx.hash;
    await tx.wait();
  } catch (error) {
    const sent = (error as { receipt?: { hash?: string } }).receipt?.hash;
    if (sent !== undefined) hash = sent;
  }
  console.log(`  ${label} reverted with ${revert}${hash === undefined ? '' : ` ${hash}`}`);
  return { revert, hash };
}

/// The mirror node holds the consensus view, including the 0.0.x id HashScan
/// and every Hedera tool use. A contract has an EVM address from the moment it
/// is deployed but the mirror node needs a few seconds to catch up.
export async function contractIdOf(address: string, attempts = 10): Promise<string | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${MIRROR_URL}/contracts/${address}`);
      if (response.ok) {
        const body = (await response.json()) as { contract_id?: string };
        if (body.contract_id !== undefined) return body.contract_id;
      }
    } catch {
      // The mirror node rate limits and times out; the retry is the answer.
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return undefined;
}

/// The 0.0.x id and the EVM address of the factory and the resolver are two
/// spellings of the same contract, and both are in the example environment
/// file, so they are checked against each other on the mirror node rather than
/// trusted. An override of one and not the other is the failure this catches.
export async function checkAtsAddresses(): Promise<void> {
  for (const [what, id, address] of [
    ['factory', ATS.factoryId, ATS.factory],
    ['resolver', ATS.resolverId, ATS.resolver],
  ] as const) {
    const response = await fetch(`${MIRROR_URL}/contracts/${id}`);
    if (!response.ok) throw new Error(`the mirror node does not know the ATS ${what} ${id}`);
    const body = (await response.json()) as { evm_address?: string; deleted?: boolean };
    if (body.deleted === true) throw new Error(`the ATS ${what} ${id} is deleted`);
    if ((body.evm_address ?? '').toLowerCase() !== address.toLowerCase()) {
      throw new Error(
        `the ATS ${what} ${id} is ${body.evm_address} on the mirror node, not ${address}`,
      );
    }
  }
}

export type HashscanKind = 'account' | 'contract' | 'transaction';

export function hashscan(kind: HashscanKind, id: string): string {
  return `https://hashscan.io/testnet/${kind}/${id}`;
}
