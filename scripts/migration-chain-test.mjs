// =============================================================================
// MANDATORY migration chain gate
//   node scripts/migration-chain-test.mjs
// =============================================================================
// Supabase records an applied migration by its NUMBER. Two files that share a
// number are therefore not a naming annoyance: the second one is skipped or
// conflicts against a project that already recorded the first, and both
// outcomes are quiet enough to look like success. This branch has already been
// bitten by that — its canonical migrations were authored as 0022, 0023 and
// 0024 while the hosted project had already recorded four DIFFERENT migrations
// under 0022, 0023, 0024 and 0025 from other branches. The canonical files were
// renumbered to 0026-0028 because the database had made the other numbering a
// fait accompli.
//
// This gate exists so that collision cannot come back silently. It INVENTORIES
// `supabase/migrations` and `supabase/rollbacks` from disk and validates the
// contract that inventory has to satisfy. It does not assert over a hardcoded
// list of today's filenames: a new migration added tomorrow is checked by the
// same rules, and a canonical file renamed back onto an occupied number fails
// here rather than against a live project.
//
// WHAT IT PROVES, AND WHY EACH ONE IS EXECUTED HERE RATHER THAN LATER:
//
//   [1] SHAPE AND UNIQUENESS. Every migration is `NNNN_slug.sql`, no two
//       forward migrations share a number, the numbers are contiguous from
//       0000, and the four-digit padding makes a lexicographic sort identical
//       to a numeric one — which is the assumption every runner here makes.
//
//   [2] THE APPLIED SLOTS ARE PINNED BY CONTENT. 0022-0025 are already applied
//       to the hosted project. Their files are a COPY of applied history, so
//       each is pinned to the SHA-256 of the authoritative blob. A canonical
//       migration cannot reoccupy one of those numbers without changing a
//       pinned hash, and an "improvement" to an applied migration fails here
//       too — the hosted project would never see it.
//
//   [3] THE CANONICAL SET. The three canonical migrations are discovered by
//       their slug, never by their number, and must be a contiguous ordered
//       run strictly above every applied slot.
//
//   [4] ROLLBACK SYMMETRY. Every canonical forward has a rollback under the
//       SAME number. A rollback is not invented for a migration that has none:
//       the gate checks the numbers that DO carry one still agree.
//
//   [5] THE RUNNERS OMIT NOTHING. The disposable-PostgreSQL runner discovers
//       migrations with its own regex and stops at its own upper bound. Both
//       are read OUT OF THE RUNNER'S SOURCE and applied to the real directory,
//       so a runner that would silently skip a file — or stop short of the
//       last migration — fails here instead of reporting a green run against
//       an incomplete schema.
//
//   [6] THE RENAME CHANGED NOTHING EXECUTABLE. A migration number appears in
//       these files ONLY inside `--` comments; it is never part of a statement
//       PostgreSQL executes. That invariant is what makes renumbering safe, so
//       it is asserted directly, alongside the object inventory and the
//       transaction contract each canonical file must still declare.
//
//   [7] THE DOCUMENTATION DOES NOT LIE. No document may still hand the
//       canonical migrations 0022-0024, or repeat the withdrawn claim that a
//       hosted project has never been contacted. Since 2026-09-06 the canonical
//       chain IS applied to the hosted project, so the claim this section
//       guards has inverted with the fact: every governing document must now
//       RECORD that application, none may call it pending, and none may claim
//       the step that has NOT happened — a real workbook imported into the
//       canonical tables.
//
// It contacts nothing. It reads files.
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const readBytes = (path) => readFileSync(root + path);
const list = (path) => readdirSync(root + path).filter((name) => name.endsWith(".sql")).sort();

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

const MIGRATIONS = "supabase/migrations/";
const ROLLBACKS = "supabase/rollbacks/";

/**
 * SHA-256 of a file's CONTENT, with CRLF normalised to LF first.
 *
 * The identity being pinned is what PostgreSQL would receive, not how a given
 * checkout chose to store its line endings — `core.autocrlf` is true on the
 * Windows editing workstation and absent on the Linux verifier, and a hash that
 * disagreed between them would be measuring git configuration.
 */
const digest = (path) =>
  createHash("sha256").update(readBytes(path).toString("binary").replace(/\r\n/g, "\n"), "binary").digest("hex");

/**
 * The SQL a server would actually execute: `--` comments removed, whitespace
 * collapsed, blank lines dropped. Quoted strings and dollar-quoted function
 * bodies are respected, so a `--` inside a literal is not mistaken for a
 * comment.
 */
