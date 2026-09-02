# Canonical study model

## Purpose

The current ingestion model remains available for existing studies. Migrations
`0022`, `0023` and `0024` add the normalized layer required to preserve the full
meaning of multi-workbook studies without treating every worksheet row as an
unrelated respondent or flattening source distinctions into dashboard keys, plus
the transactional commit and rollback that writes it.

This layer is designed around four rules:

1. A person is a stable private identity; participation is the person's role in
   one study and one cohort.
2. A source value keeps its state. Missing, unknown, not applicable, source
   unavailable and not participated are not numeric zero.
3. Workbook formatting is evidence with a contextual interpretation. A color is
   not assigned one global meaning.
4. Every derived metric, journey link and curated finding can be traced back to
   the source package that produced it.

## Migration 0022: ingestion foundation

`0022_canonical_ingestion_foundation.sql` adds:

- source package identity and idempotency: `source_asset`, `import_job`,
  `import_job_asset`;
- contextual workbook evidence: `visual_annotation`;
- stable private identity and study participation: `person_private`,
  `person_external_identifier`, `study_participant`, `membership_episode`;
- typed profile data: `attribute_definition`, `participant_attribute_value`;
- instruments and answers: `response_scale`, `response_option`,
  `survey_instrument`, `study_domain`, `survey_item`, `survey_session`,
  `survey_response`;
- cell-to-record provenance: `source_lineage`.

`study_participant.legacy_respondent_id` is a compatibility bridge. Its foreign
key includes respondent, tenant and study, so it cannot cross a data boundary.

## Migration 0023: analysis model

`0023_canonical_analysis_model.sql` adds:

- monthly performance observations and explicit band schemes;
- versioned metric definitions linked to their real survey or performance
  evidence;
- multiple journey models per study, ordered stages and explicit evidence links;
- organizational and culture dimensions;
- reviewed pain points linked through real foreign keys to journey stages,
  organizational units, performance dimensions and culture dimensions;
- dates and a series key on the existing aggregate `study_period_snapshot`, so
  historical retention remains distinct from the 2025–2026 performance cycle.

The model does not encode color thresholds as universal constants. A band scheme
owns its rules. For the Cuicuilco performance source, the importer will seed the
confirmed ranges gray 0–29, red 30–49, yellow 50–69 and green 70–100.

## Security boundary

All 36 new tables — 18 in `0022`, 16 in `0023` and 2 in `0024` — are
internal-only:

- RLS is enabled and forced;
- `anon` and `authenticated` have an explicit deny policy and no table
  privileges;
- only `service_role` receives table privileges.

Nothing in these migrations publishes raw names, attributes, observations or
responses to client-facing routes. Publication must continue through reviewed,
authorized aggregate surfaces.

## Compatibility and rollout

These migrations are additive. They do not rewrite existing respondents,
responses, dashboards, studies or journeys. The existing application continues
to use its current model until a later import adapter and read-path migration are
implemented and verified.

Rollout order:

1. apply `0022_canonical_ingestion_foundation.sql` in staging;
2. apply `0023_canonical_analysis_model.sql` in staging;
3. apply `0024_canonical_commit_and_rollback.sql` in staging;
4. execute the focused structural gates and database/RLS smoke tests;
5. execute `npm run test:canonical-commit-live` against a disposable database;
6. import the two Cuicuilco workbooks into a disposable study;
7. reconcile counts, source lineage, metric bands, journeys and findings against
   the approved mapping workbook before any production promotion.

Reverse order:

1. `0024_drop_canonical_commit_and_rollback.sql`;
2. `0023_drop_canonical_analysis_model.sql`;
3. `0022_drop_canonical_ingestion_foundation.sql`.

`0024`'s reverse script drops the ownership ledger, so a package that is still
committed must be reversed through `rollback_canonical_package` FIRST. Dropping
the ledger while rows are owned would leave canonical rows nothing can identify,
so the script REFUSES to run in that state and says which packages are holding
it — it does not quietly orphan them. That refusal is executed by the database
gate (X7).

## Unit 2 — package parser and preflight (source only)

`src/lib/ingestion/canonical-package/` parses and validates a multi-file
package. **It parses and validates only. Nothing is committed to the canonical
tables.** The module contains no Supabase client, no insert and no RPC, and
`npm run test:canonical-package` fails if one ever appears in it.

### The multi-sheet reader

