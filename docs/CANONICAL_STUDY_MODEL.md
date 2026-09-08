# Canonical study model

## Purpose

The current ingestion model remains available for existing studies. Migrations
`0026`, `0027` and `0028` add the normalized layer required to preserve the full
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

## RESOLVED: the migration numbering collision, and the map that fixed it

**The canonical migrations were renumbered. Canonical now owns `0026`, `0027`
and `0028`.** The numbers `0022`-`0025` in this repository are IMPORTS of
migrations the hosted project has already applied; they are not this branch's
work and must never be re-applied or edited here.

### The collision, and why the canonical branch was the side that moved

`origin/main` tops out at **0021**. Above it, every migration that existed on any
remote branch — enumerated over all 60 fetched remote branches, the highest
number anywhere being **0025**:

| number | canonical branch claimed | other branches claimed | on the hosted project? |
|---|---|---|---|
| **0022** | `canonical_ingestion_foundation` | `semantic_category_review` — **9** `claude/*` branches | **applied** — `category_decision` (2 rows), `study_category_snapshot` (0) |
| **0023** | `canonical_analysis_model` | `experience_definition_persistence` — **5** `claude/experience-*` branches | **applied** — `study_experience_draft` (2), `study_experience_event` (**86 rows**) |
| **0024** | `canonical_commit_and_rollback` | `experience_draft_conflict_code` — the same 5 branches | **applied** — `study_experience_revision` (0) |
| **0025** | — | `experience_publication` — `claude/experience-publication-versioning` | **applied** — `study_experience_publication` (0) |

Supabase tracks applied migrations BY VERSION NUMBER, so applying this branch's
`0022` to a project that already records a `0022` is either skipped as
already-applied or conflicts — and both outcomes are quiet enough to be mistaken
for success.

The canonical branch moved, and not because its numbering was worse: the database
had already made the other numbering a fait accompli. `study_experience_event`
holds 86 rows written under `0023`/`0024` as the experience branches define them.
Renumbering those would mean reconciling a ledger against rows that already
exist. This branch has written nothing to the project, so it was the cheap side
to move.

### The ledger was read directly, and it agrees

`supabase_migrations.schema_migrations` was read over a direct connection on
2026-09-06. It records **26 versions, 0000 through 0025**, ending:

    0022  semantic_category_review
    0023  experience_definition_persistence
    0024  experience_draft_conflict_code
    0025  experience_publication

The ledger AGREES with the object-level evidence gathered over REST: every one of
those four is recorded AND its objects exist. The collision was confirmed from
both directions.

⚠️ **The ledger records NO timestamp.** Its columns are `version text`,
`statements text[]`, `name text` — nothing more. "When was 0022 applied" cannot
be answered from it, and any plan that depends on ordering migrations by
application time needs a different source.

### The migration map

The earlier recommendation to renumber to 0025-0027 was withdrawn once the full
collision was visible; the floor was recorded as 0026 and has now been re-proved
by re-enumerating every remote branch. Nothing on any branch, in either
`supabase/migrations/` or `supabase/rollbacks/`, uses a number above 0025.

| was | is now | rollback was | rollback is now |
|---|---|---|---|
| `0022_canonical_ingestion_foundation.sql` | **`0026_canonical_ingestion_foundation.sql`** | `0022_drop_canonical_ingestion_foundation.sql` | **`0026_drop_canonical_ingestion_foundation.sql`** |
| `0023_canonical_analysis_model.sql` | **`0027_canonical_analysis_model.sql`** | `0023_drop_canonical_analysis_model.sql` | **`0027_drop_canonical_analysis_model.sql`** |
| `0024_canonical_commit_and_rollback.sql` | **`0028_canonical_commit_and_rollback.sql`** | `0024_drop_canonical_commit_and_rollback.sql` | **`0028_drop_canonical_commit_and_rollback.sql`** |

**The rename changed nothing a server executes.** A migration number appears in
these six files only inside `--` comments — never in a statement, a literal, a
stored version marker or a column default. Stripping comments and collapsing
whitespace gives an identical digest before and after the rename:

