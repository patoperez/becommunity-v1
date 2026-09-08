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
                             #   slots 0022-0025 pinned by SHA-256, canonical 0026-0029
                             #   contiguous above them, rollbacks matched, runners omit
                             #   nothing, no number in executable SQL, docs not lying
npm run test:isolation    # the legacy isolation gate alone; Suite A executes it as A1.5
npm run test:rls-coverage # live RLS coverage + 0014 privilege model (service_role / anon / authenticated)
npm run test:pivot        # the pivot allowlist gate alone; Suite C executes it as C3.1
npm run test:canonical-viewer-filters # Unit 6B.2: interactive filter semantics — explicit
                                    #   connection only, OR/AND combination, multi-panel AND,
                                    #   unconnected-block byte identity, the honest empty state,
                                    #   the authored sample policy AFTER filtering, tampered and
                                    #   stale selections, the URL codec, out-of-order responses,
                                    #   and that no raw value or canonical key crosses.
                                    #   Synthetic, offline, in `npm test`.
npm run test:canonical-presentation # Unit 6A: opaque-handle registry, versioned presentation
                                    #   document, pure resolver, approved blueprint. Synthetic,
                                    #   offline, in `npm test`.
npm run test:canonical-presentation-persistence # Unit 6B.3A: the durable draft's ENCODING and
                                    #   its SAVE SESSION — a v4 document through jsonb and back,
                                    #   a column that contradicts the document, the legacy-family
                                    #   refusal, «Guardado» only of what is on screen, an older
                                    #   answer that must not mark newer work saved, a failure that
                                    #   preserves the work, a conflict that cannot resolve itself
                                    #   by writing, and the retry that repeats its key. 148 checks,
                                    #   synthetic, offline, in `npm test`.
npm run test:canonical-presentation-draft-live # Unit 6B.3A level 2/3: the SAME contract executed
                                    #   against a disposable PostgreSQL 17 — exact revision
                                    #   increment, idempotent replay, typed stale conflict, two
                                    #   genuinely concurrent races, atomic rollback, least
                                    #   privilege, and the two legacy rows byte-identical after.
                                    #   With BECOMMUNITY_POSTGREST_BIN it runs the contract a
                                    #   second time over a real PostgREST with supabase-js. 93
                                    #   assertions. Outside `npm test` (needs a cluster).
npm run test:canonical-presentation-parity <clean.xlsx> <curated.xlsx>
                                    # the approved blueprint against the REAL study, compared
                                    #   with the APPROVED DASHBOARD as the oracle (the CRI must
                                    #   render "33.0", not "33"). Outside `npm test`
                                    #   (machine-specific inputs); reports SKIPPED without the
                                    #   workbooks, never a pass.
npm run qa:canonical-presentation-draft # Unit 6B.3A real-route QA against a DISPOSABLE
                                    #   target: a throwaway PostgreSQL, a real PostgREST, a
                                    #   minimal authentication substitute so `/login` works, a
                                    #   synthetic canonical package, and a production build of
                                    #   the app pointed at all of it. 58 checks. It CANNOT run
                                    #   against the hosted project, and must not be made to.
npm run test:canonical-presentation-hosted-fingerprint # READ-ONLY. Proves the two legacy
                                    #   experience drafts are still v2/72 and v3/14, that neither
                                    #   is v4, that the experience log is unchanged, that 0029's
                                    #   storage EXISTS on the hosted project, and that it holds
                                    #   exactly one canonical draft — Cuicuilco's, at revision 1,
                                    #   with its pinned binding and definition digest, under one
                                    #   draft_created event — and that no other study has one.
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
  is on `main`. It now records **30 versions, 0000-0029**: the canonical chain
  was applied there on 2026-09-06 and the presentation-draft migration on
  2026-09-08. `study_experience_event` holds 86 rows written under numbers this
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
  repaired, and no auth or storage schema was touched. The canonical tables were
  EMPTY at that point; the real Cuicuilco package was imported into them later
  the same day — see the Unit 5 Phase 2 bullet below.
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
  applies migrations 0000-0029 verbatim — including the four imported 0022-0025
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
- ⓘ **A NAME A PERSON CHOOSES BY MUST BE UNIQUE, and the qualifier must be
  true.** Two blocks may carry the same authored title and two filter dimensions
  may carry the same SOURCE column header — the approved study does both, the
  second one six times over. `connectionCandidates` qualifies a colliding block
  by what it draws, then by its page, then by its position; the registry
  qualifies a colliding dimension by the POPULATION that answers it, read from
  the answers rather than from the attribute key. Never build a display label
  out of a handle or a canonical key, and never merge two dimensions that
  different cohorts answer: each is implicitly scoped to its own population, and
  one control for both would have to OR across two attribute keys inside the
  filter engine. Disambiguation is a DISPLAY decision — handles keep coming from
  the source label, so nothing already saved moves.