`readXlsxWorkbook()` joins `readXlsx()` in `src/lib/ingestion/xlsx-reader.ts`.
The two have different contracts and must not be conflated:

| | `readXlsx` (legacy) | `readXlsxWorkbook` (canonical) |
|---|---|---|
| scope | first worksheet | every worksheet |
| shape | header row + trimmed rows | physical coordinates, no header assumed |
| names | not exposed | exact source spelling, trailing space included |
| formulas | cached value only | formula text and cached value kept apart |
| style | ignored | style index, explicit RGB, theme fill, merged ranges |

Both use only JSZip and string parsing, so both stay evaluable on workerd, and
ExcelJS remains unreachable from `src/`. `readXlsx` and `parseXlsx` behave
exactly as before; `test:xlsx-hardening`, `test:workers-ingestion` and the new
gate's legacy section all pin that.

Four reader corrections matter for meaning, not tidiness:

1. **A cached value is now distinguishable from no value at all.**
   `WorkbookCell.cachedValue` is `null` when the cell stored nothing. On a
   formula cell that is the difference between "the spreadsheet computed 0" and
   "nobody ever evaluated this"; reading them as the same thing turns an
   unopened workbook into a column of zeros.
2. **A theme fill is recorded** (`fillTheme`) instead of being read as "no
   fill". Both source workbooks use theme fills alongside explicit RGB ones, so
   dropping them under-reports what a human marked.
3. **A worksheet with no readable relationship is no longer skipped.** It falls
   back to its ordinal part and, failing that, is refused BY NAME — silently
   dropping it would report "the sheet is missing" for a file that has it.
4. **Namespace prefixes are honoured on every part independently.** A
   relationships document is its own part with its own declarations, so
   `<rel:Relationship>` is as valid as `<Relationship>` and neither implies
   anything about how the workbook part is written. Matching only the
   unprefixed element produced an EMPTY relationship map rather than an error,
   so every sheet fell through to its ordinal part — correct for a workbook
   whose sheets happen to be in part order, and silently wrong for one that is
   not. Element prefixes now use a single NCName pattern (`_`, `.` and `-`
   included; a leading digit excluded), and the relationship id, `Id`, `Target`,
   `name` and `state` attributes are matched by LOCAL name. That last point is
   what keeps `sheetId` — an unrelated internal number on the same element as
   `r:id` — from ever being read as a relationship.

A workbook-wide cell counter and a sheet ceiling join the existing expansion
ceilings. Every refusal is a Spanish sentence and is reached before any database
operation, because there is no database operation in this unit at all.

### The package contract

The specification is versioned configuration (`spec.ts`), not code. Cuicuilco v1
requires exactly two semantic roles — `clean_study_data` (11 worksheets) and
`curated_pain_map` (5 worksheets) — and **resolves them by structural signature,
never by file name**. Worksheet names are matched after whitespace
normalisation only; case and accents are not folded, and a near miss is named in
the error instead of being silently accepted. The source really does spell one
sheet `Equipos ` with a trailing space: matching normalises it, lineage keeps it.

Each of these is a blocker: a missing role, two files resolving to one role, a
file matching two roles, a missing worksheet, two worksheets with one name, a
header anchor that moved, a duplicated identity, an identity in two cohorts, an
identity absent from the catalogue, and any declared count that does not match.
Unexpected extra worksheets and hidden worksheets are warnings.

A header anchor is proved by a pair of assertions — the declared header cells
must be populated AND the cells the specification declares empty must be empty.
A sheet shifted by one row otherwise produces a plausible count, not an error.

### What is reconciled

60 unique identifiers; 28 active and 32 former participants reconciled against
`IDCliente` in both directions; 28 CSAT sessions; 55 CSAT items split 29/6/10/10
across four merged domain bands; 28 active and 11 former NPS responses; 28 CRI
responses; six retention periods including `final = inicial - perdidos + nuevos`;
nine performance periods from October 2025 to June 2026; 18 journey stages; 10
organizational units; seven performance dimensions; 10 EDL and 10 member culture
dimensions.

`NA`, `Sin dato`, `Sin información`, a blank and a spreadsheet error are typed
absence states and never become 0. `No participó` — and a bare `No` in the
deserter profile's own column — is non-participation, never an answer. A
participant with no numeric month stays `source_unavailable`; if the source
carries an aggregate for such a row anyway, that contradiction is reported
rather than trusted. A derived label beside a CSAT answer is reconciliation
evidence, never a second response.

### Privacy and idempotency