| file | executable-SQL SHA-256 (unchanged by the rename) | exec lines |
|---|---|---|
| `0026_canonical_ingestion_foundation.sql` | `0e41dcc962d218ec21e07cadafdeeb61bd68ff331bd491e44e12111c54172eb5` | 411 |
| `0027_canonical_analysis_model.sql` | `0ce0fe035c640e973be5239e0c6a138ba50063b6015beefaefbcec1cfb3fc1cc` | 362 |
| `0028_canonical_commit_and_rollback.sql` | `fef7ae8a0f2d97fd75f6402a1e7c68ef134f23ac2d25a898e020dbbfdd58e1fb` | 1255 |
| `0026_drop_canonical_ingestion_foundation.sql` | `c2c35880da499a1ef20fbf33f821f1a2afdfbfd3507744df8fa7dfb1fce266c2` | 21 |
| `0027_drop_canonical_analysis_model.sql` | `5a0d745bdb2014597a2461d6bed537aea6a353993ffbc498e59bde65b9f5afab` | 32 |
| `0028_drop_canonical_commit_and_rollback.sql` | `7b44ff445f1282e9befab18a7a56945e25d30546dba2c6612ae4f55ec7193526` | 65 |

### The imported migration artifacts, and their authoritative hashes

`0022`-`0025` and their four reverse scripts were copied byte-for-byte from
**`origin/claude/experience-publication-versioning` @ `6311f0a`** — the only
branch carrying all eight files together. Every other branch holding any of them
holds the IDENTICAL blob, so there was no candidate to choose between and no
conflict to report. Each was introduced by the commit named below.

| file | source commit | SHA-256 |
|---|---|---|
| `supabase/migrations/0022_semantic_category_review.sql` | `022513e6458993267d09a987f23233ccc7767af4` | `bde6c0a07a082c7d8247c89563007c7658f8c4d095c2facca0d9c55772dda539` |
| `supabase/migrations/0023_experience_definition_persistence.sql` | `ab940037d77ac9c2956b199332306aab85d58911` | `8909540a728d72ffe4b99ad9f64cfb5d25be58f9a79252bea3cb04997360d84c` |
| `supabase/migrations/0024_experience_draft_conflict_code.sql` | `8e9a4b17d508e9d5a18cb3e53f5fcf7ca6aa94e1` | `c20d821de5fd1aa598477f3e3a6afc77fbd12090e8798e47a4a49ec2084af798` |
| `supabase/migrations/0025_experience_publication.sql` | `06f873812ce4470ab0374bad1682ce29ebb6230f` | `b7c64fad5aa216a7b851596f0028ef8f68db81d71c95c9b1aefd6dece3bee576` |
| `supabase/rollbacks/0022_drop_semantic_category_review.sql` | `022513e6458993267d09a987f23233ccc7767af4` | `e0e71bb96143a670b5150ba650628a9d7b8032cf7cc5495a7cc8d378d76b9792` |
| `supabase/rollbacks/0023_drop_experience_persistence.sql` | `ab940037d77ac9c2956b199332306aab85d58911` | `b7226d4798cc81166bb3715e5ae5ed619403d68aaffd8dfa070613e5df3be238` |
| `supabase/rollbacks/0024_restore_experience_draft_conflict_code.sql` | `8e9a4b17d508e9d5a18cb3e53f5fcf7ca6aa94e1` | `b1c40e70097164d7c8047afe1906471e075f95933054c39f5508f8355e6502ab` |
| `supabase/rollbacks/0025_drop_experience_publication.sql` | `06f873812ce4470ab0374bad1682ce29ebb6230f` | `dc1915077ddbb36268a3c14647212c9583afc41648b38dd2636dc4d6684b68f1` |

All four forward migrations have an authoritative rollback, so none had to be
invented. Only the application code of those features was left behind: the
migration artifacts were imported without cherry-picking any UI or application
commit.

### The gate that keeps this from happening again

`npm run test:migration-chain` (in `npm test`) inventories
`supabase/migrations/` and `supabase/rollbacks/` and fails if two forward
migrations share a number, if a canonical migration reoccupies an applied slot,
if the canonical three stop being a contiguous ordered run, if a canonical
rollback stops matching its forward number, if a runner's own discovery filter or
upper bound would skip a migration, if a migration number reaches executable SQL,
if the canonical object inventory or transaction contract is lost, or if any of
the three governing documents claims an application that has not happened. The
four applied slots are pinned by the SHA-256 values above, so editing an
already-applied migration is a red gate rather than a silent divergence.

### This was the SECOND instance of the drift 0016 was written to remove

`0016_remove_untracked_private_policy_experiment.sql` exists because the project
carried RLS policies and a `private` helper schema that appeared in **no tracked
migration** — schema in the database that nothing on `main` explained. Its header
records the cost: one policy referenced a table that did not exist, so
`public.tenant` could not be read by any authenticated role.

The same class of divergence appeared again: the `semantic_category_review` and
`experience_*` migrations were applied to the project and **none of them was on
`main`**, which is at 0021. Importing those four migrations here is what closes
it — the repository now describes the schema the project actually has, rather
than documenting a gap. `main` itself is unchanged and still tops out at 0021.

## Migration 0026: ingestion foundation

