#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const job = String(process.env.RUNNER_JOB || "").trim();
const bundleDir = path.resolve(process.env.RUNNER_BUNDLE_DIR || ".runner-bundle");

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
    env: { ...process.env, RUNNER_JOB: job },
    stdio: "inherit",
    timeout: 3 * 60 * 60 * 1000,
  });
  process.exit(result.status ?? 1);
}

console.error("Runner bundle has no supported entrypoint");
process.exit(1);
