// =============================================================================
// MANDATORY secret-leak gate (§6.5 "Prueba de fuga de secretos"; P7 Suite D, D1).
//
//   npm run build && npm run cf:build && npm run test:secrets
//   npm run test:secrets:client   # client bundle only — NOT the complete gate
// =============================================================================
// Static review cannot prove a secret is safe — you must inspect the artifacts
// that are actually shipped. Two artifacts, two different rules:
//
//   .next/static  (CLIENT)  the browser downloads it. No service_role material,
//                           and not even the `service_role` identifier: a client
//                           asset has no legitimate reason to name it.
//   .open-next    (SERVER)  the Worker bundle. The runtime environment-variable
//                           IDENTIFIER (process.env.SUPABASE_SERVICE_ROLE_KEY) is
//                           legitimate and expected there; an inlined VALUE is
//                           not. docs/CURRENT_STATE.md warns that a local
//                           OpenNext build can inline environment values, which
//                           is precisely what this scan exists to catch.
//
// Reporting: file paths and secret-class ids only. This script never prints a
// secret, a signature, or a fragment of either.
//
// A missing artifact is a FAILURE, never a silent skip. `--client-only` runs the
// client half deliberately (the documented Windows `cf:build` EPERM case) and
// says loudly that it is not the complete gate.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  scanText,
  selfTest,
  looksBinary,
  privilegedEnvNames,
  isPrivilegedSupabaseKey,
} from "./lib/secret-patterns.mjs";

const CLIENT_DIR = ".next/static";
const SERVER_DIR = ".open-next";
const SCANNABLE = /\.(js|mjs|cjs|json|txt|map|css|html|md)$/;

const clientOnly = process.argv.includes("--client-only");

let failures = 0;
const fail = (m) => {
  console.error("  x FAIL:", m);
  failures++;
};
const ok = (m) => console.log("  ✓", m);

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!serviceKey) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Provide the local value (via .env.local)\n" +
      "or, in CI, a clearly synthetic canary value. Never a real key in CI.",
  );
  process.exit(2);
}
if (serviceKey.length < 16) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is too short to be a usable scan needle (<16 chars).");
  process.exit(2);
}

// Unique tail of the key. For a JWT this is the signature — never shared with
// the anon key, and never printed by this script.
const serviceParts = serviceKey.split(".");
const serviceSignature = serviceParts.length === 3 ? serviceParts[2] : serviceKey;
// Both supported Supabase formats count as real: the legacy service_role JWT
// and the current sb_secret_ key. Anything else is a synthetic CI canary.
const isCanary = !isPrivilegedSupabaseKey(serviceKey);

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) files.push(...walk(p));
    else if (SCANNABLE.test(name)) files.push(p);
  }
  return files;
}

/**
 * Scan one artifact tree. `allowIdentifier` is true for server output, where the
 * environment-variable name is a legitimate runtime reference.
 */
function scanArtifact(label, dir, { allowIdentifier }) {
  const files = walk(dir);
  console.log(`Scanning ${files.length} file(s) under ${dir}`);

  const valueHits = new Set();
  const classHits = new Map(); // file -> [classId]
  const identifierHits = new Set();
  let anonHits = 0;

  for (const f of files) {
    const buf = readFileSync(f);
    if (looksBinary(buf)) continue;
    const content = buf.toString("utf8");

    if (content.includes(serviceKey) || content.includes(serviceSignature)) valueHits.add(f);
    if (!allowIdentifier && content.includes("service_role")) identifierHits.add(f);
    const found = scanText(content);
    if (found.length > 0) classHits.set(f, found.map((x) => x.id));
    if (anonKey && content.includes(anonKey)) anonHits += 1;
  }

  console.log(`\n[${label}] configured service_role value / signature`);
  valueHits.size === 0
    ? ok("service_role value and signature absent (value never printed)")
    : fail(`service_role material embedded in: ${[...valueHits].join(", ")}`);

  console.log(`\n[${label}] secret-class patterns (value-independent)`);
  if (classHits.size === 0) {
    ok("no secret-class pattern matched");
  } else {
    for (const [f, ids] of classHits) fail(`${f} matched secret class(es): ${ids.join(", ")}`);
  }

  if (!allowIdentifier) {
    console.log(`\n[${label}] service_role identifier in browser-served assets`);
    identifierHits.size === 0
      ? ok("identifier absent from client assets")
      : fail(`service_role named in client asset(s): ${[...identifierHits].join(", ")}`);
  } else {
    console.log(`\n[${label}] runtime environment identifier`);
    ok("process.env.SUPABASE_SERVICE_ROLE_KEY is permitted here — only inlined values fail");
  }

  return anonHits;
}

console.log("=".repeat(70));
console.log("Secret-leak gate" + (clientOnly ? "  —  PARTIAL RUN (--client-only)" : ""));
console.log(`Needle: ${isCanary ? "synthetic canary value (CI mode)" : "configured service_role key"}`);
console.log("=".repeat(70) + "\n");

