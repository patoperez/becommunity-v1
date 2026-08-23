// =============================================================================
// RLS coverage gate (P7 R3 / Suite A4) — behavioral, live, credential-bearing.
//
//   npm run test:rls-coverage                       the gate
//   npm run test:rls-coverage -- --expect-absent    rollback proof (see below)
// =============================================================================
// supabase/tests/rls_coverage.sql can only be run by a human in the SQL editor.
// This gate runs the same inventory through migration 0014's metadata-only
// reporting function over the real PostgREST path, and — just as importantly —
// proves that function's privilege model behaviorally:
//
//   [1] contract   static assertions on migration 0014 and its rollback
//   [2] project    the URL's project ref is the linked synthetic project
//   [3] service    service_role CAN execute it; every public table has RLS on
//   [4] anon       anon CANNOT execute it (permission denied, not "not found")
//   [5] authed     a really-signed-in client user CANNOT execute it either
//
// Checks 4 and 5 run AS those roles. A service-role request with altered headers,
// a fabricated JWT, or SET ROLE would prove nothing and is never used.
//
// A control that could not execute is a FAILURE, never a skip: this script exits
// non-zero unless every control actually ran and passed.
//
// --expect-absent inverts the expectation: it requires the function to be absent
// for service_role — and for every other role — for the expected reason
// (undefined function / not exposed), rather than merely denied. It exists so the
// 0014 rollback can be proven, and is not a merge gate.
//
// Reporting contract: table names, booleans, counts, SQLSTATE codes and HTTP
// status codes only. This script never prints a key, a token, an email, a
// response body, or any row of business data.
//
// WIRING. This gate needs the synthetic project's credentials, so it belongs to
// the live chain only: it is appended to `gates:live` after the existing checks,
// leaving their order untouched, and it is deliberately absent from `npm test`,
// `gates:offline` and GitHub Actions, which must stay credentials-free.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const EXPECT_ABSENT = process.argv.includes("--expect-absent");

const MIGRATION = "supabase/migrations/0014_rls_coverage_reporting.sql";
const ROLLBACK = "supabase/rollbacks/0014_drop_rls_coverage_reporting.sql";
const LINKED_REF_FILE = "supabase/.temp/project-ref";
const FUNCTION = "rls_coverage_report";
const SIGNATURE = `public.${FUNCTION}()`;

// RLS-enabled tables with zero policies deny all access. That is almost always a
// mistake, so it stays a separately visible failure — unless a table is
// DELIBERATELY deny-all, in which case it belongs here with its reason and a
// human review. Every entry below is deny-all by an explicit, reviewed decision
// in the named migration: browser roles lost both the policy and the grant, and
// the data is served only through authorized server paths.
const DOCUMENTED_DENY_ALL = Object.freeze({
  respondent: "0009 — respondent-level rows are not a browser API surface",
  quant_response: "0009 — respondent-level rows are not a browser API surface",
  segment_dimension: "0009 — respondent-level rows are not a browser API surface",
  journey_definition: "0009 — respondent-level rows are not a browser API surface",
  qual_observation: "0008 — raw quotes and machine suggestions stay internal",
});

let failures = 0;
const fail = (m) => {
  console.error("  x FAIL:", m);
  failures++;
};
const ok = (m) => console.log("  ✓", m);

