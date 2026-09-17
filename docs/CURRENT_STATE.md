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

#### Real-route confirmation: 26/26

Short and focused — the full 87-check acceptance ran at `9b05532` and is not
repeated. Driven against a production build of the pushed commit in the WSL
verifier, through the product's own login form, against the real study.

- The connection list carries **29 connectable rows, 29 distinct names**, and
  **12 unconnectable rows, 12 distinct names**. The two blocks the approved
  layout calls «Miembros activos» read «Miembros activos · Cifra sola» and
  «Miembros activos · Nube de términos». Every checkbox's accessible name is
  that same string, all 29 unique, and none carries an identifier.
- The panel offers **18 characteristics, 18 distinct names**, «Generación ·
  Miembros activos» and «Generación · Desertores» among them.
- In the reading view the **16 visible characteristics are 16 distinct
  legends**, and none carries a canonical key.
- Choosing «Boomer» on «Generación · Miembros activos» moved «Índice de riesgo
  de abandono» from **33.0 over 28 respuestas utilizables to 41.7 over 3**, the
  moved block named the corrected characteristic — «Filtrado por Generación ·
  Miembros activos» — and «Razones declaradas de riesgo», which no panel names,
  did not move.
- No console error and no page exception.

**Three element-level screenshots, three distinct hashes**; a fourth was
captured, showed a one-line chrome strip and was removed rather than counted.
The inventory is `screenshots/INVENTORY.md` and the evidence lives outside git
at `C:\dev\becommunity-qa\unit-6b2-ux\`.

**No application data was written.** The hosted fingerprint is byte-identical to
the one taken at the end of Unit 6B.2: the same ten table counts, both
experience drafts still at schema_version 3 revision 14 and schema_version 2
revision 72, and 86 experience events.

**And the confirmation script itself was wrong first.** Five of its assertions
passed vacuously: the helper takes `(label, condition)` and those calls passed
`(condition, label)`, so a non-empty message string was read as the condition
and could not fail. One of the five was also measuring the connection list while
claiming to measure the offered-characteristics list, because both headings live
in one card and it scoped by `parentElement`. The helper now refuses a
non-string label outright, so the mistake fails loudly instead of reading green.

---

### Unit 6B.3A — the draft becomes durable (2026-09-08)

**Canonical schema-v4 presentation drafts can now be loaded, saved explicitly,
autosaved, reloaded, and refused on a revision conflict — proved against a
disposable PostgreSQL 17 and a real PostgREST, and against no hosted project.**
No formula changed, no canonical value changed, no source mapping changed, no
hosted row was written. Results parity stays **531/531** and presentation parity
**59/59**.

#### The storage audit came first, and it changed the design

The brief asked whether the existing schema safely supports a canonical v4 draft
coexisting with the two legacy experience drafts — Cuicuilco at schema version 2
revision 72, P6E at 3 revision 14. **The question was put to a real PostgreSQL
before it was answered**, on a disposable database carrying the whole chain with
a legacy row planted exactly as the project holds one. Three things came back:

1. **`study_experience_draft`'s primary key is `study_id` ALONE.** A second
   draft row for one study is refused with SQLSTATE 23505. There is no "beside"
   in that table.
2. **`save_study_experience_draft` ACCEPTED a canonical v4 document against the
   legacy row.** It moved revision 72 to 73, changed `schema_version` from 2 to
   4, and replaced the definition bytes. It refuses nothing about the FAMILY of
   a document: its only version rule is that the JSON's own `schemaVersion`
   agrees with the argument, and its column admits anything from 1 to 1000. The
   legacy draft was destroyed by a function doing exactly what it was written to
   do.
3. **There is no idempotency of any kind on that draft path.** Replaying an
   identical save — the ordinary consequence of a lost response — is refused as
   a conflict, indistinguishable from somebody else's edit.

**So the answer is: the existing schema does NOT support safe coexistence, and
this unit implements the smallest additive migration that does.** Widening that
primary key would not have been additive — it alters a constraint on a table
holding rows this project must not disturb, and every existing reader of it
assumes one draft per study.

#### `0029_canonical_presentation_draft.sql` — additive, and carried by no database yet

> ⚠️ **SUPERSEDED on 2026-09-08 by Unit 6B.3B**, which applied this migration to
> the hosted project. Everything below describes the state at the end of Unit
> 6B.3A and is kept as the record of that unit; the sentences about where the
> migration lives are true of that moment only.

Two tables and one function. It alters no existing table, drops nothing,
rewrites no row, and changes no policy or grant outside its own objects.

- `canonical_presentation_draft` — one mutable v4 draft per study. `schema_version`
  admits **4 by equality**, not a range, because a range is what let a canonical
  document overwrite a legacy row on the other path. The family, the registry
  build and the binding are columns as well as JSON fields, so a question like
  "which registry build was this authored against" is answerable without parsing
  half a megabyte — and a column that disagrees with the document it describes is
  refused on read.
- `canonical_presentation_draft_event` — append-only, and **the idempotency
  ledger**. A save carrying a key already recorded for a study is a REPLAY: the
  function returns the revision the first attempt produced and writes nothing.
- `save_canonical_presentation_draft` — the only write path. It authorizes the
  actor before reading anything, derives the tenant from the study row (a caller
  never names a tenant), refuses a document of another family, version, study or
  client, and writes the row and its event in one transaction.

**`service_role` gets SELECT and nothing else** — stricter than `0026`-`0028`,
which grant all privileges because their tables are bulk-written by the commit
function. The draft's only legitimate writer is its `SECURITY DEFINER` function;
a `service_role` that could `UPDATE` it directly could move a revision with no
event, no expected-revision check and no lock.

**And it takes an advisory lock, which is not a detail.** `select … for update`
locks a row that exists; when none does it locks nothing, so two concurrent
first saves both insert and the loser gets a primary-key violation — an untyped
error arriving where a conflict was expected. **The legacy draft function has
exactly that hole, and this one does not.** `pg_advisory_xact_lock` on the study
is taken before the first read a decision depends on, which also serialises the
idempotency lookup with the write it guards.

The migration and its rollback are in git and, at the end of this unit, existed
in no database at all. ⚠️ That stopped being true on 2026-09-08 — see §"Unit
6B.3B".

#### What the product does now

- The composer opens with the **stored draft when there is one**, and with a
  blueprint only when there is not. Opening the blueprint over saved work would
  put a fresh layout under the same heading as somebody's hour, and the first
  autosave would write it over the top. A stored draft that will not decode or
  resolve does NOT fall back to a blueprint: the refusal is shown.
- Six states, in the product's own Spanish: «Sin cambios», «Guardando…»,
  «Guardado», «Cambios sin guardar», «No pudimos guardar», «Hay una versión más
  reciente». They live in `src/lib/composer/save-session.ts`, which is **pure** —
  no clock, no randomness, no transport — so an offline gate proves the
  transitions rather than a browser suggesting them.
- **«Guardado» means the stored document IS the document on screen**, by
  reference identity. A save that succeeded while the author kept typing records
  the new revision and still reads «Cambios sin guardar», because the newest
  paragraph is not stored.
- Explicit «Guardar ahora», debounced autosave at 2 500 ms, a navigation warning
  while changes remain unsaved, and a **safe retry that repeats the previous
  idempotency key** — which is what makes it a replay instead of a second
  revision. Autosave never fires in a conflict, during a save, or after a
  failure: a timer that retries a failed save turns one refusal into a hundred.
- **A conflict cannot resolve itself by writing.** It preserves the local
  document, offers no retry, and its only action loads the stored version
  deliberately — through `adoptDocument`, which pushes the local document onto
  the undo stack, so an operator who adopts and immediately regrets it presses
  «Deshacer» and has their work back.
- **A save never re-binds; the preview always does.** Re-binding on the way to
  storage would take a layout authored against one package and file it as though
  it had been authored against another — the exact retargeting the binding
  fingerprint exists to prevent, made permanent.
- Undo/redo history stays session-local. Only the current document is persisted.

Authorization is redone in the action rather than inherited, with `getUser()` and
a role read from the database, and **the privileged client is not constructed
until that check has passed**. The operation stays behind the existing Studio
workspace/action boundary: no third canonical-data door was added.

#### Gates

- `npm run test:canonical-presentation-persistence` — **NEW, 148 checks, in
  `npm test`.** The encoding and the save session: a v4 document through jsonb
  and back with every key reordered, a column that contradicts its document, the
  legacy-family refusal by name for v1/v2/v3, «Guardado» only of what is on
  screen, an older answer that cannot mark newer work saved, four kinds of
  failure that never read «Guardado», a conflict that cannot write, the retry
  that repeats its key, and that nothing this unit added reaches the canonical
  layer, a credential or a respondent.
- `npm run test:canonical-presentation-draft-live` — **NEW, 93 assertions,
  outside `npm test`** because it needs a cluster. Executed against a disposable
  PostgreSQL 17.11: exact revision increment, idempotent replay, typed stale
  conflict, wrong tenant/study/family/binding/actor refused, a canonical draft
  coexisting with a legacy one, a failure leaving neither row nor event, an
  append-only log, least privilege, and the two legacy rows byte-identical
  before and after — including after the rollback. **Two genuinely concurrent
  races** in separate processes prove no lost update, a typed conflict for every
  loser, and a concurrent replay that produces no second revision. **And the same
  contract a second time over a real PostgREST 16.2 with `supabase-js`**, which
  is what proves `55000` reaches the client as `error.code` verbatim — the string
  the product switches on to tell a conflict from a failure.
- `test:migration-chain` gained the fourth canonical migration, and one of its
  rules was corrected while doing it: it identified "the commit migration" as
  `canonical[canonical.length - 1]`, which was the same thing only while the
  commit migration happened to be last. Appending a fourth silently redefined it,
  so the catalogue-baseline rule would have demanded the wrong schema. It now
  names that migration by slug.
- `test:canonical-composer`'s section [22] was re-aimed rather than deleted. It
  asserted "the page, the action and the loader write nothing", which was true of
  Unit 6B.1. It now asserts the **tighter** rule: the page still writes nothing at
  all; the action and the loader may not touch a table directly; the only RPC the
  route may name is the canonical draft save; and none of the three may name any
  legacy experience table.
- Unchanged and green: `canonical-presentation` 314, `canonical-viewer-filters`
  319, `canonical-composer` 383, `canonical-results` 235,
  `canonical-database-source` 74, `shadow-boundary` 96, `studio-completion` 49.
- **Both parity gates were RE-RUN against the real workbooks, not asserted.**
  `canonical-results-parity`: 534 offered, **531 executed, 531 passed**, 0
  failed, 0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required.
  `canonical-presentation-parity`: **59 checks, 59 passed** — the approved
  blueprint still expresses itself entirely through opaque handles, splits the
  source's four categories across the five approved routes without repeating a
  touchpoint, and reproduces the approved dashboard's figures without
  recalculating one. Neither number moved.
- `tsc --noEmit` clean. Lint at the **54-warning baseline**, zero errors, zero
  warnings from any file this unit added or changed. `npm run build` and
  `npm run cf:build` both exit 0. Every gate in `npm test` was run ONE AT A TIME
  — 50 passed, and the single failure is the documented known-red below.

**Known-red, unchanged:** `test:hosted-target-guard` fails on exactly the
assertion `24c640e` records — the verifier is a plain clone rather than a
worktree — and Suite D reports its documented five. Neither is called passed.

#### Real-route browser QA: PASSED, 58/58 — against a DISPOSABLE target

Every previous unit drove a production build against the hosted project and
proved at the end that nothing had been written. **This unit could not**, because
the thing under test IS a write: pointing it at the hosted project would have
created canonical drafts there, which the phase forbids.

So the whole target is disposable — a throwaway PostgreSQL on a unix socket, a
real PostgREST 16.2 in front of it, a **minimal authentication substitute** so
the product's own `/login` works, a synthetic canonical package committed
through the product's own commit flow, and a production build of the app pointed
at all of it. `resolveDisposableTarget` refuses to start if a Supabase
environment variable is in scope, so this cannot reach a hosted project.

What the run drives, rather than photographs:

- **Authorization precedes everything.** Without a session the composer answers
  `/login`, and no save control is rendered to a stranger.
- **A fresh blueprint opens as «Cambios sin guardar»** with no revision, and the
  screen no longer says nothing is saved — because that is no longer true.
- **«Guardar ahora» stores it**: «Guardado», revision 1, and the database agrees.
- **An edit says «Cambios sin guardar», and the debounced autosave stores it
  with nobody pressing anything** — revision 2, and the database agrees.
- **A reload restores the STORED document**, at «Sin cambios» revision 2, with
  the edit made before the reload on screen and the page saying the stored draft
  was restored.
- **Undo is disabled on a restored document** (there is no history behind it),
  an edit makes it dirty again, and undo/redo both work after saving.
- **A conflict, made by another editor saving through the same RPC behind the
  app's back**: «Hay una versión más reciente», the local document still on
  screen untouched, the store still at the other person's revision, **no retry
  offered**, no «Guardar ahora», and nothing offering to force a save.
- **Recovery**: «Cargar la versión almacenada» adopts it at «Sin cambios», and
  «Deshacer» gets the local work back and marks it unsaved again.
- **The navigation warning** cancels a `beforeunload` while work is unsaved.
- **Tablet (768) and phone (390)**: the document does not overflow horizontally
  and all **72 chrome controls** measure at least 44 **layout** pixels at both.
- **Nothing a person owns crossed**: no service key, no password, no
  `person_private`, `quant_response`, `qual_observation`, `survey_response` or
  `participant_attribute_value`, and not even the names of the tables involved.
- **The legacy draft is byte-identical** before and after, and its event log
  gained nothing.

**Two controls inside the RENDERED PRESENTATION measure under 44 px at tablet
and six at phone.** They are reported as an observation and NOT asserted: they
are word-cloud terms in the drawing, not this application's chrome, and they are
unchanged by this unit. Holding a drawing to the chrome's target size would
either fail a product nobody changed or let a test redesign the cloud.

**Three faults were found, and all three were in the harness.** A previous run's
`next-server` outlived the `npm` that spawned it, so the next run's health check
succeeded against a STALE server built for a database that had already been
dropped — the app now starts in its own process group, the whole group is
signalled at the end, and a busy port is a refusal rather than a silent
substitution. The page-rename helper picked "the first text input with a value"
and hit something else entirely, reporting success while the document never
changed; it now finds the control by its own label. And the run's stand-in for
"somebody else saved" wrote a fabricated digest, which
`decodePresentationFromStorage` then correctly refused — the digest is now
computed the way the product computes one.

#### Hosted access: ONE read-only pass, 24/24

The only hosted contact this unit made. Every request was a `select`; the script
contains no insert, update, upsert, delete or RPC.

- **«La voz de las y los Nets de Cuicuilco»** (`cd4d6acd…`) is at **schema
  version 2, revision 72**.
- **The P6E synthetic acceptance study** (`ad275928…`) is at **schema version 3,
  revision 14**.
- **Neither is schema version 4** — no canonical document was written into a
  legacy row.
- **`study_experience_event` holds 86 rows**, exactly as the previous unit left
  it; `study_experience_revision` and `study_experience_publication` are empty.
- **`canonical_presentation_draft` and its event table DID NOT EXIST there**
  (`PGRST205`) when this unit read the project, which was the proof that no
  database carried migration `0029`. ⚠️ Unit 6B.3B applied it on 2026-09-08 and
  both tables exist there now.
- Eleven protected tables were counted: study 5, respondent 82, quant_response
  3 364, qual_observation 33, study_participant 60, survey_response 1 685,
  performance_observation 252, metric_definition 116, pain_point 50, import_job
  1, import_job_record 3 559.

Each definition was **hashed and never printed**, and the digests are now
COMPARED rather than merely recorded: `9a08dacb…` for Cuicuilco and `a1fe3298…`
for P6E are pinned in the script, so a definition edited under the SAME revision
— the one way a legacy row can change without moving a number this pass would
otherwise read — fails the run. The full digests and the counts go to evidence
written outside every git repository.

#### A harness fault worth recording

Seventeen assertions in `test:canonical-commit` failed for a reason that had
nothing to do with the code: the Windows clone has `core.autocrlf=true`, and
copying the worktree into the WSL verifier carried CRLF into
`disposable-postgres-provision.sh`. A shell script with CRLF fails as
`env: 'bash\r': No such file or directory`, and its `--check-root` refusals
returned 0 instead of 2 — so a script whose entire job is to refuse dangerous
paths silently stopped refusing them. It surfaced as seventeen unrelated
failures and not as a syntax error. The sync now normalises line endings the way
`git checkout` does. **Prefer the rule in CLAUDE.md — push the commit, fetch it
in WSL — over copying files.**

#### An adversarial review of this unit's own diff, and what it found

Six independent reviewers, one per lens — the migration as PostgreSQL executes
it, concurrency and idempotency, authorization and the client boundary, the pure
state machine, the React wiring, and whether any gate could pass for the wrong
reason. Every finding was then handed to a separate verifier told to REFUTE it.
**Thirty findings; sixteen refuted, fourteen survived.** The eleven that were
real are fixed below; the rest were narrower than claimed and are recorded in
the verifiers' own words rather than acted on.

The three the review found that this unit had not:

1. **The idempotency replay answered without saying where the row is now.** A
   replay reports the revision that key produced — it does NOT report that the
   draft still IS that save. Between the original attempt and the replay,
   somebody else may have saved twice: the key's revision is still N and the row
   is at N+2 holding a different document. A caller reading only `revision`
   would see a success, find its own document unchanged on screen, and report it
   stored while the store held somebody else's. `0029` now returns
   `currentRevision` beside `revision`, and a replay whose two numbers differ is
   a CONFLICT rather than a success.
2. **Bumping the REST transport's schema bound to 0029 was a regression.** The
   psql transport APPLIES, so its bound tracks the newest migration on disk; the
   REST transport VERIFIES a hosted target, so its bound is a FACT about that
   target — and the hosted project stops at 0028. They were bumped in lockstep
   without noticing the asymmetry, which would have demanded of the hosted
   project the one migration this phase forbids applying to it. Reverted, and it
   now actively REFUSES a target that carries `canonical_presentation_draft`.
   The migration-chain rule that conflated the two bounds was corrected with it.
3. **`runSave` could not tell a refused `beginSave` from a started one.**
   `beginSave` returns the session untouched when a save is already in flight,
   and that session's `inFlight` is not null — it is the FIRST attempt's. Testing
   `inFlight` alone therefore read a refusal as a start and would have sent a
   second write carrying the first attempt's sequence number and expected
   revision. Identity is the only test that separates them.

Five smaller ones, all real: the RPC compared `#>>` rendered text, so a document
declaring the STRING `"4"` passed the schema-version gate and stored a row
nothing could read back (it now checks `jsonb_typeof` first); the migration-chain
gate's SECURITY DEFINER check was file-scoped and the trigger function could
satisfy it on the save function's behalf; `onLoadStored` had a `try/finally` with
no `catch`, so a rejected load left an unhandled rejection and no message;
undoing back to the stored document left the banner reading «Cambios sin
guardar» over a document that WAS saved, and the next autosave would have written
a needless revision; and the encoder's 512 KiB ceiling and the column's measured
different renderings of the same value, so a document the encoder accepted could
have been refused by the column forever — the encoder now keeps a stated
kibibyte of headroom.

And four gates could have passed for the wrong reason: the live gate's
«a replay is not an overwrite» resent an IDENTICAL body, so it held whether the
body was ignored or written; its browser-role probes accepted any failure rather
than requiring `42501`; the composer gate's authorization-ordering check used
`indexOf` and so inspected only the pre-existing action, never the new save and
load guard; and the persistence gate's privacy scan ran over a document with
zero blocks — bytes with no reference to a result cannot leak the key of one.
All four now assert what they claim.

#### Three defects found in this unit's own work before the review, all before it shipped

1. **The migration inherited the legacy function's create-path race.** The first
   draft of `0029` copied `select … for update` and would have given the loser of
   two concurrent first saves an untyped 23505. Found by an adversarial review of
   the audit, fixed with the advisory lock, and now proved by a race the gate
   runs every time.
2. **A privilege assertion passed for the wrong reason.** `set local role anon`
   outside an explicit transaction applies to the implicit single-statement
   transaction it is in and is gone before the next statement runs, so the SELECT
   executed as the table's OWNER and succeeded. It failed loudly only because it
   was written to expect a refusal; written the other way round it would have
   read green forever. It is now inside `begin; … rollback;` and covers reads,
   the event log and the function.
3. **The RETRY could have reported «Guardado» over unsaved work** — the exact
   failure this unit exists to prevent, arriving through the mechanism built to
   prevent it. `retryAttempt` returned the failed attempt unconditionally and the
   screen resent that attempt's idempotency key with the document CURRENTLY on
   screen. So: a save of document A times out but WAS applied; the author keeps
   working and the screen holds B; «Reintentar» resends key K with B; the database
   finds K recorded and correctly REPLAYS, answering with the revision that stored
   A; the session sees a success whose document is the one on screen and says
   «Guardado». The store holds A, the screen says B is saved, and B is not.
   `retryAttempt` now takes the current document and returns the attempt only
   while it is repeating the SAME one. Once the document has moved, a retry
   starts a NEW attempt with a fresh key — which may take a conflict against the
   author's own unacknowledged save, and a conflict is the honest answer to that.
   The gate asserts both halves, including what the dishonest path WOULD have
   said.

#### Still deferred

Publication, review, immutable snapshots, restore, conversion of the legacy v2/v3
drafts, production client-route switching, wiring the URL codec to a route,
PDF/print export, AI or category suggestions, authentication changes,
dependencies, deployment, shadow activation, journey route/stage authoring, and
the legacy `QualitativeCloud.tsx` repair.

⚠️ **The line above used to end "hosted migration application" and no longer
does.** Unit 6B.3B applied `0029` to the hosted project on 2026-09-08; the
section below is that record.

---

### Unit 6B.3B — the migration is applied to the hosted project, and Cuicuilco has a canonical draft (EXECUTED, 2026-09-08)

**This is the first hosted mutation since the real Cuicuilco import.** Three
things were authorized and exactly three happened: migration `0029` was applied,
Cuicuilco's first canonical schema-v4 presentation draft was created through the
real application, and the ledger row and draft event those two acts necessarily
produce. Nothing else on the hosted project changed, and the after-state proof
below is the evidence rather than the claim.

#### The migration, exactly

| | |
|---|---|
| project | `ontvqazsqiwisdddblif` (`be-community-dev`), PostgreSQL **17.6** |
| connection | **session** pooler, port 5432 — never the transaction pooler |
| commit applied from | `6f8bf76908778c63c4e355f3176babc885a62dd0` |
| migration | `supabase/migrations/0029_canonical_presentation_draft.sql`, sha256 `7c49867a8cacab80ecf0c7c25e393d54dddcbf5d87c8ceb187d24c76e86b57f8`, 24 160 bytes |
| rollback | `supabase/rollbacks/0029_drop_canonical_presentation_draft.sql`, sha256 `90e3c4d3e9facefc9730b14eee5535a9f7ca9839c7b620618798a420df874863`, 1 345 bytes |
| tool | `supabase db push`, CLI **2.115.0** — the same version that applied `0026`-`0028` |
| applied at | **2026-09-08 19:14:40 to 19:14:45 UTC** (5.92 s, exit 0) |

**The bytes applied are the bytes Unit 6B.3A tested.** The working copy in the
WSL verifier — the very file 6B.3A's live gate applied to a disposable
PostgreSQL — digests to `7c49867a…`, and so does the blob in `6f8bf76`, and so
does the Windows worktree. Three copies, one digest, no CR byte in any of them.

**The dry run proposed exactly one file** and nothing else: no reapplication of
`0000`-`0028`, no history repair, no seed. `supabase db push` wraps each
migration in its own transaction and the file carries its own `begin;`/`commit;`,
exactly as `0026`-`0028` do.

#### Before anything: the pre-migration safety gate

Every item was read-only and every one passed.

- **The target was verified without printing a credential.** Three independent
  configuration files — the Windows `.env.local` and both WSL copies — name the
  same project host, and their anon and service keys are byte-identical by
  digest. The direct connection resolves to the same ref, on port 5432.
- **The ledger held 29 rows, `0000`-`0028`, no duplicate**, and a SHA-256 was
  taken over each recorded body so a later run can prove none moved. ⓘ Two rows
  (`0020` and `0022`) carry a NULL `statements` array and therefore have no
  recorded body — a pre-existing property of how they were applied, recorded
  here rather than repaired.
- **Every `0029` object was absent**: both tables, both functions, all three
  indexes, the trigger and the deny policies.
- **The full inventory was recorded**: 59 public tables, all 59 RLS-enabled and
  FORCE RLS, 54 policies, 28 functions, 194 indexes, and a row count for every
  table. Cuicuilco's legacy draft at **v2 revision 72** (`updated_at`
  2026-08-30T19:26:04Z, 27 051 bytes, `b7127081…`); P6E at **v3 revision 14**
  (2026-08-31T08:08:47Z, 1 403 bytes, `8ea44dea…`); `study_experience_event`
  86 rows; `study_experience_revision` and `_publication` empty.
- The repository's own read-only gate,
  `npm run test:canonical-presentation-hosted-fingerprint`, passed **24/24**
  against the pinned digests before anything was applied.

#### The backup, and its restore rehearsal

```
/home/patop/becommunity-backups/u6b3b-pre-0029-20260908T190837Z
  database.dump  1 133 257 bytes  sha256=a73dad0f21d33e12f08cf0b740a01cc3979a16fd9698c7fea89cdd75631ce45f
  schema.sql       351 569 bytes  sha256=7e6b86e96e716654475160d801a37c4441e5d52e8724a7ad6b64d77e789130a6
```

`pg_dump` **17.11** custom format, compress 9, `--no-owner` (GRANTs and POLICYs
kept deliberately), schemas `public` and `supabase_migrations`, over the session
pooler. Directory `0700`, files `0600`, outside every Git repository. TOC: 773
entries — 60 TABLE definitions and 60 TABLE DATA blocks, 306 constraints, 80
indexes, 54 policies, 59 row-security entries, 2 triggers, 1 view.

**Restored into a disposable PostgreSQL 17.11 and compared against the source:
59 tables, 0 row-count mismatches**, policies 54 = 54, functions 28 = 28,
indexes 194 = 194, RLS 59/59 and FORCE RLS 59/59 on both sides, the ledger
identical at 29 rows `0000`-`0028` with no duplicate, and both legacy drafts
byte-identical by digest. The restore ran in three sections — pre-data, data,
then post-data after the referenced identities were synthesised into the
`auth.users` stand-in — so the 23 foreign keys to `auth.users` replayed too.

ⓘ **`pg_restore` reported exactly one error and it is not data:**
`schema "public" already exists`, because a fresh PostgreSQL database already
has one. A restore into a real Supabase project does not hit it. **That restore
has not been executed and must not be described as if it had.**

#### The restore procedure

1. Verify the artifact before trusting it: `sha256sum -c SHA256SUMS` in the
   backup directory. A mismatch stops the restore.
2. Provision a disposable PostgreSQL 17 —
   `BECOMMUNITY_PG_VERSION=17 bash scripts/lib/disposable-postgres-provision.sh` —
   and restore into it FIRST. A backup nobody has restored is a hope.
3. Create the roles the dump's ACLs name (`anon`, `authenticated`,
   `service_role`, `postgres`, `supabase_admin`) and apply
   `scripts/lib/disposable-bootstrap.sql` for the `auth` and `storage`
   stand-ins.
4. `pg_restore --no-owner --section=pre-data --section=data`, populate
   `auth.users` with the identities the restored rows reference, then
   `--section=post-data`.
5. Only a person may decide to restore over the hosted project, and only after
   the rehearsal above. **`supabase/rollbacks/0029_drop_canonical_presentation_draft.sql`
   is the reverse of the migration and is the right instrument for undoing THIS
   unit** — it drops only `0029`'s own objects and touches no legacy table, no
   legacy row and no policy outside them. It would also destroy the canonical
   draft, which is the only copy of that authoring work.

#### After the migration: what the database gained, and nothing else

A full structural fingerprint of `public` was taken before and after and diffed
object by object.

- **Tables 59 to 61.** Added: `canonical_presentation_draft`,
  `canonical_presentation_draft_event`. Removed: none. **Zero pre-existing
  tables changed** in columns, constraints, indexes, policies, grants or
  triggers.
- **Functions 28 to 30.** Added: `save_canonical_presentation_draft(...)` and
  `refuse_canonical_presentation_event_update()`. Removed: none. **Zero
  pre-existing functions changed**, compared by a digest over
  `pg_get_functiondef`.
- **Policies 54 to 56, indexes 194 to 199.** RLS and FORCE RLS on **61 of 61**.
  Schema grants unchanged.
- Both new tables carry `deny_browser_roles` — `for all to anon, authenticated
  using (false) with check (false)` — and grants of exactly
  `service_role: SELECT` beside the owner's.
- `save_canonical_presentation_draft` is `SECURITY DEFINER` with
  `search_path=""`, returns `jsonb`, and its EXECUTE is held by `postgres` and
  `service_role` only. `refuse_canonical_presentation_event_update` is NOT
  security definer and its EXECUTE is held by the owner alone.
- **The ledger is 30 rows, `0000`-`0029`, no duplicate**, and the recorded body
  of every one of the 29 earlier migrations digests to what it digested before.

#### Least privilege, executed rather than asserted

Thirty probes ran on the hosted project inside a transaction that was rolled
back, each one `set local role` then the operation, with the outcome recorded
**after** `reset role`.

- `anon` and `authenticated`: **42501 on every SELECT, INSERT, UPDATE and DELETE
  of both tables**, and `permission denied for function` on both functions.
- `service_role`: SELECT **allowed**; INSERT, UPDATE and DELETE **42501**. It
  reaches the save function's body and is refused there by the function's own
  first check — `42501 internal actor required` — which is what proves EXECUTE
  was granted rather than the call being refused before it.
- Over real HTTPS with the **anon** key: 401/`42501` on both tables' read and
  write and on the RPC.
- Over real HTTPS with a **genuine signed-in session** (the internal test
  account, the most privileged browser identity this product has): 403/`42501`
  on both tables' read and write, on the RPC, and on the real Cuicuilco draft
  requested by its own id.
- **The legacy surface is unchanged**: `save_study_experience_draft` still
  executable by `service_role` only, `study_experience_draft` still
  `service_role: SELECT` only, and both the RPC's definition digest and the
  table's column-shape digest are identical to before.

ⓘ **The dangerous legacy-v4 overwrite probe was NOT run against hosted data**,
as the phase required. It remains a disposable-target result from 6B.3A.

ⓘ **One probe passed for the wrong reason before it was corrected.** The first
run recorded its outcome while the probe role was still set, so the harness's
own scratch table became the thing that refused — and three `service_role`
probes that had SUCCEEDED were written down as `42501`. Recording after
`reset role` fixed it. It is the same defect 6B.3A found in the other direction,
and it is why the outcomes above are reported with their messages and not only
their SQLSTATEs.

#### One explicit save, through the real application

A production build of `6f8bf76` was built in WSL against the hosted origin —
`NEXT_PUBLIC_*` is inlined at build time, so the build had to happen after the
target was chosen — served on port 3200, and driven through the product's own
`/login` with the internal test account.

**Before the write**, the same server-side loader the page uses
(`loadPresentationComposerWorkspace`, `restoreStoredDraft: true`) was run
read-only against the hosted project and its document validated completely:
`persistence.revision = null` and `restored = false`, so what was on offer was
the BLUEPRINT; `documentKind: canonical_presentation`, `schemaVersion 4`,
`registryVersion 1.0.0`, bound to `cf63bdca…`; **1 page, 24 blocks** (8
editorial, 12 result, 3 filter panels, 1 journey-routes), **3 filter panels and
5 explicit filter connections**, document sample policy `show_all`, 13 chart
variants. `encodePresentationForStorage` produced 16 708 serialized bytes and
the digest **`511d7f54f3ec0a391b45db259f64d57f9d415a9b2f5711c6f5fc551cdb67809d`**
— computed before anything was written. 17/17.

**The save itself was one click of «Guardar ahora».** ⚠️ It had to be, and the
timing is worth recording: the composer's debounced autosave fires 2 500 ms
after a dirty document mounts, and a freshly built blueprint IS dirty — so left
alone, the first write to the hosted project would have been an AUTOSAVE rather
than the deliberate act this phase authorizes. A script installed before the
document loaded waited for the real control to become enabled and clicked it
once, stopping as soon as the screen reported a save in flight. The database is
what proves only one write happened.

**What the database holds now:**

| | |
|---|---|
| `canonical_presentation_draft` | **1 row** — study `cd4d6acd…`, tenant `e63b2092…`, **revision 1** |
| identity columns | `document_kind = canonical_presentation`, `schema_version = 4`, `registry_version = 1.0.0`, `binding_fingerprint = cf63bdca…` |
| `definition_sha256` | `511d7f54…` — **the digest computed before the write, unchanged** |
| actor | `06e3b329-70b4-4a29-9649-6c1e2b069664`, as both `created_by` and `updated_by` |
| written at | **2026-09-08 19:25:48.039969 UTC**, `created_at` = `updated_at` |
| `canonical_presentation_draft_event` | **1 row** — `draft_created`, revision 1, idempotency key `save-6153faa8-8c26-46b2-9572-4dc6d85ca17d` |

**It is a new row in a separate table, not a converted legacy one.**
`canonical_presentation_draft` is the table migration `0029` created; the
Cuicuilco legacy draft sits where it always has, in `study_experience_draft`, at
schema version 2 revision 72. The canonical row is schema version 4. Nothing
converted, nothing migrated, and nothing read the legacy row on the way.

**The stored document is the expected document, byte-semantically.** It was read
back out of the row, re-serialized canonically and compared with the document
built before the write: identical canonical JSON, identical SHA-256, and every
dimension the phase names survives — 1 page, 24 blocks and their kinds, the 3
filter panels, all 5 explicit connections by block and by panel, the document
sample policy, the 13 chart variants, the identity metadata, the binding and the
registry version. The mirrored columns agree with the document they describe.

**The reload restores it.** 14/14 in a second browser run: «Sin cambios»
«Revisión 1», NOT «Cambios sin guardar», no failure and no conflict, 24 block
cards on the canvas, the reading view opens and carries the study's own title,
and the page's own words are *«Plano de partida: Borrador guardado. Se restauró
el borrador que ya estaba guardado para este estudio, en la revisión 1.»*
**«Guardar ahora» is rendered but DISABLED**, which is why opening that route
again cannot write: a restored session's `savedDocument` is the object on
screen, so `hasUnsavedChanges` is false and autosave never becomes due. Nothing
a person owns reached the DOM — no protected table name, no password, no service
key.

**The idempotency replay wrote nothing.** The same key was sent again through
the same RPC, every argument read from the rows the save itself produced. The
answer was `replayed: true, revision: 1, currentRevision: 1, created: true`; the
draft count, the event count and `updated_at` were all unchanged, and the
transaction committed — it would have aborted if any of them had moved.

**Screenshots**, outside every Git repository, in
`/home/patop/becommunity-6b3b/evidence/`: the restored canvas at «Sin cambios
Revisión 1», the same full-page, the reading preview, and the reading preview
full-page.

#### Mandatory after-state proof — 57/57

Every item the phase named, compared against the snapshots taken before the
migration: both legacy drafts byte-identical (Cuicuilco v2/72, P6E v3/14, same
digests, same `updated_at`, same byte counts); the whole legacy experience
surface unchanged including the save RPC's definition digest and the draft
table's column shape; **exactly two table counts moved and both are the new
tables**, with all 59 pre-existing tables holding exactly the counts they held;
the ledger at 30 rows with no earlier body changed; exactly one canonical draft
at revision 1 under exactly one `draft_created` event; **no other study acquired
one**; the document and its mirrored columns agreeing; the replay writing
nothing; and nothing moving between the migration and the final read.

**Parity, re-run on the real workbooks** (`Datos limpio estudio Cuicuilco.xlsx`
`8d7afdb4…`, `Puntos de dolor Journey BNI Cuicuilco.xlsx` `bd0e70d7…`):
`canonical-results-parity` **534 offered, 531 executed, 531 passed**, 0 failed,
0 skipped, 2 not-applicable, 1 configuration-required;
`canonical-presentation-parity` **59 checks, 59 passed**, 0 failed. Neither
number moved.

#### Corrections this activation made necessary

Three source rules asserted "0029 is applied nowhere". Each was **inverted
rather than deleted**, because a target that has LOST the storage is as much a
finding as one that gained it unexpectedly.

1. `scripts/lib/canonical-rest-transport.mjs` — its bound is a fact about the
   hosted target, so it moved 28 to 29, and it now refuses a target MISSING
   `canonical_presentation_draft`. The two transports still answer different
   questions; that their numbers agree again is a coincidence of this moment.
2. `scripts/migration-chain-test.mjs` — the rule that tied the REST bound to the
   commit migration now names `HOSTED_APPLIED_SLUG` explicitly, a constant that
   must be moved by hand after a migration is applied. It also gained a
   requirement that every governing document record the presentation migration
   as applied, and five withdrawn-claim patterns so "applied to no project"
   cannot return.
3. `scripts/canonical-presentation-hosted-fingerprint.mjs` — section [3] now
   asserts the storage EXISTS and pins what it holds: exactly one draft, at
   revision 1, with the binding and definition digest above, under exactly one
   `draft_created` event, and no other study carrying one.

#### Known limitations, stated rather than implied

1. ⚠️ **The «Guardado» state of the first save was not photographed.** The wait
   predicate in the operator's own driver was malformed — the harness's
   `waitForDom` expects a FUNCTION and it was handed an expression — so the run
   timed out 30 s after a save that had already succeeded, before its screenshot
   step. The save is fully evidenced in the database (revision 1, one
   `draft_created` event, the pre-computed digest unchanged) and the reload
   screenshot shows «Revisión 1» beside the product's own "borrador guardado"
   sentence. It is **not** recoverable without a second save, and a second save
   would be a second revision, which this phase forbids. The «Guardado»
   transition itself stays proved by 6B.3A's 148 offline checks and its 58-check
   disposable-target QA, not by a photograph taken here.
2. **The signed-in HTTPS probe inside the browser did not execute** — this app
   keeps its session in cookies through `@supabase/ssr`, not in `localStorage`,
   so the driver found no token there. It was executed instead from Node against
   a real session obtained through `signInWithPassword`, which is the same
   identity reaching the same PostgREST, and it is recorded above.
3. **`0029`'s own header still says "NOT APPLIED TO THE HOSTED PROJECT".** The
   file was deliberately left byte-identical: it is now an applied migration
   whose bytes the hosted ledger records, and editing an applied migration to
   correct a comment would make the repository and the ledger disagree about
   what ran. The correction lives here and in `CLAUDE.md` instead.
4. **The backup covers `public` and `supabase_migrations` only.** The `auth`
   schema is deliberately excluded, as in every previous backup; the sign-ins
   this unit performed wrote auth sessions, which are not restorable state and
   are not part of what this phase could affect.
5. ~~**`migration-chain-test.mjs`'s "no document claims a real workbook was
   imported" rule is stale**~~ — **CLOSED 2026-09-08**, see §"Unit 6B.3B.1"
   below.

#### Still deferred, and deliberately so

P6E has **no** canonical draft and did not get one. Nothing was deployed, no
application code was promoted, the client route was not switched, no publication
or immutable snapshot was created, no legacy draft was converted, no formula
moved, and shadow mode is still off everywhere.

---

### Unit 6B.3B.1 — the stale import rule, closed (2026-09-08)

One narrow test-integrity fix. `migration-chain-test.mjs` §[7] carried a rule
forbidding any governing document from saying a real workbook had been imported
into the canonical tables. **That premise was false for five weeks**: Unit 5
Phase 2 imported the real Cuicuilco package on 2026-09-06, and `CLAUDE.md`,
`docs/CURRENT_STATE.md` and `docs/CANONICAL_STUDY_MODEL.md` all say so.

**It passed anyway, and that is the more interesting half.** Its subject pattern
was `/\breal (?:workbook|package)s?\b/` — the two words adjacent — while every
document writes "the real Cuicuilco **package**". So the rule matched nothing,
in three documents that contradicted it. A false premise and a check of nothing,
each hiding the other: had the pattern worked, the false premise would have
failed the gate the day the import happened and been corrected then.

#### What replaced it

Not one inverted rule. The fact has four distinctions that a single sentence
would collapse, and collapsing them is how a reader ends up believing the
canonical draft is the legacy draft converted:

| # | the distinction | how it is checked |
|---|---|---|
| (a) | the real workbook **package** was imported into the canonical tables | every governing document must carry a non-negated sentence saying so |
| (b) | the raw workbook **bytes** were not committed to git | no tracked `.xlsx`/`.xlsm`/`.xls`, and no tracked file whose SHA-256 is either pinned source digest — by content, because a rename is not a redaction |
| (c) | importing canonical evidence **converted nothing** | each document must record the legacy drafts as untouched, must record the hosted Cuicuilco legacy draft at **schema version 2 revision 72**, and may not claim a legacy draft was converted, migrated, rewritten or overwritten |
| (d) | the canonical presentation draft is a **separate** schema-version-4 row | each document must say `0029`'s storage is separate from the legacy table, and separately that what it holds is a v4 draft |

Plus five withdrawn-claim patterns so no document can go back to denying the
import.

**Three things in that list are deliberate and would be wrong the obvious way.**
(1) `NEGATOR` is NOT applied to (c)'s first check — the claim being required IS
a negative, and filtering negated sentences would reject the very sentence asked
for. (2) The withdrawn patterns say "imported", never "uploaded" or "supplied":
`docs/CANONICAL_STUDY_MODEL.md` truthfully records a synthetic run with "no real
workbook uploaded", and both parity gates truthfully record runs where the real
workbooks were "deliberately not supplied" — widening the verbs would fail three
true sentences. (3) (c)'s revision check **excludes sentences about a planted or
disposable row**, because `0029`'s own audit planted a legacy row at revision 72
and watched the legacy RPC move it to 73; letting that satisfy a check about the
hosted row would be the same defect in a new place.

#### Two of the new rules were wrong first, and the mutation proof is what said so

`\b0029\b` does not match `0029_canonical_presentation_draft.sql` — `_` is a
word character, so there is no boundary after the digits — and the first draft of
(d) therefore failed two documents that state exactly what it asked for. And
(c)'s "no legacy draft was converted" started life in the whole-document
`WITHDRAWN` list, where it fired on `docs/CURRENT_STATE.md`'s own true sentence
*"no legacy draft was converted, no formula moved"*: a raw-text regex cannot see
a negation. It is a per-sentence check now. **Both are the failure this unit is
about, met twice while fixing it.**

#### The proof that the rules discriminate

A rule that passes is not evidence until it has been made to fail for the reason
it claims to guard. **Eight mutations, eight failures, each naming its own
distinction**, every one reverted and the four touched files digested before and
after:

1. a document denies the import → the withdrawn pattern fires;
2. **the stale rule itself, restored with a working subject pattern** → it fails
   on `CLAUDE.md`, which is the demonstration that its premise was false;
3. a document stops recording the import → (a) fails;
4. a document asserts the legacy row itself became the canonical one → (c) fails;
5. the hosted Cuicuilco draft is recorded at another revision → (c) fails;
6. a document stops calling `0029`'s storage separate → (d) fails;
7. a spreadsheet becomes tracked → (b) fails, naming the file;
8. the content scan aimed at a file that IS tracked → (b) fails, naming it.

⚠️ **A text rule cannot tell use from mention, and this document had to be
written around that.** The mutation list above originally spelled out the
forbidden sentence in order to say it was forbidden, and (c) fired on this very
section — correctly, by its own lights. There is no fix inside the rule that
would not also let the real claim through under a thin wrapper, so the
convention is the other way round: a governing document DESCRIBES a forbidden
claim, it never quotes one. Anyone extending these rules should expect to pay
that cost again.

Mutation 8 uses a tracked synthetic sample rather than the real workbook:
staging respondent answers to prove respondent answers are not staged would be
the joke it sounds like, and it exercises the identical comparison.

All four files restored **byte-for-byte** (SHA-256 before and after), and the
gate is green again after the last revert.

#### Documentation changed only where a check found a real gap

- `docs/CANONICAL_STUDY_MODEL.md` recorded the import but never the hosted
  Cuicuilco legacy draft's own state; it now says the draft was at v2 revision
  72 before the import and is at v2 revision 72 now, and that the later
  canonical draft is a separate v4 row in the table `0029` created.
- `docs/CURRENT_STATE.md` never said the canonical draft's table is SEPARATE
  from the legacy one — it described the migration at length and left a reader
  to infer it. One paragraph in §"Unit 6B.3B" now says it outright.

Both gaps were found by the new checks rather than by reading, which is the
point of having them.

#### Scope

The gate reads files and asks the local git index which are committed; it still
contacts no network, no database and no hosted project. **No hosted write was
repeated, no browser QA was re-run, migration `0029` was not edited, and no
expensive suite was run.** `test:migration-chain` and `lint` are the only gates
this closure needed, and both are green.

---

### Unit 6B.4A — the canonical publication lifecycle, the review surface, and the disposable-database proof (2026-09-08)

> ⚠️ **SUPERSEDED IN ONE RESPECT on 2026-09-09 by Unit 6B.4B1**, which applied
> `0030` to the hosted project. Everything below describes the state at the end
> of Unit 6B.4A and is kept as the record of that unit; the sentences about where
> the migration lives are true of that moment only. **What is NOT superseded is
> that nothing has been published** — 6B.4B1 applied the storage and used it for
> nothing, so the three publication tables are still empty.

**A canonical schema-version-four presentation can now be reviewed, published,
re-published, restored into a new draft revision and served back exactly as it
was approved — proved against a disposable PostgreSQL 17, a real PostgREST and a
disposable browser target, and against no hosted project.** No formula changed,
no canonical value changed, no source mapping changed, no hosted row was written
and no migration was applied to hosted infrastructure. Results parity stays
**531/531** and presentation parity **59/59**.

#### The audit came first, and it decided the design

The phase required the existing publication storage to be audited empirically
before a lifecycle was designed. `npm run test:canonical-publication-audit`
applies migrations `0000`-`0029` to a disposable database, plants both legacy
experience drafts exactly as the hosted project holds them, saves a canonical v4
draft beside one of them through `0029`'s own RPC, and then asks migration
`0025`'s publication path to publish it. **60 executed, 60 passed, nine
findings — eight UNSAFE and one PARTIAL.** Every one is the outcome of a
statement that ran, printed with the SQLSTATE PostgreSQL produced.

| # | finding |
|---|---|
| A | `prepare_study_experience_revision` reads the LEGACY draft table by study id and cannot see the canonical draft at all — refused `55000` at the canonical revision AND at the legacy one. It can never originate from an exact canonical draft revision, which is the first lifecycle invariant. |
| B | `study_experience_revision.schema_version` is a RANGE and the table has no family discriminator. A schema-version-TWO legacy definition was accepted there as a prepared revision. |
| C | the active pointer is keyed on `study_id` alone and the revision table is unique on `(study_id, revision)`. Publishing a second revision MOVED the one pointer; two families would share it and one version sequence. |
| D | a legacy revision carries one unstructured `study_fingerprint` — the audit stored the single character «x» in it — and no column for the binding, the registry build, the results contract, the calculation version, the package identity or the plan. |
| E | UPDATE is refused twice; DELETE only by privilege. The audit deleted a prepared revision as the table owner, and every `SECURITY DEFINER` function runs as that owner. |
| F | publication re-reads the LEGACY draft to decide staleness, so a canonical publication's staleness would be decided by a v2/v3 document. |
| G | the only route into that path is writing the canonical document INTO the legacy draft, which the legacy save RPC accepts: a planted v2 row at revision 72 became a v4 row at revision 73 with different bytes. Publishing canonically through `0025` REQUIRES destroying a legacy draft. |
| H | the legacy event log's `action` CHECK is a closed six-value vocabulary — a canonical action was refused `23514` — over one shared `(study_id, idempotency_key)` namespace, on a table holding 86 hosted rows. |
| I | a legacy revision stores CONFIGURATION and fingerprints and nothing else, by that migration's own stated design, and recomputes every published number at request time from current data. |

**So the answer is no, and `0030` is the smallest additive alternative.**

#### `0030_canonical_publication.sql` — three tables, four functions, carried by no database yet

> ⚠️ **SUPERSEDED on 2026-09-09 by Unit 6B.4B1**, which applied this migration to
> the hosted project. The heading's "yet" is the whole difference; the design
> below is unchanged and no row was written into any of it.

`canonical_presentation_revision` (the immutable snapshot),
`canonical_presentation_publication` (the current-publication pointer, one row
per study) and `canonical_presentation_publication_event` (append-only, and the
idempotency ledger for both operations). It alters no existing table, drops
nothing, rewrites no row, and changes no policy or grant outside its own
objects. `service_role` gets **SELECT and nothing else** on all three; the only
legitimate writer of any of them is a `SECURITY DEFINER` function.

**Reproducibility needed BOTH halves, and that was the one real design
decision.** The phase asked whether it requires storing the resolved render
model, pinning an immutable canonical result package, or both. The answer is
both, for different reasons that do not substitute:

- **the stored render model** is what makes reproduction EXACT. It survives a
  change to the canonical rows, the calculators, the registry or this code, and
  it is already a public shape — finished values with no address, no canonical
  key and no respondent — so storing it adds no disclosure. Measured on the real
  approved layout: 24 blocks, **77 660** serialized bytes, against a 2 MiB
  column ceiling;
- **the pinned package identity** is what makes drift VISIBLE and
  ATTRIBUTABLE — `binding_fingerprint` beside `results_contract_version`,
  `calculation_version`, `spec_id`, `mapping_version`,
  `package_idempotency_key` and `plan_fingerprint` — and it is what a filtered
  recomputation would have to be checked against the day interactive filters
  reach a client route.

**Publication output therefore depends on no mutable current data.** A draft
edited after a publication changes nothing a client is served; that is executed
in the live gate and again in the browser QA.

**Restoration creates a NEW DRAFT REVISION and nothing else.** It does not move
the pointer, does not mark a snapshot superseded, does not unpublish and does not
delete. It writes the draft **through `save_canonical_presentation_draft`**, so
the draft keeps its single write path and its own event log records an ordinary
save. Making a restored document live means reviewing and publishing it again,
against the study's results as they are then.

**Two defects in the earlier model were deliberately not repeated, and one of
them is a latent fault in applied history.**

1. `0030`'s immutability trigger covers DELETE as well as UPDATE, but
   CONDITIONALLY — it refuses only while the parent study exists. An
   unconditional refusal would make a study undeletable, which is the failure
   `0025` correctly avoided by refusing nothing at all. Both halves are executed:
   a snapshot cannot be deleted, and a whole study still can.
2. ⓘ **`0025` makes an authentication identity undeletable, and this was found
   rather than fixed.** `study_experience_revision.prepared_by` is
   `references auth.users on delete set null` on a table whose trigger refuses
   every UPDATE. Removing a user issues exactly that UPDATE, the trigger raises
   `2F002`, and the delete fails for as long as the row exists. `0025` is applied
   history and this branch does not edit it. `0030` stores a bare uuid instead,
   as `0023`'s own event table already does.

#### The publication layer: pure, closed, and with no threshold in it

`src/lib/publication/` is client-safe and reaches no transport: the preflight,
the inventory, the structural difference and the closed vocabularies all three
speak. `src/lib/studio/publication-workspace.ts` is the `server-only` half.

- **18 blocker codes, and every one is reachable.** The first draft of the union
  had 22, of which four — `results_contract_drift`, `calculation_version_drift`,
  `package_identity_drift`, `plan_fingerprint_drift` — could never be raised,
  because a stored draft carries two identity columns and all four of those live
  INSIDE the binding digest. They are an ATTRIBUTION of `binding_drift` now,
  built from the last publication's own pinned columns, and an informational
  warning that says the evidence moved. A closed union whose members cannot occur
  is not a stronger contract.
- **Warnings stay warnings.** Four require an explicit acknowledgement —
  `configuration_required_blocks`, `qualitative_review_pending`,
  `withheld_by_sample_policy`, `nothing_visible` — and the rest are
  informational. `required` is derived from what was RAISED, so a reviewer is
  never asked to acknowledge a condition this document does not have.
- ⓘ **`configuration_required` is a WARNING and never a blocker.** Contract C11:
  what nobody has finished renders as nothing on the client side. Publishing it
  is a decision, so it needs an acknowledgement — and blocking on it would make
  the approved blueprint unpublishable forever, because that blueprint declares
  the curated pain-cloud slot and leaves it empty on purpose.
- ⓘ **Qualitative categories nobody reviewed are DECIDED, not refused.**
  `src/lib/results/qualitative.ts` hands the decision here in as many words:
  the categories are the source's own coding, "so the publication boundary must
  decide about them before showing them to a client". Deciding is what an
  acknowledgement is; blocking would be refusing forever.
- ⓘ **NO THRESHOLD EXISTS IN THIS LAYER.** There is no number in the preflight,
  no comparison against a base and no rule about a small sample. The two sample
  warnings are read off `RenderBlock.sampleDisplay` — the outcome the resolver
  already decided from an AUTHORED policy carrying a name and a stated reason —
  so under the system default `show_all` neither can fire, whatever the bases
  are. The offline gate asserts that over the REAL resolved model, whose bases
  are as small as two.
- **A block the contract calls `unresolved` IS a blocker.** Unavailable means the
  study does not carry that measurement and absence renders as nothing; unresolved
  means the authorities disagree, and publishing an open question presents it as
  settled.

#### The review surface

`/studio/e/[studyId]/revision`, behind `requireInternal()`, in plain Spanish. It
shows the exact draft revision under review and when it was saved, the page and
block inventory including the parts a client will NOT see, the client-visible
preview through the product's own renderer at `audience="client"`, blockers in
their own box apart from warnings, the acknowledgements, the structural
difference from the current publication, an explicit final confirmation, the
publication history, and a restore control that says in so many words that
restoring creates a new draft revision and publishes nothing.

ⓘ **THE BROWSER NEVER HOLDS THE THING BEING PUBLISHED.** The publish action
takes four numbers and a list of closed codes — the reviewed draft revision, the
current publication version, the acknowledged warning codes and one idempotency
key. The server then does the whole job again over a fresh read: it reads the
stored draft, rebuilds the registry from the study's current canonical results,
decodes, resolves twice, re-runs the entire preflight, and publishes only if it
still passes. There is no parameter for a document, a digest, a binding, a
package identity or a uuid, so there is nothing for a browser to smuggle in — and
none of those internal values ever crossed to it in the first place.

ⓘ **IT IS A THIRD DOOR AND NOT A THIRD LOADER.** `publication-workspace.ts` holds
no canonical reader of its own; everything that touches the canonical layer comes
from `presentation-workspace.ts` — the composer's declared loader — through a
SINGLE import statement, so the route's path to that layer runs through that file
by construction rather than by which import happened to be written first. The
boundary gate's door table names the page beside that loader and the action class
gains exactly one named member; both fail the moment the publication module grows
its own edge into the canonical graph.

#### The database and security proof — 188 executed, 188 passed, 0 skipped

`npm run test:canonical-publication-live`, against a disposable PostgreSQL 17.11
and a real PostgREST 16.2 with `supabase-js`. All fourteen proofs the phase names
are executed:

| # | proof | how |
|---|---|---|
| 1 | canonical and legacy publication storage cannot collide | both families published for ONE study: two pointers in two tables, two independent version sequences, no shared row, and no canonical function naming a legacy object |
| 2 | schema v2/v3 is refused | v2 and v3 documents refused `22023`; a v2 blob stamped with a `documentKind` of the canonical family refused too; a render model of another schema version refused |
| 3 | the exact draft revision and digest are required | a wrong revision, a wrong digest and different bytes each refused `55000`; a study with no canonical draft cannot publish |
| 4 | a stale draft publication is refused | the draft was edited and the reviewed revision became unpublishable, with the message naming the draft |
| 5 | binding/result/package drift is refused | a binding disagreeing with the document refused `22023`; a SELF-CONSISTENT document bound to another package refused `55000` at the draft comparison; a registry build and a results contract that disagree refused `22023` |
| 6 | publication is atomic | a publication whose note cannot be stored left every count exactly as it was and the pointer where it was |
| 7 | retry is idempotent | a replayed key answered with the first attempt's version, wrote nothing, and the stored document of that version was the FIRST attempt's — proved by resending DIFFERENT bytes |
| 8 | concurrent publication creates only one version | two overlapping publications in separate processes: one winner, one typed `55000`, one version, one pointer, one event |
| 9 | prior snapshots are immutable even to service-layer code | UPDATE `2F002`; DELETE while the study exists `2F002`; the event log `2F002`; and deleting the whole study still cascades |
| 10 | browser roles cannot read or write internal publication storage | 27 executed role probes returning `42501` for every read, write and function call of `anon` and `authenticated`, inside explicit transactions; and again over real HTTPS with each role's own key |
| 11 | client-visible reads contain no internal audit field | `read_canonical_publication` answered with exactly three keys — `version`, `publishedAt`, `renderModel` — and none of the fifteen internal fields; a read scoped to another tenant answered with nothing |
| 12 | restoration creates a new draft revision and preserves every snapshot | the draft moved by one, the pointer did not move, every snapshot digest was unchanged, a `restored` event was appended, a replay wrote nothing, a stale expectation was `55000`, no reason was `22023`, and another study's snapshot was `42501` |
| 13 | rollback removes only the new canonical objects | no publication object survived; the canonical DRAFT storage and its rows survived; the legacy publication model survived; and the draft save function still worked afterwards |
| 14 | legacy rows remain byte-identical | the fingerprint over both planted legacy drafts was identical before, throughout and after the rollback |

ⓘ **`55000` reaches `supabase-js` as `error.code` verbatim**, and the error
message quotes no part of the document that was refused. Migration `0024` paid
once for assuming a SQLSTATE survives a transport; this is that lesson executed
rather than remembered.

#### Real-route browser QA: PASSED, 111/111 — against a DISPOSABLE target

The thing under test IS a write, and the write it makes is the one a client
would be served, so the whole target is disposable: a throwaway PostgreSQL on a
unix socket, a real PostgREST, a minimal authentication substitute so the
product's own `/login` works, a synthetic canonical package committed through the
product's own commit flow for three studies, and a production build of the app
pointed at all of it.

What the run drives, rather than photographs:

- **Authorization precedes everything.** Without a session the review answers
  `/login`, and no publication control is rendered to a stranger.
- **A study with nothing saved** is told exactly that, told why, and sent to
  Construcción.
- **A review WITH BLOCKERS** — a draft bound to a package that is not this study's
  — lists the reason in Spanish, draws NO client preview, and does not render the
  publish control at all. No code appears on the screen.
- **A healthy review** names the exact draft revision, counts its pages, blocks
  and the blocks a client would see, draws the client-visible preview, lists the
  inventory, and keeps warnings in their own section apart from blockers.
- **The publish control stays unusable until it is earned**, driven with a REAL
  keyboard: each acknowledgement takes focus and is ticked with `Space`, and the
  control stays `disabled` until the final confirmation is ticked too. It is a
  native `<button>` with a real `disabled` property, so a keyboard skips it.
- **Publishing happens once**, and the database agrees: one version, one pointer,
  one event.
- **Pressing publish again REPLAYS** and does not publish twice.
- **A reload** shows which version the client sees, the history, and a difference
  section saying the structure is identical.
- **Editing the draft afterwards changes nothing the client is served** — the
  draft moved to revision 2 and the served bytes were identical.
- **Publishing a later version** replaces the first and keeps it; the history
  lists both and marks only the newer one as the one being served.
- **Restoring version 1** created a NEW draft revision, moved no pointer, left
  both snapshots, and left the served bytes unchanged. The screen says all three
  of those things before it asks for a reason.
- **A conflict** — somebody saved the draft while the screen was open — is
  reported, publishes nothing, and tells the operator to look again.
- **Desktop (1440), tablet (768) and phone (390)**: the document never overflows
  horizontally and every chrome control measures at least 44 **layout** pixels.
- **Nothing internal reached the browser**: no service key, no password, no
  protected table name, no RPC name, no 64-character digest anywhere in the
  document, and — inside the review's own subtree — no uuid of any kind.
- **The legacy draft is byte-identical** and the legacy publication model was
  never written: `0|0|0`.

**Two observations, reported and NOT asserted.** Two inline links in the shared
Studio shell — the skip link and the client's name inside a sentence — measure 16
and 18 px. Neither is a tap target in the sense the 44 px rule is about, this
unit changed neither, and holding prose to a touch target would be unrelated
visual debt dressed as a finding. Two controls inside the rendered client preview
measure under 44 px at tablet; they are the drawing, not this application's
chrome.

#### Hosted access: ONE read-only pass, 45/45, before and after

Every request was a `select`. The gate gained a section that pins the OPPOSITE of
what `0029`'s section pins: `canonical_presentation_revision`,
`canonical_presentation_publication` and
`canonical_presentation_publication_event` must be ABSENT, and
`publish_canonical_presentation`, `restore_canonical_presentation` and
`read_canonical_publication` must not be callable — all six answered `PGRST205` /
`PGRST202`. It is written now, in the same run that records their absence, rather
than at activation time: a check that has never been seen to fail is a check
nobody has tested. **When the hosted activation happens, invert it rather than
deleting it**, exactly as Unit 6B.3B inverted `0029`'s.

> ⚠️ **That is what Unit 6B.4B1 did on 2026-09-09**, and the check earned its
> keep on the way: run once immediately after the migration was applied, it
> failed all six of those assertions and nothing else, which is the only way to
> learn that a check nobody has seen fail actually works. It now asserts the
> mirror — the tables must EXIST and the functions be exposed — **and, newly,
> that all three tables hold ZERO rows**, because applying the storage and
> publishing into it are different acts and only the first has happened.

Everything else was as the previous unit left it: Cuicuilco's legacy draft at
**schema version 2, revision 72**, P6E's at **3, revision 14**, neither at schema
version 4, `study_experience_event` at 86 rows, `study_experience_revision` and
`study_experience_publication` empty, `0029`'s storage holding exactly ONE
canonical draft — Cuicuilco's, at revision 1, digest `511d7f54…`, binding
`cf63bdca…`, under one `draft_created` event — no other study carrying one, and
all eleven protected table counts identical (study 5, respondent 82,
quant_response 3 364, qual_observation 33, study_participant 60, survey_response
1 685, performance_observation 252, metric_definition 116, pain_point 50,
import_job 1, import_job_record 3 559).

#### Gates

- `npm run test:canonical-publication` — **NEW, 167 checks, in `npm test`.** Every
  blocker by name, the acknowledgement rules, the no-threshold proof over the
  REAL resolved model, the inventory and difference speaking only in authored
  titles, the route's authorization order, the RPC allowlist, the payload having
  no field for anything internal, and the publish control's exact condition.
- `npm run test:canonical-publication-live` — **NEW, 188 assertions, outside
  `npm test`** because it needs a cluster.
- `npm run test:canonical-publication-audit` — **NEW, 60 assertions, outside
  `npm test`.** The audit above, re-runnable: it asserts facts about `0023`-`0025`
  and `0029` as they are, so a later change that invalidated a finding fails here.
- `npm run qa:canonical-publication` — **NEW, 111 checks**, the browser QA above.
- `test:migration-chain` gained the fifth canonical migration and a block of
  rules for it: exactly three tables and four functions, no legacy object in its
  executable SQL, each callable function `SECURITY DEFINER` with an empty
  `search_path` asserted of THAT function rather than of the file, schema version
  four by equality, a family discriminator, the render model and its digest, the
  nine identity columns, and the conditional delete refusal.
- `shadow-boundary` gained the third door and the second approved action, both by
  name, and a correction described below.
- `studio-completion` learned the new reader, so its authorization-order
  assertion BINDS for the new route rather than falling through to its own
  vacuous-pass guard.
- Unchanged and green: `canonical-presentation` 314, `canonical-presentation-persistence`,
  `canonical-composer`, `canonical-viewer-filters`, `canonical-results`,
  `canonical-database-source`, `shadow-boundary` 96, `studio-completion` 49,
  `p8-acceptance` 57.
- **Both parity gates were RE-RUN against the real workbooks, not asserted.**
  `canonical-results-parity`: 534 offered, **531 executed, 531 passed**, 0 failed,
  0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required.
  `canonical-presentation-parity`: **59 checks, 59 passed**. Neither number moved.
  Source digests: `8d7afdb4…` and `bd0e70d7…`.

#### Verification, gate by gate

| gate | result |
|---|---|
| `typecheck` | clean |
| `lint` | **0 errors, 54 warnings** — the recorded baseline. One error was introduced and fixed: a `useMemo`'d `Map` was being mutated, which `react-hooks/immutability` correctly refuses; it is a `useRef` now, because the mutation is the point |
| `npm test` | the whole offline chain, green up to the documented known-red, and **every one of the 30 gates after it run individually and green** so a single red gate could not hide them |
| `build` | exit 0 |
| `cf:build` | exit 0, `.open-next/worker.js` written |
| `test:canonical-results-parity` | 534 offered, **531 executed, 531 passed**, 0 failed, 0 skipped, 2 not-applicable, 1 configuration-required |
| `test:canonical-presentation-parity` | **59 checks, 59 passed** |
| `test:canonical-publication` | 167 checks |
| `test:canonical-publication-live` | 188 assertions, 0 skipped |
| `test:canonical-publication-audit` | 60 assertions |
| `qa:canonical-publication` | 111 checks |
| `test:canonical-presentation-hosted-fingerprint` | 45/45 before, **48/48 after** — the three extra are the API-description control and its two companions |

**Known-red, and it was re-measured rather than assumed.**
`test:hosted-target-guard` fails on exactly one assertion — *«the refusal names
the main-repository rule, so the worktree rule did not answer for it»* — with 174
checks passing. The SAME single assertion fails identically on the baseline
commit `ebc2c3e`, with the same 174: the verifier is a plain clone rather than a
worktree, which is a property of the environment and not of this unit.

**Suite D: 16 passed, 15 failed, and three of those failures are this unit's.**
Reporting it as unchanged would have been the easy and wrong answer. The counts
on `ebc2c3e` and on this branch are identical — but only because the verifier's
object store already contains this unit's commits, and Suite D scans every
reachable blob rather than the checked-out tree. The honest breakdown is:

- **seven blocking advisories** (`next` critical; `@opennextjs/cloudflare`,
  `browserslist`, `js-yaml`, `miniflare`, `sharp`, `wrangler` high) — none
  introduced here, no dependency was added, changed or pinned differently;
- **seven `assigned-secret-env` blobs**, of which **three are
  `scripts/canonical-publication-qa.mjs`** — one per commit of that file;
- **one** consequent `secret-leak gate failed (exit 2)`.

ⓘ **The three are a FALSE POSITIVE of a pattern whose own description says
otherwise, and the pattern was deliberately NOT changed.** The rule is *"a
secret-bearing environment variable bound to a LITERAL value"*, and it matches
`SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey` — an identifier reference sixteen
characters long, holding a key minted at runtime for a throwaway PostgREST that
dies with the run. The sibling file `canonical-presentation-draft-qa.mjs`
contributes the same finding from the same line and has since Unit 6B.3A, and
`canonical-shadow-runtime-rehearsal.mjs` since earlier still.

Two fixes were available and both were refused. Renaming the local so the match
does not fire would be writing worse code to satisfy a pattern, which this
repository has explicitly declined to do before. Narrowing the pattern to require
an actual literal would be the RIGHT fix — it is what the description already
claims — but `scripts/lib/secret-patterns.mjs` is security configuration, a
declared human-review zone, and narrowing a secret detector is not a change to
make unilaterally inside a publication unit. **It is recommended as a separate,
human-reviewed item**, and until then the three findings stand and are named
here rather than absorbed into a total.

⚠️ **The claim "Suite D reports its documented five" is stale** and was true when
written. The count has grown with published advisories; the real figure at the
end of this unit is fifteen, broken down above.

#### Discrimination: eleven mutations, eleven failures, every file restored

A gate that passes is not evidence until it has been made to fail for the reason
it claims to guard. Each mutation below broke exactly one property, ran the gate
that owns it, and required a FAILURE line to name that property. Every file was
digested before and after and restored with git; the worktree was clean at the
end.

| # | the mutation | the gate that caught it |
|---|---|---|
| 1 | the snapshot loses its family discriminator | `migration-chain` |
| 2 | the snapshot column admits a RANGE of schema versions | `migration-chain` |
| 3 | the immutability trigger stops covering DELETE | `migration-chain` |
| 4 | the publication tables get every privilege instead of SELECT | `migration-chain` |
| 5 | «espera contenido» becomes a blocker instead of a warning | `canonical-publication` |
| 6 | a blocker can be acknowledged away | `canonical-publication` |
| 7 | a threshold appears in the preflight | `canonical-publication` |
| 8 | the publish control stops depending on the blockers | `canonical-publication` |
| 9 | the review payload grows a field for a digest | `canonical-publication` |
| 10 | the publication module takes its own DIRECT canonical import | `shadow-boundary` |
| 11 | a legacy experience table is named on the publication route | `canonical-publication` |

**Two of the discrimination tests were wrong first, and both taught something.**
Mutation 2 matched a PASSING assertion about a different migration, so the gate
failed for the right reason and the test said so for the wrong one — the matcher
now looks only at failure lines. And mutation 10 originally imported
`@/lib/viewer` into the publication module and the door check did NOT fire:
that module reaches the canonical layer two hops down while the declared loader
reaches it in one, so a breadth-first walk still finds the loader's path first.
**The comment claiming a second import would flip the door was corrected rather
than the test weakened**, and the mutation now takes a DIRECT canonical import,
which is what the rule is actually about and which the door row refuses by name.

#### Defects this unit found in its own work, before and during review

1. **The audit's own three assertions were wrong first.** PostgreSQL normalises
   `between 1 and 1000` into two comparisons before storing a constraint, so a
   pattern looking for the word `between` failed against a database doing exactly
   what the migration asked; and the drift probe published a revision of the
   wrong study, so it succeeded where a refusal was expected. Both corrected
   before any finding was acted on.
2. **The preflight's first union carried four unreachable codes and a dead
   loop** — recorded above.
3. **The boundary gate compared an absolute path against a relative one.**
   `@/lib/x` resolved to `src/lib/x.ts` and `./x` to `/home/…/src/lib/x.ts`,
   because `resolve()` makes a relative specifier absolute against the working
   directory — and every path in that gate is compared as a STRING. It was
   invisible while every chain that mattered used `@/`, and it surfaced the first
   time a declared loader was reached through a relative import: the door was
   reported as skipping the loader that was three entries earlier in its own
   path. Normalising fixes the comparison everywhere at once.
4. **The rollback dropped a trigger function before the table that owns it.**
   Two tables share `refuse_canonical_publication_change`, so it may only be
   dropped after BOTH are gone; PostgreSQL refused with `2BP01`. `drop … cascade`
   would have hidden that rather than fixed it.
5. **The publish function checked the pointer AFTER writing the snapshot.**
   The transaction would have rolled the row back anyway, which is exactly why it
   was worth reordering: a function that writes and then discovers it should not
   have is one refactor away from a function that writes and forgets to check.
6. ⓘ **A GENUINE RETRY COULD NEVER REACH THE DATABASE'S REPLAY BRANCH — the one
   real product defect, found by the browser QA.** Pressing publish twice, which
   is what a person does when a response does not come back, produced a CONFLICT
   after a publication that had succeeded: the server ran the preflight first,
   saw the pointer it had itself just moved, and raised
   `publication_pointer_moved`. Nothing ever got as far as the RPC, whose replay
   branch exists precisely for this. The idempotency ledger is now consulted
   before anything is re-judged — the order the RPC already used and the product
   did not. The ledger remains the authority: that read is not taken under the
   study's advisory lock, and the RPC's own replay branch, which is, still
   catches two simultaneous retries.
7. **Three defects in the QA harness itself.** It clicked a checkbox before React
   had hydrated, so the DOM toggled and no state changed — invisible in the
   section that used a real keyboard, because a focus round trip per control is
   slow enough to land after hydration. It measured the 16 px checkbox instead of
   the 44 px label wrapped around it, which would have been "fixed" by making a
   checkbox 44 px tall. And it scanned the whole document for a uuid, which can
   never pass on a Studio page: the study id is in the address bar and in every
   tab's href. All three are corrected in the harness, not in the product.
8. **The empty-study case tested the wrong sentence.** The study meant to prove
   «nothing saved» had no canonical package either, so the assertion was made
   against the «no package» sentence and could only fail. The state under test is
   now built rather than assumed.

#### Still deferred, and deliberately so

Migration `0030` is applied to no database. No publication was created on the
hosted project; Cuicuilco and P6E were not published; nothing was deployed; the
production client route was not switched; no public interactive filter was
exposed; PDF export was not touched; no legacy draft was converted; no formula or
approved value moved; no AI was added; and shadow mode is still off everywhere.
`main` is unchanged.

---

### Unit 6B.4B2C — the journey-pain editorial workflow, and the sign-off boundary closed (source only, 2026-09-09)

> **NOTHING WAS PUBLISHED, AND NOTHING HOSTED WAS WRITTEN.** Hosted access in
> this unit was READ-ONLY: the fingerprint gate before and after, and one
> read-only decision inventory over the fifty real `pain_point` rows. Migrations
> `0031` and `0032` are authored here and, **when this unit ran, neither had
> been applied anywhere** — both were applied on 2026-09-14, with their storage
> left empty; see §"Unit 6B.4B2D". The Cuicuilco canonical draft was at
> **revision 1** while this unit ran — Unit 6B.4B2E rebound it to revision 2 on
> 2026-09-14 — and all three publication tables are still **empty**.

Two decisions, and the second is most of the unit.

#### 1. The qualitative sign-off sends no digest, and the boundary rule has no
   exception again

Unit 6B.4B2 put `qualitativeEvidenceDigest` on the review payload and had the
browser echo it back to record a sign-off. The argument for it was that the
digest covers only category labels a client is already shown, so it discloses
nothing — which is true, and is not the point:

* a record written against a value the CALLER supplied has a subject the caller
  chose. «The server recomputes and compares» does not fix that; it compares the
  browser's memory with itself;
* and the browser-boundary assertion had to be NARROWED to admit it — from
  «no 64-character hex value crosses» to «at most one, and not one of these
  three». A rule with an exception is a rule with somewhere to hide a second
  one.

**What replaces it.** `recordCanonicalQualitativeSignOff(studyId,
reviewedDraftRevision, groupTokens)`. There is no digest parameter, no digest
field on `QualitativeReviewPanel`, and no digest anywhere on the wire. The
authorized action:

1. reloads the stored canonical draft and the study's current canonical results,
   rebuilds the registry and resolves the document;
2. computes `qualitativeEvidenceDigest` **server-side** from what it just read;
3. verifies the **revision** (`draft_moved` if it moved), the **study** (the
   tenant is read from the study row and never received), the **binding** (a
   document that no longer resolves is refused), and **evidence freshness**;
4. records the sign-off against **that** digest.

Freshness is proved by an opaque per-group identity — `qualitativeGroupToken`,
five bytes of a domain-separated hash, spelled in base32. It moves when the
group's label, coding or category list moves; the server mints the same tokens
from its own read and compares the sets; and nothing derived from a submitted
token is stored, compared against storage, or written into a publication record.
The alphabet contains `w`, `x`, `y` and `z`, so no token of any length can match
`[0-9a-f]{64}`.

**The assertion is restored and is stronger than the one it replaces.** §[16] of
`qa:canonical-publication` now requires **zero** distinct 64-hex values in the
rendered page, AND that the definition digest, the binding fingerprint and the
render-model digest — read from the database, by value — are absent. The old
blanket rule checked a shape; this checks the shape and the values.

#### 2. A real human pain-mapping workflow, because the mapping is unprovable

`/studio/e/[studyId]/revision/dolor` — inside the publication review's own route
segment, using that route's own `actions.ts`, behind the same `requireInternal()`
guard. It adds a fourth DOOR and no third loader.

**What is loaded for review.** The curated phrase (`normalized_text`), the stage
wording the source gave it, how many source items carry that phrase, the current
disposition, an opaque item token, and a short opaque source-version marker.

**What has no field to be loaded.** A respondent, a respondent identifier, a
survey comment, an adjacent free-text answer, a name — and the SHA-256 source
digest itself. `pain_point` carries no respondent column in any shape: its
provenance is a workbook cell through `visual_annotation`. So «no PII crosses» is
a fact about which tables are read rather than a redaction somebody has to
remember. `raw_text` is not selected either; `normalized_text` is the same
sentence with its whitespace regularised, and putting two spellings of one phrase
in front of a person deciding which is «the» phrase helps nobody.

**What a reviewer may do,** per item: approve the public phrase; EDIT it without
touching the source; reject it with a reason; map an approved phrase to one or
more canonical touchpoints; or deliberately mark it unresolved — which is a
different fact from nobody having looked, and is stored as one.

**Nothing preselects a match.** Not string similarity, not normalized labels, not
position, not workbook order, and not the approved demo's 38-entry alias table.
The whole touchpoint list is shown, grouped under the five visible routes, in the
order the client's page draws them. There is a neutral search box; it filters a
list already on screen, by what the reviewer types, and it starts empty and is
never pre-filled from the source phrase — a search box that typed the source's
words into itself would be a proposal wearing a filter's clothes.

**One-to-many is the normal case.** «Reunión semanal presencial/en línea» is one
curated stage over two touchpoints, so the control is checkboxes rather than a
select, and the storage is an array rather than a column.

**Where the decisions live.** `canonical_journey_pain_decision`, migration
`0032` — not yet applied anywhere when this unit ran, applied on 2026-09-14 and
still holding zero rows. Append-only; newest row per item is the decision
in force. It identifies its source item by an OPAQUE TOKEN and holds **no foreign
key into `pain_point`** — so «the canonical source is not mutated» is a
structural fact rather than an abstention, and a re-import that mints different
rows moves every token, reopening the review visibly rather than re-attaching an
approval to a phrase nobody read.

#### The completion rule, and why it cannot be acknowledged away

`authoredPainContent` returns **null** unless all five hold:

| condition | code when it fails |
|---|---|
| every in-scope item has an explicit disposition | `undecided_items` |
| every approved item has a public phrase | `approved_without_phrase` |
| every approved item is mapped to ≥ 1 touchpoint | `approved_without_touchpoint` |
| the source digest still matches | `stale_source` |
| no mapping targets a missing touchpoint | `unknown_touchpoint` |

So a partial review cannot produce a partial cloud — there is no best-effort
branch. `journey_pain_review_incomplete` is its own blocker, separate from
`required_content_missing` because it names WHICH of the five is unfinished and
each is a different action by a different person, and it is raised only when the
document's author marked the slot required.

A stale source digest reopens the review by demoting that item to `unreviewed`
and saying why, rather than by silently keeping an approval attached to words
that changed.

#### What the client gets after a complete review

1. the «Puntos de dolor del recorrido» word cloud, resolved from the editorial
   slot — the block's drawing follows its PAYLOAD SHAPE, so the slot resolves as
   `word_cloud` when it carries terms and stays `narrative` when it carries
   prose;
2. a badge on every mapped touchpoint, with the approved phrases in the reviewer's
   own order, in the SVG node and in its accessible name;
3. counts made on the server. **One phrase mapped to three points contributes ONE
   to the cloud total** and appears on all three — counting it per point would
   inflate the headline figure by a reviewer's mapping decision;
4. no raw source text and no review metadata in the render model: there is no
   field for a token, a disposition, a source status, a rationale or a digest.

Terms carry `share: null` deliberately. A share is a proportion of a measured
base, and these phrases are editorial content approved by a consultant — no
population said them, and printing `count / total` as a percentage would spell an
opinion as a statistic.

#### What was executed, and what each number is

Every figure below was produced on 2026-09-09 in the WSL verifier
(`/home/patop/becommunity-software`, Node 24.11.1, npm 10.9.2). Windows was used
for editing only.

| gate | result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 55 warnings (the standing baseline) |
| `npm test` (the whole offline chain) | every gate green except the one below |
| `npm run test:journey-pain-review` (**new**, in `npm test`) | **261 checks, 261 passed** |
| `npm run test:canonical-journey-pain-live` (**new**, disposable PG 17) | **68 checks, 68 passed** |
| `npm run test:canonical-qualitative-signoff-live` | 0 failures |
| `npm run test:canonical-publication-live` | 0 failures |
| `npm run test:canonical-presentation-draft-live` | 0 failures |
| `npm run qa:canonical-publication` (real browser, disposable target) | **213 checks, 213 passed** |
| `canonical-results-parity` against the real workbooks | **531 / 531**, unchanged |
| `canonical-presentation-parity` against the real workbooks | **59 / 59**, unchanged |

**`npm run test:hosted-target-guard` §[8] fails in the WSL verifier and always
has.** It builds `<root>/../becommunity-software/evidence` expecting a sibling
main repository, and the WSL checkout is a plain clone AT that path. It was
re-run at the baseline commit `d6a3d3c` in a throwaway worktree and failed there
too (two assertions rather than one), so it is an environment artifact of the
verifier's layout and not a regression of this unit.

**Two parity numbers are preserved and one expectation is new.** The 531 and the
59 are the *unconfigured* approved draft — no pain content is authored for the
real study, so the approved blueprint resolves exactly as it did. The
*intentionally configured* synthetic presentation has its own expectations, in
§[12] of the new offline gate and §[19] of the browser QA: the slot resolves as
`word_cloud` carrying terms, the mapped touchpoints carry badges, and the same
model with no authored content resolves to `configuration_required` and no badge.

#### What the browser proved, in a real browser, against a disposable target

The filter proof is no longer an observation. The disposable fixture carries a
real filter panel now — `buildGenericStartingBlueprint` composes one, offering
the characteristics every filterable block on the page has in common and
connecting exactly those blocks — so §[18] asserts rather than reports:

* the review's «los ve el cliente» count IS the number of cards drawn (21 = 21),
  and the inventory marks exactly as many;
* the inventory counts exactly the panels the preview draws;
* 57 filter options across 17 characteristics, every one of them operable;
* a real click recomputes on the server («Todas las personas · 60» → «Cohorte:
  Miembros activos · quedan 28 de 60»);
* **18 connected cards changed and 1 unconnected card did not** — the retention
  series, which declares no supported filter because it is measured over a
  period's roster;
* clearing restores the exact neutral model: the same 19 titled cards, every one
  of them saying exactly what it said before;
* a reload comes back neutral, so the selection was never stored;
* and the draft revision, the publication event count and the sign-off count are
  all unchanged after every one of those.

And §[19] drives the whole pain workflow through the real route: 13 phrases in
the queue, each with an opaque identity and no digest, no uuid and no canonical
table name anywhere on the screen; 55 touchpoints offered across 4 routes with
**not one preselected** and the search box empty; an approval refused for having
no touchpoint; a one-to-many approval recorded against two points; an exclusion
with its reason; every remaining phrase decided; the cloud then drawn in the
client preview with the approved wording and **not** the source's own; a badge on
a mapped touchpoint; keyboard focus and 44-layout-pixel targets on every control;
a 390 px phone composing inside its width; and then the source words moved in
SQL — 13 items marked as changed, every decision back to «sin revisar», the cloud
gone from the preview, and **not one decision row deleted**.

`pain_point` ends the run with 43 rows, all `pending`, nobody recorded as having
reviewed one.

#### Hosted access was READ-ONLY, and the before and after are identical

`npm run test:canonical-presentation-hosted-fingerprint` was run before and after
— **65 checks, 65 passed** both times — and the two fingerprint files are
byte-identical apart from their timestamps. It gained a section that pinned
`0031` and `0032` as NOT applied: the three tables absent, the five functions
unexposed, with a control read first so an absence is known to mean absence.
(That section was INVERTED, not deleted, on 2026-09-14 when both migrations were
applied — it is now `[3c]` and requires the same objects to EXIST and their three
tables to be EMPTY. See §"Unit 6B.4B2D".)

| fact | before | after |
|---|---|---|
| `canonical_presentation_revision` / `_publication` / `_publication_event` | 0 / 0 / 0 | 0 / 0 / 0 |
| Cuicuilco canonical draft | revision 1, one `draft_created` | revision 1, one `draft_created` |
| `canonical_qualitative_signoff` (0031) | absent | absent |
| `canonical_journey_pain_decision` (0032) | absent | absent |
| `study_experience_event` | 86 | 86 |
| `study_experience_revision` / `_publication` | 0 / 0 | 0 / 0 |
| `pain_point` | 50 | 50 |
| `quant_response` / `survey_response` / `qual_observation` | 3364 / 1685 / 33 | 3364 / 1685 / 33 |

The only other hosted contact was the decision inventory, which is `select`-only
and writes outside every checkout.

#### The real study's decision inventory

`npm run journey-pain-inventory -- <clean.xlsx> <curated.xlsx>` produced it,
read-only, into `~/becommunity-evidence/6b4b2c/` — outside every git repository,
because it carries a real client's curated prose and that does not enter this
repository. It refuses to run if `CANONICAL_HOSTED_EVIDENCE` names a path inside
a checkout.

* **all 50 real `pain_point` rows**, in the source's own order, with the wording
  their own curated entity gave them: **15 journey**, 8 organizational, 7
  performance, 20 culture — the same four counts the read-only audit measured;
* the 15 journey ones are marked in scope and the other 35 are marked out of it,
  so «out of scope» cannot be misread as «missing»;
* every row's status is `pending`, which is what the hosted table holds;
* 46 distinct phrases across the 50 rows, with an occurrence count per phrase;
* a second sheet of the **55 touchpoints across 5 visible routes** a reviewer may
  choose from, derived from the two real workbooks through the product's own
  registry and approved blueprint — the same list the Studio editor offers;
* and **all four decision columns are empty in all 50 rows**, verified by reading
  the file back. Nothing proposes a touchpoint, a wording or a verdict.

#### Consequences that must be stated

* **Neither `0032` nor `0031` had been applied anywhere when this unit ran.**
  Until they were, the sign-off could not be recorded and the pain review could
  not be authored, and both reads failed closed — reported as «nobody has
  reviewed this», the safe direction. Both were applied on 2026-09-14 (§"Unit
  6B.4B2D"); the storage now exists and is empty, so the reads still fail closed
  and the statement is still true for the reason that matters.
* **The Cuicuilco draft's binding still will not match**, for the reason Unit
  6B.4B2 records: the results contract moved to `3.0.0` and the contract version
  is inside `presentationBindingFingerprint`. That is the designed refusal and
  this unit did not touch the hosted draft.
* **The real fifty rows are still all `pending` and still unmapped.** This unit
  built the surface and produced an external decision inventory; it filled in
  nothing. The mapping is a person's work and remains to be done.

### Unit 6B.4B2 — publication-readiness corrections (source only, 2026-09-09)

> **NOTHING WAS PUBLISHED, AND NOTHING HOSTED WAS WRITTEN.** Hosted access in
> this unit was READ-ONLY: the fingerprint gate before and after, and one
> read-only pain-point audit. Migration `0031` is authored here and **had not
> been applied anywhere when this unit ran** — it was applied on 2026-09-14,
> with its storage left empty; see §"Unit 6B.4B2D". The Cuicuilco canonical
> draft was at **revision 1** while this unit ran — Unit 6B.4B2E rebound it to
> revision 2 on 2026-09-14 — and all three publication tables are still
> **empty**.

The snapshot Unit 6B.4B1 left was mechanically publishable and materially
different from the approved north-star. Six corrections, each traceable to a
defect that was measured rather than suspected.

#### 1. The review preview and its inventory disagreed, and both were consistent

The screen reported «23 bloques los ve el cliente» over a preview that drew
**20**. Three filter panels: the inventory counted them, the renderer dropped
them. Neither half was wrong about itself — the renderer drops a panel on a
surface it was not handed viewer controls for, because a control that will work
later is an unfinished edge and C11 keeps those off a client's page; the
inventory had never been told which surface it was describing.

There were TWO more disagreements underneath, found by unifying them:

| block | renderer | old inventory / preflight |
|---|---|---|
| filter panel, no viewer controls | not drawn | counted as visible |
| `value` payload holding `null` | not drawn | preflight counted it visible |
| stated absence (`unavailable` / `unresolved`) | draws the sentence | both called it invisible |

`src/lib/presentation/visibility.ts` now holds the ONE predicate —
`clientSeesBlock`, `clientHasContent`, `clientSeesPage`,
`filterPanelIsOperable`, `sampleVisibleNote`. The renderer, `FilterControls`,
`src/lib/publication/inventory.ts` and `src/lib/publication/preflight.ts` all
import it, and §[13] of the offline gate reads those four files and refuses a
private copy.

**The equality is asserted at DOM level, not only at model level.** The gate
renders the real `PresentationRenderer` with `react-dom/server` at
`audience="client"` and counts the cards in the markup, on both surfaces, over
the real resolved model AND over a hand-built document carrying one operable
panel and one nobody connected: 2 drawn and 2 counted live, 1 and 1 dead.

#### 2. The preview is now the client's screen, filters and all

A third Server Action, `previewPublicationUnderSelection`, resolves the STORED
draft under a reviewer's own selection and returns a render model and a count.

* it **writes nothing** — no insert, update, upsert, delete, RPC or
  `revalidatePath`, asserted over the extracted function body as well as over
  the action file;
* the selection is **ephemeral**: browser state, ordinal tokens on the wire,
  gone when the screen closes;
* **publishing ignores it entirely** — `publishStoredPresentation` still
  resolves under `EMPTY_VIEWER_SELECTION`, so what is snapshot is the unfiltered
  document whatever was ticked.

`CLIENT_SURFACE_IS_LIVE` is declared once, in the publication contract, and used
by the count and by the mount.

#### 3. The false permanent «pending» is gone

`QualitativeGroupResult.reviewStatus` was the literal `'pending'`, written on
every group of every study for ever. The preflight read it as «nadie del equipo
las ha revisado», so the warning appeared on every review, could never be
cleared, and named two GROUP labels while **three** blocks of the approved
layout draw those categories — «Razones declaradas de riesgo» binds the same
active group as «Miembros activos».

* the field is **removed**; results contract **2.2.0 → 3.0.0** (a major, because
  a field went);
* `coding` (`source_coded` / `be_community_curated`) replaces it with what that
  layer can actually know;
* `CuratedFindingCount.reviewStatus` is untouched — a real column on
  `pain_point`, and all fifty of Cuicuilco's are `pending`;
* the review state moved to the publication boundary, tied to
  `qualitativeEvidenceDigest` over each bound group's label, coding and ordered
  category and excluded labels — and never a COUNT, because another person
  choosing an existing category changes no word anybody read;
* four states — `not_applicable`, `pending`, `stale`, `current` — and `pending`
  and `stale` get **separate sentences**, because «nobody read these» and «what
  you approved is not what is here» need different people to do different
  things;
* the warning names every **visible block**, from the resolved model, so
  «Razones declaradas de riesgo» is named;
* the review screen carries the words themselves, the blocks that draw them, the
  coding, and one control that records the sign-off. Nothing but closed-coded
  labels crosses: there is no field anywhere on the path for a quotation, a name
  or a respondent's words.

`0031_canonical_qualitative_signoff.sql` stores it, and **had not been applied
anywhere when this unit ran** (applied 2026-09-14, storage still empty — see
§"Unit 6B.4B2D"). It WRAPS `publish_canonical_presentation` rather than replacing it —
`publish_canonical_presentation_with_qualitative` calls it and writes the record
in the same transaction — so 295 lines of applied history stay byte-identical
and a publication without a qualitative record cannot exist.

#### 4. The journey pain mapping: audited, and NOT provable

Audited in the order the phase requires. **Hosted, read-only, 2026-09-09:**

| fact | value |
|---|---|
| `pain_point` rows for Cuicuilco | 50, **all `review_status = pending`** |
| `pain_point_journey_stage` | 15 |
| `pain_point_organizational_unit` | 8 |
| `pain_point_performance_dimension` | 7 |
| `pain_point_culture_dimension` | 20 |
| `journey_stage` | 18 |
| `journey_stage_evidence_link` | **0** |
| `survey_item` inside a domain | 55 (29 / 6 / 10 / 10) |

**No canonical configuration relates a curated stage to a touchpoint.** The
evidence-link table is empty, which is exactly what the contract's
`journey_stage_evidence` requirement says it will be until a configuration
declares one.

**Label identity is not an authority, and the numbers say why.** Of the 18
curated stage labels:

* **0** match a canonical `survey_item.label` — that column holds the FULL
  survey prompt (`clampLabel(header, …)` in the projector);
* **6** match the CSAT sheet's short label row;
* **5** match the bracketed text inside the prompt.

Three defensible readings, three different answers. Beyond that, «Reunión
semanal presencial/en línea» is ONE stage covering TWO touchpoints, and «BNI
Connect» is ambiguous between «Plataforma BNI Connect (versión web)» and «App
BNI Connect (celular)» while «App celular» names that same app.

The approved demo resolves all of it with a **38-entry hand-written alias
table** plus a sheet→domain table, and its cloud additionally depends on a
phrase-splitting rule (`split(/[\n.]+/)`). Both are implementation, not
authority, and neither is copied.

**Conclusion: every one of the 15 journey pain points requires a human
decision.** The precise unresolved mappings are listed under "Human decisions
still required" below.

#### 5. Filter options: whitespace grouping, and granularity the operator owns

The approved study's «Giro» column (active profile) holds **four** pairs
differing only by a trailing space — «Eventos y Servicios a Negocios»,
«Capacitación y Coaching», «Servicios Inmobiliarios», «Construcción» — and
«Tipo de empresa» holds one, «B2B». Sixteen options where twelve answers exist;
a reader picking «Construcción» saw one of the three people who gave it.

* `FilterValue` gains `rawValues`: every canonical raw spelling, preserved;
* options group by the answer with its **outer** whitespace removed, and
  nothing differing by an internal character is ever merged;
* `applyFilters` matches any spelling in the group, and keeps the raw sets **per
  constraint** — merging them per dimension turned two panels' AND into an OR,
  which `test:canonical-viewer-filters` caught;
* a whitespace-ONLY answer groups with nothing and keeps its own raw form.

**Nothing is hidden automatically.** `granular_filter_dimensions` states which
characteristics offer an option only ONE person carries — a group of one, not a
chosen cut-off — and how many such options each has. It never names the option
itself: «Giro: Notaría (1 persona)» on a review screen is naming the person. No
count moves, `show_all` stays the default, and the operator removes the
characteristic in Construcción or says they are keeping it.
`inoperable_filter_panels` is its sibling for a panel no block is connected to.

#### 6. Small correctness

* «confirmaciónes» → «confirmaciones». Spanish drops the accent when the stress
  stops falling on the last syllable, so a plural is not the singular plus «es»;
  the old code built it that way and printed a misspelling on the one line that
  tells an operator what is missing.
* Every new warning's sentence names the CONSEQUENCE — «el cliente no los
  recibe», «puede quedarse mirando las cifras de esa única persona» — rather
  than the mechanism.
* The pain-cloud omission is a **BLOCKER**. Blocks gain an authored
  `requiredContent`; the approved blueprint marks that slot with it; and
  `required_content_missing` cannot be acknowledged away. The two remedies —
  supply the content, or remove the block — are in the sentence, and both are
  proved to clear it. `configuration_required` stays a warning for every block
  nobody marked, so the standing rule is intact.

#### Human decisions still required — the precise unresolved mappings

**Every one of the fifteen journey pain points needs a person.** Three of the
eighteen curated stages carry no pain text at all («Bienvenida», «PEM»,
«Reunión semanal presencial/en línea»), so they need no decision.

The «candidate» column is the touchpoint a reader would GUESS at. It is printed
so a person has somewhere to start, and it is **not** a proposal: nothing in the
product acts on it, and the editor must make each one an explicit choice.

| # | curated stage (has a pain point) | candidate touchpoint | why it is not proof |
|---|---|---|---|
| 1 | Invitación a visitantes | Invitación a visitantes al capítulo | the labels differ |
| 2 | Selección | Proceso de selección de nuevos miembros | the labels differ |
| 3 | Onboarding | Proceso de Onboarding | the labels differ |
| 4 | Miércoles de capacitación | Miércoles de capacitación | **exact** in the bracketed prompt text — but see the note below |
| 5 | Eventos regionales | Eventos regionales | **exact** in the bracketed text; the workbook's own short label carries a trailing space |
| 6 | Chats de WA | Chats de Whats app | the labels differ |
| 7 | Proceso de controversias /quejas | Proceso para presentar quejas o controversias | the same words in another order |
| 8 | Entrevista de 7 meses | Entrevista de 7 meses | **exact** in the bracketed text |
| 9 | Renovación de membresía | Proceso de renovación de membresía | the labels differ |
| 10 | Proceso de salida | Proceso de salida | **exact** in the bracketed text |
| 11 | Despedida | Despedida del capítulo (mensaje en whatsapp cuando alguien sale) | the labels differ |
| 12 | BNI Connect | Plataforma BNI Connect (versión web) **or** App BNI Connect (celular) | **AMBIGUOUS between two touchpoints** |
| 13 | Reporting2You | Plataforma Reporting2You | the labels differ; the workbook's own short label misspells it «Reporting2Yoy» |
| 14 | Academy | Plataforma Academy | the labels differ |
| 15 | App celular | App BNI Connect (celular) | the labels differ, **and it collides with row 12's second candidate** |

**Why even the four exact matches are not proof.** «Exact» depends on which of
three vocabularies you compare against, and the three disagree: against the
canonical `survey_item.label` (the full survey prompt) **0 of 18** match;
against the workbook's short label row **6**; against the bracketed text inside
the prompt **5**. A rule that produces three different answers from three
defensible readings of the same sources is not an authority — it is a choice
about which reading to privilege, and that choice is a person's.

**And one stage covers two touchpoints.** «Reunión semanal presencial/en línea»
is a single curated stage over «Reunión semanal presencial» and «Reunión semanal
en línea». It carries no pain text, so it needs no decision today — but it is
proof that the relation is not one-to-one, and an editor that assumed it was
would be unable to express next year's study.

#### A second decision the mapping does not settle, and it is the larger one

**All fifty hosted `pain_point` rows are `review_status = 'pending'`.** Nobody
has reviewed any of them. So even a perfect stage-to-touchpoint mapping would
not deliver «Puntos de dolor del recorrido»: the cloud's content is the curated
PHRASES, those phrases are consultant prose nobody has cleared, and
`pain_point.raw_text` / `normalized_text` are deliberately not in the canonical
read model's row type at all — `docs/CANONICAL_RESULTS_MODEL.md` §12.

That splits the editor into two surfaces that need separate authorization:

1. **MAPPING** — curated entity to canonical touchpoint, stored as authored
   presentation configuration with provenance. This is additive to the
   presentation document and needs no new door.
2. **PHRASE REVIEW** — moving a `pain_point` from `pending` to `confirmed`, and
   widening the canonical read model to carry approved text. This is a WRITE
   from Studio into a canonical table and a widening of what may cross the
   client boundary. The architecture has no such door today, and opening one is
   not a decision this unit may make on its own.

**The blocker is therefore correct and load-bearing.** The approved blueprint
marks the pain-cloud slot `requiredContent`, `required_content_missing` cannot
be acknowledged away, and Cuicuilco is consequently unpublishable until a person
decides both questions. That is the product decision working, not an obstruction
to it.

#### Consequences that must be stated

* **The Cuicuilco canonical draft's binding will no longer match.** The results
  contract moved to `3.0.0`, and the contract version is inside
  `presentationBindingFingerprint`. The stored draft (binding `cf63bdca…`) will
  raise `binding_drift`, which is the designed refusal: it must be reopened in
  Construcción and re-bound. It is NOT a defect of this unit, and this unit did
  not touch the hosted draft.
* **Migration `0031` had not been applied anywhere when this unit ran.** Until
  it was, the sign-off could not be recorded and the read failed closed —
  reported as «nobody has reviewed these», the safe direction. It was applied on
  2026-09-14 (§"Unit 6B.4B2D") and its storage is still empty, so the read
  still fails closed.

### Unit 6B.4B1 — migration `0030` is applied to the hosted project, and NOTHING was published (EXECUTED, 2026-09-09)

**One hosted mutation was authorized and exactly one happened: migration `0030`
was applied.** The canonical publication storage now exists on
`ontvqazsqiwisdddblif` and **it is empty** — no immutable snapshot, no
current-publication pointer, no publication event, on any study. Applying the
storage and publishing into it are different acts; this phase authorized the
first and forbade the second, and the proof below is evidence rather than
assertion. No experience was published, prepared, restored or archived.

#### The migration, exactly

| | |
|---|---|
| project | ref `ontvqazsqiwisdddblif`, PostgreSQL **17.6** — named by ref, because `docs/OPERATIONS.md` and this document have called it two different things for weeks and only the ref is unambiguous |
| connection | **session** pooler, `aws-0-us-east-2.pooler.supabase.com:5432` — never the transaction pooler |
| commit applied from | `952233a2a413db1cfd3c54eb634b4d3139e4321f` |
| migration | `supabase/migrations/0030_canonical_publication.sql`, sha256 `4cf35320407f68f60d1329a3004468426bb9e278f4982657cd4dd8d2643bb1e9`, 47 091 bytes |
| rollback | `supabase/rollbacks/0030_drop_canonical_publication.sql`, sha256 `93524d42c892d181c10cb31302b714b56737e9daddaf23cdb9dcf409d325ee7a`, 2 525 bytes |
| tool | `supabase db push`, CLI **2.115.0** — the same version that applied `0026`-`0029` |
| applied at | **2026-09-09 00:20:33 to 00:20:43 UTC** (10 s, exit 0) |
| ledger row written | `0030` `canonical_publication`, 33 statements, recorded body sha256 `6a34b4f960ed5fb8215742483dabf3313f5fd77b5ca9af8f97048528eab97c7b` |

**The bytes applied are the bytes Unit 6B.4A proved.** The migration and its
rollback digest identically in three places — the committed blob at `952233a`,
the Windows worktree and the WSL verifier — with no CR byte in any copy. Neither
file has been touched since `4bb1319`, which is five commits before the 6B.4A
verification record, so every 6B.4A run after it — the 188-assertion live gate
and the 111-check browser QA included — ran against exactly these bytes.

**The dry run proposed exactly one file** and nothing else: no reapplication of
`0000`-`0029`, no history repair, no seed. `supabase db push` wraps each
migration in its own transaction and the file carries its own `begin;` (line 115)
and `commit;` (line 871), exactly as `0026`-`0029` do.

ⓘ **The migration file was NOT edited, and its header still says "APPLIED TO NO
PROJECT".** That is deliberate and it is the same decision Unit 6B.3B made for
`0029`: it is now an applied migration whose bytes the hosted ledger records, and
editing an applied migration to correct a comment would make the repository and
the ledger disagree about what ran. The correction lives here, in `CLAUDE.md`, in
`docs/CANONICAL_STUDY_MODEL.md` and in the gates.

ⓘ **The header's own object count is the accurate one: three tables and FOUR
functions.** Three are the callable RPCs — `publish_canonical_presentation`,
`restore_canonical_presentation`, `read_canonical_publication` — and the fourth
is `refuse_canonical_publication_change`, the trigger function that makes the
snapshot and the event log immutable. All four were verified.

#### Before anything: the pre-application safety gate

Every item was read-only and every one passed.

- **The target was verified without printing a credential.** Three independent
  configuration files — the Windows `.env.local` and both WSL copies — name the
  same project host, and their anon and service keys are byte-identical by
  digest. The direct connection resolves to `postgres.ontvqazsqiwisdddblif` on
  the session pooler at port 5432, PostgreSQL 17.6.
- **The ledger held 30 rows, `0000`-`0029`**, contiguous, no duplicate, with a
  SHA-256 taken over each recorded body. ⓘ Two rows (`0020` and `0022`) carry a
  NULL `statements` array and therefore have no recorded body — the same
  pre-existing property Unit 6B.3B recorded, not a new one.
- **Every `0030` object was absent**: all three tables, all four functions, all
  four named indexes, and no policy on any of them.
- **The full inventory was recorded**: 61 tables, all 61 RLS-enabled and FORCE
  RLS, 56 policies, 30 functions, 199 indexes, 3 triggers, and a row count and a
  column/constraint/index/policy/trigger/grant digest for every table.
- **The before-state data fingerprints were recorded**: Cuicuilco's legacy draft
  at **v2 revision 72** (`b7127081…`, 27 051 bytes), P6E's at **v3 revision 14**
  (`8ea44dea…`, 1 403 bytes), Cuicuilco's canonical draft at **v4 revision 1**
  (definition `511d7f54…`, binding `cf63bdca…`, registry `1.0.0`),
  `study_experience_event` at 86 rows under a content digest,
  `canonical_presentation_draft_event` at 1, both legacy publication tables
  empty, and a row count for all 40 canonical evidence/result families plus a
  content digest over the ten result-bearing ones.
- **The repository's own read-only gate passed 48/48** before anything was
  applied, and `test:migration-chain` and the offline publication gate
  (`167/167`) passed on the same bytes.

#### The backup, and its restore rehearsal

```
/home/patop/becommunity-backups/u6b4b1-pre-0030-20260909T001339Z
  database.dump  1 169 629 bytes  sha256=a22ddd3312f6fe8c2212f14c8920bec37c6d28f6dd122080c718db4c29f6c510
  schema.sql       372 780 bytes  sha256=c89e68427abaa5e0cdef5f6e11aaddddb219cc1009da3b3c15a4c5fb198ebcbb
  toc.txt           68 395 bytes  sha256=52d5abf45edb3d19b2fd88a1b50f987f14a7f7f837c5d3113975d52975d5d891
```

`pg_dump` **17.11** custom format, compress 9, `--no-owner` (GRANTs and POLICYs
kept deliberately), schemas `public` and `supabase_migrations`, over the session
pooler. Directory `0700`, files `0600`, outside every Git repository. TOC: 804
entries — 62 TABLE definitions and 62 TABLE DATA blocks, 117 constraints and 197
foreign keys, 83 indexes, 56 policies, 61 row-security entries, 3 triggers, 30
functions, 1 view.

ⓘ **The client had to be the versioned binary, not the one on `PATH`.** The first
attempt produced a dump with `pg_dump` **18.6**, because
`becommunity-pgclient/unpack/usr/bin/pg_dump` is a symlink to Debian's
`pg_wrapper`, which dispatches to the newest installed version. An 18-format
archive cannot be read by a 17 `pg_restore`, so the backup would have been
restorable only by a client newer than the server it came from. That artifact was
deleted and the dump retaken with
`unpack/usr/lib/postgresql/17/bin/pg_dump`, which reports 17.11.

**Restored into a disposable PostgreSQL 17.11 and compared against the source:
33 assertions, 33 passed.** 61 tables, 0 row-count mismatches, policies 56 = 56,
functions 30 = 30, RLS and FORCE RLS 61/61 on both sides, the ledger identical at
30 rows with no earlier body changed, and **both legacy drafts, the canonical
draft, both event logs and all ten result-family content digests byte-identical**.
The restore ran in three sections — pre-data, data, then post-data after the
identities the restored rows reference were synthesised into the `auth.users`
stand-in — so all 25 foreign keys to `auth.users` replayed too.

ⓘ **`pg_restore` reported exactly one error and it is not data:** `schema
"public" already exists`, because a fresh PostgreSQL database already has one. A
restore into a real Supabase project does not hit it. **That restore has not been
executed and must not be described as if it had.**

ⓘ **Two comparison defects were found and corrected before the result was
believed, and both would have passed for the wrong reason in the other
direction.** The first auth-fill read the foreign keys to `auth.users` out of
`pg_constraint` — but those constraints are POST-DATA objects and did not exist
yet, so it synthesised zero identities and ten tables failed their foreign key.
It reads them out of the dumped schema instead. And the first comparison reported
60 tables as having changed grants, 53 as having changed policies and every row
digest as having moved: `--no-owner` restores as the connecting user rather than
`postgres`, the disposable session runs in `America/Chihuahua` rather than UTC so
every `timestamptz` renders differently inside a row digest, and `polroles` is
stored in role-OID order so one server reports `anon,authenticated` where another
reports `authenticated,anon`. The owner name is normalised, the timezone is
pinned to UTC and the roles are sorted — after which the comparison is 33/33 with
nothing excused.

#### The restore procedure

1. Verify the artifact before trusting it: `sha256sum -c SHA256SUMS` in the
   backup directory. A mismatch stops the restore.
2. Provision a disposable PostgreSQL 17 —
   `BECOMMUNITY_PG_VERSION=17 bash scripts/lib/disposable-postgres-provision.sh` —
   and restore into it FIRST. A backup nobody has restored is a hope. Use the
   **versioned** client at `~/becommunity-pgclient/unpack/usr/lib/postgresql/17/bin`,
   never `/usr/bin/pg_restore`, which is Debian's dispatching wrapper.
3. Create the roles the dump's ACLs name (`anon`, `authenticated`,
   `service_role`, `postgres`, `supabase_admin`, and the `authenticator`,
   `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user` and
   `pgbouncer` the default ACLs mention) and apply
   `scripts/lib/disposable-bootstrap.sql` for the `auth` and `storage` stand-ins.
4. `pg_restore --no-owner --section=pre-data --section=data`, populate
   `auth.users` with the identities the restored rows reference — derive them
   from `schema.sql`, not from `pg_constraint`, which is empty of them at that
   point — then `--section=post-data`.
5. Only a person may decide to restore over the hosted project, and only after
   the rehearsal above. **`supabase/rollbacks/0030_drop_canonical_publication.sql`
   is the reverse of this migration and is the right instrument for undoing THIS
   unit** — it drops only `0030`'s own three tables, its trigger function and its
   three callable functions, and touches no legacy table, no legacy row, no
   canonical draft and no policy outside them. Today it would destroy nothing but
   empty tables, because nothing has been published.

#### After the migration: what the database gained, and nothing else

A full structural fingerprint of `public` was taken before and after and diffed
object by object. **36 assertions, 36 passed.**

- **Tables 61 to 64.** Added: `canonical_presentation_revision`,
  `canonical_presentation_publication`,
  `canonical_presentation_publication_event`. Removed: none. **Zero pre-existing
  tables changed** in columns, constraints, indexes, policies, triggers or
  grants, each compared by its own digest.
- **Functions 30 to 34.** Added: the three RPCs and
  `refuse_canonical_publication_change`. Removed: none. **Zero pre-existing
  functions changed**, compared by a digest over `pg_get_functiondef`, and none
  changed its EXECUTE grants or its security settings.
- **Policies 56 to 59, indexes 199 to 207, triggers 3 to 5.** RLS and FORCE RLS
  on **64 of 64**. Schema-level grants unchanged.
- **The ledger is 31 rows, `0000`-`0030`**, contiguous, no duplicate, and the
  recorded body of every one of the 30 earlier migrations digests to what it
  digested before, under the name it had before.

**Everything the committed migration declares, read back out of the catalogue:**

| what | found |
|---|---|
| RLS / FORCE RLS | enabled and forced on all three |
| policy | `deny_browser_roles` on each, `for all` to `anon,authenticated`, `using (false) with check (false)` |
| grants | `service_role: SELECT` and the owner's, on all three. `anon` and `authenticated` hold nothing |
| constraints | snapshot 20 CHECKs + 2 FK + PK + UNIQUE `(study_id, version)`; pointer 4 FK + PK on `study_id`; event log 5 CHECKs + 4 FK + PK |
| indexes | the four the migration names, plus three PK indexes and the unique-constraint index — 8 in total |
| immutable protections | `refuse_change` `BEFORE DELETE OR UPDATE FOR EACH ROW` on the snapshot and on the event log — and deliberately **not** on the pointer, which is the one mutable object in the model |
| function security | the three RPCs `SECURITY DEFINER` with `search_path=""` returning `jsonb`; `refuse_canonical_publication_change` **not** `SECURITY DEFINER` |
| EXECUTE | the three RPCs held by `postgres` and `service_role` only; the trigger function by `postgres` alone — `service_role` cannot execute it. **PUBLIC holds none of the four** |

#### Least privilege, executed rather than asserted

**Thirty-six probes ran on the hosted project**, each inside its own explicit
transaction that was **rolled back**. `set local role` is used rather than `set
role` precisely because it requires that transaction: outside one it applies to
the implicit single-statement transaction and is gone before the next statement,
and the query then runs as the table OWNER — which is how a privilege assertion
passes for the wrong reason.

- `anon` and `authenticated`: **42501 on every SELECT, INSERT, UPDATE and DELETE
  of all three tables** — 24 of 24.
- `service_role`: **SELECT allowed on all three; INSERT, UPDATE and DELETE all
  42501** — 9 refusals and 3 allowances, which is exactly the designed shape. It
  is a reader of this storage and never a writer; the only legitimate writer is a
  `SECURITY DEFINER` function.
- Over real HTTPS with the **anon** key: 401/`42501` on all three tables.
- Over real HTTPS with a **genuine signed-in session** (the internal test
  account, the most privileged browser identity this product has): 403/`42501` on
  all three.
- The API description grew from **89 paths to 95** — the three tables and the
  three RPCs, and nothing else.

ⓘ **NO PUBLICATION RPC WAS INVOKED, not even to prove one exists.** Whether a
role holds EXECUTE was read from `has_function_privilege`; whether the functions
are exposed was read from PostgREST's own OpenAPI description, which is a GET.
Unit 6B.3B proved `service_role`'s EXECUTE on the DRAFT save by calling it and
being refused by the function's own first check — a good instrument there, and
the wrong one here, because these functions publish and this phase authorized
applying a migration and nothing else. The catalogue answers the same question
without asking anything to run.

#### The publication state is EMPTY — the half that matters most

| | |
|---|---|
| `canonical_presentation_revision` | **0 rows** — no immutable snapshot exists |
| `canonical_presentation_publication` | **0 rows** — no study points at a current publication |
| `canonical_presentation_publication_event` | **0 rows** — no publication or restoration was ever recorded |
| `study_experience_revision` (legacy) | 0 rows, as before |
| `study_experience_publication` (legacy) | 0 rows, as before |

#### Mandatory unchanged-data proof

Every fingerprint taken before the migration was taken again after it and
compared byte for byte.

- **Cuicuilco's legacy draft is still schema version 2, revision 72** — same
  definition digest `b7127081…`, same `updated_at`, same byte count, same
  whole-row digest.
- **P6E's legacy draft is still schema version 3, revision 14** — `8ea44dea…`,
  unchanged in the same four respects.
- **Cuicuilco's canonical draft is still schema version 4, revision 1** —
  definition `511d7f54…`, binding `cf63bdca…`, registry `1.0.0`, `created_at` =
  `updated_at` = 2026-09-08T19:25:48.039969Z. It did not move, and nothing read
  it.
- **Both draft event logs are unchanged**: `study_experience_event` at **86
  rows** (2 `draft_created`, 84 `draft_saved`) and
  `canonical_presentation_draft_event` at **1** (`draft_created`, revision 1),
  each under an identical content digest — not merely an identical count.
- **Canonical evidence and result data is unchanged**: all 40 families hold
  exactly the rows they held, and the content digest of all ten result-bearing
  families — `survey_response`, `performance_observation`, `pain_point`,
  `metric_definition`, `journey_stage`, `study_participant`, `quant_response`,
  `qual_observation`, `respondent`, `study` — is identical.
- **Every one of the 61 pre-existing tables holds exactly the row count it held.**

**Parity, re-run on the real workbooks** (`Datos limpio estudio Cuicuilco.xlsx`
`8d7afdb4…`, `Puntos de dolor Journey BNI Cuicuilco.xlsx` `bd0e70d7…`):
`canonical-results-parity` **534 offered, 531 executed, 531 passed**, 0 failed,
0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required;
`canonical-presentation-parity` **59 checks, 59 passed**, 0 failed. **Neither
number moved.**

#### Corrections this activation made necessary

Three source rules asserted "`0030` is applied nowhere". Each was **inverted
rather than deleted**, because a target that has LOST the storage is as much a
finding as one that gained it unexpectedly.

1. `scripts/canonical-presentation-hosted-fingerprint.mjs` — §[3b] now asserts
   the three tables EXIST and the three functions are exposed, **and adds three
   assertions the old section had no reason to make: each table must hold ZERO
   rows.** Applying the storage and publishing into it are different acts, so the
   gate now fails both on a table that vanished and on a publication that
   appeared. It still reads the API description rather than calling an RPC, for
   the reason that has not changed. 48/48 before, **54/54 after**.
2. `scripts/lib/canonical-rest-transport.mjs` — its bound is a fact about the
   hosted target, so it moved 29 to 30, and it now also refuses a target missing
   `canonical_presentation_revision`. It asserts existence only; whether that
   table is empty is the fingerprint gate's job.
3. `scripts/migration-chain-test.mjs` — `HOSTED_APPLIED_SLUG` moved from
   `canonical_presentation_draft` to `canonical_publication`; the REST-bound rule
   requires the transport to check for the publication migration's own table;
   every governing document must now record that `0030` IS applied **and, in a
   separate required assertion, that nothing was published**; and three withdrawn
   claims are guarded.

ⓘ **The withdrawn-claim patterns were too broad on the first draft, and that is
worth recording.** They also matched `/carried by no database/`, `/are ABSENT …
hosted/` and `/no migration was applied to hosted infrastructure/`, which failed
three documents for correctly RECORDING what a previous unit did — including
`0029`'s own superseded heading, which has read "carried by no database yet"
beside a supersession note since 2026-09-08. A rule that forbids this
repository's own way of keeping history is a rule that teaches the next author to
delete the history. What must not survive is a PRESENT-TENSE claim, and the three
that shipped match only that.

#### Known limitations, stated rather than implied

1. ⚠️ **The migration file's own header is now out of date, and was left that
   way on purpose.** It still describes itself as carried by no database, which
   stopped being true at 00:20:43 UTC. The file is left byte-identical for the
   reason given above — editing an applied migration would make the repository
   and the ledger disagree about what ran — so anyone reading the migration alone
   will read a false sentence about where it lives. The four corrected places are
   this section, `CLAUDE.md`, `docs/CANONICAL_STUDY_MODEL.md` and the two gates.
2. **The backup covers `public` and `supabase_migrations` only.** The `auth`
   schema is deliberately excluded, as in every previous backup. The one sign-in
   this unit performed — the HTTPS privilege probe — wrote an auth session, which
   is not restorable state and is not part of what this phase could affect.
3. **The `--db-url` flag puts the connection string in the process's argv** for
   the two invocations that needed it. The CLI honours no environment variable
   for it, and `--linked` does not guarantee the SESSION pooler this phase
   requires. Every other credential in this unit was passed through the
   environment from a script file and none reached a transcript.
4. **The publication functions were never executed, anywhere, against this
   project.** Their behaviour remains proved by Unit 6B.4A's 188-assertion
   disposable-database gate and its 111-check browser QA, not by anything run
   here. The first hosted execution will be a separately authorized phase.
5. **The Suite D secret-pattern findings and `0025`'s identity-deletion
   limitation are untouched**, as the phase directed. They remain final-security
   and legacy-maintenance items.
6. ⚠️ **`npm run test:hosted-target-guard` fails one assertion in the WSL
   verifier, and it failed there before this unit touched anything.** §[8] builds
   `<root>/../becommunity-software/evidence` to prove the MAIN-REPOSITORY rule
   refuses a path that the worktree rule cannot reach. The WSL checkout is a
   plain clone AT `/home/patop/becommunity-software`, so that path resolves back
   to the root itself, the worktree rule answers first, and the refusal message
   does not name the main repository. **It was re-run at the baseline commit
   `952233a` with every file of this unit reverted and it failed identically**,
   which is what makes it an environment fact rather than a regression. It is not
   fixed here: this phase authorizes no unrelated cleanup, and the fix belongs
   with whoever decides whether that check should tolerate a clone.

#### Still deferred, and deliberately so

Unit 6B.4B2 was **not** started. No canonical publication was created, prepared,
published, restored or archived; no current-publication pointer exists; no
publication event was written. Nothing was deployed, no application code was
promoted, the client route was not switched, no legacy draft was converted, no
formula or approved value moved, no credential was rotated, and shadow mode is
still off everywhere. `main` is unchanged.

### Unit 6B.4B2D — migrations `0031` and `0032` are applied to the hosted project, and NO editorial decision was recorded (EXECUTED, 2026-09-14)

**Three hosted mutations were authorized and exactly three happened: migration
`0031` was applied, migration `0032` was applied, and the ledger recorded them.**
The qualitative sign-off storage and the journey-pain review storage now exist on
`ontvqazsqiwisdddblif` and **all three of their tables are empty**. Applying the
storage and recording a person's judgement into it are different acts; this phase
authorized the first and forbade the second, and the proof below is evidence
rather than assertion.

**Nothing editorial happened.** No qualitative sign-off was recorded. No pain
item was approved, rejected, edited or mapped — all 50 `pain_point` rows are
still `review_status = 'pending'`. No canonical draft was saved or rebound. No
warning was acknowledged. Nothing was published, and nothing was deployed.

#### The migrations, exactly

| | |
|---|---|
| project | ref `ontvqazsqiwisdddblif`, PostgreSQL **17.6** |
| connection | **session** pooler, `aws-0-us-east-2.pooler.supabase.com:5432` — never the transaction pooler |
| commit applied from | `84d65e3a84a361a8b704a7f76f555fbf29230a09` |
| migration | `supabase/migrations/0031_canonical_qualitative_signoff.sql`, sha256 `4e6922d31e6d96e8559c2bd4284081ff6e612c53b863efa31d65a11d6955d86d`, 27 586 bytes |
| migration | `supabase/migrations/0032_canonical_journey_pain_review.sql`, sha256 `df0a77775f495cdac528991e27f2b081ae00bafc4cf37fd07f4aeccc5eff7dcd`, 22 586 bytes |
| rollback | `supabase/rollbacks/0031_drop_canonical_qualitative_signoff.sql`, sha256 `37c2c31446524b7848158b347f8e4c5b22f0209891a37e09b473a65610685984`, 2 126 bytes |
| rollback | `supabase/rollbacks/0032_drop_canonical_journey_pain_review.sql`, sha256 `411037a406029fdbe555c0546217085e6dff7a4a243699304085116b105f0e63`, 1 961 bytes |
| tool | `supabase db push`, CLI **2.115.0** — the same version that applied `0026`-`0030` |
| applied at | **2026-09-14 09:38:26 to 09:38:32 UTC** (6 s, exit 0), both files in ONE push, `0031` then `0032` |
| ledger rows written | `0031` `canonical_qualitative_signoff`, 27 statements, recorded body sha256 `951a92ee1bb32baf621f8c6723bab3634886c0a87c23f10228f03adaa81253e5`; `0032` `canonical_journey_pain_review`, 24 statements, recorded body sha256 `567238a64dfbd0a0294b5a65eaf3d5b0c226871da028496c14824a07fbd2a6fa` |

**The bytes applied are the bytes the previous units proved.** All four files
digest identically to their committed blobs at `84d65e3`, with no CR byte in any
copy: `0031` blob `783d59a4`, `0032` blob `5b13b6e5`, and the two rollbacks
`7c99a339` and `6d618a11`. `0031` has not been touched since `493462c`, and
`0032` and both rollbacks were last written at the baseline commit itself.

ⓘ **The migration files were NOT edited, and their headers still say they are
applied to no project.** That is deliberate and it is the decision `0029` and
`0030` each recorded: they are now applied migrations whose bytes the hosted
ledger records, and editing an applied migration to correct a comment would make
the repository and the ledger disagree about what ran. The correction lives here,
in `CLAUDE.md`, in `docs/OPERATIONS.md`, in `docs/CANONICAL_STUDY_MODEL.md` and
in the gates.

ⓘ **NEITHER FILE CARRIES ITS OWN `begin;`/`commit;`, unlike `0026`-`0030`**, and
the repository's chain gate does not require them to — its transaction contract
covers the five older canonical migrations by name. That difference was not
assumed safe; it was tested. A throwaway migration that creates a table and then
divides by zero was pushed at a disposable database with the same CLI: it failed
at the second statement, **the table did not survive and no ledger row was
written**. `supabase db push` wraps each migration file in one transaction, so a
mid-file failure rolls the whole file back. This matters because both rollback
files use bare `drop`, not `drop ... if exists`, and would therefore NOT cleanly
reverse a partial apply — the tool's atomicity is what makes that irrelevant.

#### Before anything: the pre-application safety gate

Every item was read-only and every one passed.

- **The target was verified without printing a credential.** The connection URI
  resolves to `postgres.ontvqazsqiwisdddblif` on the session pooler at port 5432,
  the API URL names the same ref, and the server answered PostgreSQL **17.6**.
  Only host, port, database, the user's non-secret prefix and a 12-character
  digest of each secret were ever printed.
- **The ledger held 31 rows, `0000`-`0030`**, contiguous, no duplicate, with a
  SHA-256 taken over each recorded body. ⓘ Two rows (`0020` and `0022`) carry a
  NULL `statements` array and therefore have no recorded body — the same
  pre-existing property Units 6B.3B and 6B.4B1 recorded, not a new one.
- **Every `0031` and `0032` object was absent**: all three tables, all seven
  functions and all five named indexes — 15 objects, 15 absences.
- **The full inventory was recorded**: 64 tables, all 64 RLS-enabled and FORCE
  RLS, 59 policies, 34 functions, 207 indexes, 5 triggers, and a row count plus a
  column/constraint/index/policy/trigger/grant digest for every table.
- **The before-state data fingerprints were recorded**: Cuicuilco's legacy draft
  at **v2 revision 72** (`b7127081...`, 27 051 bytes), P6E's at **v3 revision 14**
  (`8ea44dea...`, 1 403 bytes), Cuicuilco's canonical draft at **revision 1**
  (definition `511d7f54...`, binding `cf63bdca...`, registry `1.0.0`),
  `study_experience_event` at 86 rows under a content digest,
  `canonical_presentation_draft_event` at 1, all five publication tables empty,
  50 `pain_point` rows all `pending` under a content digest, and a row count for
  45 canonical evidence/result families totalling 15 642 rows.
- **The repository's own gates passed on the same bytes**: `typecheck`, `lint`,
  `test:migration-chain`, the hosted fingerprint gate (**65/65**), results parity
  **531/531** and presentation parity **59/59**.

ⓘ **`npm run test:hosted-target-guard` failed 1 of its assertions before AND
after, identically**, on §[8] — the refusal names the main-repository rule, so
the worktree rule did not answer for it. It builds
`<root>/../becommunity-software/evidence` expecting a sibling main repository,
and the WSL verifier is a plain clone AT that path. It is a pre-existing
environment fact, it was failing before this unit touched anything, and the two
failure sets are byte-identical. It is not fixed here: this phase authorizes no
unrelated cleanup.

#### The backup, and its restore rehearsal

```
/home/patop/becommunity-backups/u6b4b2d-pre-0031-20260914T093223Z
  database.dump  1 231 514 bytes  sha256=768d2d95d80b86ba24c61de9a5009ce6c92695c46bfde7d5b09f5cc2d5bccd90
  schema.sql       414 922 bytes  sha256=f4706d8abd9fe34a8362f88d312d1006471637a863d69af64fea9ffc879bc986
  toc.txt           74 748 bytes  sha256=1d98c731f41907d720869c7ecad64a2d5331aaf3d03e2d238dc95d962485c106
```

`pg_dump` **17.11** custom format, compress 9, `--no-owner` (GRANTs and POLICYs
kept deliberately), schemas `public` and `supabase_migrations`, over the session
pooler. Directory `0700`, files `0600`, outside every Git repository, with a
`SHA256SUMS`. TOC: 855 entries — 130 TABLE entries, 121 constraints and 207
foreign keys, 87 indexes, 59 policies, 64 row-security entries, 5 triggers, 34
functions, 1 view.

**Restored into a disposable PostgreSQL 17.11 and compared against the source:
28 assertions, 28 passed.** 64 tables with zero row-count mismatches, policies
59 = 59, functions 34 = 34, RLS and FORCE RLS 64/64 on both sides, the ledger
identical at 31 rows with no earlier body changed, and **both legacy drafts, the
canonical draft, every event log, all five publication tables and all 45
canonical evidence families byte-identical**. The three false differences Unit
6B.4B1 documented were corrected rather than excused: the `--no-owner` owner name
is normalised, `PGTZ=UTC` is pinned on the local client, and the policy digest
sorts `polroles`.

ⓘ **`pg_restore` reported exactly one error and it is not data:** `schema
"public" already exists`. **That restore has not been executed against a real
Supabase project and must not be described as if it had.**

ⓘ **26 foreign keys to `auth.users`** were derived from `schema.sql` — not from
`pg_constraint`, which is empty of them between the data and post-data sections —
and 4 distinct identities were synthesised, after which post-data restored with
zero errors.

#### The delta was PREDICTED before it was produced

Both migrations were applied to the restored disposable copy first, so the change
they make to a copy of the real database was known in advance rather than
asserted from the SQL. **The hosted result matched that prediction exactly**,
object for object, modulo the owner name (`patop` locally, `postgres` hosted).
A hand-written expectation can be wrong in the same direction twice; a
measurement taken from a copy of the same data cannot.

**The dry run proposed exactly two files, in order** — `0031` then `0032` — and
nothing else: no reapplication of `0000`-`0030`, no history repair, no seed.

#### After the migrations: what the database gained, and nothing else

A full structural fingerprint of `public` was taken before and after and diffed
object by object. **28 assertions, 28 passed.**

| | before | after |
|---|---|---|
| tables | 64 | 67 (+3) |
| policies | 59 | 62 (+3) |
| functions | 34 | 41 (+7) |
| indexes | 207 | 215 (+8) |
| triggers | 5 | 8 (+3) |
| RLS / FORCE RLS | 64 / 64 | 67 / 67 |
| ledger rows | 31 (`0000`-`0030`) | 33 (`0000`-`0032`) |

- **Tables 64 to 67.** Added: `canonical_qualitative_signoff`,
  `canonical_publication_qualitative_signoff` (both `0031`) and
  `canonical_journey_pain_decision` (`0032`). Removed: none. **Zero pre-existing
  tables changed** in columns, constraints, indexes, policies, triggers or
  grants, each compared by digest.
- **Functions 34 to 41.** Added: `record_canonical_qualitative_signoff`,
  `read_canonical_qualitative_signoffs`,
  `publish_canonical_presentation_with_qualitative`,
  `refuse_canonical_qualitative_signoff_change` (`0031`),
  `record_canonical_journey_pain_decision`,
  `read_canonical_journey_pain_decisions` and
  `refuse_canonical_journey_pain_change` (`0032`). Removed: none. **Zero
  pre-existing functions changed**, compared by a digest over
  `pg_get_functiondef`, and none changed its EXECUTE grants or security settings.
- **`publish_canonical_presentation` is byte-identical.** `0031` adds its
  wrapper BESIDE the `0030` implementation and does not replace it — the
  applied history stays exactly as the ledger records it. The fingerprint gate
  now asserts both functions exist, because a project where the wrapper appeared
  and the original vanished would be a different and worse database.
- **The ledger is 33 rows, `0000`-`0032`**, contiguous, no duplicate, and the
  recorded body of every one of the 31 earlier migrations digests to what it
  digested before, under the name it had before.

#### Least privilege, executed rather than asserted

Each new table is RLS-enabled and FORCE RLS, carries one `deny_browser_roles`
policy `using (false) with check (false)` scoped to `anon, authenticated`, and
grants `select` — not `all` — to `service_role` alone. Every write probe ran
inside a transaction that was rolled back, so even an escape could not have left
a row.

| probe | attempts | result |
|---|---|---|
| `anon` / `authenticated` `SELECT` on the three tables | 6 | 6 refused, all `42501` |
| `anon` / `authenticated` `INSERT` on the three tables | 6 | 6 refused, all `42501` |
| `service_role` `SELECT` on the three tables | 3 | 3 allowed, 0 rows |
| `service_role` `INSERT` / `UPDATE` / `DELETE` | 9 | 9 refused, all `42501` |
| `EXECUTE` on the four callable RPCs, per role | 12 | granted to `service_role` only |
| `EXECUTE` on the two trigger functions, per role | 6 | denied to all three roles |

ⓘ **One probe initially answered `42703` rather than a privilege verdict** —
`update canonical_publication_qualitative_signoff set id = id`, because that
table has no `id` column, so the column check fired before the privilege check.
It was re-run against a column that exists (`revision_id`) and refused `42501`,
permission denied for table. A probe that fails for the wrong reason proves
nothing, and it was not counted until it failed for the right one.

**No sign-off or mapping RPC was invoked.** Their existence is read from
PostgREST's own API description — a GET — and never by calling one. Calling
`record_canonical_qualitative_signoff` to prove it exists would have been exactly
the editorial act this phase forbade, and an unmatched call would still be a
call.

#### The review state is EMPTY — the half that matters most

`canonical_qualitative_signoff` **0 rows**,
`canonical_publication_qualitative_signoff` **0 rows**,
`canonical_journey_pain_decision` **0 rows**.

#### Mandatory unchanged-state proof

Before and after, over the same query. **28 assertions, 28 passed.**

- **Cuicuilco's canonical draft is still revision 1 and byte-identical** —
  definition digest unchanged, recorded `definition_sha256` still `511d7f54...`,
  registry still `1.0.0`, and exactly one canonical draft exists.
- **Its binding fingerprint is unchanged at `cf63bdca...`**, so the expected
  binding drift is still merely REPORTED and was not repaired. This unit did not
  touch the draft.
- **Both legacy drafts are byte-identical**: Cuicuilco v2 revision 72
  (`b7127081...`), P6E v3 revision 14 (`8ea44dea...`).
- **Every draft and publication event log is unchanged** by count and content
  digest: `study_experience_event` 86, `canonical_presentation_draft_event` 1,
  `study_interpretation_event` 0, `canonical_presentation_publication_event` 0.
- **All five publication tables are still empty** — three canonical, two legacy.
  No experience has been published.
- **All 50 pain points are still `review_status = 'pending'`** under an unchanged
  content digest: all 50 pain-point decisions remain absent, and the new decision
  table holds zero rows.
- **No qualitative sign-off exists**, and no publication carries one.
- **All 45 canonical evidence/result families are unchanged**, 15 642 rows in
  total, and the five studies are unchanged in name, status and id.
- **Results parity remains 531/531** and **presentation parity remains 59/59**,
  both re-run after the migrations with the two real workbooks supplied.

#### The old gate was watched failing, once, before it was inverted

`npm run test:canonical-presentation-hosted-fingerprint` was run against the
applied project BEFORE its expectations were changed. It failed **8 of 65**
assertions — the three tables reported as present when the gate demanded absence,
and the five functions reported as exposed when it demanded they were not — **and
nothing else**, while the other 57 still passed. That is the only moment a check
nobody has seen fail can be shown to work, and it is why the section was inverted
rather than deleted.

The bound was then moved in the three places that must move together:
`HOSTED_APPLIED_SLUG` in `scripts/migration-chain-test.mjs` (now
`canonical_journey_pain_review`), the `prepare(upTo = 32)` default and its
refusal bound in `scripts/lib/canonical-rest-transport.mjs` (which now also
requires a table from each migration, because a target carrying one and not the
other is half-migrated), and §`[3c]` of the fingerprint gate, which now requires
the three tables to EXIST **and** to be EMPTY. The chain gate additionally
requires every governing document to record that `0031` and `0032` are applied
AND that no sign-off or pain-item decision was recorded, and withdraws the
present-tense claims that said otherwise.

#### Known limitations, stated rather than implied

- **The rollbacks are atomic but not idempotent.** Both carry `begin;`/`commit;`
  and both use bare `drop`, so neither would cleanly reverse a partial apply.
  The CLI's per-file transaction is what makes a partial apply impossible on this
  path; a rollback run against a half-dropped schema would still need hand
  repair.
- **`0031`'s and `0032`'s own headers remain wrong on purpose**, as `0029`'s and
  `0030`'s do. The ledger records the bytes that ran.
- **The parity gates are offline.** They read the two real workbooks and the
  canonical model from disk and touch no database, so they are evidence that the
  approved numbers still reproduce — not evidence about the hosted project.
- **`test:hosted-target-guard` §[8] still fails in the WSL verifier**, before and
  after, for the environment reason recorded above.

#### Still deferred, and deliberately so

No qualitative sign-off was recorded; no pain item was approved, rejected, edited
or mapped; no canonical draft was saved or rebound; no publication was created,
prepared, published, restored or archived; no current-publication pointer exists;
no publication event was written; no warning was acknowledged. Nothing was
deployed, no application code was promoted, the client route was not switched, no
legacy draft was converted, no formula or approved value moved, no credential was
rotated, and shadow mode is still off everywhere. `main` is unchanged.

### Unit 6B.4B2E — the Cuicuilco canonical draft is explicitly rebound to revision 2, and no editorial decision was made (EXECUTED, 2026-09-14)

**One hosted application mutation was authorized and exactly one happened: the
stored canonical draft was rebound from revision 1 to revision 2.** Its binding
now answers for the current results contract; everything an author wrote is
byte-identical. **No qualitative sign-off was recorded, no pain item was
approved, rejected, edited or mapped, no warning was acknowledged, nothing was
published and nothing was deployed.**

#### Why revision 1 had drifted, measured rather than assumed

`presentationBindingFingerprint` digests nine things: the registry version, the
results **contract version**, seven source-identity fields, and the complete
handle-to-address map. `CANONICAL_RESULTS_CONTRACT_VERSION` was `2.2.0` when the
draft was written on 2026-09-08 and is `3.0.0` now, so every stored binding on
every study stopped matching at once without a single number moving.

That was proved, not inferred. Recomputing the fingerprint from **today's**
registry — today's 279 addresses, today's seven identity fields, today's registry
version — with nothing substituted but the contract version reproduces the stored
`cf63bdca…` **exactly** at `contractVersion = "2.2.0"`:

| substituted contract version | fingerprint |
|---|---|
| `1.0.0` | `20fc5186…` |
| `2.0.0` | `29771984…` |
| `2.1.0` | `9e677da1…` |
| **`2.2.0`** | **`cf63bdca…` — the stored binding** |
| `3.0.0` (current) | `e2ee45b4…` |

Because only the contract version varied, every other input is identical bit for
bit: tenant, study, `specId = cuicuilco`, `mappingVersion = 1`,
`calculationVersion = catalogo-2026-08-19`, package
`sha256:bb9a4a98…`, plan `sha256:099863e8…`, and the whole address map. The
resolver's verdict on the stored document was a single issue,
`binding_fingerprint_mismatch` at `$.binding`.

#### Field-level classification

| class | fields |
|---|---|
| **must change** | `definition.binding`; the `binding_fingerprint` column; the `definition_sha256` column (the definition bytes moved); `revision`; `updated_at`; one appended event row |
| **contract metadata that must change** | **none.** `registryVersion` stays `1.0.0` — the results contract version is an INPUT to the fingerprint and is not stored in the document |
| **must NOT change** | `schemaVersion` (4), `documentKind`, `id`, `title`, `locale`, `samplePolicy`, `methodologyDisclosure`, `pages` (the whole tree: order, blocks, filters, visibility, text, titles, visual configuration), and the envelope `metadata` — `studyId`, `tenantId`, `subtitle` |
| **could not be proven safe by inspection** | `metadata.subtitle`. It is authored text that lives in the ENVELOPE, not the document, so `decodePresentationFromStorage` drops it and a decode-then-encode round trip would silently write `null` over it. It is carried across by hand, and the disposable gate plants a NON-NULL subtitle so the preservation is actually tested — Cuicuilco's happens to be null, which is exactly why a fixture matching it would have proved nothing |

#### The explicit rebind, and why the save path still must not do it

No safe rebind action existed. `storeEditedPresentation` resolves the document AS
IT ARRIVED and refuses a stale binding on purpose — re-binding on save would file
a layout authored over one package as though it had been authored over another,
permanently, as a side effect of an unrelated act. And the composer refuses to
OPEN a drifted draft, so there was no sequence of clicks out of it at all.

`rebindStoredPresentation` is the way out and is a different act in every way
that matters:

- **server-only**, in the route's declared canonical loader, so the boundary
  gate's door table is unchanged;
- **authenticated and tenant-scoped** — the action re-validates the session with
  `getUser()`, reads the role from the database, and reads the tenant from the
  study row. A caller does not get to name a tenant;
- **the client sends a study id, an expected revision and a retry key, and
  NOTHING else.** No document, no binding, no digest, no registry version. Every
  stored value is derived on the server from that request's own canonical read;
- **it refuses unless it can prove only the contract moved** — the exhibition
  above, run against `SUPERSEDED_RESULTS_CONTRACT_VERSIONS`. A binding no shipped
  version reproduces is `source_identity_differs` and nothing is written;
- **it compares the authored projection byte for byte** — every field except
  `binding` and `registryVersion`, serialized deterministically — as a second,
  independent proof, because one check covering two facts stops covering one of
  them the day it changes;
- **it refuses if the rebound document would not resolve**;
- **it answers a REPLAY before a CONFLICT.** The first draft checked the revision
  first, which calls an operator's own retry a conflict and tells them somebody
  else edited the draft. Nobody did. The event log is consulted for the key
  first, exactly as `save_canonical_presentation_draft` does internally;
- **it writes through that same RPC.** No new function, no migration, no direct
  SQL: the advisory lock, the expected-revision refusal, the idempotency replay
  and the append-only event are the ones the product already has;
- **it never runs on a read.** The page only DESCRIBES the change; the write
  happens when a person presses «Actualizar vínculo».

The panel says «vínculo» and never «resultados» or «recalcular», shows both
digests so the change can be refused, and states what is preserved in specifics
(«1 página, 24 bloques, política de muestra show_all») rather than in promises.

#### The disposable proof, before anything hosted was touched

`npm run test:canonical-presentation-rebind` — **78 assertions, 78 passed**,
against a disposable PostgreSQL + PostgREST with a synthetic canonical package
committed through the product's own commit flow. The fixture is the real
situation: a draft whose binding is the one this product WOULD have computed
under a superseded contract version, not an arbitrary digest.

It proves revision 1 becomes 2 exactly once; that replaying the same key returns
revision 2 and creates no revision 3; that a stale expected revision is refused
with `conflict` and the row does not move; that another tenant is refused on both
the read and the write; that the stored binding is the SERVER-derived one; that
the authored projection and the envelope — subtitle included — are byte-identical
after; that the composer, which refused to open the drifted draft, opens revision
2; that a binding no contract version explains is refused and its row is left at
revision 1; and that no publication, sign-off or pain-review row is created and
no canonical result count moves.

**Four failure modes were reintroduced and the gate caught all four**, each file
restored byte-identically afterwards (digests compared):

| mutation | caught by |
|---|---|
| the rebind also rewrites the title | 28 assertions, starting at the plan |
| the exhibition accepts any binding | 4 — the foreign-bound row was repaired to revision 2 |
| a stale revision is checked BEFORE a replay | 3 — the replay became a conflict |
| the subtitle is not carried across | 2 — the envelope and the subtitle both moved |

ⓘ **Two of those four were NOT caught on the first attempt, and both misses were
in the gate rather than the product.** The title mutation was first applied to
`bindPresentationDocument`, which the fixture also uses, so it moved both sides
and cancelled itself; it was retargeted at the rebind's own call. The subtitle
mutation was invisible because the fixture's subtitle was `null` — the same value
the hosted draft carries. A fixture that matches production exactly is the one
that cannot detect losing it.

#### The hosted mutation

| | |
|---|---|
| project | ref `ontvqazsqiwisdddblif`, PostgreSQL 17.6 |
| path | the real authenticated route — signed in through the product's own `/login` as the internal test account, `/studio/e/cd4d6acd…/construccion`, one press of «Actualizar vínculo» |
| performed at | **2026-09-14**, from commit `3ed5588` |
| expected revision presented | **1** |
| idempotency key | `rebind-r1-mu13s9rg-t8sthoy9` (one, fresh) |
| revision | **1 → 2** |
| binding | `cf63bdca71e842fb0f6af50665348567a7b5a0f14f21b62683d2b0d0b5ca2037` → `e2ee45b43fe99102776d4617e12d9a7584d764ddd792199c0dbb96b08a25e2d2` |
| definition digest | `511d7f54f3ec0a391b45db259f64d57f9d415a9b2f5711c6f5fc551cdb67809d` → `78a34758eca3b3d59349fd1dd09ae24114122a2d27575b9c35d852823b25a52d` |
| event written | one `draft_saved` at revision 2, note `vínculo actualizado 2.2.0 → 3.0.0` |

#### THE PROOF THAT ONE FIELD MOVED

The pre-rebind definition was not archived and does not need to be. **Putting the
OLD binding back into the CURRENT definition reproduces the OLD definition digest
exactly** — `511d7f54…` — so the two revisions differ in `binding` and in nothing
else. A digest cannot be fooled by a compensating change elsewhere.

Verified field by field on top of that: `schemaVersion` 4, `documentKind`
`canonical_presentation`, `id` `cuicuilco-aprobado`, `title` «La voz de las y los
Nets de Cuicuilco», `locale` `es-MX`, `methodologyDisclosure`
`plain_language_with_base`, `samplePolicy {mode: show_all}`, 1 page, 24 blocks,
`metadata` unchanged with `subtitle: null`, definition still **17 803 bytes**.
And it RESOLVES: today's registry produces exactly the stored binding under
contract `3.0.0`, and the document resolves with no issues. **27 assertions, 27
passed.**

#### Mandatory unchanged-state proof — 30 assertions, 30 passed

Exactly ONE table changed in the whole database, and it is
`canonical_presentation_draft_event` (1 → 2 rows).

- both legacy drafts byte-identical — Cuicuilco **v2/72**, P6E **v3/14**;
- `study_experience_event` still 86 rows under the same content digest;
- all five publication tables **empty**; no publication event exists;
- all three review tables **empty** — no sign-off, no pain decision;
- all 50 `pain_point` rows still `review_status = 'pending'` under the same
  content digest;
- all 45 canonical evidence/result families unchanged, **15 642 rows**;
- the five studies unchanged; the migration ledger byte-identical at 33 rows;
- 67 tables / 62 policies / 41 functions / 215 indexes / 8 triggers, all
  unchanged, and no function changed in any respect;
- **results parity 531/531**, **presentation parity 59/59**, both re-run after
  the mutation with the two real workbooks supplied;
- `origin/main` untouched at `c76762f4…`.

#### Human-review readiness — verified, and deliberately not completed

Through the real authenticated routes, read-only. **22 assertions, 22 passed.**
The draft was at revision 2 before this pass and at revision 2 after it, still
under two events: browsing the screens wrote nothing. (It cannot: `autosaveIsDue`
requires unsaved changes, and a RESTORED draft is by definition identical to what
is stored.)

- **Construcción loads revision 2**, the rebind panel is gone, the authored title
  is intact, and nothing claims results or data were recalculated;
- **the qualitative sign-off interface opens and is PENDING** — «Nadie ha dejado
  constancia de haber revisado estas categorías», the categories are listed for a
  person to read, «Registrar mi revisión» exists but is **disabled**, and the «I
  read them» confirmation is **not** pre-ticked;
- **publication is rendered but DISABLED**, and the screen says «Este estudio no
  tiene ninguna publicación todavía: el cliente no ve nada»;
- **the journey pain review opens** with **15 items**, every one «Sin revisar»,
  counters reading `Sin revisar 15 · Aprobadas 0 · Excluidas 0 · Sin resolver 0`;
- **nothing is preselected** — zero checked checkboxes, zero checked radios — and
  each item offers an explicit «Decidir» a person must press;
- **an ambiguous phrase stays visibly ambiguous** («esta frase aparece 2 veces en
  el material»), and the screen says «la correspondencia la eliges tú»;
- **no small-sample suppression is offered or implied.** Privacy remains
  operator-controlled and the default is show-all.

ⓘ **FIFTEEN, NOT FIFTY, AND THAT IS CORRECT.** All 50 `pain_point` rows exist and
are all `pending`; **15 of them are journey pain** and the other 35 are
organizational (8), performance (7) and culture (20), which this screen does not
scope. §"The real study's decision inventory" records the same 15/8/7/20 split.
The fifty rows are the canonical source; the fifteen are the decisions this
review asks a person to make.

Screenshots (outside every Git repository, alongside the run):
`~/becommunity-6b4b2e/screenshots/` — `qa-1-construccion-revision-2.png`,
`qa-2-revision-cualitativa-pendiente.png`, `qa-3-dolor-pendiente.png`, plus
`1-construccion-vinculo-pendiente.png` and `2-vinculo-actualizado.png` from the
mutation itself. The second and third are also the proof that no review decision
and no publication exist.

#### A pre-existing gate defect this unit fixed, because it blocked a required gate

`scripts/journey-pain-review-test.mjs` §[16] looped over four module names as
`file` and then referenced **`module`** — CommonJS's own global — in the body. The
assertion never looked at any of the four names: it built one regex out of
whatever `module` stringified to and reported four passes while testing nothing.
Under Node 24 that identifier beside the file's top-level `await` makes the
module format ambiguous, and the gate died with `ERR_AMBIGUOUS_MODULE_SYNTAX`.

**That failure was reproduced at the baseline commit `3ed5588` in a throwaway
worktree with this unit's files absent**, so it is not a regression. It is fixed
here rather than deferred because a gate that cannot run cannot be reported as
passing, and the four assertions now genuinely test the four names.
`test:journey-pain-review` is **261/261**.

#### Gates, and one honest failure

`typecheck`, `lint` (0 errors, 54 warnings — one fewer than the baseline's 55,
because the fix above removed a reference), `test:canonical-presentation`,
`test:canonical-presentation-persistence`, `test:canonical-publication`,
`test:journey-pain-review` (261/261), `test:publication-boundary`,
`test:migration-chain`, `test:canonical-presentation-hosted-fingerprint`
(**74/74**), `test:canonical-presentation-rebind` (**78/78**), results parity
**531/531**, presentation parity **59/59**, and `npm run build` — all pass.

ⓘ **`npm test` exits 1 on `test:hosted-target-guard`, which fails ONE assertion:**
§[8], «the refusal names the main-repository rule, so the worktree rule did not
answer for it». It builds `<root>/../becommunity-software/evidence` expecting a
sibling main repository, and the WSL verifier is a plain clone AT that path. It
is the same single failure Unit 6B.4B2D recorded, byte-identical.

ⓘ **That gate is number 23 of 53, so the chain stops there and 30 gates never
run.** They are not therefore covered, and were not reported as such: **all 30
were run individually and all 30 passed** — `import-center`, `templates`,
`bi-filters`, `qualitative`, `confirmed-qualitative`, `client-boundary`,
`publication-boundary`, `data-scope`, `client-admin`, `study-config`,
`client-preview`, `longitudinal`, `narrative-home`, `server-pdf`,
`tenant-branding`, `validation`, `pivot`, `suite-a-selftest`,
`suite-bc-selftest`, `design-tokens`, `studio-workflows`, `studio-completion`,
`insights-story`, `p8-qualitative`, `p8-acceptance`, `private-metadata`,
`data-completeness`, `segments`, `periods`, `xlsx-hardening`.

ⓘ **The Cloudflare build was NOT run.** `npm run cf:build` is not part of this
repository's ordinary gate and this phase forbids deployment; `npm run build`
is what the offline chain and the other units use, and it passes.

#### Remaining editorial work, stated plainly

> ⓘ **THIS SECTION WAS WRONG AND UNIT 6B.4B2G CORRECTED IT.** It said
> «Publication stays blocked… the blocker it raises cannot be acknowledged
> away». Driving the real authenticated review screen showed **no blocker at
> all**: both editorial gaps appear as acknowledgeable warnings. The mechanism
> is a version skew between the blueprint code and the stored draft, established
> read-only and written out in §"What actually stops a publication" below.
> Nothing about the product changed and nothing in it is defective; only this
> description was false.

Two editorial acts were outstanding, and only a person could perform them:

1. **the qualitative sign-off had not been recorded** — nobody had left evidence
   of having read the category set, and the digest that would make such a record
   go stale by itself did not exist yet;
2. **the fifteen journey pain items were all undecided** — none approved, none
   excluded, none mapped to a touchpoint. `authoredPainContent` is all-or-nothing,
   so a partial review produces no pain content at all.

Both were editorial acts that unit was forbidden to perform. Both have since been
done — see §"Unit 6B.4B2G" below for by whom, from what evidence, and with what
remaining limits.

#### What actually stops a publication — measured, not assumed

Read off the real authenticated review screen at
`/studio/e/cd4d6acd…/revision`, 2026-09-14, and asserted by
`test:canonical-publication`:

- **No hard blocker is raised for either editorial gap.** The `bloqueos` section
  is not rendered at all.

ⓘ **WHY, EXACTLY — AND IT IS NOT WHAT EITHER DOCUMENT SAID.** The reason is a
version skew between the code and the stored document, and it was measured
read-only on the hosted draft rather than reasoned about:

- `required_content_missing` and `journey_pain_review_incomplete` are genuinely
  NON-acknowledgeable blockers in `contract.ts`, and both fire only when **the
  document being published marks the pain slot `requiredContent: true`**
  (`requiredBlockIdsOf` / `painContentIsRequired` in `publication-workspace.ts`).
- **Today's blueprint code DOES mark it** — `cuicuilco-approved.ts` passes
  `required = true` for `temas-recorrido`. CLAUDE.md's «REQUIRED CONTENT IS A
  BLOCKER… the approved blueprint marks the journey pain-cloud slot with it» is
  therefore true **of the code**.
- **The STORED Cuicuilco draft does not carry the field at all.** Read from
  `canonical_presentation_draft.definition` on 2026-09-14: the whole definition
  contains the string `requiredContent` **zero** times, and the stored
  `temas-recorrido` block has `slot`, `content: null`, `visible: true` and no
  such key. The draft was saved on 2026-09-08, before the field existed, and the
  6B.4B2E rebind changed **only** the binding — which is exactly what its
  byte-identity proof established.
- So for THIS document `requiredBlockIds` is empty, `painContentIsRequired` is
  false, and the preflight correctly classifies the empty slot as the
  acknowledgeable warning `configuration_required_blocks`. **The product is
  behaving correctly; the old sentence described the code while the screen was
  showing the stored document.**
- **Consequence, and it is a live one:** re-saving this draft from today's
  blueprint would import `requiredContent: true`, and an empty pain slot would
  then become a hard, unacknowledgeable blocker. After 6B.4B2G the slot is no
  longer empty, so that transition is now safe — but it must not be assumed to
  have been safe before.
- The two gaps surface instead as **acknowledgeable warnings**:
  `qualitative_review_pending` and `configuration_required_blocks`, the latter
  naming «Panorama del estudio · Puntos de dolor del recorrido» by its authored
  title. Each carries its own confirmation box.
- **Accidental publication is not possible.** Nothing is pre-ticked, every
  acknowledgement is a separate deliberate act, the screen states «Faltan N
  confirmaciones de arriba», and `Publicar para el cliente` stays `disabled`
  until every required acknowledgement AND the final confirmation are ticked.
- **Deliberate publication with unresolved warnings remains technically
  possible**, and the screen says so rather than hiding it. That is the designed
  boundary: showing a client the source's own coding, or a layout slot left
  empty, are decisions somebody may legitimately make — and Contract C11 means an
  unfinished section renders as nothing on the client side, not as a placeholder.
- **No acknowledgement and no publication occurred in 6B.4B2G.** Verified after
  the transcription: 1 warning present, 0 ticked; final confirmation unticked;
  publish control still `disabled`; all five publication tables empty.

#### Still deferred, and deliberately so

No publication was created, prepared, published, restored or archived; no
current-publication pointer exists; no publication event was written. No
qualitative sign-off was recorded and no journey pain decision was made. Nothing
was deployed, no application code was promoted, the client route was not
switched, no legacy draft was converted, no formula or approved value moved, no
credential was rotated, and shadow mode is still off everywhere. `main` is
unchanged.

---

## Unit 6B.4B2G — evidence-based editorial transcription from the CEO-approved dashboard

**2026-09-14, from commit `5176416`.** The fifteen journey-pain decisions were
transcribed mechanically from the committed CEO-approved emergency dashboard,
through the real authenticated Studio routes. No publication was created.

#### The artifact this is transcribed FROM

| | |
|---|---|
| repository | `C:\dev\becommunity-software\becommunity-bni-cuicuilco-demo` |
| commit | **`a7248fdbccd139da80ed7c09daa70f006a62b9cf`** |
| refs | exactly one — `refs/heads/master` at that commit; nothing newer exists |
| worktree | clean *ignoring line endings*: Windows checked it out CRLF, so twelve files read as modified from WSL and every one is byte-identical to its blob with CR stripped. Evidence was read with `git show <commit>:<path>`, never from the working tree |
| clean workbook | `sha256:8d7afdb479208d47e4cd2b08fac5d480f3f945edcf448f52eb588a41e167bca5` — the copy the dashboard reads and the copy the canonical pipeline reads are **the same bytes** |

The approved dashboard repository was **not modified**.

#### How each mapping was proved — column identity, never resemblance

1. The approved dashboard reads the CSAT sheet in **column pairs**: the question
   in column `c`, its classification in `c+1`. Its touchpoint label is row 2 of
   `c+1`; its id is `slug(layer)--slug(label)`. The layer comes from row 1, which
   the sheet carries in **four merged ranges** (`D1:BI1`, `BJ1:BU1`, `BV1:CO1`,
   `CP1:DI1`) — resolved from the workbook's own declared ranges.
2. The canonical registry addresses the **same column `c`** by its full survey
   prompt. Two readers of one spreadsheet column describe one thing. All **55**
   dashboard touchpoints resolved to exactly one canonical handle each.
3. **Self-check:** re-reading the sheet reproduced all 55 committed touchpoint
   ids and labels in `public/data/snapshot.json` exactly.
4. The stage-to-touchpoint association is the approved artifact's **own committed
   configuration** — `PAIN_ALIAS` (38 entries), `PAIN_SOURCE`, `TEAM_ROUTE` in
   `scripts/lib/extract.ts` — **parsed out of that file, not retyped**.
5. The approved wording was compared with the canonical curated phrase letter by
   letter. The dashboard's cloud splits a workbook cell into sentences; rejoining
   them is the identity of the cell.

ⓘ **`BNI Connect` and `App celular` are NOT ambiguous under this artifact.** The
phrase «Mayor entrenamiento.» is identical on both, but they are two different
canonical rows with two different stages, and `PAIN_ALIAS` declares
`Plataforma BNI Connect → BNI Connect` and `App BNI Connect (Celular) → App
celular`. One touchpoint each, from the artifact's own table — not from
similarity, position or colour.

ⓘ **The Journey worksheet's stages-with-pain and the canonical fifteen are a
bijection.** «Bienvenida» and «Reunión semanal presencial/en línea» carry no pain
in the approved snapshot, so the one stage that spans two touchpoints never
arises among the fifteen.

#### Evidence classification — all fifteen

| classification | n |
|---|---:|
| EXACT_PROVEN | **15** |
| PROVEN_EXCLUDED | 0 |
| PROVEN_GLOBAL_ONLY | 0 |
| AMBIGUOUS | 0 |
| ABSENT_FROM_APPROVED_ARTIFACT | 0 |
| CONFLICT_WITH_CANONICAL_SOURCE | 0 |

Dry-validated before any write through the product's own rules — the same
`buildPainReviewItems`, `painSourceDigest`, `painTouchpointChoices` and
`PAIN_REVIEW_LIMITS` the server uses: **135 checks, 0 failed**, simulated
completion `gaps = none`.

#### What was written, and how

**Through the real authenticated application only** — `/login`, then
`/studio/e/cd4d6acd…/revision/dolor`, opening each item, typing the approved
public text, ticking the touchpoint and pressing «Aprobar y asignar». No SQL, no
RPC, no direct table write. **142 checks, 142 passed.** Each decision was
verified on a **fresh page load** before the next was attempted.

- **15 of 15** journey items now read «Aprobado», each mapped to **exactly one**
  canonical touchpoint, each public phrase byte-identical to the plan, each
  stored `source_digest` equal to the digest the plan predicted, no rationale
  invented. The review reports itself **complete**; `dolor-faltantes` is gone.
- **0 unresolved, 0 undecided, 0 items left for a human** in this queue.
- Post-write read-only verification: **121 checks, 121 passed.**

ⓘ **`canonical_journey_pain_decision` holds 20 rows for 15 decisions in force.**
The table keeps history; the product's own
`read_canonical_journey_pain_decisions` returns the latest per item. The five
superseded rows are the ones described next.

#### Records that already existed, and the limit on attributing them

**The review tables were NOT empty when this unit began**, contrary to the
unit's stated baseline. Between 6B.4B2F proving all three tables empty
(~18:26 UTC) and this unit's first hosted contact (19:11 UTC), the following was
recorded by account `06e3b329-70b4-4a29-9649-6c1e2b069664`
(`test-internal@becommunity.test`) through the running local server:

- **18:53:03** — one `canonical_qualitative_signoff`, digest `4ed838c4…`;
- **18:53:45 → 18:54:23** — five journey items marked `unresolved`, no rationale:
  `ppb423ot3a2jqzsi6t`, `ppawbwjs65joodprei`, `pp3sfkielw4zxlmjwd`,
  `ppw7yj73tpjbqnwvgh`, `ppzj7jj6gbertay53s`.

ⓘ **Attribution is NOT established and must not be asserted.** The operator and
this agent authenticate as the same internal account, so `decided_by` /
`reviewed_by` cannot distinguish them; only the timestamps place these records
outside any window in which this agent contacted the hosted project. What is
recorded is: *the internal account, at those times*. Who was at the keyboard is
not proved by anything in the database.

The operator was asked and directed that the five `unresolved` rows be treated as
exploratory and superseded by the evidence-based transcription. They were, and
they remain in the table's history.

#### The qualitative sign-off — NOT written by this unit

This unit **wrote nothing** to `canonical_qualitative_signoff`. The pre-existing
record of **18:53:03** is current for today's exact category set, so the
interface renders no sign-off control at all — there was nothing to press, and
nothing was pressed. Verified after the transcription: still one row, same
digest, same timestamp.

Phase B reconciled that record's subject against the approved dashboard
independently, and it matches on everything the authorization enumerated:

- **all 8 visible categories**, letter for letter, in order, with identical
  counts and shares — «Miembros activos» 11 / 4 / 3 / 1 of 19; «Desertores»
  7 / 2 / 1 / 1 of 11;
- **family assignment** matches;
- **inclusion/exclusion behaviour** matches: the not-applicable bucket is outside
  the cloud and reported beside it, count **9** for active members and **0** for
  leavers, in both.

ⓘ **Two adjacent strings differ, and neither is a category, a family or a
count.** The canonical product calls the excluded bucket **«No aplica»** where
the approved dashboard displays **«Sin razón aplicable»**; and the active group's
instrument reads «…de la pregunta abierta del **índice de renovación**» against
the dashboard's «…del **CRI**». Same buckets, same counts, same behaviour,
different display wording. They are recorded here because the signed digest
covers the excluded label, so a future reader comparing the two artifacts will
meet this difference and should not mistake it for drift.

#### Everything that did NOT move — verified read-only after the write

- **results parity 531/531** (`ofrecidas=534 ejecutadas=531 aprobadas=531
  falladas=0`) and **presentation parity 59/59**, both with the two real
  workbooks supplied;
- the canonical draft is still **revision 2**, schema 4, binding
  `e2ee45b4…`, and its `definition_sha256` is still **`78a34758…`** —
  byte-identical, so the document, its one page, its 24 blocks and its
  **`samplePolicy {mode: show_all}`** were not touched by any editorial act.
  **No automatic small-sample suppression was introduced.** The draft log still
  holds 2 events;
- all five **publication tables EMPTY**, no current-publication pointer, no
  publication event — **the client still sees nothing**;
- `canonical_publication_qualitative_signoff` **empty**;
- both legacy drafts unchanged — Cuicuilco **v2/72**, P6E **v3/14**;
- **all 50 `pain_point` rows still `review_status = 'pending'`** — the editorial
  act wrote to migration 0032's own table and never to the canonical source;
- study 5 · respondent 82 · quant_response 3364 · qual_observation 33 ·
  study_participant 60 · survey_response 1685 · performance_observation 252 ·
  metric_definition 116 — all unchanged;
- `test:journey-pain-review` **261/261**, `test:canonical-publication` **268/268**;
- `origin/main` unchanged at `c76762f4…`.

#### One gate now fails by design, and it must be fixed deliberately

ⓘ **`npm run test:canonical-presentation-hosted-fingerprint` is 72/74.** The two
failures are exactly its two «and it is EMPTY — no editorial decision has been
recorded in it» assertions, which now read 1 sign-off row and 20 decision rows.
The gate encodes the PRE-transcription expectation; this unit deliberately
invalidated it and did **not** edit the gate, because this unit's code changes
were scoped to documentation. Its publication-table assertions all still pass.
**This is an expected, explained failure and is not a pass.** A later unit should
re-pin those three assertions to the new true state — 1 sign-off, 15 decisions in
force, publication tables still empty — rather than relaxing them.

#### Provenance, stated exactly

The fifteen journey decisions were **mechanically transcribed by the
authenticated operator from a committed artifact the CEO had already approved and
that was presented to the client**. They are **not** a live review performed by
the CEO in this interface, and the persistence model has no field for that
distinction — no schema change was made to add one. The distinction lives here
and in the external evidence packet.

External evidence, outside every Git repository, at `~/becommunity-6b4b2g/`
(WSL): `evidence-matrix.json`, `evidence-matrix-<stamp>.csv`,
`pre-write-report-<stamp>.md`, `decision-plan-<stamp>.json`,
`forensics-preexisting-records.txt`, `transcription-result.json`,
`verification-result.json`, and `screenshots/`.

#### What is left for a human

One decision, and it is not editorial: **whether to publish.** The review is
complete, the pain cloud and its touchpoint badges are authorized, the sign-off
is current, and the publish control is reachable behind one remaining
acknowledgement plus the final confirmation. Nobody has ticked either.

---

## Unit 6B.4B2H — the legacy draft's capability, and the final prepublication rehearsal

**2026-09-14, from commit `e1c5748`.** Two technical gaps closed, one hosted
mutation, one defect found and fixed by the rehearsal itself, and **no
publication**.

### The legacy-field omission, and what it cost

The Cuicuilco draft was saved on 2026-09-08, **before `requiredContent` existed
on `PresentationBlock`**. Read from the hosted definition: the key occurred
**zero** times in 16 639 bytes. `requiredBlockIdsOf` therefore returned an empty
set, `painContentIsRequired` was false, and the publication preflight classified
the empty journey pain slot as the ACKNOWLEDGEABLE warning
`configuration_required_blocks` where today's blueprint — which does pass
`required = true` for `temas-recorrido` — intends the non-acknowledgeable blocker
`required_content_missing`.

Nothing was defective. The code and the stored document were simply of different
ages, and §"What actually stops a publication" above records that reading.

### The upgrade — one field, and it is proved to be one field

A new explicit server path, mirroring the rebind's discipline exactly:
`assessCapabilityUpgrade` / `describeCapabilityUpgrade` /
`upgradeStoredPresentationCapabilities` in `presentation-workspace.ts`, the
action `upgradeCanonicalPresentationCapabilities`, and the
«Declarar contenido obligatorio» panel. It takes **three scalars** — study,
expected revision, retry key — so there is no parameter through which a browser
could name a block, assert a flag or supply a document. The required set is read
on the server from `chooseBlueprint`, the same selection the composer uses.

It refuses to write unless **both** of these hold:

1. the document with every `requiredContent` stripped is **byte-identical**
   before and after — so anything else that moved moves those bytes;
2. deleting exactly the keys it would add **reproduces the stored definition
   exactly** — so «only metadata was added» is a fact about bytes, not a claim
   about code.

It also refuses if the binding would move, or if the document stops resolving.
It never runs on a read or a page load.

#### The hosted mutation — the only one this unit made

| | before | after |
|---|---|---|
| revision | **2** | **3** |
| binding | `e2ee45b43fe99102776d4617e12d9a7584d764ddd792199c0dbb96b08a25e2d2` | **unchanged, byte for byte** |
| `definition_sha256` | `78a34758eca3b3d59349fd1dd09ae24114122a2d27575b9c35d852823b25a52d` | `5f1ec0349f81a155e97f52a4aeea5f555fb02e5054b6d8c1da084e3ff057f4da` |
| registry version | `1.0.0` | unchanged |

Performed **through the real authenticated route** — `/login`, then
`/studio/e/cd4d6acd…/construccion`, one press — with expected revision 2 and one
fresh key `capability-r2-mu1vxnkv-cih6ajk5`. No SQL, no RPC, no direct write.

**EXHAUSTIVE FIELD-LEVEL CLASSIFICATION — one field changed:**

| path | block | before | after |
|---|---|---|---|
| `$.pages[0].blocks[21].requiredContent` | `temas-recorrido` («Puntos de dolor del recorrido») | *(absent)* | `true` |

And **nothing else**: deleting that one key reproduces `78a34758…` exactly. Read
back field by field afterwards — 1 page, 24 blocks, `samplePolicy {mode:
show_all}` with **no block overriding it**, disclosure `plain_language_with_base`,
title intact, `metadata.subtitle` still `null` (carried across by hand, not
stamped), envelope still naming the study. The draft log holds three events:
`draft_created`@1, `draft_saved`@2 (the rebind), `draft_saved`@3 with the note
«capacidad declarada: requiredContent en 1 bloque(s)».

#### The disposable proof, before anything hosted was touched

`npm run test:canonical-capability-upgrade` — **59 assertions, 59 passed**,
against a disposable PostgreSQL 17 + real PostgREST, with a draft planted at
revision 2 whose `requiredContent` had been stripped. It proves: revision 2
becomes 3 **exactly once**; the same key **replays** and makes no revision 4; a
fresh key over the upgraded row is «nothing to do» rather than a fourth
revision; a **stale** expected revision is a typed `conflict` naming the current
one; **another tenant** is refused; **only** the classified metadata changes;
**removing it reproduces the revision-2 definition exactly**; the binding, the
authored content and the envelope's subtitle do not move; and the qualitative
sign-off stays **current**, the journey decision stays in force and not stale,
and the three publication tables stay empty.

ⓘ **THE FIXTURE NEEDS THE REAL WORKBOOKS, AND THE GATE SAYS SO.** Only
`cuicuilco-aprobado` marks any block required, and `chooseBlueprint` selects it
only when the registry publishes every handle it names — which the synthetic
package does not. The first run of this gate produced `inicio-generico`, whose
blocks are all optional, and so «passed» while testing the «nothing to do»
branch. It now commits the real package and is **SKIPPED, never passed**, when
the workbooks are absent.

### A defect the rehearsal found, and fixed

ⓘ **The preview action did not carry the authored journey pain content.**
`previewStoredPresentationUnderSelection` resolved the stored draft under a
reviewer's filter selection but never loaded the pain review, so the moment a
reviewer touched **any** filter control the «Puntos de dolor del recorrido»
block and **all fifteen** touchpoint badges disappeared from the preview — and
«limpiar filtros» did not bring them back, because clearing is another round
trip through the same action. Only a full page reload restored them. Measured:
25 blocks / 15 badges on load → 24 / 0 filtered → 24 / 0 cleared → 25 / 15 after
reload.

That is the one thing that screen exists to prevent: a reviewer could have
approved a preview showing strictly less than the client would receive. The fix
is the same two steps `assemble` already took — resolve once to learn the offer,
load the review against that model, resolve again with the content — and after
it: **25 / 15 in every state**.

### The final prepublication rehearsal — 44 checks, 44 passed

Through the real authenticated routes, pressing nothing that publishes.

| | |
|---|---|
| **hard blockers** | **none.** The `bloqueos` section is not rendered |
| **acknowledgeable warnings** | **one** — `granular_filter_dimensions`, unticked |
| | `qualitative_review_pending` **gone** — the sign-off cleared it |
| | `configuration_required_blocks` **gone** — the slot is authored now, and **no blocker replaced it** |
| **informational** | 24 client-visible blocks of 24, 1 page |
| **required content** | satisfied; no warning names the pain block any more |
| **qualitative sign-off** | **current**; no sign-off control is offered because nothing is pending |
| **journey review** | «SIN REVISAR 0 · APROBADAS 15 · EXCLUIDAS 0 · SIN RESOLVER 0», no gaps |
| **binding** | current — the review resolved the stored draft and Construcción offered no rebind |
| **sample policy** | `show_all`, not overridden by any block; nothing says a result was hidden for its size, even under a narrow selection |
| **publication** | none exists; publish **DISABLED**; «Falta 1 confirmación de arriba»; final confirmation unticked |

**Visual rehearsal**, on the canonical client preview:

- the **15 approved mappings render exactly where they were mapped** — one badge
  each, on precisely the fifteen touchpoints the approved artifact named, with
  **BNI Connect (versión web)** and **App BNI Connect (celular)** each carrying
  their own, so the ambiguity the artifact resolved stayed resolved;
- the **two qualitative clouds match the CEO-approved dashboard exactly** — all
  eight categories with identical counts and identical shares;
- a real filter selection **recomputed on the server**, and **clearing restored
  the baseline exactly** (16 250 characters and 22 terms, both ways);
- **desktop 1440 / tablet 834 / mobile 390**: no horizontal overflow, all 15
  badges drawn at every width;
- **nothing internal crosses** — no review marker, state, token or identifier.

ⓘ **THE CLIENT PREVIEW IS THE ONE INSIDE THE REVIEW PAGE.**
`/studio/e/<id>/vista-cliente` is the LEGACY P8 pivot experience and draws no
canonical presentation at all — it contains the string «Puntos de dolor» zero
times. The first rehearsal measured it and reported thirteen false failures.
The canonical client screen is `[data-testid="vista-cliente"]` on the review
page.

ⓘ **ONE HONEST DIFFERENCE FROM THE APPROVED DASHBOARD, and it is by design.**
The journey pain cloud draws **14 phrases**; the approved dashboard drew **79
sentence fragments** of the same workbook cells. CLAUDE.md forbids copying its
phrase-splitting rule, and the contract counts phrases rather than pairs — a
phrase mapped from two source items reads «Mayor entrenamiento.: 2 menciones».

### The corrected hosted gate

`test:canonical-presentation-hosted-fingerprint` was **72/74** after 6B.4B2G,
failing exactly its «and it is EMPTY» assertions. It is now **136/136** and
asserts SEMANTICS, not counts:

- exactly **15** decisions **in force** — the latest per item key, the same rule
  migration 0032's read function applies, restated rather than called because
  this file contains no `.rpc(` at all;
- every one **approved**, every one carrying a **non-empty public phrase**, and
  every one targeting **exactly the pinned canonical handle**;
- **0 unresolved in force**; **0 undecided**, measured against the source's own
  15 journey-scoped `pain_point` rows rather than assumed;
- the **5 superseded rows** stay superseded, are strictly older than what
  replaced them, and belong to items that are decided now;
- exactly **one** qualitative sign-off, for this tenant and study, against the
  **current evidence digest**;
- publication tables still **empty**;
- the draft's revision, binding, digest, page and block counts, `show_all`
  policy and declared capability all pinned, and the **revision-2 reproduction**
  checked.

ⓘ **THE PUBLIC PHRASES ARE DELIBERATELY NOT PINNED.** They are a real client's
curated prose and that never enters this repository. Their PRESENCE is asserted
instead. The item keys and touchpoint handles are opaque and carry no prose.

**The gate was proved to discriminate** by perturbing its own expectations —
never hosted data, which this unit was not authorized to touch beyond the one
draft upgrade — and restoring the file byte-identically each time
(`sha256 cee3bbb596beb623…`, identical before and after):

| perturbation | caught |
|---|---|
| one current journey decision retargeted to `g1-t99` | ✓ 1 failure, naming the item and its real target |
| the sign-off digest changed by one character | ✓ 1 failure |
| a publication table expected to hold a row | ✓ 3 failures |
| the revision-2 reproduction digest changed by one character | ✓ 1 failure |

### Verification after the mutation — read-only

- draft **revision 3**, binding unchanged and **resolving**; only the classified
  field changed (44 assertions, 44 passed);
- **results parity 531/531**, **presentation parity 59/59**;
- **15** journey decisions in force, all approved, one touchpoint each; the table
  holds 20 rows with history;
- qualitative sign-off still **one row**, same digest `4ed838c4…`, same timestamp
  `18:53:03` — this unit wrote nothing to it;
- **all five publication tables EMPTY**, and
  `canonical_publication_qualitative_signoff` empty;
- legacy drafts unchanged — **v2/72** and **v3/14**;
- canonical source unchanged — 50 `pain_point` rows all still `pending`, study 5,
  respondent 82, quant_response 3364, qual_observation 33, study_participant 60,
  survey_response 1685, performance_observation 252, metric_definition 116;
- sample policy **show_all**; `origin/main` unchanged at `c76762f4…`.

### Gates

`typecheck` **0 errors**; `lint` **0 errors, 54 warnings** (the baseline);
`build` passes; `test:canonical-presentation`, `test:canonical-presentation-persistence`,
`test:journey-pain-review` **261/261**, `test:canonical-publication` **268/268**,
`test:publication-boundary`, `test:canonical-composer`,
`test:canonical-capability-upgrade` **59/59**,
`test:canonical-presentation-hosted-fingerprint` **136/136**, results parity
**531/531**, presentation parity **59/59** — all pass.

ⓘ **`npm test` exits 1 on `test:hosted-target-guard` §[8], and it is the SAME
baseline-identical environmental failure 6B.4B2D and 6B.4B2E recorded** — «the
refusal names the main-repository rule, so the worktree rule did not answer for
it». It builds `<root>/../becommunity-software/evidence` expecting a sibling main
repository, and the WSL verifier is a plain clone AT that path. It concerns
`scripts/lib/hosted-target.mjs` and evidence-path rules, neither of which this
unit touched. **It is not called a pass.**

ⓘ **That gate is number 23 of 53, so 30 gates never run in the chain.** All
**30 were run individually and all 30 passed**: `import-center`, `templates`,
`bi-filters`, `qualitative`, `confirmed-qualitative`, `client-boundary`,
`publication-boundary`, `data-scope`, `client-admin`, `study-config`,
`client-preview`, `longitudinal`, `narrative-home`, `server-pdf`,
`tenant-branding`, `validation`, `pivot`, `suite-a-selftest`,
`suite-bc-selftest`, `design-tokens`, `studio-workflows`, `studio-completion`,
`insights-story`, `p8-qualitative`, `p8-acceptance`, `private-metadata`,
`data-completeness`, `segments`, `periods`, `xlsx-hardening`.

### What is left

**Publication, and nothing else.** It remains pending **explicit operator
authorization**: one acknowledgement of `granular_filter_dimensions` plus the
final confirmation, both deliberate, both untouched by this unit. No
acknowledgement was ticked, no publication was created, nothing was deployed,
and the client still sees nothing.

External evidence, outside every Git repository, at `~/becommunity-6b4b2h/`
(WSL) and `C:\dev\becommunity-review-6b4b2h\`: `upgrade-result.json`,
`post-upgrade-verification.json`, `rehearsal-result.json`, and `screenshots/`.

---

## Unit 6B.4B2I — the canonical published client read path

Baseline `1a5385de6724ee4721f470e768a5012f0ed76f93`; `origin/main` unchanged at
`c76762f428834b7401118b7d2ad7f0d40158d56a`.

**The full route and data-flow audit, the read contract, the fallback rules, the
immutability guarantees, the authorization boundary and the release ordering are
in [`docs/CANONICAL_CLIENT_READ_PATH.md`](CANONICAL_CLIENT_READ_PATH.md).** What
follows is the summary and the state that changed.

### The finding this unit exists to close

**«Publicar para el cliente» did not mean a client route was connected.** The
publication storage existed (0030), the review existed, the publish path existed
and the database's own client projection existed — and `/insights/e/[studyId]`,
the only client-facing study route, called `loadStudyDashboard` and rendered the
**legacy P8 dashboard**. The canonical publication tables were unreachable from
it by any import path. A publication would have written an immutable snapshot,
moved a pointer and recorded a named person's acknowledgement, and no client
could have seen any of it.

Production made that worse rather than better: the deployed Worker contains none
of the canonical code — so the deployed app has no code that could read a
canonical publication even though the hosted database has the tables.

ⓘ **This paragraph used to say the deployed Worker «is built from `main`, whose
tree stops at migration `0021`». Unit 6B.4B2J read the account and found both
halves wrong** — it is built from `4b0af06`, which is on no branch this work
touches and carries migrations to `0022`. See that unit's section below and
`docs/CANONICAL_CLIENT_READ_PATH.md` §6a. The conclusion — no canonical code is
deployed — is unaffected.

### What changed — one route, one reader, one action

| File | |
|---|---|
| `src/lib/studies/published-presentation.ts` | **New.** The server-only client reader. Holds no canonical reader of its own |
| `src/lib/publication/client-read.ts` | **New.** Its pure, client-safe vocabulary |
| `src/app/insights/e/[studyId]/page.tsx` | Serves the active canonical publication when there is one; otherwise the legacy behaviour, unchanged |
| `src/app/insights/e/[studyId]/actions.ts` | **New.** One Server Action so a reader's filters recompute on the server |
| `src/components/insights/PublishedStudyView.tsx` | **New.** The reading surface. Mounts the same renderer with the same audience |

`readPublishedPresentation` **moved** out of `publication-workspace.ts` rather
than being copied: two implementations of «what a client is served» would be two
chances for the served thing and the reviewed thing to drift, and a client route
must not have a module that can publish in its import graph.

### The contract, in four sentences

1. A client is served the **immutable stored snapshot**, byte for byte — never
   the draft, never a recomputation of it, never the legacy engine.
2. No publication → the documented legacy behaviour, preserved exactly. A
   publication that cannot be read → a sentence, and **never** a silent fallback
   to different numbers from a different engine.
3. A filter is applied only when **recomputing the whole publication under the
   neutral selection reproduces `render_model_sha256` exactly**; otherwise the
   selection is refused, the snapshot is served unchanged, and the filter panels
   are not mounted at all rather than offered and refused on every click.
4. Authorization is done by the reader, with the **reader's own session**, and
   the tenant comes from the authorized row. The privileged client is
   constructed only after that has succeeded.

The reproduction check is deliberately stricter than a binding comparison, and
the difference is executed rather than argued: deleting one answered
`survey_response` leaves the frozen document **still resolving** — same binding,
same registry, same addresses — while the model it produces no longer digests to
what was published.

### Proof

| | |
|---|---|
| `test:canonical-client-publication` | **99/99** offline |
| `test:canonical-client-publication-live` | **78/78** against a real PostgreSQL behind a real PostgREST |
| `qa:canonical-client-publication` | **64/64** real routes, real browser, real package, disposable target |
| `test:shadow-boundary` | **98/98**, and its door check is now a **cut** |
| discrimination | **5/5** perturbations caught, every file restored byte-identically |

The QA's strongest line: the client's own screen and the internal review's
preview of the same publication are **character-for-character identical**
(15 692 characters), read from the same `presentacion-canonica` hook on both
surfaces. That is what makes «revisé la vista del cliente» a true statement, and
it carries 6B.4B2H's approved-dashboard comparison forward to the client's screen.
On the real package the client's surface draws **24 client-visible blocks** and
**15 pain-badged touchpoints**, at 1440, 834 and 390 layout pixels, with no
horizontal overflow and nothing internal in the page.

### The dependency gate got stronger, not looser

The door table's `loader` became `loaders`, and the check became a **cut**:
remove the declared loaders from the import graph and the canonical layer must
become unreachable from the page. That is «every path goes through a declared
door»; the earlier check only ever measured the shortest of several paths, which
mattered the moment the insights page acquired a second legitimate reason to
reach the canonical layer.

The cut immediately surfaced something the old check had never been able to see:
the two review pages reach `canonical-commit/sha256.ts` — a pure hash helper —
without passing through a loader, because the journey-pain digest imports it.
That is excluded by name and the exclusion is **proved**: the check requires each
named helper to import **nothing at all**.

### Hosted, read-only — nothing was published and nothing changed

`~/becommunity-6b4b2i/hosted-readonly.json`, **24/24**:

- the Cuicuilco canonical draft is still **revision 3**, digest
  `5f1ec0349f81a155e97f52a4aeea5f555fb02e5054b6d8c1da084e3ff057f4da`, binding
  `e2ee45b43fe99102776d4617e12d9a7584d764ddd792199c0dbb96b08a25e2d2`;
- all four canonical publication tables **empty**, and the legacy
  `study_experience_publication` **empty** as well;
- **the new client reader, executed for real against hosted data, serves
  `not_published` and carries no payload** — so it cannot expose the draft even
  now, before any deployment;
- 15 decisions in force, all approved, 20 rows total; one qualitative sign-off at
  `4ed838c49fba6f544fd239d1395fa691c6efc0979f80190af826749cb561ff0b`;
- production `/api/health` answers 200 `ok`, and `origin/main` is unchanged.

### Two release blockers this unit found, which are not this unit's to fix

1. **`study.status` for Cuicuilco is `draft`.** `published_study_select` gives a
   client a study only when it is `published`, and the canonical publish path
   does not touch that column. **A canonical publication alone leaves the study
   invisible to its own client.** The live gate executes exactly this case.
2. **The Cuicuilco tenant has zero profiles.** No client account exists, so there
   is nothing to verify as a client with. One must be provisioned first.

### Deployment before publication

Publishing first would be a **silent no-op with a misleading audit record**:
production has no code that could read the publication, so every client would
keep seeing the legacy dashboard while the database recorded that a named person
had published. Deploying first changes nothing anybody sees — with no
publication the reader answers on its `not_published` branch and today's
behaviour is preserved byte for byte — so the deployment can be verified at
leisure and publication becomes the single deliberate moment a client's screen
changes. The full nine-step sequence and the three rollback levers are in
[`docs/CANONICAL_CLIENT_READ_PATH.md`](CANONICAL_CLIENT_READ_PATH.md) §6.

### What is left

**Deployment, then publication.** Cuicuilco remains **unpublished**; nothing was
acknowledged, nothing was published, nothing was deployed, no PR was opened and
`main` was not touched.

External evidence, outside every Git repository: `~/becommunity-6b4b2i/`
(`hosted-readonly.json`, `client-qa-result.json`, `screenshots/`).

---

## Unit 6B.4B2J — the protected release-candidate preview, and what it found

Baseline `18dd8c563a8856f8b243b80ef0acfae68b07eed5`; `origin/main` unchanged at
`c76762f428834b7401118b7d2ad7f0d40158d56a`. **No merge, no production deploy, no
publication, no study-status change, no client account.**

### What was deployed

A **version**, not a deployment. `wrangler versions upload` on the existing
Worker created **`e2cabbf9-7100-414d-bf32-66f4c2c0f3ba`**, tag
`rc-6b4b2j-18dd8c5`, at
**`https://e2cabbf9-becommunity-v1.ollinagencyllc.workers.dev`**.

Built from a **clean worktree at the exact commit** with no `.env` file:
`next build` + `opennextjs-cloudflare build`, worker.js
`d05223bf4d44c84108a102ab62aa3bc9c5568f0c3ac2064c37be5cc65c64bc45`, BUILD_ID
`ndKcGirfSH-dn5CmZH4gO`, compiled env snapshot **empty** (three empty objects),
`test:secrets` passed, and the four configured credential values appear in **0**
files of the artifact. The preview serves that BUILD_ID; production serves
`vD8W7i8ruS3W_UdFMujl0`.

**Production untouched, proved three ways:** active version `e691ecd8…` before
and after, 10 deployments before and after, and an unchanged served-asset
fingerprint `c033c593…`. Hosted state unchanged too — the read-only check
**24/24** and the fingerprint gate **136/136**, still exactly one canonical
draft at revision 3, publication tables empty, 15 decisions in force.

### The topology was inferred for months. Three inferences were wrong.

Full evidence in [`docs/CANONICAL_CLIENT_READ_PATH.md`](CANONICAL_CLIENT_READ_PATH.md) §6a.

1. **Production is not built from `main`.** It runs `e691ecd8`, deployed
   2026-08-28, built from `4b0af06` — on `claude/bni-executive-preview-hotfix`,
   an ancestor of neither `main` nor this branch, carrying **14 commits present
   in neither**, including the «Revisar categorías» feature and three insights
   fixes. The previous unit's documentation said otherwise; it has been corrected.
2. **A branch push DOES build, into a version, never a deployment.** Four pushes
   produced four versions ~90 s later while the deployed version never moved. So
   a protected preview already existed for this commit — Cloudflare's own
   `fcdd9970`.
3. **`keep_vars = true` is on the deployed commit and missing from this branch.**
   Without it `wrangler deploy` deletes the dashboard-set variables before
   applying the config's, and the config declares none. **Restore it before any
   deploy from this branch.**

### ⚠️ The finding: a canonical read fails on the Cloudflare edge, and nowhere else

| where | `/revision/dolor` counters (unreviewed/approved/excluded/unresolved) |
|---|---|
| local Node, this commit, hosted database | **0 / 15 / 0 / 0** |
| local workerd (`wrangler dev`), same artifact | **0 / 15 / 0 / 0** |
| deployed `e2cabbf9` (built here) | **0 / 0 / 0 / 0** |
| deployed `fcdd9970` (**built by Cloudflare**, same commit) | **0 / 0 / 0 / 0** |
| deployed `2784061d` (Cloudflare, previous commit) | **0 / 0 / 0 / 0** |

Not the build, not this commit, not workerd — **deployment on the edge**.
`loadCuratedPainReviewEvidence` throws there; `loadJourneyPainReview` catches it
and returns an applicable-but-empty review; the preflight raises
`required_content_missing` and `journey_pain_review_incomplete` as **hard
blockers** on a study whose fifteen decisions are all recorded and approved.

Leading hypothesis: the **Workers free-plan 50-subrequest ceiling** — the late
reads degrade (the qualitative sign-off also reads `pending` where it is
`current` locally) and the early ones do not. **Not proven:** the thrown
`CanonicalReadError` code is swallowed and surfaced nowhere, which is itself
worth fixing. Pinning it needs one instrumented version.

**Two consequences bigger than the cause.** A canonical read failure is shown to
a reviewer as «the editorial review is unfinished» — indistinguishable from real
unfinished work, on the screen whose whole job is to say whether the work is
done. And the client's filtered read runs the same `readAndBuild` plus the same
pain read, so **the canonical client path cannot be assumed to work on
Cloudflare**. No gate has ever exercised it there; every one ran under Node or
local workerd.

### Preview QA — 72 checks, 62 passed, 10 failed

All ten failures are that one finding. What passed: `/api/health` 200 `ok`; the
CSP names exactly one Supabase project and it is the expected one; five
protected routes answer `/login` to an anonymous visitor and leak nothing;
internal sign-in and sign-out; an internal person on the client route is sent to
the internal preview; three viewports compose without overflow and suppress no
block; **a real client on a real published study with no canonical publication
gets the documented legacy behaviour** — the `not_published` branch, on the
hosted project, with a real account; another tenant's client is refused; and 23
separate leak checks find nothing internal in the client's page.

### Honest limitations of this preview

It shares the hosted Supabase project, so it is **not** an isolated environment —
only an isolated *version*. Cuicuilco is unpublished, so the preview proves the
`not_published` branch and the protected internal surfaces, and **proves nothing
about the hosted canonical-publication branch**; that was proved in disposable
infrastructure. Login and logout do write hosted Auth state; no study,
publication or editorial row was touched, and the fingerprint gate confirms it.

### What is left

Resolve the edge read failure, restore `keep_vars`, decide about the 14
production-only commits — then merge, deploy explicitly, provision a client
account, set the status, and publish. Cuicuilco remains **unpublished**.

External evidence, outside every Git repository: `~/becommunity-6b4b2j/`
(`preview-qa-result.json`, `hosted-before.json`, `hosted-after.json`,
`cf-deployments-*.txt`, `dryrun.txt`, `screenshots/`).

---

## Unit 6B.4B2K — the Cloudflare edge failure, named and removed

Baseline `dde1e1e1852651c102a5582d13b0f823810f6325`; `origin/main` unchanged at
`c76762f428834b7401118b7d2ad7f0d40158d56a`. **No merge, no production deploy, no
publication, no study-status change, no client account.** Migration `0033` WAS
applied to the hosted project; nothing else there moved.

### The root cause, measured rather than inferred

Unit 6B.4B2J found a canonical read that fails on the Cloudflare edge and
nowhere else, and named the free plan's fifty-subrequest ceiling as a
*hypothesis* it could not test, because every transport failure on that path was
reduced to one code before anyone could see it.

It is now **measured**. A diagnostic version instrumented the affected page
itself — no new route, no new URL, behind the same `requireInternal()` — and
counted every outbound request one HTTP request makes, reporting the ordinal and
a closed code for the first that failed:

```
outboundTotal : 62      failureCount : 12
firstFailure  : { n: 51, resource: "rest:journey_stage",
                  outcome: "SUBREQUEST_BUDGET_EXHAUSTED" }
```

**Exactly fifty succeeded. Request #51 and every request after it were refused
by the runtime**, identically across runs, even though the six-way read pool
reordered the families in between. The twelve refusals are four attempts at
`journey_stage` and eight at `canonical_qualitative_signoff` — supabase-js
retries, so 53 distinct operations became 62 attempts against a budget of 50.

The refusal is the RUNTIME'S, not the database's. This is the proven cause; the
subrequest ceiling is no longer a hypothesis.

### Where the fifty went

| ordinal | what | cost |
|---|---|---|
| #1–#2 | the session and the role (`requireInternal`) | 2 |
| #3–#17 | `loadStudioStudy` — the legacy Studio shell | 15 |
| #18–#45 | the canonical row set, 26 families + gate + overflow | **28** |
| #46–#48 | the draft, the publication pointer, its history | 3 |
| #49–#51 | the curated pain phrases, stage links, stages | 3 |
| #52 | the decisions in force | 1 |
| #53 | the qualitative sign-off | 1 |

The canonical read was more than half the budget **and grew with the data** —
one more request per additional thousand `survey_response` rows. Trimming other
work would have bought a study or two; it would have climbed back over on the
next one.

### The fix: migration 0033, one round trip

`read_canonical_row_set` projects the same columns, in the same order, under the
same ceilings, scoped by tenant AND study — read-only, `stable`, `security
invoker`, `service_role` only. Full record in
[`docs/CANONICAL_STUDY_MODEL.md`](CANONICAL_STUDY_MODEL.md).

**Measured against the hosted project, before and after:**

| | before | after |
|---|---|---|
| `loadJourneyPainEditor` (`/revision/dolor`) | 36 | **9** |
| `loadPublicationReview` (`/revision`) | 36 | **9** |
| page total, server side | 51 | **24** |
| with the two authorization reads | 53 | **26** |
| margin under the fifty-subrequest ceiling | −3 | **+24** |
| journey-pain counters | 0/15/0/0 | 0/15/0/0 |

Parity is exact and was proved before the migration was applied:
`npm run test:canonical-row-set-live`, **56 checks, 56 passed** — the row set
byte-identical across both paths (26 families, 3 229 rows, each compared
separately), the results document identical, 28 requests → 1, cross-tenant zero,
67 tables unmoved, ceilings still refusing, `anon` and an authenticated client
refused over real HTTP with `42501`.

⚠️ **One term still grows with the data, and it is not the canonical one.**
`loadStudioStudy` costs 15, of which `loadStudyMetricOptions` pages the entire
legacy `quant_response` table — 4 pages for Cuicuilco. About **24 000 more
`quant_response` rows** would put the page back at the ceiling. It is legacy
code shared by a dozen Studio pages and this unit did not touch it. The budget is
no longer growing *because of the canonical layer*; it is not fixed.

### The second fix, which is independent of the cause

A canonical read failure could be reported as unfinished editorial work, and was.
`loadJourneyPainReview` caught a failed curated read and returned an *applicable*
review with no items and the gap `undecided_items`; `readDecisions` turned a
failed RPC into «no decisions». Both are gone.

* `src/lib/publication/read-failure.ts` — **eight closed codes** and one sentence
  each, about the READ and never about the study. Pure, imports nothing, so a
  `"use client"` surface may render the sentence it is handed.
  `classifyTransportFailure` READS the thrown value and retains not one byte of
  it; `CanonicalReadError` now carries the classification made at the catch site,
  where the runtime's own words were still visible.
* `PainReviewOutcome` — a read that failed is a **different type**. There is no
  `PainReviewPanel` on that branch at all, so no consumer can read a count, a gap
  or a completeness off a read that never happened.
* the preflight raises `journey_pain_read_unavailable` and **suppresses**
  `required_content_missing` and `journey_pain_review_incomplete`: a model
  resolved without content that could not be fetched cannot be judged for
  completeness. Not acknowledgeable — there is nothing to acknowledge.
* the client reader fails closed with `recomputation_refused` and keeps serving
  the **frozen published snapshot**; only live filtering is withdrawn.

`npm run test:journey-pain-review` §[15a], **296 checks, 296 passed** (from 261):
a thrown read produces a value with no `panel`, no `counts`, no `gaps` and no
`applicable` field, its sentence contains none of the five gap sentences, and a
hostile database message quoting a name and a phone number reduces to one of
eight constants with not one byte carried through.

### The boundary gate got stronger, not weaker

`.rpc()` was banned outright on the canonical read path — the right instinct, the
wrong instrument: it bans a SHAPE rather than a CAPABILITY. It is now «an
`.rpc()` call is a mutation unless it names a function on a declared allowlist»,
and a new check PROVES each allowlisted name from its own migration: declared
`stable`, no DML in the body, execute revoked from `PUBLIC`/`anon`/
`authenticated`, granted only to `service_role`. A computed name is a mutation by
default. **98 → 100 checks, 100 passed.**

### The fourteen commits production has and neither branch had

`becommunity-v1` serves version `e691ecd8`, built from **`4b0af06`** on
`claude/bni-executive-preview-hotfix`. Fourteen commits are reachable from that
commit and from neither `origin/main` nor this branch. **`main` does not have
them either** — they were deployed directly, never merged — so merging *either*
branch and deploying would remove them from production.

Classified by CODE and BEHAVIOUR, not by commit message. No patch-id matched
anything in this branch's 216 commits, so the test used was: does the FILE STATE
exist here, and is it production's? For all ten non-documentation commits the
answer was the same — **every file they touch exists here, byte-identical to
`main`, and differs from production**. The surfaces are still served: this branch
still renders the legacy dashboard through `StudyCard`, `NarrativeHome` and
`PivotExplorer` (9 references from `/insights/e/[studyId]`), and still mounts
`JourneyStagesFields` on two Studio screens.

| # | commit | subject | classification | action |
|---|---|---|---|---|
| 1 | `8bea376` | journey moment named without losing the caret | REQUIRED_TO_PORT | **ported** |
| 2 | `cda09ac` | stop the live journey gate tripping Suite D | REQUIRED_TO_PORT | **ported** |
| 3 | `28d5748` | docs(p9): journey fix and safe deploy handoff | UNRELATED_TO_RELEASE | substance folded into this unit's docs |
| 4 | `d25d0e4` | **keep the dashboard's variables when Wrangler deploys** | REQUIRED_TO_PORT | **ported** |
| 5 | `022513e` | categories: a ledger for deciding two answers are one | TRUE_PRODUCT_DECISION_REQUIRED | **not ported — see below** |
| 6 | `338e5a0` | «Revisar categorías», and the publication it can hold up | TRUE_PRODUCT_DECISION_REQUIRED | **not ported** |
| 7 | `5828131` | categories: false-merge rate, and what turns AI on | TRUE_PRODUCT_DECISION_REQUIRED | **not ported** |
| 8 | `cfdb558` | categories: let the live test clean up after itself | TRUE_PRODUCT_DECISION_REQUIRED | **not ported** |
| 9 | `8231087` | categories: drive the review screen in a real browser | TRUE_PRODUCT_DECISION_REQUIRED | **not ported** |
| 10 | `dd7ab0b` | docs: what `keep_vars` does not do | UNRELATED_TO_RELEASE | the flag itself is ported with its own comment |
| 11 | `75620a4` | make a 123-result study readable instead of exhaustive | REQUIRED_TO_PORT | **ported** |
| 12 | `a00cda1` | let the configuration choose the headline findings | REQUIRED_TO_PORT | **ported** |
| 13 | `121d84e` | let a narrow phone shrink a select | REQUIRED_TO_PORT | **ported** |
| 14 | `4b0af06` | docs: the preview repair and 54-vs-60 | UNRELATED_TO_RELEASE | — |

**Seventeen files are now byte-identical to production**, checked one by one:
`wrangler.toml`, `suite-d-supply-chain.mjs`, `PivotExplorer.tsx`,
`StudyCard.tsx`, `NarrativeHome.tsx`, `dashboard/view.ts`, `narrative.ts`,
`results.ts`, `language/results.ts`, `language/sample.ts`, `calc/engine.ts`,
`JourneyStagesFields.tsx`, `journey-picker.ts`, `MappingWorkbench.tsx` and the
three gates. `package.json` was merged by hand — the two ported test scripts and
their chain entries were added, and the category scripts deliberately were not.

#### `keep_vars = true` is back, and it records a real outage

`d25d0e4` is the one the brief named at minimum, and its own comment says why:
on **2026-08-28 a manual deploy deleted `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Worker, every route answered HTTP 500
for about nine minutes**, and service returned only after a rollback and a
corrected preview promotion. With `keep_vars` at its default a `wrangler deploy`
reconciles the dashboard's plain-text variables away, and this file declares
none. Suite D's D-g check fails if the line is removed, flipped, or if a `[vars]`
block appears — that enforcement is ported too.

#### One adaptation the port needed, stated rather than hidden

`75620a4` REMOVED `crosses` from `SafeStudyView`: a 123-result study rendered
exhaustively was unreadable, so the study now opens on one comparison the reader
picks and the series are computed on demand. This branch's shadow comparison read
`legacy.view.crosses.length`.

The number no longer exists. Putting a different quantity behind the same key
would be the silent substitution this whole unit is about, so `legacy.crosses`
keeps its finding — the legacy layer still compares and the canonical
presentation still has no map for it — and loses its value, under a new closed
code `legacy_cross_series_moved_behind_explorer`. The extent of the capability is
still reported, unchanged, under `legacy.pivot.allowlist`.

#### The one genuine product decision that remains

Five commits build **«Revisar categorías»**: about 4 000 lines under
`src/lib/categories` (a candidate generator, a decision ledger, an impact model,
a language layer and an optional OpenAI advisor behind a flag), a Studio route
`/studio/e/<id>/categorias`, a publication blocker, three gates and a 259-line
document. **It is live in production.** Its migration `0022_semantic_category_review`
is applied to the hosted project and **its file is already in this branch** — so
the tables exist and are reachable, and only the code that reads them is absent.

It was NOT ported, and the reason is not effort:

* it edits `src/lib/studies/authorized.ts`, `src/lib/calc/load.ts`,
  `src/lib/studio/study-workspace.ts`, `StudyTabs.tsx` and the LEGACY
  `/studio/e/<id>/publicar` page — every one of which this branch rewrote for the
  canonical architecture, so the port is a merge of intent, not of text;
* it adds a publication blocker to a publication path this branch replaced;
* and it raises a real question: the canonical release has its own
  `canonical_qualitative_signoff` (migration 0031) over the same category labels.
  They are NOT the same thing — the category review DECIDES that two free-text
  answers are one category, the sign-off RECORDS that a person read the resulting
  labels — but whether the canonical release ships one, the other or both is a
  product decision, not a merge conflict.

**Side by side, for the decision:**

| | «Revisar categorías» (production) | canonical qualitative sign-off (this branch) |
|---|---|---|
| what a person does | merges two answers that mean the same thing | reads the final labels and signs that they read them |
| when | before results are computed | before a publication |
| storage | `category_decision`, `study_category_snapshot` (0022, applied) | `canonical_qualitative_signoff` (0031, applied) |
| blocks publication | yes, the legacy publish page | yes, the canonical preflight |
| in production | **yes** | no |
| in this branch | **no** | yes |
| AI | optional OpenAI advisor behind a flag | none |

Nothing about this is urgent for the canonical release EXCEPT that a merge plus a
deploy removes it from production. Deciding to drop it is a legitimate answer;
dropping it by accident is not.

### The corrected preview, and what it proved on the real edge

A **version**, not a deployment. `wrangler versions upload` on the existing
Worker created **`bb742e60-7d0e-4751-a67b-bee95fa7e03e`**, tag
`rc-6b4b2k-6d7bdf8`, at
**`https://bb742e60-becommunity-v1.ollinagencyllc.workers.dev`**, from commit
`6d7bdf8` in a clean worktree with no `.env` file. Wrangler's own output: *"To
deploy this version to production traffic use `wrangler versions deploy`"* — it
was not run.

Built with **nothing baked**: no `.env` file and no `NEXT_PUBLIC_*` in the shell,
so not even the public anon key is inlined; the Worker's own variables supply
both at runtime. `test:secrets` passed, the compiled env snapshot is three empty
objects, and all four configured credential values appear in **0** files of the
artifact. BUILD_ID `kRnJ--bkYGZb6Ntgl9Kxw`; the preview serves exactly that and
production serves `vD8W7i8ruS3W_UdFMujl0`.

A diagnostic version — `1aaae465-8bcf-4d51-b279-405a2524e9bf`, tag
`diag-6b4b2k` — was uploaded first, carried the outbound ledger behind
`CANONICAL_EDGE_DIAGNOSTICS=on`, and produced the measurement at the top of this
section. Neither version was deployed.

#### Edge QA — 112 checks, 112 passed

The headline, on the screen Unit 6B.4B2J watched get it wrong:

```
SIN REVISAR 0   APROBADAS 15   EXCLUIDAS 0   SIN RESOLVER 0
15 items · the review reports itself COMPLETE · no gaps
```

and on the review beside it: **no hard blockers at all**, no pain-review blocker
true or false, the qualitative sign-off CURRENT ("Alguien registró haber revisado
exactamente estas categorías el 14/09/2026"), 15 692 characters of finished
canonical content, the publish control rendered and correctly DISABLED with every
acknowledgement unticked. Nothing was pressed that writes.

**The filters were driven, which 6B.4B2J could not do.** 49 filter groups, 311
operable options. Ticking one: the «estás mirando una selección» banner appears,
the fifteen pain badges are still drawn, the content moves 15 692 → 15 858
characters and nothing is suppressed. Ticking a second: the cloud survives both,
still no suppression. «Ver el estudio completo»: the banner goes, nothing is
ticked, the fifteen badges are back, and the preview is **character-for-character
the unfiltered one again** (15 692). `show_all` holds throughout — no block is
ever withheld for a small sample, at any viewport.

Three viewports compose without overflow and draw identical content
(15 692/15 692/15 692) with all fifteen badges. Anonymous visitors get `/login`
from five protected routes and read none of four secrets. A real client on a real
published study with no canonical publication gets the documented legacy
behaviour; another tenant's client is refused; and 27 leak checks find nothing
internal in a client's page — including the four transport-failure codes, which
are for an internal screen and never for a reader.

ⓘ **Two QA assertions were wrong and were corrected, not the product.**
`dolor-en-punto` counts the touchpoints of the OPEN route tab, not all fifteen —
the journey mounts one tabpanel at a time — so the badge count is the
case-sensitive `aria-label` one, which spans all five routes. And the sign-off's
`current` state renders a Spanish sentence, not the word «vigente».

#### Nothing else moved

**Production**, before and after: active version `e691ecd8…`, 10 deployments, the
deployment listing byte-identical, served-asset fingerprint `7b4f0455…`
unchanged, `/api/health` 200 `ok`.

**The hosted project**, before and after the QA: no table's row count changed,
15 791 rows both times, the canonical draft still at revision 3, all publication
tables still empty, 50 `pain_point` rows under an unchanged digest, 62 policies
and 42 functions, every study's status unchanged. The fingerprint gate is
**136/136**. **Cuicuilco is still `draft` and still unpublished.**

Login and logout do write hosted Auth state; that is inherent to authenticated QA
and is reported rather than pretended away. No study, publication, draft or
editorial row was touched.

External evidence, outside every Git repository: `~/becommunity-6b4b2k/`
(`edge-ledger.json`, `preview-qa-result.json`, `hosted-before-qa.json`,
`hosted-after-qa.json`, `before.json`, `after.json`, `cf-deployments-*.txt`,
`dryrun.txt`, `screenshots/`) and the backup at
`~/becommunity-backups/u6b4b2k-pre-0033-20260915T054937Z/`.

---

## Unit 6B.4B2L — «Revisar categorías», replaced canonically

The last genuine product decision Unit 6B.4B2K left open is answered: the
capability is **preserved**, and the canonical implementation — not the legacy
one — is authoritative. None of the five production-only commits was
cherry-picked, and none of their ~4 000 lines was copied wholesale; what was
carried across is the part that was measured, and it is named below.

**For Cuicuilco nothing changed.** No category was renamed, merged, split,
excluded or reassigned; no decision was recorded; the qualitative sign-off is
untouched; the draft is still at revision 3; the publication tables are still
empty; the study is still `draft` and still unpublished.

### Phase A — what the deployed feature actually does

Read off the five commits AND off the **deployed production screen**, opened
read-only as an internal operator and with nothing pressed.

| Capability | Legacy | Canonically |
| --- | --- | --- |
| Entry point | `/studio/e/<id>/categorias`, a tab on every study | `/studio/e/<id>/revision/categorias`, inside the review's own segment |
| Authorized role | `internal`, in the action AND in SQL | identical |
| Source data | `respondent.segments`, keyset-paged, all 13 legacy dimensions | the canonical qualitative families' closed-coded labels |
| Editable | the FINAL NAME of a group of 2-12 values | identical |
| Merge | yes, 2-12 values under one chosen name | yes |
| Rename | only of a merged group, by recording a new version | identical |
| Split | **not supported** — the only split is undo | identical |
| Reassign / move | **not supported** — a value belongs to one category | identical |
| Exclude / re-include | **not supported** | shown, not editable — see below |
| Count recomputation | server-side, through the alias projection | server-side, in the results builder |
| Evidence shown | raw spellings, counts, before/after, affected surfaces | raw spellings, counts, before/after, share of the family |
| Save | one form per candidate, full POST, redirect with a message | one card per candidate, Server Action, the screen re-reads |
| Audit | append-only ledger, version chain, actor, time, reason | identical, plus a storage-level unique version |
| Stale write | workspace re-derived before the write | identical, plus an **expected-version pin** |
| Idempotent | **no** — the same decision twice wrote two versions | **yes** — the identical decision in force is returned |
| Publication | blocked by an unresolved high-confidence difference | identical, plus the sign-off going stale by itself |
| Client | the pinned snapshot; a later decision waits for a re-publish | the immutable publication; identical consequence |
| AI advisor | present, behind a flag whose acceptance criteria were never met | **absent, structurally** |

Two facts were measured on the hosted project rather than inferred:

* `category_decision` holds **2 rows**, both `separate`, both for
  `roi_membresia` / «No he recuperado nada» + «No recuperé nada», recorded
  2026-08-28 as version 1 and version 2 — the same decision written twice,
  which is the idempotency defect in the table itself.
  `study_category_snapshot` holds **0 rows**, and the one `segment_dimension`
  row carrying an `aliases` key carries the empty object. **So the legacy
  feature currently changes no number anywhere**, and deploying the canonical
  release removes a screen rather than a result.
* Those two spellings exist only in the LEGACY segment map. No canonical
  closed-coded item carries either, so there is nothing for a canonical
  decision to inherit.

### The scope line, and why it is where it is

Legacy offered all thirteen legacy segment dimensions — `giro`, `rango_edad`,
`estado_membresia`, `respondio_encuesta` and the rest. Canonically those are
**filter attributes** with named methodological authorities behind them, and
merging two of them changes who is inside a cut of the population rather than
what a client reads as a finding. The explicit product requirement is editorial
control over QUALITATIVE categorization, so the canonical surface covers the
qualitative families the canonical layer publishes as term clouds — for
Cuicuilco, «Miembros activos» and «Desertores» — and says so on screen.

Exclusion is shown and not editable for the same kind of reason: «No aplica» is
excluded by methodology §6.1 under a registered authority, and an editorial
screen that could overrule a registered authority would make the authority
decorative.

### Phase B — the data model, and the migration this unit did not apply

`0034_canonical_category_review.sql`. Its contract, the three measured reasons
the pre-canonical ledger cannot carry a canonical decision, and its rollback are
in `docs/CANONICAL_STUDY_MODEL.md`. It was proved against disposable
infrastructure and **this unit deliberately did not apply it**; Unit 6B.4B2M
applied it to the hosted project on 2026-09-15, and the section for that unit
records the measured delta.

Until a project has it, the screen reads as **not provisioned**: the categories and
their counts are shown, deciding is disabled with a sentence saying why, and the
projection is the empty one. That is a third state, not a fallback — a failed
READ is a fourth, and it refuses instead of showing an empty review, which is
the defect Unit 6B.4B2K removed from the screen next door.

### How a change invalidates the sign-off, and why nothing has to remember

`qualitativeEvidenceDigest` is a digest of the exact category LABELS a person
signed for. A grouping changes those labels, so the digest moves and the
publication review reports `stale` on its next load. There is no invalidation
step to forget, no second store to keep in sync, and no code that could be
refactored into skipping it.

### Phase C — the surface, and the two things it deliberately does not do

`/studio/e/<id>/revision/categorias`, reached from the qualitative sign-off
panel of «Revisión y publicación». It is the FIFTH door and still not a fifth
loader: `category-review-workspace.ts` holds no canonical reader and imports
everything that touches one from `presentation-workspace.ts` through a single
import statement, exactly as the publication and journey-pain workspaces do.
Both door tables — the dependency gate's and the presentation gate's — carry the
argument rather than the registration.

Per family it shows the family's own title and provenance, an opaque version
marker for its vocabulary, how the categories are counted NOW with their shares,
the documented exclusions with their counts, what the scanner noticed, the
before/after of each proposal, the manual grouping escape hatch over the full
label list, everything already decided with its version and date, and what
another study of the same client decided about the same question.

It does NOT render the qualitative sign-off's own state. That state is computed
from the STORED draft's BOUND groups — only the groups a block actually draws —
and computing it a second time here would be a second answer to one question,
which is precisely how the review's preview and its inventory once came to
disagree (Unit 6B.4B2). The screen links to the review and says what a change
will do to the signature.

And it does NOT let anybody type a count. There is no field for one anywhere on
the path: the write function's arguments are labels, a disposition, a name, a
reason and a version, and a gate reads `pg_get_function_arguments` to prove it.

### Phase E — proved against a real PostgreSQL and a real PostgREST

`npm run test:category-review-live` — **88 checks, 88 passed**. RLS enabled and
forced with an explicit browser-role denial and `service_role` holding SELECT
only, read off `pg_catalog`; a non-internal actor, an unsorted member list, a
single category, a nameless grouping, a reasonless postponement, an undo of
nothing and a malformed digest all refused by the database; the three flat-
grouping rules refused in SQL; a replay returning `created: false` and writing
no row; a decision against a moved version refused with 55000; UPDATE and DELETE
both refused with 2F002; every other table's row count identical before and
after — `segment_dimension` included; a grouping changing the number of
categories while the total, the base and every absence state stay identical; the
qualitative digest moving and `qualitativeReviewState` becoming `stale` with
nobody invalidating anything; and over real HTTP `anon` and an authenticated
client refused the read, the write, the table and a direct insert into it.

`npm run test:category-review` — **216 checks, 216 passed**, offline, driving the
real modules. Its §[9] is the discrimination proof: a failed ledger read
produces a value with **no `resolution`, no `decisions` and no `memory` field at
all**, so nothing downstream can read a projection off a read that never
happened.

### Phase F — the request budget, measured

Counted at the transport, against the hosted project, read-only:

| page | before | after |
| --- | --- | --- |
| `/studio/e/<id>/revision` | 26 | **26** |
| `/studio/e/<id>/revision/dolor` | 26 | **26** |
| `/studio/e/<id>/revision/categorias` | — | **18** |

The category ledger read costs exactly one request on every canonical path,
whether or not the migration is applied and whether or not the study has
decisions — it is read at the door so no surface can forget it. That would have
taken the review page to 27, so one request was given back where nobody was
reading it: `loadStudioStudy` counted `staged` and `failed` import batches
separately and then added them together, and nothing has ever reported them
apart. One `in` filter, one request, the same number, and the shell costs 14
instead of 15 for every Studio page in the product.

### Phase D — Cuicuilco, read-only, unchanged

Measured through the real loaders against the hosted project on 2026-09-15, with
no write of any kind:

```
Miembros activos   · v-marker vivs5jffg · 19 answers · 4 categories, 0 candidates
  Malos resultados financieros        11
  Mala actitud que no abre negocios    4
  Tiempo                               3
  Situaciones personales               1
  No aplica — out of the cloud         9
Desertores         · v-marker vpjbye6ac · 11 answers · 4 categories, 0 candidates
  Malos resultados financieros         7
  Mala actitud que no abre negocios    2
  Cambio de titular                    1
  Otra oportunidad                     1
```

**The scanner finds nothing in either family — zero candidates, zero findings,
zero blockers — so this study's publication verdict cannot move.** The ledger
read answers `PGRST202` on the hosted project, which is `not_provisioned`: the
screen shows exactly the counts above and disables deciding with a sentence
saying why.

### Gates

`npm test` green · typecheck 0 · lint 0 errors / 58 warnings · build and
`cf:build` OK · `test:secrets` PASSED · golden parity
**`ofrecidas=534 ejecutadas=531 aprobadas=531 falladas=0`** · presentation
parity PASSED · `test:category-review` 216/216 ·
`test:category-review-live` 88/88 · `test:canonical-publication-live` 188/188 ·
`test:canonical-qualitative-signoff-live` 63/63 ·
`test:canonical-journey-pain-live` 68/68 · `test:canonical-row-set-live` 56/56 ·
hosted fingerprint **136/136**.

### Phase H — the fourteen production-only commits, closed

| classification | count | where they stand |
| --- | --- | --- |
| ported verbatim (6B.4B2K) | 6 | 17 files byte-identical to production, `keep_vars = true` among them |
| documentation only | 3 | folded into this repository's own documents |
| **«Revisar categorías» (5)** | 5 | **replaced canonically by this unit** — not cherry-picked, not dropped |

**Nothing a merge would remove is unaccounted for.** The five commits build a
screen, a ~3 500-line detection/ledger/impact layer, a ~960-line optional AI
advisor whose own acceptance criteria were never met, and three gates. What a
person could DO with them is preserved: merge two or more differently written
answers under a name they choose, keep them apart deliberately, postpone with a
written reason, undo, and see what each would change before deciding.

Three user-visible differences, each deliberate:

1. **The vocabulary it covers.** Legacy offered thirteen legacy segment
   dimensions; the canonical surface covers the qualitative families the layer
   publishes as term clouds. Attribute vocabularies are filter dimensions with
   registered methodological authorities behind them, and an editorial screen
   that could overrule a registered authority would make the authority
   decorative. **No recorded decision has ever used the wider reach**: the
   hosted ledger holds two rows, both `separate`, and their projection is the
   empty object — so the narrowing removes a capability nobody exercised, and
   removes no number at all.
2. **There is no assistant.** The legacy advisor shipped disabled behind
   `EVALUATION_APPROVED = false`, with §11 of its own document recording «NOT
   RUN» for its measured results. It is not ported, and the absence is
   structural rather than configured: a gate reads this folder's imports.
3. **A replay is not a second decision.** The legacy ledger's own hosted rows
   show the defect — the same `separate` decision written as version 1 and
   version 2. The canonical write returns the record in force instead.

And one thing the canonical version has that legacy does not: a decision is
refused if the version the screen displayed has moved, under the study's
advisory lock, with a unique index behind it.

### Phase G — the preview, and what the real edge said

A **version**, not a deployment. `wrangler versions upload` on the existing
Worker created **`c18405d9-6c4b-41ab-989e-e7e6a5f2bdf3`**, tag
`rc-6b4b2l-88cf34d`, at
**`https://c18405d9-becommunity-v1.ollinagencyllc.workers.dev`**, from commit
`88cf34d` in a clean worktree with no `.env` file. Wrangler's own output: *"To
deploy this version to production traffic use `wrangler versions deploy`"* — it
was not run.

Built with **nothing baked**: no `.env` file and no `NEXT_PUBLIC_*` in the shell,
so not even the public anon key is inlined; the Worker's own variables supply
both at runtime. All three configured credential values appear in **0** files of
the artifact. BUILD_ID `xyMwJnp-hH4zxVBioGktL`; `.open-next` digest
`84e23399dfe5a0a66f1914445d7185f0f972d05e794982baae1e61ece84f49b6`; upload
12 373.55 KiB / gzip 2 644.92 KiB.

#### Edge QA — 142 checks, 142 passed

The new screen, on the runtime that used to refuse the page's fifty-first
request:

```
Miembros activos            Desertores
  Malos resultados financieros  11 · 58 %    Malos resultados financieros  7 · 64 %
  Mala actitud …                 4 · 21 %    Mala actitud …                2 · 18 %
  Tiempo                         3 · 16 %    Cambio de titular             1 ·  9 %
  Situaciones personales         1 ·  5 %    Otra oportunidad              1 ·  9 %
  No aplica · fuera de la nube   9
```

Both families report **nothing to decide**, nothing blocking, the manual
grouping offering all four labels, and the opaque vocabulary markers `vivs5jffg`
and `vpjbye6ac`. The ledger is not provisioned there, the screen says so, and
**every control that would write is disabled** — so the QA could not have
written even by accident. No 64-character hex run reaches the page, no canonical
item key does, and no element's own text is a bare family key.

Everything Unit 6B.4B2K proved still holds on this build: journey pain
`SIN REVISAR 0 · APROBADAS 15 · EXCLUIDAS 0 · SIN RESOLVER 0` with the review
complete, **no hard blocker of any kind** on `/revision`, the qualitative
sign-off still CURRENT, 15 692 characters of finished canonical content, the
publish control rendered and disabled with every acknowledgement unticked, the
filters driven end to end with the fifteen pain badges surviving one filter, two
filters and a clear, three viewports identical, anonymous visitors sent to
`/login` from five protected routes, the legacy fallback for a client with no
canonical publication, another tenant's client refused, and 27 leak checks clean.

#### Nothing else moved

**Production**, before and after: active version `e691ecd8…`, 10 deployments,
the deployment listing byte-identical, `/api/health` 200.

**The hosted project**, before and after: fingerprint gate **136/136**, 67
tables, 42 functions — so at that moment `0034` had **not yet been applied** —
the legacy `category_decision` still holding its two `separate` rows and
`study_category_snapshot` still empty, and **Cuicuilco still `draft` and still
unpublished**. (Unit 6B.4B2M applied `0034` later the same day; the section below
records it.)

ⓘ **One loose end from Unit 6B.4B2K, reported rather than quietly fixed.** That
unit set a dashboard variable `CANONICAL_EDGE_DIAGNOSTICS = "on"` for its
instrumented version, and because `keep_vars = true` retains dashboard variables
every later version has inherited it — the green `bb742e60` preview, and this
one. **No code reads it**: the only occurrence of that name in this branch is in
this document. It is inert, it carries no credential, and it was left alone
because editing a Worker's variables is a change to the production Worker's
configuration, which this unit had no authorization to make. **Remove it in the
dashboard before the release deploy**, or a future diagnostic behind that flag
would arrive switched on.

External evidence, outside every Git repository: `~/becommunity-6b4b2l/`
(`legacy-audit.json`, `preview-qa-result.json`, `cf-deployments-*.txt`,
`cf-upload-raw.txt`, `hosted-before-qa.txt`, `hosted-after-qa.txt`,
`screenshots/`).

---

## Unit 6B.4B2M — migration `0034` applied to the hosted project, and the release candidate frozen

**`0034_canonical_category_review.sql` is applied to the hosted project**, on
2026-09-15, through the repository's established mechanism — `supabase db push`
over the session pooler — after a fresh backup and a full restore rehearsal. The
hosted ledger now reads `0000`–`0034`, each version exactly once, and **applying
it grouped nothing**: the canonical category-review ledger is empty, and
Cuicuilco's two qualitative families carry **zero grouping candidates**, so an
empty ledger is the CORRECT state rather than an unreviewed one.

### The migration, before anything was touched

sha256 `88d9ac40ee673c4929ab2e9b8274a6287c2c7d2c1c294e1b3bf99c3cf0f6a4f0`, 29 879
bytes, 593 lines, 27 executable statements between one `begin` and one `commit`.
The statement inventory was taken mechanically rather than by reading:

* **one `drop`**, and it is `drop trigger if exists refuse_change on
  public.canonical_category_decision` — against a table created four statements
  earlier in the same transaction, so on any database it is a no-op that makes
  the file re-runnable. No `truncate`, no `delete`, no `update`, no `insert` at
  the migration level, and no drop of a table, function, index, policy, column,
  constraint, schema, type or view;
* **two `alter table`**, both the RLS flags on its own new table. Nothing alters
  any other table and no column is added to one;
* **exactly one write statement in the whole file**, `insert into
  public.canonical_category_decision`, inside the `security definer` write
  function. The bodies read three tables and write one: `public.study` supplies
  the tenant so a caller can never name one, `public.profiles` answers whether
  the actor is internal, and neither is written;
* **the legacy ledger and the legacy publication are out of reach.**
  `category_decision`, `study_category_snapshot`, `record_category_decision`,
  `capture_study_category_snapshot` and `segment_dimension` appear in the header
  commentary, where the argument lives, and in **no executable statement** —
  measured after masking the canonical table's own name, which contains
  `category_decision` as a substring;
* **three grants, five revokes, and every grantee list is exactly
  `[service_role]`.** `service_role` gets `SELECT` on the table — not `INSERT`,
  `UPDATE` or `DELETE` — after its privileges are revoked wholesale.

### The backup, and what the rehearsal measured

A fresh timestamped backup was taken with the **versioned** PostgreSQL 17 client
(`pg_dump 17.11`, not the `pg_wrapper` symlink that dispatches to 18) over the
session pooler, and retained outside every Git repository at
`~/becommunity-backups/u6b4b2m-pre-0034-20260915T214322Z/`:

| file | bytes | sha256 |
| --- | ---: | --- |
| `database.dump` | 1 311 120 | `f700ea994fdcf5070110d4eb4526e626e7f42d83bb1e75c7ba4b50a7befc94e4` |
| `schema.sql` | 467 540 | `610575c72736af90ea4c397358ee1e98a071456f6a0d7e40233a98bae3db033b` |

917 TOC entries, 136 table definitions, 68 table-data blocks, 97 functions, 62
policies, 92 indexes, 339 constraints, both schemas present, zero `pg_dump`
warnings, and `canonical_category_decision` named **0 times** in the dumped
schema — the artifact is genuinely pre-migration.

It was restored into a disposable PostgreSQL 17.11 and the restored copy was
proved to be the same database, with the three benign restore-role differences
**normalised rather than ignored**: the owner NAME (`--no-owner` restores as the
connecting user, so `postgres` becomes `patop` in every ACL — the name is
normalised, the privileges are compared), the server patch level (17.6 hosted
against 17.11 disposable), and `polroles` OID ordering (every list this capture
emits is sorted by name, so nothing depends on an OID). **49 checks, 0 failures**:
the same 67 tables, the same 15 791 rows table by table, the same RLS and FORCE
RLS flags, the same 62 policies, the same 42 function identities with the same
volatility and security, the same 215 index names, the same 8 triggers, the same
312 check constraints, the same ledger version for version and body for body, the
same grants after normalising the owner, and the same legacy ledger, Cuicuilco
draft, qualitative vocabulary, publication tables and row digests.

Two restore diagnostics are classified honestly and neither is data: `schema
"public" already exists`, which `pg_restore` always reports against a fresh
database, and three `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` failures
on the first attempt, which disappeared once that role was created. **0 post-data
errors** in the run that was measured.

ⓘ **The rehearsal applied `0034` AS `postgres`, and that is not a detail.** The
hosted project carries `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
public GRANT ALL ON TABLES TO anon, authenticated, service_role`. A table created
by `postgres` therefore **starts life granted to the browser roles**, and a
canonical migration's `revoke all … from anon, authenticated` is load-bearing
rather than decorative. Restoring those rules and applying the migration as that
role is what turned the resulting ACL into a prediction instead of an artefact of
the disposable cluster — and the hosted table's measured ACL is
`postgres=arwdDxtm/postgres | service_role=r/postgres`, exactly what the copy
produced.

The backup still restores: a second, independent database was created from the
same artifact, and it carries 1 685 survey responses and 34 ledger rows.

### The exact delta, measured on the copy and then observed on the project

```
tablesAdded            canonical_category_decision            (0 rows)
indexesAdded           ..._pkey, ..._chain_idx, ..._study_idx, ..._memory_idx
triggersAdded          refuse_change@canonical_category_decision
policiesAdded          deny_browser_roles@canonical_category_decision
functionsAdded         record_canonical_category_decision(...):v:definer
                       read_canonical_category_decisions(...):s:definer
                       refuse_canonical_category_change():v:invoker
checkConstraintsAdded  15
tableGrantsAdded       canonical_category_decision:postgres
                       canonical_category_decision:service_role  -> [SELECT]
ledgerRowsAdded        1
objectsRemoved         none
objectsAltered         none
existingRowsChanged    0
```

**Fifteen check constraints, not sixteen.** The file contains sixteen `check (`
clauses and one of them is the policy's `with check (false)`, which is a policy
expression and not a constraint — twelve column-level checks and three named
table-level ones. The first count was written from the file and the rehearsal
corrected it; the measurement is what the gates now assert.

### Phase C — the security proofs, against the restored hosted copy

**67 checks, 0 failures**, run against the restored copy with the real hosted
rows, the real policies and the real ACLs. Every refusal is asserted by SQLSTATE,
never by «something failed»:

* RLS **and** FORCE RLS on, one policy, and it is `false`/`false` for both
  reading and writing;
* `anon` and `authenticated` refused `42501` on direct `SELECT`, `INSERT`,
  `UPDATE` and `DELETE`, and on executing either function — eight refusals each;
* `service_role` may `SELECT` and is refused `42501` on `INSERT`, `UPDATE`,
  `DELETE` and `TRUNCATE`;
* **and the POLICY refuses even when a grant would not.** `SELECT` was granted to
  `authenticated` inside a savepoint that the engine then rolled back: with rows
  present and the privilege held, it still saw **none of them**. The observation
  is carried out of the block in a plpgsql variable, because an `INSERT` into the
  results table would have rolled back with the grant and silently lost the check;
* the actor is server-derived: a NULL actor, an actor who is nobody and a real
  **client** account are each refused `42501`, and a study that does not exist is
  `P0002`. The write function takes **no tenant argument** and **no count, share,
  total or percentage argument** at all;
* unsorted member folds, repeated folds, a group of one, a malformed digest, a
  postponement with no reason and a grouping with no name are each `22023`;
  undoing what was never decided is `55000`;
* **replay is idempotent** — the identical call returns `created:false` with the
  same decision id and the same version — while the **same decision against a
  moved source digest writes version 2**, because a decision recorded about a
  family that has since moved is not the same decision;
* a decision taken against a version that has moved is `55000`; the version
  actually on screen is accepted;
* the three flat-grouping rules are `23505` each: a label already in a category,
  two categories sharing a name, and a name that is a member of another group;
* the OWNER cannot `UPDATE` a decision or `DELETE` one while its study exists —
  `2F002` both times;
* reading is scoped by the database: another client's tenant selects nothing,
  another client's study with this tenant selects nothing, and a study with no
  decisions returns an empty pair rather than an error. The eleven returned keys
  are exactly the eleven pinned, **who decided is never returned**, and no
  respondent, session or free-text column reaches the caller;
* and after all of it: raw imported answers, survey items, respondents, import
  batches, the legacy category ledger, the legacy segment dimension and the
  qualitative sign-off are **byte-identical**, `study_category_snapshot` is still
  empty, and no publication exists.

### What the hosted project did

**44 checks, 0 failures.** The ledger holds 35 rows, `0000`–`0034`, each exactly
once; every pre-existing row is byte-identical; the new row is
`0034 canonical_category_review` with **27 stored statements** — the same 27 the
offline inventory counted — and those statements **reconstruct the committed file
exactly**, whitespace aside. The ledger's own joined-statement digest
(`a592a0ff…`) legitimately differs from the file's sha256 (`88d9ac40…`): the CLI
stores its own split of the file, not the file.

The observed delta matched the rehearsed one object for object. No existing
table's row count moved, total rows are still **15 791**, no existing table's RLS
flags moved, no pre-existing table grant changed, and `anon` and `authenticated`
hold **no privilege** on the new table.

Nothing the review is about moved. The legacy `category_decision` still holds its
**two historical rows, both `separate`**, at versions 1 and 2, on dimension
`roi_membresia`, naming no category and consulting no model;
`study_category_snapshot` is still **empty**; Cuicuilco is still `draft`, its
draft still **revision 3**, its qualitative sign-off digest unmoved at
`4ed838c4…`; «Miembros activos» still reads 11 / 4 / 3 / 1 and «Desertores» still
reads 7 / 2 / 1 / 1; every publication table is still empty; and every study's
status is unchanged.

### The gates, inverted rather than deleted — and the finding that came with it

ⓘ **Both old gates were run once against the applied project before they were
changed, and NEITHER FAILED.** That is the finding, not a formality: as written,
`test:migration-chain` and the hosted fingerprint could not tell that the hosted
project had gained a migration, because nothing in either asked. The chain gate's
`HOSTED_APPLIED_SLUG` and the REST transport's bound are offline claims about
source constants, and the fingerprint pinned no fact that a new table moves. This
is exactly why the new assertions are **semantic**.

Three source points moved, by hand:

* `scripts/lib/canonical-rest-transport.mjs` — `prepare(upTo = 34)` and its
  refusal bound, plus a new refusal for a hosted target that has **lost**
  `canonical_category_decision`. The bound spent all of Unit 6B.4B2L disagreeing
  with the repository, which was correct, and the two numbers agreeing again is
  another coincidence of a moment rather than a rule;
* `scripts/migration-chain-test.mjs` — `HOSTED_APPLIED_SLUG` is now
  `canonical_category_review`; the transport must name the new storage; every
  governing document must now assert `0034` is applied **and** that applying it
  grouped nothing; and six `WITHDRAWN` patterns retire the present-tense claims
  that it is not;
* `scripts/canonical-presentation-hosted-fingerprint.mjs` — a new §[3d], 33
  assertions, taking the gate from **136** to **169**.

§[3d] asserts semantics and not counts: the ledger exists and is **empty**, both
functions are exposed and the **legacy write path still stands beside them**, the
two families carry exactly the pinned labels and counts with nine answers set
aside as «No aplica», **the review screen's own `scanFamily` finds zero grouping
candidates in either**, every label the data carries today is a label the sign-off
was taken over and the reverse, and the legacy ledger still holds its two
`separate` rows with no category named, no model consulted and an empty snapshot
beside them.

ⓘ **And the new assertions were shown to fail.** Six copies of the gate were
perturbed one place at a time and run against the same project — a count moved
11 → 12, the legacy dimension renamed, the exclusion count moved 9 → 8, the
ledger required non-empty, a candidate required, and the sign-off required over
different labels. Each failed on **exactly its own assertion and nothing else**,
while the committed gate passed 169/169. The perturbed copies had to live inside
`scripts/`: run from anywhere else they fail because `./lib/hosted-target.mjs`
does not resolve, which is a failure of the harness and proves nothing.

ⓘ **The migration file itself was not edited, including its header**, which still
says it is applied to no project. The hosted ledger records the bytes that ran;
editing the file would make the repository and the ledger disagree about what ran.
The claim is corrected in the governing documents instead.


### The release candidate

| | |
| --- | --- |
| commit | `09178f4d171b5abb9007f2d1e4e954b0083ab60f` |
| version | `2995bd70-1bf3-486e-9a84-979fb1717f75` |
| tag | `rc-6b4b2m-09178f4` |
| preview | `https://2995bd70-becommunity-v1.ollinagencyllc.workers.dev` |
| BUILD_ID | `6Dj9XnZsqTRLygZrssYS8` |
| `.open-next` digest | `3adb7281dd792c68b4786e18b749e7e85d97c01c5698a9f043340091e04ce3cb` |
| `worker.js` | `d05223bf4d44c84108a102ab62aa3bc9c5568f0c3ac2064c37be5cc65c64bc45` |
| size | 12 373.54 KiB, gzip 2 644.91 KiB |
| startup | 29 ms |

Built from a clean checkout of the exact remote commit, with **no `.env` file and
no `NEXT_PUBLIC_*` in the shell**, so the compiled env snapshot is
`{}`/`{}`/`{}` — not even the public anon key is inlined, and the Worker's own
variables supply both at runtime. `npm run test:secrets` passed over the built
output. `keep_vars = true` is in `wrangler.toml` with no `[vars]` block beneath
it.

**Uploaded with `wrangler versions upload` and never deployed.** Production was
`e691ecd8-de9a-4a02-a8e3-13aad7e9e805` with 10 deployments before the upload and
after it, its deployment listing byte-identical once wrangler's own «update
available» banner is removed (sha256 `acd589cde018a39f4bf6d8af2377cb6d…` on both
sides), and `/api/health` answered 200 throughout. No route, DNS or traffic
change was made.

#### What the Edge QA found

**152 checks, 152 passed**, on the release-candidate version: the category review
provisioned and drawing exactly the approved labels and counts, zero candidates,
zero decisions, the manual grouping refusing until two labels are chosen, the
journey review still `0/15/0/0`, no false blocker on `/revision`, the sign-off
still CURRENT, the canonical preview surviving one filter, two filters and a
clear at three viewports, anonymous visitors refused on every protected route,
the legacy fallback intact for a client with no canonical publication, another
tenant's client refused, and 27 leak checks clean.

ⓘ **AND IT TOOK THREE RUNS TO GET THAT, WHICH IS REPORTED RATHER THAN ROUNDED
OFF.** Two runs before it failed 8 assertions each, with an identical signature —
the filter banner not appearing after a value is ticked, «Ver el estudio
completo» then not found, and the desktop viewport reading an undrawn preview.
That is a fixed `sleep(5000)` against a click that costs a server round trip, not
a product failure: the same assertions pass on the same version minutes later,
and the page's content is identical when it does (15 692 characters unfiltered).
**The QA harness's fixed waits are the weakest part of this evidence**, and a
future unit should replace them with polling before this screen is signed off
again.

#### Anonymous access, checked at the transport instead of through a redirect

One run failed the browser assertion «the canonical revision screen answers
/login» because it sampled `location.pathname` before a client-side redirect had
settled. That answer is not left to a timer: all seven protected routes were
asked directly with `curl`, no cookies and no JavaScript —
`/studio/e/<id>/revision`, `/revision/categorias`, `/revision/dolor`,
`/vista-cliente`, `/studio`, `/e/<id>` and `/dashboard` — and every one answered
**HTTP 307 to `/login`**. Neither «Nets de Cuicuilco», nor «Malos resultados
financieros», nor «Miembros activos», nor «Publicar para el cliente» appears
anywhere in those bodies.

#### The request budget, re-measured after the migration

| page | requests | ceiling |
| --- | ---: | ---: |
| `/studio/e/<id>/revision` | 26 | 50 |
| `/studio/e/<id>/revision/dolor` | 26 | 50 |
| `/studio/e/<id>/revision/categorias` | 18 | 50 |
| the Studio shell, on every page | 14 | — |
| authentication | 2 | — |

Unchanged by `0034`. `read_canonical_category_decisions` costs the one request it
cost when it did not exist and answered `PGRST202`; what changed is that the
answer is now a projection instead of a refusal.
### An intermittent Cloudflare Error 1101, reported rather than explained away

ⓘ **For about ninety seconds the preview Worker threw.** Between **22:34:54 and
22:36:28 UTC on 2026-09-15**, seven consecutive edge requests returned
Cloudflare **Error 1101 — «Worker threw exception»** instead of a page, across
Ray IDs `a3bb19e57d4e485c`, `a3bb1a3c7902485c`, `a3bb1aa53c13485c`,
`a3bb1b0b9842485c`, `a3bb1b72ac54485c`, `a3bb1bdb8f6f485c` and
`a3bb1c426b59485c`. Two full QA runs failed 24 and 25 assertions inside that
window, all of them downstream of it.

**What it is not.** It is not the category review and it is not migration `0034`:

* the outbound request budget was re-measured immediately afterwards and is
  **unchanged** — `/revision` 26, `/revision/dolor` 26, `/revision/categorias`
  18, against a proven ceiling of 50 — and `loadPublicationReview` returned `ok`;
* `/revision` loaded **5 times out of 5** on its own, at 5 seconds, drawing
  24 743 characters every time;
* **`/login` was among the pages that threw**, and `/login` reads no study, no
  ledger and no canonical package at all;
* Unit 6B.4B2L's **untouched** QA script, run against the same preview and the
  same migrated database as a control, passed **141 of 142**, its single failure
  being the deliberate inversion of «this environment cannot record a decision»;
* the sequence was then driven **eight more times** with the Worker version
  tailed (`wrangler tail --version-id c18405d9…`): eight clean pairs, zero
  exceptions captured, zero error outcomes;
* the full QA re-run immediately afterwards passed **152 of 152**;
* **it recurred on the release-candidate version too**, a different version built
  from a different commit — a second burst between **23:05:06 and 23:05:39 UTC**,
  Ray IDs `a3bb46346d524600`, `a3bb4656ff524600`, `a3bb467a188f4600`,
  `a3bb46beebea4600` and `a3bb47058ef54600`. Three of those five were in the
  **control arm that never visits the category review at all**, and one was
  `/login` again;
* and between the bursts, **200 consecutive GETs** across production
  `/api/health`, production `/login`, both preview hosts' `/login` and the
  release candidate's `/api/health` returned **zero failures**.

**So it is not the category review and it is not `0034`.** It reaches `/login`,
it reaches a version that predates the migration in its build, and it reaches the
arm with no category visit in it. What it IS is not known, and this record does
not pretend otherwise: a platform-side condition affecting version-preview
hostnames fits every observation, but nothing here proves it.

ⓘ **`wrangler tail` was not a usable instrument for this.** Attached to either
version by `--version-id`, it captured **no lines at all** — not even the sixteen
successful requests driven through it in the same window — so the Worker's own
account of the failing requests was never obtained. A future unit wanting that
account should reproduce under local `workerd` rather than expect tail to deliver
it.

**Watch for it during the release preview QA**: a burst that follows the category
review specifically, or one that reaches the production hostname, would change
the reading and must stop the deploy.

### Nothing else moved

**Production**, before and after: active version `e691ecd8…`, 10 deployments, the
deployment listing byte-identical.

**Cuicuilco** was not touched: no category was saved, renamed, merged, split,
excluded or reassigned, `study.status` was not changed, nothing was published, and
no client account was created. Because the study has zero grouping candidates
there was nothing to decide, and **no decision was manufactured to exercise the
write path** — the write path is proved against disposable infrastructure, where a
wrong row costs nothing.

External evidence, outside every Git repository: `~/becommunity-6b4b2m/`
(`phase-a-migration-review.json`, `hosted-before.json`, `hosted-after.json`,
`state-restored.json`, `state-rehearsed.json`, `phase-b-delta.json`,
`phase-c-security.txt`, `phase-d-verify.txt`, `ledger-0034*.json`,
`push-dryrun.log`, `push-apply.log`, `falsify/`, `cf-*.txt`, `screenshots/`), and
the retained backup at
`~/becommunity-backups/u6b4b2m-pre-0034-20260915T214322Z/`.

---

## Unit 6B.4B2N — main integration, and the QA harness that was reporting slow as broken

### Phase C — a fixed sleep replaced by a bounded wait on a named state

Unit 6B.4B2M's release QA needed **three runs** to reach 152/152. The two before
it failed **eight assertions each, with an identical signature**: a filter value
ticked, the filtered banner not found, «Ver el estudio completo» then not found,
the desktop viewport reading an undrawn preview. Minutes later the same version
served the same page and every one of them passed.

The cause was in the harness, not the product. The script clicked, slept a fixed
`sleep(5000)`, and asserted. A click that costs a server round trip sometimes
takes longer than five seconds — so a healthy server was reported as a broken
screen. **Lengthening the sleep would have hidden the opposite mistake just as
well**, which is the real objection to it: a fixed duration cannot tell a slow
answer from a wrong one, and a QA run whose verdict depends on which it got is
not evidence about anything.

`scripts/lib/harness-browser.mjs` gained `awaitUiState`. The caller names what
**ready** looks like and, optionally, what the page's **own failure** looks
like; whichever appears first ends the wait; the maximum is explicit; and the
answer is one of five readings rather than a thrown error:

| reading | what it means | what a report should do with it |
| --- | --- | --- |
| `ready` | the named state appeared | continue, and print how long it took |
| `application` | the page's own failure state appeared | fail — the product said no |
| `timeout` | the bound was exhausted | fail, naming the bound and the elapsed time |
| `browser` | the page or its CDP session went away | not a product verdict; re-run and say so |
| `probe` | the predicate itself is malformed | the harness's own defect, fixed in a different file |

Elapsed time is measured on **both** clocks and both are reported — the page's
own `performance.now()` for how long the condition took, Node's monotonic
`process.hrtime.bigint()` for how long the call took. A large gap between them
is itself a finding. Nothing is rounded off into a bare pass or fail.

The observation costs **one** CDP round trip and issues **no application
request**: a `MutationObserver` catches every DOM change, and a bounded in-page
sampler catches the conditions a mutation does not announce. §4.4.1 is intact —
Node never polls, and neither timer asks the server anything. `waitForDom` is
untouched, so the twenty call sites that already depended on it did not move.

### The gate, and the seven ways it was made to fail

`npm run test:harness-condition` — **33 checks, offline, no browser, in
`npm test`** (inserted after `test:canonical-viewer-filters`). It does not read
the wait; it **executes** it, against a scripted page in a `node:vm` context, and
watches all four outcomes happen.

The one worth naming: **a condition that becomes true with no DOM change at
all** is still observed. That is the case a `MutationObserver` alone never sees,
and it is the only reason a bounded sampler is in the page.

Discrimination was proved by seven single-point perturbations of a **copy** of
the harness — the real file's digest is identical before and after, which is
recorded rather than asserted:

| perturbation | gate's answer |
| --- | --- |
| the sampler stops looking | 4 failures, led by the no-mutation case |
| a failure state is consulted before ready | 1 — `ready` no longer wins a tie |
| observer and interval left running | 3 — one per outcome |
| a malformed probe called a lost browser | 1 — the two are fixed in different files |
| the lost-browser reading drops its clock | 1 — "every reading reports elapsed time" |
| a throwing predicate counted as satisfied | 1 — a broken probe must never read as ready |
| the absent failure predicate defaults to true | 1 — it must be a predicate that is never true |

Unperturbed: 33/33.

### Phase A — the final integration audit

`origin/main` `c76762f4…` was an ancestor of the source tip, the merge base WAS
`origin/main`, and the range carried **zero merge commits** — so a strict
fast-forward was available and no rebase, squash or rewrite was required. Every
worktree clean; no `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`,
`rebase-*` or `sequencer` anywhere.

**136 commits, 268 files, +123 273 / −355**, grouped and with nothing
unaccounted for:

| group | files | new | modified |
|---|---|---|---|
| tests and gate wiring | 77 | 70 | 7 |
| presentation / editor | 52 | 47 | 5 |
| canonical ingestion / model | 37 | 36 | 1 |
| results / calculations | 28 | 18 | 10 |
| migrations and rollbacks | 26 | 26 | 0 |
| review workflows | 23 | 23 | 0 |
| documentation | 11 | 6 | 5 |
| client read path | 7 | 6 | 1 |
| publication | 5 | 5 | 0 |
| Cloudflare / runtime | 1 | 0 | 1 |
| **unclassified** | **0** | | |

Migrations `0000`–`0034`: 35 files, each number once, no gaps, nothing above
`0034` — and **every one is in the hosted ledger**, version and name, in order,
each exactly once (35 rows, diffed against the repository rather than eyeballed).
`keep_vars = true` present, no `[vars]` block.

Nothing forbidden enters Git: no `.env`, dump, archive, workbook, key, log,
screenshot or evidence path in the range; **zero binary files**; and every one of
the 268 blobs carries **no CR, no NUL, no BOM, no other C0 control byte**, and
ends in a newline. The secret scan over all 123 273 added lines found no JWT, no
`sb_secret_`/`sb_publishable_`, no password-bearing Postgres URI, no PEM block,
no AWS or GitHub token. Eleven `KEY`/`PASSWORD` assignments are environment
variable NAMES and three single-use passwords for **disposable** local test
targets; the only 40-character literals are commit SHAs and a table name.

### Phase B — every gate the brief names, at the exact tip that became `main`

| gate | result |
|---|---|
| `test:harness-condition` (new) | 33 / 33 |
| `test:migration-chain` | PASSED |
| hosted fingerprint | 169 / 169 |
| `test:canonical-row-set-live` | 56 / 56 |
| `test:category-review-live` | 88 / 88 |
| `test:canonical-qualitative-signoff-live` | 63 / 63 |
| `test:canonical-journey-pain-live` | 68 / 68 |
| `test:canonical-publication-live` | 188 / 188 |
| results parity | `ofrecidas=534 ejecutadas=531 aprobadas=531 falladas=0` |
| presentation parity | PASSED |
| `test:secrets` | no leak |
| typecheck / lint | 0 errors / 0 errors, 58 warnings |
| `npm test` | exit 0, **118 scripts** |
| the 30 trailing gates | 30 / 30 |
| `build`, `cf:build` | clean |

ⓘ **FOUR OF THOSE GATES REFUSED ON THE FIRST PASS AND WERE NOT COUNTED.**
`test:canonical-row-set-live`, `…-qualitative-signoff-live`, `…-journey-pain-live`
and `…-publication-live` are DISPOSABLE gates: they exit 2 when a configured
project is in scope, which is the point of them. They were re-run with every
application and hosted credential `env -u`'d. A refusal is not a pass and was
never reported as one.

The hosted project was measured on both sides of the whole run: **fields that
moved: NONE**, 15 791 rows, 68 tables, 45 functions, ledger 35 rows.

### Phase D — the strict fast-forward

From a clean dedicated worktree whose tree object was proved **identical** to the
one every gate ran against (`dfba2097…`), and immediately after a fresh fetch:

```
git push origin 1c05276383ddd6d3a7d88de5ceab5170aafbf6f7:refs/heads/main
   c76762f..1c05276  1c05276383ddd6d3a7d88de5ceab5170aafbf6f7 -> main
```

A dry run first, two dots and no `+`. Verified **from the remote** with
`ls-remote`, not from a cache: `origin/main` and the source branch both at
`1c05276`; all 136 commits reachable from `main`; 0 behind; 0 merge commits; the
old baseline still an ancestor; `main`'s tree equal to the gated tree. Exactly
**two** remote-tracking refs moved. Every worktree still clean.

### ⚠️ THE MERGE DEPLOYED PRODUCTION, AND THAT IS THE FINDING OF THIS UNIT

| what | when (UTC) |
|---|---|
| `origin/main` fast-forwarded to `1c05276` | 00:16:46 |
| Workers Builds created version `1e17160e-0984-40f8-9b85-5e3126843bc7` | 00:18:26.620 |
| **that version deployed to 100 % of production traffic** | 00:18:29.026 |
| authorized rollback to `e691ecd8` at 100 % | 03:23:12.485 |

**103 seconds from push to live, with no deploy command run.** The unit's own
brief listed «merging does not deploy production traffic» as accepted state, on
the authority of CLAUDE.md's 6B.4B2J bullet — which generalised four measurements
of NON-MAIN branches to `main`, a case it never tested. `docs/DEPLOYMENT.md` had
said the opposite since PR #29, in as many words. The two documents contradicted
each other for eight days and the wrong one was the one being acted on.

The operator authorized the rollback explicitly. `wrangler versions deploy
e691ecd8-de9a-4a02-a8e3-13aad7e9e805@100%` succeeded in 0.78 s and production's
served asset set became **byte-identical to `e691ecd8`'s own preview host**
(`7f6c9470a2e91c09…`) and no longer matches the merged build
(`e0b3eab62573f8a3…`). Health `200`, and all protected routes `307 → /login`,
before, during and after.

**Exposure: 3 h 04 m 43 s**, and two things kept it uneventful, both prior work
rather than luck:

* **`keep_vars = true`** meant the automatic deploy did not strip the Worker's
  variables — no repeat of the nine-minute 2026-08-28 outage. The Worker answered
  `200` throughout.
* **The deployed code was code that had already passed Edge QA.** No file under
  `src/`, `public/`, `wrangler.toml` or the build configuration differs between
  the release candidate's commit `09178f4` and `1c05276`; the five files that
  moved are `CLAUDE.md`, `docs/CURRENT_STATE.md`, `package.json` and two
  `scripts/` files, none of which ships.

And nothing about the study moved while it was live: the hosted database was
identical before and after — 15 791 rows, ledger `0000`–`0034`, Cuicuilco `draft`
at revision 3, category ledger empty, every publication table 0 — because a
deployment changes code, not data, and no publication existed to serve.

⚠️ **The deployment COUNT is no longer 10.** It is 12: the automatic one and the
rollback. `wrangler deployments list` pages at ten, so «still shows ten records»
is an artefact of the page size and not a fact about the Worker. The ACTIVE
VERSION is the check that means something, and it is `e691ecd8` again.

### Phase E — the merged version, and what can and cannot be proved about it

Two versions appeared, sixty-two and a hundred seconds after their pushes:

| version | created (UTC) | produced by |
|---|---|---|
| `7e9d47d5-0c64-43f4-aa06-6d61f3dedefd` | 00:16:41.169 | the push to the source branch (00:15:39) — a VERSION, no deployment |
| **`1e17160e-0984-40f8-9b85-5e3126843bc7`** | 00:18:26.620 | the push to `main` (00:16:46) — a version AND a deployment |

`wrangler versions view` on both: handlers `fetch`, compatibility date
`2025-09-23`, flags `nodejs_compat`, the secret `SUPABASE_SERVICE_ROLE_KEY`
present by name only, and bindings `env.ASSETS`,
`env.CANONICAL_EDGE_DIAGNOSTICS ("on")`, `env.NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`env.NEXT_PUBLIC_SUPABASE_URL`. `/api/health` 200 on both.

ⓘ **WHAT CANNOT BE PROVED, AND IS THEREFORE NOT CLAIMED.** Wrangler reports
`Source: Unknown (version_upload)` with no tag, message or commit, so the build's
commit is not readable from its metadata. Both refs pointed at `1c05276` when
both builds ran, so either version is a build of that commit — but *which push
produced which version* rests on the timing and on the deployment record, not on
provenance metadata. The `/login` chunk-filename set is **identical across the
merged build, the release candidate, the previous production version and
production itself**, so it discriminates nothing and was discarded as evidence;
the full asset-path fingerprint does discriminate and is what the rollback proof
uses. `CANONICAL_EDGE_DIAGNOSTICS` was NOT removed: removing it is a
dashboard change that would create and deploy a version, and this unit does not
touch traffic again.

### Phase F — three independent runs, 194 / 194 each

Against `https://1e17160e-becommunity-v1.ollinagencyllc.workers.dev`, three fresh
browsers and three fresh profiles, no warmed state:

| run | executed | passed | failed | Error 1101 |
|---|---|---|---|---|
| 1 | 194 | **194** | 0 | 0 |
| 2 | 194 | **194** | 0 | 0 |
| 3 | 194 | **194** | 0 | 0 |

Twenty-two bounded waits per run, **22 of 22 reaching their named state**, and
the totals are the argument for the whole exercise: **13 258 ms, 11 919 ms and
13 189 ms of waiting in total**, where a fixed five seconds each would have been
110 000 ms — and in all three runs the number of waits that took longer than five
seconds was **zero**, so the old constant was both eight times too slow and, on a
bad minute, too fast.

Covered: health; authentication; internal authorization; the category review; the
qualitative sign-off; the journey review at 0 / 15 / 0 / 0; the
revision/prepublication screen; the canonical internal preview; the client route
with no publication; desktop, tablet and phone; one filter, two filters and a
deterministic clear back to the byte; `show_all`; anonymous refusal; cross-tenant
refusal; no internal metadata; and **no database mutation** — the hosted project
was measured before and after all three authenticated runs and **nothing moved**.

The anonymous refusal is asserted at the HTTP level, with no browser involved:
seven protected routes, each `307` to `/login`, none leaking any of the study's
words.

#### What the deterministic harness found that a sleep had been hiding

Four things, and none of them is a product defect:

1. **A click on a hydrating page is DISCARDED.** Measured directly: a filter
   ticked 500 ms after the canonical block first drew came back unticked while
   the block grew from 14 766 to 15 692 characters. «The element exists» is not
   readiness. The waits now require the DOM to go QUIET — a MutationObserver
   that records when it last fired, plus the sampler asking «nothing for 600 ms».
2. **«Ver el estudio completo» is `disabled` while a recomputation is in
   flight**, so a click during one does nothing and reports nothing. Three runs
   read that as «clearing the filters is broken». The wait now uses the app's own
   idle signal — the control present and NOT disabled — and the in-page click
   returns `absent` / `disabled` / `clicked` instead of a boolean.
3. **The manual grouping button stayed disabled with two labels chosen**, for the
   same hydration reason; probed directly it reads `disabled=false,
   selectedOptions=2`, exactly as the screen should.
4. **A cross-tenant refusal is 150 characters long**, and a wait demanding 200
   was demanding the leak it exists to prove the absence of.

ⓘ **AND ONE CORRECTION TO 6B.4B2M'S OWN EVIDENCE.** That unit asserted
«Desertores excludes nothing» and counted it among its 152. Probed five times
three seconds apart, on this build **and on 6B.4B2M's own release candidate**,
the family draws ONE excluded row — «No aplica · fuera de la nube», carrying a
**zero**. The family genuinely has no not-applicable responses; the screen says
so by drawing the label with a nought rather than by omitting it, which is what
the hosted fingerprint's §[3d] has pinned all along (`notApplicable: 0`). The old
assertion passed by reading a page that had not finished.

Two waits per run legitimately have their execution context destroyed by the very
navigation they are waiting for — the client-route redirect and the sign-out. The
harness calls that `browser`, correctly; the QA re-asks once in the context that
replaced it and **says in its output that this is what happened**.

### Phase G — the Error 1101, caught in the act and then not reproduced

ⓘ **IT REPRODUCED, AND THE NEW HARNESS PINNED IT IN FOUR MILLISECONDS.** During
the QA's own development, a burst on the merged preview produced
**Error 1101, Ray ID `a3bccd61adbf464a`, 2026-09-16 03:32:10 UTC**, followed by
ten more Ray IDs through `a3bccd974fc3464a`, across `/revision`,
`/revision/categorias`, `/studio` and `/insights/e/…`. A second, smaller burst
followed in the next run — `a3bcd0d429b24677`, `a3bcd0eabbf44677` — and then it
stopped. Where 6B.4B2M burned five seconds and reported «the screen is wrong»,
this harness named it as the page's own failure state after **4 ms** and printed
the Cloudflare code and the Ray ID beside it.

The bounded observation that followed, concurrency ONE, ~2.5 s between requests:

| window | requests | preview anon | production control | preview authenticated | Error 1101 |
|---|---|---|---|---|---|
| 1 · 03:54:20 → 03:59:14 UTC | 80 | 30 (20×200, 10×307), p50 316 ms | 20 × 200, p50 289 ms | 30 ready, p50 2 641 ms, max 3 964 ms | **0** |
| 2 · 04:03:55 → 04:08:51 UTC | 80 | 30 (20×200, 10×307), p50 318 ms | 20 × 200, p50 297 ms | 30 ready, p50 2 702 ms, max 3 382 ms | **0** |

**160 requests across two separate windows, at concurrency one, and not one
Error 1101** — on the same version that produced thirteen of them an hour
earlier. Fifty Cloudflare Ray IDs were captured per window, so the requests
demonstrably reached Cloudflare rather than being served from anywhere closer.
Every endpoint the brief names is in both windows: `/api/health`, `/login`, a
protected-route redirect, the authenticated revision screen, the category review
and the journey review.

**It was not reproduced during the bounded observation. That is not the same as
«it cannot recur»**, and this document does not say the stronger thing: it
recurred twice within the preceding hour, on this very version, and three clean
QA runs and a clean soak came after. The cause remains unknown; `wrangler tail`
captured nothing at all for either version in 6B.4B2M, and that limitation has
not changed.

### Phase H — production non-impact, stated honestly

| claim | status |
|---|---|
| active production version is `e691ecd8-de9a-4a02-a8e3-13aad7e9e805` | ✅ restored and verified |
| deployment count remains 10 | ❌ **it is 12** — the auto-deploy and the rollback |
| production asset fingerprint unchanged | ✅ identical to `e691ecd8`'s own preview host |
| production health 200 | ✅ throughout |
| no production traffic changed | ❌ **it changed twice**, and both are recorded above |
| hosted row counts unchanged | ✅ 15 791, before and after everything |
| Cuicuilco remains `draft` | ✅ |
| publication tables empty | ✅ all six, 0 |
| draft remains revision 3 | ✅ |
| editorial decisions and sign-off unchanged | ✅ digest `4ed838c4…`, 15 pain decisions approved |
| no client account created | ✅ |
| category-review ledger still empty | ✅ 0 rows |

And the asymmetry was confirmed once more, in this same session and by accident:
the documentation commit `9ff777f` was pushed to the **source branch**, Workers
Builds created version **`a70aadc6-d7b6-4eca-9feb-10239aba08c7`** at 04:04:55Z,
and **no deployment followed**. A branch push builds; a `main` push deploys.

### Where this leaves the repository

* `origin/main` = **`1c05276383ddd6d3a7d88de5ceab5170aafbf6f7`** — the canonical
  release, 136 commits, integrated by strict fast-forward.
* `origin/codex/canonical-experience-integration` = **`9ff777f…`**, one
  documentation commit ahead. **`main` is deliberately NOT moved to it**, because
  moving it would deploy.
* **Production runs `e691ecd8`**, the pre-canonical build, on purpose: a
  canonical build in production with no client account, no `published` status and
  no publication is a build nobody can use.
* The canonical release is built, uploaded and QA'd: version
  **`1e17160e-0984-40f8-9b85-5e3126843bc7`**, three runs at 194/194.

**The production deployment still pending**, in order: remove
`CANONICAL_EDGE_DIAGNOSTICS` in the dashboard; deploy `1e17160e` explicitly with
`wrangler versions deploy 1e17160e-0984-40f8-9b85-5e3126843bc7@100%` (or push
`main` and treat the automatic deployment as that step); verify `/api/health` and
one client route; provision a real client account in the Cuicuilco tenant; set
`study.status`; publish; verify as the real client at three viewports. Rollback
remains `wrangler versions deploy e691ecd8-de9a-4a02-a8e3-13aad7e9e805@100%`,
which this unit has now executed once and measured.

**One blocker stands**: the intermittent Error 1101. It is not understood, it
recurred on this version an hour before two clean observation windows, and
`wrangler tail` still captures nothing for it. Deploying is a decision to accept
it — which is defensible, since production has been serving a Worker with the
same symptom since before this branch existed, but it is a decision and not an
absence of one.

⚠️ **SUPERSEDED — recorded in Unit 6B.4B2P.** «Defensible» no longer holds. Unit
6B.4B2O reproduced the failure on demand and confined it to the authenticated
canonical review pages; production stayed at 48 / 48 and does not serve those
pages at all. Unit 6B.4B2P then measured what the runtime is terminating (§ «Unit
6B.4B2P» below), and found the sentence above half right: production `e691ecd8`
DID record `exceededResources` — seven terminations, all in the minute of
2026-08-28 23:44 UTC, the day it was deployed — and none in the 90 days of
retained analytics since. The same limit applies to it; its light traffic rarely
reaches it. That is not a reason to ship pages that reach it on demand. **The
release is blocked**; the canonical build is not deployed while the review pages
are killed.

---

## Unit 6B.4B2O — Error 1101 has a definition, the Worker had no boundary, and `main` is still armed

### Phase A — the Git deployment configuration, read from Cloudflare rather than from this repository

Read through the Cloudflare API with the OAuth credential wrangler already holds.
No new credential was requested, and the OAuth token's value appears nowhere.

⚠️ **CORRECTED IN UNIT 6B.4B2P.** This said «no value is reproduced anywhere», and
the unit's final report added that no evidence file held a credential-shaped
value. **Both were literally false.** A count-only scan in Unit 6B.4B2P found the
public Supabase publishable key (`sb_publishable_…`) by VALUE in three files —
`api/worker-settings.json`, `api/version-1e17160e.json` and
`api/version-e691ecd8.json`, the Worker's settings and version records exactly as
the API returned them — and in their copies under `C:\dev\becommunity-review-6b4b2o\`.
The scan that backed «0 files» looked for JWTs, `sb_secret_` and `oauth_token`,
and not for publishable keys. No `sb_secret_`, JWT, OAuth token or
password-bearing URI was found in any of them. That key
is public by design and RLS is what protects the data behind it; it is not the
service-role secret. It is still a credential-shaped value in an evidence file.
The evidence stays outside every Git repository, and an evidence directory is
not to be described as credential-free unless a scan that looks for publishable
keys too says so.

**The mechanism, and why it did what it did.** Workers Builds gives a Worker up
to **two triggers**: one for the production branch and one for every other
branch. The production trigger's **Deploy command** defaults to
`npx wrangler deploy` — upload a version **and create a deployment**. The
non-production trigger's defaults to `npx wrangler versions upload` — a version
with a preview URL and **no deployment**. The version records match exactly:
branch-built versions carry
`{"workers/alias":"codex-canonical-experience-integration","workers/triggered_by":"version_upload"}`,
while `main`-built `1e17160e` carries no alias and a separate deployment record
appeared 2.4 seconds later.

**The Worker as the API describes it**, and three facts in it matter:

* **`observability: null`** — Workers Logs has NEVER been enabled. `logpush:
  false`, `tail_consumers: []`.
* **`routes: []`** — no custom route and no DNS record at all; production is the
  `workers.dev` subdomain, with preview URLs enabled.
* versions `total_count: 248` (`e691ecd8` is 157, `1e17160e` is 246); the
  deployments endpoint returns **exactly ten with no total**, so ⓘ **«the
  deployment count is 12» from Unit 6B.4B2N was arithmetic, not an observation**,
  and the API does not confirm it. The ACTIVE VERSION is the observable that
  means something.

**The safe setting exists and is documented**: *Settings → Build → Deploy
command*, changed from `npx wrangler deploy` to `npx wrangler versions upload`.
It preserves the Worker, the Git integration and preview builds; it changes no
variable, secret, route, DNS record or active version; it shifts no traffic; and
Cloudflare's documentation states that saving build settings applies to the next
build and does not itself trigger a deployment. The API equivalent is
`PATCH /accounts/{account}/builds/triggers/{trigger}` with
`{"deploy_command": "npx wrangler versions upload"}`.

⚠️ **IT WAS NOT APPLIED, AND NOT FOR ANY OF THE REASONS THE BRIEF SAID TO STOP
FOR.** No repository would be disconnected, no project deleted, no route changed,
no Worker recreated. Every `/builds/` endpoint answers **403 · 10000
Authentication error**: Workers Builds requires a user-scoped token carrying
*Workers Builds Configuration: Edit*, the wrangler OAuth token does not carry it,
and this unit was told not to request a new API token. **`main` is still armed,
and must not be pushed until that setting is changed.**

### Phase B — what Error 1101 is, and why there is no record of these ones

Cloudflare's own documentation: **1101 = «Worker threw a JavaScript exception»**.
It is not the documented CPU code (1102), the request cap (1027) or a routing
failure (1022). Taken at face value that places it inside application control,
and this unit acted on that reading first — ⓘ **and the reading turned out to be
incomplete: the analytics below show these invocations are TERMINATED, not
throwing, and Cloudflare draws the same 1101 page for both.** The error page
alone cannot tell you which you have.

Cloudflare gives two ways to see the exception: Workers Logs filtered on
`$workers.outcome = "exception"`, or `wrangler tail` running at the time.

**Neither existed.** `observability` was `null` on this Worker, retention is 7
days on a paid plan and 3 on free, and **logs are not retroactive**. So for
`a3bccd61adbf464a`, the `a3bccd61…`–`a3bccd97…` burst, and the `a3bcd0d4…` /
`a3bcd0ea…` burst, **Cloudflare retains nothing that can be retrieved**. That is
a precisely located visibility limitation — a setting that was off — and not a
shrug, and it is the first thing this unit fixed. The Workers Observability query
API is behind the same 403 as the Builds API.
ⓘ *Corrected in Unit 6B.4B2P:* «nothing» meant no PER-INVOCATION log. The section
below retrieves Cloudflare's AGGREGATE analytics for those very hours, and Unit
6B.4B2P read them down to the minute and the script version. ⚠️ And «the first
thing this unit fixed» was not fixed: observability is a SCRIPT-LEVEL,
NON-VERSIONED setting that `wrangler versions upload` ignores (wrangler 4.125.0
sets it to `undefined` with the comment «logpush and observability are
non-versioned settings»). This unit only uploaded, and on 2026-09-16 22:15 UTC
the Worker still reported `observability: null`. The committed block takes effect
at the next deploy, not before, and no Workers Log was ever recorded.

### ⭐ AND THEN CLOUDFLARE'S OWN ANALYTICS ANSWERED IT: `exceededResources`

The GraphQL analytics API is NOT behind that wall. `workersInvocationsAdaptive`,
for this Worker, over the twenty-four hours to 2026-09-16 20:05 UTC:

| status | requests |
|---|---|
| `success` | **8 889** |
| **`exceededResources`** | **87** |
| `clientDisconnected` | 17 |

ⓘ *Corrected in Unit 6B.4B2P:* this query asked for 24 h to 20:05 but ran at about
19:52:30 UTC, so its counts stop there — before the Phase I observation windows —
and «19:00 (20)» below is that hour only through 19:48. Re-queried by 6B.4B2P for
2026-09-15 20:05 → 2026-09-16 20:05 UTC: `exceededResources` **107**,
`clientDisconnected` 17, `success` **10 212**.

`scriptThrewException` does not appear at all. **The failing invocations are not
throwing — they are being terminated for exceeding a runtime resource limit**,
and Cloudflare renders that termination to the reader as Error 1101.

And the hours line up with every burst this project has recorded:
`2026-09-15T22:00` (31), `23:00` (24), `2026-09-16T03:00` (12), `19:00` (20) —
6B.4B2M's two bursts, 6B.4B2N's, and this unit's.

~~**CPU is excluded, by the numbers.**~~ For the failing population, `cpuTimeP50` is
10 000 µs and `cpuTimeP99` 218 457 µs; for the SUCCESSFUL population, `cpuTimeP99`
is 329 780 µs and `cpuTimeP999` 631 242 µs. Successful invocations routinely use
far more CPU than the failing ones, which die early — at ~10 ms of CPU, ~73 ms of
wall time, having made about two subrequests each. ~~Cloudflare exposes no memory
dimension, so **memory pressure on the isolate is the supported inference** and
is labelled as one; what is measured is that the limit exceeded is not CPU, not
subrequests and not the daily request cap.~~

⚠️ **CORRECTED IN UNIT 6B.4B2P — THREE STATEMENTS IN THE PARAGRAPH ABOVE WERE
WRONG, AND THEY ARE STRUCK THROUGH RATHER THAN DELETED.**

1. **«CPU is excluded» did not follow from the numbers.** It compared two
   populations. A terminated invocation's CPU stops where it was killed, so the
   failing figures are cut short by the very event being explained, and a
   successful tail of 630 ms says nothing about the limit a killed invocation
   reached. The number that mattered was sitting in the paragraph unread: the
   failing median is **exactly 10 000 µs — ten milliseconds.**
2. **«Cloudflare exposes no memory dimension» was false.** The same dataset
   exposes `memoryUsageBytesP25` … `memoryUsageBytesP999` and `max.memoryUsageBytes`.
   An independent audit queried them and reported the failing population's
   `memoryUsageBytesP99` at ~65.6 MB against ~67.8 MB for the successful one
   (decimal megabytes; its exact window is not recorded here), under a 128 MB
   limit. 6B.4B2P's own query of the 24 h to 20:05, in bytes: failing p99
   **65 620 150** (62.6 MiB), successful p99 **72 876 160** (69.5 MiB). The
   successful figures differ from the audit's, which is what a different window
   or sampling would produce; both place the failures below the successes at p99.
3. **«Memory pressure is the supported inference» therefore had no support.** No
   terminated invocation measured more than **65 628 200 bytes (62.6 MiB)** —
   about half the limit. ⓘ The comparison of populations is NOT the argument,
   for the same reason it was not one for CPU: at the median the killed
   invocations used slightly MORE memory than the successful ones (56.9 against
   53.4 MiB over that 24 h, and higher in three of the four builds). The ceiling
   is the argument.

«Not subrequests» and «not the daily request cap» stand. What was measured
instead, and what it supports, is in § «Unit 6B.4B2P» below: every one of the
**196** `exceededResources` invocations in the dataset's whole 90-day retention —
all between 2026-08-23 and 2026-09-16, on ten builds including production
`e691ecd8` — used **at least 10.0 ms of CPU** (in 36 of 39 minute rows the
smallest was exactly 10.0 ms), and none used more than 62.6 MiB.

### Phase C — the exception-boundary audit

| path | classification |
|---|---|
| **Worker entry (`.open-next/worker.js`)** | **UNHANDLED** — no `try`/`catch` anywhere; it awaits the middleware handler, performs a request-time `import()` of the server handler, and awaits that |
| OpenNext adapter internals | OUTSIDE_APPLICATION_CONTROL — generated; now wrapped |
| asset / server-function dispatch | OUTSIDE_APPLICATION_CONTROL — now wrapped |
| **Next middleware (`updateSession`)** | **UNHANDLED** — runs on every route and sits outside `error.tsx` and `global-error.tsx`, which can only catch a Server Component |
| Supabase session creation / auth lookup | **CONTROLLED_BUT_MISCLASSIFIED** — a transport failure returns `{ data: { user: null }, error }`, indistinguishable from «nobody is signed in»; and the call was **unbounded** |
| `/login` sign-in action | **CONTROLLED_BUT_MISCLASSIFIED** — a transport failure was answered `invalid_credentials`, telling people their own password was wrong |
| protected-route redirect | ALREADY_CONTROLLED — fails closed |
| internal layout / `requireInternal` | ~~ALREADY_CONTROLLED — a throw renders `/studio/error.tsx`~~ ⚠️ *Corrected in Unit 6B.4B2P:* **CONTROLLED_BUT_MISCLASSIFIED.** A session check that failed or never answered redirected to `/login` like a signed-out visitor; a role read that failed redirected to `/dashboard` like a client (the rig's `reset`/`malformed`/`http500 /rest/v1` → 307); neither read had a bound (`hang /rest/v1` → no response). Every branch refused, and each outage was reported as a verdict about the person. Since 6B.4B2P `decideInternalAccess` (`src/lib/studio/internal-access.ts`) redirects only for a verdict and an outage throws `InternalAccessUnavailableError` with a closed code |
| canonical revision loader | ALREADY_CONTROLLED — typed read failures since 6B.4B2K |
| category review | ALREADY_CONTROLLED — `categorias-no-disponible` is its own branch |
| journey review | ALREADY_CONTROLLED — `PainReviewOutcome.ok === false` |
| publication workspace | ALREADY_CONTROLLED |
| `/api/health` | ALREADY_CONTROLLED — `try`/`catch` with a 5 s abort, answers 503 `degraded` |

### Phase D — fault injection against the real artifact, and what it falsified

The rig runs `.open-next/worker.js` under **workerd** through `wrangler dev
--local`, with a stand-in on `127.0.0.1` as its only upstream. It contacts no
Supabase project, no Cloudflare account and no production. Every probe carries a
synthetic session cookie, because **without one `getUser()` short-circuits in the
client and makes no network call at all** — a detail that would have made an
anonymous rig prove nothing.

**Thirty-two cases: a refused connection, a reset mid-body, malformed JSON, a
truncated body, HTTP 500, HTTP 503 and a hang, applied to the auth lookup, to the
data reads and to the whole upstream — and no case was seen to make the Worker
throw.** ~~Every one produced a controlled answer.~~

⚠️ **CORRECTED IN UNIT 6B.4B2P: «every one produced a controlled answer» WAS
FALSE.** The rig's own evidence (`faults-before.tsv`, `faults-after.tsv`) records
three probes with **no HTTP response at all** — `hang /auth/v1/user` on `/login`
and on `/studio` before the fix, and **`hang /rest/v1` on the review page both
before AND after it** — written as `000000`. The rig labelled them «controlled»
because of a defect in its own verdict: `curl … || echo "000"` produced `000000`,
the check compared against `000`, and the fallback verdict was «controlled». No
response is not a controlled answer. The bound this unit added covered the
middleware's session check only; the data read stayed unbounded until 6B.4B2P.

ⓘ **SO THE LEADING HYPOTHESIS IS FALSIFIED.** «An unguarded `supabase.auth.getUser()`
in the middleware rejects during a Supabase blip» is a good story, it fits the
bursts and the fact that `/login` was hit, and **it is not what happens**:
supabase-js turns a refused connection, a reset, malformed JSON, a truncated body
and HTTP 500 into `{ user: null, error }` and the middleware fails closed with a
redirect. *(Corrected in 6B.4B2P: this said «every one of those»; a hang is not
one of them — it returns nothing until something bounds it.)*

**Two real defects the rig did find:**

1. **THE SESSION CHECK WAS UNBOUNDED.** An auth service that accepts the
   connection and never answers left the request open past forty-five seconds
   with no response and no log. Bounded at eight seconds now, on the client's own
   `fetch`; measured after the change: **8.32 s on `/login`, 8.04 s on
   `/studio`**, against 0.02 s healthy. Of thirty-two cases, exactly **two**
   changed, and they are those two.
2. **TWO DIFFERENT FACTS WORE ONE FACE.** «Nobody is signed in» and «the auth
   service did not answer» arrive identically. The authorization decision is
   unchanged and still fails closed on both — refusing a reader we cannot vouch
   for is right either way — but the second is now named in the logs.
   ⓘ *Corrected in Unit 6B.4B2P:* named, but never as a timeout. The middleware
   chose `session_timeout` when `error.name === "AbortError"`, and auth-js renames
   every fetch rejection `AuthRetryableFetchError`, so that branch was
   unreachable. And the bound's `AbortSignal.timeout()` rejects with a
   `TimeoutError`, which postgrest-js retries three times on a GET — harmless
   only because that client made auth calls alone. Both are replaced by one
   shared policy (§ «Unit 6B.4B2P»).

**And the boundary was watched doing its job.** The GENERATED entry was perturbed
to throw on a header — the condition Cloudflare's 1101 definition names (ⓘ *6B.4B2P:*
not what the recorded bursts turned out to be; those were `exceededResources`
terminations) — and `/login`,
`/api/health`, `/studio` and the review screen each answered **503** with
`x-becommunity-unavailable`, `retry-after: 15`, HTML for a document and JSON for
an API path, and **no trace of the exception**. A thrown string classified as
`worker_unhandled`, a failed module import as `module_load_failed`. Twenty-one
log lines carried a code, a route CLASS, a method and a server-generated id, and
**zero** carried a path, a query, a cookie or a stack. The build output was
restored byte-identically, digest printed on both sides.

ⓘ *Scope, corrected in Unit 6B.4B2P:* those are the Worker's OWN structured lines,
counted under local workerd. They are not «what Workers Logs holds»: with
`[observability] enabled = true` applied, Cloudflare's automatic INVOCATION log
would record every request's method and full URL — path, query, study id — beside
them, and libraries write their own console lines (`@supabase/auth-js` logs every
failed auth fetch's raw rejection). This unit committed that block at a rate of 1
without saying so; it was never applied to the Worker, because observability is
non-versioned and only a deploy applies it. 6B.4B2P set
`[observability.logs] invocation_logs = false` for the deploy that eventually
applies it, and closed the method field to a list.

**The sign-in path was proved end to end, in a real browser, against the real
built Worker: 10 checks, 10 passed.** Control → `/dashboard`; refused connection
→ `?error=service_unavailable` and the sentence «No es tu contraseña»; HTTP 500 →
the same; a genuinely wrong password → `invalid_credentials`, generic and
unchanged. The diagnostic used to identify the error shape
(`AuthRetryableFetchError`, status 0 and 500) was a temporary perturbation of
`src/app/login/actions.ts`, restored to the committed blob byte for byte.

### Phases E and F — what changed

* **`src/worker-entry.ts`** is the new `main`. It imports the generated entry,
  re-exports its three Durable Object classes unchanged, and calls it inside ONE
  `try`/`catch`. It does not retry, does not touch a cookie, and never puts the
  thrown value into the answer — the response builder takes a CODE and has no
  parameter an exception could travel through.
* **`src/lib/runtime/unavailable.ts`** holds the five closed codes, the 503 with
  `Retry-After`, the self-contained failure page (no script, stylesheet, font or
  image — every one of those is another request that can fail in the same
  moment), and the one structured log line.
* **`[observability] enabled = true, head_sampling_rate = 1`** in `wrangler.toml`.
  A sampled log of a rare event is a log that misses it. ⚠️ *Corrected in Unit
  6B.4B2P:* at a rate of 1 that block would also switch on Cloudflare's
  invocation logs, which carry the method and full URL of EVERY request; 6B.4B2P
  adds `invocation_logs = false`. And none of it was in effect: observability is
  a non-versioned setting that `versions upload` ignores, the Worker still
  reported `observability: null` afterwards, and only a deploy applies it. ⓘ The block must stay
  BELOW the top-level keys: placed above them, the TOML table silently swallowed
  `compatibility_date` and `keep_vars`, and the build failed.
* **The middleware** is wrapped, bounded and classifies its two failures apart.
* **The sign-in action** answers a transport failure with `service_unavailable`
  and its own sentence.
* `CANONICAL_EDGE_DIAGNOSTICS` is **not** reused; the instrumentation reads no
  environment variable at all.

`npm run test:runtime-resilience` — **36 checks**, offline, no browser, no build
output, in `npm test`.

### Phase G — the obsolete variable, deferred with its reason

Proved: **no source file of any kind names `CANONICAL_EDGE_DIAGNOSTICS`** — it
appears only in documentation. It holds no credential; it is a plain-text
variable reading `"on"`.

It was **not removed**, for two reasons that compound. Removing a Worker variable
is a change to the Worker's settings, which creates a version **and makes it the
active deployment** — precisely the traffic change this unit is forbidden to
make. And with `keep_vars = true` a wrangler deploy will not remove it anyway;
the dashboard is the only place, and that is the same credential wall as Phase A.
**It is the first action of the production-deploy unit**, where a deployment is
happening on purpose.

### Phase H — the gates, and the preview

Every gate green at the corrected tip: `test:runtime-resilience` **36/36**,
`test:harness-condition` 33/33, migration chain PASSED, hosted fingerprint
**169/169**, row-set-live 56/56, category-review-live 88/88, signoff-live,
journey-pain-live and publication-live all PASSED, results parity **531/531**,
presentation parity PASSED, `test:secrets` PASSED, client-boundary,
publication-boundary and data-scope PASSED, typecheck 0, lint 0 errors / 58
warnings, `npm test` exit 0 over **120 scripts**, the 30 trailing gates 30/30,
`build` and `cf:build` clean. The hosted project did not move across any of it.

**Version `b80e30da-8690-4673-96aa-47c84f6c1ff7`**, tag `rc-6b4b2o-e27f877`, at
`https://b80e30da-becommunity-v1.ollinagencyllc.workers.dev`, BUILD_ID
`wDPLox8BIFjgpZtkQ4MdX`, 12 381.14 KiB / gzip 2 647.74 KiB, startup **21 ms**.
Uploaded with `versions upload`; production stayed `e691ecd8` and the deployment
listing was byte-identical across the upload. ⓘ The first attempt FAILED —
«Upload took too long. Asset upload took too long on bucket 1/1» after five
retries, creating no version. It is recorded because an environmental failure
that is not recorded becomes a mystery later.

### ⚠️ Phase I — THE BLOCKER, REPRODUCED ON DEMAND AND CHARACTERISED

Three QA passes: **195/199, 195/199, 154/199**. Three bounded observation windows
at concurrency one, ~2.5 s apart, with production as a read-only control:

| window | authenticated canonical pages | anonymous preview | production | Error 1101 |
|---|---|---|---|---|
| 1 · 19:53:12 → 19:56:48 | `.........XXXXXXXXXXXXXXX` — **9/24** | 24/24 | 16/16 | **15** |
| 2 · 19:57:17 → 20:01:29 | `........................` — 24/24 | 24/24 | 16/16 | 0 |
| 3 · 20:02:30 → 20:06:04 | `.........XXXXXXXXXXXXXXX` — **9/24** | 24/24 | 16/16 | **15** |

**Nine, then fifteen. Twice, exactly.** The pattern is not noise:

* it is **confined to the heavy authenticated canonical pages** — `/revision`,
  `/revision/categorias`, `/revision/dolor`. `/api/health`, `/login` and the
  anonymous protected redirect answered **72 / 72** across the three windows;
* once it starts it **does not recover inside the window** — every subsequent
  request fails ~~, which is what a poisoned isolate looks like~~;
* a fresh window minutes later is **perfectly clean** ~~, which is what isolate
  replacement looks like~~;
* ⓘ *Corrected in Unit 6B.4B2P:* the struck clauses named a mechanism nobody
  measured and read as a memory diagnosis. What the pattern matches, measured in
  6B.4B2P, is Cloudflare's documented CPU behaviour: «each isolate has some
  built-in flexibility» for a Worker that «infrequently runs over the configured
  limit», and «if your Worker starts hitting the limit consistently, its execution
  will be terminated»;
* **production was unaffected throughout**, 48 / 48.

⚠️ **AND THE NEW BOUNDARY DID NOT CATCH ONE OF THEM — WHICH IS THE POINT.**
`b80e30da` cannot let a handler rejection escape, and Cloudflare still served
Error 1101, with `x-becommunity-unavailable` absent from every one. **The
invocation is killed by the runtime; no handler runs; there is nothing to
catch.** The boundary removes a different category and keeps its value, and it
does not touch this one.

Ray IDs from window 1: `a3c26d3a2c9d6b7d` … `a3c26fa94c936b7d`; window 3:
`a3c27b8f3e3feaac` … `a3c27d3eab3beaac`; run 3 of the QA: `a3c263449c894608` …
`a3c26374ff324608`. All recorded in `~/becommunity-6b4b2o/soak-window-*.json`.

**No database mutation** across three authenticated QA runs: 15 791 rows,
Cuicuilco `draft` revision 3, publication tables 0/0/0/0/0/0.

### What this leaves

**The canonical review screen — the screen the whole release exists for — cannot
be loaded about ten times in a row on Cloudflare without the runtime killing the
invocation.** That is a release blocker, it is measured rather than suspected,
and it is not fixed by anything in this unit.

~~The direction of the fix is what the evidence supports: the per-request footprint
of the canonical review pages. They render a whole resolved presentation document
server-side, and 6B.4B2K already found their request budget at the edge of a
different ceiling. Reducing what one invocation holds is a piece of engineering,
not a switch, and it is the next unit's.~~

⚠️ *Corrected in Unit 6B.4B2P:* the struck paragraph pointed the fix at «what one
invocation holds» — the memory reading, which rested on the corrections above. The
pages ARE expensive, and 6B.4B2P measured how: 91 ms to 1 012 ms of CPU for one
document on Cloudflare's runtime. The exhausted resource and the next action are
in § «Unit 6B.4B2P».

The operational mitigation until then: **do not deploy the canonical build to
production**; production runs `e691ecd8`, which does not serve these pages at
all. Rollback remains `wrangler versions deploy e691ecd8-de9a-4a02-a8e3-13aad7e9e805@100%`.

---

## Unit 6B.4B2P — the terminations sit on a 10 ms CPU floor, every page-serving Supabase read now ends, and 6B.4B2O's record is corrected

Baseline verified before anything, 2026-09-16 22:13 UTC: branch and remote at
`6dcb065`, `origin/main` at `1c05276`, production `e691ecd8` at 100 % (health 200,
asset fingerprint `7f6c9470…` identical to its own preview host), candidate
`b80e30da` present, hosted project 15 791 rows / ledger `0000`–`0034` / Cuicuilco
`draft` revision 3 / publication tables empty — unmoved since 6B.4B2O closed.
**No deploy, no `main` push, no publication, no `study.status` change, no hosted
write, no migration, no credential change.** Evidence: `~/becommunity-6b4b2p/`
(WSL), copied to `C:\dev\becommunity-review-6b4b2p\` — outside every repository.
ⓘ Three files in it (`api/worker-settings.json`, `api/version-b80e30da.json`,
`api/version-e691ecd8.json`) carry the PUBLIC publishable key by value, exactly as
the API returns it; a scan for `sb_secret_`, JWTs, OAuth tokens and
password-bearing URIs finds nothing. It is not described as credential-free.

### The Git deployment setting — still not verifiable from here

`GET /accounts/{account}/builds/workers/becommunity-v1` and `…/triggers` answer
**403 · 10000** for the wrangler OAuth token, as in 6B.4B2O. Whether the operator
has changed *Deploy command* to `npx wrangler versions upload` is **externally
unverifiable** with this credential. Every rule stays: **do not push `main`.**
The branch push of `fd8effc` produced Workers Builds version `c0a995e7` with
`workers/alias` and no deployment, exactly as a non-production trigger should.

### The resource limit, read from Cloudflare — and what is still not read

| evidence | what it says |
|---|---|
| `workersInvocationsAdaptive`, whole 90-day retention (queried in 30-day slices under `maxDuration`) | **196** `exceededResources` invocations, 2026-08-23 → 2026-09-16, on **ten** builds — `c18405d9` 23, `2995bd70` 32, `1e17160e` 12, `b80e30da` 49, `868574e6` 16, `c60df1ec` 23, `677979fc` 28, `5487a684` 5, `9b218701` 1, and **production `e691ecd8` 7** (all in 2026-08-28 23:44, its deploy day) |
| smallest CPU of any terminated invocation | **10 000 µs** — no terminated invocation used less than 10.0 ms; in 36 of 39 minute rows the minimum is exactly 10.0 ms |
| largest memory of any terminated invocation | **65 628 200 bytes (62.6 MiB)** of a 128 MB limit |
| 24 h to 2026-09-16 20:05, by status | failing p50 / p99 **56.9 / 62.6 MiB**; successful p50 / p99 **53.4 / 69.5 MiB**, max 73.5 MiB — memory is nowhere near its limit; the medians do not order the populations and are not the argument |
| Worker script settings | `usage_model: "standard"`; **no `limits` field** — no `limits.cpu_ms` override; account `default_usage_model: "standard"` |
| the uploaded versions' `script_runtime` | no `limits` |
| subrequest ceiling | 6B.4B2K measured the runtime refusing request **#51** — the Workers Free figure (Paid allows 10 000) |
| Cloudflare's limits page | Free: **10 ms** CPU per HTTP request; Paid: 30 s default, up to 5 min via `limits.cpu_ms`; per-isolate «built-in flexibility» for a Worker that only infrequently runs over, termination for one that runs over consistently |
| `GET /accounts/{account}/subscriptions`, `GET /user/subscriptions` | **403 · 10000** |

**The reading this supports:** the terminations are Workers **CPU**-limit
terminations under a **10 ms** limit — the Free-plan limit — and the «nine good
loads, then every one killed» pattern is the documented per-isolate flexibility
running out. Memory is excluded by its ceiling, not by comparing populations.

**What is NOT established, stated exactly:** the plan is not READ. The
subscriptions endpoints refuse this token, and the effective CPU limit is not
exposed on any endpoint the token can read. «Workers Free, 10 ms» is inferred
from two independent limit signatures (the 10.0 ms CPU floor on every termination
in 90 days, and the fifty-first subrequest refused) plus the absence of any
override. **What settles it:** the operator reading *Workers & Pages → Plans*
(or *Manage Account → Billing → Subscriptions*) in the dashboard, or a token with
*Billing: Read*. Cloudflare's dataset carries no Ray ID, so no individual 1101 is
tied to an individual termination: every statement here is about populations in
the same minutes and versions.

### The heavy routes, measured before anything changed

**On Cloudflare's runtime** (`b80e30da`, one request kind per minute, four
requests fifteen seconds apart, CPU read back per minute from the analytics):

| request | CPU ms min / p50 / max | subrequests each |
|---|---|---|
| `GET /api/health` (anonymous) | 10.4 / 13.5 / 289 | 1 |
| `GET /login` (anonymous) | 25.3 / 32.6 / 478 | 0 |
| `GET /revision` (document) | **222 / 375 / 1 012** | 27 |
| `GET /revision/categorias` (document) | **122 / 344 / 389** | 19 |
| `GET /revision/dolor` (document) | **91 / 109 / 360** | 27 |

ⓘ **One browser visit is 28 Worker invocations, not one:** the document, the icon
and **26 RSC prefetches** — the Studio navigation's 13 links, fetched twice each
(~500 B, then ~1 KB). Each prefetch runs the middleware and its auth call; they
cost 5–15 ms of CPU apiece, so a single visit spends 1.1–4.1 s of CPU. Not changed
in this unit; recorded because it multiplies both the Worker's CPU and the auth
service's load per page view.

**Where the time goes** (Node 24, the same loaders against the hosted project
read-only, zod forced onto the interpreted path the Worker takes, CPU profiles;
module loading, TLS and decompression excluded as the runtime's rather than the
isolate's JavaScript; per call):

| loader | application JS | largest inclusive blocks |
|---|---|---|
| `loadStudioStudy` (every Studio page) | ~113 ms | `journeyMetricOptions` **28 ms** — 123 metrics computed over 3 282 rows, whose values these pages never render |
| `loadPublicationReview` (`/revision`) | ~191 ms | `buildPresentationRead` 33 ms (results 20, registry 12); canonical row set → source 14 ms; three resolutions 11 ms; two deterministic serialisations 8 ms; draft decode 7 ms |
| `loadCategoryReview` (`/revision/categorias`) | ~160 ms | `buildPresentationRead` 34 ms, of which the registry (12 ms) is never read by this page |
| `loadJourneyPainEditor` (`/revision/dolor`) | ~206 ms | `buildPresentationRead` 37 ms; a third, unread resolution and two serialisations |

Garbage collection is 20–30 % of every loader. Zod is 4–7 % (7–13 ms) and is
**not** the bottleneck; 4.4.3 is left as it is. **No single removable block is
more than ~15 % of a page, and the unavoidable remainder is still an order of
magnitude above 10 ms** — which is why this unit changed no route code: trimming
cannot move a 100–1 000 ms page under a 10 ms limit, and each candidate touches
calculation-adjacent code. The ranked candidates, for when the limit is not 10 ms:
the Studio prefetch storm; a key-only metric inventory for pages that render no
metric; skipping the registry on the category review and the review-only
resolution on the pain editor; hoisting the journey tally's per-call sets.

### Every page-serving Supabase read now ends — one policy

`src/lib/upstream/bounded-fetch.ts` and `outcome.ts`. The rules the installed
libraries force, each proved against the real clients:

* **An abort must be a `DOMException` NAMED `AbortError`.** postgrest-js 2.108.2
  retries any other rejection on a GET; `AbortSignal.timeout()` rejects with
  `TimeoutError`, so 6B.4B2O's bound would have turned one hung read into four
  (the gate's CONTROL shows it). The abort carries a sentinel message and nothing
  else.
* **auth-js renames every fetch rejection `AuthRetryableFetchError`** and keeps
  only the message — so 6B.4B2O's `session_timeout` branch was unreachable. The
  sentinel is how a timeout is recognised.
* **A 4xx is a verdict only when the auth service NAMED it.** Measured against the
  hosted project (`gotrue-shape.txt`): a refused sign-in is `400 {code:
  "invalid_credentials"}`, a bad token `403 {code: "bad_jwt"}`; the gateway's bad-key
  refusal is `401 {"message":"Invalid API key"}` with no code — an outage.
* **A 404, or a 2xx, with an empty body resolves with no error and no data.** It is
  never «empty». The Studio door reads its role as a LIST for that reason.
* Per attempt: auth 8 s, PostgREST 10 s, the timer armed through the body; a
  caller's signal honoured (pre-aborted → no request; in flight → cancellation);
  a runaway `Retry-After` dropped; the middleware and `requireInternal()` add a 9 s
  deadline over auth-js's own refresh retries.

Adopted by the reader's cookie client, the middleware, `requireInternal()`, every
admin client that reads to serve a page (client study page and filter preview,
legacy client loader, Studio home, `/admin` pages) and the read-only Studio actions
(the scope helper takes `"read" | "write"`). Admin clients that commit writes stay
unbounded on purpose. `requireInternal()` decides through a pure
`decideInternalAccess()`: a verdict redirects exactly as before; an outage records
`session_timeout`, `session_unverifiable`, `authorization_timeout` or
`authorization_unverifiable` and throws `InternalAccessUnavailableError`. The
sign-in action logs `sign_in_timeout` / `sign_in_unverifiable`. No RLS or
service-role authorization changed.

**The discrimination, on the real built Worker under workerd** (`fd8effc`, clean
build, stand-in upstream, `faults-after-2p.tsv`):

| fault | 6B.4B2O after its fix | 6B.4B2P |
|---|---|---|
| `hang /auth/v1/user` on `/login`, `/studio` | 8.32 s / 8.04 s | **8.15 s / 8.05 s**, `session_timeout` logged — the code 6B.4B2O could never record |
| `hang /rest/v1` on the review page | **no response (`000000`)** | **10.1 s**, Studio's error state, `authorization_timeout` |
| `hang /rest/v1/profiles` (role read) | — | 10.1 s, `authorization_timeout` |
| `http500 /rest/v1/profiles` | (as `http500 /rest/v1`) 307 — an outage answered as a verdict | 0.08 s, Studio's error state, `authorization_unverifiable` |
| `hang /rest/v1/study` (bounded admin read) | — | 10.1 s, Studio's error state |
| `reset /rest/v1/study` | — | 7.2 s (postgrest-js's own 1+2+4 s retries of a network failure, each bounded) |

Every probe answered; no hang was retried; 19 structured lines, **0** carrying a
path, study id, email or token. **Sign-in, in a real browser against the same
Worker: 13 of 13** — a hung auth service ends **8 190 ms** after pressing
«Entrar» with «No es tu contraseña»; a genuinely wrong password still answers
`invalid_credentials`.

### Observability — the decision, and what is actually in effect

`[observability.logs] invocation_logs = false` is added: Cloudflare's invocation
log records every request's method and FULL URL (study ids, query strings), and
the resource diagnosis above does not use it — it rests on the analytics dataset,
and the observability query API is not readable with this token. The structured
line's method field is closed to a list (`OTHER` otherwise).

⚠️ **None of it is in effect, and none of 6B.4B2O's block ever was.**
Observability is a script-level, NON-VERSIONED setting: `wrangler versions upload`
ignores it, the Worker still reports `observability: null`, and only a deploy
applies it — to every version, production included. Libraries also write console
lines of their own (auth-js logs every failed auth fetch).

### The gates — Windows and WSL

* `npm run test:runtime-resilience` — **47 checks.** Normalises line endings and
  proves its own detectors give the same verdict on CRLF and LF copies; executes the
  boundary (`src/lib/runtime/boundary.ts`) with counted delegates; runs the real
  `updateSession`; classifies the auth library's real error classes rather than a
  hand copy of the classifier.
* `npm run test:upstream-bounds` — **31 checks, new, in `npm test`.** Real
  supabase-js, auth-js and postgrest-js against a local stand-in, including the
  real middleware hanging for its eight-second bound. Every check has a 30 s
  watchdog.

| where | runtime-resilience | upstream-bounds |
|---|---|---|
| Windows PowerShell 5.1, before this unit (CRLF working copies) | **34 / 36 — 2 failed** | — |
| Windows PowerShell 5.1, `fd8effc`, files re-checked-out so `git ls-files --eol` reads `w/crlf` | **47 / 47** | **31 / 31** |
| WSL, user `patop`, `fd8effc` | **47 / 47** | **31 / 31** |

WSL at `fd8effc` (all 36 changed files byte-identical to their git blobs): typecheck
0, lint 0 errors / 58 warnings, `npm test` exit 0 over 122 scripts, the 30 trailing
gates 30 / 30, migration chain PASSED, hosted fingerprint **169 / 169**, row-set-live
56 / 56, category-review-live 88 / 88, sign-off / journey-pain / publication live
PASSED, results parity **531 / 531**, presentation parity **59 / 59**,
client-boundary, publication-boundary and data-scope PASSED; clean build with
**nothing inlined** (no Supabase variable in the shell, 0 files carrying the hosted
URL), `test:secrets` PASSED over that exact build. The hosted project did not move.

### The candidate, on the real runtime

**Version `bda4df63-f892-4f83-9eea-8d8d155bb5e9`**, tag `rc-6b4b2p-fd8effc`,
`https://bda4df63-becommunity-v1.ollinagencyllc.workers.dev`, BUILD_ID
`a_3LTfU6vsV5dxaWNA4fJ`, 12 741.96 KiB / gzip 2 718.07 KiB, startup 19 ms. Uploaded
with `versions upload`; the deployment listing was byte-identical across it.

Per-route CPU on it, same method: `/revision` 190 / 290 / 1 401 ms,
`/revision/categorias` 106 / 196 / 315, `/revision/dolor` 119 / 249 / 393,
`/login` 22 / 30 / 617, `/api/health` 17 / 17 / 382 — unchanged in kind, as expected
of a unit that did not touch the routes.

**QA: 199 / 199, 199 / 199, 199 / 199**; 22 bounded waits per run, all reached
ready (12.4–14.4 s of waiting in total per run); no forty-five-second filter wait;
Cloudflare recorded no termination in any QA run's span.

⚠️ **The bounded observation reproduced the blocker.**

| window (UTC) | authenticated canonical pages | anonymous | production | Error 1101 | controlled 503 | `exceededResources` (Cloudflare, `bda4df63`) |
|---|---|---|---|---|---|---|
| 1 · 01:02:50 → 01:06:50 | 21 / 24 | 24 / 24 | 16 / 16 | **3** | 0 | **3** — CPU min / p50 10.0 / 10.0 ms, max 38.0; memory max 46.9 MiB |
| 2 · 01:07:20 → 01:11:21 | 24 / 24 | 24 / 24 | 16 / 16 | 0 | 0 | 0 |
| 3 · 01:11:52 → 01:15:19 | **6 / 24** | 24 / 24 | 16 / 16 | **18** | 0 | **25** — CPU min / p50 10.0 / 10.0 ms, max 74.3; memory max 58.2 MiB |

Successful invocations in the same windows: CPU p99 188–504 ms, memory p99 57–66 MiB.
Across the whole span Cloudflare recorded 2 370 successes and **28 terminations on
`bda4df63`**, every terminated minute with a minimum of exactly 10.0 ms, and **no
failure on production `e691ecd8`** (42 successes). No probe went unanswered.

**The candidate fails the pass condition.** It is not deployable, and nothing in
this unit changes that: the bound makes hung reads end; it does not make a
100–1 000 ms page fit a 10 ms limit.

### Production and the hosted project

Production `e691ecd8` at 100 % throughout — deployment listing byte-identical to
this unit's baseline at the close, `/api/health` 200, asset fingerprint
`7f6c9470a2e91c09322a080d3ad6d110` identical to its own preview host. The hosted
project's closing capture is **byte-identical** to the baseline (`ccff0739…` both):
15 791 rows, ledger `0000`–`0034`, Cuicuilco `draft` revision 3, publication tables
0/0/0/0/0/0, category ledger 0.

### What this leaves, and the next action

**The release blocker is NOT resolved.** Its cause is now measured: the canonical
review pages consume 90 ms to 1.4 s of CPU per request on the runtime, and every
recorded termination sits on a 10 ms CPU floor.

**The next action is an operator's, not code's:** read the Workers plan in the
Cloudflare dashboard. If it is Workers Free, the decision is whether to move this
account to Workers Paid (30 s default CPU per request). Then, with no rebuild —
the limit applies to every version — repeat this unit's three bounded windows
against `bda4df63` and read `workersInvocationsAdaptive` for them. Only zero
terminations there reopens the deploy sequence (disarm `main`, remove
`CANONICAL_EDGE_DIAGNOSTICS`, `wrangler versions deploy`, client account,
`study.status`, publish). Until then: **do not push `main`, do not deploy.**

---

## Unit 6B.4B2Q — the bound releases when the answer does, an outage stops pretending to be a sign-out, and Studio stops downloading screens nobody asked for

Unit 6B.4B2P left three residual correctness defects and one load amplification.
This unit closes all four. **It changes nothing about the release blocker**, which
is the Workers Free 10 ms CPU limit, and nothing here should be read as progress
against it — the characterization window below reproduced the terminations on the
new candidate.

Baseline verified before anything was touched: branch tip `4b2a3ad` local and
remote, `origin/main` `1c05276`, worktree clean, no merge/rebase/cherry-pick in
progress, production serving `e691ecd8` at 100 % with its deployment listing
byte-identical to 6B.4B2P's closing capture, `bda4df63` present as a version and
absent from every deployment, hosted project byte-identical (`ccff0739…`).

### The plan is a read fact now, and it is a different kind of evidence

6B.4B2P could not read the account plan: every `subscriptions` endpoint answers
403 to the wrangler OAuth token, so «Workers Free, 10 ms» was recorded as the
strongly supported reading rather than as a read fact.

**An operator read the Cloudflare dashboard directly on 2026-09-17.** The Workers
plan is **Free**; the Free card shows *Current plan* and the Paid card shows
*Upgrade*; the Free limits shown are **10 ms CPU per request and 50 subrequests**;
Paid is offered at *$5/month + usage*. No billing change was made and none is
authorized.

Three kinds of evidence are now in play and must not be merged when quoted:

| Fact | How it is known | What it can support |
|---|---|---|
| The account is on Workers Free, 10 ms CPU, 50 subrequests | an operator read the dashboard | which limit applies |
| 196 terminations in 90 days, every one at ≥ 10.0 ms CPU, memory never above 62.6 MiB | `workersInvocationsAdaptive`, population level, **no Ray ID dimension** | that resource termination under those limits is what the data identifies |
| A review document costs 91–1 012 ms of CPU on `b80e30da` and 190–1 401 ms on `bda4df63` | one request kind per minute per version, read back per minute | that no trimming fits those pages under 10 ms |

The analytics cannot attribute any single browser 1101 to any single invocation,
and this unit does not claim otherwise.

### Cloudflare's own terms are more specific than the dataset's, and the codes do not line up

Recorded rather than reconciled, because rewriting either source would lose the
discrepancy:

* Cloudflare's **errors** page gives a CPU overrun its own code — **1102**,
  «Worker exceeded CPU time limit». Its **limits** page gives the same code a
  different message: «Worker exceeded resource limits». One code, two wordings.
* The dashboard's Worker Errors chart has an **Exceeded Memory** series; the
  documentation assigns no runtime error code to it.
* The analytics status actually recorded for these bursts is the generic
  **`exceededResources`**, documented as «Worker exceeded runtime limits … The
  most common cause is excessive CPU time, but is also caused by a Worker
  exceeding startup time or free tier limits» — broader than CPU alone.
* The page readers are actually served is **1101**, the code for a thrown
  exception, which is neither of the above.

So the browser code, the dataset status and the documented CPU code are three
different labels for the same bursts. **The 10 ms floor in the measurements is
what the diagnosis rests on, not the naming.**

### A. The bound is released when the answer is complete

`src/lib/upstream/bounded-fetch.ts` cleared its per-attempt timer and detached the
caller's abort listener **only on the rejection path**. Every SUCCESSFUL call
therefore left a timer armed for the remainder of its eight or ten seconds and a
listener attached to a signal it no longer cared about — on a page that makes
dozens of reads, dozens of live timers per request, and an abort the caller raised
after a call had already succeeded would still fire into it.

The bound is now held **per phase** and released at the end of each: once for
reaching the headers, once for reading the body. The body is wrapped in a
pull-based `ReadableStream` at **`highWaterMark: 0`** — load-bearing, because a
default stream pulls one chunk the moment it is constructed — so the body's bound
is armed by the FIRST read and released at EOF, at a cancellation, at a read
failure, or when it fires.

**A response whose body is never read therefore holds nothing, and that is the
shape every auth outage takes:** `@supabase/auth-js` throws
`AuthRetryableFetchError` for a 5xx BEFORE it calls `response.json()`, so on every
outage the body is abandoned unread. The first version of this unit's fix kept the
bound in that case; the adversarial review measured it and it was corrected.

Nothing is buffered: one chunk per `pull`, so backpressure and cancellation still
reach the upstream. Status, statusText and headers survive the re-wrap, repeated
`Set-Cookie` values are kept apart rather than joined with a comma, and
`content-encoding` / `content-length` are dropped because the body handed on is
the decoded one.

### B. A deadline cancels its operation; it does not merely stop waiting

`withinDeadline()` said so in as many words: «the operation keeps running if it
loses the race; the READER stops waiting». That left a hung `getUser()` holding
its socket, and `auth-js` free to open the NEXT attempt of a token refresh it had
already been told nobody was waiting for.

`upstreamOperation()` is one request's own cancellation — created where a request
is handled and **never shared**, so expiring one can cancel nothing but that
request's work. Its signal travels into the request's Supabase client through
`boundedFetch({ signal })`, composed with the per-attempt timer and with any
caller-provided signal. On expiry the attempt in flight is aborted and the next
attempt is refused **before it reaches the network**. The abort is an `AbortError`
carrying the timeout sentinel, so postgrest-js still does not retry it, and the
abandoned promise's rejection is still absorbed rather than left to nobody.

Measured against the real `@supabase/ssr` server client and a stale session — the
one path auth-js retries on its own — with a 150 ms attempt bound and a 900 ms
deadline: at least two attempts before the deadline, and **the request count at
the answer is the count two seconds later**. The product's own bounds (8 s and
9 s) are too far apart for a two-second window to tell the two implementations
apart, which is why the proof uses short ones.

The middleware and `requireInternal()` each create their own operation; the
reader's client factory takes the signal as an option and defaults to none.

### C. An auth outage is not a sign-out, and no longer says so

Until this unit the middleware named the outage — `session_timeout` /
`session_unverifiable` — and then continued with `user = null`, so a reader whose
cookies were perfectly valid was redirected to `/login` and invited to type a
password that could not be checked either. That is the conflation this whole
policy exists to prevent, committed by the code that names it.

| What happened | What a protected route gets now |
|---|---|
| the service answered, and there is no valid session | redirect to `/login` — unchanged |
| the session check timed out, was cancelled, or the service did not answer | **HTTP 503**, the product's own page, `x-becommunity-unavailable: session_timeout` or `session_unverifiable`, `Retry-After: 15` — and **never** a redirect |

`/login`, `/` and `/api/health` still render during the same outage: none of them
needs the answer, and `/login` cannot redirect on a session nobody could verify
because there is no verified user to redirect. **Nobody is signed out by it**: any
cookies the refresh had already written are carried onto the 503.

**Proved on the real runtime**, not only in the offline gate: fault injection
against the built Worker under workerd, with a stand-in as the only upstream,
24 probes —

| Fault on `/auth/v1/user` | `/login` | `/studio` |
|---|---|---|
| refused connection | 200 answered | **503 `session_unverifiable`** |
| reset mid-body | 200 | **503 `session_unverifiable`** |
| malformed JSON | 200 | **503 `session_unverifiable`** |
| truncated body | 200 (6.1 s) | **503 `session_unverifiable`** (6.0 s) |
| HTTP 500 | 200 | **503 `session_unverifiable`** |
| HTTP 503 | 200 | **503 `session_unverifiable`** |
| hang | 200 (8.1 s) | **503 `session_timeout`** (8.0 s) |

**Zero probes got no response, and zero showed the Worker throwing** — 6B.4B2P's
run had three of the former. The role read failing still renders Studio's own
error state (`authorization_unverifiable` / `authorization_timeout`, 1 + 2 lines),
and a hung role read ends at its 10 s bound. **19 structured lines, none carrying
a path, a study id, an email or a token.** No hang was retried.

### D. The Studio prefetch storm is gone

Next prefetches a `<Link>` as soon as the anchor enters the viewport. Studio's
frame puts thirteen on screen at once — four shell stops and the nine steps of the
process — and every one of those destinations is an authenticated, server-rendered
route. Every one of those RSC requests reaches the Worker and runs the
middleware's session check; a prefetch is NOT a page render (6B.4B2P measured them
at 5–15 ms of CPU apiece, because Next short-circuits a non-PPR prefetch of a
route with no `loading` boundary to router state), so removing them saves roughly
0.13–0.39 s of CPU and 26 auth round trips per visit — real, and nothing like the
2–36 s a «full render each» reading would suggest.

Measured in the browser, one settled visit, from a cold navigation, the count of
requests the page itself made:

| Screen | before (`b80e30da`) documents / background app requests | after (`28da64ac`) |
|---|---|---|
| `/studio` | 1 / **11** | 1 / **0** |
| `/studio/e/<id>` | 1 / **21** | 1 / **0** |
| `/studio/e/<id>/revision` | 1 / **22** | 1 / **0** |

Before, every destination was requested **twice**, under two different `?_rsc=`
cache keys — which is how thirteen links became twenty-six requests. After, the
document is the only request the app makes; static assets (15, 15, 19) are
unchanged and are served by the assets binding rather than by the Worker.

48 link sites across 25 files now declare **`prefetch={false}`**: the Studio
frame, the Studio bodies, and the same internal surface under its legacy `/admin`
paths, each of which wears `<StudioShell/>` and is listed in
`STUDIO_STOPS[].matches`. In Next 16.3.2 that turns off the viewport, hover and
touch prefetches (`prefetchEnabled = prefetchProp !== false`) and changes nothing
about clicking, the href, `aria-current`, the markup or accessibility.

`/insights` is deliberately NOT included: it is the client's surface, a different
audience, and no storm was measured there. `src/app/error.tsx`,
`src/app/not-found.tsx` and `src/components/insights/` each still prefetch an
authenticated destination — one link apiece on a page nobody stays on — and §[8]
of the gate says so rather than implying it covers them.

**This is a load fix and nothing more. It does not make any route fit the Free CPU
limit**, and the window below shows that directly.

### The candidate, and what one bounded characterization window found

Version **`28da64ac-d1b7-4702-8e44-71fd77cf6b4b`**, tag `rc-6b4b2q-8c971f7`,
`https://28da64ac-becommunity-v1.ollinagencyllc.workers.dev` — uploaded with
`wrangler versions upload`, and the deployment listing is byte-identical across
the upload. BUILD_ID `lJYZ8hwmfjYHrccR99s0f`, `worker.js` sha256 `d05223bf…`,
`.open-next` digest `ea1ea268…`, 12 764.70 KiB / gzip 2 722.14 KiB, startup 18 ms.
Built with no `.env` file and no Supabase variable in the shell: the compiled env
snapshot names nothing, and the hosted project's ref appears in 0 build files.

**The authenticated QA never got past its first page.** `/login` answered Error
1101 four milliseconds in (Ray `a3cb7f3d59236b38`), so the run was abandoned
rather than retried — the brief's own instruction, because repeating it expecting
a pass is what would waste the time.

**One bounded window, concurrency one, 192 requests over ten minutes**
(2026-09-17 22:20:33Z → 22:30:22Z):

| Arm | n | Result |
|---|---|---|
| preview, authenticated (the three review screens) | 72 | 12 ready, **60 in Cloudflare's error state** |
| preview, anonymous (`/login`, `/api/health`, `/revision`) | 72 | 38 × 200, 24 × 307, **10 × 500** (7 of them `/login`) |
| production, control (`/login`, `/api/health`) | 48 | **48 × 200, nothing else** |

**68 browser-visible Error 11xx. ZERO controlled 503s** — none of these is the
boundary answering, because a termination never reaches a `catch`.

Cloudflare's analytics for that exact window, by status and version:

| Version | status | n | CPU ms min / p50 / p90 / p99 / max | memory MiB p50 / max |
|---|---|---|---|---|
| `28da64ac` | success | 117 | 2.0 / 12.8 / 281.8 / 338.2 / 380.6 | 27.5 / 56.2 |
| `28da64ac` | **`exceededResources`** | **73** | **10.0 / 10.0 / 10.0 / 21.8 / 21.8** | 34.0 / 35.7 |
| `e691ecd8` (production) | success | 53 | 8.2 / 30.1 / 309.7 / 350.6 / 350.6 | 24.5 / 28.4 |

Every terminated minute's CPU **minimum is exactly 10.0 ms**, and the whole
terminated distribution is pinned at that floor; memory never passed 37 386 206
bytes (35.7 MiB) of a 128 MB limit. Production, on the same account in the same
ten minutes, recorded **no terminations at all** — its successful requests reach
350 ms of CPU, so the account is not throttling; what differs is which build is
asked to run.

### Verification

| Gate | WSL (`patop`) | Windows, working copies confirmed CRLF |
|---|---|---|
| `test:runtime-resilience` | **53 / 53** | **53 / 53** |
| `test:upstream-bounds` | **50 / 50** | **50 / 50** |

At the committed sha `8c971f7`, tree clean: `typecheck` 0 errors; `lint` 0 errors,
58 warnings; **`npm test` exit 0 over 122 scripts** (60 gates, the chain reaching
its end); the **30 gates the chain does not reach** run individually, 30 passed;
`test:migration-chain` PASSED; `test:canonical-presentation-hosted-fingerprint`
169 / 169; canonical **results parity 531 / 531**; **presentation parity 59 checks,
0 failures**; `test:harness-condition` 33 / 33; the Studio navigation and
authorization gates — `studio-workflows` 22, `studio-completion` 49,
`design-tokens` 59, `p8-acceptance` 59, `executive-preview` 63, `insights-story`
25, `client-admin`, `client-preview`, `journey-pain-review` 296,
`category-review`, `canonical-publication`, `canonical-composer`,
`canonical-client-publication` 99, `client-boundary`, `publication-boundary`,
`data-scope` — all pass; a clean build, and **`test:secrets` PASSED with a real
subject** (it exits 0 having scanned for nothing when `SUPABASE_SERVICE_ROLE_KEY`
is absent, so the run records that the key was present).

**Every new check was proved to DISCRIMINATE**: twelve defects reintroduced one at
a time at the committed sha — the bound armed at the headers, the attempt's bound
never released, the bound never released at EOF, the encoded body's headers
carried over, a buffered body, `withinDeadline` abandoning instead of expiring,
the operation signal not threaded, the middleware's client without it, the outage
redirected again (twice, executed and pinned), the study navigation prefetching
again, and an undeclared navigation surface. **12 of 12 were caught**, and all
eleven mutated files were restored **byte-identically** (SHA-256 compared).

### What the adversarial review found, and what was deliberately left

Five reviewers read the diff against the unit's own contract; every finding was
put to an independent verifier whose instruction was to refute it. Eighteen
findings, three survived verification, and eleven were acted on — several of the
refuted ones still identified a genuine weakness. What changed because of it: the
unread-body defect above (found by measurement, not by reading); the tag scanner
now refuses to guess instead of returning the rest of the file, and pins the
import name so an alias cannot hide a link; the completeness walk covers
`src/app/dashboard` too; a vacuous `doesNotMatch` assertion was deleted rather
than kept; the body-cancellation path got the check it never had; the prefetch
cost claim was cut back to what 6B.4B2P measured; 6B.4B2P's CPU figures were put
back where this unit had silently swapped them; and `docs/DEPLOYMENT.md` was
brought up to date.

**Two findings were recorded and NOT fixed**, and the reason is scope rather than
doubt:

* **Seventeen page-level and action-level session re-checks still read `!user`
  alone** and answer with a verdict — a `redirect("/login")` or «Acceso denegado» —
  when the auth service simply did not answer. Defense in depth (§6.4) means every
  protected page and Server Action re-checks the session, and the middleware's
  correction does not reach them: the reachable case is the service failing BETWEEN
  the middleware's check and the page's, which is narrow but real. Several also
  read the role with `maybeSingle`, which cannot tell «no profile» from «no
  answer». Seventeen authorization call sites is a unit of its own, and
  authorization is a declared human-review zone; the list is in CLAUDE.md.
* **Suite D is red, and it was red before this unit began.** Measured at the branch
  tip: 21 passed, 63 failed — 6 blocking advisories, 56 `assigned-secret-env` blobs
  and the consequent secret-leak exit. Every one of the 63 names a first-seen
  commit that is an ancestor of `4b2a3ad`, except the gate's own self-test sample,
  which has been in the repository since 2026-08-29. CLAUDE.md said «SUITE D
  REPORTS FIFTEEN»; that is corrected there. The growth is documentary — 19 of the
  blobs are CLAUDE.md and 23 are this file, because every revision of a document
  that QUOTES the matching line is itself a new matching blob, and D-d scans
  history. This unit adds two more for the same reason. Narrowing the pattern in
  `scripts/lib/secret-patterns.mjs` remains the right fix and remains a
  human-review zone; editing the prose to dodge the detector would be the wrong
  one.

### Production and the hosted project

Production `e691ecd8` at 100 % throughout, and in the characterization window it
was the clean control. At the close: deployment listing **byte-identical** to this
unit's baseline, `/api/health` 200, asset fingerprint `7f6c9470a2e91c09322a080d3ad6d110`
identical to its own preview host. The hosted project's closing capture is
**byte-identical** to the baseline (`ccff0739…` both): 15 791 rows, ledger
`0000`–`0034`, Cuicuilco `draft` revision 3, publication tables 0/0/0/0/0/0,
category ledger 0. No migration, no publication, no `study.status` change, no
credential touched, no billing change, no deploy, no push to `main`.

Evidence is outside every Git repository, in `C:\dev\becommunity-review-6b4b2q\`
(113 files); scanned for `sb_publishable_`, `sb_secret_`, a JWT shape,
`oauth_token` and a password-bearing Postgres URI — **no match of any kind**.

### What this leaves, and the next action

**The release blocker is NOT resolved, and this unit never expected to resolve
it.** The four defects it was asked to close are closed and proved; the prefetch
storm is gone; and the same candidate, on the same account, produced 73
terminations in ten minutes, every one on the 10 ms CPU floor, while production
produced none.

**The next action is the owner's.** The account is on Workers Free — read in the
dashboard, not inferred — and the decision is whether to move it to Workers Paid
(30 s default CPU per request, $5/month + usage). Nobody here may make that
change. After it, with no rebuild — the limit applies to every version — repeat
this unit's bounded window against `28da64ac`, then the three clean observation
windows the release condition asks for. Only zero terminations reopens the deploy
sequence (disarm `main`, `wrangler versions deploy`, client account,
`study.status`, publish). Until then: **do not push `main`, do not deploy.**
