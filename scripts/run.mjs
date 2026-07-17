#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const job = String(process.env.RUNNER_JOB || "").trim();
const bundleDir = path.resolve(process.env.RUNNER_BUNDLE_DIR || ".runner-bundle");
const runnerTimeoutMs = readPositiveIntegerEnv("RUNNER_TIMEOUT_MS", 3 * 60 * 60 * 1000);
const brokeredEnv = loadBrokeredEnv();
const runnerDefaults = {
  DEEZER_READONLY_REFRESH_CONCURRENCY: "2",
  DEEZER_API_MIN_INTERVAL_MS: "300",
  // Give Cloudflare-backed refresh jobs more breathing room under transient load.
  OFFICIAL_VIDEO_REFRESH_CONCURRENCY: "1",
  CLOUDFLARE_NATIVE_RETRY_MAX_ATTEMPTS: "8",
  CLOUDFLARE_NATIVE_RETRY_BASE_DELAY_MS: "750",
};
const sourceOfTruthEnv = cloudflareTargetEnv(job);

console.log(JSON.stringify({
  stage: "bootstrap",
  job,
  source: process.env.RUNNER_SOURCE || "github",
  cron: process.env.RUNNER_CRON || "manual",
  sourceOfTruth: sourceOfTruthEnv.SCRAPER_DB_TARGET || sourceOfTruthEnv.RECALC_DB_TARGET || "default",
}));

if (!job) {
  console.error("RUNNER_JOB is not set");
  process.exit(1);
}

if (!existsSync(bundleDir)) {
  console.error(`Runner bundle directory not found: ${bundleDir}`);
  process.exit(1);
}

const candidates = [
  ["node", ["scripts/run-cloud-job.mjs", job]],
  ["node", ["run.mjs", job]],
  ["node", ["index.mjs", job]],
];

for (const [command, args] of candidates) {
  const scriptPath = path.join(bundleDir, args[0]);

  if (!existsSync(scriptPath)) continue;

  const result = spawnSync(command, args, {
    cwd: bundleDir,
    env: {
      ...runnerDefaults,
      ...process.env,
      ...brokeredEnv,
      ...sourceOfTruthEnv,
      RUNNER_JOB: job,
      NGMC_JOB_KIND: job,
    },
    stdio: "inherit",
    timeout: runnerTimeoutMs,
  });
  process.exit(result.status ?? 1);
}

console.error("Runner bundle has no supported entrypoint");
process.exit(1);

function loadBrokeredEnv() {
  const keyFile = String(process.env.RUNNER_KEY_FILE || "").trim();
  if (!keyFile) return {};
  if (!existsSync(keyFile)) {
    console.error(`Runner key file not found: ${keyFile}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(keyFile, "utf8"));
  } catch (err) {
    console.error(`Runner key file is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("Runner key file must contain an object");
    process.exit(1);
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, value == null ? "" : String(value)])
  );
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (Number.isSafeInteger(value) && value > 0) return value;

  console.error(`${name} must be a positive integer, got: ${raw}`);
  process.exit(1);
}

function cloudflareTargetEnv(jobName) {
  const normalized = String(jobName || "").trim();
  const isFanoutJob =
    normalized.startsWith("refresh-part:") ||
    normalized === "daily-refresh-fanout-start" ||
    normalized === "full-discovery-refresh-fanout-start" ||
    normalized === "daily-refresh-fanout-prepare" ||
    normalized === "full-discovery-refresh-fanout-prepare" ||
    normalized === "daily-refresh-fanout-finalize" ||
    normalized === "full-discovery-refresh-fanout-finalize";

  if (!isFanoutJob && normalized !== "recalculate-live-chart") return {};

  // Cloudflare relational D1 (d1rel) is the sole core store since the cutover. NEVER inject
  // supabase targets: there are no Supabase creds in the key broker, and the scraper hardcodes
  // the Cloudflare core client anyway — these keep the bootstrap log + any env-respecting code
  // honest and pointed at Cloudflare.
  return {
    SCRAPER_DB_TARGET: "cloudflare",
    RECALC_DB_TARGET: "cloudflare",
    NGMC_CORE_READ_TARGET: "d1",
    NGMC_CORE_WRITE_TARGET: "d1",
  };
}