- ⓘ **The results contract is `2.2.0`, and both additions were LABELS.**
  2.1.0 added `FilterValue.label`, because `FilterValue` carried a `value` and
  nothing else and the cohort dimension therefore published `active` and
  `deserter` — internal enum values — to anything that offered them as controls.
  2.2.0 added `FilterDimension.cohortLabels`, which says which cohorts answered a
  characteristic so a surface can tell two identically-worded questions apart.
  Both are additive: nothing moved, nothing was re-typed and no number changed.
  Golden parity is still 531/531 and presentation parity 59/59.
- ⓘ **A SELECTION CANNOT CHANGE WHAT EXISTS.** The journey already stated and
  enforced this. Unit 6B.2 found it violated twice more, both silent and both
  live only under a filter: a performance PERIOD vanished when nobody in the
  selection was observed in it, and an undeclared COHORT's row vanished when the
  selection emptied it. Buckets, labels and rows now come from the source; only
  the contents are taken inside the selection. Neither changes an unfiltered
  document.
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
  0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required.
- ⓘ **The DATABASE-BACKED read adapter EXISTS: `src/lib/canonical-source/`.**
  It lands on the SAME neutral `CanonicalResultSource` seam as the in-memory
  adapter, so no calculator, contract or document changed when it arrived. It is
  one folder away from `src/lib/results/` on purpose — that folder must stay
  free of `server-only` and of every transport — and only `adapter.ts` and
  `server.ts` are `server-only`, only `adapter.ts` names a Supabase client, and
  `index.ts` re-exports neither. `person_private`, `person_external_identifier`
  and `source_lineage` are never read at all and `pain_point`'s two text columns
  are not in the row type: a name, a membership id, a raw cell and a
  consultant's prose never enter the process. Every read is a keyset page over a
  unique key, scoped by tenant AND study before any window, and a set larger
  than its declared ceiling THROWS instead of being truncated — PostgREST's
  silent 1000-row cap has been paid for here once already. §12 of
  `docs/CANONICAL_RESULTS_MODEL.md` is the contract; read it before touching the
  folder. `npm run test:canonical-database-source` (**74 checks**, in `npm test`)
  enforces it.
- ⓘ **`scripts/canonical-import-operator.mjs` is the ONLY way a real package is
  written, and it defaults to refusing.** It does not reimplement the commit:
  `runCanonicalCommit` still preflights the exact bytes, projects, stages,
  commits, reconciles and reverts on a count disagreement. The operator adds the
  target guard, the fingerprint gate, the study's state before the write, an
  INDEPENDENT count of all 32 families and of the ownership ledger, evidence
  written outside every Git repository, and a rollback path that goes through
  the product's own RPC — `.delete(` and `delete from` do not appear in the file
  and a gate asserts that. `--execute` additionally requires `--project <ref>`
  naming, on the command line, the same project the environment named.
  `scripts/lib/canonical-import-target.mjs` is the THIRD guard in that folder
  and must stay separate from the other two: it REFUSES the disposable
  acceptance run's own `CANONICAL_HOSTED_DISPOSABLE_PREFIX`, because that
  variable means "everything this run makes may be deleted again".