`0026_canonical_ingestion_foundation.sql` adds:

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

## Migration 0027: analysis model

`0027_canonical_analysis_model.sql` adds:

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

## Migration 0029: the durable canonical presentation draft

`0029_canonical_presentation_draft.sql` is the fourth canonical migration and
the only one that is not about ingesting or calculating. It exists because the
question "can a canonical schema-v4 presentation draft coexist with the two
legacy experience drafts" was put to a real PostgreSQL and came back **no**:

- `study_experience_draft`'s primary key is `study_id` **alone**, so one study
  has exactly one draft row and there is no "beside" in that table;
- `save_study_experience_draft` **accepted** a canonical v4 document against a
  planted legacy row at revision 72 — moving it to 73, changing
  `schema_version` from 2 to 4, and replacing the definition bytes;
- there is no idempotency of any kind on that draft path, so a replayed save
  after a lost response is indistinguishable from somebody else's conflict.

So `0029` adds a **separate** table rather than widening the legacy one, which
would not have been additive and which every existing reader of that table
would have contradicted. It creates:

| object | what it is |
|---|---|
| `canonical_presentation_draft` | one mutable v4 draft per study; `schema_version` admits **4 by equality**, not a range |
| `canonical_presentation_draft_event` | the append-only log, and the **idempotency ledger** |
| `save_canonical_presentation_draft` | the only write path: authorizes, derives the tenant from the study row, takes an advisory lock on the study, replays a recorded key, compares the expected revision, and writes the row and its event in one transaction |
| `refuse_canonical_presentation_event_update` | the trigger that makes the log append-only |

**It is applied to no project.** Like `0026`-`0028` before their application, it
is proved against a disposable cluster and nowhere else.
`npm run test:canonical-presentation-draft-live` executes it — 93 assertions,
including two genuinely concurrent races and the same contract a second time
over a real PostgREST with `supabase-js`.

**Why an advisory lock and not only `FOR UPDATE`.** `select … for update` locks
a row that exists. When none does it locks nothing, so two concurrent first
saves both find no row, both insert, and the loser gets a primary-key violation
— an untyped error arriving where a conflict was expected. The legacy draft
function has exactly that hole. `0029` takes `pg_advisory_xact_lock` on the
study before the first read a decision depends on, which also serialises the
idempotency lookup with the write it guards.

## Security boundary

All 36 new tables — 18 in `0026`, 16 in `0027` and 2 in `0028` — are
internal-only:

- RLS is enabled and forced;
- `anon` and `authenticated` have an explicit deny policy and no table
  privileges;
- only `service_role` receives table privileges.

`0029`'s two tables are locked down the same way with one deliberate
difference, **stricter** rather than looser: `service_role` receives `SELECT`
and nothing else. Its only legitimate writer is the `SECURITY DEFINER` save
function, and a `service_role` that could `UPDATE` the draft directly could move
a revision with no event, no expected-revision check and no lock — which is
every property that migration exists to guarantee. The migration-chain gate
asserts both shapes separately so neither can drift into the other.

Nothing in these migrations publishes raw names, attributes, observations or
responses to client-facing routes. Publication must continue through reviewed,
authorized aggregate surfaces.

## Compatibility and rollout

These migrations are additive. They do not rewrite existing respondents,
responses, dashboards, studies or journeys. The existing application continues
to use its current model until a later import adapter and read-path migration are
implemented and verified.

Rollout order:

1. apply `0026_canonical_ingestion_foundation.sql` in staging;
2. apply `0027_canonical_analysis_model.sql` in staging;
3. apply `0028_canonical_commit_and_rollback.sql` in staging;
4. execute the focused structural gates and database/RLS smoke tests;
5. execute `npm run test:canonical-commit-live` against a disposable database;
6. import the two Cuicuilco workbooks into a disposable study;
7. reconcile counts, source lineage, metric bands, journeys and findings against
   the approved mapping workbook before any production promotion.

Reverse order:

1. `0028_drop_canonical_commit_and_rollback.sql`;
2. `0027_drop_canonical_analysis_model.sql`;
3. `0026_drop_canonical_ingestion_foundation.sql`.

`0028`'s reverse script drops the ownership ledger, so a package that is still
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

⚠️ **Scope note.** These statements are about Units 1-3 and remain true of them.
They are NOT a claim about the hosted project in general. Unit 4 inventoried it,
backed it up and deleted one duplicate legacy study through a rehearsed
fail-closed transaction, and then applied the canonical migrations. **Unit 5
Phase 2 then imported the real Cuicuilco package into the canonical tables**
(2026-09-06, import job `1886a359-f2c9-483a-8b5e-979931841a71`), so "nothing was
written to any canonical table" is a statement about Units 1-3 and is FALSE of
the project today. See the hosted project status and the Unit 5 Phase 2 record
in `docs/CURRENT_STATE.md`.


