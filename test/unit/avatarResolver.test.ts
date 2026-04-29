import { describe, expect, it } from "vitest";
import {
  arweaveGatewayUrl,
  classifyUri,
  decodeDataUri,
} from "../../src/services/avatarResolver";

describe("classifyUri", () => {
  it("classifies data URIs", () => {
    expect(classifyUri("data:image/png;base64,AAAA").kind).toBe("data");
  });

  it("classifies ipfs URIs", () => {
    expect(classifyUri("ipfs://QmTest").kind).toBe("ipfs");
  });

  it("handles IPFS URI schemes case-insensitively", () => {
    expect(classifyUri("IPFS://QmTest")).toEqual({
      kind: "ipfs",
      uri: "IPFS://QmTest",
    });
  });

  it("classifies ipns URIs", () => {
    expect(classifyUri("ipns://vitalik.eth/avatar.png")).toEqual({
      kind: "ipns",
      uri: "ipns://vitalik.eth/avatar.png",
    });
  });

  it("classifies https URIs", () => {
    const r = classifyUri("https://example.com/x.png");
    expect(r.kind).toBe("https");
    if (r.kind === "https") expect(r.url).toBe("https://example.com/x.png");
  });

  it("classifies eip155 URIs", () => {
    const r = classifyUri(
      "eip155:1/erc721:0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85/123",
    );
    expect(r.kind).toBe("eip155");
    if (r.kind === "eip155") {
      expect(r.chainId).toBe(1);
      expect(r.tokenId).toBe("123");
    }
  });

  it("rewrites arweave URIs to the public gateway", () => {
    expect(classifyUri("ar://abcDEF123/path/to/file.png")).toEqual({
      kind: "https",
      url: "https://arweave.net/abcDEF123/path/to/file.png",
    });
  });

  it("handles arweave URI schemes case-insensitively", () => {
    expect(classifyUri("AR://abcDEF123")).toEqual({
      kind: "https",
      url: "https://arweave.net/abcDEF123",
    });
  });

  it("normalizes did:nft URIs before classifying eip155 NFT references", () => {
    const r = classifyUri(
      "did:nft:eip155:1_erc1155:0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85_123",
    );
    expect(r).toMatchObject({
      kind: "eip155",
      chainId: 1,
      namespace: "erc1155",
      contract: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
      tokenId: "123",
    });
  });

  it("throws on unknown schemes", () => {
    expect(() => classifyUri("ftp://nope")).toThrow();
    expect(() => classifyUri("garbage")).toThrow();
  });
});

describe("arweaveGatewayUrl", () => {
  it("maps ar:// transaction IDs and paths to arweave.net", () => {
    expect(arweaveGatewayUrl("ar://abcDEF123")).toBe(
      "https://arweave.net/abcDEF123",
    );
    expect(arweaveGatewayUrl("ar://abcDEF123/path/to/file.json")).toBe(
      "https://arweave.net/abcDEF123/path/to/file.json",
    );
  });

  it("returns null for malformed or unrelated URIs", () => {
    expect(arweaveGatewayUrl("ar://")).toBeNull();
    expect(arweaveGatewayUrl("https://arweave.net/abcDEF123")).toBeNull();
  });
});

describe("decodeDataUri", () => {
  it("decodes base64 data URIs", () => {
    const { bytes, mime } = decodeDataUri("data:image/png;base64,SGVsbG8=");
    expect(mime).toBe("image/png");
    expect(new TextDecoder().decode(bytes)).toBe("Hello");
  });

  it("decodes url-encoded data URIs", () => {
    const { bytes, mime } = decodeDataUri("data:text/plain,Hello%20World");
    expect(mime).toBe("text/plain");
    expect(new TextDecoder().decode(bytes)).toBe("Hello World");
  });

  it("throws on malformed data URIs", () => {
    expect(() => decodeDataUri("not a data uri")).toThrow();
  });
});