- ⓘ **THE REAL CUICUILCO PACKAGE IS IMPORTED into the hosted project**
  (`ontvqazsqiwisdddblif`), on 2026-09-06, as import job
  `1886a359-f2c9-483a-8b5e-979931841a71`: 8 588 canonical rows across 32
  families, reconciled three ways, replayed idempotently without writing a row,
  and read back through the database adapter at 531/531 golden parity with the
  approved dashboard. A fresh backup was taken and restore-rehearsed first, and
  it is **retained**. Every legacy count is unchanged — Cuicuilco is still
  60 / 3 282 / 31 / 23 confirmed / 8 pending, `draft`. **The canonical tables
  are populated and still UNREAD BY THE UI**: the application computes through
  `src/lib/dashboard/view.ts` and the client receives only the legacy payload.
  Since Phase 3 ONE server-only page reads them in a disabled-by-default shadow
  comparison — see the shadow bullet below for the exact door and the gate that
  keeps it the only one. The read-path switch is still separate, later,
  separately authorized work. Read `docs/CURRENT_STATE.md` §"Unit 5 Phase 2"
  and §"Unit 5 Phase 3" before describing any of it.
- ⓘ **THE SHADOW BOUNDARY EXISTS AND IS OFF: `src/lib/shadow/`.** Unit 5 Phase 3
  wired the canonical reader to the application's server-side loading boundary
  in a disabled-by-default shadow mode. The legacy result is still the ONLY
  thing the UI receives; the canonical document is read beside it, compared
  semantically, and the comparison is returned to the server and nowhere else.
  It needs BOTH `BECOMMUNITY_SHADOW_MODE=enabled` (that exact literal — `"true"`,
  `"1"` and a typo all mean off) and the exact `tenantUuid:studyUuid` pair in
  `BECOMMUNITY_SHADOW_SCOPES`; with either missing, the canonical adapter is
  never constructed and never called. **Neither variable is set in any
  environment, and shadow mode has never been enabled on a hosted deployment.**
  The canonical read is raced against a wall-clock budget (1500 ms default,
  5000 ms ceiling) and every failure — timeout, transport, malformed document, a
  document that throws when read, a comparator that throws — becomes a safe
  status code; none of them can change, delay past the budget or fail the legacy
  payload. `npm run test:shadow-boundary` (**96 checks**, in `npm test`) executes
  every one of those paths.
- ⓘ **Unit 5 Phase 3.1 corrected four defects a post-completion audit found.**
  Read `docs/CURRENT_STATE.md` §"Unit 5 Phase 3.1" before touching
  `src/lib/shadow/` or `src/lib/canonical-source/read.ts`. In short: (A) NOTHING
  THE FILTER TOUCHES IS COMPARED — the canonical document is read by tenant and
  study only, so under an active filter every quantity the legacy filter touches
  is `presentation_configuration_required` / `filter_scope` with no verdict and
  no numbers; `population.measured` survives only because `view.sourceUnits` is
  provably unfiltered. (B) THE BUDGET CANCELS — it owns an `AbortController`
  whose signal reaches every paginated query's `PostgrestBuilder.abortSignal`,
  and the paging loop checks it before asking for the next page; the verdict is
  decided by an `expired` flag set before the abort, NOT by who won
  `Promise.race`. (C) EVERY TEXT FIELD IS A CLOSED SET — `noteCode` replaced
  `note: string`, `rule`, `key` and `section` are unions, and the reversible
  unsalted filter fingerprint was DELETED rather than improved. (D) THE RUNTIME
  SINK IS INERT — `src/lib/shadow/sink.ts` is server-only, reads no environment
  variable, records only codes and totals and no numbers at all, and adds no
  route. `npm run test:shadow-sink` (17 checks, in `npm test`) proves it.
- ⓘ **`controller.abort()` TAKES NO ARGUMENT, and that is load-bearing.**
  `@supabase/postgrest-js` decides whether a rejected `fetch` was cancelled by
  reading the rejection's identity — `name === "AbortError"` or
  `code === "ABORT_ERR"`. A CUSTOM abort reason replaces the platform's own
  `AbortError`, is not recognised, and the request is then treated as a network
  failure — and because a canonical read is a GET, it is RETRIED three times
  with backoff. The hosted rehearsal measured exactly three extra requests
  after a 1 ms budget expired. Never pass a reason to `abort()` on this path;
  the budget's verdict comes from its own `expired` flag, not from the reason.