// Every control must record an outcome. An unexecuted control fails the gate.
const CONTROLS = ["contract", "project", EXPECT_ABSENT ? "absence" : "service", "anon", "authenticated"];
const executed = new Set();
const ran = (name) => executed.add(name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- [1] Static migration contract -------------------------------------------
// Supplements the behavioral controls; it never replaces them.
function checkContract() {
  console.log("\n[1] Migration 0014 contract (static):");
  for (const f of [MIGRATION, ROLLBACK]) {
    if (!existsSync(f)) {
      fail(`${f} is missing`);
      return;
    }
  }
  const code = stripComments(readFileSync(MIGRATION, "utf8"));

  const createAt = code.indexOf(`create or replace function ${SIGNATURE}`);
  if (createAt < 0) fail(`0014 does not create ${SIGNATURE}`);
  else ok(`creates ${SIGNATURE}`);

  for (const [label, re] of [
    ["language sql", /\blanguage sql\b/],
    ["security definer", /\bsecurity definer\b/],
    ["an empty search_path", /\bset search_path = ''/],
  ]) {
    if (re.test(code)) ok(`declares ${label}`);
    else fail(`0014 does not declare ${label}`);
  }

  const returns = code.slice(Math.max(createAt, 0)).match(/returns table \(([\s\S]*?)\)/);
  const columns = returns
    ? returns[1]
        .split(",")
        .map((c) => c.trim().replace(/\s+/g, " ").toLowerCase())
        .filter(Boolean)
    : [];
  const expected = ["table_name text", "rls_enabled boolean", "rls_forced boolean", "policy_count bigint"];
  if (columns.join("|") === expected.join("|")) ok("returns exactly the metadata-only column contract");
  else fail(`return contract is ${JSON.stringify(columns)}, expected ${JSON.stringify(expected)}`);

  const body = code.match(/as \$\$([\s\S]*?)\$\$;/)?.[1] ?? "";
  const sources = [...body.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)].map((m) => m[1].toLowerCase());
  const nonCatalog = sources.filter((s) => !s.startsWith("pg_catalog."));
  if (sources.length > 0 && nonCatalog.length === 0)
    ok(`body reads only fully qualified pg_catalog objects (${sources.length} reference(s))`);
  else fail(`body reads non-catalog object(s): ${JSON.stringify(nonCatalog)}`);

  const revoke = `revoke execute on function ${SIGNATURE} from public, anon, authenticated;`;
  const grant = `grant execute on function ${SIGNATURE} to service_role;`;
  const revokeAt = code.indexOf(revoke);
  const grantAt = code.indexOf(grant);
  if (revokeAt < 0) fail("0014 lacks the exact fully qualified revoke from public, anon, authenticated");
  else ok("revokes execute from public, anon, authenticated (fully qualified signature)");
  if (grantAt < 0) fail("0014 lacks the exact fully qualified grant to service_role");
  else ok("grants execute to service_role (fully qualified signature)");
  if (createAt >= 0 && revokeAt > createAt && grantAt > revokeAt)
    ok("privilege order is create -> revoke -> grant, all in this one migration");
  else fail("privilege order is not create -> revoke -> grant in this migration");

  const otherGrantees = [...code.matchAll(/grant execute on function[^;]*\bto\s+([^;]+);/gi)]
    .map((m) => m[1].trim())
    .filter((g) => g !== "service_role");
  if (otherGrantees.length === 0) ok("no execute grant to any role other than service_role");
  else fail(`execute granted to unexpected role(s): ${JSON.stringify(otherGrantees)}`);

  if (/\bgrant\b[^;]*\bon\s+(?:all\s+)?tables?\b/i.test(code)) fail("0014 adds a table-level grant");
  else ok("adds no table-level grant");

  const rollback = stripComments(readFileSync(ROLLBACK, "utf8")).trim();
  if (rollback === `drop function if exists ${SIGNATURE};`) ok(`rollback drops exactly ${SIGNATURE}`);
  else fail("rollback is not exactly the single fully qualified drop of this function");
  if (/\b(alter|create|insert|update|delete|truncate|policy)\b/i.test(rollback))
    fail("rollback contains out-of-scope statements");
  else ok("rollback alters no table, policy, grant, data or other function");

  ran("contract");
}

function stripComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

// --- [2] Project identity ----------------------------------------------------
// Never guess a project and never switch one: the ref in the configured URL must
// be the project the Supabase CLI is linked to.
function checkProject(url) {
  console.log("\n[2] Project identity:");
  if (!existsSync(LINKED_REF_FILE)) {
    fail(`${LINKED_REF_FILE} is absent — the linked synthetic project cannot be confirmed (run the Supabase link first)`);
    return null;
  }
  const linked = readFileSync(LINKED_REF_FILE, "utf8").trim();
  let host;
  try {
    host = new URL(url).host;
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    return null;
  }
  const ref = host.split(".")[0];
  if (!linked || ref !== linked) {
    fail("the configured Supabase URL does not belong to the linked project — refusing to continue");
    return null;
  }
  ok("the configured URL matches the linked Supabase project ref");
  ran("project");
  return ref;
}

