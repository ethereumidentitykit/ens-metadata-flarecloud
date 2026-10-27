export const RESOLVER_TTL_SECONDS = 15 * 60;
export const STALE_RESOLVER_TTL_SECONDS = 2 * 60 * 60;
export const CACHE_API_MAX_AGE = 15 * 60;

// Marks an avatar/header response as the generic fallback image (record not
// set, or a pre-stream upstream failure) rather than the real asset. Lets
// preload tell "served a placeholder" apart from a genuine warm.
export const DEFAULT_IMAGE_HEADER = "x-ens-default-image";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const RPC_TIMEOUT_MS = 5_000;
export const IPFS_GATEWAY_TIMEOUT_MS = 4_000;
export const HTTPS_IMAGE_TIMEOUT_MS = 5_000;

export const BASE_REGISTRAR_V1 = "0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85" as const;
export const NAME_WRAPPER = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401" as const;
export const SEPOLIA_NAME_WRAPPER = "0x0635513f179D50A207757E05759CbD106d7dFcE8" as const;
// Historical metadata format v2 refers to the ENSv1 NameWrapper, not ENSv2.
export const NAME_WRAPPER_V2 = NAME_WRAPPER;

/**
 * Legacy mainnet contracts, retained for callers of this module. Runtime
 * invalidation uses the network's NameWrapper address. ENSv2 registries are
 * dynamic and must be invalidated with an explicit contract and token ID.
 *
 * `derivation` is how a tokenId is derived from a name for this contract:
 *   - "label" — `labelhash(firstLabel)` (base registrar, ETH 2LDs only)
 *   - "name"  — `namehash(fullName)` (name wrapper, any ENS name)
 *
 */
export const TOKEN_CONTRACTS = [
  { address: BASE_REGISTRAR_V1, derivation: "label" },
  { address: NAME_WRAPPER_V2, derivation: "name" },
] as const satisfies ReadonlyArray<{
  address: `0x${string}`;
  derivation: "label" | "name";
}>;

export const ETH_NAMEHASH =
  "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae" as const;