- ⓘ **The canonical read is bounded-concurrent at SIX, and six is not arbitrary.**
  A Cloudflare Worker allows six simultaneous open outbound connections per
  invocation. `loadCanonicalRowSet` reads its twenty-six independent families
  through a pool: 4 774 ms median sequential became 1 263 ms, measured against
  the hosted package. Paging WITHIN a family stays strictly sequential — the
  keyset cursor is the previous page's last row — results are placed by index so
  the row set is identical to the sequential one, and one failure fails the whole
  load reporting the LOWEST-INDEXED refusal. Never raise the concurrency to buy
  speed and never drop a ceiling or a scope check for it.
- ⓘ **The two shadow operators measure different things.**
  `npm run canonical-shadow-report` is the COMPATIBILITY report and preloads the
  canonical document, so its elapsed time is the comparator's.
  `npm run canonical-shadow-runtime-rehearsal` is the RUNTIME report: it calls
  `runStudyShadowComparison` under `node --conditions=react-server` and lets it
  construct its own admin client and do its own paged reads. Both are read-only.
  Never quote one as the other.
- ⓘ **There are exactly TWO doors from the application to the canonical layer,
  both named in a table, and a graph walk proves it.** Unit 6B.1 added the
  second and last; before it there was one, and the rule read "do not add a
  second door".

  1. `src/app/insights/e/[studyId]/page.tsx` → `src/lib/studies/study-dashboard.ts`
     (server-only) → `src/lib/shadow/server.ts` (server-only) →
     `src/lib/canonical-source/server.ts`. Unchanged, and its chain is still
     required to pass through BOTH the approved loader and the orchestrator.
  2. `src/app/studio/e/[studyId]/construccion/page.tsx` and its co-located
     `actions.ts` → `src/lib/studio/presentation-workspace.ts` (server-only) →
     the canonical read path. It is asserted NOT to travel through the shadow
     layer: its read is a read, not a comparison.

  The doors live as a TABLE in `shadow-boundary-test.mjs` §[8] rather than as a
  count, so a third cannot be added by editing a digit: an unapproved page that
  reaches the canonical layer fails by name. The server-action class stays
  closed with ONE named exemption, which is additionally asserted to perform no
  insert, update, upsert, delete, RPC or `revalidatePath`. `"use client"`
  modules and `route.ts` handlers still reach the canonical layer by NO chain,
  and no page, component or route may so much as name the shadow diagnostics.

  **Do not add a third door.** If a surface needs canonical data, it goes
  through one of the two loaders above or a new one is argued for in the gate
  first, not registered afterwards.
- ⓘ **A CANONICAL DRAFT AND A LEGACY DRAFT LIVE IN DIFFERENT TABLES, and that
  is the whole coexistence answer.** The question was put to a real PostgreSQL
  before it was answered. `study_experience_draft`'s primary key is `study_id`
  ALONE — one draft per study, so there is no "beside" in that table — and
  `save_study_experience_draft` ACCEPTED a canonical v4 document against a
  planted legacy row at revision 72, moving it to 73, changing `schema_version`
  from 2 to 4 and replacing the definition bytes. The existing schema therefore
  does NOT support coexistence, and the table accepting JSON is not a licence to
  put canonical JSON in it. Migration `0029_canonical_presentation_draft.sql`
  adds a SEPARATE table so the two hosted legacy rows are structurally
  unreachable from the canonical path rather than merely unvisited by it.
  **It IS APPLIED to the hosted project** — see the Unit 6B.3B bullet below.
  Never write a v4 document through the legacy RPC, and never widen that table's
  primary key: it is not additive, and every existing reader of it assumes one
  draft per study.
