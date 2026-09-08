# Current state — Be Community V2

> Authoritative operational handoff. Last verified: **2026-09-05**.
> Read this after `CLAUDE.md` at the start of every new coding session.
> Historical files (`AUDIT_V1.md`, `docs/FASE_*.md`) explain past decisions but
> do not override this state.

## P9 — final hardening and the first real study (read this first)

`docs/P9_HARDENING.md` is the standing reference for everything below and must
be read before touching deployment configuration, a paged read, the ingestion
reader, or the real BNI Cuicuilco study.

- **The privileged key never enters a build.** OpenNext compiles the project's
  `.env` FILES into the Worker bundle, so the deployable artifact is built from
  a checkout with no `.env` file and credentials live in the shell environment.
  `SUPABASE_SERVICE_ROLE_KEY` is an encrypted Worker **secret** and must not be
  a Workers Builds **build variable**. `npm run test:secrets` fails on the
  variable NAME appearing in the compiled env snapshot, so it is red regardless
  of the value.
- **Every complete read is a keyset, never an offset.** Offset paging reads rows
  by position in an order SQL never promised. `selectAllPages` orders by primary
  key, asks for rows after the last id it saw, and refuses a page that did not
  come back in key order. There is no snapshot across pages and none is claimed.
- **One category, one name.** Case and whitespace variants are folded
  automatically; different WORDS are merged only by a configured, per-study
  alias. Grouping happens on read, so stored rows still match the source exactly.
- **Published rates are derived once from exact counts**, not re-rounded from a
  stored rate.
- **AI execution is not editorial confirmation.** Migration `0021` is **applied**
  to the provisional project through `supabase db push`, and is the only
  supported way to return an automated qualitative confirmation to the human
  review queue. It records itself in the same transaction, and only
  `service_role` may execute it.
- ⓘ **STALE, corrected 2026-09-06: the Cuicuilco study's observations are NOT
  all pending.** Measured directly against the project: **23 of 31 carry a
  confirmed theme and 8 are pending.** The reset this section records did
  happen; editorial review then resumed and is partly done. That confirmed
  work existed on ONE study only — see the duplicate section below — which is
  what made the two copies non-interchangeable, and why the copy was the one
  deleted. It survives on the study that was kept.
  What still holds from the original claim: the observation text and the
  generated suggestions are preserved, no quote is approved, nothing qualitative
  is client-visible, and the study is `draft`. What no longer holds is "no theme
  is confirmed" — 23 are.
- **The live suites refuse to run on an incoherent build or with stale synthetic
  accounts.** `/admin/upload` carries two upload forms, so the harness scopes
  its locators to the form that owns the control it will click; a first-match
  locator silently drove the wrong one and made eight Suite C checks look like a
  broken upload boundary.
- **The real study reconciles exactly** — 60 respondents, 3 282 quantitative
  answers, 31 qualitative answers, 123 metric keys, zero discrepancies across
  every key and every segment value — and remains `draft`. Re-prove it with
  `scripts/real-study-verify.mjs`.

### The real study existed TWICE. The duplicate has been DELETED

Measured 2026-09-06, counts and digests only:

| study | tenant | created | resp / quant / qual | qualitative review | outcome |
|---|---|---|---|---|---|
| `cd4d6acd` | BNI Cuicuilco | 2026-08-27 | 60 / 3282 / 31 | **23 confirmed, 8 pending** | **KEPT — intact, verified after the delete** |
| `066457f3` | BNI Cuicuilco — PRUEBA DESDE CERO | 2026-08-28 | 60 / 3282 / 31 | 0 confirmed, 31 pending | **DELETED 2026-09-05** |

All 31 qualitative quote digests and all 56 distinct respondent segment digests
were shared between them, so the row data was the same import. Both were built
from the same two source files — `import_batch.source_signature` `4fea5c66cfcf`
and `dec59dbf98a7` — and each study's counts reconciled exactly as the sum of its
two committed batches.

**They were NOT interchangeable.** The human editorial work — 23 confirmed themes
— exists only on `cd4d6acd`, and cannot be regenerated from the source workbooks.
That asymmetry, not the row counts, is what made the copy identifiable.