The preflight DTO carries structure, coordinates, counts, hashes and colours.
It carries **no respondent name, answer, qualitative text, category value or
identifier** — it is displayed, logged and stored on `import_job.error_report`,
so anything in it is copied into all three. A finding says WHERE to look:
"la hoja X repite 2 identificadores (filas 7, 19)". Alias candidates are
reported as a column, a count of spellings and coordinates, with no values:
merging two redactions is a versioned decision a human makes.

The package idempotency key is `sha256` over the mapping version, the semantic
roles and the file hashes **sorted by role**, so uploading the same two files in
the other order is the same package. A file name is never an identity.

Confirmation is allowed if and only if there are zero blockers.

## Deliberately outside Units 1 and 2

- no Supabase project was changed;
- no migration was applied anywhere;
- no Cloudflare Worker was built, deployed or promoted;
- no existing Cuicuilco data was migrated;
- no UI was changed;
- no AI categorization was introduced;
- no client-facing calculation was changed;
- nothing was written to any canonical table.


## Migration 0024: commit, ownership and rollback

`0024_canonical_commit_and_rollback.sql` is additive and adds what a
transactional commit needs and `0022`/`0023` did not have.

**Columns on `import_job`.** `plan_fingerprint` binds the job to one validated
plan; `payload_digest` is the database's OWN digest of the payload it received,
stored on success; `commit_attempts`, `rollback_count` and `last_error_code`
make the audit record honest about what happened. `last_error_code` is
constrained to `^[A-Z][A-Z0-9_]{1,59}$` — a code, never a database message.

**A surrogate `id` on the four `pain_point_*` link tables.** The ledger
addresses every owned row by one uuid; those four tables had composite primary
keys only. The composite key stays: it is what keeps a relationship unique.

**`retention_period`.** Historical retention is deliberately NOT written into
the legacy aggregate `study_period_snapshot`. That table requires four non-null
counts and a positive starting membership, so it cannot represent a period whose
source count is blank or unavailable, and it is a surface the current
application already reads. `retention_period` keeps each count WITH the state
the source gave it and records `identity_verified` — whether the four counts
actually satisfied `final = inicial - perdidos + nuevos` — instead of assuming
they did. Nothing in Unit 3 touches `study_period_snapshot` or
`period_series_import`.

**`import_job_record`, the ownership ledger.** One row per canonical record the
package touched, marked `created` or `reused`. It is what makes rollback exact:
a row this package created is removed, a row it merely reused is left alone.
`source_asset` and `import_job_asset` are deliberately ABSENT from its
vocabulary, which makes "provenance survives a rollback" a structural fact
rather than a convention a later edit could forget.

**A widened `source_lineage.target_table`.** The `0023` vocabulary could not
name `attribute_definition`, `response_scale`, `retention_period` or the four
pain-point link tables, all of which Unit 3 writes. The focused gate derives the
set of targets the projector actually produces and fails if the migration cannot
name one of them.

### The four functions

| function | what it does |
|---|---|
| `record_canonical_rows` | writes ledger rows for one family; called by the commit |
| `stage_canonical_package` | binds tenant, study, assets and the plan fingerprint to one `import_job`, idempotently on `(study_id, idempotency_key)` |
| `commit_canonical_package` | locks the job, validates scope and fingerprint, writes every family, measures every count and records the result |
| `rollback_canonical_package` | removes exactly the ledger's `created` rows, in reverse dependency order |

All four are `SECURITY DEFINER` with `set search_path = ''`, use fully qualified
identifiers, are revoked from `public`, `anon` and `authenticated`, and are
granted only to `service_role`.

### The transaction contract

- **Scope is derived, never accepted.** The commit locks the `import_job` row
  with `FOR UPDATE` and takes tenant and study from it. The payload states its
  own `tenantId`/`studyId` so the database can REFUSE a mismatch
  (`TENANT_SCOPE_MISMATCH`, `STUDY_SCOPE_MISMATCH`); every insert stamps the
  locked row's values.
- **Assets are named by ROLE.** The payload never supplies an asset uuid. Roles
  are resolved through this job's own `import_job_asset` links, so a payload
  cannot cite a file the job does not carry (`ASSET_ROLE_UNKNOWN`).
- **Counts come from the database.** Every family's row count is taken from
  PostgreSQL's own `ROW_COUNT`, compared with the plan's declared counts, and a
  disagreement raises `COUNT_MISMATCH`. A family the plan never declared raises
  `COUNT_FAMILY_UNDECLARED`; a plan with no declared counts raises
  `EXPECTED_COUNTS_MISSING`.