- ⓘ **UNIT 6B.3B: `0029` IS APPLIED to the hosted project, and Cuicuilco has a
  canonical draft at revision 1.** Applied to `ontvqazsqiwisdddblif` on
  **2026-09-08 19:14:40–19:14:45 UTC**, from commit `6f8bf76`, through
  `supabase db push` (CLI 2.115.0) over the SESSION pooler — the dry run proposed
  that one file and nothing else, and no ledger entry was hand-written. The
  ledger is now **30 rows, 0000-0029, no duplicate**, and no recorded body of
  `0000`-`0028` moved. A verified backup was taken and restore-rehearsed into a
  disposable PostgreSQL 17.11 first, and it is **retained**.
  Cuicuilco (`cd4d6acd…`) then got its first canonical v4 draft through the real
  application: **revision 1**, one `draft_created` event, definition digest
  `511d7f54…`, binding `cf63bdca…`, registry `1.0.0`, 1 page and 24 blocks. It is
  the ONLY canonical draft that exists; **P6E deliberately has none**. Both
  legacy drafts are byte-identical — Cuicuilco v2/72, P6E v3/14 — and
  `study_experience_event` still holds 86 rows. Read `docs/CURRENT_STATE.md`
  §"Unit 6B.3B" before touching any of it, and do not create a second revision
  of that draft to test something a disposable target can answer.
- ⓘ **`0029` grants `service_role` SELECT and nothing else**, which is stricter
  than `0026`-`0028` and deliberately so. Its only legitimate writer is the
  `SECURITY DEFINER` save function; a `service_role` that could `UPDATE` the
  draft directly could move a revision with no event, no expected-revision check
  and no lock. It also takes `pg_advisory_xact_lock` on the study before the
  first read a decision depends on — `select … for update` locks NOTHING when no
  row exists yet, which is a hole the legacy draft function still has: two
  concurrent first saves both insert and the loser gets an untyped primary-key
  violation where a conflict was expected.
- ⓘ **A SAVE NEVER RE-BINDS, AND THE PREVIEW ALWAYS DOES.** The preview re-binds
  so a browser cannot pin a document to a registry it was not authored against.
  Doing that on the way to STORAGE would take a layout authored against one
  package and file it as though it had been authored against another — the exact
  retargeting the binding fingerprint exists to prevent, made permanent. A save
  therefore resolves the document as it arrived, and a binding that no longer
  matches is `binding_fingerprint_mismatch` with nothing written.
- ⓘ **«Guardado» means the stored document IS the document on screen**, by
  reference identity, and never anything weaker. `src/lib/composer/save-session.ts`
  owns all six states and every transition; it is pure — no clock, no randomness,
  no transport — which is what lets an offline gate prove that an older answer
  cannot mark newer edits saved, that a failed or timed-out save never reads
  «Guardado», and that a conflict cannot resolve itself by writing. Undo/redo
  history stays session-local: only the current document is persisted. A retry
  repeats the previous idempotency key, which is what makes it a replay instead
  of a second revision; autosave never fires in a conflict, during a save, or
  after a failure.
- ⓘ **`docs/LEGACY_CANONICAL_COMPATIBILITY.md` is the compatibility evidence.**
  Read it before proposing a read-path switch. Three totals live there and must
  never be added together or substituted for one another: **golden parity
  531/531** against the approved dashboard; **6 of 6** legacy↔canonical fields
  that both layers publish and an authority relates without an alias table; and
  **18** findings classified as canonical-only, legacy-only, presentation- or
  editorial-configuration-required. Never report the 531 as runtime agreement
  with the legacy UI. A FOURTH total joined them in Phase 3.1 and is also not
  interchangeable: under an active filter the comparison is **1 comparable, 1
  agree, 0 disagree, 23 classified**, of which 12 are refused by scope.
  ⓘ **Preview activation is BLOCKED.** Across three hosted runs of twenty
  samples the median held at ~1.05-1.11 s but the maximum reached **1 902 ms** —
  PAST the 1500 ms default budget, so that request would have timed out rather
  than compared. Only the 5000 ms ceiling has room (2.63x), and every
  measurement was taken from this workstation rather than from the Worker, which
  is the margin that actually decides it. Do not enable shadow mode in any
  environment.