## Migration 0028: commit, ownership and rollback

`0028_canonical_commit_and_rollback.sql` is additive and adds what a
transactional commit needs and `0026`/`0027` did not have.

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

**A widened `source_lineage.target_table`.** The `0027` vocabulary could not
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
declared in `0026` and `0027`: a referencing table must appear before the table
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
| **3. HTTP transport** | supabase-js over a real PostgREST, in front of the disposable cluster | `npm run test:canonical-commit-local-stack` — executed; **never against a hosted project** |

Levels 2 and 3 run the SAME assertions. `scripts/lib/canonical-suite.mjs` holds
them and reaches the database only through the contract in
`scripts/lib/canonical-suite-transport.mjs`; the two runners supply a `psql`
transport and a supabase-js transport respectively. A transport declares what it
can do, and an assertion it cannot execute is recorded as **SKIPPED** naming the
missing capability. A skip is never a pass, and the summary reports executed,
passed, failed and skipped as four separate numbers.

### Level 1 — projection and boundaries (`npm run test:canonical-commit`, 306 checks)

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
  and a legal coordinate, and cites only targets migration 0028 can name;
- the same files in either order produce the same package key AND the same plan;
- five projector refusals fire and produce no plan;
- sentinel values appear in the plan and in NOTHING else — not the preflight,
  the manifest, the result or any error path;
- count reconciliation fails on a short count, a missing family, an extra family
  and no counts at all;
- the whole workflow runs against a fake transport;
- migration 0028's SQL carries the grants, empty search paths, `FOR UPDATE`
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

### Level 2 — local PostgreSQL transaction (`npm run test:canonical-commit-live`)

**Executed.** `scripts/canonical-commit-live-test.mjs` creates disposable
databases, applies the bootstrap and migrations 0000-0028 verbatim, drives the
product's own `runCanonicalCommit` / `runCanonicalRollback` through a `psql`
transport, and asserts the resulting database state. It is deliberately outside
`npm test`, because a database is not always available and an unexecuted
database test must never be counted among the offline results.

**The count depends on whether the real workbooks are supplied.** With
`CANONICAL_COMMIT_TEST_CLEAN_XLSX` and `_PAIN_XLSX` set, the run executes **140**
assertions. Without them the real-package case `X8` is SKIPPED and the run
executes **135**, reporting `135 passed, 0 failed, 1 skipped`. The skip is
reported as a skip; it is never counted among the passes.

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
| L16 | a normalized catalogue snapshot taken after 0027 equals the snapshot taken after applying 0028 and then its reverse — tables, columns, constraints, indexes, policies, functions, grants and default privileges |

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

**The provisioning script cannot delete anything but its own root.** It removes
directories recursively and takes its root from `BECOMMUNITY_PG_ROOT`, so the
root is canonicalised with `realpath -m` before anything happens and must be a
DIRECT child of the canonical home directory named `becommunity-pg` or
`becommunity-pg-test-<something>`. An empty value is refused rather than
silently replaced by the default — `rm -rf "${PGROOT}/debs"` with an empty root
is `rm -rf /debs`. `/`, the home directory itself, a parent of it, `/home`,
`/tmp`, a relative path, `.`, `..`, a path outside the home, an existing
symbolic link, an unexpanded `$`, a glob and an unrecognised basename are all
refused. Every derived path — data, socket, binaries, logs, package staging — is
re-resolved and proved to be a strict descendant. There is exactly ONE `rm -rf`
in the script, inside a guarded function that re-validates the root immediately
before deleting, refuses a glob or a symlink, and passes `rm` a resolved literal
path after `--`. Process termination no longer pattern-matches a command line:
it reads the pid file in our own data directory and kills that pid only when
`/proc` shows the same user, our unpacked `postgres` binary, and our data
directory as its `-D` argument.

`--check-root` runs that validation and nothing else, which is how the offline
gate proves each refusal without performing a dangerous deletion. Section [20]
of `npm run test:canonical-commit` exercises seventeen hostile roots inside a
throwaway home, asserting for each that the exit status is non-zero, that a
recursive listing of that home is byte-identical before and after, and that a
running process was not signalled. It then proves the two accepted roots, and
destroys one of them next to a sentinel directory, file and symlink that must
survive.

**Repeatability.** The gate has been executed repeatedly from freshly created
databases, including with the real package, with identical results and no
leftover database, socket, scratch directory or server after any of them.

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

### Level 3 — the HTTP transport: executed locally, never against a hosted project

