import { createClient, getTextRecord, normalizeName } from "./ens";
import type { NetworkConfig } from "../lib/networks";
import { notFound, unsupported } from "../lib/errors";

export type ResolvedUri =
  | { kind: "https"; url: string }
  | { kind: "ipfs"; uri: string }
  | { kind: "ipns"; uri: string }
  | { kind: "data"; uri: string }
  | {
      kind: "eip155";
      chainId: number;
      namespace: "erc721" | "erc1155";
      contract: `0x${string}`;
      tokenId: string;
    };

export type AvatarKind = "avatar" | "header";

export async function resolveRecord(
  network: NetworkConfig,
  kind: AvatarKind,
  rawName: string,
): Promise<string> {
  const name = normalizeName(rawName);
  const client = createClient(network);
  const value = await getTextRecord(client, name, kind);
  if (!value) throw notFound(`${kind} record not set for ${name}`);
  return value;
}

// Single, well-known Arweave gateway. Could be made configurable later, but
// arweave.net is the canonical public endpoint and supports the same path
// scheme as `ar://TXID[/path]`.
const ARWEAVE_GATEWAY = "https://arweave.net";
const ARWEAVE_RE = /^ar:\/\/([^/]+)(\/.*)?$/i;

export function arweaveGatewayUrl(uri: string): string | null {
  const match = uri.match(ARWEAVE_RE);
  if (!match) return null;
  return `${ARWEAVE_GATEWAY}/${match[1]}${match[2] ?? ""}`;
}

export function classifyUri(uri: string): ResolvedUri {
  if (uri.startsWith("data:")) return { kind: "data", uri };
  if (/^(?:ipfs:\/\/|ipfs\/)/i.test(uri)) return { kind: "ipfs", uri };
  if (/^(?:ipns:\/\/|ipns\/)/i.test(uri)) return { kind: "ipns", uri };

  if (/^ar:\/\//i.test(uri)) {
    // Rewrite to the Arweave gateway and let the HTTPS pipeline take over —
    // arweave.net responds with proper Content-Type/ETag/Content-Length for
    // the existing cache + revalidation logic.
    const url = arweaveGatewayUrl(uri);
    if (!url) throw unsupported("malformed ar:// URI");
    return { kind: "https", url };
  }

  const normalized = uri.startsWith("did:nft:")
    ? uri.slice("did:nft:".length).replace(/_/g, "/")
    : uri;
  const eip155 = normalized.match(
    /^eip155:(\d+)\/(erc721|erc1155):(0x[a-fA-F0-9]{40})\/(\d+)$/i,
  );
  if (eip155) {
    return {
      kind: "eip155",
      chainId: Number(eip155[1]),
      namespace: eip155[2]!.toLowerCase() as "erc721" | "erc1155",
      contract: eip155[3]! as `0x${string}`,
      tokenId: eip155[4]!,
    };
  }

  if (/^https?:\/\//i.test(uri)) return { kind: "https", url: uri };

  throw unsupported(`unsupported URI scheme: ${uri.slice(0, 40)}…`);
}

export function decodeDataUri(uri: string): { bytes: Uint8Array; mime: string } {
  const m = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) throw unsupported("malformed data URI");
  const mime = m[1] ?? "application/octet-stream";
  const isBase64 = !!m[2];
  const payload = m[3] ?? "";
  if (isBase64) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime };
}