- ⓘ **Three legacy defects were FOUND and deliberately NOT fixed** (Phase 3 may
  not change a calculation). (1) `computeStudyMetrics` detects CSAT with
  `startsWith("sat")`, and every Cuicuilco key is `csat_*`, so the dashboard
  publishes **no CSAT tile at all** and shows those 55 columns as plain averages.
  (2) `computeStageMetric` uses `csatMin = 9` — the 0–10 threshold — against 1–5
  answers, so every `csat_*` journey stage reports "Satisfechos 0/n" to a client
  today. (3) The legacy `tdp_` columns hold a per-person 0/100 flag whose average
  is the canonical `unawareShareOfResponses`, **not** `tdp`; a future mapping that
  pointed them at `tdp` would compare two different quantities. All three are
  recorded in `docs/LEGACY_CANONICAL_COMPATIBILITY.md` §7.
- ⓘ **The legacy dashboard cannot see six of the sixty Cuicuilco people.** It has
  no roster: it counts whoever left a quantitative answer or a confirmed
  qualitative observation, which is 54. The canonical contract reports `total 60`
  beside `measured 54` for exactly that reason. `population.total` is therefore a
  CANONICAL-ONLY capability, not a mismatch — a missing legacy field is never a
  canonical defect.
- ⓘ **Two fingerprints, and they are not the same number.** The plan fingerprint
  covers the whole plan and every derived record id is derived from the package
  key TOGETHER WITH the tenant and the study, so a plan for a different study is
  a different plan. `sha256:a226b70c…` is the fingerprint the dry-run and
  golden-parity gates produce under their DISPOSABLE placeholder scope;
  `sha256:099863e8…` is the one actually imported, under tenant `e63b2092…` and
  study `cd4d6acd…`. The scope-free anchor is the package idempotency key
  `sha256:bb9a4a98…`, which is mapping version, asset roles and file hashes
  only. Never treat one as a substitute for another.
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
- ⓘ **THE CANONICAL PRESENTATION LAYER EXISTS: `src/lib/presentation/`.** Unit 6A
  built the bridge a future customizable dashboard binds to — a
  server-authoritative REGISTRY of opaque handles derived from a
  `CanonicalStudyResults`, a versioned presentation DOCUMENT, and a pure RESOLVER
  producing a serializable render model of already-final values. Its rules are in
  `docs/CANONICAL_PRESENTATION_MODEL.md`; read it before touching that folder.
  **Nothing in it calculates.** It imports no module from `src/lib/calc/`, holds
  no formula, no denominator and no threshold, and every number it emits was
  computed, rounded once and formatted by the canonical layer.
  `npm run test:canonical-presentation` (**269 checks**, in `npm test`) enforces
  that, plus the boundary and the refusals.
  ⓘ **The brief's `StudyResultsDocument` DOES NOT EXIST.** The canonical document
  type is `CanonicalStudyResults` (`src/lib/results/contract.ts:691`). Use the
  real name.
- ⓘ **A HANDLE IS NOT A KEY, and it may never become one.** Handles are built
  only from the closed vocabulary, from a label the client is already shown, or
  from an ordinal position — never from an item, attribute, instrument, metric or
  band-scheme key, and never from a table name. The grammar forbids the
  underscore precisely because every canonical key is `snake_case`. The registry's
  `addresses` map is **server-only**: `projectPresentationCatalog` drops it and no
  render model carries it. Do not widen the catalogue to include it.
