// =============================================================================
// SAFETY-NET EXPORT — every public table, enumerated from the project itself
//   CANONICAL_HOSTED_TARGET_REF=<ref> \
//   CANONICAL_HOSTED_ACKNOWLEDGE=I-AUTHORIZE-MUTATION-OF-<ref> \
//   CANONICAL_HOSTED_SERVICE_KEY=<key> \
//   CANONICAL_HOSTED_DISPOSABLE_PREFIX=U4-XXXXXX \
//   CANONICAL_HOSTED_EXPORT_DIR=/path/outside/the/repo \
//     npm run canonical-hosted-export
// =============================================================================
// This exists because the project is on the free tier — no automatic backups, no
// point-in-time recovery — and `pg_dump` needs a database password that is not
// available yet. Until it is, this is the ONLY copy of the real data that exists
// anywhere except the source workbooks.
//
// IT IS NOT A SCHEMA DUMP AND MUST NEVER BE CALLED ONE. It carries rows, not
// DDL, not sequences, not policies, not grants. Restoring from it means
// re-creating the schema first and re-inserting these rows.
//
// -----------------------------------------------------------------------------
// THE TABLE LIST COMES FROM THE DATABASE, NOT FROM THIS FILE
// -----------------------------------------------------------------------------
// A hand-written list backs up what its author remembered. The tables that
// matter most here are the ones that CANNOT be regenerated from the source
// workbooks — `segment_dimension`'s per-study aliases, which only a human who
// read both instruments could decide; `study_interpretation` and its event
// trail; `journey_definition`; `import_batch`, which is the lineage that
// explains the duplicate — and a delete of a study cascades through most of
// them.
//
// So the list is ENUMERATED: every table PostgREST publishes in its OpenAPI
// document, cross-checked against migration 0014's RLS coverage reporter. A
// table that appears in one enumeration and not the other is reported as a
// discrepancy rather than quietly resolved, because the two disagreeing is
// itself a fact about the project.
//
// -----------------------------------------------------------------------------
// A TABLE THAT CANNOT BE READ IS NAMED, NEVER SKIPPED
// -----------------------------------------------------------------------------
// A backup with an unreported hole is worse than a named gap, because it is
// trusted. Every table ends in exactly one of three states — exported and
// count-verified, or exported SHORT, or unreadable with its reason — and any
// state but the first makes the run exit non-zero.
//
// -----------------------------------------------------------------------------
// PAGING, AND WHY THE KEY IS DISCOVERED RATHER THAN ASSUMED
// -----------------------------------------------------------------------------
// `docs/P9_HARDENING.md` made keyset paging a standing rule: offset paging reads
// rows by position in an order SQL never promised. But five of this project's
// tables do not key on `id`, so assuming `id` would have mis-paged them
// silently. PostgREST marks primary keys in its OpenAPI document as `<pk/>`, so
// the key is read from there:
//
//   single-column key -> keyset, ordered by that column, asking for rows after
//                        the last one seen;
//   composite or none -> ONE bounded request for the whole table, which is not
//                        paging at all and so cannot skip a boundary. The method
//                        used is recorded per table.
//
// -----------------------------------------------------------------------------
// IT DELIBERATELY DOES NOT USE `writeArtifact`
// -----------------------------------------------------------------------------
// `hosted-evidence.mjs` scans every artifact and REFUSES anything that looks
// like a secret. That is right for evidence and wrong here, because this file is
// REAL CLIENT DATA on purpose. Routing it through the scanner would either
// refuse the backup or teach the scanner to accept real data. So this writes
// directly and carries the containment rule itself.
//
// The file is 0600 inside a 0700 directory. Its CONTENTS are never printed; only
// table names, byte sizes and row counts are reported.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { HostedTargetError, describeTarget, resolveHostedTarget } from "./lib/hosted-target.mjs";

const PAGE = 1000;
/** A bounded read above this many rows is refused rather than attempted. */
const BOUNDED_CEILING = 200_000;

const REPO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

/** The main repository a linked worktree points at — same rule as the evidence writer. */
function mainRepositoryRoot() {
  const dotGit = join(REPO_ROOT, ".git");
  try {
    if (!existsSync(dotGit)) return null;
    const match = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    const raw = match[1].trim();
    const windows = raw.match(/^([A-Za-z]):[\\/](.*)$/);
    const normalized =
      windows && process.platform !== "win32"
        ? `/mnt/${windows[1].toLowerCase()}/${windows[2].replace(/\\/g, "/")}`
        : raw;
    return resolve(dirname(dirname(dirname(normalized))));
  } catch {
    return null;
  }
}

