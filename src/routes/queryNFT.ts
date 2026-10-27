import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { namehash } from "viem";
import type { Env } from "../env";
import { getNetwork } from "../lib/networks";
import { badRequest } from "../lib/errors";
import { resolveNameNFT } from "../services/domain";
import { normalizeName } from "../services/ens";
import { CACHE_API_MAX_AGE } from "../constants";
import { cacheTagHeader, nameTag, tokenTag } from "../lib/cacheTags";
import { respondFromCache } from "../lib/responseCache";
import { ErrorSchema, QueryNFTSchema } from "../schemas";

export const queryNFTRoutes = new OpenAPIHono<{ Bindings: Env }>();

const route = createRoute({
  method: "get",
  path: "/queryNFT",
  tags: ["query"],
  summary: "Look up an ENS name's NFT identifiers",
  description:
    "Resolve an ENS name to its current NFT contract, tokenId, owner and dates. Uses Grails on configured networks to detect ENSv2 names; legacy NFT identity comes from the subgraph. metadata_url can be fetched directly without a name hint. Cached identifiers can lag changes by up to 15 minutes; revalidate on-chain before transactions. network defaults to mainnet.",
  request: {
    query: z.object({
      name: z.string().min(1).openapi({ example: "vitalik.eth" }),
      network: z
        .enum(["mainnet", "sepolia", "holesky"])
        .optional()
        .openapi({ example: "mainnet" }),
    }),
  },
  responses: {
    200: {
      description: "NFT identifiers",
      content: { "application/json": { schema: QueryNFTSchema } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "Metadata provider failed", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Metadata provider temporarily unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

queryNFTRoutes.openapi(route, async (c) => {
  const { name: rawName, network: networkName = "mainnet" } = c.req.valid("query");

  const network = getNetwork(c.env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);

  const name = normalizeName(rawName);
  const hash = namehash(name);
  return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
    const { record, contract, tokenHex, ensVersion } = await resolveNameNFT(c.env, network, name);
    const tokenId = BigInt(tokenHex).toString();
    const metadataUrl = new URL(`/${networkName}/${contract}/${tokenId}`, c.req.url);

    const response = c.json(
      {
        name,
        namehash: hash,
        contract,
        tokenId,
        ens_version: ensVersion,
        metadata_url: metadataUrl.href,
        owner: record.owner?.id ?? null,
        registration: record.registration ? {
          registrationDate: record.registration.registrationDate,
          expiryDate: record.registration.expiryDate,
        } : null,
      },
      200,
    );
    response.headers.set("cache-control", `public, max-age=${CACHE_API_MAX_AGE}`);
    response.headers.set(
      "cache-tag",
      cacheTagHeader(nameTag(networkName, name), tokenTag(networkName, contract, tokenHex)),
    );
    return response;
  }) as never;
});