- ⓘ **Presentation documents are `schemaVersion: 4` and carry
  `documentKind: "canonical_presentation"`.** Versions **1-3 belong to the legacy
  experience definition**. Unit 6A refuses 1-3 BY NAME and migrates nothing in
  either direction. Never reinterpret a stored draft as a document of the other
  family.
  ⓘ **THE TWO HOSTED DRAFTS ARE INVENTORIED, and Unit 6A was wrong to say the
  database could not tell us.** `schema_version` is `not null` and the save RPC
  requires it to equal `definition.schemaVersion`, so the value was always
  readable. Measured read-only on 2026-09-06: the P6E synthetic acceptance study
  is at **version 3, revision 14**; **«La voz de las y los Nets de Cuicuilco» is
  at version 2, revision 72**. Column and JSON agree on both, neither carries a
  `documentKind`, and both are therefore LEGACY-family documents. Nothing was
  mutated. Do not migrate or re-author either: a v4 canonical presentation is
  created from the approved blueprint, and the legacy drafts are retained as
  evidence.
- ⓘ **A suppressing policy takes the PARTS with the WHOLE.** An adversarial
  review found an authored `hide_below` withholding the recommendation score
  while the block beside it still published promoters/pasivos/detractores with
  their shares — and an NPS is %promoters − %detractors, so the withheld number
  came back by subtraction. Every composite payload now obeys the policy:
  distributions, curated terms, the structural touchpoint payload and
  `performance.dimension`. If you add a payload shape, guard it.
- ⓘ **`annotate_below` is resolved on the SERVER.** It compares the base to the
  threshold and ships a finished sentence as `RenderBlock.sampleNote`. Never move
  that comparison to the browser — comparing is calculating.
- ⓘ **Methodology prose follows the MEASURE, not the section.** A touchpoint owns
  three explanations and a period owns two; handing the CSAT prose to a TDP
  figure captions the wrong quantity beside the most misread number on the page.
- ⓘ **A PRESENTATION DOCUMENT CARRIES NO DATABASE STATE AT ALL.** Unit 6A put
  `metadata.studyId`, `metadata.tenantId` and a publication block inside it; 6A.1
  took them out. A tenant and a study uuid are database identifiers, migration
  0025 already owns publication, and a `definitionSha256` inside the document it
  hashes cannot be kept true of itself. `src/lib/presentation/persistence.ts`
  stamps the scope immediately before a write and strips it immediately after a
  read, and refuses a row belonging to another study. A document authors only
  configuration.
- ⓘ **A DOCUMENT PINS THE REGISTRY IT WAS AUTHORED AGAINST.** `registryVersion`
  plus a `binding` fingerprint — a digest over the study scope, the plan and
  package identity, both versions and the WHOLE handle-to-address map. Because
  every `CanonicalAddress` is an array position, a registry from study A handed
  study B's results would resolve cleanly and answer with the wrong numbers, so
  the resolver refuses on `registry_study_mismatch`, `registry_plan_mismatch`,
  `registry_version_mismatch` and `binding_fingerprint_mismatch` — four separate
  codes. Renaming a label, reordering a group or inserting a dimension or
  touchpoint earlier all move the fingerprint, so a saved binding REFUSES rather
  than silently retargeting. `binding: null` means "study-agnostic template".
- ⓘ **THE BARREL IS SPLIT.** `src/lib/presentation/index.ts` is client-safe —
  schemas, handles, errors, catalogue rows, render-model TYPES.
  `src/lib/presentation/server.ts` carries `import "server-only"` and is the only
  way to the registry's address map, the resolver, persistence and the blueprint.
  Offline gates import the pure modules directly; production client code cannot.
  Do not re-export a binding primitive from the safe barrel.
- ⓘ **THE PUBLIC RENDER MODEL CARRIES NO AUTHORING MATERIAL.** A withheld result
  says only that it is withheld, plus a separately authored `publicNote` if
  somebody wrote one for a reader. The threshold, `authoredBy` and the internal
  `rationale` stay on the server: publishing them ships the study's own
  deliberation beside the gap it made.
- ⓘ **The system default is `show_all`.** The canonical layer suppresses nothing;
  this layer owns only the DISPLAY decision, and the two suppressing modes require
  `authoredBy` and `rationale` so a hide-below rule cannot be defaulted, inherited
  or stamped. The legacy `adaptLegacyStudy` stamped `hide_below 5` on every
  definition it produced; that behaviour is deliberately not carried across. A
  block-level policy is not a software rule.
