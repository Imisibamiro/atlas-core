#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const bundleDir = path.resolve(process.env.RUNNER_BUNDLE_DIR || ".runner-bundle");
const keyFile = String(process.env.RUNNER_KEY_FILE || "").trim();
const shardCount = String(process.env.DISCOVERY_SHARD_COUNT || "8").trim();

if (!existsSync(bundleDir)) fail(`Runner bundle directory not found: ${bundleDir}`);
if (!keyFile || !existsSync(keyFile)) fail("RUNNER_KEY_FILE is required to plan discovery shards");
if (!/^[1-8]$/.test(shardCount)) fail("DISCOVERY_SHARD_COUNT must be an integer from 1 to 8");

let brokeredEnv;
try {
  const parsed = JSON.parse(readFileSync(keyFile, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
  brokeredEnv = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value == null ? "" : String(value)]));
} catch (error) {
  fail(`Runner key file is invalid: ${error instanceof Error ? error.message : String(error)}`);
}

const args = ["--import", "tsx", "scripts/plan-discovery-shards.ts", "--shards", shardCount];
const artistFilter = String(process.env.DISCOVERY_ARTIST_FILTER || "").trim();
const gateScopes = String(process.env.DISCOVERY_GATE_SCOPES || "").trim();
if (artistFilter) args.push("--artists", artistFilter);
if (gateScopes) args.push("--gate-scopes", gateScopes);

const result = spawnSync("node", args, {
  cwd: bundleDir,
  env: { ...process.env, ...brokeredEnv },
  encoding: "utf8",
});
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) fail(`Discovery planner could not start: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status ?? 1);

let planned;
try {
  planned = JSON.parse(result.stdout);
} catch (error) {
  fail(`Discovery planner returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}
if (!Array.isArray(planned?.include) || planned.include.length < 1 || planned.include.length > 8) {
  fail("Discovery planner returned an invalid shard list");
}

const matrix = {
  include: planned.include.map((shard) => ({
    shard: String(shard?.shard || ""),
    artist_ids: String(shard?.artist_ids || ""),
    artist_count: Number(shard?.artist_count || 0),
    estimated_work: Number(shard?.estimated_work || 0),
  })),
};
if (matrix.include.some((shard) => !/^[1-8]$/.test(shard.shard) || !shard.artist_ids || shard.artist_count < 1)) {
  fail("Discovery planner produced an empty or malformed shard");
}

process.stdout.write(JSON.stringify(matrix));

function fail(message) {
  console.error(message);
  process.exit(1);
}
