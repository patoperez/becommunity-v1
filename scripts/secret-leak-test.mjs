// =============================================================================
// MANDATORY secret-leak test (§6.5 "Prueba de fuga de secretos").
//   1) npm run build        2) node --env-file=.env.local scripts/secret-leak-test.mjs
// =============================================================================
// Static review cannot prove a secret is safe — you must inspect the artifact
// the browser actually receives. This scans the CLIENT bundle (.next/static) and
// fails if the service_role key (or any non-public secret) appears there. The
// anon key is expected (and required) in the client — its presence is a sanity
// check that the scanner works.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!serviceKey) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(2); }

const CLIENT_DIR = ".next/static";
if (!existsSync(CLIENT_DIR)) { console.error(`${CLIENT_DIR} missing — run 'npm run build' first.`); process.exit(2); }

// Unique tail of the service_role JWT signature (NOT shared with the anon key).
const serviceSig = serviceKey.split(".").pop();

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) files.push(...walk(p));
    else if (/\.(js|json|txt|map|css|html)$/.test(name)) files.push(p);
  }
  return files;
}

let failures = 0;
const fail = (m) => { console.error("  ✗ FAIL:", m); failures++; };
const ok = (m) => console.log("  ✓", m);

const files = walk(CLIENT_DIR);
console.log(`Scanning ${files.length} client asset(s) under ${CLIENT_DIR}\n`);

// 1) service_role key MUST NOT appear in the client bundle.
let serviceHits = [];
let anonHits = 0;
for (const f of files) {
  const content = readFileSync(f, "utf8");
  if (content.includes(serviceKey) || content.includes(serviceSig) || content.includes("service_role")) {
    serviceHits.push(f);
  }
  if (anonKey && content.includes(anonKey)) anonHits += 1;
}

console.log("[1] service_role / secret exposure in client bundle");
serviceHits.length === 0
  ? ok("service_role key NOT present in client bundle")
  : fail(`service_role material found in: ${serviceHits.join(", ")}`);

console.log("\n[2] anon (public) key in client bundle — informational");
if (anonHits > 0) {
  ok(`anon key present in ${anonHits} client asset(s) — expected and safe (RLS-protected, §6.3)`);
} else {
  console.log("  · anon key not in client bundle: no client component uses the browser");
  console.log("    Supabase client yet (all DB access is server-side). Also safe.");
}

// 3) Source-level: no secret may be exposed via NEXT_PUBLIC_*.
console.log("\n[3] source check — no secret behind NEXT_PUBLIC_*");
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
const srcFiles = walkSrc("src");
const publicVars = new Set();
const offenders = [];
for (const f of srcFiles) {
  const content = readFileSync(f, "utf8");
  for (const m of content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    publicVars.add(m[0]);
    if (/SERVICE_ROLE|SECRET|PRIVATE/i.test(m[0])) offenders.push(`${m[0]} in ${f}`);
  }
}
console.log("  NEXT_PUBLIC_* vars referenced in src:", [...publicVars].join(", ") || "(none)");
offenders.length === 0 ? ok("no secret is exposed via NEXT_PUBLIC_*") : fail(`secret behind NEXT_PUBLIC_: ${offenders.join("; ")}`);

console.log("\n" + "=".repeat(60));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s) — DO NOT deploy.`); process.exit(1); }
console.log("RESULT: no secret leak. service_role stays server-side. GATE PASSED.");