- **The write is one subtransaction.** Every insert happens inside a single
  PL/pgSQL block guarded by `exception when others`. When it raises, that block
  is rolled back and the outer transaction survives, so the job can be marked
  `failed` with certainty that the attempt left nothing behind. **This is the
  one behaviour in the unit whose proof requires a running database, and it has
  now been executed — see "What is proved, and at which level" below (L4).**
- **No database message ever escapes.** A constraint violation message quotes
  the failing key values, which here are respondent data. The handler keeps
  `message_text` only when it matches `^[A-Z][A-Z0-9_]{1,59}$` — a code this
  migration raised itself — and otherwise substitutes `DATABASE_CONSTRAINT`. The
  SQLSTATE and the constraint NAME are kept; nothing else is.

### Behaviour, state by state

| situation | result |
|---|---|
| first successful commit | `committed`, `committed_at` set, `payload_digest` stored, counts measured |
| replay after committed | returns `replayed: true`, writes nothing; a DIFFERENT payload raises `COMMITTED_PAYLOAD_DIFFERS` |
| duplicate or reordered upload | same package key, same job, replay; a file name is never identity |
| retry after failure | allowed while the ledger owns no rows; otherwise `PACKAGE_ROWS_PRESENT` |
| rollback after commit | removes exactly the `created` rows; job survives as `rolled_back` |
| repeated rollback | idempotent, returns `replayed: true` |
| commit after rollback | allowed; the derived identifiers are the same, so no duplicate can appear |
| simultaneous commits | serialise on `FOR UPDATE`; the second sees `committed` and replays |
| count mismatch | `COUNT_MISMATCH`, transaction discarded, job `failed` with empty counts |
| malformed private payload | `PLAN_NOT_OBJECT`, `PLAN_FAMILY_NOT_ARRAY`, `PLAN_TOO_LARGE` |
| foreign tenant/study | `TENANT_SCOPE_MISMATCH`, `STUDY_SCOPE_MISMATCH`, `STUDY_TENANT_MISMATCH` |
| missing target reference | `ASSET_ROLE_UNKNOWN`, or a constraint violation reported as `DATABASE_CONSTRAINT` |

Two kinds of refusal, and the difference matters when reading an
`import_job` row afterwards:

- **Refusals BEFORE the first write** — a malformed or oversized plan, a missing
  job, a fingerprint or scope mismatch, an illegal state, a ledger that still
  owns rows, a committed job presented with a different payload — raise out of
  the function and abort the transaction. Nothing was written, so nothing is
  recorded: the job is left exactly as it was.
- **Refusals DURING the write** — an unknown asset role, a duplicated identity,
  a family that is not an array, a count mismatch, an inconsistent ledger, or
  any constraint violation — are caught by the guarded block. Its rows are
  discarded, and the job is then recorded as `failed` with a safe code, empty
  `actual_counts` and no `payload_digest`.

### Ownership and what a rollback keeps

Rollback deletes the ledger's `created` rows in reverse dependency order. The
order is verified by the focused gate against every `ON DELETE RESTRICT` edge
declared in `0022` and `0023`: a referencing table must appear before the table
it points at.

Three things deliberately survive a rollback:

1. **A shared person.** `person_private` is tenant-scoped, not study-scoped. A
   person this package created is deleted only when no `study_participant` and
   no `person_external_identifier` still reference it; otherwise it is kept and
   counted in `_retainedSharedIdentities`.
2. **Source assets and job asset links.** They are provenance. They are also
   what the package idempotency key is derived from, so destroying them would
   destroy the record that these exact bytes were validated.
3. **The `import_job` audit record**, with an honest final status
   (`rolled_back`), `rolled_back_at`, an incremented `rollback_count` and
   `actual_counts` holding what was actually removed and retained.

### Retry and concurrency

- Staging is idempotent on `(study_id, idempotency_key)`, which is derived from
  the mapping version, the semantic roles and the file hashes **sorted by role**.
  The same two files in the other order are the same package.
- A job's `plan_fingerprint` may be re-staged only while the job owns no
  canonical rows (`staged`, `validated`, `failed`, or `rolled_back` with an
  empty ledger). A `committed` or `committing` job's fingerprint is frozen
  (`PLAN_FINGERPRINT_FROZEN`).
