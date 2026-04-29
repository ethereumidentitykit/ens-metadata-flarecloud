import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "http://example.com";

describe("app", () => {
  it("serves Scalar docs at /", async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.text();
    expect(body.toLowerCase()).toContain("<!doctype html");
    expect(body).toContain("ENS Metadata - Flarecloud");
    expect(body).toContain("https://cdn.jsdelivr.net/npm/@scalar/api-reference");
  });

  it("serves Scalar docs at /docs", async () => {
    const res = await SELF.fetch(`${BASE}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.text();
    expect(body.toLowerCase()).toContain("<!doctype html");
    expect(body).toContain("ENS Metadata - Flarecloud");
  });

  it("serves a cacheable empty favicon response", async () => {
    const res = await SELF.fetch(`${BASE}/favicon.ico`);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("serves a valid OpenAPI spec", async () => {
    const res = await SELF.fetch(`${BASE}/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const spec = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/queryNFT"]).toBeDefined();
    expect(spec.paths["/{network}/avatar/{name}"]).toBeDefined();
    expect(spec.paths["/{network}/header/{name}"]).toBeDefined();
    expect(spec.paths["/{network}/{contract}/{tokenId}"]).toBeDefined();
  });

  it("serves llms.txt generated from the OpenAPI spec", async () => {
    const res = await SELF.fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("# ENS Metadata - Flarecloud");
    expect(body).toContain("## GET /queryNFT");
    expect(body).toContain("Look up an ENS name's NFT identifiers");
    expect(body).toContain("## GET /{network}/avatar/{name}");
    expect(body).toContain("Get resolved avatar image bytes for an ENS name");
  });

  it("404s unknown paths", async () => {
    const res = await SELF.fetch(`${BASE}/definitely-not-a-route`);
    expect(res.status).toBe(404);
  });
});

describe("validation", () => {
  it("rejects queryNFT without a name", async () => {
    const res = await SELF.fetch(`${BASE}/queryNFT`);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown network", async () => {
    const res = await SELF.fetch(`${BASE}/fakenet/avatar/vitalik.eth`);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed contract address", async () => {
    const res = await SELF.fetch(`${BASE}/mainnet/notanaddress/1`);
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported contract", async () => {
    const res = await SELF.fetch(
      `${BASE}/mainnet/0x0000000000000000000000000000000000000001/1`,
    );
    expect(res.status).toBe(400);
  });
});
