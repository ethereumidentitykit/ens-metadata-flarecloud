import { GraphQLClient, gql } from "graphql-request";
import type { NetworkConfig } from "../lib/networks";
import type { Env } from "../env";
import { ETH_NAMEHASH, ETH_REGISTRY_V1, NAME_WRAPPER_V2 } from "../constants";
import { HttpError } from "../lib/errors";

export type ProtocolVersion = "ENSv1" | "ENSv2";

export type DomainRecord = {
  id: string;
  name: string | null;
  labelName: string | null;
  labelhash: string | null;
  createdAt: string;
  registration: {
    registrationDate: string;
    expiryDate: string;
  } | null;
  owner: { id: string } | null;
  protocolVersion?: ProtocolVersion;
  nftContract?: `0x${string}`;
  nftTokenId?: string;
};

type OmnigraphDomain = {
  __typename: "ENSv1Domain" | "ENSv2Domain";
  id?: string;
  canonical: {
    node: string;
    name: { interpreted: string } | null;
  };
  label: {
    interpreted: string;
    hash: string;
  } | null;
  owner: { address: string } | null;
  registration: {
    expiry: string;
    event: { timestamp: string } | null;
  } | null;
  events?: Array<{ timestamp: string }> | null;
  tokenId?: string;
  registry?: { contract: { address: string } };
};

const OMNIGRAPH_DOMAIN_FIELDS = gql`
  # ENSv1Domain and ENSv2Domain expose identical fields today; both inline
  # fragments must remain in sync if the schema diverges in the future.
  fragment OmnigraphDomainFields on Domain {
    __typename
    id
    ... on ENSv1Domain {
      canonical {
        node
        name {
          interpreted
        }
      }
      label {
        interpreted
        hash
      }
      owner {
        address
      }
      registration {
        expiry
        event {
          timestamp
        }
      }
      events(first: 1, orderBy: timestamp, orderDirection: asc) {
        timestamp
      }
    }
    ... on ENSv2Domain {
      tokenId
      registry {
        contract {
          address
        }
      }
      canonical {
        node
        name {
          interpreted
        }
      }
      label {
        interpreted
        hash
      }
      owner {
        address
      }
      registration {
        expiry
        event {
          timestamp
        }
      }
      events(first: 1, orderBy: timestamp, orderDirection: asc) {
        timestamp
      }
    }
  }
`;

const OMNIGRAPH_DOMAIN_BY_ID = gql`
  ${OMNIGRAPH_DOMAIN_FIELDS}
  query DomainById($id: String!) {
    domain(by: { id: $id }) {
      ...OmnigraphDomainFields
    }
  }
`;

const OMNIGRAPH_DOMAIN_BY_NAME = gql`
  ${OMNIGRAPH_DOMAIN_FIELDS}
  query DomainByName($name: String!) {
    domain(by: { name: $name }) {
      ...OmnigraphDomainFields
    }
  }
`;

const DOMAIN_BY_LABELHASH = gql`
  query DomainByLabelhash($labelhash: String!) {
    domains(where: { labelhash: $labelhash, parent: "${ETH_NAMEHASH}" }, first: 1) {
      id
      name
      labelName
      labelhash
      createdAt
      registration {
        registrationDate
        expiryDate
      }
      owner {
        id
      }
    }
  }
`;

const HOLESKY_UNSUPPORTED_MESSAGE =
  "Holesky is not supported: ENSNode does not yet provide a hosted instance. See https://ensnode.io/docs/hosted-instances";

export function buildDomainId(
  chainId: number,
  registry: `0x${string}`,
  node: `0x${string}`,
): string {
  return `${chainId}-${registry.toLowerCase()}-${node.toLowerCase()}`;
}

export function resolveNftIdentifiers(
  record: DomainRecord,
  nameHash: `0x${string}`,
): { contract: `0x${string}`; tokenId: string } {
  if (record.protocolVersion === "ENSv2" && record.nftContract && record.nftTokenId) {
    return { contract: record.nftContract, tokenId: record.nftTokenId };
  }
  return { contract: NAME_WRAPPER_V2, tokenId: BigInt(nameHash).toString() };
}