The same suites now run through **supabase-js over a real PostgREST**, which
answers questions level 2 structurally cannot: the result shape, the error
shape, the service-role key path, and whether a multi-megabyte body survives the
wire at all. It has still never been pointed at a hosted Supabase project.

**How, on a machine that cannot run `supabase start`.** This workstation has no
container runtime, no `sudo` and nothing may be installed on it, so the Supabase
CLI stack is unavailable. The piece that decides level 3 is PostgREST itself, and
that is a single static binary an ordinary user can run: the official
PostgREST 16.2 Linux static release, in front of the same disposable cluster the
level-2 gate creates, with HS256 role JWTs minted per run by `node:crypto`.
supabase-js builds `${url}/rest/v1/rpc/<name>` and a bare PostgREST serves
`/rpc/<name>`; on a real project the gateway strips that prefix, so a ~40-line
loopback shim strips it here. **The product's own client construction is not
adjusted** — a client bent to fit the harness would stop exercising the product.

```
BECOMMUNITY_PG_VERSION=17 bash scripts/lib/disposable-postgres-provision.sh
npm run test:canonical-commit-local-stack
```

> **T3, T4 and T5 are PENDING RE-PROOF on the hosted transport.** They were
> measured against the PostgREST the local substitute runs, and the hosted
> project runs a different build. The two are not comparable yet, and the gap
> is not yet quantified:
>
> | where | what reported it | value |
> |---|---|---|
> | local substitute | `postgrest --version`, from the upstream release tagged `v16.2` | **16.2** |
> | hosted project | Supabase CLI metadata, `supabase/.temp/rest-version` | **`v14.15`** |
> | hosted project | the running service's own OpenAPI document, `info.version` | **`14.5`** |
>
> The two hosted numbers DISAGREE WITH EACH OTHER, so at least one of them is
> not an upstream PostgREST release number, and neither can be mapped onto the
> numbering that produced `16.2` locally. Do NOT describe the hosted build as
> "older", "two majors behind", or comparable in any direction until the
> numbering scheme is established. What is certain is only that they are
> different builds — which is enough to make the result-shape, error-shape and
> code round-trip findings non-transferable. Phase 2.3 re-proves all three
> against the hosted transport directly, so this costs no extra work.

**Executed, against PostgreSQL 17.11 with PostgREST 16.2:** 102 assertions,
102 passed, 0 failed, 66 skipped. All 41 protected tables and all 4 functions
present; the protected-object census identical before and after the run.

### The suite has run TWICE, over two different migration chains

The table below and the figures above were measured on the FIRST run, over the
old `0000`-`0024` chain, before the canonical migrations were renumbered. That
chain no longer exists on disk, so that run alone could not speak for what this
branch now carries.

**Re-executed 2026-09-06 over the reconciled `0000`-`0028` chain**, which
includes the four imported already-applied migrations and the canonical set at
its new numbers. `[stack] applying the bootstrap and migrations 0000-0028`,
`server: postgrest/16.2`, synthetic fixtures only:

| | first run (old `0000`-`0024`) | re-run (reconciled `0000`-`0028`) |
|---|---|---|
| executed | 102 | **102** |
| passed | 102 | **102** |
| failed | 0 | **0** |
| skipped | 66 | **66** |

Identical, so the renumbering and the four imported migrations cost the HTTP
transport nothing. The 66 skips are unchanged in composition: 27 need DDL the
REST transport declares absent, 25 are error codes this run never provoked over
HTTP (one `T5.2` entry each), 8 need `pg_catalog`, 5 need concurrent sessions,
and 1 (`X8`) needs the real workbooks, which were deliberately NOT supplied.
Every one is recorded as skipped and none is counted as a pass.

The binary was the official PostgREST v16.2 linux-static-x86-64 release,
archive SHA-256
`4712595baae0f5d84a527d55a11166d6bf4d9b0f1d102505c5e9d59219787f08`, extracted
binary SHA-256
`35048dacdab509e9233d5abe2f99f6a2ba9e653088b3522e5f0eaefed20c1766`, confirmed
by `postgrest --version` before use. It lives outside the repository at
`~/becommunity-postgrest/` and is not tracked by git.

⚠️ **That re-run was still LOCAL** — a local PostgREST in front of a local
disposable cluster. It never spoke for the hosted project. The hosted execution
that does is recorded in the next section.

---

## The canonical chain is APPLIED to the hosted project (2026-09-06)

