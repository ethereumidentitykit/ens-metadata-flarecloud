import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { namehash } from "viem";
import type { Env } from "../env";
import { getNetwork } from "../lib/networks";
import { badRequest, notFound } from "../lib/errors";
import { queryDomainByName, resolveNftIdentifiers } from "../services/ensnode";
import { tokenIdToHex } from "../services/domain";
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
  },
});

queryNFTRoutes.openapi(route, async (c) => {
  const { name: rawName, network: networkName = "mainnet" } = c.req.valid("query");

  const network = getNetwork(c.env, networkName);
  if (!network) throw badRequest(`unknown network: ${networkName}`);

  const name = normalizeName(rawName);
  const hash = namehash(name);
  return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
    const record = await queryDomainByName(network, c.env, name);
    if (!record) throw notFound(`domain not found: ${name}`);

    const { contract, tokenId } = resolveNftIdentifiers(record, hash);

    const response = c.json(
      {
        name,
        namehash: hash,
        contract,
        tokenId,
        owner: record.owner?.id ?? null,
        registration: record.registration,
      },
      200,
    );
    response.headers.set("cache-control", `public, max-age=${CACHE_API_MAX_AGE}`);
    response.headers.set(
      "cache-tag",
      cacheTagHeader(
        nameTag(networkName, name),
        tokenTag(networkName, contract, tokenIdToHex(tokenId)),
      ),
    );
    return response;
  }) as never;
});
