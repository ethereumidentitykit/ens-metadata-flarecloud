import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Env } from "../env";
import { contractKind, resolveDomain, tokenIdToHex } from "../services/domain";
import { CACHE_API_MAX_AGE } from "../constants";
import { getGenerated, putGenerated } from "../storage/r2Cache";
import {
  AddressParam,
  ErrorSchema,
  NetworkParam,
  TokenIdParam,
} from "../schemas";
import { cacheTagHeader, nameTag, tokenTag } from "../lib/cacheTags";
import { respondFromCache } from "../lib/responseCache";

export const nameImageRoutes = new OpenAPIHono<{ Bindings: Env }>();

// Bump per format whenever the template or rendering semantics change so
// cached objects don't serve stale output.
const SVG_CACHE_VERSION = "svg-v6";
const PNG_CACHE_VERSION = "png-v6";
const MAX_AGE = 60 * 60 * 24 * 365;
const SVG_CONTENT_TYPE = "image/svg+xml";
const PNG_CONTENT_TYPE = "image/png";

const PathParams = z.object({
  network: NetworkParam,
  contract: AddressParam,
  tokenId: TokenIdParam,
});
const QueryParams = z.object({ name: z.string().min(1).optional().openapi({ description: "Optional name constraint, checked against the requested token" }) });

const svgRoute = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}/image",
  tags: ["metadata"],
  summary: "Get the rendered ENS name image as SVG",
  description:
    "Server-rendered ENS name card as SVG (embedded Satoshi font; emoji and CJK handled). Legacy cards use R2 and edge caching. ENSv2 uses Grails token lookup and a 15-minute edge cache.",
  request: { params: PathParams, query: QueryParams },
  responses: {
    200: {
      description: "SVG image",
      content: { "image/svg+xml": { schema: z.string() } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    410: { description: "Token retired by the metadata provider", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "Metadata provider failed", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Metadata provider temporarily unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

const pngRoute = createRoute({
  method: "get",
  path: "/{network}/{contract}/{tokenId}/image/png",
  tags: ["metadata"],
  summary: "Get the rendered ENS name image as PNG",
  description:
    "Server-rendered ENS name card as PNG via resvg-wasm. Legacy cards use R2 and edge caching. ENSv2 uses Grails token lookup and a 15-minute edge cache.",
  request: { params: PathParams, query: QueryParams },
  responses: {
    200: {
      description: "PNG image",
      content: { "image/png": { schema: z.string() } },
    },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    410: { description: "Token retired by the metadata provider", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "Metadata provider failed", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Metadata provider temporarily unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

function respond(
  body: ArrayBuffer | string,
  contentType: string,
  tags: string[],
  maxAge = MAX_AGE,
): Response {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": `public, max-age=${maxAge}`,
  };
  const tag = cacheTagHeader(...tags);
  if (tag) headers["cache-tag"] = tag;
  return new Response(body, { headers });
}

type RenderResult =
  | { kind: "svg"; svg: string; name: string }
  | { kind: "response"; response: Response };

async function renderSvgFromParams(
  c: Context<{ Bindings: Env }>,
  networkName: string,
  contract: string,
  tokenId: string,
): Promise<RenderResult> {
  const resolved = await resolveDomain(c.env, networkName, contract, tokenId, c.req.query("name"), true);
  const name =
    resolved.record.name
    ?? (resolved.record.labelName ? `${resolved.record.labelName}.eth` : null);
  if (!name) {
    return {
      kind: "response",
      response: c.json({ error: "not_found", message: "name not available" }, 404),
    };
  }
  const { renderNameImage } = await import("../services/nameImage");
  const svg = await renderNameImage({
    env: c.env,
    ctx: c.executionCtx,
    networkName,
    name,
    tokenHex: resolved.tokenHex,
    avatarUrl: resolved.avatarUrl,
  });
  return { kind: "svg", svg, name };
}

function utf8Bytes(s: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(s);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}

function uint8Bytes(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function tagsFor(
  networkName: string,
  contract: string,
  tokenHex: string,
  name: string | undefined,
): string[] {
  const tags = [tokenTag(networkName, contract, tokenHex)];
  if (name) tags.push(nameTag(networkName, name));
  return tags;
}

nameImageRoutes.openapi(svgRoute, async (c) => {
  return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
    const { network: networkName, contract, tokenId } = c.req.valid("param");
    const tokenHex = tokenIdToHex(tokenId);
    const legacy = contractKind(contract, networkName) !== null;
    const cacheKey = {
      network: networkName,
      contract,
      tokenHex,
      version: SVG_CACHE_VERSION,
    };
    // V2 parent links and token versions can change. Revalidate after the
    // short edge TTL instead of keeping an indefinitely reusable R2 card.
    const hit = legacy ? await getGenerated(c.env, cacheKey) : null;
    if (hit) {
      return respond(
        hit.bytes,
        hit.contentType,
        tagsFor(networkName, contract, tokenHex, hit.name),
      );
    }

    const result = await renderSvgFromParams(c, networkName, contract, tokenId);
    if (result.kind === "response") return result.response;

    const { embedSatoshiFont } = await import("../services/nameImage");
    const selfContained = embedSatoshiFont(result.svg);
    const bytes = utf8Bytes(selfContained);
    if (legacy) c.executionCtx.waitUntil(
      putGenerated(c.env, cacheKey, bytes, SVG_CONTENT_TYPE, result.name),
    );
    return respond(
      selfContained,
      SVG_CONTENT_TYPE,
      tagsFor(networkName, contract, tokenHex, result.name),
      legacy ? MAX_AGE : CACHE_API_MAX_AGE,
    );
  }) as never;
});

nameImageRoutes.openapi(pngRoute, async (c) => {
  return respondFromCache(caches.default, c.req.raw, c.executionCtx, async () => {
    const { network: networkName, contract, tokenId } = c.req.valid("param");
    const tokenHex = tokenIdToHex(tokenId);
    const legacy = contractKind(contract, networkName) !== null;
    const cacheKey = {
      network: networkName,
      contract,
      tokenHex,
      version: PNG_CACHE_VERSION,
    };
    const hit = legacy ? await getGenerated(c.env, cacheKey) : null;
    if (hit) {
      return respond(
        hit.bytes,
        hit.contentType,
        tagsFor(networkName, contract, tokenHex, hit.name),
      );
    }

    const rasterizerPromise = import("../services/rasterize");
    const result = await renderSvgFromParams(c, networkName, contract, tokenId);
    if (result.kind === "response") return result.response;

    const { rasterizeNameImageSvg } = await rasterizerPromise;
    const png = await rasterizeNameImageSvg(result.svg);
    const bytes = uint8Bytes(png);
    if (legacy) c.executionCtx.waitUntil(
      putGenerated(c.env, cacheKey, bytes, PNG_CONTENT_TYPE, result.name),
    );
    return respond(
      bytes,
      PNG_CONTENT_TYPE,
      tagsFor(networkName, contract, tokenHex, result.name),
      legacy ? MAX_AGE : CACHE_API_MAX_AGE,
    );
  }) as never;
});