- Two concurrent confirmations of the same package serialise on the job lock.
  Whichever arrives second sees `committed` and replays.
- Record identifiers are DERIVED, not random: a SHA-256 over the package key,
  the target table and the record's natural key, formatted as an RFC 9562
  version 8 uuid. The same bytes therefore produce the same primary keys on
  every attempt, which is what makes a duplicate visible to a unique index
  instead of invisible.

## Unit 3 — server-only commit and rollback (source only)

`src/lib/ingestion/canonical-commit/` projects a validated package into
canonical records and writes them through the RPCs above.

### The private plan versus the safe preflight

This is the boundary the unit is built around, and the two shapes are separate
types with separate rules:

| | `CanonicalPackagePreflight` (Unit 2) | `CanonicalCommitPlan` (Unit 3) |
|---|---|---|
| carries | structure, coordinates, counts, hashes, colours | names, identifiers, answers, qualitative text |
| may travel to | a screen, a log, `import_job.error_report`, a test | `p_plan` of `commit_canonical_package`, and nowhere else |
| defined in | `canonical-package/types.ts` | `canonical-commit/plan.ts` |

A privacy-safe report cannot be the persistence payload, because it excludes
exactly the values persistence needs. **The preflight DTO was NOT widened.** A
second, clearly named internal type was introduced instead, and the focused gate
plants sentinel values where a name, an identifier, an answer and a comment
would be, then fails if one of them reaches the preflight report, the stored
manifest, the commit result or any error path.

### The server-only boundary

- `flow.ts` holds the workflow and takes a `CommitTransport` — one `rpc` call.
  It has no Supabase client and no credentials, which is what lets the gate
  execute the whole order of operations against a fake.
- `adapter.ts` is `import "server-only"` and is the ONLY module in the unit that
  imports `@supabase/supabase-js`. `server.ts` re-exports it behind the same
  marker, so importing the write path is a deliberate act.
- `index.ts` deliberately does NOT re-export either, so importing a type cannot
  drag the server-only path into a client bundle.
- A browser could not use them anyway: both RPCs are granted only to
  `service_role`, and every canonical table denies browser roles under RLS and
  FORCE RLS.
- The workflow re-runs the deterministic preflight over the EXACT uploaded bytes
  and refuses to stage anything unless that run has zero blockers. There is no
  parameter for a previously-computed report.

### What the projector maps, and what it refuses

The projection is configuration (`projection-spec.ts`), versioned with the same
`mappingVersion` as the package specification, and the projector refuses to run
if the two disagree. It emits every family the package supports: stable persons
and external identifiers, cohort participations, membership episodes, typed
attributes, scales and options, instruments, domains and items, sessions and
responses, explicit absence and non-participation, monthly performance
observations for October 2025 through June 2026, performance dimensions, band
schemes, retention periods with their source counts, metric definitions and
their evidence links, journey models and ordered stages, organizational units,
culture dimensions, curated pain points with their real relationships,
contextual visual annotations, and lineage for every persisted source-derived
fact.

Where the source does not say, it **refuses** rather than guessing — each with a
sheet and a coordinate, and each meaning no plan is produced at all:

- a column declared numeric or date whose answered value is neither
  (`PROJECTION_ATTRIBUTE_TYPE_MISMATCH`);
- a metric whose documented evidence column cannot be identified uniquely
  (`PROJECTION_METRIC_EVIDENCE_AMBIGUOUS`);
- a membership that ends before it starts (`PROJECTION_EPISODE_ORDER`);
- a cohort identity absent from the catalogue
  (`PROJECTION_IDENTITY_NOT_CATALOGUED`);
- a generated key or derived identifier that collides
  (`PROJECTION_DUPLICATE_NATURAL_KEY`, `PROJECTION_DUPLICATE_RECORD_ID`).

Meaning that must survive, and does:

- **Absence is never zero.** `missing`, `unknown`, `not_applicable`,
  `source_unavailable` and `not_participated` reach the database as themselves,
  and a row carrying one of them carries no value at all.
- **An answered zero is zero.** A `0` that is not a scale option arrives as
  `value_numeric = 0` with status `answered`.
- **Non-participation is not an answer.** A person the source says did not take
  part gets a `survey_session` with status `not_participated` and NO response
  rows. Zero responses is the record; a row of nulls would not be.
- **A derived label is not a second response.** The spreadsheet's own label
  beside a value is stored on the SAME row, in
  `survey_response.source_derived_label`.
