import type { HardhatUserConfig } from 'hardhat/config';
import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';

// Testnet only. Hedera testnet reaches the EVM through the Hashio JSON-RPC
// relay; 296 is the testnet chain id.
// https://docs.hedera.com/hedera/core-concepts/smart-contracts/deploying-smart-contracts/json-rpc-relay
const hederaTestnetRpcUrl = process.env.HEDERA_RPC_URL ?? 'https://testnet.hashio.io/api';

// The deploy key is read from the environment and never written down here.
// Hardhat needs a raw 32 byte ECDSA key, so anything else (a DER encoded SDK
// key, or nothing at all) leaves the account list empty. An empty list is
// valid, so a clean clone with no environment file still loads this config and
// can compile and run the local tests.
function deployAccounts(): string[] {
  const raw = (process.env.HEDERA_OPERATOR_KEY ?? '').trim();
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? [hex] : [];
}

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
    },
  },
  // The Solidity tests live apart from the vitest suites in test/, which run
  // under a different runner and would otherwise be picked up by mocha.
  paths: {
    tests: { mocha: 'test/hardhat' },
  },
  // Manual HashScan verification is disabled; Sourcify supports chain 296 on
  // its default server and HashScan reads the result from there.
  // https://docs.hedera.com/hedera/tutorials/smart-contracts/how-to-verify-a-smart-contract-on-hashscan
  verify: {
    sourcify: { enabled: true },
    etherscan: { enabled: false },
    blockscout: { enabled: false },
  },
  networks: {
    // Local in-process chain, for unit tests only.
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    hederaTestnet: {
      type: 'http',
      chainType: 'l1',
      url: hederaTestnetRpcUrl,
      chainId: 296,
      accounts: deployAccounts(),
    },
  },
};

export default config;