`0026`, `0027` and `0028` were applied to project `ontvqazsqiwisdddblif`
(`be-community-dev`, PostgreSQL 17.6), which holds the real Cuicuilco data. They
were applied with `supabase db push` (CLI v2.115.0) against a **session**
connection — never the transaction pooler — so the official
`supabase_migrations.schema_migrations` ledger recorded each one. **No ledger
entry was hand-written**, nothing was seeded, no earlier migration was reapplied
or repaired, and no auth or storage schema was touched.

**Before anything.** A read-only preflight verified all thirteen required facts,
including that the ledger held exactly 0000-0025 with no duplicate, that the four
hosted-applied names matched the artifacts imported into Git, that none of the 36
canonical tables or 4 RPCs existed, that no earlier `U4-` object was left over,
that `respondent` had 82 rows with **zero duplicate `(id, tenant_id, study_id)`
triples** — the index `0026` builds — and that `study_period_snapshot`'s 6 rows
would satisfy `0027`'s new CHECKs. A fresh backup was then taken and
**rehearsed**: restored into a throwaway local PostgreSQL 17 database where all
24 table counts and the 26-row ledger matched the source exactly.

**The dry run proposed exactly three files and nothing else** — no reapplication
of 0022-0025, no history repair, no seed.

| migration | duration | verified immediately after |
|---|---|---|
| `0026_canonical_ingestion_foundation` | 8.19 s | 18 tables; `respondent_id_tenant_study_uidx` built against the populated table and `indisvalid`; legacy counts unchanged; all 18 new tables empty; RLS + FORCE RLS + deny policy on all 18; **zero** browser grants |
| `0027_canonical_analysis_model` | 7.91 s | 16 tables; `study_period_snapshot` gained its three columns and both CHECKs **validated** against the existing 6 rows, whose values are unchanged; all 16 new tables empty; RLS + FORCE RLS + deny policy on all 16 |
| `0028_canonical_commit_and_rollback` | 8.26 s | `import_job_record` and `retention_period` exist with RLS + FORCE RLS; all four RPCs exist, every one `SECURITY DEFINER` with `search_path=""`; EXECUTE held only by `service_role` (and the owning `postgres` role); `anon` and `authenticated` cannot execute any of them; all 36 canonical tables present and **empty** |

The ledger is now **29 rows, 0000-0028, no duplicate**.

### Hosted synthetic acceptance

`npm run test:canonical-commit-hosted` ran against the same project with the
disposable prefix `U4-P4A7K2` and synthetic fixtures only. The real workbooks
were deliberately not supplied.

**149 assertions offered: 79 executed, 79 passed, 0 failed, 70 skipped.**

All **41** protected table counts were **identical before and after**. Measured
over the hosted transport, sizes and durations only:

| RPC | calls | largest body | slowest |
|---|---|---|---|
| `commit_canonical_package` | 17 | 2 708 898 bytes | 3 482 ms |
| `stage_canonical_package` | 20 | 23 295 bytes | 440 ms |
| `rollback_canonical_package` | 4 | 73 bytes | 520 ms |

**What the hosted run settled**, and what it did not:

| id | status | note |
|---|---|---|
| **T1** | proved on hosted | the gateway accepted and parsed a 2 708 898-byte plan body |
| **T2** | proved on hosted | a real commit finished in 3 482 ms, well inside the hosted statement timeout |
| **T3, T4, T5** | **re-proved on hosted** | result shape, error shape and code round trip hold on the hosted PostgREST build (`v14.15`/`14.5`), not merely on the local `16.2` substitute. 25 of the 34 codes were never provoked over HTTP by this run and are recorded as SKIPPED, one per code |
| **T6** | proved on hosted | deterministic commit, retry/replay, count reconciliation, rollback and repeated rollback all held |
| **T8** | proved on hosted | the service-role key executes all four functions |
| **T9** | **SKIPPED** | the transport declares `roleSwitch` only when BOTH an anon and an authenticated key are supplied. No `authenticated` key exists in the configured environment, so the HTTP privilege probes did not run. The denial itself is **not** unproved: `has_function_privilege` shows `anon` and `authenticated` cannot execute any of the four RPCs — that is a catalogue proof taken directly on the hosted project, not an HTTP one |
| **M2** | proved on hosted | `0026`'s index built against the populated `respondent` table |
| **M3** | **proved on hosted, against populated rows** | `0027`'s CHECKs are `convalidated` against the 6 existing `study_period_snapshot` rows — the case the local gate could only test against an empty table |
| **M4** | **SKIPPED** | catalogue parity with Supabase's own extensions and default privileges needs `pg_catalog`, which PostgREST does not expose; it remains a level-2 result |

The 70 skips break down as: 27 needing DDL the REST transport does not have,
25 error codes never provoked over HTTP, 8 needing `pg_catalog`, 5 needing
concurrent sessions, 4 needing a second role identity, and 1 needing the real
workbooks. Every one is reported as skipped and **none is counted as a pass**.

