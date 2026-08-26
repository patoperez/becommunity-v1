# Current state — Be Community V2

> Authoritative operational handoff. Last verified: **2026-08-24**.
> Read this after `CLAUDE.md` at the start of every new coding session.
> Historical files (`AUDIT_V1.md`, `docs/FASE_*.md`) explain past decisions but
> do not override this state.

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

## Verified source and deployment baseline

- Current `main`: `fd986940accae5a87170e3de0cb4b2f52dc9d7a9`
  (`feat(p8): establish the Be Community product experience foundation (#37)`),
  which also carries the merged P7 Suites B/C delivery (#38). Always verify
  `origin/main` before beginning new work.
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
- The connected Supabase project contains **synthetic test data only**. This is
  not yet the separate real-client production environment required at go-live.
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

## Current task — P8 product experience implementation

P7 engineering is concluded and merged: PR #38 integrated Suites B and C, PR
#37 integrated the owner-accepted P8-A foundation, and PR #39 integrated the
owner-accepted first P8.2 Studio slice. Remote `main` is now
`b1abfefecfc7b3534cc883e47ba95767fa43caea`; subsequent P8 work branches from
it directly. Do not reopen P7 correction loops
during product construction; controls blocked on custom-domain, production
Supabase, billing, full DR or real-client prerequisites return as a bounded
go-live pass after the product is functionally and visually complete.

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

**P8.2 completion — implemented and synthetic-acceptance-complete on
`claude/p8c-studio-workflows-completion-9bab28` from `ff87b84`, awaiting owner
review.** The record is
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

`npm run test:responsive-live` fails at 258 px on the CLIENT dashboard. It was
reproduced identically at the baseline `ff87b84`, so it is inherited rather than
introduced; 258 px is below the 320 px floor the design brief states and the
offenders are client-surface captions. P8.3 removes the technical captions from
its rebuilt longitudinal surface; the inherited 258 px stress case remains a
P8.5 final-responsive concern below the documented 320 px floor.

Also unchanged and still open: template ownership (decision D5 approved sharing
across the internal team with the author shown; `study_template` is still
filtered `.eq("created_by", user.id)`).

**P8.3 Insights data story — implementation-complete on
`p8d-insights-data-story`, awaiting owner review.** The real product now has
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

The finding DTO includes a nullable human-authored interpretation slot. It is
deliberately empty and silent client-side until P8.4 supplies its authoring,
approval, storage and publication workflow; no business interpretation was
invented. No formula, canonical row, ingestion adapter, role, RLS/grant,
migration or publication boundary changed. `npm run test:insights-story` is gate
29 of `npm test`. No screenshots were produced, by owner request; review is in
`.design/be-community-v2/implementation-reviews/p8-3-insights-story/REVIEW.md`.

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

Details for all three are in `docs/P8_PRODUCT_EXPERIENCE_PLAN.md` (§3 C11, §5
P8.2 and P8.4). Both P8.2 units and P8.3 are now implemented; P8.4-P8.5 remain
pending.

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
