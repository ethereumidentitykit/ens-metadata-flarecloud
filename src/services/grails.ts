import { z } from "zod";
import { labelhash, namehash, zeroAddress } from "viem";
import type { Env } from "../env";
import { grailsApiUrl, type NetworkConfig } from "../lib/networks";
import { HttpError, notFound, upstream } from "../lib/errors";
import { normalizeName } from "./ens";
import type { DomainRecord } from "./subgraph";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const timestamp = z.string().datetime({ offset: true }).nullable();
const tokenId = z.string().regex(/^[0-9]{1,78}$/).pipe(z.string().refine((id) => BigInt(id) < 2n ** 256n));
const NameResponse = z.object({
  success: z.literal(true),
  data: z.object({
    name: z.string().min(1),
    version: z.union([z.literal(1), z.literal(2)]),
    token_id: tokenId,
    token_contract: address.nullable(),
    owner: address.nullable(),
    creation_date: timestamp,
    registration_date: timestamp,
    expiry_date: timestamp,
  }),
});

const token = z.object({ contract: address, token_id: tokenId });
const TokenResponse = z.object({
  success: z.literal(true),
  data: z.object({
    name: z.string().min(1),
    ens_version: z.union([z.literal(1), z.literal(2)]),
    token: token.extend({ is_current: z.boolean() }),
    current_token: token,
    owner: address.nullable(),
    registration_date: timestamp,
    expiry_date: timestamp,
    // Optional enrichment must not invalidate an otherwise usable identity.
    avatar: z.unknown().optional(),
  }),
});

export type GrailsName = {
  version: 1 | 2;
  contract: `0x${string}` | null;
  tokenId: string;
  record: DomainRecord;
  avatarUrl?: string;
};

function seconds(value: string | null): string {
  return value === null ? "" : String(Math.floor(Date.parse(value) / 1000));
}

function toRecord(data: {
  name: string;
  owner: string | null;
  creation_date?: string | null;
  registration_date: string | null;
  expiry_date: string | null;
}): DomainRecord {
  let name: string;
  try {
    name = normalizeName(data.name);
  } catch {
    throw upstream("Grails returned an invalid ENS name");
  }
  if (name !== data.name) throw upstream("Grails returned a non-normalized ENS name");
  const label = name.split(".")[0]!;
  return {
    id: namehash(name), name, labelName: label, labelhash: labelhash(label),
    // by-token does not return a creation date; do not invent one.
    createdAt: seconds(data.creation_date ?? null),
    registration: data.registration_date !== null || data.expiry_date !== null
      ? { registrationDate: seconds(data.registration_date), expiryDate: seconds(data.expiry_date) }
      : null,
    owner: data.owner && data.owner !== zeroAddress ? { id: data.owner } : null,
  };
}

async function requestGrails(env: Env, network: NetworkConfig, path: string): Promise<unknown> {
  const base = grailsApiUrl(env, network.name);
  if (!base) throw new HttpError(503, `Grails API is not configured for ${network.name}`, "missing_grails_api");
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      // Workers supports follow/manual only. Reject 3xx via !ok below.
      redirect: "manual",
    });
    if (response.status === 404) return undefined;
    if (response.status === 410) throw new HttpError(410, "ENS token has been retired", "token_retired");
    if (response.status === 429 || response.status === 503) {
      throw new HttpError(503, "Grails lookup is temporarily unavailable", "grails_unavailable");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Do not expose upstream URLs or bodies in public errors/logs.
    throw upstream("Grails lookup failed");
  }
}

/** The backend selects its chain by deployment, not by a URL chainId segment. */
export async function queryGrailsToken(
  env: Env,
  network: NetworkConfig,
  contract: string,
  tokenIdRaw: string,
  includeAvatar = false,
): Promise<GrailsName | null> {
  const requestedId = BigInt(tokenIdRaw).toString();
  const requestedContract = contract.toLowerCase();
  const path = `/names/by-token/${requestedContract}/${requestedId}`;
  let body: unknown;
  try {
    body = await requestGrails(env, network, `${path}${includeAvatar ? "?include=avatar" : ""}`);
  } catch (error) {
    // The backend waits on its avatar worker. Retry identity alone if that
    // optional enrichment makes the request fail or exceed our deadline.
    if (!includeAvatar || !(error instanceof HttpError) || ![502, 503].includes(error.status)) throw error;
    body = await requestGrails(env, network, path);
  }
  if (body === undefined) return null;
  const parsed = TokenResponse.safeParse(body);
  if (!parsed.success) throw upstream("invalid Grails token response");
  const data = parsed.data.data;
  if (data.token.contract.toLowerCase() !== requestedContract || BigInt(data.token.token_id).toString() !== requestedId) {
    throw upstream("Grails returned a different token");
  }
  // The API can resolve historical or even unissued versions to a name.
  // is_current=false alone is not proof that this particular token existed.
  if (!data.token.is_current) throw notFound("requested token is not the current ENS NFT");
  if (data.current_token.contract.toLowerCase() !== requestedContract
    || BigInt(data.current_token.token_id).toString() !== requestedId) {
    throw upstream("Grails returned inconsistent current token identity");
  }
  return {
    version: data.ens_version, contract: requestedContract as `0x${string}`, tokenId: requestedId,
    record: toRecord(data),
    // This is a resolved image URL, not the raw ENS avatar text record.
    avatarUrl: includeAvatar && typeof data.avatar === "string" && data.avatar.length > 0 ? data.avatar : undefined,
  };
}

/** Grails /metadata contains resolver records; /names/:name has NFT identity. */
export async function queryGrailsName(
  env: Env,
  network: NetworkConfig,
  rawName: string,
): Promise<GrailsName | null> {
  const name = normalizeName(rawName);
  const body = await requestGrails(env, network, `/names/${encodeURIComponent(name)}`);
  if (body === undefined) return null;
  const parsed = NameResponse.safeParse(body);
  if (!parsed.success) throw upstream("invalid Grails name response");
  const data = parsed.data.data;
  if (data.name !== name) throw upstream("Grails returned a different name");
  if (data.version === 2 && (!data.token_contract || data.token_contract === zeroAddress)) {
    throw upstream("Grails V2 name is missing its registry contract");
  }
  return {
    version: data.version,
    contract: data.token_contract as `0x${string}` | null,
    tokenId: BigInt(data.token_id).toString(),
    record: toRecord(data),
  };
}
