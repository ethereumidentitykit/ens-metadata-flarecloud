import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env";
import { fetchIpfs, fetchIpns, parseIpfs, parseIpns } from "../../src/services/ipfs";

const VALID_CID = "QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A";
const testEnv = {
  IPFS_GATEWAYS: "https://gateway.example",
} as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseIpfs", () => {
  it("parses a v0 CID with ipfs:// prefix", () => {
    const r = parseIpfs(`ipfs://${VALID_CID}`);
    expect(r).toEqual({
      cid: VALID_CID,
      path: "",
    });
  });

  it("parses IPFS prefixes case-insensitively", () => {
    const r = parseIpfs(`IPFS://${VALID_CID}/avatar.png`);
    expect(r).toEqual({
      cid: VALID_CID,
      path: "/avatar.png",
    });
  });

  it("parses gateway-style ipfs://ipfs/ prefixes", () => {
    const r = parseIpfs(`ipfs://ipfs/${VALID_CID}/avatar.png`);
    expect(r).toEqual({
      cid: VALID_CID,
      path: "/avatar.png",
    });
  });

  it("parses a v0 CID with subpath", () => {
    const r = parseIpfs(
      `ipfs://${VALID_CID}/avatar.png`,
    );
    expect(r?.cid).toBe(VALID_CID);
    expect(r?.path).toBe("/avatar.png");
  });

  it("parses a bare CID", () => {
    const r = parseIpfs(VALID_CID);
    expect(r?.cid).toBe(VALID_CID);
  });

  it("parses a v1 CID", () => {
    const r = parseIpfs("ipfs://bafybeicg2rbjd6ts7s5jxk4a6wn7l3t3vg7d3pxkpnq6xwefj6o76hmwsu");
    expect(r?.cid.startsWith("bafy")).toBe(true);
  });

  it("rejects non-ipfs URIs", () => {
    expect(parseIpfs("https://example.com/foo")).toBeNull();
    expect(parseIpfs("data:image/png;base64,AAAA")).toBeNull();
    expect(parseIpfs("")).toBeNull();
  });
});

describe("parseIpns", () => {
  it("parses ipns:// names with subpaths", () => {
    expect(parseIpns("ipns://metadata.example/token.json")).toEqual({
      target: "metadata.example",
      path: "/token.json",
    });
  });

  it("parses ipns/ names without subpaths", () => {
    expect(parseIpns("ipns/metadata.example")).toEqual({
      target: "metadata.example",
      path: "",
    });
  });

  it("rejects non-IPNS URIs", () => {
    expect(parseIpns(`ipfs://${VALID_CID}`)).toBeNull();
    expect(parseIpns("https://example.com/foo")).toBeNull();
    expect(parseIpns("")).toBeNull();
  });
});

describe("gateway fetch cache policy", () => {
  it("keeps a one-hour forced edge cache for immutable IPFS paths", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );

    await fetchIpfs(testEnv, { cid: VALID_CID, path: "/avatar.png" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://gateway.example/ipfs/${VALID_CID}/avatar.png`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
  });

  it("does not force edge caching for mutable IPNS paths", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );

    await fetchIpns(testEnv, { target: "metadata.example", path: "/token.json" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gateway.example/ipns/metadata.example/token.json",
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("cf");
  });
});
