import { isAddress, labelhash, namehash, toHex } from "viem";
import type { Env } from "../env";
import { badRequest, notFound, upstream } from "../lib/errors";
import { BASE_REGISTRAR_V1 } from "../constants";
import { getNetwork, grailsApiUrl, nameWrapperAddress, type NetworkConfig, type NetworkName } from "../lib/networks";
import { normalizeName } from "./ens";
import { queryGrailsName, queryGrailsToken } from "./grails";
import {
  queryDomainByLabelhash,
  queryDomainByNamehash,
  type DomainRecord,
} from "./subgraph";

export type ContractKind = "base-registrar" | "name-wrapper" | "ensv2";

export type ResolvedDomain = {
  network: NetworkConfig;
  kind: ContractKind;
  tokenHex: `0x${string}`;
  record: DomainRecord;
  avatarUrl?: string;
};

export function tokenIdToHex(tokenId: string): `0x${string}` {
  if (!/^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(tokenId)) {
    throw badRequest(`invalid tokenId: ${tokenId}`);
  }
  try {
    return toHex(BigInt(tokenId), { size: 32 });
  } catch {
    throw badRequest(`invalid tokenId: ${tokenId}`);
  }
}

export function contractKind(contract: string, network: NetworkName = "mainnet"): ContractKind | null {
  const c = contract.toLowerCase();
  if (c === BASE_REGISTRAR_V1.toLowerCase()) return "base-registrar";
  if (c === nameWrapperAddress(network).toLowerCase()) return "name-wrapper";
  return null;
}

export async function resolveDomain(
  env: Env,
  networkName: string,
  contract: string,
  tokenIdRaw: string,
  nameHint?: string,
  includeAvatar = false,
): Promise<ResolvedDomain> {
  const network = getNetwork(env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);
  if (!isAddress(contract)) throw badRequest("invalid contract address");

  const tokenHex = tokenIdToHex(tokenIdRaw);
  const name = nameHint === undefined ? undefined : normalizeName(nameHint);
  const kind = contractKind(contract, network.name);
  if (!kind) {
    if (!grailsApiUrl(env, network.name)) throw badRequest(`unsupported contract: ${contract}`);
    const result = await queryGrailsToken(env, network, contract, tokenHex, includeAvatar);
    if (!result || result.version !== 2 || !result.record.owner || (name && name !== result.record.name)) {
      throw notFound("no matching current ENSv2 token");
    }
    return { network, kind: "ensv2", tokenHex, record: result.record, avatarUrl: result.avatarUrl };
  }

  // A name hint is only a discovery aid. Never let it relabel a legacy token.
  if (name) {
    const expected = kind === "base-registrar" ? labelhash(name.split(".")[0]!) : namehash(name);
    if (expected !== tokenHex || (kind === "base-registrar" && !isEth2LD(name))) {
      throw notFound("name does not match this token ID");
    }
  }

  let record: DomainRecord | null;
  try {
    record = kind === "base-registrar"
      ? await queryDomainByLabelhash(network, env, tokenHex)
      : await queryDomainByNamehash(network, env, tokenHex);
  } catch (error) {
    if (!grailsApiUrl(env, network.name)) throw error;
    record = null;
  }
  if (!record && grailsApiUrl(env, network.name)) {
    const result = await queryGrailsToken(env, network, contract, tokenHex, includeAvatar);
    // A migrated V2 name must never be presented as its retired V1 token.
    if (result?.version === 1 && result.record.owner && result.record.name) {
      const foundName = result.record.name;
      const expected = kind === "base-registrar" ? labelhash(foundName.split(".")[0]!) : namehash(foundName);
      if (expected !== tokenHex || (kind === "base-registrar" && !isEth2LD(foundName))
        || (name && name !== foundName)) throw upstream("Grails name does not match the legacy token");
      return { network, kind, tokenHex, record: result.record, avatarUrl: result.avatarUrl };
    }
  }

  if (!record) throw notFound(`domain not found for token ${tokenIdRaw}`);
  return { network, kind, tokenHex, record };
}

function isEth2LD(name: string): boolean {
  const labels = name.split(".");
  return labels.length === 2 && labels[1] === "eth";
}

export async function resolveNameNFT(env: Env, network: NetworkConfig, name: string) {
  // On a V2-enabled network the API is authoritative: a successful stale V1
  // subgraph response cannot tell us whether this name has migrated.
  if (grailsApiUrl(env, network.name)) {
    const result = await queryGrailsName(env, network, name);
    if (!result) throw notFound(`domain not found: ${name}`);
    if (result.version === 2) {
      if (!result.record.owner) throw notFound(`name has no token owner: ${name}`);
      if (contractKind(result.contract!, network.name)) throw upstream("Grails returned a legacy contract for an ENSv2 name");
      return { contract: result.contract!, tokenHex: tokenIdToHex(result.tokenId), ensVersion: 2 as const, record: result.record };
    }
  }
  const record = await queryDomainByNamehash(network, env, namehash(name));
  if (!record) throw notFound(`domain not found: ${name}`);
  if (record.wrappedOwner) {
    return { contract: nameWrapperAddress(network.name), tokenHex: namehash(name), ensVersion: 1 as const,
      record: { ...record, owner: record.wrappedOwner } };
  }
  if (isEth2LD(name) && record.registration) {
    return { contract: BASE_REGISTRAR_V1, tokenHex: labelhash(name.split(".")[0]!), ensVersion: 1 as const,
      record: { ...record, owner: record.registration.registrant ?? null } };
  }
  throw notFound(`name has no supported NFT: ${name}`);
}
