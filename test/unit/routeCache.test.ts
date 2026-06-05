import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { namehash } from "viem";
import type { Env } from "../../src/env";
import { CACHE_API_MAX_AGE, NAME_WRAPPER_V2 } from "../../src/constants";
import { cacheTagHeader, nameTag, tokenTag } from "../../src/lib/cacheTags";
import { avatarRoutes } from "../../src/routes/images";
import { metadataRoutes } from "../../src/routes/metadata";
import { nameImageRoutes } from "../../src/routes/nameImage";
import { queryNFTRoutes } from "../../src/routes/queryNFT";
import { tokenIdToHex } from "../../src/services/domain";
import { putGenerated } from "../../src/storage/r2Cache";

const testEnv = {
  ...(env as unknown as Env),
  ETH_RPC_URL: "https://rpc.example/mainnet",
  SEPOLIA_RPC_URL: "https://rpc.example/sepolia",
  HOLESKY_RPC_URL: "https://rpc.example/holesky",
  ENSNODE_URL_MAINNET: "https://ensnode.example",
  ENSNODE_URL_SEPOLIA: "https://ensnode.example/sepolia",
  ENSNODE_URL_HOLESKY: "",
} as Env;

const CACHE_CONTROL = `public, max-age=${CACHE_API_MAX_AGE}`;

function omnigraphDomain(name: string) {
  const label = name.split(".")[0]!;
  return {
    __typename: "ENSv1Domain",
    canonical: {
      node: namehash(name),
      name: { interpreted: name },
    },
    label: {
      interpreted: label,
      hash: namehash(label),
    },
    owner: { address: "0x0000000000000000000000000000000000000001" },
    registration: {
      expiry: "3",
      event: { timestamp: "2" },
    },
    events: [{ timestamp: "1" }],
  };
}

function mockEnsnodeDomain(name: string) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();

    if (url.includes("/api/omnigraph")) {
      return new Response(JSON.stringify({ data: { domain: omnigraphDomain(name) } }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("/subgraph")) {
      const label = name.split(".")[0]!;
      return new Response(
        JSON.stringify({
          data: {
            domains: [
              {
                id: namehash(name),
                name,
                labelName: label,
                labelhash: namehash(label),
                createdAt: "1",
                registration: { registrationDate: "2", expiryDate: "3" },
                owner: { id: "0x0000000000000000000000000000000000000001" },
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route cache headers", () => {
  it("caches queryNFT responses by request and emits name/token cache tags", async () => {
    const name = "route-cache-query.eth";
    const hash = namehash(name);
    const request = new Request(
      `https://example.com/queryNFT?name=${name}&network=mainnet`,
    );
    await caches.default.delete(request);
    const fetchMock = mockEnsnodeDomain(name);

    const ctx = createExecutionContext();
    const response = await queryNFTRoutes.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("cache-tag")).toBe(
      cacheTagHeader(nameTag("mainnet", name), tokenTag("mainnet", NAME_WRAPPER_V2, hash)),
    );
    expect(((await response.json()) as { name: string }).name).toBe(name);

    fetchMock.mockClear();
    const cachedCtx = createExecutionContext();
    const cached = await queryNFTRoutes.fetch(request, testEnv, cachedCtx);
    await waitOnExecutionContext(cachedCtx);

    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ name, namehash: hash });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches metadata responses with token and name tags", async () => {
    const name = "route-cache-metadata.eth";
    const hash = namehash(name);
    const tokenId = BigInt(hash).toString();
    const request = new Request(
      `https://example.com/mainnet/${NAME_WRAPPER_V2}/${tokenId}`,
    );
    await caches.default.delete(request);
    mockEnsnodeDomain(name);

    const ctx = createExecutionContext();
    const response = await metadataRoutes.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("cache-tag")).toBe(
      cacheTagHeader(tokenTag("mainnet", NAME_WRAPPER_V2, hash), nameTag("mainnet", name)),
    );
    expect(await response.json()).toMatchObject({
      name,
      token_hash: hash,
    });
  });

  it("caches avatar meta responses with name tags", async () => {
    const name = "route-cache-meta.eth";
    const request = new Request(
      `https://example.com/mainnet/avatar/${encodeURIComponent(name)}/meta`,
    );
    await caches.default.delete(request);
    await testEnv.RESOLVER_CACHE.put(
      `avatar:mainnet:${name}`,
      JSON.stringify({ uri: "https://images.example/avatar.png", fetchedAt: Date.now() }),
    );

    const ctx = createExecutionContext();
    const response = await avatarRoutes.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("cache-tag")).toBe(cacheTagHeader(nameTag("mainnet", name)));
    expect(await response.json()).toEqual({
      name,
      network: "mainnet",
      uri: "https://images.example/avatar.png",
      kind: "avatar",
    });

    await testEnv.RESOLVER_CACHE.delete(`avatar:mainnet:${name}`);
    const cachedCtx = createExecutionContext();
    const cached = await avatarRoutes.fetch(request, testEnv, cachedCtx);
    await waitOnExecutionContext(cachedCtx);
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ uri: "https://images.example/avatar.png" });
  });

  it("caches generated name image responses ahead of R2 hits", async () => {
    const name = "route-cache-image.eth";
    const tokenHex = tokenIdToHex("42");
    const request = new Request(
      `https://example.com/mainnet/${NAME_WRAPPER_V2}/42/image`,
    );
    await caches.default.delete(request);
    await putGenerated(
      testEnv,
      {
        network: "mainnet",
        contract: NAME_WRAPPER_V2,
        tokenHex,
        version: "svg-v5",
      },
      toArrayBuffer(new TextEncoder().encode("<svg/>")),
      "image/svg+xml",
      name,
    );

    const ctx = createExecutionContext();
    const response = await nameImageRoutes.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
    expect(response.headers.get("cache-tag")).toBe(
      cacheTagHeader(tokenTag("mainnet", NAME_WRAPPER_V2, tokenHex), nameTag("mainnet", name)),
    );
    expect(await response.text()).toBe("<svg/>");

    await testEnv.IPFS_CACHE.delete(
      `generated/mainnet/${NAME_WRAPPER_V2.toLowerCase()}/${tokenHex}/svg-v5.bin`,
    );
    const cachedCtx = createExecutionContext();
    const cached = await nameImageRoutes.fetch(request, testEnv, cachedCtx);
    await waitOnExecutionContext(cachedCtx);
    expect(cached.status).toBe(200);
    expect(await cached.text()).toBe("<svg/>");
  });
});