### What was still NOT done AT THE END OF UNIT 3

⚠️ **This subsection describes the state AFTER the synthetic acceptance run and
BEFORE the real import. It is history, not current state.** At that point the
canonical tables had only ever held synthetic `U4-` fixtures, the acceptance run
had deleted them, and all 36 were empty.

**The real Cuicuilco package was imported on 2026-09-06** — import job
`1886a359-f2c9-483a-8b5e-979931841a71`, 8 588 rows across 32 families, plan
fingerprint `sha256:099863e8bd0a74477611ae0e35f29eb83cccf912c5de7a56b0c07952970e7bfc`.
The Cuicuilco study is still untouched at 60 / 3 282 / 31 / 23 confirmed /
8 pending, `draft`; the old application read paths remain authoritative and
nothing reads the canonical tables. See `docs/CURRENT_STATE.md` §"Unit 5
Phase 2" and `docs/CANONICAL_RESULTS_MODEL.md` §12.

Still unproved anywhere: recovery from a timeout killed mid-commit.

| id | result | measured |
|---|---|---|
| **T1** | proved **at the PostgREST layer only** | a 2 708 830-byte (2.58 MiB) plan body reached the function and was parsed, answering `JOB_NOT_FOUND` in 110 ms. The largest real commit body was 2 708 898 bytes at 441 ms. |
| **T3** | proved on the LOCAL substitute; **pending re-proof on hosted** | supabase-js returns the `jsonb` result unwrapped — a bare object, no array and no named envelope — carrying `importJobId`, `status`, `replayed`, `counts`, `commitAttempts` and `rollbackCount`. |
| **T4** | proved on the LOCAL substitute; **pending re-proof on hosted** | `COMMITTED_PAYLOAD_DIFFERS` survives PostgREST, supabase-js and `safeErrorCode` as that code, not as `CLIENT_TRANSPORT`. |
| **T5** | proved on the LOCAL substitute for what that run raised; **pending re-proof on hosted** | 9 of the 34 codes crossed the transport as themselves and none was flattened to `CLIENT_TRANSPORT`. The other 25 were never provoked over HTTP by this run and are recorded as SKIPPED, one per code. Most refusals travel as a **200 body** of the shape `{ status: 'failed', code }`, not as an HTTP error — migration 0028's subtransaction catches them. |
| **T8** | proved | the service-role KEY executes all four functions (SQLSTATEs `none`, `22023`, `P0002`, `P0002` — business answers, never `42501`). |
| **T9** | proved | anon and authenticated KEYS are refused `42501` on all four functions, and on `import_job_record`, `retention_period`, `person_private` and `survey_response`. |
| **M1** | proved | migrations 0000-0028 apply cleanly, verbatim, on PostgreSQL **17.11** — the major `supabase/config.toml` pins. |
| **M3** | proved **against an empty table** | 0027's CHECK constraints are created and accepted on 17. Validation against *existing* `study_period_snapshot` rows needs a populated table and stays hosted-only. |
| **M6** | proved | `X7.1`/`X7.2`/`X7.5` on 17: the 0028 reverse refuses with `CANONICAL_PACKAGES_STILL_OWNED` while a package owns rows, and succeeds once it is reversed. It needs DDL, so it is a level-2 result, not an HTTP one. |
| **L1-L16, X1-X8** | proved over HTTP except where a capability is absent | 102 executed. `L14` in full — 19 executions with real anon and authenticated JWTs. |

**Skipped over HTTP, and why — 66 records.** `L4`, `L5`, `X6b`, `X6c` and `X3`
need DDL to make a healthy database fail halfway through a commit; `L15`, `L16`
and `X7` need `pg_catalog` or the execution of a migration file; `L9` needs one
session to hold the job lock while another waits. Each is recorded as a SKIP
naming the missing capability, and each is proved at level 2 instead. A skip is
never counted as a pass.

**Still unproved, and not to be described otherwise:**

- **T2** — the hosted API gateway's own request-body limit. The 2.58 MiB body
  proved here passed *PostgREST*; Kong/Envoy and Cloudflare in front of a hosted
  project are a different limit that no local stack reproduces.
- **T6** — the hosted `statement_timeout` for `service_role` under load.
- **T7** — recovery from a timeout killed mid-commit.
- **M2** — building 0026's index against a populated `respondent` table.
- **M4** — catalogue parity where Supabase's own extensions, roles and default
  privileges differ from a bare cluster.

#### The runner and its guards

