import { type Chain, mainnet, sepolia, holesky } from "viem/chains";
import type { Env } from "../env";

export type NetworkName = "mainnet" | "sepolia" | "holesky";

export type NetworkConfig = {
  name: NetworkName;
  chain: Chain;
  rpcUrl: string;
  ensnodeUrl: string;
  ethRegistryV2?: `0x${string}`;
};

function parseEthRegistryV2(value: string | undefined): `0x${string}` | undefined {
  if (!value) return undefined;
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value as `0x${string}`;
  return undefined;
}

export function getNetwork(env: Env, name: string): NetworkConfig | null {
  switch (name) {
    case "mainnet":
      return {
        name: "mainnet",
        chain: mainnet,
        rpcUrl: env.ETH_RPC_URL,
        ensnodeUrl: env.ENSNODE_URL_MAINNET,
        ethRegistryV2: parseEthRegistryV2(env.ENS_REGISTRY_V2_MAINNET),
      };
    case "sepolia":
      return {
        name: "sepolia",
        chain: sepolia,
        rpcUrl: env.SEPOLIA_RPC_URL,
        ensnodeUrl: env.ENSNODE_URL_SEPOLIA,
        ethRegistryV2: parseEthRegistryV2(env.ENS_REGISTRY_V2_SEPOLIA),
      };
    case "holesky":
      return {
        name: "holesky",
        chain: holesky,
        rpcUrl: env.HOLESKY_RPC_URL,
        ensnodeUrl: env.ENSNODE_URL_HOLESKY,
        ethRegistryV2: parseEthRegistryV2(env.ENS_REGISTRY_V2_HOLESKY),
      };
    default:
      return null;
  }
}