- ⓘ **A filter moves a block only when a connection names it.** Sharing a
  dimension is never a connection — the approved dashboard's "Razones declaradas
  de riesgo" shares every dimension with its risk panel and is deliberately not
  moved by it. `unsupported_filter_dimension`, `forbidden_filter_cross` and
  `filter_dimension_not_offered` are THREE codes for three different sentences
  and must stay apart: a result cannot do it, an authority forbids it, nobody put
  the control there.
- ⓘ **THE FILTERS ARE LIVE, AND EVERY FILTERED FIGURE IS RECOMPUTED ON THE
  SERVER.** Unit 6B.2 turned the disabled panels into viewer controls. A reader's
  selection is EPHEMERAL and travels in its own contract
  (`src/lib/presentation/viewer.ts`); it is never part of `PresentationDocument`,
  and the strict v4 schema refuses an unknown field so it cannot become one by
  accident. What a browser may name is a panel id, a dimension handle and an
  ORDINAL OPTION TOKEN (`o0`, `o1`, …). The canonical value — a cohort's `active`,
  an attribute's answer text — has no field to travel in and stays in the
  registry's server-only `filterOptions` map. `src/lib/viewer/` is the pure
  composition: one read, one recomputation per DISTINCT constraint set, one
  registry rebuilt from each recomputation, one resolution. Read
  `docs/CURRENT_STATE.md` §"Unit 6B.2" before touching any of it.
- ⓘ **EACH RECOMPUTATION BRINGS ITS OWN REGISTRY, and the resolver compares the
  bindings.** Addresses are array positions and they are invariant under a
  filter — every addressed array is derived from the source or the specification
  — but `availability` and every BASE are not, and the sample policy decides
  against a base. Resolving a filtered document against the UNFILTERED registry
  dereferences cleanly and decides every `annotate_below` against a base nobody
  in the selection has. `filter_registry_drift` is the refusal that keeps the
  invariance a fact rather than a promise.
- ⓘ **Two panels on one block combine as AND, and their constraints are kept
  APART.** Merging them into an intersection in the presentation layer could
  produce an empty value list, and an empty list means "not constrained" to the
  canonical filter engine — the one spelling that turns "nobody matches" into
  "everybody matches".
- ⓘ **RETENTION ACCEPTS NO PARTICIPANT FILTER.** It is measured over the period's
  roster, and `buildRetention` answers `cross_not_permitted` under any selection.
  `SECTION_ACCEPTS_PARTICIPANT_FILTERS` in the registry is an exhaustive `Record`
  over the closed section vocabulary so a section added later cannot inherit an
  answer nobody gave. Do not replace it with an exclusion list.
- ⓘ **The authoring canvas stays inert; the reading view is where filters work.**
  The canvas wraps every drawing in an `inert` container and is handed NO viewer
  controls, so its filter controls are genuinely `disabled` under a sentence
  saying where filtering works. Making the canvas operable would make every
  chart, link and control inside every block operable with it. Leaving the
  reading view CLEARS the selection: the canvas is where somebody authors a
  threshold against the base they can see.
- ⓘ **Esfera × CRI: the approved dashboard's risk panel offers it and the
  canonical contract forbids it.** The blueprint corrects the deviation BY
  CONSTRUCTION — its risk panel is built from the dimensions the renewal result
  declares it supports, a list the registry has already pruned. Do not replace
  that derivation with a hand-written exclusion list.
- ⓘ **Four source groups, five visible routes, and they are different layers.**
  The workbook's four merged bands (29/6/10/10) are EVIDENCE and live in the
  contract; the approved dashboard's split of the first category into «Operación»
  and «Interacción» is a DECISION and lives in a presentation document. A route
  may not claim a touchpoint the source did not place in its group, and no
  touchpoint may be shown twice.
- ⓘ **The curated journey pain cloud stays `configuration_required`.** The
  approved dashboard publishes 79 curated phrases; the contract classifies them
  as editorial review. The blueprint declares the slot and leaves it EMPTY. Never
  copy those phrases into the product and never invent a phrase-splitting rule.
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
