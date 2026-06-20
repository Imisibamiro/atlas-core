#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const job = String(process.env.RUNNER_JOB || "").trim();
const bundleDir = path.resolve(process.env.RUNNER_BUNDLE_DIR || ".runner-bundle");
const brokeredEnv = loadBrokeredEnv();

console.log(JSON.stringify({
  stage: "bootstrap",
  job,
  source: process.env.RUNNER_SOURCE || "github",
  cron: process.env.RUNNER_CRON || "manual",
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
  ["npm", ["run", "runner", "--", "--job", job]],
  ["npm", ["run", "start", "--", "--job", job]],
  ["node", ["run.mjs", "--job", job]],
  ["node", ["index.mjs", "--job", job]],
];

for (const [command, args] of candidates) {
  const scriptPath = args[0] === "run.mjs" || args[0] === "index.mjs"
    ? path.join(bundleDir, args[0])
    : path.join(bundleDir, "package.json");

  if (!existsSync(scriptPath)) continue;

  const result = spawnSync(command, args, {
    cwd: bundleDir,
    env: { ...process.env, ...brokeredEnv, RUNNER_JOB: job },
    stdio: "inherit",
    timeout: 3 * 60 * 60 * 1000,
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