// ---------------------------------------------------------------------------
console.log("[0] scanner self-test (positive + negative control)");
const missed = selfTest();
missed.length === 0
  ? ok("matcher detects every secret class and does not flag the public anon key")
  : fail(`matcher is broken — undetected: ${missed.join(", ")}`);

// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(70));
if (!existsSync(CLIENT_DIR)) {
  console.error(`\nx REQUIRED ARTIFACT MISSING: ${CLIENT_DIR} — run 'npm run build' first.`);
  process.exit(2);
}
const anonHits = scanArtifact("client", CLIENT_DIR, { allowIdentifier: false });

console.log("\n[client] anon (public) key — informational");
if (anonHits > 0) {
  ok(`anon key present in ${anonHits} client asset(s) — expected and safe (RLS-protected, §6.3)`);
} else {
  console.log("  · anon key not in the client bundle: no client component uses the browser");
  console.log("    Supabase client yet (all DB access is server-side). Also safe.");
}

// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(70));
console.log("[source] no secret exposed through a NEXT_PUBLIC_* name");
function walkSrc(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walkSrc(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const publicVars = new Set();
const offenders = [];
for (const f of walkSrc("src")) {
  const content = readFileSync(f, "utf8");
  for (const m of content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    publicVars.add(m[0]);
    if (/SERVICE_ROLE|SECRET|PRIVATE|TOKEN|PASSWORD/i.test(m[0])) offenders.push(`${m[0]} in ${f}`);
  }
}
console.log("  NEXT_PUBLIC_* vars referenced in src:", [...publicVars].join(", ") || "(none)");
offenders.length === 0
  ? ok("no secret is exposed via NEXT_PUBLIC_*")
  : fail(`secret behind NEXT_PUBLIC_: ${offenders.join("; ")}`);

// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(70));
if (clientOnly) {
  console.log("[server] OpenNext output NOT scanned — this run was invoked with --client-only.");
} else if (!existsSync(SERVER_DIR)) {
  console.error(
    `\nx REQUIRED ARTIFACT MISSING: ${SERVER_DIR} — run 'npm run cf:build' first.\n` +
      "  On Windows cf:build can fail with the documented EPERM symlink limitation.\n" +
      "  In that case run 'npm run test:secrets:client' deliberately and let Linux CI\n" +
      "  run the complete gate. Do NOT treat a missing artifact as a pass.",
  );
  process.exit(2);
} else {
  scanArtifact("server", SERVER_DIR, { allowIdentifier: true });
}

// ---------------------------------------------------------------------------
// The build-time env snapshot. This is the check that would have caught the
// real defect on its own: it fails on the NAME, so it is red whether the build
// ran with the production key, with a canary, or with nothing at all.
//
// The OpenNext Cloudflare adapter compiles the project .env FILES into
// .open-next/cloudflare/next-env.mjs and replays them into process.env inside
// the Worker. A .env.local sitting next to the build therefore ships its
// contents in the bundle. Worker secrets are applied FIRST at runtime and take
// precedence, so this snapshot is never needed for a privileged value and is
// only capable of leaking one.
if (!clientOnly) {
  console.log("");
  console.log("-".repeat(70));
  console.log("[server] OpenNext build-time env snapshot carries no privileged name");
  const snapshot = join(SERVER_DIR, "cloudflare", "next-env.mjs");
  if (!existsSync(snapshot)) {
    console.error("");
    console.error("x REQUIRED ARTIFACT MISSING: " + snapshot);
    console.error("  The OpenNext build emitted no env snapshot, so this boundary cannot be");
    console.error("  proved. Do NOT treat a missing artifact as a pass.");
    process.exit(2);
  }
  const declared = privilegedEnvNames(readFileSync(snapshot, "utf8"));
  if (declared.length === 0) {
    ok("no privileged variable is compiled into the Worker bundle");
    console.log("    SUPABASE_SERVICE_ROLE_KEY must reach the Worker as an encrypted runtime");
    console.log("    secret instead. See docs/DEPLOYMENT.md.");
  } else {
    fail("privileged variable(s) compiled into " + snapshot + ": " + declared.join(", "));
    console.error("      The build read them from a .env file in the build directory. Build the");
    console.error("      deployable artifact from a checkout with no such file, and bind the");
    console.error("      value as a Worker secret instead (docs/DEPLOYMENT.md).");
  }
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — DO NOT deploy.`);
  process.exit(1);
}
if (clientOnly) {
  console.log("RESULT: client-bundle checks passed.");
  console.log("!! PARTIAL RUN — this is NOT the complete secret-leak gate. The OpenNext");
  console.log("!! server output was not scanned. Only 'npm run test:secrets' is the gate.");
  process.exit(0);
}
console.log("RESULT: no secret leak in the client bundle or the OpenNext server output.");
console.log("service_role stays server-side. GATE PASSED.");