const executableSql = (sql) => {
  const out = [];
  for (const raw of sql.split(/\r?\n/)) {
    let line = "";
    let quote = null;
    let dollar = null;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (dollar) {
        line += c;
        if (raw.startsWith(dollar, i)) {
          line += raw.slice(i + 1, i + dollar.length);
          i += dollar.length - 1;
          dollar = null;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        line += c;
        continue;
      }
      const opener = raw.slice(i).match(/^\$[a-zA-Z_]*\$/);
      if (opener) {
        dollar = opener[0];
        line += opener[0];
        i += opener[0].length - 1;
        continue;
      }
      if (c === "-" && raw[i + 1] === "-") break;
      line += c;
    }
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
};

const createdTables = (sql) => [...sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
const droppedTables = (sql) => [...sql.matchAll(/drop table public\.([a-z0-9_]+)\s*;/gi)].map((m) => m[1]);

/**
 * The tables a migration hands to its security block.
 *
 * All three canonical migrations lock their new tables the same way: one
 * `do $$ … foreach <var> in array array[…] loop … end loop` whose body enables
 * RLS, forces it, denies the browser roles by policy, revokes their privileges
 * and grants `service_role`. Reading the ARRAY rather than matching per-table
 * `alter table` statements is what makes this a check on the real contract —
 * the statements themselves are built by `format()` and never appear literally.
 */
const securityLoops = (sql) =>
  [...sql.matchAll(/array\s*\[([\s\S]*?)\]\s*loop([\s\S]*?)end loop/gi)]
    .filter((m) => /enable row level security/i.test(m[2]))
    .map((m) => ({ tables: [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((q) => q[1]), body: m[2] }));
const sameMembers = (actual, expected) =>
  actual.length === expected.length && expected.every((name) => actual.includes(name));

console.log("Be Community — migration chain gate");

// ---- [1] The inventory has a shape, and every number is unique -------------
console.log("\n[1] The migration directory is a well-formed, contiguous, unique chain");

const migrationFiles = list(MIGRATIONS);
const rollbackFiles = list(ROLLBACKS);
const NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const parsed = [];
{
  const malformed = migrationFiles.filter((name) => !NAME.test(name));
  check(malformed.length === 0, `every migration file is NNNN_slug.sql (${migrationFiles.length} files, ${malformed.length} malformed${malformed.length ? `: ${malformed.join(", ")}` : ""})`);
  for (const name of migrationFiles) {
    const m = NAME.exec(name);
    if (m) parsed.push({ name, number: Number(m[1]), prefix: m[1], slug: m[2] });
  }

  const byNumber = new Map();
  const duplicates = [];
  for (const entry of parsed) {
    if (byNumber.has(entry.number)) duplicates.push(`${entry.prefix}: ${byNumber.get(entry.number).name} and ${entry.name}`);
    else byNumber.set(entry.number, entry);
  }
  check(duplicates.length === 0, `no two forward migrations share a number${duplicates.length ? ` — COLLISION: ${duplicates.join("; ")}` : ""}`);

  const numbers = parsed.map((e) => e.number);
  const gaps = numbers.filter((n, i) => i > 0 && n !== numbers[i - 1] + 1).map((n) => `${numbers[numbers.indexOf(n) - 1]}->${n}`);
  check(numbers[0] === 0, `the chain starts at 0000 (${parsed[0]?.prefix ?? "none"})`);
  check(gaps.length === 0, `the chain is contiguous with no gap${gaps.length ? `: ${gaps.join(", ")}` : ` (0000-${parsed[parsed.length - 1]?.prefix})`}`);

  const lexicographic = [...migrationFiles].sort();
  const numeric = [...parsed].sort((a, b) => a.number - b.number).map((e) => e.name);
  check(
    JSON.stringify(lexicographic) === JSON.stringify(numeric),
    "four-digit padding makes a lexicographic sort identical to a numeric one — the assumption every runner here makes",
  );

  const rollbackMalformed = rollbackFiles.filter((name) => !NAME.test(name));
  check(rollbackMalformed.length === 0, `every rollback file is NNNN_slug.sql (${rollbackFiles.length} files)`);
  const orphans = rollbackFiles.filter((name) => {
    const m = NAME.exec(name);
    return m && !byNumber.has(Number(m[1]));
  });
  check(orphans.length === 0, `no rollback names a number that has no forward migration${orphans.length ? `: ${orphans.join(", ")}` : ""}`);
}

// ---- [2] The applied slots are pinned to the content that was applied ------
console.log("\n[2] 0022-0025 are a COPY of applied history, pinned by SHA-256");

// Imported from origin/claude/experience-publication-versioning @ 6311f0a,
// where all four forwards and all four rollbacks exist together. Every other
// branch carrying any of these files carries the IDENTICAL blob, so there is no
// candidate to choose between. These migrations are recorded as applied in the
// hosted project's `supabase_migrations.schema_migrations`; changing a byte here
// would describe a schema the project does not have.
const APPLIED = [
  ["0022", "semantic_category_review", "bde6c0a07a082c7d8247c89563007c7658f8c4d095c2facca0d9c55772dda539",
    "0022_drop_semantic_category_review.sql", "e0e71bb96143a670b5150ba650628a9d7b8032cf7cc5495a7cc8d378d76b9792"],
  ["0023", "experience_definition_persistence", "8909540a728d72ffe4b99ad9f64cfb5d25be58f9a79252bea3cb04997360d84c",
    "0023_drop_experience_persistence.sql", "b7226d4798cc81166bb3715e5ae5ed619403d68aaffd8dfa070613e5df3be238"],
  ["0024", "experience_draft_conflict_code", "c20d821de5fd1aa598477f3e3a6afc77fbd12090e8798e47a4a49ec2084af798",
    "0024_restore_experience_draft_conflict_code.sql", "b1c40e70097164d7c8047afe1906471e075f95933054c39f5508f8355e6502ab"],
  ["0025", "experience_publication", "b7c64fad5aa216a7b851596f0028ef8f68db81d71c95c9b1aefd6dece3bee576",
    "0025_drop_experience_publication.sql", "dc1915077ddbb36268a3c14647212c9583afc41648b38dd2636dc4d6684b68f1"],
];

const APPLIED_CEILING = Math.max(...APPLIED.map(([prefix]) => Number(prefix)));

{
  for (const [prefix, slug, forwardHash, rollbackName, rollbackHash] of APPLIED) {
    const entry = parsed.find((e) => e.prefix === prefix);
    check(entry?.slug === slug, `${prefix} is ${slug}, the migration the hosted project applied (found ${entry?.slug ?? "nothing"})`);
    if (entry?.slug === slug) {
      const actual = digest(MIGRATIONS + entry.name);
      check(actual === forwardHash, `and its content is byte-identical to the applied blob (${actual.slice(0, 12)}…)`);
    }
    const hasRollback = rollbackFiles.includes(rollbackName);
    check(hasRollback, `${prefix} carries its authoritative rollback ${rollbackName}`);
    if (hasRollback) {
      const actual = digest(ROLLBACKS + rollbackName);
      check(actual === rollbackHash, `and that rollback is byte-identical to the authoritative blob (${actual.slice(0, 12)}…)`);
    }
  }
}

// ---- [3] The canonical set, discovered by slug and never by number ---------
console.log("\n[3] The canonical migrations are a contiguous run above every applied slot");

// The order is the DEPENDENCY order: the analysis model depends on the
// ingestion foundation, and the commit/rollback migration depends on both.
const CANONICAL_ORDER = [
  "canonical_ingestion_foundation",
  "canonical_analysis_model",
  "canonical_commit_and_rollback",
  // Unit 6B.3A. Durable canonical presentation drafts, in their OWN table, so a
  // canonical v4 document can never be written into the row a legacy experience
  // draft occupies. It is last because it is the only one that presupposes the
  // other three: a canonical presentation is a presentation OF canonical
  // results, and there are none until the commit migration exists.
  "canonical_presentation_draft",
];

/**
 * The migration that owns the canonical COMMIT, named rather than positioned.
 *
 * This used to be `canonical[canonical.length - 1]`, which was the same thing
 * for exactly as long as the commit migration happened to be last. Unit 6B.3A
 * appended a fourth, and "last" silently became the presentation migration — so
 * the catalogue-baseline rule below would have demanded `prepare(28)` instead
 * of `prepare(27)` and a passing gate would have started asking for the wrong
 * schema. A rule about a specific migration names that migration.
 */
const COMMIT_SLUG = "canonical_commit_and_rollback";
const canonical = parsed.filter((e) => e.slug.startsWith("canonical_"));

{
  check(
    canonical.length === CANONICAL_ORDER.length,
    `exactly ${CANONICAL_ORDER.length} canonical migrations exist (${canonical.length})`,
  );
  check(
    JSON.stringify(canonical.map((e) => e.slug)) === JSON.stringify(CANONICAL_ORDER),
    `and they appear in dependency order: ${canonical.map((e) => e.prefix).join(", ")} = ${canonical.map((e) => e.slug).join(", ")}`,
  );
  const numbers = canonical.map((e) => e.number);
  check(
    numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1),
    `their numbers are contiguous (${canonical.map((e) => e.prefix).join(", ")})`,
  );
  const reoccupied = canonical.filter((e) => e.number <= APPLIED_CEILING);
  check(
    reoccupied.length === 0,
    `no canonical migration reoccupies a number the hosted project already applied (ceiling ${String(APPLIED_CEILING).padStart(4, "0")})${
      reoccupied.length ? ` — COLLISION: ${reoccupied.map((e) => e.name).join(", ")}` : ""
    }`,
  );
}

// ---- [4] Every canonical forward keeps a rollback under its own number -----
console.log("\n[4] Each canonical migration's rollback carries the same number");

{
  for (const entry of canonical) {
    const match = rollbackFiles.find((name) => name.startsWith(`${entry.prefix}_`));
    check(match !== undefined, `${entry.prefix} has a rollback (${match ?? "MISSING"})`);
    if (match) {
      const m = NAME.exec(match);
      check(
        m?.[2] === `drop_${entry.slug}`,
        `and it reverses this migration and not another: ${match} vs ${entry.name}`,
      );
    }
  }
  const strandedCanonical = rollbackFiles.filter((name) => /^\d{4}_drop_canonical_/.test(name) && !canonical.some((e) => name.startsWith(`${e.prefix}_`)));
  check(
    strandedCanonical.length === 0,
    `no canonical rollback is stranded under a number its forward migration no longer uses${strandedCanonical.length ? `: ${strandedCanonical.join(", ")}` : ""}`,
  );
}

// ---- [5] The runners discover and apply every migration -------------------
console.log("\n[5] The disposable-PostgreSQL runner omits nothing");

{
  const psql = read("scripts/lib/canonical-psql-transport.mjs");
  const rest = read("scripts/lib/canonical-rest-transport.mjs");
  const suite = read("scripts/lib/canonical-suite.mjs");
  const stack = read("scripts/canonical-commit-local-stack.mjs");
  const last = parsed[parsed.length - 1];

  // The runner's OWN discovery regex, read out of its source and applied to the
  // real directory. A regex narrowed to exclude a file would fail here.
  const discovery = /\.filter\(\(name\) => (\/.+?\/)\.test\(name\)\)/.exec(psql);
  check(discovery !== null, "the runner's migration-discovery filter is readable from its source");
  if (discovery) {
    const body = discovery[1].slice(1, -1);
    const pattern = new RegExp(body);
    const missed = migrationFiles.filter((name) => !pattern.test(name));
    check(
      missed.length === 0,
      `the runner's own filter ${discovery[1]} selects all ${migrationFiles.length} migrations${missed.length ? ` — SKIPS ${missed.join(", ")}` : ""}`,
    );
  }

  const psqlBound = /prepare\(upTo = (\d+)\)/.exec(psql);
  check(psqlBound !== null, "the runner declares a default upper bound for `prepare`");
  if (psqlBound) {
    const upTo = Number(psqlBound[1]);
    check(
      upTo >= last.number,
      `and that bound reaches the last migration: prepare(upTo = ${upTo}) vs ${last.name}`,
    );
  }

  // THE TWO TRANSPORTS ANSWER DIFFERENT QUESTIONS, AND THIS RULE USED TO CONFLATE
  // THEM.
  //
  // It read "both numbers must track the same final migration", which was the
  // same thing only while every migration was applied everywhere. The psql
  // transport APPLIES, so its bound tracks the newest migration on disk. The
  // REST transport VERIFIES a hosted target, so its bound is a FACT about that
  // target — and the hosted project stops at the canonical COMMIT migration.
  // Unit 6B.3A's presentation migration is applied to no project by design, so
  // demanding it over REST would demand of the hosted project the one thing
  // this phase forbids. The rule now names each bound for what it is.
  const restDefault = /async prepare\(upTo = (\d+)\)/.exec(rest);
  const restGuard = /if \(upTo !== (\d+)\)/.exec(rest);
  check(restDefault !== null && restGuard !== null, "the REST transport declares a default bound and a refusal bound");
  if (restDefault && restGuard) {
    check(
      restDefault[1] === restGuard[1],
      `and they agree with each other (${restDefault[1]} / ${restGuard[1]})`,
    );
    const commitEntry = canonical.find((e) => e.slug === COMMIT_SLUG);
    check(
      commitEntry !== undefined && Number(restDefault[1]) === commitEntry.number,
      `and both name the last migration APPLIED to the hosted project — the canonical commit ` +
        `migration ${commitEntry?.prefix ?? "?"} — rather than the last one on disk (${restDefault[1]})`,
    );
    // And the transport must actively refuse a target that carries a migration
    // nobody applied, or "0029 is applied nowhere" would be a claim with no check.
    check(
      /canonical_presentation_draft/.test(rest),
      "and it refuses a hosted target that carries the unapplied presentation migration",
    );
  }

  // Every explicit `prepare(N)` in the suite must name a migration that exists.
  // The catalogue baseline in particular has to stop exactly one migration
  // short of the commit migration, or it snapshots the wrong schema.
  const explicit = [...suite.matchAll(/\bt\.prepare\((\d+)\)/g)].map((m) => Number(m[1]));
  const unknown = explicit.filter((n) => !parsed.some((e) => e.number === n));
  check(unknown.length === 0, `every explicit prepare(N) in the suite names a real migration${unknown.length ? `: ${unknown.join(", ")}` : ` (${explicit.join(", ") || "none"})`}`);
  const commitMigration = canonical.find((e) => e.slug === COMMIT_SLUG);
  check(commitMigration !== undefined, `the canonical commit migration is present by slug (${COMMIT_SLUG})`);
  if (commitMigration && explicit.length > 0) {
    check(
      explicit.every((n) => n === commitMigration.number - 1),
      `and each stops one short of ${commitMigration.name} so the catalogue baseline is the pre-commit schema (${explicit.join(", ")} vs ${commitMigration.number - 1})`,
    );
  }

  // Every `applyMigration("NNNN")` must name a migration that exists.
  const applied = [...suite.matchAll(/applyMigration\("(\d{4})"\)/g)].map((m) => m[1]);
  const unknownApply = applied.filter((prefix) => !parsed.some((e) => e.prefix === prefix));
  check(unknownApply.length === 0, `every applyMigration("NNNN") names a real migration${unknownApply.length ? `: ${unknownApply.join(", ")}` : ` (${[...new Set(applied)].join(", ") || "none"})`}`);

  // Every rollback filename referenced by the suite must exist on disk.
  const namedRollbacks = [...suite.matchAll(/"(\d{4}_[a-z0-9_]+\.sql)"/g)].map((m) => m[1]).filter((name) => /_drop_|_restore_/.test(name));
  const missingRollbacks = namedRollbacks.filter((name) => !rollbackFiles.includes(name));
  check(missingRollbacks.length === 0, `every rollback the suite names exists${missingRollbacks.length ? `: ${missingRollbacks.join(", ")}` : ` (${[...new Set(namedRollbacks)].join(", ") || "none"})`}`);

  // The local HTTP stack must not pin its own bound behind the runner's.
  const stackBound = /migrations 0000-(\d{4})/.exec(stack);
  if (stackBound) {
    check(stackBound[1] === last.prefix, `the local stack says it applies 0000-${stackBound[1]}, and the chain ends at ${last.prefix}`);
  }
  const bootstrapBound = /migrations 0000-(\d{4})/.exec(read("scripts/lib/disposable-bootstrap.sql"));
  if (bootstrapBound) {
    check(bootstrapBound[1] === last.prefix, `the disposable bootstrap says it supports 0000-${bootstrapBound[1]}, and the chain ends at ${last.prefix}`);
  }

  // Every canonical SQL path a gate reads must resolve to a file that exists.
  const gateSources = ["scripts/canonical-commit-test.mjs", "scripts/canonical-study-model-test.mjs"];
  const referenced = new Set();
  for (const source of gateSources) {
    for (const m of read(source).matchAll(/"(supabase\/(?:migrations|rollbacks)\/\d{4}_[a-z0-9_]+\.sql)"/g)) referenced.add(m[1]);
  }
  const dangling = [...referenced].filter((path) => {
    const [, dir, file] = /^supabase\/(migrations|rollbacks)\/(.+)$/.exec(path) ?? [];
    return dir === "migrations" ? !migrationFiles.includes(file) : !rollbackFiles.includes(file);
  });
  check(dangling.length === 0, `every canonical SQL path the offline gates read exists (${referenced.size} paths${dangling.length ? `, DANGLING: ${dangling.join(", ")}` : ""})`);
}

// ---- [6] The rename changed nothing a server executes ----------------------
console.log("\n[6] A migration number is never executable, and the canonical contract survives");

const FOUNDATION_TABLES = [
  "source_asset", "import_job", "import_job_asset", "visual_annotation",
  "person_private", "person_external_identifier", "study_participant",
  "membership_episode", "attribute_definition", "participant_attribute_value",
  "response_scale", "response_option", "survey_instrument", "study_domain",
  "survey_item", "survey_session", "survey_response", "source_lineage",
];
const ANALYSIS_TABLES = [
  "performance_dimension", "performance_observation", "band_scheme", "band_rule",
  "metric_definition", "metric_item_link", "journey_model", "journey_stage",
  "journey_stage_evidence_link", "organizational_unit", "culture_dimension",
  "pain_point", "pain_point_journey_stage", "pain_point_organizational_unit",
  "pain_point_performance_dimension", "pain_point_culture_dimension",
];
const COMMIT_TABLES = ["import_job_record", "retention_period"];
/** Unit 6B.3A. The draft and its append-only event log. */
const PRESENTATION_SLUG = "canonical_presentation_draft";
const PRESENTATION_TABLES = ["canonical_presentation_draft", "canonical_presentation_draft_event"];
const COMMIT_FUNCTIONS = ["record_canonical_rows", "stage_canonical_package", "commit_canonical_package", "rollback_canonical_package"];

{
  // THE INVARIANT THAT MAKES RENUMBERING SAFE. If a number ever reaches an
  // executable statement — a stored version marker, a column default, a
  // literal — a rename stops being a comment edit and starts being a schema
  // change. Every canonical file, forward and reverse, is checked.
  for (const entry of canonical) {
    const rollbackName = rollbackFiles.find((name) => name.startsWith(`${entry.prefix}_`));
    for (const [label, path] of [[entry.name, MIGRATIONS + entry.name], ...(rollbackName ? [[rollbackName, ROLLBACKS + rollbackName]] : [])]) {
      // A standalone `0NNN` token only. A SQLSTATE such as `P0002` is a five
      // character code, not a migration number, so the boundary excludes an
      // adjacent letter as well as an adjacent digit.
      const offending = executableSql(read(path)).filter((line) => /(?<![0-9A-Za-z])0\d{3}(?![0-9A-Za-z])/.test(line));
      check(
        offending.length === 0,
        `${label} carries no migration number in executable SQL${offending.length ? ` — ${offending.length} line(s), first: ${offending[0].slice(0, 70)}` : ""}`,
      );
    }
  }

  // A renamed file whose header still announces its old number is a trap for
  // the next reader, so each canonical file must declare its OWN number.
  for (const entry of canonical) {
    const header = read(MIGRATIONS + entry.name).split(/\r?\n/).slice(0, 12).join("\n");
    check(header.includes(`-- ${entry.prefix} —`), `${entry.name} declares its own number in its header banner`);
    const stale = [...header.matchAll(/\b(0\d{3})\b/g)].map((m) => m[1]).filter((n) => Number(n) < canonical[0].number);
    check(stale.length === 0, `and its header names no pre-canonical number${stale.length ? `: ${[...new Set(stale)].join(", ")}` : ""}`);
  }
  for (const entry of canonical) {
    const rollbackName = rollbackFiles.find((name) => name.startsWith(`${entry.prefix}_`));
    if (!rollbackName) continue;
    const header = read(ROLLBACKS + rollbackName).split(/\r?\n/).slice(0, 12).join("\n");
    check(header.includes(entry.name), `${rollbackName} names the exact forward migration it reverses`);
  }

  // THE OBJECT INVENTORY AND THE TRANSACTION CONTRACT. A rename must not have
  // dropped a table, a function, a grant, or the transaction that makes the
  // whole migration atomic.
  // BY SLUG, not by position. The three data migrations are what this section's
  // table inventories describe; the presentation migration is checked separately
  // below because it creates different objects and locks them down more tightly.
  const bySlug = (slug) => {
    const entry = canonical.find((e) => e.slug === slug);
    return entry ? read(MIGRATIONS + entry.name) : "";
  };
  const backBySlug = (slug) => {
    const entry = canonical.find((e) => e.slug === slug);
    if (!entry) return "";
    const name = rollbackFiles.find((r) => r.startsWith(`${entry.prefix}_`));
    return name ? read(ROLLBACKS + name) : "";
  };
  const foundation = bySlug("canonical_ingestion_foundation");
  const analysis = bySlug("canonical_analysis_model");
  const commit = bySlug(COMMIT_SLUG);
  const foundationBack = backBySlug("canonical_ingestion_foundation");
  const analysisBack = backBySlug("canonical_analysis_model");
  const commitBack = backBySlug(COMMIT_SLUG);

  check(sameMembers(createdTables(foundation), FOUNDATION_TABLES), `the ingestion migration still creates the 18 declared tables (${createdTables(foundation).length})`);
  check(sameMembers(createdTables(analysis), ANALYSIS_TABLES), `the analysis migration still creates the 16 declared tables (${createdTables(analysis).length})`);
  check(sameMembers(createdTables(commit), COMMIT_TABLES), `the commit migration still creates the 2 declared tables (${createdTables(commit).length})`);

  {
    const presentation = bySlug(PRESENTATION_SLUG);
    check(
      sameMembers(createdTables(presentation), PRESENTATION_TABLES),
      `the presentation migration still creates exactly its two tables (${createdTables(presentation).length})`,
    );
    const presentationFunctions = [...presentation.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    check(
      sameMembers(presentationFunctions, ["refuse_canonical_presentation_event_update", "save_canonical_presentation_draft"]),
      `and exactly its two functions (${presentationFunctions.join(", ") || "none"})`,
    );
    // THE SAVE FUNCTION MUST NOT BE ABLE TO NAME THE LEGACY DRAFT TABLE. This is
    // the whole coexistence guarantee reduced to something a gate can read: the
    // canonical write path addresses a different table, so there is no argument
    // by which it reaches the two hosted legacy rows.
    check(
      !/study_experience/.test(executableSql(presentation).join("\n")),
      "and its executable SQL never names a legacy experience table",
    );
    // SCOPED TO THE SAVE FUNCTION'S OWN DEFINITION, not to the file.
    //
    // This migration declares TWO functions, and a file-wide test is satisfied
    // when ANY of them is SECURITY DEFINER and ANY of them pins an empty
    // search_path — which the trigger function does. So the save function could
    // have lost either property and this would still have passed, on the
    // strength of its neighbour. The declaration block is extracted and the two
    // properties are required of THAT text.
    const saveDeclaration = /create or replace function public\.save_canonical_presentation_draft\([\s\S]*?\bas \$save\$/.exec(presentation);
    check(saveDeclaration !== null, "the save function's declaration is readable");
    if (saveDeclaration) {
      check(
        /security definer/i.test(saveDeclaration[0]),
        "its save function is SECURITY DEFINER — asserted of that function, not of the file",
      );
      check(
        /set search_path = ''/.test(saveDeclaration[0]),
        "and pins an EMPTY search_path in the same declaration",
      );
    }
    check(
      /revoke execute on function public\.save_canonical_presentation_draft\([^)]*\)\s*\n?\s*from public, anon, authenticated/i.test(presentation),
      "revoked from public, anon and authenticated",
    );
    check(
      /grant execute on function public\.save_canonical_presentation_draft\([^)]*\)\s*\n?\s*to service_role/i.test(presentation),
      "and granted to service_role and nothing else",
    );
    // SCHEMA VERSION FOUR, BY EQUALITY. A range is what let a canonical document
    // overwrite a legacy row on the other path.
    check(
      /schema_version\s+integer not null check \(schema_version = 4\)/.test(presentation),
      "the draft column admits schema version four by EQUALITY, never a range",
    );
    check(
      /pg_advisory_xact_lock/.test(presentation),
      "and the save serialises on an advisory lock, which a row-level FOR UPDATE cannot do before the row exists",
    );
  }

  const functions = [...commit.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
  check(sameMembers(functions, COMMIT_FUNCTIONS), `the commit migration still creates exactly the four canonical RPCs (${functions.length})`);
  const definer = commit.match(/language plpgsql\s*\n\s*security definer\s*\n\s*set search_path = ''/g) ?? [];
  check(definer.length === COMMIT_FUNCTIONS.length, `and all ${COMMIT_FUNCTIONS.length} remain SECURITY DEFINER with an EMPTY search_path (${definer.length})`);
  for (const fn of COMMIT_FUNCTIONS) {
    check(
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*from public, anon, authenticated`, "i").test(commit),
      `${fn} is still revoked from public, anon and authenticated`,
    );
    check(
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*to service_role`, "i").test(commit),
      `and still granted to service_role and nothing else`,
    );
  }

  for (const [label, sql] of [["ingestion", foundation], ["analysis", analysis], ["commit", commit], ["presentation", bySlug(PRESENTATION_SLUG)]]) {
    const statements = executableSql(sql);
    check(statements[0] === "begin;", `${label} still opens its transaction on the first executable statement`);
    check(statements[statements.length - 1] === "commit;", `and still closes it on the last`);
    check(!/\b(rollback|savepoint|set transaction)\b/i.test(statements.join("\n")), `and declares no other transaction control`);
  }
  for (const [label, sql] of [["ingestion", foundationBack], ["analysis", analysisBack], ["commit", commitBack], ["presentation", backBySlug(PRESENTATION_SLUG)]]) {
    const statements = executableSql(sql);
    check(statements[0] === "begin;" && statements[statements.length - 1] === "commit;", `${label}'s rollback is a single transaction too`);
  }

  check(sameMembers(droppedTables(foundationBack), FOUNDATION_TABLES), "the ingestion rollback still drops all 18 foundation tables");
  check(sameMembers(droppedTables(analysisBack), ANALYSIS_TABLES), "the analysis rollback still drops all 16 analysis tables");
  check(sameMembers(droppedTables(commitBack), COMMIT_TABLES), "the commit rollback still drops both commit tables");
  check(
    sameMembers(droppedTables(backBySlug(PRESENTATION_SLUG)), PRESENTATION_TABLES),
    "the presentation rollback still drops both draft tables",
  );

  const SHARED_LOCKDOWN = [
    [/enable row level security/i, "RLS enabled"],
    [/force row level security/i, "FORCE RLS"],
    [/create policy "deny_browser_roles"[\s\S]*?to anon, authenticated using \(false\) with check \(false\)/i, "a deny-everything policy for anon and authenticated"],
    [/revoke all privileges on table[\s\S]*?from anon, authenticated/i, "table privileges revoked from anon and authenticated"],
  ];
  // THE SERVICE-ROLE GRANT IS NOT THE SAME EVERYWHERE, AND IT SHOULD NOT BE.
  //
  // The three data migrations grant ALL privileges because their tables are
  // bulk-written by `commit_canonical_package` through the client. The
  // presentation draft has exactly one legitimate writer — its SECURITY DEFINER
  // save function — so service_role gets SELECT and nothing else. A service_role
  // that could UPDATE the draft directly could move a revision with no event,
  // no expected-revision check and no lock, which is every property this unit
  // exists to guarantee. Asserting one grant shape for both would either weaken
  // the draft table or forbid the bulk write.
  const GRANT_ALL = [/grant all privileges on table[\s\S]*?to service_role/i, "all table privileges granted to service_role"];
  const GRANT_SELECT_ONLY = [
    [/revoke all privileges on table[\s\S]*?from service_role/i, "table privileges revoked from service_role first"],
    [/grant select on table[\s\S]*?to service_role/i, "and only SELECT granted back to service_role"],
  ];
  for (const [label, sql, tables, extra] of [
    ["ingestion", foundation, FOUNDATION_TABLES, [GRANT_ALL]],
    ["analysis", analysis, ANALYSIS_TABLES, [GRANT_ALL]],
    ["commit", commit, COMMIT_TABLES, [GRANT_ALL]],
    ["presentation", bySlug(PRESENTATION_SLUG), PRESENTATION_TABLES, GRANT_SELECT_ONLY],
  ]) {
    const LOCKDOWN = [...SHARED_LOCKDOWN, ...extra];
    const loops = securityLoops(sql);
    check(loops.length === 1, `${label} locks its new tables in exactly one security block (${loops.length})`);
    if (loops.length !== 1) continue;
    const [{ tables: secured, body }] = loops;
    check(
      sameMembers(secured, tables),
      `and that block covers every table it creates${sameMembers(secured, tables) ? ` (${tables.length})` : ` — covers ${secured.length}, creates ${tables.length}`}`,
    );
    const absent = LOCKDOWN.filter(([pattern]) => !pattern.test(body)).map(([, why]) => why);
    check(absent.length === 0, `and still applies the full lockdown${absent.length ? ` — MISSING: ${absent.join("; ")}` : " (RLS, FORCE RLS, deny policy, revoke, service_role grant)"}`);
  }
}

// ---- [7] No document claims the canonical migrations were applied ----------
console.log("\n[7] The documentation does not claim an application that never happened");

{
  const DOCS = ["CLAUDE.md", "docs/CURRENT_STATE.md", "docs/CANONICAL_STUDY_MODEL.md"];
  const canonicalSlugs = canonical.map((e) => e.slug);

  // THE FACT THIS CHECK GUARDS INVERTED ON 2026-09-06, AND SO DID THE CHECK.
  //
  // Until then, 0026-0028 had never been applied anywhere, and the rule was
  // that no document may claim otherwise. They are now applied to the hosted
  // project and recorded in its ledger, so the same rule stated against the
  // same fact becomes its mirror: every governing document must SAY they are
  // applied, and none may regress to calling that work pending.
  //
  // What has NOT changed is the thing worth protecting — a document must never
  // describe a step as done that has not happened. The real-workbook import is
  // still not done, so it is guarded here in exactly the way the migration
  // application used to be.
  const NEGATOR = /\b(?:not|never|no|none|nothing|neither|nor|pending|until|unless|without|cannot)\b/i;
  const sentences = (text) =>
    text
      .split(/(?<=[.:;!?])\s+|\n\s*\n|\n\s*[-*|]\s*|\n#+\s*/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

  /** Sentences asserting the canonical chain IS applied — now required. */
  const APPLIED_SUBJECT = /\bcanonical (?:migrations?|chain)\b|\b0026\b[^.]{0,40}\b0028\b/i;
  const APPLIED_VERB = /\b(?:has|have|was|were|is|are)\s+(?:been\s+)?applied\b|\bARE APPLIED\b/i;
  const assertsApplied = (text) =>
    sentences(text).filter((s) => APPLIED_SUBJECT.test(s) && APPLIED_VERB.test(s) && !NEGATOR.test(s));

  /** Sentences claiming a real workbook has been imported — still forbidden. */
  const IMPORT_SUBJECT = /\breal (?:workbook|package)s?\b|\bCuicuilco workbooks?\b/i;
  const IMPORT_VERB = /\b(?:has|have|was|were|is|are)\s+(?:been\s+)?(?:imported|loaded|uploaded)\b/i;
  const claimsRealImport = (text) =>
    sentences(text).filter((s) => IMPORT_SUBJECT.test(s) && IMPORT_VERB.test(s) && !NEGATOR.test(s));

  // Claims the hosted work of this unit has already withdrawn. Each was true
  // when written and is false now; leaving one in place tells the next session
  // the hosted project is untouched.
  const WITHDRAWN = [
    [/hosted Supabase project has still never been contacted/i, "the hosted project HAS been contacted (inventory, diagnostics, backup, one rehearsed deletion)"],
    [/no Supabase project was contacted/i, "a Supabase project WAS contacted"],
    [/never been contacted/i, "the hosted project HAS been contacted"],
    [/\bno hosted mutation (?:has )?(?:ever )?occurred/i, "one hosted mutation DID occur — the duplicate study was deleted"],
    [/nothing was applied, deployed, uploaded or mutated/i, "a hosted mutation did occur"],
  ];

  for (const doc of DOCS) {
    const text = read(doc);

    const applied = assertsApplied(text);
    check(
      applied.length > 0,
      `${doc} records that the canonical migrations ARE applied to the hosted project${applied.length ? "" : " — it does not, and they are"}`,
    );

    const stillPending = sentences(text).filter((s) =>
      /\bhosted (?:execution|application|run)\b|\bcanonical (?:migrations?|chain)\b/i.test(s) &&
      /\b(?:is|are|remains?|stays?)\s+(?:still\s+)?(?:PENDING|pending)\b/.test(s) &&
      !/real (?:workbook|Cuicuilco)|read[- ]path|import\b/i.test(s));
    check(
      stillPending.length === 0,
      `${doc} no longer calls the hosted migration application pending${stillPending.length ? ` — "…${stillPending[0].slice(0, 90)}"` : ""}`,
    );

    const imported = claimsRealImport(text);
    check(
      imported.length === 0,
      `${doc} never claims a real workbook was imported into canonical tables${imported.length ? ` — "…${imported[0].slice(0, 90)}"` : ""}`,
    );

    for (const [pattern, why] of WITHDRAWN) {
      check(!pattern.test(text), `${doc} does not repeat a withdrawn claim (${why})`);
    }

    // The canonical migrations must be described under the numbers they now
    // hold. An OLD number may appear only where the text is recording the
    // rename itself — `0022_canonical_ingestion_foundation` → `0026` — because
    // the migration map has to be able to say where a file went. A bare stale
    // reference, with no new number beside it, is the failure.
    for (const [index, slug] of canonicalSlugs.entries()) {
      const now = canonical[index].prefix;
      const stale = [...text.matchAll(new RegExp(`\\b(\\d{4})_${slug}\\b`, "g"))]
        .filter(([, prefix]) => !canonical.some((e) => e.prefix === prefix))
        .filter((m) => !text.slice(m.index, m.index + 160).includes(now))
        .map((m) => m[1]);
      check(
        stale.length === 0,
        `${doc} names ${slug} under ${now}, or as a rename recording where it went${
          stale.length ? ` — BARE STALE: ${[...new Set(stale)].map((p) => `${p}_${slug}`).join(", ")}` : ""
        }`,
      );
    }

    // Each document must state the current map somewhere, so a reader who stops
    // at one file still learns the right numbers.
    check(
      canonical.every((e) => text.includes(e.prefix)),
      `${doc} names the current canonical numbers (${canonical.map((e) => e.prefix).join(", ")})`,
    );
  }

  // The gate itself must be in the offline chain: a rule nobody runs is not a
  // rule, and this one exists precisely because the collision was silent.
  const pkg = JSON.parse(read("package.json"));
  check(typeof pkg.scripts?.["test:migration-chain"] === "string", "the gate has its own npm script");
  check((pkg.scripts?.test ?? "").includes("test:migration-chain"), "and is registered in the offline test chain");
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log(
  "RESULT: one contiguous migration chain, no duplicate number, the applied slots\n" +
    "        pinned by content, the canonical set above them with matching rollbacks,\n" +
    "        no runner skipping a file, no migration number in executable SQL, and no\n" +
    "        document misdescribing what has and has not been applied. GATE PASSED.",
);
