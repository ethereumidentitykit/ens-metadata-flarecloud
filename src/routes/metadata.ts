import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { keccak256, namehash } from "viem";
import type { Env } from "../env";
import { resolveDomain } from "../services/domain";
import { CACHE_API_MAX_AGE } from "../constants";
import { cacheTagHeader, nameTag, tokenTag } from "../lib/cacheTags";
import { respondFromCache } from "../lib/responseCache";
import {
  AddressParam,
  ErrorSchema,
  NFTMetadataSchema,
  NetworkParam,
  TokenIdParam,
  type MetadataAttribute,
} from "../schemas";
import { ens_normalize } from "@adraffy/ens-normalize";

export const metadataRoutes = new OpenAPIHono<{ Bindings: Env }>();

const route = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}",
  tags: ["metadata"],
  summary: "Get ENS NFT metadata JSON",
  description:
    "ERC-721/1155 metadata for ENSv1 BaseRegistrar/NameWrapper and ENSv2 registry tokens. ENSv2 uses a network-specific Grails token lookup, verified against the registry and current token ID. tokenId may be decimal or 0x-hex. The legacy version field describes the metadata format; ens_version identifies the ENS protocol.",
  request: {
    params: z.object({
      network: NetworkParam,
      contract: AddressParam,
      tokenId: TokenIdParam,
    }),
    query: z.object({ name: z.string().min(1).optional().openapi({ description: "Optional name constraint, checked against the requested token", example: "hmnd-demo.eth" }) }),
  },
  responses: {
    200: {
      description: "NFT metadata",
      content: { "application/json": { schema: NFTMetadataSchema } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    410: { description: "Token retired by the metadata provider", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "Metadata provider failed", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Metadata provider temporarily unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

function isNormalized(name: string): boolean {
  try {
    return ens_normalize(name) === name;
  } catch {
    return false;
  }
}

metadataRoutes.openapi(route, async (c) => {
  return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
    const { network: networkName, contract, tokenId: tokenIdRaw } = c.req.valid("param");
    const nameHint = c.req.valid("query").name;
    const { kind, tokenHex, record } = await resolveDomain(
      c.env,
      networkName,
      contract,
      tokenIdRaw,
      nameHint,
    );

    const name = record.name ?? (record.labelName ? `${record.labelName}.eth` : null);
    const registration = record.registration;
    const attributes: MetadataAttribute[] = [];

    if (record.createdAt) {
      attributes.push({
        trait_type: "Created Date",
        display_type: "date",
        value: Number(record.createdAt) * 1000,
      });
    }
    if (record.labelName) {
      attributes.push({ trait_type: "Length", value: record.labelName.length });
    }
    if (registration?.registrationDate) {
      attributes.push({
        trait_type: "Registration Date",
        display_type: "date",
        value: Number(registration.registrationDate) * 1000,
      });
    }
    if (registration?.expiryDate) {
      attributes.push({
        trait_type: "Expiration Date",
        display_type: "date",
        value: Number(registration.expiryDate) * 1000,
      });
    }

    const tokenHash =
      kind === "ensv2" ? tokenHex : kind === "base-registrar" && record.labelName
        ? keccak256(new TextEncoder().encode(record.labelName))
        : name
          ? namehash(name)
          : tokenHex;

    const origin = new URL(c.req.url).origin;
    const imageUrl = new URL(`/${networkName}/${contract}/${tokenIdRaw}/image`, origin);
    if (name && nameHint) imageUrl.searchParams.set("name", name);
    const image = imageUrl.href;
    const normalized = name ? isNormalized(name) : false;
    const backgroundImage = normalized
      ? `${origin}/${networkName}/avatar/${encodeURIComponent(name!)}`
      : null;

    const response = c.json(
      {
        is_normalized: normalized,
        name: name ?? "unknown.eth",
        description: name
          ? `${name}, an ENS name.`
          : "This domain name could not be resolved.",
        attributes,
        name_length: record.labelName?.length ?? null,
        url: name ? `https://app.ens.domains/name/${name}` : null,
        version: kind === "base-registrar" ? 1 : 2,
        ens_version: kind === "ensv2" ? 2 : 1,
        background_image: backgroundImage,
        image,
        image_url: image,
        token_hash: tokenHash,
      },
      200,
    );
    response.headers.set("cache-control", `public, max-age=${CACHE_API_MAX_AGE}`);
    response.headers.set(
      "cache-tag",
      cacheTagHeader(
        tokenTag(networkName, contract, tokenHex),
        name ? nameTag(networkName, name) : undefined,
      ),
    );
    return response;
  }) as never;
});
