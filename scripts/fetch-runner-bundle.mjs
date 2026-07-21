#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";

const brokerBaseUrl = String(process.env.KEY_BROKER_URL || "").trim().replace(/\/+$/, "");
const outputPath = String(process.env.RUNNER_BUNDLE_ARCHIVE || "/tmp/runner-bundle.tgz").trim();
const expectedSha256 = String(process.env.RUNNER_BUNDLE_EXPECTED_SHA256 || "").trim().toLowerCase();
const allowLegacy = /^(1|true|yes|on)$/i.test(String(process.env.RUNNER_BUNDLE_ALLOW_LEGACY || ""));

if (!brokerBaseUrl) {
  fail("runner_bundle_fetch_misconfigured", "KEY_BROKER_URL is not set");
}

const oidcToken = await requestOidcToken();

if (expectedSha256 && !/^[a-f0-9]{64}$/.test(expectedSha256)) {
  fail("runner_bundle_expected_sha256_invalid", "RUNNER_BUNDLE_EXPECTED_SHA256 is not a SHA-256 digest");
}
const endpoint = new URL(`${brokerBaseUrl}/v1/internal/runner/bundle`);
if (expectedSha256) endpoint.searchParams.set("sha256", expectedSha256);

const response = await fetch(endpoint, {
  headers: {
    Authorization: `Bearer ${oidcToken}`,
    Accept: "application/gzip",
  },
});

if (!response.ok) {
  const body = await response.text().catch(() => "");
  const details = safeBrokerError(body, response.statusText);
  console.error(JSON.stringify({
    stage: "runner_bundle_fetch_failed",
    endpoint: "/v1/internal/runner/bundle",
    status: response.status,
    error_code: details.code,
    message: details.message,
    cf_ray: response.headers.get("cf-ray") || null,
  }));
  process.exit(1);
}

const archive = Buffer.from(await response.arrayBuffer());
if (archive.length === 0) {
  fail("runner_bundle_empty", "Runner bundle response was empty", response);
}

const actualSha256 = createHash("sha256").update(archive).digest("hex");
const declaredSha256 = String(response.headers.get("x-ngmc-runner-bundle-sha256") || "").trim().toLowerCase();
const version = String(response.headers.get("x-ngmc-runner-bundle-version") || "").trim() || "unknown";
const sourceSha = String(response.headers.get("x-ngmc-runner-source-sha") || "").trim() || "unknown";
const objectKey = String(response.headers.get("x-ngmc-runner-bundle-key") || "").trim() || null;
if (!declaredSha256 && !allowLegacy) {
  fail("runner_bundle_sha256_missing", "Broker did not declare a runner bundle SHA-256", response);
}
if (declaredSha256 && !/^[a-f0-9]{64}$/.test(declaredSha256)) {
  fail("runner_bundle_sha256_invalid", "Broker returned an invalid runner bundle SHA-256", response);
}
if (declaredSha256 && actualSha256 !== declaredSha256) {
  fail("runner_bundle_sha256_mismatch", `Downloaded ${actualSha256}, broker declared ${declaredSha256}`, response);
}
if (expectedSha256 && actualSha256 !== expectedSha256) {
  fail("runner_bundle_pin_mismatch", `Downloaded ${actualSha256}, workflow pinned ${expectedSha256}`, response);
}

writeFileSync(outputPath, archive, { mode: 0o600 });
writeAutomationMetadata({ actualSha256, version, sourceSha });
console.log(JSON.stringify({
  stage: "runner_bundle_fetched",
  endpoint: `${endpoint.pathname}${endpoint.search}`,
  status: response.status,
  bytes: archive.length,
  sha256: actualSha256,
  version,
  source_sha: sourceSha,
  object_key: objectKey,
  verified: Boolean(declaredSha256),
}));

function writeAutomationMetadata(metadata) {
  const lines = [
    `RUNNER_BUNDLE_SHA256=${metadata.actualSha256}`,
    `RUNNER_BUNDLE_VERSION=${metadata.version}`,
    `RUNNER_BUNDLE_SOURCE_SHA=${metadata.sourceSha}`,
    "",
  ].join("\n");
  const githubEnv = String(process.env.GITHUB_ENV || "").trim();
  if (githubEnv) appendFileSync(githubEnv, lines);
  const githubOutput = String(process.env.GITHUB_OUTPUT || "").trim();
  if (githubOutput) appendFileSync(githubOutput, [
    `sha256=${metadata.actualSha256}`,
    `version=${metadata.version}`,
    `source_sha=${metadata.sourceSha}`,
    "",
  ].join("\n"));
}

async function requestOidcToken() {
  const requestUrl = String(process.env.ACTIONS_ID_TOKEN_REQUEST_URL || "").trim();
  const requestToken = String(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || "").trim();
  if (!requestUrl || !requestToken) {
    fail("runner_oidc_unavailable", "GitHub OIDC request variables are unavailable");
  }

  const separator = requestUrl.includes("?") ? "&" : "?";
  const response = await fetch(`${requestUrl}${separator}audience=atlas-runner`, {
    headers: { Authorization: `bearer ${requestToken}` },
  });
  const payload = await response.json().catch(() => null);
  const token = String(payload?.value || "").trim();
  if (!response.ok || !token) {
    fail("runner_oidc_request_failed", "GitHub did not issue an OIDC token", response);
  }
  return token;
}

function safeBrokerError(body, fallbackMessage) {
  try {
    const parsed = JSON.parse(body);
    return {
      code: safeText(parsed?.error || parsed?.code || "runner_bundle_request_failed"),
      message: safeText(parsed?.message || parsed?.detail || fallbackMessage || "Request failed"),
    };
  } catch {
    return {
      code: "runner_bundle_request_failed",
      message: safeText(fallbackMessage || "Request failed"),
    };
  }
}

function safeText(value) {
  return String(value || "unknown_error")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^A-Za-z0-9 ._:/()[\]-]/g, "?")
    .slice(0, 240);
}

function fail(code, message, response) {
  console.error(JSON.stringify({
    stage: "runner_bundle_fetch_failed",
    endpoint: "/v1/internal/runner/bundle",
    status: response?.status || null,
    error_code: code,
    message: safeText(message),
    cf_ray: response?.headers?.get("cf-ray") || null,
  }));
  process.exit(1);
}
