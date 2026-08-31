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

- The V2 framework and hardening baseline are deployed to a
  **synthetic-data test/beta Worker**. The current Experience Composer milestone
  exists on its own branch and as a zero-traffic preview only; it has not been
  promoted to production traffic. This is not yet a real-client go-live
  environment, and deferred go-live controls still require the final domain,
  production Supabase and operational decisions recorded in
  `docs/CURRENT_STATE.md`.
- Full V2 architecture lives in `BeCommunity_V2_Technical_Architecture.docx` (reference only — consult, don't inline).
- Project background and decisions live in `system_context.md`.

## Tech stack  *(verified against package.json + config, 2026-08-30)*

- Framework: **Next.js 16.3.2** (App Router) + **React 19.2.4** +
  **TypeScript 5.9.3, `strict: true`**.
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
npm test             # complete deterministic suite (41 gates at the 2026-08-28 handoff)
npm run gates        # gates:offline + gates:live (the complete release chain)
npm run gates:offline # credentials-free: typecheck, lint, test, build, cf:build, suite:d
npm run gates:live   # credential-bearing live chain: qualitative-live -> suite:a -> suite:b -> suite:c
npm run suite:a      # Suite A — tenant isolation, data scope, least privilege (A1-A5)
npm run suite:b      # Suite B — behavioral server-side authorization (B1-B7)
npm run suite:c      # Suite C — hostile input, imports, pivot boundary, injection (C1-C5)
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

## Current work — the Experience Composer, published to clients

The authoritative state is `docs/CURRENT_STATE.md`. Standing architecture
reference: `docs/EXPERIENCE_COMPOSER.md`; **sections 45-51 are the current
milestone**. Work from branch `claude/experience-publication-versioning`, cut
from `claude/experience-builder-journeys-visuals-cloud` at `b20c502` (the
verified handoff `e9fdd62` plus a documentation refresh). Production traffic was
not promoted and remains on the previously live Worker version recorded in
`docs/CURRENT_STATE.md`.

- ⓘ **A Server Action on the builder or the draft preview must never call
  `revalidatePath`.** It makes Next re-render the route inside the action's own
  response, which meant a second full workspace load per save; on the Worker
  the write landed and the re-render then aborted, and the errored RSC row
  replaced the whole editor with the Studio error boundary. A successful write
  must never be followed by a broken render. `npm run test:experience-composer`
  asserts the absence; `npm run test:experience-editor-regression` drives thirty
  editable operations consecutively and checks it after each one.
- ⓘ **One request reads a study's rows once.** Pass already-loaded rows into
  `loadLegacyStudySnapshot`; use `loadBuilderRegistry` when only a registry is
  needed. The builder page is the most expensive render in the product and it
  runs on a Worker with a per-request budget.
- ⓘ **An identifier is minted against the document it is joining**
  (`mintFreeId`). The editor's session counter restarts on every open, so a
  seed alone is not unique; a collision made a draft permanently unsavable.
- ⓘ **A composite metric is computed from the study's own scale.** Top-2-Box
  takes an explicit `satisfiedMin` (4 on a 1-5 scale, 9 on a 0-10 scale, per
  `docs/CALCULATION_CATALOG.md` §4 and `docs/CALCULATION_POLICY.md` §5). An
  undocumented scale yields a REFUSAL, never a number. Applying the 0-10
  default to a 1-5 study made all 55 satisfaction results read 0.0 %. Never
  present missing configuration or an unsupported calculation as a real zero.
- ⓘ **Client-specific vocabulary lives only in
  `src/lib/experience/template-suggestions.ts`.** The composer gate refuses a
  client's name in every generic module. Suggestions decide defaults; they never
  restrict what the engine offers.
- **`EXPERIENCE_SCHEMA_VERSION` is 3**, migrated forward in code through
  `oneToTwo` and then `twoToThree`; there is no database change. Version 3 adds
  authored band schemes, several reusable recorridos, exact awareness mappings,
  visualization palettes and real thematic-cloud configuration. It never
  invents missing configuration while migrating an older draft. Identity is a
  global layer, not a `cover` block; `query.fixedFilters` replaces
  `query.filterRefs`; `filter_panel` remains an exploration block.
- **The two sidebar rails are independent editor chrome, not document state.**
  Either side may be collapsed and restored without moving the other; all four
  combinations persist in `sessionStorage`, never in the draft. Focus mode is
  still the explicit action that hides both, and mobile uses drawers instead of
  a narrow rail.
- **A study may define several recorridos; a block only points at one.**
  Duplicating a block creates another view of the same recorrido, while
  duplicating the recorrido creates an independently editable definition.
  Awareness requires both the result and the exact values meaning "no lo
  conocía"; blanks are not silently counted.
- **A semáforo exists only when a person authors its complete standard.** Never
  infer bands from percentiles, terciles or the current response distribution.
  A complete scheme may become a derived filter characteristic, calculated per
  respondent by the same pure registry function on server and browser. Colour
  is always accompanied by shape and text.
- **Heat map, bubble and treemap now have honest renderers**, with only the
  dimensions and aggregations their geometry can represent and an accessible
  table carrying the same values. The thematic cloud is deterministic,
  collision-free and sourced only from approved qualitative categories and
  their reviewed aliases; it never exposes a raw quote, pending suggestion or
  respondent identity. `npm run test:renderer-parity` keeps the catalogue and
  renderer implementations aligned.
- **Two previews, two labels.** `vista-previa` is the internal draft preview;
  `vista-cliente` is what the client has today and is unchanged. Never reuse a
  label implying the client dashboard already contains draft changes.

The original P8 product-experience programme is implementation-complete and
owner-accepted. The active work has since advanced through the governed
Experience Composer milestones above. **A composed document can now reach a
client, and only through a published revision.** Saving a draft still changes
nothing a client sees; do not describe a saved draft as changing the client
experience.

- P0-P6 are implemented, technically accepted and human-accepted on synthetic
  data. P6E completed with 108 automated checks and 0 failures.
- The remaining P6 mobile-overflow and PDF-pagination defects were fixed in PR
  #28, human-accepted, squash-merged and deployed. P6 is closed.
- P7 engineering is concluded and merged (PR #38). At the last remote check on
  2026-08-30, `origin/main` was
  `c76762f428834b7401118b7d2ad7f0d40158d56a`; verify it again before branching.
  Do not reopen P7 correction loops
  during P8. Deferred edge, production-environment,
  backup/DR and operational controls return as a bounded go-live hardening pass
  after the product is functionally and visually complete.
- P8 discovery and visual comparison are complete on
  `docs/p8-experience-discovery`. The A/B/C and provisional synthesis artifacts
  are historical design evidence, not an instruction to build more prototypes.
- The approved direction is an **Interactive Insight Experience**: client work
  combines a guided `Recorrido` with bounded `Explorar`, structured as
  question → visual evidence → consultant interpretation → action. Studio is a
  separate no-code operational experience for non-technical internal users.
- **P8-A is complete and owner-accepted** at `3659a38` (delivery PR #37): the
  semantic foundation, sign-in, shells, client panorama and journey slice are
  established. Do not reopen its visual-prototype loop.
- **P8.2 is implementation-complete and owner-accepted in the final P8 pass on
  2026-08-27.** Slice one
  (owner-accepted, PR #39, `b1abfef`) delivered the no-code access-scope picker
  and the guided import mapping and readable preview. The completion unit adds
  the eleven `/studio/**` routes, the actionable home, the study work surface
  and its process steps, the journey-metric and theme pickers, visible paging on
  the qualitative review and the import history, publication reachable only
  through the client preview, one accessible destructive-action dialog in place
  of `window.confirm()`, and the account and client lifecycle. It is gated by
  `npm run test:studio-completion` (48 checks) beside
  `npm run test:studio-workflows` (22). Migration `0015` is applied to the
  synthetic project only. On 2026-08-25 the canonical offline chain, the live
  adversarial chain and the exact-ledger lifecycle acceptance passed at
  `543889a`; cleanup left no disposable rows, Auth identities or Storage
  objects, and the protected fixture remained unchanged. **One lifecycle item
  remains deliberately unavailable:** permanent CLIENT deletion is disabled
  and refused server-side until a recoverable cross-system deletion workflow
  exists. No ordinary Studio workflow may ask for raw JSON, an internal
  identifier or a metric key.
- **P8.3 is implementation-complete and owner-accepted.**
  `/insights/e/[studyId]` is the authorized client study route;
  the dashboard remains its compatibility home. URL and PDF filters share the
  exact `f.*` parser, the free comparison keeps the existing server allowlist,
  fewer than four periods use a list while longer histories use a chart, and
  every history has a table alternative.
- **P8.4 is implementation-complete and owner-accepted.**
  `/studio/e/[studyId]/interpretacion` owns the explicit draft → review →
  approved → published workflow. A newer draft never replaces the client
  snapshot until it is approved and published again. Client absence remains
  silence. The study/client presentation controls are bounded, no-code and
  inherited; templates are team-shared with author attribution and preserve
  the configuration. Migrations `0017` and `0018` are applied to the synthetic
  project only. Never invent interpretation copy or expose draft content.
- **P8.5 is implementation-complete and owner-accepted; P8 closed on
  2026-08-27.**
  `test:p8-acceptance` covers the named state system, plain language, keyboard
  affordances, unique word-cloud semantics and the declared six-width matrix.
  `test:p8-acceptance-live` renders the authorized client and Studio route set
  at 320/360/390/768/1024/1280 px without screenshots and rejects page-level
  overflow, clipped text, duplicate IDs, unnamed graphics, missing alt text or
  sub-24 px control targets. The owner completed and accepted the real-phone
  pass after the LAN hydration, mobile account-row and relative-scale fixes at
  `8a4437a` and `b49df5d`. Studio deliberately has no top-level
  `loading.tsx`: its role check must finish before any streamed HTTP 200 UI.
- **The Journey editor focus-loss regression is fixed and live-verified at
  `cda09ac` on `claude/final-security-data-hardening`.** Unsaved stage identity
  is now a stable editor `uid`, separate from the stored id derived from the
  visible label. Never key an editable React row by its typed value or by an id
  regenerated from that value; never address a mutable list row by an index that
  shifts after removal. `npm run test:journey-editor` and the credential-bearing
  `npm run test:journey-editor-live` are the regression witnesses. The same
  unstable-label key defect was removed from the import mapping workbench.
- ⓘ **A category is never merged by code.** Values that differ only by case or
  whitespace are folded automatically; everything else — accents, punctuation,
  invisible characters, wording — is a QUESTION put to a consultant on
  `/studio/e/[studyId]/categorias`, and only a recorded human decision groups
  anything. Decisions are an append-only ledger (`category_decision`, migration
  `0022`); undo writes an inverse version. Raw rows are never rewritten. A
  publication pins its grouping so a delivered report stays reproducible. A
  resemblance, and anything a model says, can never block a publication. See
  `docs/SEMANTIC_CATEGORY_REVIEW.md`.
- ⓘ **The OpenAI advisor is off, and a flag alone cannot turn it on.**
  `EVALUATION_APPROVED` in `src/lib/categories/advisor/flags.ts` is a reviewed
  constant, not configuration. Flipping it requires the measured false-merge
  rate and recall to be recorded by a named person. No key is configured in any
  environment; every workflow works identically without one.
- **Only one task may mutate or deploy a shared environment at a time.** A task
  may develop in an isolated worktree, but it must integrate every completed
  prerequisite commit before migration or deployment. Supabase migrations and
  Cloudflare deployments are serialized explicitly; a clean Git worktree does
  not make concurrent external mutations safe.
- **Manual Wrangler deployments must preserve dashboard-managed text
  variables.** `wrangler deploy` deletes dashboard vars that are absent from the
  repository configuration unless `keep_vars = true` (or `--keep-vars`) is in
  effect. The 2026-08-28 journey deployment briefly returned HTTP 500 after
  replacing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; it
  was rolled back, repaired through a verified preview version and promoted.
  Until the repository config carries the protection, no task may deploy.
  Always select and verify the Ollin Cloudflare account explicitly before a
  manual deploy; this operator has access to more than one account.
  **`keep_vars = true` is now committed in `wrangler.toml` and enforced by Suite
  D's D-g check.** Never satisfy a missing binding by adding a `[vars]` block:
  that commits configuration to git and puts the privileged key one edit away
  from the repository.
- **Every `/admin/**` address still answers.** Studio gained addresses; it
  renamed none away. Bookmarks, emailed links, `docs/CURRENT_STATE.md` and the
  frozen adversarial catalogue all depend on the old paths, and
  `src/lib/studio/routes.ts` records the pairing so a gate can assert it.
- ⓘ **No lifecycle action succeeds unrecorded.** Suspend, restore, archive and
  restore refuse when the administrative record is unavailable, and undo
  themselves if the record cannot be written after the change. Permanent user
  deletion writes durable intent and checks that write BEFORE deleting. Do not
  reintroduce a best-effort "we could not record this" success path.
- ⓘ **Publication has exactly one surface.** `/studio/e/[studyId]/publicar`,
  reached from the client preview, is the only path that moves a study between
  draft, published and archived — and, since migration `0025`, the only path
  that prepares, publishes or restores a composed revision. `publicar/historial`
  and `publicar/revision/[revisionId]` sit BELOW it: they are the evidence and
  the exact preview a decision rests on, not second decision surfaces. `updateStudyConfiguration` may only re-save the
  state that already holds, and `setStudyPublication` independently refuses a
  publication with no acknowledgement, an empty study or an archived client.
- Preserve P7 authorization/input gates, all calculation outputs, ingestion,
  RLS, roles and publication boundaries. P8 changes presentation and guided
  workflow first; migrations or authorization changes require a separate,
  explicit design and review boundary.
- Do not mutate real-production infrastructure, rotate credentials, create a
  real-data environment, or enable irreversible controls during synthetic P7
  work. Do not redirect the roadmap toward retention UI, new role tiers or an
  incidental feature question.
- **The Experience Composer now PUBLISHES, over an immutable revision.**
  Standing reference: `docs/EXPERIENCE_COMPOSER.md`. The product direction is a governed
  data-experience builder over the same canonical calculations, authorization,
  approved evidence and immutable snapshots — not an unrestricted query tool.
  `src/lib/experience/**` holds the current versioned experience definition
  (strict Zod,
  server-side, no unknown fields, no SQL/HTML/script/CSS, no database key, no
  respondent, no nesting), the semantic/block/chart registries, a pure
  compatibility adapter, a canonical data resolver, the editor operations, and
  the builder at `/studio/e/[studyId]/construccion`. AI is out of scope.
  Gates: `npm run test:experience-composer` and
  `npm run test:experience-publication`, plus the credential-bearing
  `npm run test:experience-persistence-live`,
  `npm run test:experience-builder-live` and
  `npm run test:publication-live`.
- ⓘ **A draft is not a publication, and the bridge between them is one
  deliberate act.** Migrations `0023`/`0024` create the mutable draft, the
  immutable revision and the event log; `0025` turns the revision into a
  PREPARED snapshot, teaches the event log `revision_prepared` / `published` /
  `restored`, and adds `study_experience_publication` — the per-study pointer at
  whatever revision a client is served, and the only mutable object in the
  model. RLS is enabled and forced on all four, `anon` and `authenticated` are
  denied outright, `service_role` holds only SELECT, and the body the two
  selection entry points share is executable by NOBODY. Saving a draft still
  changes nothing a client sees; only `publish_`/`restore_` move the pointer.
- ⓘ **A revision is never edited, and status is never stored on it.** A
  `superseded` column would have to be UPDATEd on a table whose whole purpose is
  that it is never updated. State is derived from the pointer and the event log.
  Rollback APPENDS an event pointing at an older revision; it is not deletion,
  it rewrites no history, and the revision it replaces stays and can be restored
  back.
- ⓘ **A publication stores CONFIGURATION and fingerprints, never a number.**
  Every aggregate is computed at request time by the canonical engine, exactly
  as the legacy dashboard computes it.
- ⓘ **A blocker cannot be acknowledged; a warning is acknowledged by its exact
  code.** Who, when, which codes — stored on the revision and re-asserted at
  publication in the application AND in the database. There is deliberately no
  control that accepts every warning at once.
- ⓘ **Four block types are refused at publication** — the approved reading, the
  complete-results inventory, the comparison explorer and the report-download
  control. Each renders internally as a DESCRIPTION of what the client will get,
  and the client renderer does not draw the thing itself; the first published
  client screen printed those descriptions to the client. Refusing names the
  block and says what to do, which is the only option that neither lies nor
  silently drops somebody's work. This is a stated limitation, not a bug.
- ⓘ **A client-facing surface never draws an author's instruction.**
  `client-visibility.ts` decides which blocks reach a client;
  `Audience.tsx` — a context defaulting to `internal` — lets the leaf renderers
  know who is reading. A caveat about a result the client IS shown stays: that
  is analytical honesty. Do not add an internal sentence to `BlockView` or
  `Charts.tsx` without gating it on the audience.
- ⓘ **A study is served the composed experience only when it has an ACTIVE
  PUBLISHED REVISION this build can read.** Every other study keeps the legacy
  dashboard. A published revision that cannot be read falls back to the legacy
  dashboard rather than to an error page, and the failure is named on the
  internal publication screen.
- ⓘ **A lost update is SQLSTATE `55000`, never `40001`.** PostgREST retries a
  serialization failure, so a deliberate `40001` refusal never reaches the
  caller: measured at 125 s and an HTTP 504 with no message, against 148 ms for
  `55000`. Any future refusal that has to reach a browser must use a code the
  Data API delivers, and the live gate asserts the promptness as well as the
  code.
- ⓘ **The builder refuses out loud and never pretends.** Every editor operation
  that declines returns the state unchanged WITH a reason a person reads, and
  the screen announces it — a silent no-op is an edit somebody believes worked.
  Every chart variant currently declared implemented is drawn for real; heat
  map, bubble and treemap are no longer substituted with bars. A semáforo needs
  a complete standard somebody agreed to and says what is missing when there is
  none. Do not reintroduce a silent refusal, and do not substitute one drawing
  for another without saying which is missing.
- ⓘ **`test:experience-builder-live` needs `npm run build && npm start`.** React
  development calls `eval()` and this application's CSP correctly forbids it, so
  under `next dev` the builder never hydrates and every control is inert. A gate
  that drives the product drives the build a client would receive.
- ⓘ **Minimum-five suppression is now a per-study, versioned POLICY —
  `show_all` / `warn_below` / `hide_below` — and no current route changed.**
  NEWLY COMPOSED experiences default to `show_all` (visible from n = 1); every
  EXISTING study keeps today's hide-below-five behaviour, which the adapter
  stamps on and a gate proves equivalent at every base from 0 to 60. A
  published snapshot freezes the policy it was published under.
  `src/lib/calc/disclosure.ts` is untouched. This policy governs whether an
  AGGREGATE is drawn; it never governs who may ask. Tenant isolation, RLS,
  server-side authorization and raw-personal-data protection stay
  non-configurable.

## When unsure
Ask. Do not guess on security, authorization, or calculations. A stopped task is
cheaper than a leak or a wrong number shipped to a client.
