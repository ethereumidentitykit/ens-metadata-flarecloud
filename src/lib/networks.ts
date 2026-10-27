import { type Chain, mainnet, sepolia, holesky } from "viem/chains";
import type { Env } from "../env";
import { NAME_WRAPPER, SEPOLIA_NAME_WRAPPER } from "../constants";

export type NetworkName = "mainnet" | "sepolia" | "holesky";

export type NetworkConfig = {
  name: NetworkName;
  chain: Chain;
  rpcUrl: string;
  subgraphUrl: string;
};

export function nameWrapperAddress(network: NetworkName): `0x${string}` {
  return network === "sepolia" ? SEPOLIA_NAME_WRAPPER : NAME_WRAPPER;
}

export function grailsApiUrl(env: Env, network: NetworkName): string | undefined {
  const urls = {
    mainnet: env.GRAILS_API_URL_MAINNET,
    sepolia: env.GRAILS_API_URL_SEPOLIA,
    holesky: env.GRAILS_API_URL_HOLESKY,
  };
  return urls[network]?.trim() || undefined;
}

export function getNetwork(env: Env, name: string): NetworkConfig | null {
  switch (name) {
    case "mainnet":
      return {
        name: "mainnet",
        chain: mainnet,
        rpcUrl: env.ETH_RPC_URL,
        subgraphUrl: env.SUBGRAPH_URL_MAINNET,
      };
    case "sepolia":
      return {
        name: "sepolia",
        chain: sepolia,
        rpcUrl: env.SEPOLIA_RPC_URL,
        subgraphUrl: env.SUBGRAPH_URL_SEPOLIA,
      };
    case "holesky":
      return {
        name: "holesky",
        chain: holesky,
        rpcUrl: env.HOLESKY_RPC_URL,
        subgraphUrl: env.SUBGRAPH_URL_HOLESKY,
      };
    default:
      return null;
  }
}