const isInside = (parent, child) => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

// ---------------------------------------------------------------------------
// [1] Authorization and destination
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveHostedTarget(process.env);
} catch (thrown) {
  if (thrown instanceof HostedTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

const chosen = process.env.CANONICAL_HOSTED_EXPORT_DIR;
if (!chosen || chosen.trim() === "") {
  console.error(
    "REFUSED: CANONICAL_HOSTED_EXPORT_DIR is not set. This writes real client data; it has no default location.",
  );
  process.exit(2);
}
const outDir = resolve(chosen.trim());
if (isInside(REPO_ROOT, outDir)) {
  console.error(
    "REFUSED: the export directory is inside the worktree. Real client data must never land where `git add -A` can reach it.",
  );
  process.exit(2);
}
const mainRoot = mainRepositoryRoot();
if (mainRoot && isInside(mainRoot, outDir)) {
  console.error("REFUSED: the export directory is inside the main repository this worktree is linked to.");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const headers = { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` };

console.log("Be Community — safety-net data export (REAL CLIENT DATA)");
console.log("=".repeat(78));
console.log(`  ref: ${describeTarget(target).ref}`);
console.log(`  destination: ${outDir}`);

// ---------------------------------------------------------------------------
// [2] Enumerate the tables from the project, two independent ways
// ---------------------------------------------------------------------------
console.log("\n[enumerate] reading the table list from the project itself");

const apiAnswer = await fetch(`${target.apiOrigin}/rest/v1/`, { headers });
if (!apiAnswer.ok) {
  console.error(`REFUSED: the API root returned HTTP ${apiAnswer.status}; the table list cannot be enumerated.`);
  process.exit(1);
}
const openapi = await apiAnswer.json();
const exposed = Object.keys(openapi.paths ?? {})
  .filter((p) => p !== "/" && !p.startsWith("/rpc/"))
  .map((p) => p.slice(1))
  .sort();

/** Primary-key columns, as PostgREST itself declares them. */
const primaryKeys = {};
for (const table of exposed) {
  const properties = openapi.definitions?.[table]?.properties ?? {};
  primaryKeys[table] = Object.entries(properties)
    .filter(([, spec]) => typeof spec?.description === "string" && spec.description.includes("<pk/>"))
    .map(([column]) => column);
}

// The second enumeration: migration 0014's metadata-only reporter.
let rlsTables = null;
let rlsError = null;
{
  const answer = await fetch(`${target.apiOrigin}/rest/v1/rpc/rls_coverage_report`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: "{}",
  });
  if (answer.ok) {
    const rows = await answer.json();
    if (Array.isArray(rows)) rlsTables = rows.map((r) => r.table_name ?? r.name).filter(Boolean).sort();
  } else {
    rlsError = `HTTP ${answer.status}`;
  }
}

const onlyInApi = rlsTables ? exposed.filter((t) => !rlsTables.includes(t)) : [];
const onlyInRls = rlsTables ? rlsTables.filter((t) => !exposed.includes(t)) : [];

console.log(`  OpenAPI publishes ${exposed.length} tables`);
console.log(`  0014's RLS reporter counts ${rlsTables ? rlsTables.length : `— (${rlsError})`}`);
if (onlyInApi.length > 0) console.log(`  in the API but NOT in the RLS report: ${onlyInApi.join(", ")}`);
if (onlyInRls.length > 0) console.log(`  in the RLS report but NOT in the API: ${onlyInRls.join(", ")}`);
if (onlyInApi.length === 0 && onlyInRls.length === 0 && rlsTables) console.log("  the two enumerations agree exactly");

// Everything either enumeration knows about is a backup candidate.
const candidates = [...new Set([...exposed, ...(rlsTables ?? [])])].sort();

// ---------------------------------------------------------------------------
// [3] Read every table
// ---------------------------------------------------------------------------
async function exactCount(table) {
  const answer = await fetch(`${target.apiOrigin}/rest/v1/${table}?select=*&limit=0`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (!answer.ok) return { error: `HTTP ${answer.status}` };
  const range = answer.headers.get("content-range");
  return { count: range && range.includes("/") ? Number(range.split("/")[1]) : null };
}

/** Keyset by a single primary-key column. Never an offset. */
async function readKeyset(table, key) {
  const rows = [];
  let after = null;
  for (;;) {
    const cursor = after === null ? "" : `&${key}=gt.${encodeURIComponent(after)}`;
    const answer = await fetch(
      `${target.apiOrigin}/rest/v1/${table}?select=*&order=${key}.asc&limit=${PAGE}${cursor}`,
      { headers },
    );
    if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
    const page = await answer.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    after = page[page.length - 1][key];
    if (page.length < PAGE) break;
  }
  return rows;
}

/** One request for the whole table — not paging, so no boundary to mis-cross. */
async function readBounded(table, expected) {
  const answer = await fetch(`${target.apiOrigin}/rest/v1/${table}?select=*&limit=${expected + 1}`, { headers });
  if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
  const rows = await answer.json();
  if (!Array.isArray(rows)) throw new Error("the response was not an array of rows");
  return rows;
}

const captured = {};
const report = {};
for (const table of candidates) {
  const key = (primaryKeys[table] ?? []).length === 1 ? primaryKeys[table][0] : null;
  const { count: expected, error: countError } = await exactCount(table);

  if (countError) {
    report[table] = { status: "unreadable", reason: `count failed: ${countError}`, method: null };
    console.log(`  ${table.padEnd(28)} UNREADABLE — count failed (${countError})`);
    continue;
  }
  if (expected === null) {
    report[table] = { status: "unreadable", reason: "the server returned no Content-Range count", method: null };
    console.log(`  ${table.padEnd(28)} UNREADABLE — no count returned`);
    continue;
  }
  if (!key && expected > BOUNDED_CEILING) {
    report[table] = {
      status: "unreadable",
      reason: `no single-column primary key and ${expected} rows exceeds the ${BOUNDED_CEILING}-row bounded-read ceiling`,
      method: null,
      expected,
    };
    console.log(`  ${table.padEnd(28)} UNREADABLE — no single-column key and too large to read in one request`);
    continue;
  }

  const method = key ? `keyset(${key})` : `bounded(${(primaryKeys[table] ?? []).length === 0 ? "no pk" : "composite pk"})`;
  try {
    const rows = key ? await readKeyset(table, key) : await readBounded(table, expected);
    captured[table] = rows;
    const matched = rows.length === expected;
    report[table] = {
      status: matched ? "exported" : "short",
      method,
      expected,
      exported: rows.length,
    };
    console.log(
      `  ${table.padEnd(28)} ${String(rows.length).padStart(6)} of ${String(expected).padStart(6)}  ${method}` +
        (matched ? "" : "   <-- SHORT READ"),
    );
  } catch (thrown) {
    report[table] = { status: "unreadable", reason: thrown.message, method, expected };
    console.log(`  ${table.padEnd(28)} UNREADABLE — ${thrown.message}`);
  }
}

// ---------------------------------------------------------------------------
// [4] Write, and refuse to call an incomplete run a backup
// ---------------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = join(outDir, `becommunity-data-${stamp}.json`);
writeFileSync(
  path,
  JSON.stringify(
    {
      exportedAt: stamp,
      projectRef: describeTarget(target).ref,
      note: "Data-only export through PostgREST. NOT a schema dump. Contains real client data.",
      enumeration: {
        openapiTables: exposed,
        rlsReporterTables: rlsTables,
        rlsReporterError: rlsError,
        onlyInApi,
        onlyInRls,
      },
      primaryKeys,
      report,
      tables: captured,
    },
    null,
    1,
  ),
  { mode: 0o600 },
);

const exported = Object.entries(report).filter(([, r]) => r.status === "exported");
const shortRead = Object.entries(report).filter(([, r]) => r.status === "short");
const unreadable = Object.entries(report).filter(([, r]) => r.status === "unreadable");
const rowTotal = exported.reduce((n, [, r]) => n + r.exported, 0);

console.log("\n" + "=".repeat(78));
console.log(`path:  ${path}`);
console.log(`bytes: ${statSync(path).size}`);
console.log(`tables: ${exported.length} exported and count-verified, ${shortRead.length} short, ${unreadable.length} unreadable`);
console.log(`rows:   ${rowTotal}`);
for (const [table, r] of [...shortRead, ...unreadable]) {
  console.log(`  ${table}: ${r.status.toUpperCase()} — ${r.reason ?? `${r.exported} of ${r.expected}`}`);
}
if (shortRead.length > 0 || unreadable.length > 0) {
  console.error(
    "\nREFUSED TO CLAIM SUCCESS: the file was written but is INCOMPLETE. " +
      "A backup with an unreported hole is worse than a named gap.",
  );
  process.exit(1);
}
console.log("\nEvery table matched its exact count. This file holds REAL CLIENT DATA:");
console.log("it is never committed, never printed, and lives outside both repositories.");