// --- PostgREST RPC over the real wire ----------------------------------------
// `apikey` selects the project; `Authorization` selects the ROLE the statement
// runs as. Each control below passes the credential of the role it is testing.
async function callRpc({ url, apikey, bearer }) {
  const res = await fetch(`${url}/rest/v1/rpc/${FUNCTION}`, {
    method: "POST",
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: "{}",
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  // Only the SQLSTATE / PostgREST code is ever surfaced — never the body.
  return {
    status: res.status,
    code: Array.isArray(payload) ? null : (payload?.code ?? null),
    rows: Array.isArray(payload) ? payload : null,
  };
}

const denied = (r) => r.status === 403 || r.code === "42501";
const absent = (r) => r.code === "PGRST202" || r.code === "42883" || r.status === 404;
const where = (r) => `status ${r.status}, code ${r.code ?? "none"}`;

// Shared verdict for the two negative controls. In the gate, the only acceptable
// rejection is an execute-permission denial — a missing endpoint would prove
// obscurity, not privilege. Under --expect-absent the function has just been
// dropped, so absence is the expected rejection for every role.
function assertCannotExecute(role, r) {
  if (r.rows) {
    fail(`${role} EXECUTED ${SIGNATURE} — the privilege model is broken`);
    return;
  }
  if (EXPECT_ABSENT) {
    if (absent(r)) ok(`${role} finds ${SIGNATURE} absent after the rollback (${where(r)})`);
    else if (denied(r)) fail(`${role} got a privilege denial (${where(r)}) — the function was expected to be absent`);
    else fail(`${role} rejected for the WRONG reason (${where(r)})`);
    return;
  }
  if (denied(r)) ok(`${role} rejected with an execute-permission denial (${where(r)})`);
  else if (absent(r)) fail(`${role} got absence (${where(r)}) — obscurity is not denial`);
  else fail(`${role} rejected for the WRONG reason (${where(r)})`);
}

// --- [3] Service-role positive control ---------------------------------------
async function checkServiceRole(url, serviceKey) {
  console.log("\n[3] Service-role positive control (metadata only):");
  const r = await callRpc({ url, apikey: serviceKey, bearer: serviceKey });
  if (!r.rows) {
    fail(`service_role could not execute ${SIGNATURE} (${where(r)})`);
    return;
  }
  if (r.rows.length === 0) {
    fail("the coverage inventory is empty — a zero-table result is not evidence of coverage");
    return;
  }
  ok(`inventory returned ${r.rows.length} public table(s)`);

  const uncovered = r.rows.filter((t) => t.rls_enabled !== true).map((t) => t.table_name);
  if (uncovered.length === 0) ok("every public ordinary/partitioned table has RLS enabled");
  else fail(`table(s) WITHOUT RLS: ${uncovered.join(", ")}`);

  // Reported, not gated: FORCE RLS additionally binds the table owner. Coverage
  // is the contract here; the flag is surfaced so a gap stays visible.
  const unforced = r.rows.filter((t) => t.rls_forced !== true).map((t) => t.table_name);
  console.log(
    `     forced RLS on ${r.rows.length - unforced.length}/${r.rows.length} table(s)` +
      (unforced.length ? ` — not forced: ${unforced.join(", ")}` : ""),
  );

  const zeroPolicy = r.rows
    .filter((t) => t.rls_enabled === true && Number(t.policy_count) === 0)
    .map((t) => t.table_name);
  const undocumented = zeroPolicy.filter((t) => !(t in DOCUMENTED_DENY_ALL));
  if (zeroPolicy.length === 0) ok("no RLS-enabled table is left without policies");
  else if (undocumented.length === 0) ok(`deny-all by design, documented: ${zeroPolicy.join(", ")}`);
  else fail(`RLS-enabled table(s) with ZERO policies (deny-all, undocumented): ${undocumented.join(", ")}`);

  ran("service");
}

// --- [3'] Rollback absence proof ---------------------------------------------
async function checkAbsent(url, serviceKey) {
  console.log("\n[3] Rollback absence proof (service_role):");
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = await callRpc({ url, apikey: serviceKey, bearer: serviceKey });
    if (r.rows) {
      // The API schema cache can lag a DDL drop; retry a bounded number of times.
      if (attempt === 6) {
        fail(`${SIGNATURE} is still executable by service_role after the rollback`);
        break;
      }
      await sleep(2000);
      continue;
    }
    if (absent(r)) ok(`${SIGNATURE} is absent for service_role (${where(r)})`);
    else fail(`${SIGNATURE} failed for an unexpected reason (${where(r)})`);
    break;
  }
  ran("absence");
}

// --- [4] Anon negative control -----------------------------------------------
async function checkAnon(url, anonKey) {
  console.log("\n[4] Anon negative control (executed AS anon):");
  const r = await callRpc({ url, apikey: anonKey, bearer: anonKey });
  assertCannotExecute("anon", r);
  ran("anon");
}

// --- [5] Authenticated negative control --------------------------------------
// A real sign-in through the Auth API, using that user's real access token. No
// service-role impersonation, no fabricated JWT, no SET ROLE.
async function checkAuthenticated(url, anonKey, email, password) {
  console.log("\n[5] Authenticated negative control (executed AS a real signed-in user):");
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) {
      fail(`could not sign in the synthetic client identity (${signInError.code ?? signInError.status ?? "error"})`);
      return;
    }
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) {
      fail("no server-verified user for this session — the control cannot be trusted");
      return;
    }
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      fail("no access token on the session — the control cannot be trusted");
      return;
    }
    if (userData.user.role !== "authenticated") {
      fail(`the server-verified session role is "${userData.user.role}", expected "authenticated"`);
      return;
    }
    let claimRole = null;
    let claimSub = null;
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      claimRole = claims.role ?? null;
      claimSub = claims.sub ?? null;
    } catch {
      claimRole = null;
    }
    if (claimRole !== null && (claimRole !== "authenticated" || claimSub !== userData.user.id)) {
      fail("the access token does not carry this signed-in user's authenticated claims");
      return;
    }
    ok(`the session is genuinely authenticated (getUser role "authenticated", token role "${claimRole ?? "unreadable"}")`);

    const r = await callRpc({ url, apikey: anonKey, bearer: token });
    assertCannotExecute("authenticated", r);
    ran("authenticated");
  } finally {
    // The client library keeps the session in memory only; end it anyway.
    await client.auth.signOut({ scope: "local" }).catch(() => {});
  }
}

