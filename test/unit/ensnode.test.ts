import { afterEach, describe, expect, it, vi } from "vitest";
import { namehash } from "viem";
import type { Env } from "../../src/env";
import { ETH_REGISTRY_V1 } from "../../src/constants";
import type { NetworkConfig } from "../../src/lib/networks";
import { mainnet } from "viem/chains";
import {
  buildDomainId,
  HOLESKY_UNSUPPORTED_MESSAGE,
  mapOmnigraphDomain,
  queryDomainByLabelhash,
  queryDomainByName,
  queryDomainByNamehash,
} from "../../src/services/ensnode";

const mainnetConfig: NetworkConfig = {
  name: "mainnet",
  chain: mainnet,
  rpcUrl: "https://rpc.example/mainnet",
  ensnodeUrl: "https://ensnode.example",
};

const holeskyConfig: NetworkConfig = {
  name: "holesky",
  chain: { ...mainnet, id: 17000, name: "Holesky" },
  rpcUrl: "https://rpc.example/holesky",
  ensnodeUrl: "",
};

const testEnv = {} as Env;

function omnigraphDomain(name: string, typename: "ENSv1Domain" | "ENSv2Domain" = "ENSv1Domain") {
  const label = name.split(".")[0]!;
  return {
    __typename: typename,
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
      expiry: "9999999999",
      event: { timestamp: "1700000000" },
    },
    events: [{ timestamp: "1600000000" }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildDomainId", () => {
  it("constructs a mainnet ENSv1 DomainId from chain, registry, and namehash", () => {
    const node = "0xee6c452dd0ba59d3b225a0e2d6f0a8f6f6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6" as `0x${string}`;
    expect(buildDomainId(1, ETH_REGISTRY_V1, node)).toBe(
      `1-${ETH_REGISTRY_V1.toLowerCase()}-${node.toLowerCase()}`,
    );
  });
});

describe("mapOmnigraphDomain", () => {
  it("maps ENSv1Domain fields to DomainRecord", () => {
    const mapped = mapOmnigraphDomain(omnigraphDomain("vitalik.eth", "ENSv1Domain"));
    expect(mapped).toMatchObject({
      id: namehash("vitalik.eth"),
      name: "vitalik.eth",
      labelName: "vitalik",
      labelhash: namehash("vitalik"),
      createdAt: "1600000000",
      registration: {
        registrationDate: "1700000000",
        expiryDate: "9999999999",
      },
      owner: { id: "0x0000000000000000000000000000000000000001" },
      protocolVersion: "ENSv1",
    });
  });

  it("maps ENSv2Domain to protocolVersion ENSv2", () => {
    const mapped = mapOmnigraphDomain(omnigraphDomain("v2name.eth", "ENSv2Domain"));
    expect(mapped?.protocolVersion).toBe("ENSv2");
  });

  it("returns null for a null domain", () => {
    expect(mapOmnigraphDomain(null)).toBeNull();
  });
});

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

describe("ENSNode queries", () => {
  it("queryDomainByNamehash posts to the Omnigraph endpoint", async () => {
    const name = "vitalik.eth";
    const hash = namehash(name);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { domain: omnigraphDomain(name) } }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const record = await queryDomainByNamehash(mainnetConfig, testEnv, hash);
    expect(record?.name).toBe(name);
    expect(fetchUrl(fetchMock.mock.calls[0]![0]!)).toBe(
      "https://ensnode.example/api/omnigraph",
    );
  });

  it("queryDomainByName posts to the Omnigraph endpoint", async () => {
    const name = "vitalik.eth";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { domain: omnigraphDomain(name) } }), {
        headers: { "content-type": "application/json" },
      }),
    );

    const record = await queryDomainByName(mainnetConfig, testEnv, name);
    expect(record?.name).toBe(name);
    expect(fetchUrl(fetchMock.mock.calls[0]![0]!)).toBe(
      "https://ensnode.example/api/omnigraph",
    );
  });

  it("queryDomainByLabelhash posts to the subgraph-compat endpoint", async () => {
    const name = "vitalik.eth";
    const label = "vitalik";
    const labelHash = namehash(label);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            domains: [
              {
                id: namehash(name),
                name,
                labelName: label,
                labelhash: labelHash,
                createdAt: "1",
                registration: { registrationDate: "2", expiryDate: "3" },
                owner: { id: "0x0000000000000000000000000000000000000001" },
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    const record = await queryDomainByLabelhash(mainnetConfig, testEnv, labelHash);
    expect(record?.labelName).toBe(label);
    expect(fetchUrl(fetchMock.mock.calls[0]![0]!)).toBe("https://ensnode.example/subgraph");
    expect(record?.protocolVersion).toBe("ENSv1");
  });

  it("fails fast on holesky with a descriptive error", async () => {
    await expect(
      queryDomainByName(holeskyConfig, testEnv, "test.eth"),
    ).rejects.toMatchObject({
      status: 503,
      message: HOLESKY_UNSUPPORTED_MESSAGE,
      code: "holesky_unsupported",
    });
  });
});
