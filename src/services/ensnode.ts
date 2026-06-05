import { GraphQLClient, gql } from "graphql-request";
import type { NetworkConfig } from "../lib/networks";
import type { Env } from "../env";
import { ETH_NAMEHASH, ETH_REGISTRY_V1 } from "../constants";
import { HttpError } from "../lib/errors";

export type ProtocolVersion = "ENSv1" | "ENSv2";

export type DomainRecord = {
  id: string;
  name: string | null;
  labelName: string | null;
  labelhash: string;
  createdAt: string;
  registration: {
    registrationDate: string;
    expiryDate: string;
  } | null;
  owner: { id: string } | null;
  protocolVersion?: ProtocolVersion;
};

type OmnigraphDomain = {
  __typename: "ENSv1Domain" | "ENSv2Domain";
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
};

const OMNIGRAPH_DOMAIN_FIELDS = gql`
  fragment OmnigraphDomainFields on Domain {
    __typename
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

export function mapOmnigraphDomain(domain: OmnigraphDomain | null): DomainRecord | null {
  if (!domain) return null;

  const protocolVersion: ProtocolVersion =
    domain.__typename === "ENSv2Domain" ? "ENSv2" : "ENSv1";
  const createdAt =
    domain.events?.[0]?.timestamp ?? domain.registration?.event?.timestamp ?? "0";

  return {
    id: domain.canonical.node,
    name: domain.canonical.name?.interpreted ?? null,
    labelName: domain.label?.interpreted ?? null,
    labelhash: domain.label?.hash ?? "",
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
}

function assertEnsnodeAvailable(network: NetworkConfig): void {
  if (network.name === "holesky") {
    throw new HttpError(503, HOLESKY_UNSUPPORTED_MESSAGE, "holesky_unsupported");
  }
  if (!network.ensnodeUrl) {
    throw new HttpError(
      503,
      `ENSNode is not configured for network: ${network.name}`,
      "ensnode_unconfigured",
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
  const domainId = buildDomainId(network.chain.id, ETH_REGISTRY_V1, namehash);
  return queryOmnigraphById(network, domainId);
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