export function mapOmnigraphDomain(domain: OmnigraphDomain | null): DomainRecord | null {
  if (!domain) return null;

  const protocolVersion: ProtocolVersion =
    domain.__typename === "ENSv2Domain" ? "ENSv2" : "ENSv1";
  const createdAt =
    domain.events?.[0]?.timestamp ?? domain.registration?.event?.timestamp ?? "0";

  const record: DomainRecord = {
    id: domain.canonical.node,
    name: domain.canonical.name?.interpreted ?? null,
    labelName: domain.label?.interpreted ?? null,
    labelhash: domain.label?.hash ?? null,
    createdAt,
    registration: domain.registration
      ? {
          registrationDate: domain.registration.event?.timestamp ?? "0",
          expiryDate: domain.registration.expiry,
        }
      : null,
    owner: domain.owner?.address ? { id: domain.owner.address } : null,
    protocolVersion,
  };

  if (domain.__typename === "ENSv2Domain" && domain.registry?.contract.address && domain.tokenId) {
    record.nftContract = domain.registry.contract.address as `0x${string}`;
    record.nftTokenId = domain.tokenId;
  }

  return record;
}

function assertEnsnodeAvailable(network: NetworkConfig): void {
  if (!network.ensnodeUrl) {
    throw new HttpError(
      503,
      network.name === "holesky"
        ? HOLESKY_UNSUPPORTED_MESSAGE
        : `ENSNode is not configured for network: ${network.name}`,
      network.name === "holesky" ? "holesky_unsupported" : "ensnode_unconfigured",
    );
  }
}

function omnigraphClient(baseUrl: string): GraphQLClient {
  return new GraphQLClient(`${baseUrl.replace(/\/$/, "")}/api/omnigraph`);
}

function subgraphClient(baseUrl: string): GraphQLClient {
  return new GraphQLClient(`${baseUrl.replace(/\/$/, "")}/subgraph`);
}

async function queryOmnigraphById(
  network: NetworkConfig,
  domainId: string,
): Promise<DomainRecord | null> {
  const client = omnigraphClient(network.ensnodeUrl);
  const data = await client.request<{ domain: OmnigraphDomain | null }>(
    OMNIGRAPH_DOMAIN_BY_ID,
    { id: domainId },
  );
  return mapOmnigraphDomain(data.domain);
}

// _env is reserved for future auth-header injection; not yet used.
export async function queryDomainByLabelhash(
  network: NetworkConfig,
  _env: Env,
  labelhash: `0x${string}`,
): Promise<DomainRecord | null> {
  assertEnsnodeAvailable(network);
  const client = subgraphClient(network.ensnodeUrl);
  const data = await client.request<{ domains: DomainRecord[] }>(DOMAIN_BY_LABELHASH, {
    labelhash,
  });
  const record = data.domains[0] ?? null;
  if (record) {
    return { ...record, protocolVersion: "ENSv1" };
  }
  return null;
}

export async function queryDomainByNamehash(
  network: NetworkConfig,
  _env: Env,
  namehash: `0x${string}`,
): Promise<DomainRecord | null> {
  assertEnsnodeAvailable(network);
  const registries = [ETH_REGISTRY_V1, network.ethRegistryV2].filter(
    (registry): registry is `0x${string}` => registry !== undefined,
  );
  for (const registry of registries) {
    const domainId = buildDomainId(network.chain.id, registry, namehash);
    const record = await queryOmnigraphById(network, domainId);
    if (record) return record;
  }
  return null;
}

export async function queryDomainByName(
  network: NetworkConfig,
  _env: Env,
  name: string,
): Promise<DomainRecord | null> {
  assertEnsnodeAvailable(network);
  const client = omnigraphClient(network.ensnodeUrl);
  const data = await client.request<{ domain: OmnigraphDomain | null }>(
    OMNIGRAPH_DOMAIN_BY_NAME,
    { name },
  );
  return mapOmnigraphDomain(data.domain);
}

export { HOLESKY_UNSUPPORTED_MESSAGE };
