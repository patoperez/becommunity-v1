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
//       RECORD that application and none may call it pending.
//
//       THE REAL WORKBOOK IMPORT INVERTED WITH IT, AND THIS SECTION WAS THE
//       LAST PLACE STILL SAYING OTHERWISE. It carried "none may claim the step
//       that has NOT happened — a real workbook imported into the canonical
//       tables" until 2026-09-08, five weeks after Unit 5 Phase 2 imported the
//       real Cuicuilco package on 2026-09-06. The rule passed only because its
//       subject pattern did not match the words the documents actually use, so
//       it was a false premise AND a check of nothing. It is replaced by the
//       four distinctions the fact actually has, which are not the same claim
//       and must not be collapsed into one:
//
//         (a) the real workbook PACKAGE was imported into the canonical tables;
//         (b) the raw workbook BYTES were not committed to git — an import is
//             not a checkout, and the source files carry respondent answers;
//         (c) importing canonical evidence CONVERTED NOTHING: the legacy
//             experience drafts were not read, rewritten or migrated by it, and
//             the hosted Cuicuilco legacy draft is still schema version 2
//             revision 72;
//         (d) the canonical presentation draft is a SEPARATE schema-version-4
//             row in a table migration 0029 created — not that legacy row
//             converted, and not a second row beside it in the legacy table.
//
// It contacts nothing — no network, no database, no hosted project. It reads
// files, and asks the local git index which of them are committed.
// =============================================================================

import { execFileSync } from "node:child_process";
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
  // Unit 6B.4A. The canonical publication lifecycle: an immutable snapshot, a
  // current-publication pointer and an append-only log, in tables of their own.
  // Last because it presupposes every one above it — a canonical publication is
  // a publication OF a canonical presentation draft, which is a presentation OF
  // canonical results — and because `scripts/canonical-publication-audit.mjs`
  // proved, against a real PostgreSQL, that the legacy publication model cannot
  // carry it.
  "canonical_publication",
  // Unit 6B.4B2. The qualitative sign-off: a person recording that they read
  // one EXACT set of category labels, digested, plus the link from an
  // immutable publication to the review state it was made under. Last because
  // it presupposes every one above it — the link table's primary key is a
  // publication snapshot's id — and additive to all of them: it replaces no
  // function, alters no table and drops nothing. In particular
  // `publish_canonical_presentation` stays byte-identical applied history;
  // 0031 wraps it rather than rewriting it.
  "canonical_qualitative_signoff",
  // Unit 6B.4B2C. The journey pain review: a person's decisions about which
  // curated phrases this study publishes, in what public wording, at which
  // canonical touchpoints. Last because it presupposes the presentation draft
  // it configures and the publication it unblocks, and additive to all of them:
  // it creates one table and three functions, alters no existing table and — in
  // particular — never touches `pain_point`, which it identifies only by an
  // opaque derived token and never by a foreign key.
  "canonical_journey_pain_review",
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

/**
 * The last migration APPLIED to the hosted project, named rather than derived.
 *
 * It is deliberately its own constant and not `canonical[canonical.length - 1]`
 * nor `COMMIT_SLUG`. Deriving it from the file list would make the next
 * migration written — and not yet applied — silently redefine "what the hosted
 * project has", which is exactly the failure the note above records for the
 * commit migration. It moved from `canonical_commit_and_rollback` to
 * `canonical_presentation_draft` on 2026-09-08, when Unit 6B.3B applied 0029,
 * and to `canonical_publication` on 2026-09-09, when Unit 6B.4B1 applied 0030.
 * It must be moved BY HAND again, after a migration is applied there.
 */
