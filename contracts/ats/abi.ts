import { createRequire } from 'node:module';

/// The ABIs come from @hashgraph/asset-tokenization-contracts at the pinned
/// version, so they are the ones compiled from the contracts the testnet
/// factory deploys rather than a hand written fragment list that can drift.
/// The package ships its artifacts under an exports subpath and is CommonJS,
/// which is why they are loaded through require rather than an import
/// attribute.
const require = createRequire(import.meta.url);

interface Artifact {
  abi: unknown[];
}

function artifact(path: string): unknown[] {
  return (require(`@hashgraph/asset-tokenization-contracts/artifacts/${path}`) as Artifact).abi;
}

/// The factory that deploys the bond proxy.
export const FACTORY_ABI = artifact('contracts/factory/IFactory.sol/IFactory.json');

/// IAsset is the union interface over every facet the resolver dispatches to,
/// so one ABI covers roles, issuance, transfer, KYC, SSI, pause, freeze,
/// coupons and maturity on the bond proxy. It also carries the custom errors,
/// which is what makes a failed transfer report a name rather than raw data.
export const ASSET_ABI = artifact('contracts/facets/IAsset.sol/IAsset.json');

/// The Business Logic Resolver, read only here: the configuration version the
/// factory has to be given is whatever it reports as the latest.
export const RESOLVER_ABI = artifact(
  'contracts/infrastructure/diamond/BusinessLogicResolver.sol/BusinessLogicResolver.json',
);
