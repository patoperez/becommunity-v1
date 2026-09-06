// =============================================================================
// SAFETY-NET EXPORT — the five tables that matter, as JSON, outside the repo
//   CANONICAL_HOSTED_TARGET_REF=<ref> \
//   CANONICAL_HOSTED_ACKNOWLEDGE=I-AUTHORIZE-MUTATION-OF-<ref> \
//   CANONICAL_HOSTED_SERVICE_KEY=<key> \
//   CANONICAL_HOSTED_DISPOSABLE_PREFIX=U4-XXXXXX \
//   CANONICAL_HOSTED_EXPORT_DIR=/path/outside/the/repo \
//     npm run canonical-hosted-export
// =============================================================================
// This exists because the project is on the free tier — no automatic backups, no
// point-in-time recovery — and `pg_dump` needs a database password that is not
// available. Until it is, this is the ONLY copy of the real data that exists
// anywhere except the source workbooks.
//
// IT IS NOT A SCHEMA DUMP AND MUST NEVER BE CALLED ONE. It carries rows, not
// DDL, not sequences, not policies, not grants. Restoring from it would mean
// re-creating the schema first and re-inserting these rows. It is a genuine,
// restorable-in-principle copy of the data, and nothing more.
//
// -----------------------------------------------------------------------------
// IT DELIBERATELY DOES NOT USE `writeArtifact`
// -----------------------------------------------------------------------------
// `hosted-evidence.mjs` scans every artifact and REFUSES anything that looks
// like a secret. That is exactly right for evidence — and exactly wrong here,
// because this file is REAL CLIENT DATA on purpose. Routing it through the
// scanner would either refuse the backup or teach the scanner to accept real
// data. So this writes directly, and carries the containment rule itself: the
// destination may not be inside the worktree or inside the main repository this
// worktree is linked to.
//
// -----------------------------------------------------------------------------
// EVERY READ IS A KEYSET, NEVER AN OFFSET
// -----------------------------------------------------------------------------
// `docs/P9_HARDENING.md` made this a standing rule: offset paging reads rows by
// position in an order SQL never promised, so a concurrent write can make a page
// boundary skip or repeat a row. This orders by primary key and asks for rows
// after the last id it saw. It then compares what it wrote against the table's
// exact count and REFUSES to claim success on a short read — a backup that
// silently dropped a page is worse than no backup, because it is trusted.
//
// The file is written 0600 inside a 0700 directory. Its CONTENTS are never
// printed; only paths, byte sizes and row counts are reported.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HostedTargetError,
  describeTarget,
  resolveHostedTarget,
} from "./lib/hosted-target.mjs";

/** The tables the owner named, plus the one 0023's reverse would damage. */
const TABLES = [
  "tenant",
  "study",
  "respondent",
  "quant_response",
  "qual_observation",
  // Not among the five, but 0023 ALTERs it and its reverse DROPS the columns
  // 0023 added, so a copy of it is the difference between a reversible mistake
  // and an unrecoverable one.
  "study_period_snapshot",
];

const PAGE = 1000;

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
  console.error("REFUSED: CANONICAL_HOSTED_EXPORT_DIR is not set. This writes real client data; it has no default location.");
  process.exit(2);
}
const outDir = resolve(chosen.trim());
if (isInside(REPO_ROOT, outDir)) {
  console.error("REFUSED: the export directory is inside the worktree. Real client data must never land where `git add -A` can reach it.");
  process.exit(2);
}
const mainRoot = mainRepositoryRoot();
if (mainRoot && isInside(mainRoot, outDir)) {
  console.error("REFUSED: the export directory is inside the main repository this worktree is linked to.");
  process.exit(2);
}

mkdirSync(outDir, { recursive: true, mode: 0o700 });

const headers = {
  apikey: target.serviceKey,
  Authorization: `Bearer ${target.serviceKey}`,
};

console.log("Be Community — safety-net data export (REAL CLIENT DATA)");
console.log("=".repeat(78));
console.log(`  ref: ${describeTarget(target).ref}`);
console.log(`  destination: ${outDir}`);

/** The table's exact row count, from Content-Range. */
async function exactCount(table) {
  const answer = await fetch(`${target.apiOrigin}/rest/v1/${table}?select=*&limit=0`, {
    headers: { ...headers, Prefer: "count=exact" },
  });
  if (!answer.ok) throw new Error(`counting ${table} returned HTTP ${answer.status}`);
  const range = answer.headers.get("content-range");
  return range && range.includes("/") ? Number(range.split("/")[1]) : null;
}

/** Every row, read forward by primary key. Never an offset. */
async function readAll(table) {
  const rows = [];
  let after = null;
  for (;;) {
    const cursor = after === null ? "" : `&id=gt.${encodeURIComponent(after)}`;
    const answer = await fetch(
      `${target.apiOrigin}/rest/v1/${table}?select=*&order=id.asc&limit=${PAGE}${cursor}`,
      { headers },
    );
    if (!answer.ok) throw new Error(`reading ${table} returned HTTP ${answer.status}`);
    const page = await answer.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    after = page[page.length - 1].id;
    if (page.length < PAGE) break;
  }
  return rows;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = join(outDir, `becommunity-data-${stamp}.json`);
const captured = {};
const counts = {};
let short = [];

for (const table of TABLES) {
  const expected = await exactCount(table);
  const rows = await readAll(table);
  captured[table] = rows;
  counts[table] = { expected, exported: rows.length };
  const ok = expected === rows.length;
  if (!ok) short.push(table);
  console.log(`  ${table.padEnd(24)} ${String(rows.length).padStart(6)} of ${String(expected).padStart(6)} ${ok ? "" : "  <-- SHORT READ"}`);
}

writeFileSync(
  path,
  JSON.stringify(
    {
      exportedAt: stamp,
      projectRef: describeTarget(target).ref,
      note: "Data-only export through PostgREST. NOT a schema dump. Contains real client data.",
      counts,
      tables: captured,
    },
    null,
    1,
  ),
  { mode: 0o600 },
);

const { size } = await import("node:fs").then((fs) => fs.promises.stat(path));
console.log("\n" + "=".repeat(78));
console.log(`path:  ${path}`);
console.log(`bytes: ${size}`);
if (short.length > 0) {
  console.error(`REFUSED TO CLAIM SUCCESS: short read on ${short.join(", ")}. The file was written but is INCOMPLETE.`);
  process.exit(1);
}
console.log("Every table matched its exact count. This file holds REAL CLIENT DATA:");
console.log("it is never committed, never printed, and lives outside both repositories.");
