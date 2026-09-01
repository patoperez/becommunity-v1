# Canonical study model

## Purpose

The current ingestion model remains available for existing studies. Migrations
`0022` and `0023` add the normalized layer required to preserve the full meaning
of multi-workbook studies without treating every worksheet row as an unrelated
respondent or flattening source distinctions into dashboard keys.

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

All 34 new tables are internal-only:

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
3. execute the focused structural gate and database/RLS smoke tests;
4. build the package importer against these tables;
5. import the two Cuicuilco workbooks into a disposable study;
6. reconcile counts, source lineage, metric bands, journeys and findings against
   the approved mapping workbook before any production promotion.

Reverse order:

1. `0023_drop_canonical_analysis_model.sql`;
2. `0022_drop_canonical_ingestion_foundation.sql`.

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

Three reader corrections matter for meaning, not tidiness:

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

## Deliberately outside these units

- no Supabase project was changed;
- no migration was applied anywhere;
- no Cloudflare Worker was built, deployed or promoted;
- no existing Cuicuilco data was migrated;
- no UI was changed;
- no AI categorization was introduced;
- no client-facing calculation was changed;
- nothing was written to any canonical table.

The next unit (Unit 3) is the server-only transactional commit and rollback
workflow: an atomic RPC that consumes this preflight, writes the canonical rows
and their `source_lineage` in one transaction, records `import_job` counts, and
reverses the whole package on any failure.