| module | what it guarantees |
|---|---|
| `scripts/lib/hosted-target.mjs` | accepts exactly ONE named project. No default: an unset ref is a refusal. A second variable must spell that ref out inside `I-AUTHORIZE-MUTATION-OF-<ref>`. A supplied API URL that disagrees with the ref is a refusal. The service key is checked for PRESENCE only and never logged, returned or written. Every refusal names the RULE, never the value. No code path reads a `.env` file. |
| `scripts/lib/hosted-evidence.mjs` | artifacts land outside the worktree and outside the main repository this worktree is linked to; every one is scanned by `secret-patterns.mjs` BEFORE it is written and a finding REFUSES the write rather than redacting it; the transport journal's field list cannot express an argument or a response body. No screenshots. |
| `scripts/lib/canonical-rest-transport.mjs` | declares `ddl`, `catalogue`, `rawSql` and `concurrentSessions` as ABSENT, so those assertions skip visibly. Unfiltered counts are deltas against a baseline census, because a hosted database is not empty. |
| `scripts/canonical-commit-hosted-test.mjs` | read-only inventory and a census of all 41 protected tables before and after (counts only, never a row); a disposable tenant and study stamped `U4-XXXXXX`; the shared suites with a per-suite baseline and sweep; reverse-then-delete in a `finally`; re-census; evidence. |
| `scripts/lib/local-postgrest-stack.mjs` | generates its signing secret per run, writes its config `0600`, binds loopback only, prints no key, and leaves no process or file behind. |
| `npm run test:hosted-target-guard` | **in `npm test`.** 153 assertions executing every refusal above, including starting the hosted runner with an unauthorized environment and watching it exit 2 without creating an evidence directory. |

## Unit 5 Phase 2 — the real import, through this unit's own workflow

**2026-09-06.** The real Cuicuilco package was imported into
`ontvqazsqiwisdddblif`, tenant `e63b2092-244e-4751-b7e9-19172a9f6b41`, study
`cd4d6acd-88b9-4804-829f-75b6d91a32b7`, as import job
`1886a359-f2c9-483a-8b5e-979931841a71`. Plan fingerprint
`sha256:099863e8bd0a74477611ae0e35f29eb83cccf912c5de7a56b0c07952970e7bfc`,
package key `sha256:bb9a4a98497ef38f6e2d1962de0d8596e5b968e1987ad8b8eceb6ad6df8b3097`.

**Nothing in Unit 3 changed to make it possible.** `runCanonicalCommit` ran
exactly as this document describes it: it preflighted the exact bytes, projected,
staged the fingerprint, committed once, and reconciled. 6 232 ms end to end for a
2 704 594-byte body; 8 588 rows across the 32 families; 3 559 ownership rows, all
`created`; 60 persons and 60 external identifiers created, none reused. The same
request replayed reported `replayed = true`, reused the same job and wrote
nothing.

What Unit 5 Phase 2 ADDED around it is an operator
(`scripts/canonical-import-operator.mjs`) and a third target guard
(`scripts/lib/canonical-import-target.mjs`), described in
`docs/CANONICAL_RESULTS_MODEL.md` §12.5. The operator counts every canonical
table itself after the commit, so the plan's declared counts, the database's own
measurement inside the commit and an independent per-table count all had to
agree — and did. It has no manual-deletion path: a disagreement is answered by
`rollback_canonical_package`, which was not needed.

The full record — counts per table, parity, the backup and its restore
rehearsal, the legacy before/after and every skipped check — is in
`docs/CURRENT_STATE.md` §"Unit 5 Phase 2".

⚠️ **T7 is still unproved**: recovery from a timeout killed mid-commit. This
commit did not come near the timeout, which is evidence about THIS package and
not about the failure mode.

## Deliberately outside Unit 3

- no Supabase project was changed and no migration was applied anywhere;
- no Cloudflare Worker was built, deployed or promoted;
- no existing Cuicuilco data was migrated and no real workbook was uploaded;
- no UI, route, dashboard or client publication was changed;
- no AI categorization was introduced;
- no client-facing calculation and no legacy import behaviour was changed;
- nothing was written to any canonical table, in any environment.

⚠️ **Scope note.** These statements are about Units 1-3 and remain true of them.
They are NOT a claim about the hosted project in general. Unit 4 inventoried it,
backed it up and deleted one duplicate legacy study through a rehearsed
fail-closed transaction, and then applied the canonical migrations. **Unit 5
Phase 2 then imported the real Cuicuilco package into the canonical tables**
(2026-09-06, import job `1886a359-f2c9-483a-8b5e-979931841a71`), so "nothing was
written to any canonical table" is a statement about Units 1-3 and is FALSE of
the project today. See the hosted project status and the Unit 5 Phase 2 record
in `docs/CURRENT_STATE.md`.