- **A colour has no global meaning.** Fills become `visual_annotation` rows with
  `confidence = 'observed'`, `review_status = 'pending'` and an interpretation
  that says outright that the colour means nothing yet. The same RGB produces
  different contextual roles on different sheets. Band ranges come from
  documented configuration — `docs/CALCULATION_CATALOG.md` for NPS, CSAT, TDP,
  CRI and retention, and this document for the confirmed performance ranges —
  never from the colours beside them.

### Mapping decisions a human should review

Three choices are supported by the source and the documentation but are worth a
consultant's eye, and are recorded here rather than buried in configuration:

1. **A former member's episode end.** The active cohort's episode has a start
   and no end. The former cohort's episode takes its end from the second,
   strictly later date the source carries per person, and the projector refuses
   the package if any of those dates is not strictly later. The active cohort's
   equivalent column stays an ordinary typed attribute, because an active member
   has not left.
2. **`journeyEvidence` is empty for Cuicuilco v1.** Nothing in the package
   states which metric belongs to which journey stage. The projector supports
   the link and emits none, because a fabricated association would put a
   relationship nobody made in front of a consultant.
3. **CSAT and TDP are defined per touchpoint.** The calculation catalogue states
   that no general CSAT exists, so the projection emits one CSAT and one TDP
   metric definition per CSAT item rather than one of each for the instrument.

## What is proved, and at which level

Three different things can be true of this unit, and they are not
interchangeable. Every claim below states which one it is.

| level | what it runs against | command |
|---|---|---|
| **1. Projection** | pure functions, no database at all | `npm run test:canonical-commit`, `npm run test:canonical-commit-dry-run` |
| **2. Local transaction** | a disposable PostgreSQL cluster this repository creates and destroys | `npm run test:canonical-commit-live` |
| **3. Hosted transport** | Supabase + PostgREST + the service-role key | **not performed** |

### Level 1 — projection and boundaries (`npm run test:canonical-commit`, 267 checks)

Executed offline, in `npm test`:

- the synchronous SHA-256 matches `crypto.subtle` and the FIPS 180-4 vector;
- derived identifiers are stable, uuid-shaped, and disjoint across studies and
  tenants — the regression test for the defect the database found;
- the plan fingerprint is order-independent for object keys and sensitive to any
  changed source value;
- every canonical family is emitted from a synthetic package;
- every absence state survives; an answered zero survives; non-participation
  produces no answer; derived labels create no extra response;
- colours become pending, uninterpreted evidence and the bands come from
  documented ranges;
- lineage reaches every persisted fact, keeps the trailing space in `Equipos `
  and a legal coordinate, and cites only targets migration 0024 can name;
- the same files in either order produce the same package key AND the same plan;
- five projector refusals fire and produce no plan;
- sentinel values appear in the plan and in NOTHING else — not the preflight,
  the manifest, the result or any error path;
- count reconciliation fails on a short count, a missing family, an extra family
  and no counts at all;
- the whole workflow runs against a fake transport;
- migration 0024's SQL carries the grants, empty search paths, `FOR UPDATE`
  locks, `ROW_COUNT` measurement, ledger vocabulary and reverse counterpart it
  claims — read from the text, and now confirmed by level 2;
- **the database gate's own refusals** run here too: a remote host, a password in
  a connection string, a Supabase host, a non-PostgreSQL URL, an ordinary
  database name and a present `SUPABASE_SERVICE_ROLE_KEY` are each refused, so a
  weakened guard fails `npm test` rather than waiting for a run nobody makes.

### Level 1 — the real-workbook dry run

`npm run test:canonical-commit-dry-run <clean.xlsx> <curated.xlsx>` runs the
preflight and builds the plan IN MEMORY against the two real workbooks. It
performs no database or network operation — the check is executable, not a
claim: it reads its own module graph and fails if any of it reaches a database.
It prints only approved aggregates, and asserts before printing that no value
from the plan appears in its own output.

It reconciles 60 identities, 28 active and 32 former participations, 4
instruments, 4 CSAT domains, 62 items, 116 sessions (95 answered and 21
explicitly non-participating), 1 685 responses, 252 monthly observations across
the nine months from October 2025 to June 2026, 6 retention periods that all
satisfy the count identity, 18 journey stages, 10 organizational units, 20
culture dimensions, 7 curated performance dimensions, 50 pain points and 5 029
lineage rows citing all 16 worksheets. Neither workbook, nor any output of that
run, is committed to this repository.

