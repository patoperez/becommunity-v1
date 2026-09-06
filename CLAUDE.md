# CLAUDE.md — Be Community Platform

> Operational rules for Claude Code on this repository. Read this every session.
> Standing rules originate in the V1 audit (`AUDIT_V1.md`, 2026-07-07) and
> subsequent verified phases. Read `docs/CURRENT_STATE.md` for the authoritative
> current handoff before planning any task. Rules marked ⓘ are audit-derived
> guardrails — they are standing rules, not suggestions.

---

## What this project is

Be Community is a **multi-tenant B2B Business Intelligence & Data Storytelling
platform** for an education-sector consulting firm. It ingests raw survey /
focus-group / observation data and turns it into interactive dashboards and
data-connected journey maps for the firm's clients (schools).

**It is NOT a CRM.** No sales pipelines. The product is data → insight → client-facing story.

- P0-P8 and the first P9 real-study hardening units are merged into `main`.
  The provisional Worker and Supabase project are still not the final
  production environment. Read `docs/CURRENT_STATE.md` before inferring what is
  deployed, applied or safe to promote.
- Full V2 architecture lives in `BeCommunity_V2_Technical_Architecture.docx` (reference only — consult, don't inline).
- Project background and decisions live in `system_context.md`.

## Tech stack  *(verified against package.json + config, 2026-08-22)*

- Framework: **Next.js 16.3.2** (App Router) + **React 19.2.4** + **TypeScript ^5, `strict: true`**.
- Styling: **TailwindCSS v4** (`@tailwindcss/postcss`).
- Backend/DB: **Supabase Cloud** (`@supabase/supabase-js 2.108.2`, `@supabase/ssr 0.12.0`) — Postgres + Auth + Storage + RLS.
- Deployment: **Cloudflare Worker via `@opennextjs/cloudflare 1.20.1`**, `nodejs_compat`. The full Next server runs on the **Node.js runtime** (not Edge); middleware uses the **Edge `middleware.ts` convention** because OpenNext rejects Node middleware. ⓘ **`nodejs_compat` is NOT a guarantee that a Node library works.** workerd's `unenv` shims throw on unimplemented APIs, and ExcelJS's Node entry dies on a module-level `process.umask()` (via `unzipper` → `fstream`). `.xlsx` therefore loads ExcelJS's **browser** build lazily — see `src/lib/ingestion/parse.ts` and the `test:workers-ingestion` gate.
- Data engine: Workers-safe native table/aggregation code in
  `src/lib/calc/table.ts`, `engine.ts`, and `pivot.ts`. **Arquero 8.0.3 is
  dev-only**, retained as a parity oracle and positive control; production code
  must not import it because its runtime code generation is forbidden by workerd.
- Validation: **Zod 4.4.3** at ingestion, login, admin actions, dashboard data
  actions, report/preview params, study scope, branding, templates, journey and
  dashboard configuration boundaries. New untrusted boundaries must follow the
  same reject-by-default pattern.
- Ingestion: **PapaParse 5.5.4** (CSV) + **ExcelJS 4.4.0** (.xlsx), both in use (`src/lib/ingestion/parse.ts`).

## Non-negotiable rules

### Security (see system_context.md for the honest security goal)
- The goal is **defense in depth, minimal attack surface, contained blast radius, and detection** — NOT "impenetrable" (no system is; claiming it breeds dangerous overconfidence).
- **RLS on every public table, no exceptions.** A public table without RLS is a
  leak. `npm run test:rls-coverage` is the executable pre-merge/pre-deploy check:
  it reads the coverage inventory through migration `0014`'s metadata-only
  reporting function and must report every public ordinary/partitioned table as
  both **RLS-enabled and FORCE RLS** — zero exceptions on either — and it proves
  in the same run that `anon` and `authenticated` cannot execute that function.
  `supabase/tests/rls_coverage.sql` remains the equivalent manual diagnostic for
  the SQL editor.
- **Authorization is enforced server-side on every route and mutation**, never only in the frontend. Hiding a UI element is not access control. Session checks use `getUser()`, **never `getSession()`**, for any auth decision.
- ⓘ **Least privilege at the database, not just the UI.** Client-role users are
  read-only at the RLS/grant level through migration
  `0002_least_privilege_client_reads.sql`; internal mutations use explicitly
  authorized server paths/service role. Preserve and adversarially verify this.
- **Tenant isolation is sacred.** A user of tenant A must never read or write tenant B data. This is verified adversarially (authenticate as A, attempt B, assert failure — `scripts/isolation-test.mjs`), never assumed. **Run that test against the live DB before trusting isolation** — the SQL editor bypasses RLS and proves nothing.
- Secrets live in `.env` only (gitignored), injected at runtime. The Supabase `service_role`/secret key is **server-only** (`import "server-only"` in `src/lib/supabase/admin.ts`) and must never reach the browser bundle or git. Only the publishable/anon key is client-side.
- Validate every new input boundary (uploads, forms, params) with Zod before use.
  Reject by default and preserve the existing boundary schemas.
- Render user-generated qualitative content only through React's escaped text
  nodes; never introduce `dangerouslySetInnerHTML`. Only human-confirmed themes
  and independently approved quotes may cross the client/publication boundary.
- ⓘ **Absence is not a client-facing finding.** What Be Community chose not to
  publish — or has not finished reviewing — renders as nothing on the client
  side: no placeholder, empty card, heading, reserved row or copy explaining the
  gap. This does **not** apply to caveats about a result the client *is* shown
  (small base, suppressed segment, missing data behind a visible number) — those
  are analytical honesty and must stay. Internal Studio and
  `/admin/preview/[studyId]` own the omission warnings, visibly marked as
  internal. Contract C11 in `docs/P8_PRODUCT_EXPERIENCE_PLAN.md`.

### Calculation integrity
- Composite metrics (NPS, CSAT, Top-2-Box) are **canonical functions defined once** (`src/lib/calc/metrics.ts`), unit-tested against known-good outputs (`scripts/calculation-test.mjs`). A wrong number does not throw — it misleads a client. This is a human-review zone.
- ⓘ **Kano is OUT OF SCOPE.** The consultant's process documentation states explicitly: *"No se va a utilizar este modelo"* (§4.4). Do not build it.
- **Rounding/precision is governed by `docs/CALCULATION_POLICY.md`** — one canonical helper (`roundTo`, half away from zero, Excel `ROUND()` parity), precision declared per unit in `DECIMALS`, every value rounded exactly once. Never round with `toFixed`.
- Aggregations use the canonical Workers-safe engine and pivot implementation.
  Arquero may be used only in tests as a parity oracle, never in
  production-reachable code.
- **Do not invent formulas.** Confirmed business rules live in `docs/CALCULATION_CATALOG.md`; implement only formulas marked authoritative there. Keep template-varying mappings and crosses in configuration.

### Data & config
- **Configuration over code:** anything varying per client/study (journey stages, dashboard sections, segmentation, branding) lives in data (JSON/columns), never hardcoded. *(Realized: journey renders from `study.journey_definition` jsonb.)*
- Small data, rich structure: volumes are tiny (thousands of rows/study). No premature pipelines, caches, or precomputation. Compute fresh, on demand.
- **Ingestion prefix convention** (`src/lib/ingestion/adapters/wide-survey.ts`): `seg_<key>` → `respondent.segments`, `q_<metric>` → `quant_response`, `qual_<theme>` → `qual_observation`, `source` → qualitative source override. New file shapes = new adapter, never a schema change.

## Human-review zones (never merge without human review)
1. **Authorization & sessions** — every RLS policy, grant, server-side authz guard, middleware, role logic.
2. **Calculation code** — canonical metric functions and Arquero pipelines.
3. **Secrets & security config** — env handling, keys, CSP, headers.

## Workflow rules
- **Plan before code.** Propose a plan; wait for approval before writing, especially for security-adjacent work.
- One task at a time on a given set of files.
- Verify every npm package before install (it exists, correct name, no known CVE). Pin versions (runtime deps are exact-pinned; keep it so).
- ⓘ **Regenerate `package-lock.json` only under npm 10.9.2** — the version
  declared in `package.json` (`packageManager`) and enforced by CI and Suite D's
  **D-f**. npm 11 prunes peer nodes beneath platform-excluded optional
  dependencies; npm 10 (which Cloudflare's build image runs) still requires them,
  so an npm 11 regeneration passes every local gate and then fails the deploy
  build with `npm ci … Missing: @emnapi/…`. Never repair that by hand-editing the
  lockfile or by adding an install bypass flag.
- Migrations are versioned in git, applied to **staging first**, tested, then production. Never edit production schema/policies directly.
- Separate Supabase projects for dev/staging vs production. Real client data never enters staging.
- **Production repo stays clean:** no `CLAUDE.md`-style files, AI comments, or `§`/`Section` prompt-doc citations, or prompt files committed to production branches. *(Audit: `main` currently carries `CLAUDE.md`, `AGENTS.md`, `system_context.md`, `docs/FASE_*`, and §-citations in source — strip these on the production branch.)*

## Commands  *(from package.json)*
```
npm run dev          # next dev (local dev server)
npm run typecheck    # TypeScript strict check
npm run build        # next build (must pass before any deploy)
npm run lint         # eslint
npm test             # complete deterministic suite; package.json is authoritative
npm run gates        # gates:offline + gates:live (the complete release chain)
npm run gates:offline # credentials-free: typecheck, lint, test, build, cf:build, suite:d
npm run gates:live   # credential-bearing live chain: qualitative-live -> suite:a -> suite:b -> suite:c
npm run suite:a      # Suite A — tenant isolation, data scope, least privilege (A1-A5)
npm run suite:b      # Suite B — behavioral server-side authorization (B1-B7)
npm run suite:c      # Suite C — hostile input, imports, pivot boundary, injection (C1-C5)
npm run test:migration-chain # migration numbering contract: no duplicate number, applied
                             #   slots 0022-0025 pinned by SHA-256, canonical 0026-0028
                             #   contiguous above them, rollbacks matched, runners omit
                             #   nothing, no number in executable SQL, docs not lying
npm run test:isolation    # the legacy isolation gate alone; Suite A executes it as A1.5
npm run test:rls-coverage # live RLS coverage + 0014 privilege model (service_role / anon / authenticated)
npm run test:pivot        # the pivot allowlist gate alone; Suite C executes it as C3.1
npm run suite:d      # Suite D — dependency advisories, pins, lockfile, git history, artifacts
npm run cf:build     # opennextjs-cloudflare build  -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + wrangler deploy (Cloudflare Workers)
```

`suite:a`, `suite:b` and `suite:c` — and so `gates:live` and `gates` — each
drive a real browser against a running application. It needs the app served at `HARNESS_ORIGIN` (default
`http://localhost:3000`), real synthetic credentials, and a Chrome/Chromium
binary named by `CHROME_PATH`. Run it from WSL as an ordinary (non-root) user
with the distribution's own Linux browser, so the sandbox stays on and
`--no-sandbox` is never needed.

### Where these commands may run ⓘ

**Do not run repository npm lifecycle commands from Windows on this
workstation.** That includes `npm install`, `npm ci`, `npm test`,
`npm run build`, `npm run cf:build` and any gate chain
(`gates`, `gates:offline`, `suite:d`, `suite:d:local`).

Smart App Control is enabled here and blocks Cloudflare's unsigned
`workerd.exe`. The boundary is **not** limited to `cf:build`: a plain `npm ci`
runs package lifecycle/install validation that loads that binary, and Windows
Code Integrity event 3077 has recorded exactly that. Do not disable Smart App
Control and do not attempt a per-file bypass.

- **Windows** is for editing, Git operations, and static/non-Node inspection
  (`git diff --check`, reading files, reviewing a diff).
- **Node/npm verification runs in WSL 2 Ubuntu or Linux CI.** Verifier:
  `/home/patop/becommunity-software`, ordinary user `patop`, Node 24.11.1,
  npm 10.9.2.
- The Windows and WSL clones **do not auto-synchronize**. Push the exact commit
  from the Windows editing tree, then `fetch` and check out that exact remote
  commit in WSL before testing. Never assume the verifier already has your work.
- Suite D's D-d scans every reachable blob, so the verifier clone must be a
  full-history, full-blob clone — a `blob:none` partial clone cannot prove it.

Never claim a Windows npm command was avoided unless the Code Integrity
evidence supports it. The older note that "a plain `npm run build` must still
pass locally" does not hold on this machine; Cloudflare's Linux branch build and
the WSL verifier are the authoritative build checks.

## Build order (V2) — do not skip ahead
P0 Security hardening (headers, WAF, rate limits, secret hygiene, staging/prod split, **least-privilege grants**, **Zod at all boundaries**, **prove RLS at runtime**)
P1 Canonical calculation layer (generic metrics; match V1/Excel outputs)
P2 Universal ingestion (visual column mapper, staged validation, recoding)
P3 Template-system framework (Word-style start screen, library, save/instantiate — copy semantics)
P4 BI overhaul (cross-filter, pivot, journey map, qualitative human-in-the-loop)
P5 Client portal + longitudinal memory
P6 Visual backoffice
P7 Full hardening pass + all adversarial suites + backups + incident playbook
P8 Product experience transformation (real-product increments; Insights + Studio + theming)

Each phase must pass its adversarial security suite before the next begins.
The template **framework** ships in V2; the template **content** (real formulas,
named starter templates) is populated in V2.5 after the consultant's workflow is documented.
Do not block V2 waiting for that documentation.

## Current work — canonical multi-workbook study model

The authoritative state is `docs/CURRENT_STATE.md`.

P0-P8 are closed. `main` at `c76762f` also includes the P9 real-study ingestion
and hardening corrections through migration `0021`. The current bounded unit is
an additive canonical model for the audited Cuicuilco workbook package; its
contract is documented in `docs/CANONICAL_STUDY_MODEL.md`.

- ⓘ **The renumbering is DONE: canonical owns `0026`, `0027` and `0028`.**
  `0022_canonical_ingestion_foundation` → `0026`, `0023_canonical_analysis_model`
  → `0027`, `0024_canonical_commit_and_rollback` → `0028`, with the three reverse
  scripts renumbered identically. The three numbers were proved free by
  enumerating every remote branch: the highest migration number anywhere is
  0025. Supabase tracks applied migrations by NUMBER, so the old numbering would
  have been skipped or conflicted against a project already recording a 0022 —
  both quiet enough to look like success. `npm run test:migration-chain` now
  fails if a duplicate number, a reoccupied applied slot, a non-contiguous
  canonical run or a mismatched rollback ever returns.
- ⓘ **`0022`-`0025` in this tree are IMPORTS of already-applied history, not
  this branch's work.** `0022_semantic_category_review`,
  `0023_experience_definition_persistence`, `0024_experience_draft_conflict_code`
  and `0025_experience_publication`, plus their four reverse scripts, are copied
  byte-for-byte from `origin/claude/experience-publication-versioning` (6311f0a),
  the one branch carrying all eight. Every other branch holding any of them holds
  the identical blob, so there was no candidate to choose between. All four are
  ALREADY APPLIED to the hosted project and its ledger records them. Never
  re-apply them, never edit them here, and never read `0022`-`0025` as
  canonical-model migrations. The full map and the authoritative hashes are in
  `docs/CANONICAL_STUDY_MODEL.md`.
- ⓘ **The hosted project's schema is AHEAD of `main`, which is the same drift
  `0016` was written to remove.** The hosted ledger
  (`supabase_migrations.schema_migrations`) recorded 26 versions, 0000-0025,
  ending in `semantic_category_review`, `experience_definition_persistence`,
  `experience_draft_conflict_code` and `experience_publication` — none of which
  is on `main`. It now records **29 versions, 0000-0028**: the canonical chain
  was applied there on 2026-09-06. `study_experience_event` holds 86 rows written under numbers this
  branch also used, so the database made that numbering a fait accompli and the
  canonical branch was the cheap side to move. **This branch now carries those
  four migrations too**, so the repository describes the schema the project
  actually has; the drift is reconciled in source, not merely documented. The
  ledger records no timestamp, so "when was 0022 applied" needs a different
  source.
- ⓘ **Migrations `0026`, `0027` and `0028` ARE APPLIED to the hosted project**
  (`ontvqazsqiwisdddblif`), on 2026-09-06, through `supabase db push` so the
  official ledger recorded them — no entry was hand-written. Each was applied
  and verified separately: 8.19 s, 7.91 s, 8.26 s. The ledger is now 0000-0028,
  29 rows, no duplicate. A fresh verified backup was taken immediately before
  and is **retained**. Nothing was seeded, no earlier migration was reapplied or
  repaired, and no auth or storage schema was touched. **No real workbook has
  been imported: all 36 canonical tables are empty.**
- **Unit 2 (`src/lib/ingestion/canonical-package/`) parses and validates only.**
  It writes nothing: no Supabase client, no insert, no RPC, no canonical row.
  `npm run test:canonical-package` fails if one appears.
- **Unit 3 (`src/lib/ingestion/canonical-commit/`) is the server-only commit and
  rollback.** Three rules govern it. (1) The privacy-safe preflight DTO is NOT
  the persistence payload and must not be widened into one:
  `CanonicalCommitPlan` is a separate internal type that carries real values and
  may travel only to `p_plan` of `commit_canonical_package`. (2) `adapter.ts` and
  `server.ts` carry `import "server-only"` and are the only modules that know
  about Supabase; `index.ts` re-exports neither. (3) Tenant and study scope is
  derived from a LOCKED `import_job` row and every count is measured by the
  database — never taken from a payload. `npm run test:canonical-commit` (gate
  in `npm test`) enforces all three.
- **Three levels of proof, and they are not interchangeable.** (1) Projection:
  `npm run test:canonical-commit`, in `npm test`. (2) Local PostgreSQL
  transaction: `npm run test:canonical-commit-live`, EXECUTED against a
  disposable cluster, deliberately outside `npm test`. (3) HTTP transport:
  `npm run test:canonical-commit-local-stack`, EXECUTED — supabase-js over a
  real PostgREST 16.2 in front of a disposable PostgreSQL 17.11 cluster, 102
  assertions passed. It settled the supabase-js result and error shapes, the
  service-role key path, and that PostgREST accepts a 2.58 MiB RPC body.
  ⓘ **RE-EXECUTED over the reconciled `0000`-`0028` chain** (2026-09-06), after
  the renumbering. Same result — 102 executed, 102 passed, 0 failed, 66
  skipped — so the renumbering and the four imported migrations cost the HTTP
  transport nothing. The first run was over the old `0000`-`0024` chain and no
  longer describes what is on disk; both are recorded in
  `docs/CANONICAL_STUDY_MODEL.md` so neither is mistaken for the other.
  ⓘ **None of the three is hosted canonical execution.** Level 3 is a LOCAL
  PostgREST in front of a LOCAL cluster; it is not equivalent to running the
  canonical chain on the hosted project, and it must never be reported as if it
  were — and the hosted run is now a SEPARATE, EXECUTED result (79 executed,
  79 passed, 0 failed, 70 skipped), recorded in `docs/CANONICAL_STUDY_MODEL.md`.
  Neither substitutes for the other.
- ⓘ **The hosted project runs a DIFFERENT PostgREST build. T3, T4 and T5 have
  now been RE-PROVED there** by executing the same assertions over the hosted
  transport rather than by arguing from the local ones. The local substitute
  reports `16.2` (upstream
  release numbering); the hosted project reports `v14.15` in the CLI's
  `rest-version` metadata and `14.5` in its own OpenAPI `info.version`. Those
  two hosted numbers disagree with each other, so neither maps onto the local
  one. Never call the hosted build "older" or "two majors behind" — only
  "different", until the numbering is established.
- ⓘ **The hosted project HAS been contacted, and exactly ONE mutation has been
  executed against it.** In order: a read-only inventory, a read-only
  duplicate-study diagnostic over a direct connection, a VERIFIED full data
  backup, and one rehearsed fail-closed deletion of a duplicate legacy study.
  The correct Cuicuilco study — 60 people, 3 282 quantitative answers and its
  reviewed qualitative work including 23 confirmed themes — is intact and was
  verified after the deletion. **The backup is retained and must not be
  deleted**, and neither may any diagnostic evidence. Since then the canonical
  migrations were applied there, and a synthetic acceptance run created and then
  deleted its own `U4-` records. Every one of the 41 protected table counts was
  identical before and after that run, and the Cuicuilco study still reads
  60 / 3 282 / 31 / 23 confirmed / 8 pending.
- ⓘ **Of the five things nothing local could prove, three are now proved on the
  hosted project and two are not.** PROVED there: the hosted API gateway accepts
  the canonical RPC body (2 708 898 bytes reached `commit_canonical_package`);
  the hosted statement timeout is not hit by a real commit (slowest 3 482 ms);
  and `0026`'s `respondent_id_tenant_study_uidx` built against the populated
  `respondent` table and reports `indisvalid`. STILL UNPROVED: recovery from a
  timeout killed mid-commit, and catalogue parity with Supabase's own extensions
  and default privileges — `pg_catalog` is not reachable over PostgREST, so
  those assertions skip on that transport and remain level-2 results. A green
  local-transport run must still never be reported as a hosted one.
- ⓘ **The level-2 count is 135 executed + 1 skipped without the real
  workbooks, and 140 with them.** The real-package case (`X8`) needs
  `CANONICAL_COMMIT_TEST_CLEAN_XLSX` and `_PAIN_XLSX`; without them it is
  SKIPPED and reported as skipped, never as a pass. A run that quotes "140"
  must say it supplied the workbooks. The suite reports executed, passed,
  failed and skipped as four separate numbers for exactly this reason.
- ⓘ **The assertions are transport-neutral and must stay so.**
  `scripts/lib/canonical-suite.mjs` holds them; it reaches the database only
  through the contract in `canonical-suite-transport.mjs`, so the local runner
  (`canonical-commit-live-test.mjs`, psql) and the hosted runner
  (`canonical-commit-hosted-test.mjs`, supabase-js) answer the SAME questions.
  A transport DECLARES its capabilities and an assertion it cannot execute is
  recorded as SKIPPED naming the missing capability — never dropped, never
  counted as a pass. `npm run test:canonical-commit` fails if the suite learns
  about psql again.
- ⓘ **The hosted-target guard is the opposite of the disposable guard, and the
  two must stay separate modules.** `scripts/lib/disposable-postgres.mjs`
  refuses anything that looks like Supabase; `scripts/lib/hosted-target.mjs`
  accepts exactly ONE named project and refuses everything else. There is no
  default target, a second variable must spell the ref out inside a sentence
  about mutation, and neither module reads a `.env` file.
  `npm run test:hosted-target-guard` (in `npm test`) executes all 153
  refusals — including starting the hosted runner with an unauthorized
  environment and watching it exit 2 — so weakening a guard is a red offline
  gate, not a surprise during a run against a live project.
- ⓘ **The database gate must stay executable.** It creates disposable
  `becommunity_canonical_test_*` databases on a loopback host or a unix socket,
  applies migrations 0000-0028 verbatim — including the four imported 0022-0025
  files — and refuses to run if a remote host, a
  password, a Supabase host or a `SUPABASE_SERVICE_ROLE_KEY` is in scope. Those
  refusals are executed by `npm test`, so weakening one is a red offline gate.
  If a check there ever becomes a source-text match again, it has stopped being
  a database test: level 2 found five defects that level 1 could not see.
- ⓘ **The disposable server's root is validated before anything is deleted.**
  `scripts/lib/disposable-postgres-provision.sh` removes directories
  recursively, so its root is canonicalised with `realpath -m` and must be a
  direct child of the canonical home named `becommunity-pg` or
  `becommunity-pg-test-*`. `BECOMMUNITY_PG_VERSION=17` pins the server to the
  major `supabase/config.toml` declares; a major the distribution archive does
  not carry is fetched from the PostgreSQL APT pool and its SHA-256 must match a
  pinned value BEFORE it is unpacked. An empty override is refused, never
  defaulted. There
  is exactly ONE `rm -rf`, inside a guarded function that re-validates the root
  immediately before deleting; every other destructive path calls it. Process
  termination identifies the postmaster through `/proc` — never with a
  `pkill -f` pattern that could match an unrelated server. `--check-root`
  validates and does nothing else, and section [20] of the offline gate proves
  seventeen refusals inside a throwaway home.
- The existing ingestion and client read paths remain authoritative. Do not
  switch them to the new tables until the deterministic package importer,
  reconciliation and compatibility tests exist.
- ⓘ **The server-side results layer EXISTS: `src/lib/results/`.** Unit 5 Phase 1
  built the versioned, aggregate-only contract a future dashboard receives, plus
  its in-memory adapter over the canonical projection. Its rules, its two open
  resolved authority decisions and its journey-ownership rule are documented in
  `docs/CANONICAL_RESULTS_MODEL.md` — read it before touching that folder.
  Nothing in it defines a formula: every number delegates to
  `src/lib/calc/metrics.ts` / `business-metrics.ts`. `npm run test:canonical-results`
  (in `npm test`) fails if a module there reaches a transport, or if any React
  component or browser module imports a metric definition or re-implements one.
  Golden parity against the approved dashboard is
  `npm run test:canonical-results-parity <clean.xlsx> <curated.xlsx>` — read-only,
  offline, and deliberately OUTSIDE `npm test` because its inputs are
  machine-specific; run without workbooks it reports itself SKIPPED, never as a
  pass. Executed 2026-09-06: 534 offered, 531 executed, 531 passed, 0 failed,
  0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required. **No real
  workbook was imported and the canonical tables are still empty.**
- ⓘ **The authority questions are RESOLVED (2026-09-06). Do not reopen them.**
  (1) **TDP is the §4.1 ratio** — unawareness over the VALID base (satisfied +
  dissatisfied); it may exceed 100 and is never clamped. `processUnawarenessTdp`
  is the implementation and `docs/CALCULATION_CATALOG.md` §5 was corrected. The
  proportion over all classified responses survives as an auxiliary under its
  own name, `unawarenessShareOfResponses`, and must never be called TDP.
  (2) **Esfera × CRI is forbidden** (§5.2). The approved dashboard offering it
  is a reference-dashboard deviation. Do not add or enable that cross anywhere.
  (3) **A touchpoint directly owns its CSAT, TDP and auxiliary share; no
  study-level metric attaches to a stage implicitly.** `journeyStageEvidenceLinks`
  stays empty unless explicit study/template configuration supplies a link.
  (4) **The curated journey pain cloud is editorial content**, not a calculation
  and not a blocker. Never copy the approved dashboard's alias table into
  production code, and never invent a phrase-splitting rule.
- ⓘ **The approved future dashboard is REFERENCE ONLY, and calculations stay on
  the server.** `C:\dev\becommunity-software\becommunity-bni-cuicuilco-demo` at
  `a7248fdbccd139da80ed7c09daa70f006a62b9cf` is the approved visual and numerical
  north for the future product. It is read-only: do not edit that repository, do
  not copy its hardcoded Cuicuilco values into the product, and do not begin
  dashboard UI work from it. When that work is authorized, its components must
  RECEIVE authoritative calculated results from a server-side canonical read
  model. The frontend must never become the owner of a business calculation —
  the standing rule that composite metrics are canonical functions defined once
  applies to the future dashboard exactly as it applies today.
- `readXlsx()`/`parseXlsx()` are the LEGACY reader and their behaviour is
  frozen — every existing study was imported through them. The canonical
  multi-sheet reader is `readXlsxWorkbook()` in the same module; both must stay
  JSZip-only so ExcelJS remains unreachable from `src/`.
- Preserve source meaning: formatting is contextual evidence, missing states
  never become zero, a person is distinct from a study participation, and
  historical retention is distinct from the Oct 2025–Jun 2026 performance
  cycle.
- All canonical raw/internal tables remain service-only with RLS and FORCE RLS.
  Client publication continues through reviewed aggregate surfaces.
- No AI classification belongs in this unit. Build deterministic ingestion and
  human-verifiable provenance first.
- Never deploy, apply a migration, mutate Supabase or promote a Worker merely
  because local source and static checks are complete.

## When unsure
Ask. Do not guess on security, authorization, or calculations. A stopped task is
cheaper than a leak or a wrong number shipped to a client.