const HOSTED_APPLIED_SLUG = "canonical_publication";
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
  // target. The rule names each bound for what it is, and keeps naming them
  // separately even when the two numbers agree.
  //
  // THEY AGREE AGAIN AS OF UNIT 6B.4B1, AND THAT IS A COINCIDENCE OF THIS
  // MOMENT. The hosted project stopped at the canonical COMMIT migration for as
  // long as 0029 was applied to no project; 6B.3B applied it on 2026-09-08 and
  // 6B.4B1 applied 0030 on 2026-09-09, so the hosted bound moved twice. The next
  // migration written and not yet applied will separate them again, and this
  // rule must not be rewritten back into "the last file on disk" when it does.
  const restDefault = /async prepare\(upTo = (\d+)\)/.exec(rest);
  const restGuard = /if \(upTo !== (\d+)\)/.exec(rest);
  check(restDefault !== null && restGuard !== null, "the REST transport declares a default bound and a refusal bound");
  if (restDefault && restGuard) {
    check(
      restDefault[1] === restGuard[1],
      `and they agree with each other (${restDefault[1]} / ${restGuard[1]})`,
    );
    const draftEntry = canonical.find((e) => e.slug === HOSTED_APPLIED_SLUG);
    check(
      draftEntry !== undefined && Number(restDefault[1]) === draftEntry.number,
      `and both name the last migration APPLIED to the hosted project — ` +
        `${draftEntry?.prefix ?? "?"} ${HOSTED_APPLIED_SLUG} — which is a fact about the project, ` +
        `not a restatement of the last file on disk (${restDefault[1]})`,
    );
    // And the transport must actively check for each applied migration's own
    // table, or "0029 and 0030 are applied to the hosted project" would be two
    // claims with no check. Both assertions used to require the opposite and
    // were INVERTED rather than deleted: a target that has lost the storage is
    // as much a finding as one that gained it unexpectedly.
    check(
      /canonical_presentation_draft/.test(rest),
      "and it refuses a hosted target that has lost the presentation migration's storage",
    );
    check(
      /canonical_presentation_revision/.test(rest),
      "and one that has lost the publication migration's storage",
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
/** Unit 6B.4A. The immutable snapshot, the current pointer and the lifecycle log. */
const PUBLICATION_SLUG = "canonical_publication";
const PUBLICATION_TABLES = [
  "canonical_presentation_revision",
  "canonical_presentation_publication",
  "canonical_presentation_publication_event",
];
const PUBLICATION_FUNCTIONS = [
  "refuse_canonical_publication_change",
  "publish_canonical_presentation",
  "restore_canonical_presentation",
  "read_canonical_publication",
];
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

  {
    // UNIT 6B.4A — THE PUBLICATION MIGRATION, held to the draft migration's
    // standard and to four rules that one did not need.
    const publication = bySlug(PUBLICATION_SLUG);
    check(
      sameMembers(createdTables(publication), PUBLICATION_TABLES),
      `the publication migration still creates exactly its three tables (${createdTables(publication).length})`,
    );
    const publicationFunctions = [...publication.matchAll(/create or replace function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    check(
      sameMembers(publicationFunctions, PUBLICATION_FUNCTIONS),
      `and exactly its four functions (${publicationFunctions.join(", ") || "none"})`,
    );
    // THE COEXISTENCE GUARANTEE, REDUCED TO SOMETHING A GATE CAN READ. The
    // canonical publication path addresses different tables from the legacy one,
    // so there is no argument by which it reaches the two hosted legacy rows,
    // the legacy revision table or the legacy publication pointer.
    check(
      !/study_experience/.test(executableSql(publication).join(" ")),
      "and its executable SQL never names a legacy experience object",
    );
    // SCOPED TO EACH FUNCTION'S OWN DECLARATION, never to the file: this
    // migration declares four, and a file-wide test is satisfied when ANY of
    // them is SECURITY DEFINER — which the trigger function deliberately is not,
    // and which the other three must each be on their own account.
    for (const [name, terminator] of [
      ["publish_canonical_presentation", "publish"],
      ["restore_canonical_presentation", "restore"],
      ["read_canonical_publication", "read"],
    ]) {
      const declaration = new RegExp(
        "create or replace function public\\." + name + "\\([\\s\\S]*?\\bas \\$" + terminator + "\\$",
      ).exec(publication);
      check(declaration !== null, `${name}'s declaration is readable`);
      if (!declaration) continue;
      check(
        /security definer/i.test(declaration[0]),
        `${name} is SECURITY DEFINER — asserted of that function, not of the file`,
      );
      check(
        /set search_path = ''/.test(declaration[0]),
        `and ${name} pins an EMPTY search_path in the same declaration`,
      );
      check(
        new RegExp("revoke execute on function public\\." + name + "\\([^)]*\\)\\s*from public, anon, authenticated", "i").test(publication),
        `${name} is revoked from public, anon and authenticated`,
      );
      check(
        new RegExp("grant execute on function public\\." + name + "\\([^)]*\\)\\s*to service_role", "i").test(publication),
        `and ${name} is granted to service_role and nothing else`,
      );
    }
    // SCHEMA VERSION FOUR BY EQUALITY, and a family discriminator beside it.
    // The audit's finding B is that the legacy revision table has neither.
    check(
      /schema_version\s+integer not null check \(schema_version = 4\)/.test(publication),
      "the snapshot column admits schema version four by EQUALITY, never a range",
    );
    check(
      /document_kind\s+text not null check \(document_kind = 'canonical_presentation'\)/.test(publication),
      "and carries a family discriminator, which the legacy revision table has no column for",
    );
    // THE REPRODUCIBILITY HALF. A publication storing only configuration would
    // recompute its numbers from mutable current data — the audit's finding I.
    check(
      /render_model\s+jsonb not null/.test(publication) && /render_model_sha256\s+text not null/.test(publication),
      "a snapshot stores the RESOLVED render model and a digest over it",
    );
    // THE IDENTITY HALF, in separate columns, so drift can be ATTRIBUTED rather
    // than merely detected — the audit's finding D.
    for (const column of [
      "binding_fingerprint", "registry_version", "results_contract_version",
      "calculation_version", "spec_id", "mapping_version",
      "package_idempotency_key", "plan_fingerprint", "source_draft_revision",
    ]) {
      check(
        new RegExp("^  " + column + "\\s", "m").test(publication),
        "and pins " + column + " in its own column",
      );
    }
    // DELETE IS REFUSED TOO, CONDITIONALLY — the audit's finding E. An
    // unconditional refusal would make a study undeletable, which is why the
    // condition is part of the rule rather than a weakening of it.
    check(
      /before update or delete on public\.canonical_presentation_revision/.test(publication),
      "the immutability trigger covers DELETE as well as UPDATE",
    );
    check(
      /if exists \(select 1 from public\.study where id = old\.study_id\)/.test(publication),
      "and refuses a delete only while the study still exists, so a cascade still works",
    );
    check(
      /pg_advisory_xact_lock/.test(publication),
      "and publication serialises on the same advisory lock the draft save takes",
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

  for (const [label, sql] of [["ingestion", foundation], ["analysis", analysis], ["commit", commit], ["presentation", bySlug(PRESENTATION_SLUG)], ["publication", bySlug(PUBLICATION_SLUG)]]) {
    const statements = executableSql(sql);
    check(statements[0] === "begin;", `${label} still opens its transaction on the first executable statement`);
    check(statements[statements.length - 1] === "commit;", `and still closes it on the last`);
    check(!/\b(rollback|savepoint|set transaction)\b/i.test(statements.join("\n")), `and declares no other transaction control`);
  }
  for (const [label, sql] of [["ingestion", foundationBack], ["analysis", analysisBack], ["commit", commitBack], ["presentation", backBySlug(PRESENTATION_SLUG)], ["publication", backBySlug(PUBLICATION_SLUG)]]) {
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
  check(
    sameMembers(droppedTables(backBySlug(PUBLICATION_SLUG)), PUBLICATION_TABLES),
    "and the publication rollback drops all three publication tables",
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
    // The publication tables get the SAME strict grant as the draft, and for the
    // same reason: their only legitimate writer is a SECURITY DEFINER function.
    // A service_role able to UPDATE the pointer directly could change what a
    // client is served with no event, no expected-version check and no lock.
    ["publication", bySlug(PUBLICATION_SLUG), PUBLICATION_TABLES, GRANT_SELECT_ONLY],
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
  // describe a step as done that has not happened, and must never describe a
  // step as undone that HAS. The second half is what this section forgot: it
  // went on guarding "no real workbook has been imported" for five weeks after
  // Unit 5 Phase 2 imported one. See the four distinctions in the file header.
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

  /**
   * Sentences asserting the PRESENTATION migration is applied — now required.
   *
   * A second, separate requirement rather than a widening of the one above,
   * because the two facts became true on different days and a document that
   * records only the older one is out of date in a way the older rule cannot
   * see: `0026`-`0028` were applied on 2026-09-06 and `0029` on 2026-09-08.
   */
  const PRESENTATION_APPLIED_SUBJECT =
    /\b0029\b|\bcanonical_presentation_draft\b|\bpresentation migration\b|\bcanonical presentation draft\b/i;
  const assertsPresentationApplied = (text) =>
    sentences(text).filter(
      (s) => PRESENTATION_APPLIED_SUBJECT.test(s) && APPLIED_VERB.test(s) && !NEGATOR.test(s),
    );

  /**
   * Sentences asserting the PUBLICATION migration is applied — now required.
   *
   * A third separate requirement for the same reason the second one exists: the
   * three facts became true on three different days — `0026`-`0028` on
   * 2026-09-06, `0029` on 2026-09-08 and `0030` on 2026-09-09 — and a document
   * recording only the older ones is out of date in a way the older rules
   * cannot see.
   *
   * `\b0030\b` DOES NOT MATCH `0030_canonical_publication.sql`, because `_` is a
   * word character and there is therefore no boundary after the digits. Every
   * document names the migration by its filename at least once, so the
   * lookaround form is used, exactly as it is for the presentation migration.
   */
  const PUBLICATION_APPLIED_SUBJECT =
    /(?<![0-9])0030(?![0-9])|\bcanonical_publication\b|\bpublication migration\b|\bcanonical publication storage\b/i;
  const assertsPublicationApplied = (text) =>
    sentences(text).filter(
      (s) => PUBLICATION_APPLIED_SUBJECT.test(s) && APPLIED_VERB.test(s) && !NEGATOR.test(s),
    );

  /**
   * And that NOTHING WAS PUBLISHED — required in the same breath.
   *
   * Applying the storage and using it are different acts, and a document that
   * records the first without the second invites the next reader to assume a
   * client is being served something. Unit 6B.4B1 applied the migration and
   * published nothing; every governing document has to say so.
   */
  const assertsNothingPublished = (text) =>
    sentences(text).filter(
      (s) =>
        /\bpublicat(?:ion|ions)\b|\bpublished\b|\bexperience\b/i.test(s) &&
        /\bno (?:canonical )?(?:experience|publication|presentation)[^.]{0,40}\b(?:was|were|has been|have been) published\b|\bnothing (?:was|has been) published\b|\bpublication tables? (?:remain|remains|are|is) empty\b|\bno experience was published\b/i.test(s),
    );

  /**
   * (a) Sentences RECORDING the real workbook import — now required.
   *
   * The subject deliberately tolerates a word between "real" and the noun,
   * because every document writes "the real Cuicuilco package" and the previous
   * pattern demanded them adjacent. That gap is why the obsolete rule this
   * replaces passed: it was a false premise that also matched nothing, and the
   * second failure hid the first.
   */
  const IMPORT_SUBJECT =
    /\breal\b[^.]{0,40}\b(?:workbook|package)s?\b|\bCuicuilco (?:workbook|package)s?\b/i;
  const IMPORT_VERB = /\b(?:has|have|was|were|is|are)\s+(?:been\s+)?imported\b/i;
  const assertsRealImport = (text) =>
    sentences(text).filter((s) => IMPORT_SUBJECT.test(s) && IMPORT_VERB.test(s) && !NEGATOR.test(s));

  /**
   * (c) Sentences recording that the import left the legacy drafts alone.
   *
   * `NEGATOR` is deliberately NOT applied here. The claim worth requiring IS a
   * negative — "no legacy draft was touched" — so filtering negated sentences
   * out would reject exactly the sentence being asked for.
   */
  const LEGACY_SUBJECT = /\blegacy (?:experience )?drafts?\b|\bstudy_experience_draft\b/i;
  const LEGACY_INTACT =
    /\b(?:byte-identical|unchanged|untouched|not touched|never touched|is not read|not migrated|not converted|not overwritten|structurally unreachable)\b/i;
  const assertsLegacyIntact = (text) =>
    sentences(text).filter((s) => LEGACY_SUBJECT.test(s) && LEGACY_INTACT.test(s));

  /**
   * (c continued) The hosted Cuicuilco legacy draft, at the version and
   * revision it has held throughout.
   *
   * A sentence about a PLANTED row does not count. `0029`'s own audit planted a
   * legacy row at revision 72 on a disposable database and then watched the
   * legacy RPC move it to 73 — so "revision 72" appears in these documents
   * describing a row that was deliberately destroyed to prove a point. Letting
   * that satisfy this check would be the same defect in a new place: a check
   * passing on the strength of a sentence about something else.
   */
  const PLANTED = /\b(?:planted|disposable|throwaway|synthetic|stand-in)\b/i;
  const assertsCuicuilcoLegacyRevision = (text) =>
    sentences(text).filter(
      (s) =>
        /\bCuicuilco\b/i.test(s) &&
        /\brevision 72\b|\bv2\/72\b/i.test(s) &&
        /\bversion 2\b|\bv2\b|\bschema_version 2\b/i.test(s) &&
        !PLANTED.test(s),
    );

  /**
   * (d) The canonical presentation draft is a SEPARATE row of its own family.
   *
   * Two requirements rather than one sentence, because no document states both
   * halves in one breath and forcing them together would only teach the next
   * author to write a sentence for the gate: `0029` creates a separate table,
   * and what that table holds is a schema-version-four draft.
   */
  // `\b0029\b` DOES NOT MATCH `0029_canonical_presentation_draft.sql`, because
  // `_` is a word character and there is therefore no boundary after the digits.
  // Every document names the migration by its filename at least once, so a
  // pattern that cannot see the filename form is a pattern that reads half the
  // evidence — which is how the rule this section replaces came to check
  // nothing at all.
  const PRESENTATION_MIGRATION =
    /(?<![0-9])0029(?![0-9])|canonical_presentation_draft|canonical presentation draft/i;

  const assertsSeparateDraftTable = (text) =>
    sentences(text).filter((s) => PRESENTATION_MIGRATION.test(s) && /\bseparate\b/i.test(s));
  const assertsDraftIsVersionFour = (text) =>
    sentences(text).filter(
      (s) =>
        (PRESENTATION_MIGRATION.test(s) || /\bpresentation documents?\b/i.test(s)) &&
        /\bv4\b|\bversion 4\b|\bversion four\b|\bschema_?[Vv]ersion:? ?4\b|\bschema version 4\b|\badmits \*\*4 by equality\*\*/i.test(s),
    );

  /**
   * (c) A claim that a legacy draft WAS converted — forbidden, and checked per
   * sentence rather than over the whole document.
   *
   * It lives here instead of in `WITHDRAWN` because `WITHDRAWN` matches raw
   * text, and the sentence this must not fire on is
   * "…no legacy draft was converted, no formula moved…" — a true statement
   * whose negation a whole-document regex cannot see. Put in that list it
   * failed the very document that says the right thing.
   */
  const claimsLegacyConverted = (text) =>
    sentences(text).filter(
      (s) =>
        /\blegacy (?:experience )?drafts?\b[^.]{0,60}\b(?:was|were|has been|have been) (?:converted|migrated|rewritten|overwritten)\b/i.test(s) &&
        !NEGATOR.test(s),
    );

  // Claims the hosted work of this unit has already withdrawn. Each was true
  // when written and is false now; leaving one in place tells the next session
  // the hosted project is untouched.
  const WITHDRAWN = [
    [/hosted Supabase project has still never been contacted/i, "the hosted project HAS been contacted (inventory, diagnostics, backup, one rehearsed deletion)"],
    [/no Supabase project was contacted/i, "a Supabase project WAS contacted"],
    [/never been contacted/i, "the hosted project HAS been contacted"],
    [/\bno hosted mutation (?:has )?(?:ever )?occurred/i, "one hosted mutation DID occur — the duplicate study was deleted"],
    [/nothing was applied, deployed, uploaded or mutated/i, "a hosted mutation did occur"],
    // Withdrawn by Unit 6B.3B on 2026-09-08. Each was true while 0029 existed
    // only in git; leaving one in place tells the next session that the hosted
    // project has no canonical draft storage, which is the single fact this
    // unit changed.
    [/\b0029\b[^.]{0,120}\bapplied to no project\b/i, "0029 IS applied to the hosted project (2026-09-08)"],
    [/\bpresentation migration is applied to no project\b/i, "the presentation migration IS applied"],
    [/\bapplied to no project by design\b/i, "0029 was applied deliberately on 2026-09-08"],
    [/\bcanonical_presentation_draft\b[^.]{0,60}\bdoes not exist (?:there|on the hosted)/i,
      "canonical_presentation_draft EXISTS on the hosted project"],
    [/\bno study has a canonical (?:presentation )?draft\b/i, "Cuicuilco has one, at revision 1"],
    // Withdrawn by Unit 6B.4B1 on 2026-09-09. Each was true while 0030 existed
    // only in git; leaving one in place tells the next session the hosted
    // project has no canonical publication storage, which is the single fact
    // this unit changed.
    //
    // THESE ARE DELIBERATELY NARROW, and the first draft of them was not. It
    // also carried `/carried by no database/`, `/are ABSENT .. hosted/` and
    // `/no migration was applied to hosted infrastructure/`, which failed three
    // documents for RECORDING what a previous unit correctly did — including
    // 0029's own superseded heading, which has read "carried by no database yet"
    // beside a supersession note since 2026-09-08. A rule that forbids this
    // repository's own way of keeping history is a rule that teaches people to
    // delete the history. What must not survive is a present-tense claim, and
    // that is what these match.
    //
    // NOTHING HERE WITHDRAWS "nothing has been published" — that is still true,
    // it is REQUIRED above, and it must never be confused with "the storage does
    // not exist".
    [/(?<![0-9])0030(?![0-9])[^.]{0,120}\bapplied to no project\b/i,
      "0030 IS applied to the hosted project (2026-09-09)"],
    [/\bpublication migration is applied to no project\b/i, "the publication migration IS applied"],
    [/\bcanonical_presentation_revision\b[^.]{0,60}\bdoes not exist (?:there|on the hosted)/i,
      "canonical_presentation_revision EXISTS on the hosted project"],
    // Withdrawn on 2026-09-06 by Unit 5 Phase 2, and guarded here only from
    // 2026-09-08 — this section spent five weeks asserting the opposite.
    //
    // EVERY PATTERN SAYS "imported", NEVER "uploaded" OR "supplied", and that is
    // deliberate. `docs/CANONICAL_STUDY_MODEL.md` truthfully records that the
    // synthetic acceptance run had "no real workbook uploaded", and both parity
    // gates truthfully record runs where the real workbooks were "deliberately
    // not supplied". Those sentences are about a FILE reaching a run; these
    // patterns are about a PACKAGE reaching the canonical tables, which did
    // happen. Widening these to the other verbs would fail three true sentences.
    [/\bno real\b[^.]{0,40}\b(?:workbook|package)s?\b[^.]{0,40}\b(?:was|were|has been|have been) imported\b/i,
      "the real Cuicuilco package WAS imported into the canonical tables (2026-09-06)"],
    [/\breal[- ](?:workbook|package) import (?:is|remains) (?:still )?(?:not done|pending|outstanding)\b/i,
      "the real-workbook import is DONE"],
    [/\bthe real workbooks?\b[^.]{0,30}\b(?:was|were) not imported\b/i,
      "they were imported on 2026-09-06"],
    [/\bnothing (?:real )?(?:has been|was) imported into the canonical tables\b/i,
      "8 588 rows across 32 families were"],
  ];

  for (const doc of DOCS) {
    const text = read(doc);

    const applied = assertsApplied(text);
    check(
      applied.length > 0,
      `${doc} records that the canonical migrations ARE applied to the hosted project${applied.length ? "" : " — it does not, and they are"}`,
    );

    const presentationApplied = assertsPresentationApplied(text);
    check(
      presentationApplied.length > 0,
      `${doc} records that the PRESENTATION migration is applied too${presentationApplied.length ? "" : " — it does not, and it is, since 2026-09-08"}`,
    );

    const publicationApplied = assertsPublicationApplied(text);
    check(
      publicationApplied.length > 0,
      `${doc} records that the PUBLICATION migration is applied too${publicationApplied.length ? "" : " — it does not, and it is, since 2026-09-09"}`,
    );

    const nothingPublished = assertsNothingPublished(text);
    check(
      nothingPublished.length > 0,
      `${doc} records that applying it published NOTHING` +
        `${nothingPublished.length ? "" : " — it does not, and a reader could take applied storage for a served experience"}`,
    );

    const stillPending = sentences(text).filter((s) =>
      /\bhosted (?:execution|application|run)\b|\bcanonical (?:migrations?|chain)\b/i.test(s) &&
      /\b(?:is|are|remains?|stays?)\s+(?:still\s+)?(?:PENDING|pending)\b/.test(s) &&
      !/real (?:workbook|Cuicuilco)|read[- ]path|import\b/i.test(s));
    check(
      stillPending.length === 0,
      `${doc} no longer calls the hosted migration application pending${stillPending.length ? ` — "…${stillPending[0].slice(0, 90)}"` : ""}`,
    );

    const imported = assertsRealImport(text);
    check(
      imported.length > 0,
      `${doc} records that the real workbook package WAS imported into the canonical tables` +
        `${imported.length ? "" : " — it does not, and it was, on 2026-09-06"}`,
    );

    const legacyIntact = assertsLegacyIntact(text);
    check(
      legacyIntact.length > 0,
      `${doc} records that the import converted no legacy experience draft` +
        `${legacyIntact.length ? "" : " — it does not, and an import that silently rewrote one is the failure this whole line of work exists to prevent"}`,
    );

    const legacyRevision = assertsCuicuilcoLegacyRevision(text);
    check(
      legacyRevision.length > 0,
      `${doc} records the hosted Cuicuilco legacy draft at schema version 2 revision 72, ` +
        `in a sentence that is not about a planted or disposable row` +
        `${legacyRevision.length ? "" : " — it does not"}`,
    );

    const separateTable = assertsSeparateDraftTable(text);
    check(
      separateTable.length > 0,
      `${doc} records that 0029's storage is SEPARATE from the legacy draft table` +
        `${separateTable.length ? "" : " — it does not, and a reader could take the canonical draft for a converted legacy row"}`,
    );

    const versionFour = assertsDraftIsVersionFour(text);
    check(
      versionFour.length > 0,
      `${doc} records that what that table holds is a schema-version-FOUR draft` +
        `${versionFour.length ? "" : " — it does not"}`,
    );

    const converted = claimsLegacyConverted(text);
    check(
      converted.length === 0,
      `${doc} never claims a legacy experience draft was converted or overwritten` +
        `${converted.length ? ` — "…${converted[0].slice(0, 90)}"` : ""}`,
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

  // ---- (b) the workbook was IMPORTED, and that is not a checkout -----------
  //
  // The two facts are easy to slide together and must not be. A package
  // reaching the canonical tables of one hosted project is not the same event
  // as its source bytes entering a git history that every clone carries
  // forever — and those bytes are 60 people's answers.
  //
  // THE FILE LIST COMES FROM GIT, NOT FROM A DIRECTORY WALK. A walk would
  // answer "is a workbook sitting in this folder", which is a different and
  // much weaker question: the real workbooks DO sit beside the main checkout,
  // untracked, and a gate that failed on that would be crying about the correct
  // state of the world. `git ls-files` answers the question actually asked —
  // what is committed. It is a local read of the repository's own index; this
  // gate still contacts no network and no database.
  // A missing git is a FAILED CHECK, not an uncaught exception. This gate is in
  // the mandatory offline chain, and a stack trace where a verdict belongs
  // reads like a broken harness rather than an unanswered question.
  let tracked = null;
  try {
    tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    tracked = null;
  }
  check(
    tracked !== null && tracked.length > 0,
    "the committed file list is readable, so what is in git can be checked at all" +
      `${tracked === null ? " — git did not answer, and this check cannot be skipped quietly" : ""}`,
  );
  tracked = tracked ?? [];

  const spreadsheets = tracked.filter((p) => /\.(?:xlsx|xlsm|xls)$/i.test(p));
  check(
    spreadsheets.length === 0,
    `no spreadsheet is committed to this repository (${tracked.length} tracked files scanned)` +
      `${spreadsheets.length ? ` — TRACKED: ${spreadsheets.slice(0, 3).join(", ")}` : ""}`,
  );

  // And by CONTENT, not only by extension, because a rename is not a redaction.
  // The two digests are the ones `docs/CURRENT_STATE.md` pins for the imported
  // package's source assets; the doc is checked to still pin them, so neither
  // side can drift into agreeing with itself.
  const REAL_WORKBOOK_SHA256 = {
    clean_study_data: "8d7afdb479208d47e4cd2b08fac5d480f3f945edcf448f52eb588a41e167bca5",
    curated_pain_map: "bd0e70d7fbb73a6834c8e4cfd5ad768ea6c3db6ffcf0682179fe58fcc3fbc890",
  };
  const stateDoc = read("docs/CURRENT_STATE.md");
  for (const [role, digest] of Object.entries(REAL_WORKBOOK_SHA256)) {
    check(
      stateDoc.includes(digest),
      `docs/CURRENT_STATE.md still pins the ${role} source digest this check compares against`,
    );
  }
  const byContent = tracked.filter((path) => {
    let bytes;
    try {
      bytes = readBytes(path);
    } catch {
      return false; // a tracked path that is not a readable file here is not a workbook
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    return Object.values(REAL_WORKBOOK_SHA256).includes(digest);
  });
  check(
    byContent.length === 0,
    `and no committed file carries the real workbook bytes under any name` +
      `${byContent.length ? ` — TRACKED: ${byContent.join(", ")}` : ""}`,
  );

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