### Level 2 — local PostgreSQL transaction (`npm run test:canonical-commit-live`, 140 assertions)

**Executed.** `scripts/canonical-commit-live-test.mjs` creates disposable
databases, applies the bootstrap and migrations 0000-0024 verbatim, drives the
product's own `runCanonicalCommit` / `runCanonicalRollback` through a `psql`
transport, and asserts the resulting database state. It is deliberately outside
`npm test`, because a database is not always available and an unexecuted
database test must never be counted among the offline results.

What it proved, by executing it:

| id | behaviour |
|---|---|
| L1 | the first commit writes every family; the database's own counts match, and the ledger accounts for all of them |
| L2 | an exact replay writes not one row and is not a second attempt |
| L3 | a changed payload under a committed identity is refused with `COMMITTED_PAYLOAD_DIFFERS` |
| L4 | a failure injected at `pain_point` — after persons, sessions and responses — leaves **zero** rows in every earlier family, an empty ledger, no lineage, and a job marked `failed` with a safe code |
| L5 | the retry then succeeds exactly once, as attempt 2 of the same job |
| L6 | rollback removes only `created` rows; an unrelated study, the source assets and the job's asset links all survive, and the audit job survives as `rolled_back` |
| L7 | a repeated rollback is a no-op reporting `replayed=true` |
| L8 | the package commits again afterwards with no duplicate participation |
| L9 | two genuinely concurrent psql sessions serialise on the locked job: one commits, the other replays, and the row counts equal a single commit |
| L10 | a declared count that disagrees raises `COUNT_MISMATCH` and writes nothing |
| L11 | a family that is not an array, and a plan that is not an object, are both refused |
| L12 | a foreign tenant or study is refused and the foreign tenant is unchanged |
| L13 | lineage citing a role the job does not carry raises `ASSET_ROLE_UNKNOWN` |
| L14 | `anon` and `authenticated` are refused with SQLSTATE `42501` on all four functions AND on direct reads of `import_job_record`, `retention_period`, `person_private` and `survey_response`; `service_role` may execute the three server operations |
| L15 | all four functions are `SECURITY DEFINER` with an empty `search_path`, grant EXECUTE to `service_role` alone, and leave nothing with `PUBLIC`; both new tables carry RLS, FORCE RLS and their deny policy |
| L16 | a normalized catalogue snapshot taken after 0023 equals the snapshot taken after applying 0024 and then its reverse — tables, columns, constraints, indexes, policies, functions, grants and default privileges |

And the cases the review added:

| id | behaviour |
|---|---|
| X1 | every family declared in `expectedCounts` is measured by the database and represented consistently in the ledger |
| X2 | two assets claiming one role, and one file claiming two roles, are both refused by NAME (`ASSET_SET_NOT_DISTINCT`) rather than by a cardinality violation whose message quotes a row |
| X3 | a rollback that cannot finish leaves the job `committed`, its ledger intact and its rows in place — it never reports success it did not achieve |
| X4 | a person shared by two studies of one tenant is reused, and is retained (with its identifier) when one study is reversed |
| X5 | that study then commits again over the retained identities, reusing all of them |
| X6 | every failure returned through the workflow carries a safe code and no respondent value, and neither does what is stored on the job |
| X7 | the reverse script REFUSES while a committed package still owns rows, naming `CANONICAL_PACKAGES_STILL_OWNED`, drops nothing, and succeeds once the package is reversed |
| X8 | the complete real Cuicuilco plan passes through the serialization boundary |

**Measured for the real package, without any content:** a 2.58 MiB
(2 704 662-byte) plan; whole commit 1 431 ms of which the RPC itself was 716 ms;
rollback 91 ms; 3 559 canonical rows and 5 029 lineage rows written and then
removed; the database independently measured 60 persons and 1 685 responses.

**How to run it.**

```bash
bash scripts/lib/disposable-postgres-provision.sh          # prints the two variables
CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" CANONICAL_COMMIT_TEST_PGUSER="$(id -un)"   npm run test:canonical-commit-live
bash scripts/lib/disposable-postgres-provision.sh --destroy
```

Add `CANONICAL_COMMIT_TEST_CLEAN_XLSX` and `CANONICAL_COMMIT_TEST_PAIN_XLSX` to
include the real-package boundary; without them that suite reports itself as
skipped rather than passing.