The copy was named as a test throughout ("PRUEBA DESDE CERO", "PRUEBA FINAL DESDE
CERO") and sat in its own tenant, so it read as a deliberate re-import rather than
an accidental duplicate.

**How the deletion was done** (commit `c06a3bc`; this was the FIRST and so far
ONLY write this workstream has made to the hosted project). A verified full data
backup was taken first, and it is **retained and must not be deleted**. A
read-only plan script predicted the blast radius from the database's own catalog
— 18 foreign keys point at `study`, and one of them, `study_template.created_from`,
is `SET NULL` rather than `CASCADE`, so a cascade-only mental model would have
missed a mutation (that table was empty, so nothing was mutated). The delete then
ran inside one transaction that fails closed four ways: the study must exist and
must not be the study to keep; it must have exactly 0 confirmed and 31 pending
qualitative observations; the study to keep must still carry its 23 confirmed
themes before anything is deleted; and the per-table deltas must match the
prediction exactly in both directions, so a table losing an unpredicted row
aborts. The study was addressed by uuid and by nothing else.

`/studio/estudios` still applies no status filter
(`src/app/studio/estudios/page.tsx:67`), so an internal user sees every study
side by side with nothing distinguishing the real one. That is unchanged and
remains open.

### Hosted project status — read this before inferring anything about it

These eight facts are distinct, and conflating any two of them has already
produced a wrong claim in this file. Stated precisely:

1. **The hosted project HAS been inventoried and backed up.** A read-only
   PostgREST inventory, a read-only nine-section diagnostic over a direct
   connection, and a full data export whose row counts were verified against the
   project's own counts per table.
2. **Two writes have been executed, and only two.** The duplicate legacy study
   was deleted through the rehearsed, fail-closed transaction described above;
   and the real Cuicuilco canonical package was imported (Unit 5 Phase 2,
   below). Nothing else has ever been written.
3. **The correct Cuicuilco study remains intact** — 60 people, 3 282
   quantitative answers, 31 qualitative answers, 23 confirmed themes — and was
   verified after the deletion AND again after the canonical import.
4. **The canonical migrations `0026`-`0028` ARE APPLIED there**, on 2026-09-06,
   through `supabase db push`. The ledger is 0000-0028, 29 rows, no duplicate.
   All 36 canonical tables exist, and all 36 still carry RLS and FORCE RLS.
5. **The real Cuicuilco package IS IMPORTED**, on 2026-09-06, as import job
   `1886a359-f2c9-483a-8b5e-979931841a71` — 8 588 canonical rows across 32
   families, reconciled three ways, replayed idempotently, and read back through
   the database adapter at 531/531 golden parity. Read Unit 5 Phase 2 below
   before saying anything about what those tables hold. **They are populated
   and still UNREAD BY THE UI**: the client receives only the legacy payload.
   Since Unit 5 Phase 3 one server-only page reads them in a
   disabled-by-default shadow comparison whose result never leaves the server.
6. **Hosted execution of the canonical migration chain is DONE, and so is the
   real import**; what remains pending is the read-path switch, which needs
   separate explicit authorization.
7. **Every backup is retained and must not be deleted**, and neither may any
   diagnostic or import evidence.
8. **The old application read paths remain authoritative.** Nothing reads the
   canonical tables, and nothing should until the read-path switch is
   separately authorized. A gate in `npm test` fails if a route or a component
   ever imports one.

A ninth distinction matters as much: a green **local** PostgREST run is not
hosted canonical execution. See level 3 below.

## Product and roadmap boundary

Be Community is a multi-tenant BI and data-storytelling platform for an
education-sector consultancy. It begins when raw research data already exists;
it is not a CRM, survey-capture system, or replacement for Excel/Forms.

The V2 construction order remains:

1. P0 security hardening
2. P1 canonical calculation layer
3. P2 universal ingestion
4. P3 template framework
5. P4 advanced BI
6. P5 client portal and longitudinal memory
7. P6 visual backoffice
8. P7 full hardening, adversarial suites, backups and incident response
9. P8 product experience transformation: Insights, Studio and controlled branding

Do not change that priority because of an incidental feature question. In
particular, retention UI and separate CEO/employee permission tiers are not the
current task. Business content and named starter templates belong to V2.5 and
must use documented authoritative definitions rather than invented rules.

**The approved future dashboard, and where its calculations live.** The emergency
dashboard at `C:\dev\becommunity-software\becommunity-bni-cuicuilco-demo`
(`a7248fdbccd139da80ed7c09daa70f006a62b9cf`) is the approved visual and numerical
north for the future product. It is **read-only reference material** and is not
part of the current unit: do not edit it, do not copy its hardcoded Cuicuilco
values into the product, do not begin dashboard UI work from it, and do not
switch application read paths toward it. When that work is authorized, its
components must RECEIVE authoritative calculated results from a **server-side
canonical read model**. The frontend never owns a business calculation — the
standing rule that composite metrics are canonical functions defined once
(`src/lib/calc/metrics.ts`) governs the future dashboard exactly as it governs
today's.

## Verified source and deployment baseline

- Current `main`: `c76762f428834b7401118b7d2ad7f0d40158d56a`, which carries P0-P8
  plus the first P9 real-study ingestion and hardening units through migration
  `0021`. (It was `fd986940accae5a87170e3de0cb4b2f52dc9d7a9` when this section
  was first written.) `main` is unchanged by the canonical work and still tops
  out at `0021`. Always verify `origin/main` before beginning new work.
- **Milestone deployment baseline — P6 closure:** Worker version
  `0454021a-e307-430b-bb36-27612b5faa0c` (100% traffic at the time of the P6
  closure check). Version IDs are **not permanent identifiers**; confirm the
  current deployment before release work.
- **This file records milestone/baseline deployments only** — phase closures and
  release baselines. Ordinary merges are **not** logged here: their commit-sha →
  Worker-version mapping belongs in the merged pull request's conversation or
  release record, using the post-merge record template in
  [DEPLOYMENT.md](DEPLOYMENT.md). Because a merge to `main` deploys, a commit made
  solely to record a version id would deploy again and immediately invalidate the
  value it recorded. Never open a documentation PR for that purpose.
- Beta URL (production alias of the synthetic beta Worker
  `becommunity-v1`): `https://becommunity-v1.ollinagencyllc.workers.dev`
- The connected Supabase project contains synthetic test data **and the real BNI
  Cuicuilco study** — 60 people, 3 282 quantitative answers, 31 qualitative
  answers and 23 human-confirmed themes. It is still not the separate
  real-client production environment required at go-live, which makes real data
  living there a standing risk rather than a licence to treat the project as
  disposable.
- **Observed behavior indicates that merges to `main` rebuild and deploy this
  synthetic beta Worker automatically** (PR #29 was documentation-only, no manual
  deployment was performed, and Cloudflare version
  `2a508633-b985-474a-bc2d-e1ddf38a6c79` appeared afterward at 100%). The
  Cloudflare Git-integration settings have not been read directly through
  configured read-only tooling. Therefore **merge approval is deployment
  approval**: every PR needs its full pre-merge gates and human approval before
  merge, then one bounded post-merge health/smoke check — no retriggers, bursts,
  or polling loops. See [DEPLOYMENT.md](DEPLOYMENT.md).
- Supported roles today: `internal` and `client`. CEO and employee test accounts
  intentionally have the same `internal` permissions; do not claim otherwise.

Never place passwords, service-role keys, cookies, tokens, or connection-string
passwords in this document, commits, PR descriptions, screenshots, or logs.

## Completed framework

P0-P6 capabilities are implemented, including:

- forced RLS and least-privilege client reads;
- server-side authorization and tenant/publication boundaries;
- CSV/XLSX ingestion, mapping, preview, atomic commit and rollback;
- canonical calculations and documented rounding policy;
- template save/instantiate framework with copy semantics;
- live filters, guarded pivot, data-connected journey and qualitative review;
- server-generated authenticated PDF reports;
- longitudinal and narrative client views with per-user data scopes;
- client/user backoffice, study configurator, tenant branding and internal
  client preview.

Arquero is a dev-only parity oracle. Production calculation modules must remain
free of runtime code generation. ExcelJS must remain lazy and use its browser
build on the XLSX branch; CSV must never evaluate its Node dependency graph.

## P6E acceptance record

Synthetic acceptance study:

- ID: `ad275928-dbd1-4acf-9de9-fa1623b32a60`
- Tenant A: `298c79c0-a88e-487b-a63d-3d7062c6111e`
- Name: `ACEPTACIÓN P6E — DATOS SINTÉTICOS (TEST)`
- Status: `published` for human visual acceptance
- Import batch: `bd4f26db-093a-4e31-8fa9-de8281300c63` (`committed`)
- Counts: 20 respondents, 80 quantitative responses, 0 qualitative
  observations, 1 import batch

Technical production acceptance completed with **108 checks and 0 failures**:

- deployed CSV and XLSX analyze/preview;
- CSV commit and database reference integrity;
- 77 expected calculation/filter/pivot/journey assertions;
- internal preview and authenticated PDF;
- draft and publication boundaries;
- Tenant A access and Tenant B isolation;
- 41 tailed production requests with no 5xx, uncaught exception,
  `process.umask`, runtime code-generation or Supabase-key error.

The two older `Satisfacción 2026 (TEST)` studies remain draft and must not be
published, modified or deleted during this acceptance work.

## P6 closure record

PR #28 corrected the narrow-mobile min-content overflow and rebalanced the
server PDF into two readable pages without changing calculations, ingestion,
RLS, roles or data. The focused responsive matrix, PDF layout invariants, full
23-gate suite, typecheck, lint and build passed. The accepted production-shaped
PDF retained metric parity and the human reviewer confirmed the real-phone
layout. The PR was squash-merged and the post-merge Worker health check returned
200 with Supabase connected. **P6 is closed.**

## Current task — P8 closure delivery

P7 engineering is concluded and merged: PR #38 integrated Suites B and C, PR
#37 integrated the owner-accepted P8-A foundation, and PR #39 integrated the
owner-accepted first P8.2 Studio slice. Remote `main` is now
`b1abfefecfc7b3534cc883e47ba95767fa43caea`; subsequent P8 work branches from
it directly. Do not reopen P7 correction loops
during product construction; controls blocked on custom-domain, production
Supabase, billing, full DR or real-client prerequisites return as a bounded
go-live pass after the product is functionally and visually complete.

**P8 is implementation-complete and owner-accepted on
`p8f-responsive-accessibility-acceptance` at `b49df5d`.** Its closure record is
being delivered from this branch; it is not yet merged or deployed. After that
delivery, the next bounded phase is go-live hardening against the final domain,
production Supabase project and operational prerequisites — not another P8
design loop.

P8 discovery and the A/B/C/synthesis comparison are complete. Those artifacts
remain historical evidence, but standalone visual prototyping is closed. The
approved direction is an **Interactive Insight Experience**:

- each client scene follows question → visual evidence → consultant
  interpretation → action;
- `Recorrido` provides guided discovery and `Explorar` provides bounded free
  exploration over the same evidence and calculations;
- Studio is a distinct no-code operational experience for non-technical staff;
- text is preserved through progressive disclosure rather than becoming a wall;
- controlled Be Community, co-branded and white-label modes must preserve
  semantic meaning, contrast and analytical honesty.

**P8-A is implementation-complete and owner-accepted**, delivered on
`p8a-product-experience-foundation` at `3659a38` through PR #37. It implements
the semantic design/brand foundation, sign-in, Studio/Insights shells, client
panorama and rich journey vertical slice, plus the owner-review corrections.
P8-A introduces no migration, formula, RLS/grant, role, ingestion,
authorization or external-system change.

**P8.2 first owner-review slice — owner-accepted and squash-merged through PR
#39 at `b1abfef`.** Two guided Studio workflows now exist in the real product,
and no further P8.2 scope was started:

- **Access scope without JSON.** `/admin/clients` replaces both raw `data_scope`
  textareas — on invitation and on editing — with one accessible no-code picker
  (`src/components/studio/AccessScopeFields.tsx`). It offers a first choice
  between *Todo el cliente* and *Solo una parte*; the characteristics and values
  come from the selected client's own respondent data through the aggregate-only
  server-side reader `src/lib/studies/scope-inventory.ts` (characteristic names,
  distinct values and per-combination people counts — never a respondent row, an
  answer or a quote); it states effective access as a sentence, shows a bounded
  "today" count that is explicitly not a promise, refuses an empty restriction
  instead of widening it to full access, preserves and marks a stored value the
  current data no longer offers, and resets visibly when the client changes. The
  stored contract is unchanged: one hidden `data_scope` field carrying the same
  `Record<string, string[]>`, parsed by the same `parseDataScope` and enforced by
  the same `applyDataScope`.
- **Guided import mapping and readable preview.** `/admin/upload` replaces the
  `min-w-[900px]` mapping table and its five `JSON.stringify` dumps with a
  reflowing card list (`MappingWorkbench.tsx`) and a readable preview
  (`ImportPreview.tsx`). Destinations are chosen from what the client already
  uses — supplied by the analyze step's new additive `knownDestinations` field —
  or created by naming them, with the stable key derived in
  `src/lib/ingestion/destinations.ts` and collisions refused by name rather than
  silently resolved. No canonical segment key, metric key, theme key or recoding
  identifier is typed anywhere. `ImportMapping`, `importMappingSchema`, the
  source signature, the adapters, the counts, the validation errors, the explicit
  confirmation, the atomic commit and the rollback are unchanged.

The slice adds `npm run test:studio-workflows` (gate 27 of `npm test`). It
introduces no migration, dependency, lockfile change, role, formula, RLS/grant,
authorization or external-system change. The completion unit below adds
`npm run test:studio-completion` (gate 28, 44 checks) and one additive
migration; it adds no dependency, no lockfile change, no role, no formula and no
external-system change.

**P8.2 completion — implemented, synthetic-accepted and owner-accepted in the
final P8 pass on 2026-08-27.** The record is
`.design/be-community-v2/implementation-reviews/p8-2-completion/REVIEW.md`.

What now exists in the real product:

- **Eleven `/studio/**` routes**, and every `/admin/**` address still answers.
  Studio gained addresses and renamed none away, because bookmarks, emailed
  links and the frozen adversarial catalogue all depend on the old paths.
  `/dashboard` and `/studio` render the SAME internal home, so the two cannot
  drift. `src/lib/studio/routes.ts` records the pairing.
- **An actionable home.** "¿Qué necesita mi atención?" is built only from state
  the schema can prove: an import left staged or failed, a study with no
  answers, comments nobody reviewed, a moment of the recorrido pointing at a
  result the study does not produce, and a draft carrying data. It is bounded
  and says how many items it left out. No deadline, no assignee, no approval.
- **A study work surface** at `/studio/e/[studyId]` with process steps (datos ·
  resultados y recorrido · lo que dijeron · vista del cliente · publicación),
  each showing where that step stands, and a readiness panel that separates
  what BLOCKS from what merely IMPROVES.
- **The picker contract completed.** The journey's canonical metric key became a
  choice over the results the study genuinely produced, with a consequence
  preview; a stage identifier is generated once and then frozen, because
  `qual_observation.confirmed_stage_key` points at it. The qualitative theme box
  became a selection over existing themes plus a deliberate "create new" path
  that refuses a colliding name instead of silently making a third theme. A
  stored value the data no longer offers is preserved and marked, never dropped
  or repointed.
- **Visible paging.** The qualitative review's `.limit(100)` and the import
  history's global `.limit(30)` are gone; both are counted, filtered and paged,
  page/size/filter parameters are validated server-side against fixed ranges,
  and every read is scoped with an explicit `.eq()`. Bulk qualitative actions
  are page-scoped and say so.
- **Publication has exactly one surface**, `/studio/e/[studyId]/publicar`,
  reached from the client preview. `updateStudyConfiguration` may only re-save
  the state that already holds; `setStudyPublication` independently refuses a
  publication with no acknowledgement, an empty study or an archived client.
- **No `window.confirm()` anywhere.** One accessible dialog names the object,
  the consequence, the reversibility and the recovery path, with honest
  severity: a revert is an ordinary control, and only a permanent action reads
  as danger or requires typing.
- **The account and client lifecycle.** Suspending a person is separate from
  deleting them and is enforced at the authentication boundary, so the product
  can never show "con acceso" for an identity Auth already refuses; "invitación
  pendiente" is a third real state. Archiving a client is the ordinary
  reversible action and is enforced server-side against new studies, new
  invitations and new publications.
- **Permanent client deletion is DISABLED and refused on the server.** It spans
  Postgres rows, Auth identities and Storage objects with no shared transaction,
  and the only order the code could run them in destroys the tenant row first —
  which is exactly the order that can orphan an account or a file. No path
  through the action reaches a row delete, an Auth call or a Storage call. The
  executable impact summary and the exact-name rule are retained and still
  proved; they gate nothing destructive. It returns when there is a recoverable,
  idempotent, resumable cross-system deletion workflow.
- **No lifecycle action succeeds unrecorded.** Permanent USER deletion writes
  durable intent and checks the write BEFORE deleting, then records the outcome;
  a missing outcome is reported as an error, never as a clean success. The
  reversible mutations refuse when the record is unavailable, and undo
  themselves with their own inverse if the record cannot be written after the
  change.

**Migration `0015_client_lifecycle_and_audit.sql` is additive and APPLIED TO THE
SYNTHETIC PROJECT ONLY.** It adds `tenant.archived_at` / `archived_by` with a partial index and
one internal `admin_lifecycle_event` table with RLS, FORCE RLS, a
deny-browser-roles policy, a database-enforced 4096-byte bound on its metadata
(the application sanitiser holds to half that), and **least-privilege grants**:
the default ALL that migration 0001 hands every new table is revoked and only
`select, insert` is granted back to `service_role`, so the evidence table is
append-only at the privilege level. It creates no function, no security-definer
helper and alters no existing policy or grant beyond its own table's defaults,
and `supabase/rollbacks/0015_*.sql` reverses exactly it.

**`docs/P7_PLAN.md` §0.1** records that `0015` is taken: the deferred P7
`audit_log` takes the next available migration number instead. That is a
numbering correction only; P7 is not resumed.

### Tracked schema versus removed drift — migration `0016`

The synthetic project carried RLS policies, and a `private` schema of helper
functions behind them, that existed in **no tracked migration**: the Fase 0
proposal for SECURITY DEFINER helpers that `system_context.md` and
`docs/P7_PLAN.md` both record as **never adopted**. It reached the database
anyway. One of those helpers, `private.can_access_tenant()`, queries
`public.consultant_assignments` — a table in no migration — so every policy
calling it RAISED instead of filtering, and **no authenticated role, client or
internal, could read `public.tenant` at all**.

`0016_remove_untracked_private_policy_experiment.sql` removes exactly that
experiment: seven policies (`profiles_admin_write`, `profiles_select_self`,
`tenant_admin_write`, `tenant_select`, `respondent_select`, `quant_select`,
`qual_select`), the four `private` helpers, the `authenticated` usage grant on
that schema, and the schema itself — the last only after proving it empty and
unreferenced by any policy, routine or view. Every statement is guarded, so the
migration is a no-op on a database built solely from tracked migrations.

It preserves `profiles_select_own`, `tenant_isolation_select`,
`published_study_select`, every `deny_browser_roles` policy, every RLS and FORCE
RLS flag, every grant and revocation from `0000`-`0015`, and every row.
Dropping the rogue SELECT policies **restores** the direct-browser denial on
`respondent`, `quant_response` and `qual_observation`: those tables are left
with no permissive policy, which is the tracked design.

**`confirmed_qual_observation` is not a defect and is not changed.** Migration
`0008` granted `authenticated` SELECT on the view; migration
`0009_client_publication_boundary.sql` deliberately superseded that, revoking
`anon`/`authenticated` and granting only `service_role`. The application loads
confirmed qualitative content server-side on purpose. That boundary stays.
Suspension is deliberately outside that schema. Environments without `0015`
still degrade honestly: `src/lib/studio/lifecycle.ts` detects its absence and
the administrative actions refuse with a stated reason.

**Synthetic acceptance completed 2026-08-25 at `543889a`.** Migration `0015`
was applied to synthetic project `ontvqazsqiwisdddblif`; the canonical offline
chain and the complete live chain passed. Exact-ledger browser acceptance then
proved tenant archive/restore, denial of new work while archived, preservation
of existing client access, user suspension/restore at the authentication
boundary, and permanent deletion of one disposable user with durable intent and
outcome evidence. Cleanup removed both disposable studies and the disposable
tenant; the profile and Auth identity were already absent after the deletion
flow. No matching database, Auth or Storage residue remained. The protected
fixture stayed at 3 tenants, 3 studies, 4 profiles, 22 respondents, 82
quantitative responses, 2 qualitative observations, 1 import batch and 4 Auth
users (0 banned); P6E remained published at 20 / 80 / 0 / 1. Eight append-only
lifecycle evidence rows intentionally remain.

**One lifecycle item remains unavailable:** permanent CLIENT deletion is
disabled outright, independently of migration availability, until a
recoverable, idempotent and resumable cross-system workflow exists.

The supported responsive floor is 320 px. P8.5 also keeps the inherited 258 px
dashboard stress probe as a diagnostic and makes the previously clipped sample
and metric captions wrap safely; 258 px is not promoted into the product
contract.

Template ownership is now closed: the library is shared across the internal
team, the original author remains visible, and migration `0018` makes creation,
updates and instantiation match that product rule without changing the single
internal role model.

**P8.3 Insights data story — implementation-complete and owner-accepted.** The
real product now has
`/insights` and an authorized `/insights/e/[studyId]` route. The home keeps the
latest panorama plus a compact study library instead of stacking complete
studies. A study link carries the same bounded `f.*` selection grammar as the
authenticated PDF; invalid or disallowed selections fail closed and reopen the
unfiltered study with an explicit explanation.

The client story uses the P8-A panorama/finding and journey components, a
plain-language `Compara por...` surface over the unchanged pivot Server Action
and allowlist, and an adaptive longitudinal view: list for fewer than four
periods, chart thereafter, and an expandable table alternative throughout.
Chart points are keyboard reachable and missing results are encoded by shape
and text, never colour alone. The canonical sample string table now also owns
the PDF's privacy and small-base wording. Loading, not-found, route error,
invalid-filter and comparison-error states are named and recoverable.

The finding DTO includes a nullable human-authored interpretation slot. P8.4
now supplies it from a separately published snapshot; an absent snapshot is
still silent and no business interpretation is invented. No formula, canonical
row, ingestion adapter, role or study-publication boundary changed.
`npm run test:insights-story` remains gate 29 of `npm test`. No screenshots were
produced, by owner request; review is in
`.design/be-community-v2/implementation-reviews/p8-3-insights-story/REVIEW.md`.

**P8.4 qualitative, interpretation and customisation — implementation-complete
and owner-accepted.** The
real product adds `/studio/e/[studyId]/interpretacion` with bounded structured
copy and evidence selection, explicit draft/review/approval state and a
published snapshot that is independent from later edits. Only that snapshot
can reach Insights or the PDF. The qualitative view adds a React/SVG word cloud
and image download without replacing the counted list; the journey keeps a
small set of confirmed friction themes next to each moment.

Presentation now resolves Be Community defaults → client identity/defaults →
study override. The ordinary interface exposes palette, cover copy, visible
modules, journey setup and one focused metric threshold without JSON, internal
keys or arbitrary CSS; templates preserve the study configuration and are
shared with author attribution. Migrations `0017` and `0018` are applied only
to the synthetic project. The deterministic gate is
`npm run test:p8-qualitative` (gate 30); the disposable live lifecycle also
passed and left zero interpretation-event residue.

**Owner decisions recorded 2026-08-24, binding on every later unit:**

- **Absence is not a client-facing finding (contract C11).** A published study
  is a finished editorial product. Anything Be Community chose not to publish,
  or has not finished reviewing, produces silence on the client side — no
  placeholder, empty card, heading, reserved row, border or explanatory copy.
  Statements that qualify a result the client *is* shown (small base, suppressed
  segment, missing data behind a visible number) are preserved: those are
  analytical honesty, not omissions. Internal Studio and the internal preview
  own the omission warnings and must keep naming them, visibly marked as
  internal.
- **P8.2 additionally owns** the no-code access-scope picker that retires every
  raw `data_scope`/JSON textarea, and a discoverable account lifecycle: suspend
  versus permanently delete a client user, archive a client organisation as the
  ordinary reversible action, and permanent organisation deletion only behind an
  impact summary and exact-name confirmation.
- **P8.4 additionally owns** controlled per-study presentation inheritance —
  Be Community default → client identity → study override — covering identity,
  palette, semantic colours, threshold values and labels, module visibility and
  order, visualization variants, editorial copy and the journey's stage
  definition, with templates preserving that configuration. It is bounded
  no-code customisation: contrast, responsiveness, semantic meaning, analytical
  honesty and accessible fallbacks stay enforced by the product.

Details are in `docs/P8_PRODUCT_EXPERIENCE_PLAN.md` (§3 C11, §5). P8.2, P8.3
and the bounded P8.4 implementation are complete and owner-accepted.
P8.5 is complete: the deterministic gate is gate 31,
and the rendered authenticated matrix covers the client and Studio route set at
320/360/390/768/1024/1280 px without screenshots. The owner completed the real-
phone pass on 2026-08-27 after the LAN hydration, mobile account-row and
relative-scale corrections in `8a4437a` and `b49df5d`, then accepted the result.
P8 is closed. Studio intentionally has no top-level loading boundary: the internal-role guard
must resolve before the framework can stream a successful response. Pending
labels inside authorized tasks provide progress without weakening that rule.

## P7 engineering record (historical; do not resume during P8)

P7 is the final V2 hardening and go-live-preparedness phase, not a feature
reprioritization. Its acceptance gate is: all adversarial suites A-E green and a
backup restore tested. The complete intended scope is:

- reconcile and run tenant-isolation, authorization, input/injection,
  secrets/supply-chain and edge/auth-resilience suites;
- audit logging for authentication, administrative mutations and imports, plus
  actionable anomaly alerting;
- a backup mechanism suitable for the current tier and a demonstrated restore;
- an incident playbook covering key rotation, session revocation, containment,
  recovery and verification;
- production-branch hygiene and a deliberate deploy strategy;
- monitoring and the remaining Cloudflare/Supabase go-live controls;
- separate production Supabase provisioning and the Pro upgrade trigger before
  any real client receives a link.

Begin with a read-only evidence inventory against the architecture,
`docs/GO_LIVE_SECURITY.md`, `docs/OPERATIONS.md`, current code, migrations,
scripts and live test environment. Produce a phased `docs/P7_PLAN.md` that
separates work executable now from controls blocked on a custom domain, a new
production Supabase project, billing decisions or real-client go-live. Stop for
human review of that plan before implementing P7. Do not create infrastructure,
change credentials, rotate keys, alter production data or enable irreversible
edge controls during the inventory task.

### P7 execution progress

`docs/P7_PLAN.md` is approved. PRs 1-6 are merged and deployed to the synthetic
beta: the evidence plan; Worker identity/deployment discipline; supply-chain,
Suite D and offline CI; executable RLS/FORCE-RLS coverage; the reviewed
adversarial harness; and Suite A.

The merged harness contract remains `docs/P7_HARNESS_DESIGN.md`:

- `scripts/lib/{http-harness,harness-browser,harness-fixtures}.mjs` plus
  `scripts/harness-selftest.mjs` provide the assertion-neutral mechanism;
- mechanisms are frozen per operation; no hashed action IDs, hand-built RSC
  payloads, hidden bypass or runtime fallback is permitted;
- live browser execution uses Linux Chrome from WSL as the ordinary non-root
  user, with sandboxing enabled;
- privileged access is confined to fixture provisioning, bounded metadata
  accounting and exact cleanup; it is never authorization evidence.

Suite A is committed as `scripts/suite-a-isolation.mjs`, executes 16/16 required
controls, and is part of the canonical live release chain. Its final gates
passed; the merge deployed Worker version
`654949b8-649c-4a48-a754-9d4aab7426c0` at 100% traffic. The bounded post-merge
health, logged-out, Tenant A, Tenant B isolation and internal-route smokes all
passed with zero `P7A-`/`P7H-` residue. The commit-to-version record lives in PR
#36's conversation as required by `docs/DEPLOYMENT.md`.

**P7 final engineering unit (merged via PR #38):** branch
`p7f-suites-b-c` — behavioral Suite B
(authorization) and Suite C (hostile input/injection). Both were implemented,
green and integrated into `main`:

- `npm run suite:b` — 64/64. Its evidence is reported in **three layers that
  are never summed**, because conflating them is how a page-level GET gets
  counted as action coverage:
  1. *catalogue completeness* — one required B1 and B2 row per catalogued
     mutation plus the report route, generated from the frozen catalogue, so a
     new mutation arrives with no result and an unexecuted entry is red;
  2. *outer action route* — one ordinary form-shaped POST to the exact method
     and path each Server Action is dispatched to (no `Next-Action` header, no
     private field, no body), with a positive discriminator and a bare-POST
     405 negative control per path class;
  3. *observable inner Server-Action denial* — only where the application
     actually produces one, which is one operation of eighteen.
  The suite states explicitly that it does **not** claim all eighteen inner
  Server Actions were invoked; they cannot be reached without the hashed action
  identifier or a hand-built RSC body the design forbids.
- `npm run suite:c` — 13/13, including an inert hostile payload carried through
  the real ingestion and human-review workflow and then **positively located**
  in the generated PDF's decoded displayed text as well as in the rendered
  client dashboard. C1.3 fails if the payload is absent, so it can no longer
  pass on a report the quote never reached.
- `npm run gates:live` now runs `test:qualitative-live -> suite:a -> suite:b ->
  suite:c`, each exactly once. `npm test` gains `test:pivot` (previously
  orphaned) and the credential-free Suite B/C self-test, reaching 26 gates.
- Every run restored its exact pre-run object counts and left zero `P7A-`,
  `P7B-`, `P7C-` or `P7H-` residue.

Two behaviors PR 7 measured that a reviewer should read before merging, both
recorded rather than asserted past:

1. **The middleware answers before every per-action guard.** An unauthenticated
   caller is denied on every non-public path — including the POST a Server
   Action travels on — so `internalContext()`, `authorizeInternal()` and the
   report route's own 401 are a real second layer that is shadowed from
   outside. Suite B asserts the denial at whichever gate answered, proves the
   outer boundary on the action route's own POST method and path, and records
   which layer each result came from. This is defense in depth working, not a
   gap. One path class is a stated limitation: `/admin/upload` answers a
   wrong-role caller with HTTP 200 and a rendered denial page rather than a
   status, so no status-level claim is made there and its denial is proven at
   the browser layer instead.
2. **An over-limit upload was refused silently — now corrected in the product.**
   Next truncates the request body at its own cap and the action then throws, so
   the upload action's own `MAX_UPLOAD_BYTES` check was unreachable and the
   operator saw nothing. PR 7 adds the smallest correction that fixes it:
   `exceedsUploadLimit()` joins the shared validation module and the upload form
   refuses an over-limit source on selection, leaving the analyze control
   disabled. The server-side check is untouched and remains authoritative. C2.3
   now requires a rendered rejection **and** zero dispatch; C2.4 proves an
   ordinary in-limit source is still accepted. **This makes PR 7 no longer
   test-only:** it touches exactly two application files,
   `src/app/admin/upload/UploadForm.tsx` and `src/lib/validation/schemas.ts`,
   both admitted to the structural scope guard by name.

Suite E and external go-live controls were not declared green. They remain
deferred release-state evidence, not the active product-construction unit.

## Known constraints carried forward

- **The lockfile has one authoring version: npm 10.9.2.** It is declared in
  `package.json` (`packageManager`), installed and asserted by CI before
  `npm ci`, and enforced by Suite D's D-f. npm 11 prunes peer nodes beneath
  platform-excluded optional dependencies out of the lockfile; npm 10 — which
  Cloudflare's build image runs — still requires them, so a regeneration under
  npm 11 is green locally and in CI and then stops the deploy build before it
  starts. Regenerate dependencies only under npm 10.9.2.
- **No repository npm lifecycle command runs on the Windows workstation.**
  Smart App Control is enabled there and blocks Cloudflare's unsigned
  `workerd.exe`. This is not confined to `cf:build`: a plain `npm ci` runs
  package lifecycle/install validation that loads that binary, and Windows Code
  Integrity event 3077 recorded three such blocked loads on 2026-08-23 —
  two from disposable install directories and one from the main repository
  `node_modules`. Treat `npm install`, `npm ci`, `npm test`, `npm run build`,
  `npm run cf:build` and every gate chain as Linux-only. Windows is for editing,
  Git and static inspection. Do not disable Smart App Control and do not attempt
  a per-file bypass.
- **The verifier does not auto-synchronize.** Node/npm verification runs in WSL 2
  Ubuntu (`/home/patop/becommunity-software`, ordinary user `patop`, Node
  24.11.1, npm 10.9.2) or Linux CI.
  Push the exact commit from the Windows editing tree first, then fetch and check
  out that exact remote commit in WSL. The verifier clone must be full-history
  and full-blob: Suite D's D-d proves every reachable blob, which a `blob:none`
  partial clone cannot do.
- **Live browser evidence runs in WSL as a non-root user, with Linux Chrome.**
  The harness self-test requires a real browser (design §3.2, S0), and it must be
  the browser's Linux build inside the distribution, selected with `CHROME_PATH`.
  Run it as an ordinary user rather than root, so the browser sandbox stays on
  and `--no-sandbox` is never needed. **Never launch the Windows Chrome executable
  from WSL:** its DevTools endpoint binds on the Windows side and is unreachable
  from the distribution, and it cannot resolve a Linux profile path, so the run
  fails at S0 with no browser coverage.
- `npm run cf:build` can also fail on Windows with OpenNext's documented symlink
  `EPERM`; Cloudflare's Linux branch build is the authoritative bundle check.
- Local OpenNext output **does** contain inlined environment values:
  `cf:build` writes `.open-next/cloudflare/next-env.mjs` with every variable from
  a local `.env*` file as a literal. `.open-next/` is gitignored; never deploy or
  upload it from a machine with a populated `.env.local`, and purge it after
  checks. `npm run test:secrets` now scans it and fails on exactly this;
  `npm run suite:d` is the full supply-chain gate and runs on Linux CI.
- The current synthetic environment is not the final staging/production split.
- Some P7 controls require decisions or external prerequisites (custom domain,
  production Supabase project, billing/Pro activation). The P7 plan must expose
  these dependencies rather than silently skipping them or treating them as
  already complete.

## Real-study ingestion extension (2026-08-27)

The first full-fidelity client workbook exposed two source shapes that the
synthetic fixtures intentionally did not model. They now have explicit, separate
boundaries:

- respondent identifiers and operational timestamps may be mapped as **private
  team data**; they are stored only with raw respondents and are never selected
  by the client-authorized study loader;
- monthly membership counts are imported as an aggregate period series, with
  retention and churn recalculated from the counts, never synthesized as fake
  respondents;
- standards-compliant XLSX files that use an explicit SpreadsheetML namespace
  prefix are accepted. Unsupported table presentation metadata is ignored only
  in the fallback reader; worksheet cell values remain the import source.

Migration `0019_private_metadata_and_period_series.sql` carries the new private
column, aggregate tables, forced RLS/revocations, and atomic commit functions.
The extension does not broaden the browser data boundary or alter existing
calculation formulas.

## Required verification discipline

Use the scripts in `package.json` as the source of truth. At minimum, every PR
must run its focused tests plus:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run all of these in WSL or Linux CI, never on the Windows workstation — see
"Known constraints carried forward" above.

Security/release work also runs the applicable live isolation and secret gates.
Never mark an unexecuted check as passed, never alter expected calculations to
make a test green, and never bypass the real application workflow by manually
inserting acceptance rows.

## Canonical multi-workbook study foundation (local branch, 2026-09-01)

The Cuicuilco workbook audit established that the existing row-oriented import
cannot preserve stable people, participation cohorts, multiple instruments,
contextual worksheet formatting, monthly performance, multiple journeys and
curated pain-point relationships with full provenance. A new additive schema is
therefore staged on the development branch in migrations `0026`, `0027` and
`0028`.

The schema and its rollback scripts are documented in
`docs/CANONICAL_STUDY_MODEL.md`. Migration `0028` adds the transactional commit,
its ownership ledger and its rollback. All 36 new tables are service-only with
RLS and FORCE RLS. Existing application tables and read paths remain active and
no existing data is rewritten.

⚠️ **These three were renumbered from `0022`-`0024`.** Those numbers collided
with four migrations the hosted project had already applied, and this repository
now carries those four as `0022`-`0025` imports. The full map, the proof that the
rename changed no executable SQL, and the authoritative hashes are in
`docs/CANONICAL_STUDY_MODEL.md`; `npm run test:migration-chain` enforces the
result.

⚠️ **Superseded on 2026-09-06: `0026`-`0028` are now APPLIED to the hosted
project** (`ontvqazsqiwisdddblif`), and the ledger reads 0000-0028. What this
entry still records correctly is that the **Cuicuilco workbooks have not been
loaded into the new model** — the canonical tables are empty — and that nothing
has been deployed to Cloudflare. The hosted project also records migrations
numbered 0022-0025; those are the imported `semantic_category_review` and
`experience_*` migrations from other branches, not this branch's work.

### Unit 2 — package parser and preflight (source only, local branch)

`src/lib/ingestion/canonical-package/` reads a multi-file package and validates
it against a versioned specification. **It parses and validates only.** There is
no Supabase client, no insert and no RPC anywhere in the module, no canonical
row is written, no migration has been applied, and nothing was deployed. The
deterministic gate is `npm run test:canonical-package`, registered in
`npm test`.

- `readXlsxWorkbook()` reads EVERY worksheet with physical coordinates, keeps
  the exact worksheet name (one real source sheet ends in a space), keeps a
  formula's text apart from the value it cached, and keeps style and merge
  evidence UNINTERPRETED. `readXlsx()` and `parseXlsx()` are unchanged, and the
  legacy gates plus the new gate's own legacy section pin that.
- **XML namespace prefixes are honoured on each part independently.** The
  relationships document is a separate part with its own declarations, so
  `<rel:Relationship>` must resolve exactly as `<Relationship>` does; matching
  only the unprefixed form produced an empty relationship map and every sheet
  silently fell through to its ordinal part. Attributes are matched by local
  name, which is what keeps `sheetId` from being read as the relationship id.
- **A colour is never given a global meaning.** The reader records it; a
  configured, human-reviewed `visual_annotation` decides what it means.
- Roles are resolved by **structural signature, never by file name**, and the
  package idempotency key is derived from the mapping version, the roles and the
  file hashes sorted by role — so the same two files uploaded in either order
  are the same package.
- **Absence never becomes zero.** `NA`, `Sin dato`, `Sin información`, a blank
  and a spreadsheet error are typed absence states; `No participó` is not an
  answer; a participant with no numeric month stays `source_unavailable`.
- **The preflight DTO carries no private value.** No name, answer, qualitative
  text, category value or identifier appears in it — it is displayed, logged and
  destined for `import_job.error_report`. Findings name the sheet and the
  coordinate so a human can open the source. Alias candidates report a column, a
  count of spellings and coordinates, never the spellings themselves.
- Confirmation is allowed if and only if there are zero blockers.

The contract is documented in `docs/CANONICAL_STUDY_MODEL.md`.

### Unit 3 — server-only commit and rollback (source only, local branch)

`src/lib/ingestion/canonical-commit/` projects a validated package into
canonical records and writes them through one transactional RPC. Migration
`0028_canonical_commit_and_rollback.sql` and its reverse script carry the
schema. When this entry was written, none of `0026`-`0028` had run anywhere.

⚠️ **Superseded on 2026-09-06.** The hosted project has been contacted
repeatedly since — a read-only inventory, a read-only diagnostic, two verified
retained backups, the fail-closed deletion of the duplicate study recorded
above, and then the application of `0026`-`0028` followed by a synthetic
acceptance run. What still holds: **no canonical row from real data exists in
any environment**, no Worker was built or promoted, and no real workbook was
uploaded. The canonical tables have only ever held synthetic `U4-` fixtures,
which the run deleted. The deterministic gate is `npm run test:canonical-commit`
(306 checks), registered in `npm test`.

The full contract is in `docs/CANONICAL_STUDY_MODEL.md`. What a reader needs
before touching this unit:

- **A privacy-safe report cannot be the persistence payload.** The Unit 2
  preflight DTO was NOT widened. `CanonicalCommitPlan` is a separate internal
  type that carries the real names, identifiers, answers and qualitative text a
  commit needs, and it may travel to exactly one place: `p_plan` of
  `commit_canonical_package`. The gate plants sentinels where private values
  would be and fails if one reaches the preflight, the stored manifest, the
  result or any error path.
- **The write path is `server-only` and it is the only module that knows about
  Supabase.** `flow.ts` holds the workflow behind an injected transport so the
  whole order of operations is executable in a test; `adapter.ts` and
  `server.ts` carry the marker; `index.ts` re-exports neither, so importing a
  type cannot drag the write path into a client bundle. A browser has no
  privilege regardless: both RPCs are granted only to `service_role`.
- **Scope is derived from a LOCKED `import_job` row**, never accepted from the
  payload. The payload states its own tenant and study so the database can
  refuse a mismatch. Assets are cited by ROLE and resolved through the job's own
  `import_job_asset` links.
- **Counts are measured by the database**, family by family, with `ROW_COUNT`,
  and compared against the plan's declared counts. A disagreement raises and the
  transaction is discarded.
- **`import_job_record` is the ownership ledger.** Rollback removes exactly the
  rows this package CREATED, in reverse dependency order, and leaves rows it
  merely REUSED alone. A person shared with another study is kept and counted.
  `source_asset`, `import_job_asset` and the `import_job` audit row deliberately
  survive a rollback.
- **Retention does not touch `study_period_snapshot`.** That legacy aggregate
  cannot represent an absent count and is a surface the current application
  already reads, so Unit 3 writes its own `retention_period` table with each
  source count and its state.
- **No database message ever escapes.** A constraint violation quotes the
  failing key values, which here are respondent data. Only a code the migration
  raised itself is kept; everything else becomes `DATABASE_CONSTRAINT`.

**Three levels of proof, and they are not interchangeable.**

1. *Projection.* `npm run test:canonical-commit` (306 checks, gate 11 of
   `npm test`) exercises the projector, the private/safe boundary, count
   reconciliation and the whole workflow against a fake transport, and executes
   the database gate's own refusal rules so a weakened guard fails `npm test`.
2. *Local PostgreSQL transaction.* `npm run test:canonical-commit-live`
   (**executed**) creates disposable databases, applies the bootstrap and
   migrations 0000-0028 verbatim, drives `runCanonicalCommit` and
   `runCanonicalRollback` through a `psql` transport, and asserts the resulting
   database state — L1 to L16 plus the review's extra cases. It is deliberately
   OUTSIDE `npm test`. **140 assertions with the real workbooks supplied; 135
   executed and 1 skipped without them.** The skipped one is the real-package
   serialization boundary, and it is reported as skipped, never as a pass.
3. *HTTP transport.* **Executed against a LOCAL PostgREST only. The canonical
   suite has never been run against a hosted project, and a local PostgREST run
   is NOT equivalent to hosted canonical execution** — the hosted project runs a
   different PostgREST build, and its gateway, timeouts and catalogue are its
   own. This level is separate from the read-only inventory, diagnostics, backup
   and single rehearsed deletion that HAVE touched the hosted project; none of
   those executed a canonical migration or a canonical RPC.
   `npm run test:canonical-commit-local-stack` runs the same suites through
   supabase-js and a real PostgREST 16.2, in front of a disposable
   PostgreSQL 17.11 cluster: **102 assertions, 102 passed, 0 failed, 66
   skipped**, with all 41 protected tables and 4 functions present and the
   protected-object census identical before and after.
   ⓘ **Two runs, and only the second describes the chain now on disk.** The
   figures above were first measured over the OLD `0000`-`0024` chain, before
   the renumbering. The suite was RE-EXECUTED on 2026-09-06 over the reconciled
   `0000`-`0028` chain — including the four imported migrations — and returned
   the identical tally: **102 executed, 102 passed, 0 failed, 66 skipped**
   (27 needing DDL the REST transport does not have, 25 error codes this run
   never provoked over HTTP, 8 needing `pg_catalog`, 5 needing concurrent
   sessions, and 1 needing the real workbooks, which were deliberately not
   supplied). Neither run touched a hosted project. It settled the
   supabase-js result shape, the error shape, the service-role key path, and
   that PostgREST parses a 2 708 830-byte plan body (110 ms; the largest real
   commit body was 2 708 898 bytes at 441 ms). `npm run test:hosted-target-guard`
   (153 assertions, IN `npm test`) executes every refusal that guards it.
   **Still unproved by anything local, and not to be described otherwise:** the
   hosted API gateway's own body limit, the hosted `statement_timeout` under
   load, recovery from a timeout killed mid-commit, building 0026's index
   against a populated `respondent` table, and catalogue parity with Supabase's
   own extensions and default privileges.

**Levels 2 and 3 run the same assertions.** `scripts/lib/canonical-suite.mjs`
holds them and reaches the database only through the contract in
`scripts/lib/canonical-suite-transport.mjs`; a transport declares what it can
do, and an assertion it cannot execute is recorded as SKIPPED naming the missing
capability. `npm run test:canonical-commit` fails if the suite learns about
`psql` again, or if the ledger starts counting a skip among the passes.

**The local server was obtained without installing anything.** `apt-get
download` plus `dpkg-deb -x` place PostgreSQL under the ordinary user's
home — 18.6 by default, or the `supabase/config.toml` major with
`BECOMMUNITY_PG_VERSION=17`, which is fetched from the PostgreSQL APT pool and
verified against a pinned SHA-256 before it is unpacked — no dpkg entry, no system file, no service, no `sudo` (which is not
available on this machine). The cluster listens on no TCP address at all, only a
unix socket in that directory; each suite gets its own
`becommunity_canonical_test_*` database, dropped on success and on failure; the
whole tree is deleted afterwards.

**Level 2 found five defects that level 1 could not**, all fixed at the root
with regression coverage: record identifiers were scoped to the package and not
the study, so the same files imported into a second study collided on every
primary key; rollback deleted the external identifier of a person it retained,
making that identity invisible to the reuse path; "created" was decided by
comparing identifiers rather than by the identity lookup; a duplicated asset
failed with a cardinality violation instead of a named code; and the reverse
script would have dropped the ownership ledger while packages still owned rows.
`docs/CANONICAL_STUDY_MODEL.md` records each one.

**Measured for the real Cuicuilco package, without any content:** a 2.58 MiB
plan; commit 1 431 ms of which the RPC was 716 ms; rollback 91 ms; 3 559
canonical rows and 5 029 lineage rows written and then removed; the database
independently measured 60 persons and 1 685 responses.

**Real-workbook dry run.** `npm run test:canonical-commit-dry-run` runs the
preflight and builds the plan in memory against the two real Cuicuilco
workbooks, performs no database or network operation (it reads its own module
graph and fails if any of it reaches a database), prints only approved
aggregates, and asserts before printing that no plan value appears in its own
output. It reconciled 60 identities, 28 active and 32 former participations, 4
instruments, 62 items, 116 sessions (95 answered, 21 explicitly
non-participating), 1 685 responses, 252 monthly observations across
October 2025–June 2026, 6 retention periods all satisfying the count identity,
18 journey stages, 10 organizational units, 20 culture dimensions, 7 curated
performance dimensions, 50 pain points and 5 029 lineage rows citing all 16
worksheets. Neither workbook, nor any output of that run, is in Git.

### Unit 5 Phase 1 — canonical server-side results model (source only, 2026-09-06)

`src/lib/results/` is the first authoritative, server-side results layer: one
versioned, aggregate-only document (`CANONICAL_RESULTS_CONTRACT_VERSION 1.0.0`)
that a future dashboard RECEIVES rather than computes. Its contract, authority
rules, resolved authority decisions and configuration requirements are documented in
`docs/CANONICAL_RESULTS_MODEL.md`; read that before touching any of it.

⚠️ **Nothing changed outside the new folder except three additions and two
documentation corrections.** `src/lib/calc/business-metrics.ts` gained
`processUnawarenessTdp`, the auxiliary `unawarenessShareOfResponses`, an
explicit-scale CSAT wrapper and the confirmed CRI vocabulary; every existing
function, signature and behaviour is untouched. No existing read path, route,
component or client-visible calculation was changed, and the legacy dashboard
still computes through `src/lib/dashboard/view.ts` with its own small-sample
suppression, exactly as before.

**What it does.** Pure, deterministic, transport-free calculators reuse
`src/lib/calc/*` — nothing here defines a formula — over a neutral record set
(`CanonicalResultSource`) that an adapter produces. The in-memory adapter builds
that record set from the Unit 3 commit plan; a database-backed adapter producing
the identical shape is later work, and no calculator changes when it lands.

**The adapter is the redaction boundary.** No person crosses it — the read model
addresses a participation by an opaque id and the contract has no field for a
name. No free text crosses it: an answer keeps its words only when its item is on
a closed-coded allowlist. Private attributes are dropped whole. Curated findings
travel as counts and review status, never as prose.

**No suppression.** The methodology defines none and the client decision on
record is that sample size is reported, never used to withhold. Every result
carries its exact base plus a full accounting that keeps empty, missing,
invalid, not-applicable, non-participation and a measured ZERO distinguishable.
`src/lib/calc/disclosure.ts` is unchanged and still governs the legacy path.

**Golden parity against the approved dashboard — EXECUTED, offline.**
`npm run test:canonical-results-parity <clean.xlsx> <curated.xlsx>` builds the
projection in memory from the two real workbooks and compares against
`scripts/fixtures/cuicuilco-golden-parity.v1.json`, derived only from the
approved dashboard at `a7248fdbccd139da80ed7c09daa70f006a62b9cf`:

    ofrecidas=534  ejecutadas=531  aprobadas=531  falladas=0  omitidas=0
    sin-resolver=0  no-aplica=2  requieren-configuración=1

Plan fingerprint `sha256:a226b70c7ddc314424adadd5563a7da4a11bdc096b3bb64994dbc01df436e388`.
It is deliberately OUTSIDE `npm test` — its inputs are machine-specific, and an
unexecuted gate must never be counted among the offline results. Without the
workbooks it reports itself SKIPPED, never as a pass. `npm run test:canonical-results`
is the 233-check synthetic gate that runs everywhere and IS in `npm test`.

**Both gates were proved to discriminate**, then restored byte-identically:
changing the CSAT satisfied threshold turned parity red with 88 failures, and
moving one expected value by 0.1 turned it red with one.

**Three things were recorded as UNRESOLVED, and the methodology owner RESOLVED
all three on 2026-09-06. Not one approved number moved: golden parity was
531/531 before and after.**

- ⓘ **TDP is the §4.1 RATIO over the valid base**, which is also what the
  approved dashboard computes. It may exceed 100 and is never clamped.
  `docs/CALCULATION_CATALOG.md` §5 defined the other denominator and has been
  CORRECTED, with the previous definition and the reason kept on the page. The
  other quantity survives as an auxiliary proportion under its own explicit
  name (`unawarenessShareOfResponses` / `touchpoint.unawareShareOfResponses`),
  is never called TDP, never replaces it and always states its denominator.
  Canonical implementation: `processUnawarenessTdp`.
- ⓘ **Esfera × CRI is FORBIDDEN.** §5.2 is authoritative; the emergency
  dashboard offering the cross is a reference-dashboard deviation, not a
  methodological override. The canonical layer refuses it with
  `cross_not_permitted` and publishes neither a distribution nor a base
  computed over that cross. Do not add or enable it anywhere.
- ⓘ **A touchpoint DIRECTLY owns its CSAT, its TDP and the auxiliary
  unawareness share, with their bases. No study-level metric is implicitly
  attached to a touchpoint or a stage, and no generic association is ever
  inferred.** That is a CONTRACT RULE, not an uncertainty about Cuicuilco.
  `journeyStageEvidenceLinks` stays in the contract and stays empty unless an
  explicit study/template configuration supplies a link with provenance;
  `journey.stageEvidence` reports `requires_explicit_configuration`. The
  eighteen-entry "unknown candidate" gap report is GONE — it described a
  working design as a permanent defect. The approved dashboard's hand-written
  alias table is not copied into production code.
- ⓘ **The curated journey pain cloud is editorial content**, supplied by human
  review and configuration, not a server-calculated metric and not a blocker on
  the canonical import. The contract emits curated finding counts per curated
  entity instead, which real foreign keys support; no phrase-splitting rule is
  invented and no alias is copied into the calculation layer.

**The `Capitanes` / `ref.` exclusion, resolved.** The clean workbook — the
canonical source — carries that touchpoint ONCE, populated, at `CSAT!AY2`, and
it is NOT excluded. The literal string `ref.` appears in neither workbook. The
broken duplicate is in the revised journey CSV, column `AC`, whose 19 data cells
are all `#REF!`. The exclusion is implemented as a general rule — a touchpoint
whose records are all `source_unavailable` is excluded and REPORTED — so a
populated column is never removed and a blank one is reported as having no data.

**Reviewed adversarially before it was committed.** Fourteen claims were
verified against the files; three were refuted and eleven confirmed, and all
eleven are fixed — among them a journey exclusion decided inside the filtered
scope (so a filter could change which touchpoints existed), a refused
Esfera × CRI cross that published five zero counts beside a real base, an
instrument base that collapsed under a filter, and shares emitted as 0 over an
empty base. **Not one approved number moved:** golden parity was 531/531 before
and after. The synthetic gate grew from 174 to 210 checks and now enforces the
base nesting rule (`valid <= responded <= eligible`), the accounting partition
and the subset-of-answered rule on EVERY base in the document. The full table is
in `docs/CANONICAL_RESULTS_MODEL.md` §8.

**Still not done AT THE END OF PHASE 1, and true only of that phase:** no real
workbook had been imported, all 36 canonical tables were empty, no hosted
service had been contacted by that unit, no read path was switched, and no
dashboard UI existed. Phase 2, below, changed the first three of those.

### Unit 5 Phase 2 — the real Cuicuilco canonical import (EXECUTED, 2026-09-06)

**The two real workbooks are imported into the hosted canonical tables, and the
results calculated FROM THOSE TABLES reproduce the CEO-approved dashboard
531/531.** Nothing client-facing changed: the application still reads through
`src/lib/dashboard/view.ts`, no route imports either canonical path, the study
is still `draft`, no qualitative approval moved, and every legacy count is
exactly what it was.

#### The commits

| commit | what |
|---|---|
| `2450bc5005763db9a273d457b789e9fe769fa85c` | source only — the database-backed adapter, the operator, the gates. **This is the commit that performed the import.** |
| this one | documentation and evidence only |

#### Two fingerprints, and they are not the same number

The plan fingerprint covers the WHOLE plan, and every derived record id is
derived from the package key TOGETHER WITH the tenant and the study
(`canonical-commit/ids.ts`). A plan for a different study is therefore a
different plan with a different fingerprint, by construction. Both were verified
immediately before the write.

| what | value | scope |
|---|---|---|
| package idempotency key | `sha256:bb9a4a98497ef38f6e2d1962de0d8596e5b968e1987ad8b8eceb6ad6df8b3097` | **scope-free** — mapping version, asset roles and file hashes only |
| plan fingerprint, placeholder scope | `sha256:a226b70c7ddc314424adadd5563a7da4a11bdc096b3bb64994dbc01df436e388` | the disposable tenant/study the dry-run and golden-parity gates use |
| plan fingerprint, **IMPORTED** | `sha256:099863e8bd0a74477611ae0e35f29eb83cccf912c5de7a56b0c07952970e7bfc` | tenant `e63b2092…`, study `cd4d6acd…` |

The source bytes, by content — the revised CSV was NOT imported and remains
structural reference only:

| role | sha256 | bytes |
|---|---|---|
| `clean_study_data` | `sha256:8d7afdb479208d47e4cd2b08fac5d480f3f945edcf448f52eb588a41e167bca5` | 62 894 |
| `curated_pain_map` | `sha256:bd0e70d7fbb73a6834c8e4cfd5ad768ea6c3db6ffcf0682179fe58fcc3fbc890` | 143 362 |

#### The import

- **Project** `ontvqazsqiwisdddblif` (`be-community-dev`), **tenant**
  `e63b2092-244e-4751-b7e9-19172a9f6b41` (BNI Cuicuilco), **study**
  `cd4d6acd-88b9-4804-829f-75b6d91a32b7` («La voz de las y los Nets de
  Cuicuilco»), resolved from the database by full uuid, never by a prefix.
- **Import job `1886a359-f2c9-483a-8b5e-979931841a71`**, `committed`
  2026-09-06 21:36:00.772508+00, `rolled_back_at` null, 1 commit attempt, 0
  rollbacks. `runCanonicalCommit` end to end: **6 232 ms**; the plan body was
  2 704 594 bytes.
- **8 588 plan rows across 32 families**, reconciled THREE ways and in
  agreement: the plan's declared counts, the database's own measurement inside
  the commit, and an independent per-table count afterwards. The ownership
  ledger holds **3 559** rows, every one `created`; **60 persons created, 0
  reused; 60 external identifiers created, 0 reused**.

| table | rows | table | rows |
|---|---|---|---|
| `person_private` | 60 | `band_scheme` | 4 |
| `person_external_identifier` | 60 | `band_rule` | 13 |
| `study_participant` | 60 | `retention_period` | 6 |
| `membership_episode` | 60 | `metric_definition` | 116 |
| `attribute_definition` | 24 | `metric_item_link` | 114 |
| `participant_attribute_value` | 716 | `journey_model` | 1 |
| `response_scale` | 3 | `journey_stage` | 18 |
| `response_option` | 21 | `journey_stage_evidence_link` | 0 |
| `survey_instrument` | 4 | `organizational_unit` | 10 |
| `study_domain` | 4 | `culture_dimension` | 20 |
| `survey_item` | 62 | `pain_point` | 50 |
| `survey_session` | 116 | `pain_point_journey_stage` | 15 |
| `survey_response` | 1 685 | `pain_point_organizational_unit` | 8 |
| `visual_annotation` | 22 | `pain_point_performance_dimension` | 7 |
| `performance_dimension` | 8 | `pain_point_culture_dimension` | 20 |
| `performance_observation` | 252 | `source_lineage` | 5 029 |
| | | `import_job_record` | 3 559 |

- **Idempotent replay proved.** The same request was executed a second time: the
  database reported `replayed = true`, reused the SAME import job, wrote no
  row, and left every table count, every ownership count and the commit-attempt
  counter unchanged (`2 542 ms`).
- **No canonical row belongs to any other study.** `study_participant`,
  `survey_response`, `source_lineage`, `import_job` and `import_job_record` all
  count 0 outside `cd4d6acd…`.

#### Parity, read exclusively through the database-backed adapter

`npm run canonical-database-parity` reads the committed package back out of the
canonical tables — paged, scoped by tenant AND study, 4 858 ms — and:

- **A.** all **20 read-model families are deep-equal** to the in-memory
  projection's, once both are put into the shared comparison order, and the
  source identity matches.
- **B.** the two results documents are **byte-identical** (533 302 bytes,
  contract `2.0.0`). Compared again against the document built in the
  PROJECTOR's own order, **no value, count or base differs**; the only paths
  that differ are the twenty leaves of `results.population.instruments`, whose
  order the contract explicitly delegates to the adapter.
- **C.** golden parity against the approved dashboard, **from the database**:

      ofrecidas=534  ejecutadas=531  aprobadas=531  falladas=0  omitidas=0
      sin-resolver=0  no-aplica=2  requieren-configuración=1

  The three resolved classifications are preserved exactly: two
  `not_applicable` (`journey.stageEvidence`, `journey.unawareShareOfResponses`)
  and one `configuration_required` (`qualitative.recorrido`).

**Every invariant the owner named, confirmed on the DATABASE document:**
population 60; active 28; former 32; instrument bases distinct and separately
reported (`cri` 28, `csat` 28, `nps_activos` 28, `nps_desertores` 11); NPS bases
correct (`combinado` 39, `activos` 28, `desertores` 11) and each respecting
valid ≤ responded; CSAT per touchpoint with its own base, 55 touchpoints in four
groups covering all 55; TDP over the valid base, maximum **133.3**, one
touchpoint above 100 and **not clamped**; the auxiliary unawareness share
carried separately under its own name; Esfera × CRI **executed and refused** —
`cross_not_permitted`, distribution withdrawn whole, base emptied; the populated
`Capitanes` touchpoint present exactly once (`csat_ax`, 28 responses, 27 valid)
and NOT excluded; the broken all-`#REF!` duplicate absent because the revised
CSV was never imported; **zero** small-sample suppression; the journey cloud
still declared editorial content; no open question in the document.

#### The backup and its restore rehearsal

Taken immediately before the import, into a NEW timestamped directory. No
previous backup was touched.

```
/home/patop/becommunity-backups/u5p2-pre-import-20260906T195207Z
  database.dump  660 331 bytes  sha256=52f788838bbc7d95f62de77f20780bc6f7ae35a9fd93d5e82eaee7eae933b6f3
  schema.sql     351 569 bytes  sha256=bfd5557c19b8c92cbdae7bd5919e0cb06dddb15b6cbb11337f846ee3fbb9a502
```

`pg_dump` custom format, compress 9, `--no-owner` (GRANTs and POLICYs kept
deliberately), schemas `public` and `supabase_migrations`, over the **session
pooler on port 5432** — the direct host did not resolve, and the transaction
pooler on 6543 was not used. Directory `0700`, files `0600`, outside every Git
repository. TOC: 773 entries, 120 TABLE definitions, 60 TABLE DATA blocks, 59
FUNCTIONs, 54 POLICYs, 80 INDEXes, 306 CONSTRAINTs.

Restored into a throwaway PostgreSQL 17 database on a unix socket and compared
against the hosted project: **60 tables compared, 0 mismatches**; the migration
ledger identical (29 rows, 0000-0028); `policies=54`, `functions=28`,
`rls_forced=59`, `tables=59` all equal; all 36 canonical tables present. The
throwaway database was dropped; the backup was not.

ⓘ **One statement of the restore did not replay, and it is not data.**
`pg_restore` exited 1 with exactly one error: `GRANT USAGE ON SCHEMA public TO
postgres, anon, …` failed because the role `postgres` does not exist in the
throwaway cluster. Every table, row count, policy, function and ledger entry
restored and matched. A restore into a real Supabase project, where that role
exists, does not hit it — but that has not been executed, and must not be
described as if it had.

#### Legacy, before and after — identical

| | before | after |
|---|---|---|
| Cuicuilco respondents / quant / qual | 60 / 3 282 / 31 | 60 / 3 282 / 31 |
| Cuicuilco qualitative review | 23 confirmed, 8 pending, 0 rejected, 0 quote-approved | identical |
| Cuicuilco study status | `draft`, period «Abril a Julio 2026» | identical |
| project `tenant` / `study` | 7 / 5 | 7 / 5 |
| project `respondent` / `quant_response` / `qual_observation` | 82 / 3 364 / 33 | 82 / 3 364 / 33 |
| `segment_dimension` / `import_batch` / `profiles` | 1 / 6 / 4 | 1 / 6 / 4 |
| `study_experience_event` / `_draft` / `_publication` | 86 / 2 / 0 | 86 / 2 / 0 |
| `study_period_snapshot` | 6 | 6 |
| migration ledger | 29 rows, 0000-0028 | 29 rows, 0000-0028 |
| RLS / FORCE RLS on the 36 canonical tables | 36 / 36 | 36 / 36 |

**No study was published, no qualitative approval changed, no draft was
touched, no migration was applied, no authentication was altered and no
Cloudflare Worker was built or deployed.**

#### What the hosted run proved that no local run could

The hosted API gateway accepted the 2 704 594-byte RPC body; the hosted
`statement_timeout` was not reached by a real commit (6 232 ms end to end);
`limit=0` with `count=exact` is answered correctly by the hosted PostgREST, so
the operator can measure a table without transferring a row of it. **Still
unproved, and not to be described otherwise:** recovery from a timeout killed
mid-commit, and catalogue parity with Supabase's own extensions and default
privileges.

#### Skipped, and residual risk

- **The restore rehearsal's one un-replayed GRANT**, above. Named, not resolved.
- **`npm run test:secrets` was not executed** in this phase: it plants the
  service key as a canary and scans the build output, and it is a
  credential-bearing gate outside `gates:offline`. The diff was scanned instead,
  with the same `secret-patterns.mjs` the evidence writer uses, plus explicit
  e-mail / JWT / connection-string / secret-key patterns: **20 changed files, 0
  findings**, and no staged file carries a control byte.
- **`npm run gates:live` (suites A/B/C) was not executed**: it drives a real
  browser against a running application and nothing in this phase changed a
  route, a component or a policy.
- ⓘ **A credential briefly reached a file on disk and was destroyed.** While
  writing a read-only SQL runner, an unquoted heredoc expanded the connection
  string into `~/u5p2/run-sql.sh`. The file was removed immediately and the
  runner rewritten so the value is only ever an environment variable inside the
  process. Nothing was committed, logged or transmitted; the file never left
  the machine. The owner has authorized the configured credentials and did not
  make rotation a precondition, so none was performed.

#### Evidence, all outside every Git repository

```
/home/patop/u5p2/evidence/import-<job>-<timestamp>.json   the operator's own artifact, secret-scanned before writing
/home/patop/u5p2/evidence/logs/                           preflight, import, replay, parity, post-check,
                                                          backup, restore rehearsal and local rehearsal logs
/home/patop/becommunity-backups/u5p2-pre-import-20260906T195207Z
```

ⓘ The artifact retained for the import job describes the REPLAY, because both
runs shared the job id and the first was overwritten. The first commit's own
numbers are in `logs/hosted-import.log`. The operator now stamps the filename
with the finish time so a replay can no longer overwrite the run it repeats.

#### The application still reads the legacy path

No file under `src/app` or `src/components` names `canonical-source` or
`canonical-commit/server`, and a gate in `npm test` fails if one ever does. The
canonical tables were populated and completely unread at the end of Phase 2;
Phase 3, below, opened ONE server-only door to them and proved it is the only
one. **The client still receives only the legacy payload, and the read-path
switch is separate, later, separately authorized work.**

### Unit 5 Phase 3 — the server-side shadow boundary (source only, 2026-09-06)

**The canonical reader is now wired to the application's server-side loading
boundary, in a shadow mode that is OFF and that no environment turns on.** The
legacy result is still the only thing the client receives; the canonical
document is read beside it, compared semantically, and the comparison stays on
the server. **No hosted data was mutated by this phase and no environment
variable was set anywhere.**

#### The one door, and the gate that keeps it the only one

```
app/insights/e/[studyId]/page.tsx        binds `legacy` and nothing else
  └─ lib/studies/study-dashboard.ts      server-only. Legacy payload, then the shadow
       └─ lib/shadow/server.ts           server-only. The ONLY module naming the canonical read
            └─ lib/canonical-source/server.ts → adapter.ts → results/build.ts
```

`buildStudyDashboard` is called with the same five arguments the page used to
pass it, and its result is returned by reference. The page destructures
`{ legacy: dashboard }`; the diagnostics have no second binding.

`npm run test:shadow-boundary` (**54 checks, in `npm test`**) walks the
transitive import graph and fails if: any `"use client"` file reaches the
canonical layer by any chain; any route does; more than one page does; the one
page's chain skips the approved loader or the orchestrator; any page, component
or route so much as names the diagnostics; or any module reachable from the
shadow entry point can call a mutation.

⚠️ **The existing blanket prohibition was NOT weakened.** The Phase 2 rule —
"no file under `src/app` or `src/components` contains the string
`canonical-source`" — is still in `npm run test:canonical-database-source` and
still passes literally, because the approved page reaches the canonical layer
through two server-only modules and names neither. The graph walk is an
ADDITION that proves the stronger property the textual rule only approximates.

#### Disabled by default, twice over

| gate | rule |
|---|---|
| `BECOMMUNITY_SHADOW_MODE` | must equal the literal `enabled`. `"true"`, `"1"`, `"yes"`, `"ENABLED"`, `"enabled "` and a typo all mean OFF, and the gate executes each one. |
| `BECOMMUNITY_SHADOW_SCOPES` | must contain the exact `tenantUuid:studyUuid` pair. A prefix is refused; a malformed entry is dropped, never repaired. |

With either missing the canonical adapter is **never constructed and never
called** — proved by counting invocations of a fake reader, not by reading the
source. Neither variable is set in any environment, `.env`, `wrangler.toml` or
deployment.

#### Failure isolation, each path executed

| path | status returned | legacy payload |
|---|---|---|
| flag off | `disabled_by_flag` | untouched |
| outside the allowlist | `scope_not_allowlisted` | untouched |
| canonical read exceeds the budget | `canonical_timeout` | untouched |
| canonical read rejects | `canonical_transport_error` | untouched |
| canonical document is malformed / null / missing a section | `canonical_malformed` | untouched |
| the document THROWS when read (a hostile getter) | `canonical_malformed` | untouched |
| the comparator throws | `comparator_error` | untouched |
| the comparison disagrees | `compared`, with the disagreement named | untouched |

The budget is a wall-clock race — 1500 ms default, 5000 ms ceiling — and a hung
read returns in well under a second for a 60 ms budget. A PostgreSQL message
never reaches a diagnostic: the gate feeds the transport an error containing a
person's name and asserts the serialized diagnostic does not contain it.

#### Compatibility, measured against the hosted study (read-only)

`npm run canonical-shadow-report`, 2026-09-06, unfiltered, against the imported
package `sha256:099863e8…`:

**6 comparable fields, 6 agree, 0 disagree, 18 classified.**

| key | legacy | canonical | rule |
|---|---|---|---|
| `recommendation.nps.combinado.value` | 30.8 | 30.8 | `decimals:1` |
| `recommendation.nps.combinado.base` | 39 | 39 | exact |
| `renewal.cri.value` | 33.04 | 33 | `decimals:1` |
| `renewal.cri.base` | 28 | 28 | exact |
| `population.measured` | 54 | 54 | exact |
| `population.selected` (unfiltered) | 54 | 54 | exact |

Classified and deliberately not compared: `canonical_only` 9, `legacy_only` 4,
`presentation_configuration_required` 3, `canonical_replacement` 1,
`editorial_configuration_required` 1. `not_comparable` 0.

**Three totals, and they are never added together**: golden parity **531/531**
against the approved dashboard; **6 of 6** legacy↔canonical comparable fields;
**18** classified. The 531 are not runtime agreement with the legacy UI, which
exposes a fraction of that surface.

#### What the comparison found

- ⚠️ **The legacy dashboard cannot see six of the sixty people.** It has no
  roster and counts whoever answered: 60 respondent rows, 54 with a quantitative
  answer, 23 with a confirmed qualitative observation, **6 with neither**. The
  canonical contract reports `total 60` beside `measured 54`. `population.total`
  is a canonical-only capability, not a mismatch.
- ⚠️ **Three legacy defects, recorded and NOT fixed** — this phase may not change
  a calculation. (1) `computeStudyMetrics` detects CSAT with `startsWith("sat")`,
  so all 55 `csat_*` Cuicuilco columns are published as plain averages and the
  dashboard shows **no CSAT tile at all**. (2) `computeStageMetric` applies
  `csatMin = 9` — the 0–10 threshold — to 1–5 answers, so every `csat_*` journey
  stage tells a client "Satisfechos 0/n" today. (3) The legacy `tdp_` columns
  average to the canonical `unawareShareOfResponses`, **not** to `tdp`; a future
  mapping that pointed them at `tdp` would compare two different quantities.
- **The 4-source-group / 5-visible-route distinction is presentation.** The
  workbook carries 55 touchpoints in 4 source groups and the canonical document
  reports exactly that; the approved dashboard's five routes sit on top. The
  comparator does not treat it as a group count mismatch.

`docs/LEGACY_CANONICAL_COMPATIBILITY.md` holds the full matrix, the
canonical-only and legacy-only capabilities, and the blockers a read-path switch
would have to clear — chiefly a human-approved
`legacyMetricKey ↔ canonicalItemKey` map, which would unlock 120 further
comparisons and which this phase deliberately did not invent.

#### Unchanged, and verified so

Hosted golden parity re-run read-only after every change: **534 offered, 531
executed, 531 passed, 0 failed, 0 skipped, 0 unresolved, 2 not-applicable, 1
configuration-required** — identical to Phase 2. No migration, policy, route
response, calculation, expected value, dashboard component, deployment,
credential or publication state changed. The import job
`1886a359-f2c9-483a-8b5e-979931841a71` is untouched and every backup is retained.

**Still not done, and not to be described otherwise:** shadow mode has never
been enabled anywhere, no preview surface exists, no read path was switched, no
dashboard UI was built, and the comparison has never run inside a request on a
hosted deployment — only through the internal operator.


---

### Unit 5 Phase 3.1 — the post-completion corrections (source only, 2026-09-06)

**Phase 3 was committed and then audited, and the audit found four defects. All
four are corrected. Shadow preview is still NOT authorized and shadow mode is
still off everywhere; nothing was deployed, no hosted row was written, no
environment variable was set, and neither the legacy response nor any dashboard
surface changed.**

#### A. Filtered comparisons were invalid, and now refuse

`shadow/server.ts` reads the canonical document by tenant and study and does not
apply the request's legacy filter — it cannot, because no authority maps a
legacy segment key onto a canonical attribute key. Phase 3 guarded
`population.selected` for exactly that reason and then compared the FILTERED
legacy NPS and CRI against that UNFILTERED document anyway.

That produced errors in both directions, and the new offline fixture produces
both from one run: filtering it leaves the NPS at 40 and the CRI at 37.5 — a
false AGREEMENT with the canonical values — while dropping both bases from 20 to
10, a false DISAGREEMENT. Under an active filter, every quantity the filter
touches is now `presentation_configuration_required`, mismatch `filter_scope`,
`agrees` null, and carries **no numbers**.

**One comparison survives a filter and only because it is provably unfiltered.**
`population.measured` reads `view.sourceUnits`, which `dashboard/view.ts:186`
computes from `rows` and `qualitative` rather than their filtered forms.
`legacy.pivot.allowlist` and `legacy.filterOptions` keep their counts for the
same reason (`view.ts:182-183`). All three are pinned by a gate that asserts
they are identical between a filtered and an unfiltered build.

Hosted, one dimension applied: **1 comparable, 1 agree, 0 disagree, 23
classified, 12 refused by scope.** Unfiltered is unchanged at **6 comparable, 6
agree, 0 disagree, 18 classified.**

#### B. The runtime path had never been executed, and now has been

The Phase 3 evidence came from `canonical-shadow-report`, which preloads the
canonical document and hands the orchestrator `loadCanonical: async () =>
canonical`. That measured the comparator. It never exercised the policy, the
admin client, the server-only adapter, the paged reads or the results builder —
that is, not one step of what a request does inside its budget.

`npm run canonical-shadow-runtime-rehearsal` calls `runStudyShadowComparison`,
the same function `studies/study-dashboard.ts` calls, and lets it do all of it.
It runs under `node --conditions=react-server`, which resolves the `server-only`
marker to its own empty module — the same condition the RSC runtime supplies —
so the real modules run without the marker being patched, stubbed or copied.

Three runs of twenty samples each, hosted, read-only, **nothing preloaded**,
after the abort-reason fix. Three, not one, because the tail moves:

| | run A | run B | run C |
|---|---|---|---|
| cold (first) | 1 233 | 1 452 | 1 902 |
| minimum | 976 | 1 058 | 1 021 |
| median | **1 047** | **1 105** | **1 093** |
| p95 (rank 19 of 20) | 1 129 | 1 177 | 1 288 |
| maximum | 1 233 | 1 452 | **1 902** |

Every sample returned `compared` with 6/6/0/18 and the legacy payload was
asserted byte-identical after each one. ⚠️ **Run C's maximum of 1 902 ms is past
the 1 500 ms default budget**: that cold request would have returned
`canonical_timeout` instead of a comparison.

The rehearsal also COUNTS this process's outbound requests across the
budget-expiry probe: 1 at return, **1 after two further seconds**, 0 orphaned
rejections. That count is what caught defect 8 above.

⚠️ **These are workstation-to-Supabase times, not Worker-to-Supabase times**, and
must never be quoted as if they were.

#### C. The timeout did not cancel, and now does

`Promise.race` bounded the caller and nothing else: the losing Supabase read
stayed in flight — socket open, next page still to be asked for — after the
request had answered. The budget now owns an `AbortController` whose signal is
threaded through the reader contract, `shadow/server.ts`,
`canonical-source/adapter.ts`, `loadCanonicalRowSet`, `readCanonicalTable`, the
transport and every paginated query's `PostgrestTransformBuilder.abortSignal`
— the
supported PostgREST cancellation API, which puts the signal on the underlying
`fetch`. The paging loop also checks the signal BEFORE asking for the next page:
the query-level signal stops the request in flight, the loop-level check stops
the next one from starting, and neither alone is enough.

⚠️ **The verdict is decided by the clock, not by the race.** `abort()` dispatches
its listeners synchronously, so a reader that rejects from inside its own abort
listener settles the work promise first and `Promise.race` would hand back its
rejection — turning a budget expiry into `canonical_transport_error`. The timer
sets `expired` before it aborts and rejects, and the classification reads that
flag. A real `fetch` rejects asynchronously, which is exactly why this would
have hidden until somebody needed the number. The offline gate carries a reader
that rejects synchronously from its abort listener.

Proved offline: the reader observes the abort; no page begins after it; an
in-flight page's abort is reported as `READ_ABORTED` and never as a database
message; a late rejection does not escape as an unhandled rejection; a late
resolution is discarded; and a reader that throws while STARTING does not leave
the timer armed. Proved on the hosted path: a 1 ms budget returns
`canonical_timeout` in 10 ms and two seconds of waiting afterwards produces no
late resolution and no further read.

#### D. Runtime evidence was unsafe or unavailable, and is now inert by default

`src/lib/shadow/sink.ts` is server-only and records nothing unless code running
in the same process installs a sink. **There is no environment variable**, so no
deployment can turn it on; the only caller is the rehearsal operator. It returns
`void` and swallows its own failures, so it cannot alter, delay or fail a
response, and it adds no route — the way in is a function call and an internal
bounded ring buffer.

`src/lib/shadow/diagnostics.ts` is the pure whitelist that turns local operator
evidence into a record. It reads each field by name, checks it against the
closed list it must belong to, and drops what is not there — a finding whose
key, section, classification or rule is unknown is dropped WHOLE. It carries
**no numbers at all**: `legacyValue`, `canonicalValue`, `legacyBase` and
`canonicalBase` have no field to arrive in, filtered or not. Every string that
survives is a member of a closed list, a uuid, a `sha256:` digest or a dotted
version.

#### The diagnostic contract was hardened

- ⚠️ **The filter fingerprint is GONE, not improved.** It was an unsalted
  SHA-256 of the applied `[key, value]` pairs. The values come from a catalogue
  the same legacy payload publishes to the browser — thirteen dimensions with
  single-digit-to-low-tens value spaces — so the whole space of realistic
  selections is a few thousand strings and a dictionary reverses the digest in
  milliseconds. `ShadowFilterScope` records `filtered`, a dimension COUNT and
  those dimension KEYS whose shape is conservative enough to publish; the
  runtime record drops the keys and keeps the count. **No new operational secret
  was introduced, and no keyed HMAC was added**: the brief permits one only if a
  suitable existing server-only secret with clear rotation behaviour already
  exists, and the only such secret is `SUPABASE_SERVICE_ROLE_KEY`, whose
  rotation runbook exists precisely so it can be replaced without warning.
- `note: string | null` became `noteCode: NoteCode | null` over a closed union;
  `rule` became a closed union; and a finding's `key` and `section` are members
  of closed lists, so a study's own metric key cannot become a finding key. The
  prose those notes carried is in `docs/LEGACY_CANONICAL_COMPATIBILITY.md`.

#### The canonical read is concurrent, and nothing was traded for it

`loadCanonicalRowSet` read twenty-six independent families one after another.
The Cuicuilco package is 3 244 rows in 28 round trips, so the 4 858 ms on record
was LATENCY, not volume. The families now go through a bounded pool.

Measured in one session, same transport, same machine, four runs each:
sequential **min 4 177 / median 4 774 / max 5 128 ms**; bounded concurrency 6
**min 1 181 / median 1 263 / max 1 384 ms** — **3.78× on the median**, and the
4 774 ms reproduces the 4 858 ms on record.

**Six, because Cloudflare Workers allow six simultaneous open outbound
connections per invocation.** A seventh queues rather than fails.

Preserved and proved: tenant AND study on every request; every family's own
ceiling; strictly sequential paging *within* a family, because the keyset cursor
is the previous page's last row; results placed by index, so the row set is
identical to the sequential one; complete-or-refuse, with no new work after the
first failure and the LOWEST-INDEXED refusal reported so it does not depend on
who lost a race; cancellation; and a refusal — `READ_CONCURRENCY_INVALID` —
rather than zero workers and an array of holes if the limit is ever not a
positive integer.

**Single-flight de-duplication was considered and NOT implemented.** It is
optional in the brief, and a module-level cache keyed by tenant and study on a
service-role read path is a tenant-isolation hazard for a saving the pool
already delivers.

#### The gates

| gate | before | after |
|---|---|---|
| `npm run test:shadow-boundary` | 54 | **96** |
| `npm run test:canonical-database-source` | 60 | **74** |
| `npm run test:shadow-sink` | — | **17** (new, in `npm test`) |

The boundary gate also closed four holes the audit found in itself: it now walks
SERVER ACTIONS and `src/middleware.ts` — which is outside `src/app` and no walk
rooted there could ever have seen; it checks bracket notation
(`payload["shadow"]`), which both diagnostics checks used to miss; it asserts no
client, route or action reaches `src/lib/shadow/` at all, replacing an edge that
was accidental; it asserts no `.env*`, `wrangler.toml`, `next.config.ts`,
`open-next.config.ts` or `package.json` in this repository sets
`BECOMMUNITY_SHADOW_MODE`; and it removed a dead allowlist conjunct in the
mutation scan, replacing the claim with an enforceable one over the structural
builder type in `canonical-source/postgrest.ts`.

**Discrimination was proved, not assumed.** EIGHT defects were reintroduced one
at a time and each gate caught its own — the three the brief named, plus the
five an adversarial review of this diff found:

| # | defect reintroduced | gate | checks failed |
|---|---|---|---|
| 1 | the filtered NPS comparison | shadow-boundary | 7 |
| 2 | a non-cancelling timeout (Phase 3's race, nothing aborts) | shadow-boundary | 3 |
| 3 | an unrestricted note string | shadow-sink | 2 |
| 4 | the verdict read off the race instead of the clock | shadow-boundary | 1 |
| 5 | the signal never reaching `abortSignal` on the query | canonical-database-source | 1 |
| 6 | an `async` sink's rejection escaping | shadow-sink | 1 |
| 7 | the operator buffer sharing its `counts` object | shadow-sink | 1 |
| 8 | a CUSTOM abort reason (PostgREST retries the cancelled GET) | shadow-boundary | 1 |

Every file was restored byte-identically, verified by SHA-256 before and after.

#### What the review and the new assertions found, and what it cost

The audit's own corrections were themselves audited, and five defects in them
were caught before anything was committed. Two are worth stating in full.

⚠️ **THE VERDICT WAS READ OFF THE RACE ON THE SUCCESS PATH.** `expired` was
consulted only in the `catch`. `abort()` dispatches its listeners synchronously,
so a reader that RESOLVES from inside its own abort listener settles the work
promise before the timer's `reject` settles the timeout — and `Promise.race`
hands back a canonical document that arrived after the budget, which is then
compared as though it had arrived in time. A wrong number, not a wrong status.
Production was immune only because `shadow/server.ts` supplies an `async`
arrow whose promise cannot settle inside the abort dispatch, which is luck
rather than a guarantee. `expired` is now checked on both paths.

⚠️ **AND `controller.abort()` MUST TAKE NO ARGUMENT.** This one was found by the
hosted rehearsal, and only because the rehearsal stopped printing prose and
started counting. `@supabase/postgrest-js` decides whether a rejected `fetch`
was cancelled by reading the rejection's identity — `name === "AbortError"` or
`code === "ABORT_ERR"`. Passing `abort(new TimeoutSignal(...))` replaces the
platform's own `AbortError` with a reason PostgREST does not recognise, so the
aborted GET was classified as a network failure and **retried three times with
backoff**. Measured against the hosted project: **three further requests after
the budget expired**. Cancellation was producing MORE load than the race it
replaced. Nothing in this codebase reads `signal.reason`, so every `abort()`
call is now argument-free and the boundary gate asserts
`signal.reason.name === "AbortError"`.

The other three: an `async` sink's rejection escaped `recordShadowRun`'s
`try/catch` (TypeScript's void-return assignability lets one be installed); the
operator buffer's `records()` shallow-copied and handed out its own `counts`
object; and three top-level reads in the rehearsal were unguarded, so a
PostgREST error would have printed a database message the file's own header
forbids. All four gates were extended to pin each one.

#### Golden parity, unchanged

`npm run canonical-database-parity`, read-only against the hosted import:
**534 offered, 531 executed, 531 passed, 0 failed, 0 skipped, 0 unresolved,
2 not-applicable, 1 configuration-required.**

#### Preview activation: STILL BLOCKED

| reason | detail |
|---|---|
| The default budget does not fit — it is SMALLER than the observed maximum | 1 500 ms against an observed maximum of 1 902 ms is a margin of 0.79×, i.e. none. Only the 5 000 ms ceiling has room, at 2.63×, and only from this vantage point. |
| No Worker measurement exists | every number above was taken from the development workstation. The margin that decides this is the Worker's, and nothing has measured it. |
| §9's blockers are untouched | chiefly the human-approved `legacyMetricKey ↔ canonicalItemKey` map and the filter-dimension map. Phase 3.1 corrected how the shadow behaves without one; it did not supply one. |

**Still not done, and not to be described otherwise:** shadow mode has never been
enabled anywhere, no preview surface exists, no read path was switched, no
dashboard UI was built, and the comparison has never run inside a request on a
hosted deployment — only through the two internal operators.

---

### Unit 6A — the canonical presentation registry and the approved blueprint (source only, 2026-09-06)

**Branch `codex/canonical-experience-integration`, worktree
`C:\dev\becommunity-software\becommunity-software-canonical-experience`, branched
from the canonical tip `ad51496`.** The canonical worktree and
`codex/canonical-study-model` were not touched. `main` is unchanged.

#### What it is

The stable bridge between the canonical results engine and the future
customizable dashboard/editor. Three pieces, all pure and offline:

1. **`CanonicalPresentationRegistry`** — derived deterministically from a
   `CanonicalStudyResults`. It publishes **246 entries** for the synthetic
   study-shaped fixture and **279** for the real Cuicuilco document: opaque
   handles for final values, distributions, series, population and base
   information, filter dimensions, journey groups and touchpoints, qualitative
   aggregates and editorial slots, each with its semantic, display formats,
   compatible chart variants, availability, response context, provenance category
   and the filters it supports or refuses.
2. **A versioned presentation document** — pages, blocks, order, per-breakpoint
   grid placement, responsive behaviour, authored copy, bindings, chart variants,
   filter panels, explicit connections, journey routes, editorial slots, sample
   policy, disclosure level, visibility, duplication and publication metadata.
   **That last item is SUPERSEDED and is left standing because Unit 6A really
   did ship it.** Unit 6A.1 moved every publication and lifecycle field out of
   the authorable document and into the server-only persistence envelope
   (`src/lib/presentation/persistence.ts`); a presentation document has carried
   no publication metadata since. Read the inventory above as what Unit 6A
   built, not as what the layer holds today.
3. **A pure resolver** — *(document + registry + results) → render model*, which
   reads and never computes.

Full contract: **`docs/CANONICAL_PRESENTATION_MODEL.md`**. The selective manifest
for the old experience branch: **`docs/CANONICAL_EXPERIENCE_INTEGRATION_PLAN.md`**.

#### The decisions worth carrying forward

- **`StudyResultsDocument` does not exist.** The brief's name has zero
  occurrences in the repository; the canonical type is `CanonicalStudyResults`.
- **`schemaVersion` is the integer 4**, because the database column is
  `integer` bounded `1..1000` and the write functions require the document's own
  field to match. **1-3 belong to the legacy experience definition**, and the two
  hosted draft rows are legacy-family documents. Unit 6A refuses 1-3 by name and
  migrates nothing. **Unit 6A also claimed the database could not reveal those
  rows' versions; that was wrong, and Unit 6A.1 read them — v3 and v2. See the
  6A.1 section below.**
- **A handle carries no address.** The grammar forbids the underscore, which is
  the shape of every canonical key. The registry's address map is server-only.
- **`show_all` is the system default**, and the suppressing modes require a named
  author and a stated reason.
- **Esfera × CRI**: the approved dashboard offers the cross, the contract forbids
  it, and the blueprint corrects the deviation by construction.
- **Four source groups, five visible routes** — evidence and decision, in
  different layers.
- **The curated journey pain cloud stays `configuration_required`.** The approved
  dashboard publishes 79 phrases; none is copied.

#### The gates

| gate | assertions | in `npm test`? |
|---|---:|---|
| `npm run test:canonical-presentation` | **155** (Unit 6A; **255** after 6A.1) | yes |
| `npm run test:canonical-presentation-parity` | **43** | no — machine-specific workbooks, reports SKIPPED without them |

The parity gate reproduces the approved figures through the blueprint without
recalculating one: `Capitanes de Esfera` (position 24 of the first category) once
and only once at **CSAT 74.1 / TDP 3.7 / n = 27**; `Salida` at **TDP 133.3**,
over 100 and unclamped, the only such touchpoint; recommendation **30.8 / 46.4 /
−9.1**; renewal index **33** (Unit 6A rendered it `"33"`; the approved oracle
shows `"33.0"`, corrected in 6A.1); population **60**; 55 touchpoints repartitioned
19 + 10 + 6 + 10 + 10 across the five approved routes with no repeat.

#### Discrimination — fourteen defects, proved not asserted

Each invariant was broken on purpose, the gate had to fail **on its own
assertion**, every file was restored and verified byte-identical by SHA-256, and
the gate had to come back green. All fourteen discriminated; a 13-file SHA-256
census before and after the suite reported every file byte-identical.

The fourteen: TDP clamped to 100 · TDP clamped by a TERNARY carrying no `Math`
call for any scan to find · the registry no longer pruning a forbidden
dimension · the resolver no longer refusing a forbidden cross · filters
propagating implicitly · the default policy suppressing small samples · a legacy
blob stamped with version 4 being accepted · a legacy v1-v3 document silently
reinterpreted · a canonical table name leaking into a client-facing label · a
route claiming a touchpoint outside its source group · the render model
re-formatting a value instead of copying it · the catalogue carrying the
server-only address map · methodology prose reverting to satisfaction for every
touchpoint measure · a withheld headline still publishing the composition that
reconstructs it.

#### What an adversarial review found, and what it cost

Six independent reviewers were pointed at this unit's own diff and asked to
REFUTE it, each verified finding then re-checked by a separate skeptic. Thirty-
five claims came back and sixteen were refuted on verification. Five were real,
and they were not stylistic:

1. **A suppressed value was recoverable by subtraction.** `applySamplePolicy`
   guarded the scalar branches only, so an authored `hide_below` withheld the
   recommendation score while the block beside it published promoters, pasivos
   and detractores with their shares — and an NPS is %promoters − %detractors.
   The parts now go with the whole, `performance.dimension` included; it is the
   line-for-line twin of `retention.series` and simply lacked the call.
2. **The same touchpoint was withheld or published depending on which handle the
   author bound.** The structural payload bypassed the policy that the
   per-measure payload applied.
3. **The methodology prose described the wrong number.** Every touchpoint
   measure received the SATISFACTION explanation — TDP included, the figure that
   reads 133.3% — and attrition received the RETENTION one.
4. **`annotate_below` was authored, validated, stored, shipped and ignored**,
   which left the threshold comparison to the browser.
5. **A canonical table name survived slugification.** The editorial handle came
   from `ConfigurationRequirement.key`, so `journey_stage_evidence` became
   `editorial:journey-stage-evidence` — still the table name `journey_stage`,
   and invisible to a scan written in snake_case.

A sixth was a forward-compatibility gap rather than a defect: the document had
no `metadata`, which `prepare_study_experience_revision` requires, so no
presentation document could ever have been stored. It is added and nullable.

The gate's own leak scan was wrong in BOTH directions and is now two needle
classes: snake_case for every canonical key — a slug can never contain an
underscore — and the kebab form for TABLE NAMES only, the one class that is
never display text. Converting everything to kebab had flagged `cultura-edl` and
`retencion`, which are a group's own label and an authored block id.

Three of those found real defects in this unit's own work rather than merely
confirming a guess. The label leak was genuine: the registry was using
`ConfigurationRequirement.key` as a client-facing label, and
`journey_stage_evidence` contains the canonical table name `journey_stage`. And
the default-policy defect exposed that the gate CRASHED on a null value instead
of reporting, so later sections never ran; the gate is now defensive throughout,
because a section that never ran cannot catch the regression it was written for.

#### What Unit 6A did NOT do

No route, no React, no editor, no Studio UI. No read path switched, no shadow
mode enabled, no migration added or edited, no dependency added, no lockfile
change. No Supabase or hosted operation of any kind; no credential read, rotated
or altered. The legacy dashboard is untouched and still broken in the three ways
`docs/LEGACY_CANONICAL_COMPATIBILITY.md` §7 records. No merge or cherry-pick from
`claude/experience-publication-versioning`.

#### Unit 6B

**Selective Studio composer integration against this binding layer — not a
wholesale merge of the old branch.** The editor state machine, block catalogue,
authoring panels, draft persistence, the immutable publication lifecycle against
the already-applied `0023`-`0025` tables, and the client renderer that RECEIVES a
render model. Its one blocking question: **the two hosted draft rows are at an
unrecorded `schema_version`** and 6B must read it back and decide with the owner
whether they are migrated, re-authored or abandoned. It must not guess.

**SUPERSEDED — the blocking question is answered, and it was never blocking.**
The paragraph above was written believing those versions could not be read. They
could: `schema_version` is `not null` on both tables and the save RPCs require it
to equal the document's own field, so the value was always legible. A read-only
inventory during **Unit 6A.1 OBSERVED them** — the synthetic P6E draft at column
version 3 / JSON version 3, and the Cuicuilco draft at column version 2 / JSON
version 2. Both are legacy experience documents; neither declares a
`documentKind`, so neither is a canonical presentation document. Nothing was
migrated then and nothing is migrated now: 1-3 are refused by name. **Unit 6B.1
does not read, migrate, reinterpret or overwrite either row** — it composes a
fresh v4 document in session memory only. Whether those two rows are re-authored
or abandoned is still the owner's decision, and it is a decision for a later unit
that touches storage, not a precondition for composing.

---

### Unit 6A.1 — the presentation/persistence boundary, exact binding, and the CRI oracle (source only, 2026-09-06)

**Branch `codex/canonical-experience-integration`, on top of Unit 6A.** A focused
correction. No formula, canonical value, workbook mapping or golden numerical
expectation changed, and **golden parity is still 531/531**.

#### Six corrections

1. **PRESENTATION SEPARATED FROM PERSISTENCE.** `PresentationDocument` carried
   `metadata.studyId`, `metadata.tenantId` and a publication block — status,
   source draft revision, a SHA-256 of itself, a study fingerprint, acknowledged
   warnings, a prepared note. A database identifier had become authorable,
   migration 0025's lifecycle had a second writable copy, and a hash sat inside
   the bytes it covers. All of it moved to `src/lib/presentation/persistence.ts`,
   which stamps the scope before a write, strips it after a read, and refuses a
   row belonging to another study. Nothing writes yet.
2. **THE PUBLIC RENDER MODEL IS SAFE.** It published the whole authored
   `SampleDisplayPolicy`, and a withheld result carried the threshold,
   `authoredBy` and the internal `rationale`. A block now carries a
   `RenderSampleDisplay` outcome — shown, shown with an approved note, or
   withheld — plus a separately authored `publicNote` when somebody wrote one for
   a reader. The audit fields stay on the server.
3. **THE REGISTRY IS BOUND TO ONE RESULTS DOCUMENT.** Comparing contract
   versions is a test two studies pass together, and every `CanonicalAddress` is
   an array position — so a registry from study A handed study B's results
   resolved cleanly and answered with the wrong numbers. Four new codes refuse
   it: `registry_study_mismatch`, `registry_plan_mismatch`,
   `registry_version_mismatch`, `binding_fingerprint_mismatch`. A document pins
   `registryVersion` and an opaque `binding` digest over the study scope, the
   plan and package identity, both versions and the whole handle-to-address map,
   so renaming a label, reordering a group or inserting a dimension or touchpoint
   earlier makes a saved binding REFUSE instead of retargeting.
4. **THE MODULE BOUNDARY IS ENFORCED.** `index.ts` is client-safe;
   `server.ts` carries `import "server-only"` and is the only route to the
   address map, the resolver, persistence and the blueprint. An import-graph walk
   from 82 application modules — 22 client components, 2 routes, 22 pages, the
   server actions and the middleware — proves none reaches the server half or
   `src/lib/results/`.
5. **THE APPROVED CRI PRESENTATION IS EXACT.** The approved dashboard renders
   `33.0` (`Risk.tsx` passes `decimals={1}`; its browser QA requires text
   containing `33.0` and its offline QA asserts `"33.0"`). Unit 6A's parity gate
   received `33`, and its fix compared the output with the CONTRACT's own text —
   proving self-consistency and nothing about parity. A block may now request
   `fixed_decimals`, honoured by PADDING ONLY: `"33"` becomes `"33.0"`, a request
   that would shorten or that exceeds the declared precision is refused, and the
   numeric value stays 33. The parity gate now expects the oracle's literal
   string.
6. **THE LINT REGRESSION IS GONE.** The one warning Unit 6A introduced — a
   ternary used as a statement — is an `if`. Lint is back to the **54-warning
   baseline** with zero warnings from any 6A/6A.1 file.

#### The two hosted drafts, inventoried read-only

Unit 6A claimed the database could not reveal their versions. **That was wrong.**
`schema_version` is `not null` and the save RPC requires it to equal
`definition.schemaVersion`, so the value was always readable. One narrowly scoped
read-only `GET` (service role, no mutation, `definition` never selected whole):

| study | `schema_version` | JSON `schemaVersion` | `documentKind` | revision | family |
|---|---:|---:|---|---:|---|
| ACEPTACIÓN P6E — DATOS SINTÉTICOS (TEST) | 3 | 3 | absent | 14 | legacy experience |
| La voz de las y los Nets de Cuicuilco | **2** | 2 | absent | 72 | legacy experience |

Column and JSON agree on both; neither is malformed; neither is a canonical
presentation document. **Nothing was mutated** — no draft migrated, overwritten,
deleted, published or re-authored. The owner's policy applies cleanly: retain
both as evidence, create a new v4 presentation from the approved blueprint, and
never automatically convert a legacy layout. The real study's draft is at
version **2**, so any conversion would need the legacy v2→v3 step first.

#### Gates

| gate | assertions | in `npm test`? |
|---|---:|---|
| `npm run test:canonical-presentation` | **269** | yes |
| `npm run test:canonical-presentation-parity` | **51** | no — machine-specific workbooks |

**Discrimination: 23/23.** Every defect caught by its own assertion, every file
restored byte-identically, SHA-256 census clean before and after. The seven new
cases: a study uuid smuggled through an authored field, persistence decoding
accepting another study's row, the render model republishing the authored policy,
the safe barrel re-exporting the resolver, the resolver dropping the study-scope
check, the resolver ignoring a saved binding, and the display format shortening
instead of refusing.

Two of the seven had to be sharpened before they proved anything: re-adding
`metadata` was caught by `strictObject` rather than by the uuid scan, so the
defect now smuggles the uuid through `title`; and disarming the shortening guard
made `"0".repeat(negative)` throw, blocking the gate by crashing it rather than
by asserting, so the defect now performs the truncation it is meant to model.

#### What a second adversarial review found

Five reviewers were pointed at the 6A.1 diff and asked to refute it. Eight claims
survived verification, and all eight were fixed:

- **the display format reached one payload shape out of eleven**, so the CRI was
  fixed and the same discrepancy left everywhere else — the approved dashboard
  pads a touchpoint TDP of zero to `"0.0"` and dozens of touchpoints have one.
  The format moved to the block, one speller applies it wherever that block
  produces a number, and the parity gate now asserts that none of the 110 journey
  figures is written without a decimal;
- **the parity gate still compared the five route ids against the blueprint's own
  constant** — the same circularity the CRI assertion had;
- `subtitle` had regressed from validated authored text to an unchecked string
  written straight into the stored definition;
- `decodePresentationFromStorage` never validated the scope the CALLER asserts,
  so `undefined !== undefined` would have waved a cross-study read through;
- the import-graph walk was blind to dynamic `import()` and bare side-effect
  imports — the two edges somebody would actually use to reach server code;
- `encodePresentationForStorage` never checked the 512 KiB ceiling the layer
  itself declares and `withinSizeLimit` was dead code;
- the definition hash was computed on write and never verified on read;
- `applyDisplayFormat` appended to whatever string it was given, including the
  em-dash the formatter returns for a null value.

A third pass over the corrected diff confirmed ten more, of which the worst was
structural: **section [30] — the entire module-boundary walk — ran AFTER the
gate's own `process.exit(1)`**, so its failures printed and were never counted. A
deliberately broken assertion in it exited 0. It now sits before the summary, and
a broken assertion exits 1. Also fixed in that pass: a stored document could
carry `binding: null` and switch the stale-binding refusal off permanently, so
the store now refuses an unbound document; a touchpoint's TDP could be withheld
while its auxiliary share — resting on a different base — was published, from
which the withheld ratio is recoverable, so the three numbers now stand or fall
together; the public render model carried the contract's internal `detail` and
`suppliedBy` prose, which is written for a reviewer auditing a document, so
absences now cross as closed codes only; a block header could say "shown" over a
payload containing withheld figures; `[26]` could be evaded by `export *`; `[29]`
hid its padding proof behind unasserted guards; and `[24]` never exercised a
TENANT mismatch, only a study one.

---

### Unit 6A.2 — three residual gaps closed (source only, 2026-09-07)

**Branch `codex/canonical-experience-integration`, on top of Unit 6A.1.** No
formula, canonical result, approved dashboard number, blueprint content, visual
design, route, component, migration, dependency or lockfile changed. **Golden
parity is still 531/531** (534 offered, 2 not applicable, 1 editorial), and the
approved CRI still reads `33` in the contract and `33.0` on the page.

#### A. The documentation was describing a layer that no longer existed

Three passages survived the 6A.1 move and had stopped being true:

- `document.ts` said a presentation document carries "the publication metadata
  the existing draft/revision model already requires". 6A.1 had moved every one
  of those fields into `persistence.ts`. The header now says where they live and
  says outright that the old sentence stopped being true the moment they moved.
- The same header's versioning note still framed the two hosted drafts as
  unknowable. They were inventoried read-only on 2026-09-06; the note now records
  what was found — P6E at column 3 / JSON 3, Cuicuilco at column 2 / JSON 2, both
  legacy — and labels it an OBSERVATION at a moment in time, not a promise.
- `docs/CANONICAL_PRESENTATION_MODEL.md` §5 opened by describing the document as
  carrying database scope and lifecycle. It opens with "Layout and authoring
  concerns only."

§9c also said the resolver "refuses on four separate codes" above a table of
five. It is now six, and the count matches the table.

#### B. `calculationVersion` was recorded, hashed, and never compared

`RegistrySource` carried it and the binding fingerprint covered it — and no
comparison read it. So a registry built under one calculation version resolved
against results computed under another, every address dereferenced cleanly, and
the answer was the OTHER version's numbers. Same study, same plan, different
projection: the exact class of silent wrong answer the study and plan checks
exist to prevent.

It joins the existing `registry_plan_mismatch` condition, because it is the same
failure — the same study projected under a different plan — and the refusal text
now names calculation-version drift instead of listing four causes for a fifth.

The adversarial fixture holds contract, tenant, study, spec, mapping version,
package key and plan fingerprint identical and changes only the calculation
version; the gate asserts each of those seven is unchanged before asserting the
typed code, so the test cannot pass by accident.

#### C. An unbound document was EXEMPT from the stale-binding refusal, not merely unchecked

`binding_fingerprint_mismatch` compares a binding that exists, and Unit 6A
guarded it with `document.binding !== null`. A document carrying no binding
therefore walked past it permanently, and invisibly: it resolved, every address
dereferenced, and the render model looked exactly like a bound one. 6A.1 had
closed the write side (`persistence_unbound_document`) and left the read side
open.

`resolvePresentation` now refuses `binding: null` as
**`unbound_presentation_document`** at `$.binding`. It does not bind it on the
way past — `bindPresentationDocument` is a deliberate act by a caller who has
decided this layout describes this registry, and a binding made on the read path
would agree by construction and prove nothing. The blueprint is still emitted
unbound, because a blueprint is a LAYOUT and which registry it answers for is the
publisher's decision; both gates now bind it explicitly, which is what a real
caller does.

#### Gates

| gate | assertions | in `npm test`? |
|---|---:|---|
| `npm run test:canonical-presentation` | **286** (was 269) | yes |
| `npm run test:canonical-presentation-parity` | **51** | no — machine-specific workbooks |
| `npm run test:canonical-results-parity` | **531/531** | no — machine-specific workbooks |

**Discrimination: 2/2 new.** Removing only the `calculationVersion` comparison
turns 2 assertions red and the gate exits 1; restoring Unit 6A's null-tolerant
`binding` guard turns 3 red and the gate exits 1. `resolve.ts` was restored
byte-identically both times, verified by SHA-256 before and after, and the gate
returns to exit 0.

`tsc --noEmit` is clean and lint is at the **54-warning baseline** with zero
warnings from any presentation file. `npm test` reports the same single failure
at this commit and at its base — `hosted-target-guard`'s worktree-versus-main
rule, which is about the checkout's shape and not about this change; the two runs
were executed back to back on the same machine to establish it.

All verification ran in WSL as `patop` on Node 24.11.1 / npm 10.9.2. No hosted
service was contacted, no credential read, no Supabase row read or written, no
migration run, no deploy, no shadow mode, and no other worktree touched.

---

### Unit 6B.1 — the session-only canonical composer and the render-only library (source only, 2026-09-07)

**Branch `codex/canonical-experience-integration`, on top of Unit 6A.2.** The
first real vertical slice of the canonical dashboard composer: a pure editor
over `PresentationDocument`, a render-only component library over
`PresentationRenderModel`, an authenticated Studio route that composes one
against the other, and the deliberate registration of the SECOND and last door
from the application to the canonical layer.

**Nothing is stored.** There is no draft, no revision, no publication, no
autosave, no `revalidatePath` and no database write anywhere in the unit. The
Cuicuilco legacy v2 draft is not read, migrated, reinterpreted or overwritten —
no module in the unit names the table it lives in. No formula, canonical result,
approved dashboard figure, migration, dependency or lockfile changed.

#### The four pieces

1. **`src/lib/composer/`** — the editor engine. Thirty-two pure operations
   `(state, …args) => ComposerState` over a document and a catalogue: pages
   (add, open, rename, reorder, duplicate, remove), blocks (add from the
   catalogue, select, reorder, duplicate, hide, remove, copy, binding, variant,
   spans, responsive behaviour, display format, sample policy, disclosure) and
   filter panels (dimensions, explicit connections). Whole-document undo and
   redo, sixty deep, session-only. Deterministic ids: FNV-1a at three offset
   bases behind a two-letter kind code, no clock, no entropy, no slug, re-salted
   against the document when taken.

   It lives OUTSIDE `src/lib/presentation/` because the presentation gate proves
   that directory contains no `Math.`, no division and no multiplication, and
   32-bit hashing is nothing but multiplication.

2. **`src/components/presentation/`** — the render-only library. Thirteen leaf
   renderers plus the shell: `narrative`, `callout`, `kpi_value`,
   `kpi_with_base`, `table`, `bar_vertical`, `stacked_bar`, `journey_route_map`,
   `gauge`, `bar_horizontal`, `term_ranking`, `word_cloud`, `filter_control`. It
   receives a render model and an audience and nothing else.
   `RenderValue.formatted` is the only thing printed; `value`, `unit` and
   `decimals` choose a geometry. `donut`, `pie`, `line`, `area` and
   `touchpoint_matrix` stay semantically compatible and are not offered; nothing
   is ever substituted for another.

3. **`src/lib/studio/presentation-workspace.ts`** — the `server-only` loader.
   Reads canonical results, builds the registry from THAT document, projects the
   catalogue, chooses and builds a template, binds it explicitly, resolves it.
   Blueprint selection is by `registry.source.specId` and `mappingVersion`
   against a registered table, never by study UUID; the capability half is the
   approved blueprint's own `requireHandle`. A study of the right family and the
   wrong shape falls through to `buildGenericStartingBlueprint`, which builds a
   page out of what the registry actually publishes and invents no structure. A
   study with no usable canonical package gets a typed unavailable state and no
   legacy fallback.

4. **`/studio/e/[studyId]/construccion`**, exposed as **"Construcción"** between
   the team's reading and the client's view. `requireInternal()` is the first
   await, before `params`; then the UUID; then the study; then the workspace.

#### What crosses to the browser

`ComposerPayload` and nothing else: a bound document, the safe catalogue, a
resolved render model, and four strings of chrome. It is built by NAMING what
goes in rather than by removing what must not. The gate serialises a real
payload and asserts no `CanonicalAddress`, no address map, no `RegistrySource`,
no UUID, no plan/package/specification/mapping/calculation identity and no
sample-policy author, rationale or threshold — then asserts the registry it was
projected FROM does carry those, so the absence means something.

The payload TYPES are declared on the client-safe side and imported by the
server module, not the reverse; the refresh action is handed down as a prop.
Either the other way round would put the canonical read path in a `"use client"`
import graph.

#### The preview is explicit, and stale until it is asked

Structure on the canvas is always live; values are the last resolution's, marked
**"Vista previa desactualizada"** until somebody presses **"Actualizar vista
previa"**. That action is the only Server Action in the product that returns a
value instead of redirecting — a redirect would remount the page and throw away
a session-only document. It re-authorizes with `getUser()`, reads the role from
the database, throws rather than redirects for a wrong role, validates the study
id, reads the tenant back from the row, caps and parses the payload defensively,
validates against the strict v4 schema, re-binds from a registry it built
itself, and resolves on the server.

#### The two doors

| # | entry | loader | also through |
|---|---|---|---|
| 1 | `src/app/insights/e/[studyId]/page.tsx` | `src/lib/studies/study-dashboard.ts` | `src/lib/shadow/server.ts` |
| 2 | `src/app/studio/e/[studyId]/construccion/{page.tsx,actions.ts}` | `src/lib/studio/presentation-workspace.ts` | — (asserted NOT through shadow) |

They are a TABLE in `shadow-boundary-test.mjs` §[8], not a count, so a third
cannot be added by editing a digit. The server-action class stays closed with
one named exemption, asserted to perform no write. `"use client"` modules and
`route.ts` handlers still reach the canonical layer by no chain.

#### One existing rule was narrowed, deliberately

§[30] of the presentation gate refused `src/lib/results/` **entirely** to a
client component. A render-only library has to name a render model's type, and
the client-safe barrel reaches `results/contract.ts` because `RenderValue.unit`
IS a `ResultUnit`. The rule now permits **`contract.ts` and nothing else** of
that layer, and only through `import type`, which is erased at build. Two
assertions replace the one and are together stricter. `contract.ts` imports
nothing and exports one version string and two empty-record factories beside 44
type declarations; `build.ts`, `spec.ts`, `metrics.ts` and the barrel remain as
forbidden as before.

A blanket "no client reaches `src/lib/calc/`" rule was written, found to be
violated by twelve pre-existing dashboard and upload components, and
deliberately NOT introduced — a rule this gate has never enforced is not one
this unit imposes on somebody else's code in passing. It is recorded in the gate.

#### Gates

| gate | assertions | in `npm test`? |
|---|---:|---|
| `npm run test:canonical-composer` | **321** (new) | yes |
| `npm run test:canonical-presentation` | **294** (was 286) | yes |
| `npm run test:shadow-boundary` | passes, doors as a table | yes |
| `npm run test:studio-completion` | passes, new route registered | yes |
| `npm run test:canonical-presentation-parity` | **51** | no — machine-specific workbooks |
| `npm run test:canonical-results-parity` | **531/531** | no — machine-specific workbooks |

**Parity, executed with the two real workbooks:**
`ofrecidas=534 ejecutadas=531 aprobadas=531 falladas=0 omitidas=0 sin-resolver=0
no-aplica=2 requieren-configuración=1`. The renewal index is **33** numerically
and renders **"33.0"**; «Salida» TDP is **133.3**, unclamped; the approved
recommendation figures are **30.8 / 46.4 / −9.1**; all **110** journey figures
carry one decimal across 55 points and five approved routes from four source
groups.

**Discrimination: 29 probes, 29 discriminate.** Four on the editor (a refusal
that bumps the sequence; a duplicate that inherits connections; an
unimplemented variant in the renderer table; a dropped history cap), five on
the renderer (printing `value.value`; disabling the client branch of the
absence notice; letting a contentless block reach a client; removing a
declared variant's component;
un-disabling the filter controls), and six on the route and doors (reading
before authorizing; resolving before binding; importing the loader from the
client surface; widening the payload; giving the action a write; adding a third
unapproved page). Fourteen more came out of the adversarial review of the final
diff and are listed with it below. Every one turns a gate red and exits 1; every
file was restored byte-identically, SHA-256 compared before and after.

Four probes first proved nothing and were rewritten until they did; three are
worth naming. The C11 probe went green because every absent block in the fixture
was already filtered out before the notice was reached — the assertions were
passing structurally, so the notice is now driven directly in both modes for
all four states. The
ineligible-block probe went green because the assertion split the page on a
title that appears twice and inspected the few characters between the two
occurrences; each candidate block is now drawn alone. The third removed the
control-character half of the authored-text check and nothing went red, because
that refusal had been added without an assertion; four now drive it — a block
title, an editorial body, a page name and a sample-policy rationale — and the
same sentences without the character are asserted to be accepted, so the refusal
is about the character and not about the sentence.

A fourth incident belongs here for the same reason. The renderer and the route
were developed together and split into two commits afterwards by a script whose
two edits overlapped, which deleted §[30]'s entire client/route/action/page leak
walk from the renderer commit. The gate exited 0 and printed a clean summary,
because a removed check does not fail — it stops asking. Lint caught it, naming
two now-unread variables. It is restored byte-identically in its own commit, and
the split script now asserts its own output.

#### Browser QA

**74/74 checks, 0 failures, 27 screenshots**, against a PRODUCTION build
(`next build` + `next start`) driven over raw CDP. No console error, no page
exception, no failed request. No horizontal document overflow at 1440×900,
1280×800, 1024×768, 768×1024, 390×844, 360×800 or 320×720. Every actionable
control reaches 44 px at every width, the seam excepted at a measured 24×44 with
its own accessible restore button. Focus rings present, twelve of twelve tab
stops land on a control, and under `prefers-reduced-motion` nothing animates
above 50 ms.

Exercised rather than photographed: all four left/right panel combinations;
focus mode and its exact restoration; desktop, tablet and phone canvases; 100 /
75 / 50 / fit zoom; add, duplicate, hide, remove; keyboard reordering with no
pointer; undo and redo; the preview going stale and being explicitly refreshed;
a filter panel offering a dimension and reclassifying its candidates, with five
listed as unconnectable and why; and the filter controls drawn genuinely
`disabled` under the sentence that says filtering arrives in Unit 6B.2.

The journey is exercised in the two places it means two different things. On the
CANVAS the claim is that it is drawn and NOT operable: routes present, one detail
area, and a focus that does not take, because the canvas wraps every drawing in
an `inert` container so a click inside a chart selects the block. Mounted the
way a published client view will mount it — same component, same model, no inert
wrapper — the claim is that it works: a real pointer press moves between routes
and only one stays chosen, an SVG point takes the focus, and the arrow keys walk
the route with the focus following inside that block and not into the journey
above it.

**Two limits, stated plainly.** First, the SIGNED-IN route could not be driven:
all three synthetic actors in `.env.local` are refused by the hosted project with
`invalid_credentials` (auth health 200, so the project is reachable), and
rotating a credential is out of this unit's scope. What WAS proved of the route
in a browser is that an unauthenticated visitor is redirected to `/login` before
anything is read, and that nothing of the study leaks into that response.
Second, the composer was therefore driven through two temporary, uncommitted
harness routes that mount the COMMITTED components with a payload built offline
from the gate's own fixture — one for the composer and one for the renderer
alone. The offline payload also splits each journey block's single route into
two disjoint ones, because the generic starting layout proposes one route per
source group and a selector with one option is not a selector. The screenshots
show the renderers, not the approved dashboard's figures; those are verified by
`test:canonical-presentation-parity` against the oracle rather than by a
photograph.

That harness produced one finding worth keeping: a statically prerendered page
cannot carry the per-request nonce this application's CSP requires
(`script-src 'self' 'nonce-…' 'strict-dynamic'`, where `'strict-dynamic'` makes
`'self'` inert), so its entire client bundle is blocked — measured as 12
scripts, 0 nonces, 12 blocked loads and no hydration, against 9 / 9 / 0 and full
hydration on `/login` and `/`. The composer route is dynamic by construction and
unaffected. A future statically-rendered interactive page would not be.

Evidence lives outside git at `C:\dev\becommunity-qa\unit-6b1\` — `screenshots\`
(27 PNGs) and `machine\browser-qa.json`, `machine\parity\`,
`machine\discrimination\` (29 probe logs beside their green baselines),
`machine\final-chain\` and `machine\BASELINE-AUTHORITATIVE.json`.

#### The adversarial review of the final diff

Every finding below was verified against the code before it was accepted, and
every correction carries a probe that turns the gate red when it is undone.

**The editor engine.**

1. `replaceBlock` rebuilt the document on every call, so `commit`'s
   "nothing moved, spend no history" guard was dead for every block operation:
   blurring a text field without typing spent an undo step, and sixty of those
   would flush a real edit out of a sixty-deep history. It is
   identity-preserving now, and eleven operations return the block they were
   given when asked for what is already there.
2. Authored text was checked for LENGTH and not for CHARACTERS, while the v4
   schema refuses control characters — including the bidirectional overrides
   that can make a sentence render as its own reverse. A paste carrying one
   built a document that looked right, failed validation and could never
   resolve or store; the author would have met it at the preview. The editor
   refuses it now, in a sentence a person can read.
3. `togglePanelDimension` did not re-examine the connections a panel already
   had. Offering a dimension AFTER connecting a result could therefore create
   the very cross an authority forbids — and the author would have learned it
   from a resolver failure rather than from the decision they had just made.
4. Adding a `journey_routes` block from the catalogue was judged against the
   capability list of `journey_group`, the semantic a RESULT block bound to
   that group resolves to. A route map cannot draw a label and a count, so the
   only block that works was refused. Route blocks are judged against their own
   list.
5. The drop-line compensation lived in the drop handler and compared a
   page-local index against a document-wide line, so dropping a block between
   two others on any page but the first landed it one place off. It is
   `dropIndexFor` in the engine now, computed on the page that holds the block.
6. The renderer-capability table was keyed by VARIANT, and drawability is not a
   property of a variant: it is a property of the PAIR (variant, payload shape).
   A table draws a distribution and cannot draw a route. It is keyed by semantic
   now, and §[26] renders all forty-four offered pairs and asserts each one
   draws something.

**The render-only library.**

7. `Callout` reached through a touchpoint payload and printed ONE of its three
   figures with no label. That is not a summary, it is a substitution. All three
   are drawn, each labelled.
8. `table` is semantically compatible with a single value, a touchpoint and a
   journey group, and the component handled none of them — so a block the
   client gate had already let through rendered a titled card over nothing. A
   fallback that silently renders nothing is worse than no fallback, because the
   card still claims there is something to read.
9. The category table's count header said «Personas» for an instrument base,
   whose number is a valid base — a denominator, not a headcount of people. The
   header follows the payload shape.
10. A period in a series with nothing a client may see kept its labelled row,
    every cell blank: the reserved empty row C11 exists to remove. Studio still
    shows every period, because seeing which were withheld is the point of an
    internal preview.
11. The opposite defect, and the more damaging one: `clientHasContent` filtered
    any block with an empty payload, which removed the contract's own stated
    absences along with the gaps. "Nobody responded" and "no authority states
    this relationship" are facts about the STUDY, and C11's exception is
    explicit that a caveat about what a reader is being shown survives. Removing
    them made a study look complete where it had been honest.
12. A routes payload whose every route was empty counted as content, so a client
    was shown a titled card containing a route nobody had finished configuring.
13. The journey's arrow keys focused `[data-journey-node="N"]` across the whole
    document. That attribute numbers points WITHIN a route, so every journey
    block has a node 0 — and a key pressed in the second journey moved that
    journey's selection while sending the focus into the first. The generic
    starting layout emits one block per source group and the approved study has
    four, so a page with several journeys is the ordinary case.

**The composer surface.**

14. A ref was written during render. It is a reducer and an effect-scoped ref
    now, which is also what makes every edit a pure function of the state.
15. The zoom was resolved inside the canvas while the toolbar showed the stored
    value, so «Ajustar» could be in force while the control read 100%. It is
    resolved once, above both.
16. The text fields are uncontrolled on purpose — a controlled one would commit
    a history step per keystroke — and they did not reset when an edit was
    undone, so the next blur wrote the undone text back. They carry a key
    derived from the history depth.

**And one finding about the QA run itself.** An earlier version of this run
reported that a journey route could be selected inside the composer. The pass
was hollow: the canvas wraps every drawn block in an `inert` container so that
a click inside a chart selects the BLOCK rather than operating the chart, and a
programmatic `.click()` runs listeners inside an inert subtree even though a
person's click and keystrokes do not. The composer now asserts what is true
there — the structure is drawn and the drawing is inert, proved by a focus that
does not take — and the journey's real interactivity is driven against the
renderer mounted the way a published client view will mount it, with no inert
wrapper, using only real focus and real keystrokes.

#### Known-red gates, unchanged

`npm test` reports the same single failure as `b2506e9` —
`hosted-target-guard`'s worktree-versus-main rule, a property of the verifier
checkout. Suite D reports the same five as `b2506e9` when run in the environment
the baseline was captured in: the browserslist advisory, three secret-class blobs
already in reachable history, and the secret-leak gate, which needs an
`.env.local` the verifier does not carry. Neither is called passed.

With an `.env.local` present, `cf:build` embeds `SUPABASE_SERVICE_ROLE_KEY` and
the test passwords into `.open-next/cloudflare/next-env.mjs`, and the secret-leak
gate rightly refuses. That is pre-existing behaviour of the Cloudflare build, not
this unit's: no file in this diff reads `process.env` at all.

`tsc --noEmit` is clean; lint is at the **54-warning baseline** with zero errors
and zero warnings from any file this unit added. `npm run build` and
`npm run cf:build` are green.

#### Deferred, and still deferred

Draft storage, autosave, revision conflict handling, publication, review,
immutable snapshots, restore, conversion of the legacy v2/v3 drafts, production
client-route switching, public interactive filters and URL filter state,
PDF/print export, AI or category suggestions, authentication changes,
migrations, dependencies, deployment, shadow activation, journey route/stage
authoring, and the emergency `/presentacion` integration.

One hole is recorded rather than closed:
`src/app/studio/e/[studyId]/interpretacion/page.tsx` is still missing from
`studio-completion`'s `STUDIO_ROUTES`, so its authorization ORDER is checked by
nothing. Adding it was tried and reverted — the same list drives a
no-serialized-object rule and that page uses `JSON.stringify`, so closing the
hole means changing a page that is not this unit's to change.

All verification ran in WSL as `patop` on Node 24.11.1 / npm 10.9.2. No hosted
service was contacted, no credential printed, no Supabase row read or written,
no migration run, no deploy, no shadow mode, and no other worktree touched.

---

### Unit 6B.1 — acceptance closure (2026-09-07)

Five commits on top of `8f60dc1`, ending at `e487d98`. They close five
acceptance findings and record one that was deliberately left alone.

**Retention is drawn again.** The approved blueprint bound `retention_series` to
`bar_vertical`, and that pairing rendered NOTHING: `BarVertical` reads category
rows, a series has none, so the block was a heading and a description over a
blank. Every existing check passed — the variant is compatible, the payload is
full, a component exists — because none of them drew it. `period_cards` is a new
member of the closed vocabulary and the approved reading of a series: one card
per period, each measure as its own figure above its own meter, which is what
the reference dashboard draws and why a one-value-per-mark picture cannot
replace it. The same defect had a second home — `buildGenericStartingBlueprint`
chose from a GLOBAL union of everything drawn for any semantic — and the fix
there exposed a third: a `journey_routes` block is not a result bound to a
group, so asking `journey_group`'s (deliberately empty) list what to draw it as
silently removed the journey from every generic layout.

**The four-term clouds compose.** `terms.length >= 5` meant neither published
cloud ever turned a word, so both rendered as flat lists. They now use the
approved typographic composition: the longer words stack into a centred column,
the shortest one or two stand at exactly −90° beside it, size is
`min + (max−min)·√(count/largest)`, and it is built out of ordinary flow so
overlap and clipping are impossible rather than merely untested. No connector,
halo, bubble or diagonal. Exact count and share stay reachable by hover, focus,
tap and the accessible name, assembled from values the server already formatted.

**Sample-policy authoring is complete.** One editor serves both scopes: inherit
(blocks only), show everything, annotate below X, hide below X. X is typed in a
number field and every hard-coded `5` is gone; the schema always accepted
1-10 000 and only the editor pretended otherwise. The two restrictive modes
still require an author and a stated reason, `show_all` is still the default,
and the
software still suppresses nothing on its own. A block's control now exposes the
WHOLE policy rather than only handing the decision back to the document.

**The editor stopped speaking `snake_case`.** `src/lib/presentation/labels.ts`
holds exhaustive Spanish maps over each closed vocabulary — a label map, never a
rename, so every stored value is untouched and nothing parses a label back into
a code. Refusal codes keep their tokens beside their sentences, because the
surface is internal and a reviewer needs the exact string.

**All 13 Studio routes are covered.** `STUDIO_ROUTES` is walked from disk, so a
new page is covered the day it exists. The hole recorded above is closed: the
two rules that shared one list now have two, and the serialization rule carries
two exemptions named and argued, with a test that tells a structure rendered to
a reader from one posted in a form value. Two further gaps found while closing
it: a page matching no known reader passed the order rule vacuously, and one
member of the reader allowlist matched no Studio page at all.

**Gates.** `test:canonical-presentation` 294 → **314**,
`test:canonical-composer` 321 → **371**, presentation parity 51 → **59**.
Results parity stays
**531/531** and presentation parity is **59/59**, with CRI 33 → "33.0", «Salida»
TDP 133.3 unclamped, NPS 30.8 / 46.4 / −9.1, five routes and 110 journey figures
unchanged. Six real retention periods and their twelve figures are now asserted
where the workbooks are. Eight discrimination probes, 8/8 discriminating. Lint
is back at the 54-warning baseline and `npm test` reports the same single
known-red
`hosted-target-guard` failure as `b2506e9`.

**Authenticated real-route browser QA: PASSED, 55/55.**
Status: `AUTHENTICATED_ROUTE_QA_PASSED` (2026-09-07). It had been deferred while
the configured actor returned `invalid_credentials`; an existing internal
account was supplied locally, nothing was rotated, reset or created, and the run
then went through the product's own `/login` form.

What the real route proves, each by driving it rather than photographing it.
Authorization precedes the canonical read: without a session the route answers
`/login`, and neither a figure, a block title nor the study's identifier appears
in that response. The composer opens over the real study with 24 blocks; React
hydrates, shown by a client-only control changing `aria-pressed` when pressed.
Each side panel collapses and restores independently while the other stays put.
The explicit «Actualizar vista previa» resolves on the server and the CRI is
still 33.0 afterwards. A session-only title edit appears on the canvas and marks
the preview stale; refreshing returns the edited title with the study's figures
unchanged; a reload discards the edit and the block returns with its original
title. The document does not overflow horizontally at 1440×900, 768×1024 or
390×844. No console error, no page exception, no failed request.

The real figures, read off the page: CRI **33.0**; NPS **30.8 / 46.4 / −9.1**;
retention as **six period cards, twelve figures and twelve meters**; **five**
journey routes; and «Salida» TDP **133.3**, unclamped, read from the detail
panel after selecting that point. Both term clouds carry four terms with one and
two words turned to exactly −90°, no connector or halo, and every rendered size
equal to what its own count dictates — the counts read from each term's
accessible name (11/4/3/1 and 7/2/1/1).

**Seventeen element-level screenshots, seventeen distinct SHA-256 hashes**, at
desktop, tablet and phone, clipped to each element's own box. The inventory with
dimensions and hashes is `screenshots\INVENTORY.md`. Evidence lives outside git
at `C:\dev\becommunity-qa\unit-6b1-route\`.

**No application data was written.** The hosted fingerprint before and after the
run is byte-identical: 60 / 3 282 / 31, both experience drafts still at
schema_version 3 revision 14 and schema_version 2 revision 72, and 86 experience
events. A single save would have moved a revision.

**Two faults were found, and both were in the QA harness rather than the
product**, which is worth recording because a harness that fails quietly is how
a green run lies. The first version measured a default 800px window, where both
side panels are drawers and neither is docked, and reported the panels missing.
It also guessed at block labels — «Índice de riesgo de renovación» for a block
the product calls «Índice de riesgo de abandono» — and photographed the viewport
rather than the element, because `Page.captureScreenshot`'s clip takes page
coordinates. The second version still could not commit an edit: the title field
commits on blur, deliberately, so typing does not fill the sixty-step history,
and calling `blur()` on a field that was never focused dispatches nothing at
all. Each was diagnosed from the DOM rather than assumed, and no product code
changed as a result.

**Recorded, not fixed:** `src/components/evidence/QualitativeCloud.tsx` places
terms at nine hard-coded positions and silently DROPS any beyond the ninth
(`items.slice(0, positions.length)`). It is the legacy client dashboard's cloud,
mounted on a published client route, and is not this unit's to change. It is
technical debt named here rather than repaired quietly.

Four read-only hosted requests were made in this pass — one auth health check
and three refused sign-ins — plus one read-only fingerprint. No insert, update,
upsert, delete, RPC or migration was issued. The Cuicuilco counts (60 / 3 282 /
31), both experience-draft revisions (v3 r14 and v2 r72) and the 86 experience
events are identical to the values recorded above, which is the zero-mutation
proof: a single save would have moved a revision.

---

### Unit 6B.2 — interactive canonical filters and the ephemeral viewer state (source only, 2026-09-07)

**Branch `codex/canonical-experience-integration`, on top of Unit 6B.1's
acceptance closure (`24c640e`).** The disabled filter panels became real viewer
controls. Every filtered figure is recomputed by the canonical results layer on
the server and returned as a new `PresentationRenderModel`; the browser holds
presentation configuration and a reader's selection, and nothing else.

**Nothing is stored.** No draft, no revision, no publication, no autosave, no
`revalidatePath`, no migration, no dependency, no lockfile change, no hosted
mutation. The Cuicuilco legacy v2 draft is not read, migrated or overwritten.
No formula changed and no approved figure moved.

#### The architecture, in the order a request travels it

1. **The viewer selection is its own contract** — `src/lib/presentation/viewer.ts`.
   It is NOT part of `PresentationDocument` and cannot be: the strict v4 schema
   refuses an unknown field, so a selection cannot be smuggled into a stored
   layout even by accident. A selection names three things and all three are
   opaque: a PANEL ID the document authored, a DIMENSION HANDLE the catalogue
   publishes, and an OPTION TOKEN — `o0`, `o1`, … — which is the ordinal
   position of a value inside the list the server offered. There is nowhere in
   the type to put a column, an address, a study, a predicate or a value.

2. **The action treats it as hostile, separately from the document.**
   `refreshPresentationPreview` gained a third argument with its own 64 KiB
   ceiling, its own `JSON.parse` inside its own `try`, and its own validation.
   It re-authorizes with `getUser()`, reads the role from the database, reads
   the tenant back from the study row, and still writes nothing.

3. **`src/lib/viewer/` is the composition, and it is PURE.** One read of the
   evidence; one recomputation of the whole study per DISTINCT constraint set;
   one registry rebuilt from each recomputation; one resolution. It carries no
   `server-only` marker and no transport, which is why the offline gate drives
   the real composition rather than a copy of it.

4. **The resolver resolves per block.** `ResolveInput` gained an optional
   `viewer` carrying the selection and a map of recomputations keyed by
   `viewerConstraintKey`. Each block resolves against the view its OWN
   connections name; a block no panel names resolves under the empty key, which
   is the study's unfiltered document.

#### The semantics, said once

| rule | where it lives |
|---|---|
| a filter moves a block only when `connectedFilterPanelIds` names the panel | `viewerConstraintsFor` |
| values inside one characteristic combine as OR | `applyFilters`, `values.includes` |
| characteristics combine as AND | `applyFilters`, the outer loop |
| panels moving one block combine as AND | one `AppliedFilter` per constraint, never merged |
| «Todas las personas» is neutral | an empty constraint list, key `""` |
| an empty result is an explicit state | `empty_filtered_population`, never a measured zero |

**Two panels constraining the same characteristic are kept APART on purpose.**
Merging them into an intersection here could produce an empty value list, and
an empty list means "not constrained" to the canonical filter engine — the one
spelling that would turn "nobody matches" into "everybody matches".

#### Four defects this unit found and fixed

1. **The cohort dimension was publishing its enum.** `FilterValue` carried a
   `value` and no label, so a control would have offered a reader `active` and
   `deserter` while «Miembros activos» and «Desertores» sat unused in the
   specification. `FilterValue.label` was added and
   `CANONICAL_RESULTS_CONTRACT_VERSION` moved to **2.1.0** — additive, so minor;
   nothing moved and no number changed.

2. **Retention advertised a capability it does not have.** The registry declared
   `supportedFilters` for every section except `none`, while `buildRetention`
   refuses to recompute a ROSTER under a participant selection and answers
   `cross_not_permitted` for every period. An author could connect a retention
   block, the resolver would accept it, and the block would go blank at reading
   time under a refusal nobody was shown. `SECTION_ACCEPTS_PARTICIPANT_FILTERS`
   is now an exhaustive `Record` over the closed section vocabulary.

3. **A performance period vanished under a filter.** The month buckets were
   built from the SCOPED observations, so a month in which nobody in the
   selection was observed disappeared from the series and the months after it
   moved up — a reader comparing a filtered chart with an unfiltered one would
   have read a missing month as a fact about the study. Buckets and labels now
   come from the source; only the contents are taken inside the selection.

4. **An undeclared cohort's row vanished under a filter.** Same class, latent
   for Cuicuilco (both cohorts are declared) and live for the next study.

#### What the browser receives, and what it cannot

`RenderFilterDimension.options` carries `{ token, label, participants }`. The
canonical `value` has no field to travel in: it stays in the registry's
server-only `filterOptions` map, beside the address map. The per-option counts
are the UNFILTERED figures, deliberately — how many people carry a
characteristic is a fact about the study, and a count that moved with the
selection would be a number nobody measured under the selection that produced
it.

Everything a reader is told about what their selection DID arrives as a finished
sentence: the active summary, «Con esta selección quedan 24 personas de 60.»,
and «Ninguna persona del estudio combina estas características.» A browser
holding a base, a threshold and a rule would be a browser doing the comparison.

#### Two surfaces, opposite on purpose

The authoring canvas keeps its `inert` wrapper and is handed NO viewer controls,
so every filter control there is genuinely `disabled` under a sentence saying
where filtering works. The new **reading view** (`chrome.surface === "read"`)
mounts the same model the way a reader will get it: the client audience, no
`inert` wrapper, live controls. Unit 6B.2 could have been built by making the
canvas operable, and that would have made every chart, link and control inside
every block operable with it.

**Leaving the reading view clears the selection.** The canvas is where somebody
authors a sample-policy threshold against the base they can see, and a
threshold written against one selection's base is a threshold against the wrong
number. The canvas always shows the whole study, and says so in a banner for the
round trip it takes to get back there.

#### Stale-response protection

ONE counter for both callers. A reader ticking three boxes sends three requests
and the second may come back after the third, and an explicit «Actualizar vista
previa» races the same way — a neutral refresh landing after a filter would
replace filtered figures with everybody's while the controls still read
«Generación X». `acceptViewerResponse` is the pure half, and it returns the
session it was given — reference-identical — when a response is not the newest,
so a gate can assert that nothing happened rather than infer it. A refusal puts
the controls back to the selection the figures were computed under.

#### The URL codec exists and is wired to nothing

`src/lib/presentation/viewer-codec.ts` encodes a selection as
`panel~dimension:handle=o0.o1;panel2~…` and decodes it against an ALLOWLIST
built from this document and this study — a panel that exists, a dimension that
panel offers, a position the study minted. It fails closed on all four, and no
refusal ever echoes what it was sent. Unknown query parameters are discarded
explicitly, **by name and never by value**. **No route reads or writes it**: the
production client route is not switched in this unit.

#### Gates

| gate | assertions | in `npm test`? |
|---|---:|---|
| `npm run test:canonical-viewer-filters` | **236** (new) | yes |
| `npm run test:canonical-composer` | **383** (was 371) | yes |
| `npm run test:studio-completion` | **49** (was 48) | yes |
| `npm run test:canonical-presentation` | **314**, unchanged | yes |
| `npm run test:canonical-results` | **235**, unchanged | yes |
| `npm run test:canonical-database-source` | **74**, unchanged | yes |
| `npm run test:shadow-boundary` | **96**, unchanged, doors still two | yes |
| `npm run test:canonical-results-parity` | **531/531** | no — machine-specific workbooks |
| `npm run test:canonical-presentation-parity` | **59/59** | no — machine-specific workbooks |

**Parity, executed with the two real workbooks.** `ofrecidas=534 ejecutadas=531
aprobadas=531 falladas=0 omitidas=0 sin-resolver=0 no-aplica=2
requieren-configuración=1`, and presentation parity 59/59: the renewal index is
**33** and renders **"33.0"**, «Salida» TDP is **133.3** unclamped, the approved
recommendation figures are **30.8 / 46.4 / −9.1**, five routes over four source
groups, 110 journey figures with one decimal, six retention periods.

**One existing assertion was replaced by a stricter pair.** The composer gate
checked that the loader's text said `bindPresentationDocument(` before
`resolvePresentation(`. Resolution moved into `src/lib/viewer/`, so the rule is
now structural: the loader binds and NEVER resolves, the viewer module resolves
and NEVER binds. Before, one file could have done both in either order as long
as the text came out in sequence.

#### Discrimination — 23 probes, 23 discriminate

One defect at a time, restored byte-identically with SHA-256 compared before and
after, and the gate green again afterwards. They are: sharing a dimension
becomes a connection; OR becomes equality on a cohort; OR becomes equality on an
attribute; AND becomes OR; two panels merged as a union; an unconnected block
reading a filtered view; the panel's offer not checked; a forbidden cross
collapsed into an unsupported one; a cloud not recomputed; an empty selection
not declared; the sample policy decided against the unfiltered base; a position
accepted unvalidated; the codec skipping its allowlist; a stale response
applied; the raw value travelling beside the token; the browser dividing;
retention advertising filters again; a period vanishing; registry drift not
refused; the cohort enum reaching a reader; the canvas becoming operable; the
approved journey panel offering Esfera; and a filtered metric publishing a
measured zero.

**Five probes first proved nothing, and three of the five were the gate's
fault.** The OR probe broke only the cohort branch of an engine that has two,
and no assertion crossed it — the gate now proves the OR on both branches. The
sample-policy probe went green because `hide_below` is caught twice, at the
header and inside the payload; `annotate_below` is caught once, at the header,
and it is now the case that drives it, together with a block's `availability`.
The unvalidated-position probe went green because a SECOND, independent guard
refused — which is defence in depth working — so the gate now also drives the
validator directly, and the probe hits its own assertion instead of the other
one's. The remaining two probes were badly written and were rewritten.

#### The offline chain, executed in the WSL verifier

Fetched and checked out at the pushed commit, clean worktree. `npm run
typecheck`, `npm run lint`, `npm run build` and `npm run cf:build` all exit 0.
`npm test` runs green up to `test:hosted-target-guard`, which is the documented
known-red; because the chain is a single `&&` sequence it stops there, so the
thirty gates after it were RUN ONE AT A TIME and every one of them exits 0.

#### Known-red gates, unchanged

`hosted-target-guard` fails on exactly the assertion `24c640e` records — "the
refusal names the main-repository rule, so the worktree rule did not answer for
it", a property of the verifier being a plain clone rather than a worktree.
Suite D reports the same five: the browserslist advisory, three secret-class
blobs already in reachable history, and the secret-leak gate. Neither is called
passed. `tsc --noEmit` is clean and lint is at the **54-warning baseline** with
zero errors and zero warnings from any file this unit added or changed.

#### Real-route browser QA: PASSED, 87/87

Driven against a PRODUCTION build of the pushed commit (`next build` +
`next start`) over raw CDP, through the product's own `/login` form, against the
real Cuicuilco study. No console error, no page exception, no failed request.
The `.env.local` already on this workstation was sourced IN PLACE — never
copied, never printed — which is also why the run is a script rather than a
sequence of tool calls: the actor's password is typed into the form and appears
nowhere else.

What the route proves, each by driving it rather than photographing it:

- **Authorization precedes everything.** Without a session the composer route
  answers `/login`, and neither a figure nor a block title of the study appears
  in that response.
- **The canvas is dead on purpose.** 326 filter controls drawn, 326 genuinely
  `disabled`, under the sentence «Aquí los filtros no se aplican». No surface
  says «6B.2» any more.
- **The reading view is alive.** The same 326 controls, 326 enabled, and NOT ONE
  inside an `inert` container.
- **A filter recomputes on the server.** «Índice de riesgo de abandono» moved
  **33.0 → 31.3** and its base **28 → 4 respuestas utilizables** under one
  selected value.
- **A qualitative cloud is genuinely filtered**, and it is the cloud rather than
  the block that shares its name — see the finding below.
- **An unconnected block does not move.** «Razones declaradas de riesgo» shares
  every dimension with the risk panel and is byte-identical before and after;
  so is the recommendation block, which another panel moves.
- **A moved block says so** («Filtrado por …») and the panel prints «Con esta
  selección quedan N personas de M».
- **Two characteristics combine as AND**, and the combination the run happened
  to choose matched nobody — which produced «Ninguna persona del estudio combina
  estas características.» rather than a zero.
- **«Limpiar filtros» restores exactly**: the index, the cloud and the unmoved
  block all return to the strings they had before, and no block says «Filtrado
  por» any more.
- **Leaving the reading view clears the selection** on its own.
- **A reload discards both**: the surface returns to the canvas and no selection
  survives.
- **Tablet and phone are real.** At 768 and at 390 the panel composes inside the
  device width (734 px and 356 px), every one of 106 controls measures 44 px in
  LAYOUT pixels, and the document never overflows horizontally.
- **Keyboard and screen readers.** Sixteen characteristics, sixteen
  `fieldset`/`legend` pairs, the summary in an `aria-live="polite"` region,
  every checkbox inside its own label, and the space bar genuinely operates a
  control — the figure changed.
- **Nothing raw reaches a reader.** Inside the reading view's own subtree there
  is no `perfil_cliente`, no `csat_`, no `"active"`, no `"deserter"`, no
  `dimension:`, `value:`, `qualitative:` or `journey-touchpoint:` handle, no
  `"at":`, no `authoredBy` and no `rationale` — while «Generación», «Esfera» and
  «Miembros activos» are all present, so the absences mean something.

**Twelve element-level screenshots, twelve distinct SHA-256 hashes**, clipped to
each element's own box at desktop, tablet and phone. The inventory with
dimensions and hashes is `screenshots\INVENTORY.md`. Evidence lives outside git
at `C:\dev\becommunity-qa\unit-6b2\`.

**No application data was written.** The hosted fingerprint before and after the
run is byte-identical: the same ten table counts, and both experience drafts
still at schema_version 3 revision 14 and schema_version 2 revision 72 with 86
experience events. A single save would have moved a revision. Two read-only
hosted requests were made in this pass and no insert, update, upsert, delete,
RPC or migration was issued.

**Three faults were found, and all three were in the QA harness**, which is
worth recording because a harness that fails quietly is how a green run lies.
It selected a block by walking up from its DRAWING, which lives inside the
`inert` container where a person's press dispatches nothing — it now presses the
block's own chrome strip, found from the drag handle's accessible name. It
clicked the first «Limpiar filtros» in the document, which belongs to another
panel — it now clicks the risk panel's own. And it measured 44 px targets in
SCREEN pixels while the composer was showing the preview scaled to fit, so a
44 px control measured 17 px and the product was reported failing; targets are
now measured in layout pixels, which the transform does not touch.

#### Two findings about the approved study — CORRECTED, see Unit 6B.2.1

They were recorded here as editorial. They are not: both are cases of the
product showing a person two things it could not tell apart, and both are fixed
in Unit 6B.2.1 below. The paragraphs are kept because the second one's
conclusion — "the honest fix is editorial" — was wrong, and tracing the two
handles to their source is what showed why.

1. **Two blocks in the approved blueprint are titled «Miembros activos»** — the
   recommendation comparison cell and the qualitative cloud. The editor's
   «Qué mueve» list shows both under the same name, so an author connecting one
   cannot tell which they picked. The QA harness hit this and reported a
   filtered cloud that was an NPS figure until it was corrected.

2. **Two filter dimensions carry the same label**, «¿Cuánto tiempo tiene tu
   empresa?», so the active-filter summary can read «X: 1 a 3 años · X: 1 a 3
   años». The handles differ — `uniqueSegment` disambiguates with an ordinal —
   but the LABEL a reader sees does not.

#### Deferred, and still deferred

Draft storage, autosave, revision conflict handling, publication, review,
immutable snapshots, restore, conversion of the legacy v2/v3 drafts, production
client-route switching, wiring the URL codec to a route, PDF/print export, AI or
category suggestions, authentication changes, migrations, dependencies,
deployment, shadow activation, journey route/stage authoring, and the legacy
`QualitativeCloud.tsx` repair.

---

### Unit 6B.2.1 — two names a person could not tell apart (source only, 2026-09-07)

**One focused UX acceptance correction on top of `9b05532`.** No filter
semantics changed, no formula changed, no canonical value, calculation or source
mapping changed, no migration, no dependency, no hosted mutation. Results parity
stays **531/531** and presentation parity **59/59**.

#### 1. Two blocks with one name, in the connection selector

The «Qué mueve» list printed `block.copy.title ?? block.id` — so two blocks an
author gave the same title were two identical rows, and a block with no title
showed its opaque identifier to a person.

`connectionCandidates` now names every candidate itself, over BOTH lists at
once, and adds the smallest TRUE context that separates a collision:

1. **what the block draws** — «Miembros activos · Nube de términos» beside
   «Miembros activos · Cifra sola», which is exactly the collision the approved
   layout has;
2. **which page it is on**, when the drawings match too;
3. **its position on that page**, when nothing else separates them.

A title that does not collide is returned untouched. The qualifier is chosen per
COLLISION GROUP and only when it separates the whole group — one that separated
half of it would leave the rest looking distinguished when they are not. The
label is display text: no id, no handle, no semantic, no `snake_case`. A
connection is still saved by the block's own opaque id, and the checkbox takes
its accessible name from that same unique string.

#### 2. Two characteristics with one name, in the filter panel

**Traced before anything was changed.** A dimension's label is the SOURCE's own
column header, verbatim (`projector.ts`: "the label is what the source calls the
column rather than something this file invented"). The approved study has two
profile sheets — one per cohort — and asks the same questions on both, so the
contract publishes **six** colliding pairs, not one: «Tu Rango de Edad»,
«Generación», «¿Cuánto tiempo tiene tu empresa?», «Giro», «Tipo de empresa» and
«Tiempo en BNI Cuicuilco». The two ROI questions are worded differently on the
two sheets and were never ambiguous.

**They are not the same characteristic to filter on.** Measured from the real
package: every answer to a `perfil_cliente_*` dimension belongs to an ACTIVE
member and every answer to its `perfil_desertores_*` twin belongs to a
DESERTER — never both. A selection on one therefore excludes the other
population entirely, which is why the QA run's two-dimension AND matched nobody.

So exposing them once was rejected, and the reason is recorded: one control for
both would have to OR across two attribute keys inside the filter engine — a
change to filtering semantics — and it would take away the ability to ask the
question of one population, which is the only thing either control can do today.

The correction is therefore a truthful, clearly distinct label per
characteristic, and the qualifier is **the population that actually answers
it**, in the study's own Spanish: «Generación · Miembros activos» and
«Generación · Desertores». `FilterDimension` gained `cohortLabels` to say which
cohorts answered — read from the ANSWERS, so it is true of any study rather than
of this one — and the contract moved to **2.2.0** (additive). Nothing is derived
from the attribute key: `perfil_desertores_g` is storage vocabulary, and a label
built out of it would be a canonical key wearing a sentence.

Where the population cannot separate them either, an ordinal does — the last
resort, in the same spirit as the handle's own disambiguation.

**The handles did not move.** Disambiguation is a DISPLAY decision, so a handle
is still derived from the source's own label and the binding fingerprint is
untouched. A document saved before this existed names exactly the same entries.

#### Gates

`npm run test:canonical-viewer-filters` **236 → 319**, two new sections. They
prove: every candidate is named and no name repeats across BOTH lists; the
qualifier escalates through drawing, page and position, each driven by a
document built for it; a non-colliding title is untouched; no label carries an
id, a handle, an enum or `snake_case`; a connection is still saved by the block
id; two same-named characteristics answered by different cohorts are separated
by population and by an ordinal when they are not; the handle is still built
from the source label; **selecting each corrected option filters a different
population and moves the connected block differently**; and the disconnected
blocks are still byte-identical under both.

`canonical-composer` 383, `canonical-presentation` 314, `canonical-results` 235,
`canonical-database-source` 74, `shadow-boundary` 96, `studio-completion` 49 —
all unchanged and green. `tsc --noEmit` clean, lint at the 54-warning baseline.

One assertion of the new gate was wrong twice before it was right, and both are
recorded in the gate: it scanned the surface's RAW text for the expression the
fix removed, and found the comment that quotes it; and its "nothing else
separates them" fixture put the two blocks on different pages, so the page
qualifier answered and the position branch was never reached.

#### Real-route confirmation

Short and focused — the full 87-check acceptance ran at `9b05532` and is not
repeated.