# ens-metadata-flarecloud

ENS metadata service running on Cloudflare Workers.

A subset of [`ensdomains/ens-metadata-service`](https://github.com/ensdomains/ens-metadata-service) ported to Workers. Serves NFT metadata JSON, resolved avatar/header images, server-rendered ENS name cards (SVG + PNG), and an NFT lookup endpoint. Name cards are rendered with `resvg-wasm` (no `node-canvas`); the upstream Puppeteer-based `/preview` and `/rasterize` endpoints are not included.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ethereumidentitykit/ens-metadata-flarecloud)

## Compatibility

| Endpoint                                        | Upstream |          Flarecloud          |
| ----------------------------------------------- | :------: | :--------------------------: |
| `GET /`                                         |    ✓     |       ✓ (Scalar docs)        |
| `GET /docs`                                     |    ✓     |       ✓ (Scalar docs)        |
| `GET /favicon.ico`                              |    ✓     |          ✓ (204)            |
| `GET /{network}/{contract}/{tokenId}`           |    ✓     |              ✓               |
| `GET /{network}/{contract}/{tokenId}/image`     |    ✓     |  ✓ (SVG card via resvg-wasm) |
| `GET /{network}/{contract}/{tokenId}/image/png` |    ✗     |   ✓ (PNG card via resvg-wasm)|
| `GET /{network}/{contract}/{tokenId}/rasterize` |    ✓     |     ✗ (needs Puppeteer)      |
| `GET /{network}/avatar/{name}`                  |    ✓     |              ✓               |
| `GET /{network}/avatar/{name}/meta`             |    ✓     |              ✓               |
| `GET /{network}/header/{name}`                  |    ✓     |              ✓               |
| `GET /{network}/header/{name}/meta`             |    ✓     |              ✓               |
| `GET /queryNFT`                                 |    ✓     |              ✓               |
| `GET /preview/{name}`                           |    ✓     |              ✗               |
| `POST /cache/invalidate`                        |    ✗     |     ✓ (indexer-only)         |
| `POST /cache/preload`                           |    ✗     |     ✓ (indexer-only)         |
| `GET /openapi.json`                             |    ✗     |              ✓               |
| `GET /llms.txt`                                 |    ✗     |              ✓               |

`network` is one of `mainnet`, `sepolia`, `holesky`. ENSv1 supports BaseRegistrar and NameWrapper tokens. ENSv2 registry tokens are supported through a network-specific Grails token lookup API; see below. The NameWrapper is part of ENSv1, despite the historical metadata `version: 2` format.

## ENSv2 support and backend coverage

Checked 2026-10-27: this service uses the supplied Grails `/names/by-token/{contract}/{tokenId}` endpoint for ENSv2 identity. `wrangler.toml` configures `https://grails-v2-prep.up.railway.app/api/v1` **only for Sepolia**. The endpoint has no chain ID parameter or chain field in its response: its network is determined by the backend deployment. Mainnet V2 requires a separately configured, correctly indexed `GRAILS_API_URL_MAINNET`; the Sepolia URL must not be reused there.

The legacy ENS subgraph does not index ENSv2. ENSNode offers a different [Omnigraph API](https://ensnode.io/docs/integrate/ens-subgraph/key-limitations/) for V1 and V2; its subgraph-compatible API is still V1-only. Its [hosted instances](https://ensnode.io/docs/hosted-instances/) documentation listed an experimental V2 Sepolia instance whose hostname failed TLS verification during the 2026-10-26 check. Do not replace `SUBGRAPH_URL_*` with an Omnigraph URL: the schemas differ.

| Grails endpoint | Use |
| --- | --- |
| `/names/by-token/{contract}/{tokenId}` | Token-to-name lookup: `ens_version`, `token.{contract,token_id,is_current}`, `current_token`, owner and ISO dates. Used for V2 metadata. |
| `/names/by-token/{contract}/{tokenId}?include=avatar` | Also returns `avatar` as a resolved image URI or `null`. Used for V2 SVG/PNG cards. |
| `/names/{name}` | Name-to-token lookup: `version`, `token_contract`, `token_id`, owner and ISO dates. Used by `/queryNFT`. |
| `/names/{name}/metadata` | Resolver profile records; not an NFT identity lookup. |

Standard NFT URLs now work without a name hint:

```text
/sepolia/{registry}/{tokenId}
/sepolia/{registry}/{tokenId}/image
/sepolia/{registry}/{tokenId}/image/png
```

Start with `GET /queryNFT?network=sepolia&name=hmnd-demo.eth` and follow `metadata_url`, or request a known registry/token pair directly. Decimal and hex token IDs are accepted and sent to Grails in canonical decimal form. Existing `?name=` links remain supported as an additional constraint.

The adapter validates both the echoed requested tuple and the indexed current tuple. A non-current token returns 404 locally rather than receiving the replacement token's metadata. Grails can map historical or unissued V2 versions to the same name, so `is_current: false` does not by itself prove that a requested token was retired. An explicit upstream 410 is preserved. Other upstream failures become 502, or 503 for rate limiting/unavailability; they do not fall back to potentially stale V1 identity. `/by-token` has no creation date, so metadata omits that trait rather than inventing one.

The reviewed Grails [token lookup](https://github.com/grailsmarket/backend/blob/v2-prep/services/shared/src/utils/name-by-token.ts) accepts the configured BaseRegistrar, NameWrapper and **ETHRegistry only**. Dynamic V2 subname registries remain unsupported by that backend. The adapter accepts full names and arbitrary V2 registry addresses once the backend supports them. The response also lacks indexed-block/coverage/freshness information, so this service cannot distinguish every indexing gap from a genuine 404 or verify index lag. These are indexed results, not transaction-time ownership checks.

On API-configured networks, `/queryNFT` checks Grails before the legacy subgraph to detect V2 migrations. Legacy metadata/image routes keep the subgraph and fall back to the new by-token endpoint on a miss/failure, without requiring a name. Legacy fallback verifies the namehash/labelhash and current identity. `/queryNFT` distinguishes wrapped and unwrapped V1 names and reports the token owner.

`ens_version` identifies protocol 1 or 2. The legacy metadata `version` field stays 1 for BaseRegistrar and 2 for ERC1155 metadata, including NameWrapper. For V2, `token_hash` is the actual 32-byte token ID, not the namehash.

For name cards, a returned avatar URL goes through the existing image fetch/sanitization pipeline. `null` is ambiguous in the backend (no avatar or worker failure), so absent or unusable URLs fall back to direct ENS resolution. If avatar enrichment times out or fails upstream, identity is retried without `include=avatar`. Optional avatar failures produce the default card artwork. Resolved backend URLs are not written into the raw ENS-record cache. Provider-resolved NFT avatar images rely on the backend worker's verification; locally resolved NFT references verify ownership against the ENS resolved address. Generated-card cache versions were bumped for this ownership-check fix.

Direct avatar/header resolution uses viem's canonical Universal Resolver and CCIP-Read. The minimum viem version exceeds the [ENSv2 readiness requirement](https://docs.ens.domains/web/ensv2-readiness/); no resolver address is hardcoded. V2 metadata, name lookup and cards cache for 15 minutes. V2 cards bypass permanent R2 generated-card caching because ancestry and [token IDs can change](https://docs.ens.domains/ensv2/mutable-token-ids/). Backend caching can add further lag.

Before production: confirm backend chain and registry coverage, add subregistry discovery/indexing and reliable index-health reporting, and wire invalidation for registration, expiry, transfer, regeneration, migration and hierarchy changes. Backend code was not modified by this integration. See [cache invalidation](#indexer-endpoints).

## One-click deploy

Click the **Deploy to Cloudflare** button above. Cloudflare forks this repo into your GitHub and runs `npm run deploy`. The deploy script creates or reuses the R2 bucket (`ens-metadata-ipfs-cache`) and KV namespace (`RESOLVER_CACHE`) on your account, then writes the account-specific KV namespace ID into the build copy of `wrangler.toml` before publishing.

The setup page will prompt for these optional secrets — leave them blank unless you need them:

- `THE_GRAPH_API_KEY` — one or more **comma-separated** Graph API keys. Requests are spread randomly across the keys and retried on a different key on rate-limit/transport failures. Blank uses the public subgraph endpoints.
- `OPENSEA_API_KEY` — OpenSea-hosted NFT metadata used by ERC-721 and ERC-1155 avatar/header lookups.

Public endpoints (`ETH_RPC_URL`, `SUBGRAPH_URL_*`, `IPFS_GATEWAYS`) come from `[vars]` in `wrangler.toml` and can be overridden on the same setup page. The indexer-only endpoints need their own secrets — see [Indexer endpoints](#indexer-endpoints).

## Local development

Requires Node 20+.

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in any secrets you have
npm run dev                      # wrangler dev on localhost:8787
npm test                         # vitest in workerd via @cloudflare/vitest-pool-workers
npm run typecheck                # tsc --noEmit
```

Open http://localhost:8787 for the Scalar docs. Miniflare simulates R2 and KV locally — no manual resource creation needed for dev.

## Deploy manually

If you'd rather clone and deploy from the CLI instead of using the button, log in with Wrangler, add any optional secrets you need, then deploy. `npm run deploy` will create or reuse the KV namespace and R2 bucket for the authenticated account before publishing.

```sh
npx wrangler secret put THE_GRAPH_API_KEY      # optional
npx wrangler secret put OPENSEA_API_KEY        # optional

npm run deploy
```

## Configuration

Public vars live in `wrangler.toml` under `[vars]` and can be edited freely:

- `ETH_RPC_URL`, `SEPOLIA_RPC_URL`, `HOLESKY_RPC_URL`
- `IPFS_GATEWAYS` — comma-separated. All gateways are raced in parallel and the fastest successful response wins. The defaults in `wrangler.toml` are public, best-effort endpoints.
- `SUBGRAPH_URL_MAINNET`, `SUBGRAPH_URL_SEPOLIA`, `SUBGRAPH_URL_HOLESKY` — `{API_KEY}` in a URL is substituted with a `THE_GRAPH_API_KEY` key.
- `GRAILS_API_URL_MAINNET`, `GRAILS_API_URL_SEPOLIA`, `GRAILS_API_URL_HOLESKY` — optional, separate Grails `/api/v1` roots per network. Sepolia is configured for the supplied V2 preparation deployment; the other networks retain legacy behavior until explicitly configured.
- `LOG_LEVEL` — `debug` | `info` | `warn` | `error` (default `info`). See [Observability](#observability).
- `PUBLIC_BASE_URL` — optional; the absolute origin `/cache/preload` self-fetches to warm the edge cache. Falls back to the incoming request origin when unset (set it behind a custom domain / preview).

Cloudflare retired its public IPFS gateway in 2024. For production, point `IPFS_GATEWAYS` at reliable dedicated gateways or a self-hosted Kubo node rather than relying on the public defaults.

## Indexer endpoints

Two indexer-only `POST` endpoints keep caches in sync with on-chain changes. Each returns `503` until its secrets are set; every other route is unaffected.

- **`POST /cache/invalidate`** — purge KV + R2 + the edge cache for a name/token. Secrets: `CACHE_INVALIDATION_TOKEN`, `CF_API_TOKEN`, `CF_ZONE_ID`. Spec: [`docs/cache-invalidation.md`](./docs/cache-invalidation.md).
- **`POST /cache/preload`** — warm R2 (by CID) and the per-colo edge cache (by `network`+`name`) so the first real user gets a hot response. Secret: `CACHE_PRELOAD_TOKEN` (optional `PUBLIC_BASE_URL`). Spec: [`docs/cache-preload.md`](./docs/cache-preload.md).

```sh
npx wrangler secret put CACHE_INVALIDATION_TOKEN
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
npx wrangler secret put CACHE_PRELOAD_TOKEN
```

## Caching

- Resolved avatar/header URIs are cached in KV for 15 minutes
- Image bytes are cached in R2, keyed by IPFS CID or by `sha256(url)` for HTTPS sources
- On a cache miss, IPFS/HTTPS images stream to the client while the R2 copy is written in the background, so time-to-first-byte does not wait on the full download
- HTTPS fetches are revalidated with `If-None-Match` / `If-Modified-Since` when an ETag or `Last-Modified` was stored
- Responses also opt into the Workers Cache API via `Cache-Control: public, max-age=900`
- Sanitized SVG bytes are stored in R2 with a `sanitizerVersion` field. When the SVG sanitizer policy changes, bump `SANITIZER_VERSION` in `src/services/sanitize.ts`; older cached entries are lazily re-sanitized on first read. Note: `*.workers.dev` preview URLs cannot be tag-purged — stale Workers Cache responses expire naturally after `max-age=900` (15 min).

## Observability

`[observability]` is enabled in `wrangler.toml`, so `console` output is ingested by Workers Logs. The service emits **structured single-line JSON** logs:

- One `request_complete` line per request (method, path, status, duration) carrying a `reqId` — Cloudflare's `cf-ray` when present, a UUID otherwise — propagated to all service-layer and `waitUntil` logs via `AsyncLocalStorage`.
- Unhandled errors log `unhandled_error`; handled 5xx log `http_error` (4xx are not logged).
- Cache-seam and IPFS gateway-race diagnostics (`r2_image_*`, `kv_resolver_*`, `ipfs_gateway_win`) are `debug`-level — set `LOG_LEVEL=debug` under `[vars]` to surface them.

## License

MIT, see [LICENSE](./LICENSE).