**How the database was obtained.** No PostgreSQL server was installed. The
provisioning script downloads the server package with `apt-get download` and
unpacks it with `dpkg-deb -x` into a directory under the ordinary user's home —
no dpkg database entry, no system file, no service, and no `sudo`, which is not
available on this machine anyway. The cluster is started with `-h ''`, so it
opens NO TCP listener at all; the only way in is a unix socket inside that
directory. Each suite runs in its own database named
`becommunity_canonical_test_*`, dropped on the success and the failure path
alike, and `--destroy` removes the whole tree. On a machine that already runs
PostgreSQL, skip the script and point the gate at that server: it only ever
creates and drops databases with that prefix.

**Repeatability.** The gate was executed six times from freshly created
databases — four including the real package, two synthetic only — with identical
results and no leftover database after any of them.

### What the database found that no amount of reading could

Five defects survived a 220-check offline gate and a clean real-workbook dry run,
and died on first contact with PostgreSQL. They are recorded because each one
explains why level 2 is not optional.

1. **Derived identifiers were scoped to the package, not to the study.** The
   package key is a hash of the mapping version, the semantic roles and the file
   hashes — deliberately, so the same two files in either order are the same
   package. Every record id was derived from it, so importing the same package
   into a SECOND study derived the same primary key for every row and collided
   on the first insert. Fixed in `ids.ts` and `projector.ts`: the scope is now
   the package key together with the tenant and the study. Regression test:
   two studies of one tenant must share no record identifier.

2. **Rollback orphaned a person it had decided to retain.** A person shared with
   another study is kept — but the rollback still deleted the
   `person_external_identifier` row that this package created. The commit path
   finds a reusable person THROUGH that identifier, so the retained person
   became invisible, and re-committing the same package tried to insert the
   person it could no longer see. Fixed in `rollback_canonical_package`: an
   identity is kept whole or removed whole, and the identifiers kept are
   reported as `_retainedExternalIdentifiers`.

3. **"Created" was decided by comparing identifiers.** A person counted as
   created when the resolved id differed from the one the plan derived. Those
   two tests agree until a rollback retains a person whose id THIS package
   derived: the identity is then found and reused, the ids are equal, and the
   comparison called it a creation. Fixed: creation is now decided by the
   identity lookup itself, which is the question actually being asked.

4. **A duplicated asset failed with a cardinality violation.** A request naming
   the same file twice reached `on conflict … do update` with two rows for one
   key. PostgreSQL refused it — correctly, but with an unnamed error whose
   message quotes the offending row, which this product may not surface. Fixed:
   `stage_canonical_package` refuses a non-distinct asset set up front with
   `ASSET_SET_NOT_DISTINCT`.

5. **The reverse script would have orphaned owned rows.** It dropped
   `import_job_record` unconditionally. The ledger is the only record of which
   canonical rows belong to which package, so dropping it while rows were owned
   would have left that data in place with nothing able to identify, reverse or
   audit it. Fixed: the script refuses with `CANONICAL_PACKAGES_STILL_OWNED` and
   names the way out.

A sixth was in the harness itself and mattered for privacy rather than
correctness: `execFileSync` forwards a child's stderr to the parent unless
`stdio` says otherwise, so PostgreSQL error text — which quotes the values that
violated the constraint — was reaching the console. It is now captured and only
its SQLSTATE is ever printed.

### Level 3 — hosted transport: NOT performed

Nothing in this repository has verified the unit against Supabase. In
particular, these remain unproved:

- that PostgREST accepts a 2.6 MiB RPC body under the project's request limits;
- that supabase-js surfaces the function's JSON result and its errors in the
  shape `flow.ts` expects from a hosted endpoint;
- that the `service_role` key reaches the function with the privileges the local
  `set role service_role` simulated;
- that a hosted statement timeout accommodates a 716 ms commit under load.

The local gate uses `psql` and `pg_read_file`, so it proves the SQL, the
transaction, the privileges and the JSON parsing — not the HTTP transport in
front of them. Do not describe hosted behaviour as verified until it has been.

## Deliberately outside Unit 3

- no Supabase project was changed and no migration was applied anywhere;
- no Cloudflare Worker was built, deployed or promoted;
- no existing Cuicuilco data was migrated and no real workbook was uploaded;
- no UI, route, dashboard or client publication was changed;
- no AI categorization was introduced;
- no client-facing calculation and no legacy import behaviour was changed;
- nothing was written to any canonical table, in any environment.