async function main() {
  console.log("Be Community — RLS coverage gate" + (EXPECT_ABSENT ? " (--expect-absent: rollback proof)" : ""));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.TEST_USER_A_EMAIL;
  const password = process.env.TEST_USER_A_PASSWORD;

  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
    ["TEST_USER_A_EMAIL", email],
    ["TEST_USER_A_PASSWORD", password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    console.error("Missing env vars:", missing.join(", "));
    console.error("This gate is credential-bearing and runs against the linked synthetic project only.");
    process.exit(2);
  }

  checkContract();
  const ref = checkProject(url);
  if (!ref) {
    console.error("\nProject identity could not be verified — stopping before any remote call.");
    process.exit(2);
  }

  if (EXPECT_ABSENT) await checkAbsent(url, serviceKey);
  else await checkServiceRole(url, serviceKey);
  await checkAnon(url, anonKey);
  await checkAuthenticated(url, anonKey, email, password);

  const skipped = CONTROLS.filter((c) => !executed.has(c));
  console.log("\n" + "=".repeat(60));
  if (skipped.length) {
    console.error(`RESULT: control(s) that did not execute: ${skipped.join(", ")} — inference is not evidence.`);
    process.exit(1);
  }
  if (failures > 0) {
    console.error(`RESULT: ${failures} failure(s) — RLS coverage / the privilege model is NOT proven.`);
    process.exit(1);
  }
  console.log("RESULT: all RLS coverage controls passed.");
}

main().catch((e) => {
  console.error("Gate crashed:", e.message);
  process.exit(3);
});
