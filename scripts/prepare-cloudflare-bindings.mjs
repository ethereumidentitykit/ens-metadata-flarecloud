import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG_PATH = "wrangler.toml";
const WORKER_NAME = "ens-metadata-flarecloud";
const KV_BINDING = "RESOLVER_CACHE";
const R2_BUCKET = "ens-metadata-ipfs-cache";

const wranglerBin = join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

function runWrangler(args, { allowFailure = false } = {}) {
  const result = spawnSync(wranglerBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `wrangler ${args.join(" ")} failed with exit code ${result.status}:\n${output}`,
    );
  }

  return { ok: result.status === 0, output };
}

function kvBlock(config) {
  const blocks = config.match(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g) ?? [];
  return blocks.find((block) =>
    new RegExp(`binding\\s*=\\s*"${KV_BINDING}"`).test(block),
  );
}

function configuredKvId(config) {
  return kvBlock(config)?.match(/\bid\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

function parseJsonArray(output, command) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimStart().startsWith("["));
  const end =
    lines.length -
    1 -
    [...lines].reverse().findIndex((line) => line.trimEnd().endsWith("]"));

  if (start === -1 || end === lines.length || end < start) {
    throw new Error(`Could not parse JSON output from ${command}:\n${output}`);
  }

  return JSON.parse(lines.slice(start, end + 1).join("\n"));
}

function chooseNamespace(namespaces) {
  const configuredId = configuredKvId(readFileSync(CONFIG_PATH, "utf8"));
  if (configuredId) {
    const existing = namespaces.find((namespace) => namespace.id === configuredId);
    if (existing) return existing;
  }

  return (
    namespaces.find((namespace) => namespace.title === KV_BINDING) ??
    namespaces.find((namespace) => namespace.title === `${WORKER_NAME}-${KV_BINDING}`) ??
    null
  );
}

function parseCreatedNamespaceId(output) {
  const match = output.match(/\bid\s*=\s*"([a-f0-9]+)"/i);
  if (!match) {
    throw new Error(`Could not find created KV namespace id in Wrangler output:\n${output}`);
  }
  return match[1];
}

function updateKvNamespaceId(id) {
  const config = readFileSync(CONFIG_PATH, "utf8");
  const block = kvBlock(config);
  if (!block) {
    throw new Error(`Could not find [[kv_namespaces]] block for ${KV_BINDING}`);
  }

  const nextBlock = block.replace(/\bid\s*=\s*"[^"]+"/, `id = "${id}"`);
  writeFileSync(CONFIG_PATH, config.replace(block, nextBlock));
}

function ensureKvNamespace() {
  const list = runWrangler(["kv", "namespace", "list"]);
  const namespaces = parseJsonArray(list.output, "kv namespace list");
  let namespace = chooseNamespace(namespaces);

  if (!namespace) {
    const created = runWrangler(["kv", "namespace", "create", KV_BINDING]);
    namespace = { id: parseCreatedNamespaceId(created.output), title: KV_BINDING };
    console.log(`Created KV namespace ${KV_BINDING}.`);
  }

  updateKvNamespaceId(namespace.id);
  console.log(`Using KV namespace ${namespace.title ?? KV_BINDING}: ${namespace.id}`);
}

function ensureR2Bucket() {
  const info = runWrangler(["r2", "bucket", "info", R2_BUCKET], {
    allowFailure: true,
  });
  if (info.ok) {
    console.log(`Using R2 bucket ${R2_BUCKET}.`);
    return;
  }

  runWrangler(["r2", "bucket", "create", R2_BUCKET]);
  console.log(`Created R2 bucket ${R2_BUCKET}.`);
}

ensureKvNamespace();
ensureR2Bucket();
