import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "viem";
import type { Env } from "../../src/env";
import { expandIdTemplate, extractImageUri, resolveNftAvatar } from "../../src/services/nftAvatar";
import { classifyUri } from "../../src/services/avatarResolver";

vi.mock("viem", async (importOriginal) => {
	const actual = await importOriginal<typeof import("viem")>();
	return {
		...actual,
		createPublicClient: vi.fn(),
		http: vi.fn(() => ({ type: "mock-http" })),
	};
});

const testEnv = {
	ETH_RPC_URL: "https://rpc.example/mainnet",
	SEPOLIA_RPC_URL: "https://rpc.example/sepolia",
	HOLESKY_RPC_URL: "https://rpc.example/holesky",
	IPFS_GATEWAYS: "https://gateway.example",
	OPENSEA_API_KEY: "opensea-key",
} as Env;

function mockReadContract() {
	const readContract = vi.fn();
	vi.mocked(createPublicClient).mockReturnValue({ readContract } as never);
	return readContract;
}

function dataJson(value: unknown): string {
	return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;
}

beforeEach(() => {
	vi.mocked(createPublicClient).mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("expandIdTemplate", () => {
	it("replaces {id} with 64-char zero-padded lowercase hex", () => {
		expect(expandIdTemplate("https://api.example.com/{id}.json", "1")).toBe(
			"https://api.example.com/0000000000000000000000000000000000000000000000000000000000000001.json",
		);
		expect(expandIdTemplate("ipfs://CID/{id}", "1719")).toBe(
			"ipfs://CID/00000000000000000000000000000000000000000000000000000000000006b7",
		);
	});

	it("handles large token IDs (uint256)", () => {
		const big = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256-1
		expect(expandIdTemplate("ipfs://x/{id}", big)).toBe(
			"ipfs://x/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		);
	});

	it("is a no-op when template lacks {id}", () => {
		expect(expandIdTemplate("https://api.example.com/token/123", "1")).toBe(
			"https://api.example.com/token/123",
		);
	});

	it("replaces every occurrence of {id}", () => {
		expect(expandIdTemplate("{id}/{id}", "5")).toBe(
			"0000000000000000000000000000000000000000000000000000000000000005/0000000000000000000000000000000000000000000000000000000000000005",
		);
	});
});

describe("extractImageUri", () => {
	it("returns the `image` field when present", () => {
		expect(extractImageUri({ image: "ipfs://abc" })).toBe("ipfs://abc");
	});

	it("falls back to `image_url` (OpenSea variant)", () => {
		expect(extractImageUri({ image_url: "https://example.com/x.png" })).toBe(
			"https://example.com/x.png",
		);
	});

	it("wraps `image_data` SVG markup in a base64 data URI", () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
		const out = extractImageUri({ image_data: svg });
		expect(out).toMatch(/^data:image\/svg\+xml;base64,/);
		// Decode and verify roundtrip
		const base64 = out!.replace(/^data:image\/svg\+xml;base64,/, "");
		expect(atob(base64)).toBe(svg);
	});

	it("prefers `image` over `image_url` and `image_data`", () => {
		expect(
			extractImageUri({
				image: "ipfs://primary",
				image_url: "https://secondary",
				image_data: "<svg/>",
			}),
		).toBe("ipfs://primary");
	});

	it("returns null for missing/empty/non-object inputs", () => {
		expect(extractImageUri(null)).toBeNull();
		expect(extractImageUri(undefined)).toBeNull();
		expect(extractImageUri("not-an-object")).toBeNull();
		expect(extractImageUri({})).toBeNull();
		expect(extractImageUri({ image: "" })).toBeNull();
	});
});

describe("classifyUri ar:// handling", () => {
	it("rewrites ar://TXID to https://arweave.net/TXID", () => {
		const out = classifyUri("ar://abcDEF123");
		expect(out).toEqual({ kind: "https", url: "https://arweave.net/abcDEF123" });
	});

	it("preserves the path component after the txid", () => {
		const out = classifyUri("ar://abc/path/to/file.json");
		expect(out).toEqual({ kind: "https", url: "https://arweave.net/abc/path/to/file.json" });
	});

	it("rejects empty ar:// URIs", () => {
		expect(() => classifyUri("ar://")).toThrow();
	});
});

describe("classifyUri eip155 namespace", () => {
	it("preserves the erc721 / erc1155 namespace in the parsed result", () => {
		const erc721 = classifyUri(
			"eip155:1/erc721:0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6/1719",
		);
		expect(erc721).toMatchObject({
			kind: "eip155",
			chainId: 1,
			namespace: "erc721",
			contract: "0xb7F7F6C52F2e2fdb1963Eab30438024864c313F6",
			tokenId: "1719",
		});

		const erc1155 = classifyUri(
			"eip155:8453/erc1155:0xD4307E0acD12CF46fD6cf93BC264f5D5D1598792/1",
		);
		expect(erc1155).toMatchObject({
			kind: "eip155",
			chainId: 8453,
			namespace: "erc1155",
			tokenId: "1",
		});
	});
});

describe("resolveNftAvatar", () => {
	it("verifies ERC-721 ownership before returning the metadata image URI", async () => {
		const readContract = mockReadContract();
		readContract
			.mockResolvedValueOnce(dataJson({ image: "https://images.example/erc721.png" }))
			.mockResolvedValueOnce("0x0000000000000000000000000000000000000001");

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			"0x0000000000000000000000000000000000000001",
		);

		expect(result.imageUri).toBe("https://images.example/erc721.png");
		expect(readContract.mock.calls.map(([call]) => call.functionName)).toEqual([
			"tokenURI",
			"ownerOf",
		]);
	});

	it("verifies ERC-1155 ownership before returning the metadata image URI", async () => {
		const readContract = mockReadContract();
		readContract
			.mockResolvedValueOnce(dataJson({ image_url: "https://images.example/erc1155.png" }))
			.mockResolvedValueOnce(1n);

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc1155",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			"0x0000000000000000000000000000000000000001",
		);

		expect(result.imageUri).toBe("https://images.example/erc1155.png");
		expect(readContract.mock.calls.map(([call]) => call.functionName)).toEqual([
			"uri",
			"balanceOf",
		]);
	});

	it("sends the configured OpenSea API key only to OpenSea metadata hosts", async () => {
		const readContract = mockReadContract();
		readContract.mockResolvedValueOnce("https://api.opensea.io/api/v2/metadata/test");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "https://images.example/opensea.png" })),
		);

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(result.imageUri).toBe("https://images.example/opensea.png");
		expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
			"X-API-KEY": "opensea-key",
		});

		readContract.mockReset();
		fetchMock.mockClear();
		readContract.mockResolvedValueOnce("https://testnets-api.opensea.io/api/v2/metadata/test");
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "https://images.example/testnets-opensea.png" })),
		);

		await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
			"X-API-KEY": "opensea-key",
		});

		readContract.mockReset();
		fetchMock.mockClear();
		readContract.mockResolvedValueOnce("https://metadata.example/token.json");
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "https://images.example/plain.png" })),
		);

		await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
	});

	it("resolves IPNS metadata through the configured gateway", async () => {
		const readContract = mockReadContract();
		readContract.mockResolvedValueOnce("ipns://metadata.example/token.json");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "ipns://images.example/avatar.png" })),
		);

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://gateway.example/ipns/metadata.example/token.json",
		);
		expect(result.imageUri).toBe("ipns://images.example/avatar.png");
	});

	it("resolves IPFS metadata with a case-insensitive scheme prefix", async () => {
		const readContract = mockReadContract();
		readContract.mockResolvedValueOnce(
			"IPFS://QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A/token.json",
		);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "ipfs://imageCid/avatar.png" })),
		);

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://gateway.example/ipfs/QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A/token.json",
		);
		expect(result.imageUri).toBe("ipfs://imageCid/avatar.png");
	});

	it("resolves Arweave metadata through arweave.net", async () => {
		const readContract = mockReadContract();
		readContract.mockResolvedValueOnce("ar://abcDEF123/token.json");
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(JSON.stringify({ image: "ar://imageTx/avatar.png" })),
		);

		const result = await resolveNftAvatar(
			testEnv,
			{
				chainId: 1,
				namespace: "erc721",
				contract: "0x0000000000000000000000000000000000000002",
				tokenId: "123",
			},
			null,
		);

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://arweave.net/abcDEF123/token.json",
		);
		expect(result.imageUri).toBe("ar://imageTx/avatar.png");
	});
});
