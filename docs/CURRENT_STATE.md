# Current state — Be Community V2

> Authoritative operational handoff. Last verified: **2026-08-30**.
> Read this after `CLAUDE.md` at the start of every new coding session.
> Historical files (`AUDIT_V1.md`, `docs/FASE_*.md`) explain past decisions but
> do not override this state.

## Experience Composer — filter capability, focus mode, and one Top-2-Box

Standing reference: `docs/EXPERIENCE_COMPOSER.md`, **sections 33–37** for this
milestone. Branch `claude/experience-builder-filter-ux-focus`, from
`claude/experience-builder-preview-filters` at `0f67320`.

- ⓘ **A block DECLARES what a filter can do to it.** `BlockSpec.allowsFilters`
  answered two unrelated questions — may this block host a reader's controls,
  and does a reader's choice change what it says — so the selected-block card
  printed the whole characteristic registry as checkboxes on paragraphs,
  headings, the approved team reading, the study's cover and the download
  button. `BlockSpec.capabilities` replaces it with nine declared facts.
  Ineligible for a viewer filter, by declaration: `rich_text`, `section`,
  `cover`, `image`, `divider`, `spacer`, `interpretation`, `report_download`,
  `all_results_disclosure`, `filter_panel`. **Hosting is byte-identical to what
  `allowsFilters` permitted**, so no stored document became invalid; a gate
  asserts that equivalence type by type.
- ⓘ **The panel is the connection editor, not the block.** Which blocks a
  filter moves is one decision and was being asked once per block. A
  data-backed block's card carries a compact "Este bloque responde a" summary
  with *Ir al panel* and *Desconectar*; a static block's card carries **no
  filter section at all**.
- ⓘ **A connection that cannot do anything is never honoured and never a hard
  error.** `effectiveFilterTargets` drops it, the validator warns once
  (`inert_connection`), and the draft still saves. An older document is never
  stranded.
- ⓘ **The editor's chrome is not the document.** Which panels are open, focus
  mode and the canvas scale live in `sessionStorage` under one key and are read
  through `useSyncExternalStore`. Toggling a panel cannot mint a revision, mark
  the draft dirty or wake the autosave.
- ⓘ **Canvas scaling is a desktop affordance and is not the default.** At 40 %
  a 44 px drag handle measures 18 px. The canvas opens at full size and pans;
  the scale control is not offered below 1 024 px and a remembered scale is
  ignored there.
- ⓘ **THE CLIENT DASHBOARD'S Top-2-Box IS FIXED** — see the corrected entry
  below. It is the only client-facing change in this milestone.
- **The real BNI draft was not touched.** Before and after the live gate:
  revision **72**, canonical `sha256`
  `f4063b7c89dde25ced80ac3ac15ca9b2ae6d7e4a6bd86fb275c8a56f3b40829b`. Every
  mutation in `npm run test:filter-ux-live` happens on a disposable study it
  creates and deletes; the real study is read, looked at and photographed only.

- ⓘ **No Server Action on the builder or the draft preview may call
  `revalidatePath`.** It makes Next re-render the route INSIDE the action's
  response, which on this route meant a second full workspace load in the same
  request. On the Worker, against the real 3 282-answer study, the write landed
  and the re-render then aborted; the truncated payload's errored row reached
  the browser as React error #441 and the route's error boundary replaced the
  whole editor. Measured 4/4; an 80-answer study answered in 1.9 s with a
  complete tree. The action response is now 147 bytes instead of 7 788. The
  offline gate asserts the absence of `revalidatePath` in both action files.
- ⓘ **One request reads a study's rows once.** `loadLegacyStudySnapshot` used
  to read them while `loadBuilderWorkspace` read them again. The save action
  uses `loadBuilderRegistry`, which stops at the registry it validates against.
- ⓘ **A minted identifier is checked against the document it is joining.** The
  editor's `sequence` restarts at zero on every open, so duplicating the same
  block in a later session minted an id that already existed; the document then
  held two blocks with one id, was refused as `repeated block`, and EVERY later
  save failed. `mintFreeId` salts until free, without giving up determinism.
- ⓘ **A Top-2-Box is computed from the study's OWN scale, on EVERY surface.**
  `DEFAULT_CSAT_MIN` is 9, a 0–10 threshold; every `csat_*` result in the BNI
  study is answered 1–5, so all 55 satisfaction results read a confident, wrong
  **0.0 %**. The composer was corrected first, by deriving the scale in its own
  adapter — and `src/lib/dashboard/view.ts`, `src/lib/reporting/pdf.ts` and
  `src/lib/dashboard/longitudinal.ts` still called `computeStudyMetrics` with
  no `csatMin` at all. One fact, derived twice, and only one of the two right.
  **`src/lib/calc/scale.ts` is now the single derivation and all four read
  it.** The threshold is documented (4 on 1–5, 9 on 0–10, per
  `docs/CALCULATION_CATALOG.md` §4 and `docs/CALCULATION_POLICY.md` §5.1);
  `null` means the result keeps its average and its Top-2-Box is **omitted**
  rather than printed as 0 %; the threshold is derived from the WHOLE study and
  the numbers from the selection, so a filter can never change which rule a
  result is measured against; and an explicit `csatMin` still wins. Averages,
  rounding, stored responses, imports and the dashboard's layout, navigation
  and publication state are all unchanged. `npm run test:calc-parity` — 19
  checks — asserts the engine, the dashboard, the PDF (read out of the produced
  bytes) and the longitudinal series produce the same number from the same
  rows, on both documented scales, and all refuse the undocumented one.
- **`EXPERIENCE_SCHEMA_VERSION` is 2**, and the migration is in code only — no
  database change, `0023`/`0024` unchanged, nothing new applied. `oneToTwo`
  moves the first cover block's words into the global `identity` and removes
  that block, turns `query.filterRefs` into self-contained `query.fixedFilters`,
  and gives every block `filterPanel: null`. A version-1 draft opens without
  repair; proved by the gate and confirmed against the real saved BNI draft.
- **The study's identity is a global layer, not a block.** Title, client,
  period, introduction, mark and an optional report download, each with its own
  show switch, configured apart from every page and rendered once above them.
  It cannot be reordered under a chart or duplicated with a page. Pages keep
  every ordinary heading and text block they had.
- **`filter_panel` is the twentieth block type**, in a fifth group,
  `exploration`, beside `pivot_explorer`. A visible box the client explores
  with: addable anywhere, movable, duplicable, hideable, removable, width and
  wording configurable, one or many controls in an author-set order, *Limpiar
  filtros*, active selections shown, several per experience.
- ⓘ **What a panel moves is `filterPanel.target`**: `experience`, `page`,
  `sections` or `blocks`. The first two resolve at render time so later blocks
  join; the last two are BY ID and stay by id, so renaming never breaks a
  connection and a dangling id is a hard error. A block responds when EITHER a
  `filterConnection` names it OR a panel hosting that filter resolves to it —
  computed in one place, `effectiveFilterTargets`.
- ⓘ **Two kinds of filter, and they are not the same thing.** `Filtro fijo del
  bloque` is `block.query.fixedFilters`, carries its own characteristic and
  values, and is independent of every viewer control. `Panel de filtros para
  explorar` is the reader's transient view. A reader can never widen past the
  author: same characteristic, the two are intersected.
- **A reader's selection is transient.** Held in the preview's state, mirrored
  into the URL so a view can be refreshed or shared internally, never written
  anywhere. The URL carries an opaque filter id and segment values already
  printed as chart labels — no respondent, no answer, no metric key — and the
  route runs `requireInternal()` first.
- **Client-specific vocabulary lives only in
  `src/lib/experience/template-suggestions.ts`.** The gate refuses a client's
  name in every generic module. Suggestions decide what a freshly adapted panel
  OPENS WITH and restrict nothing; a study matching none falls back to what it
  has. **Age range is deliberately not a default.**
- **Two previews.** `Vista previa del borrador`
  (`/studio/e/[studyId]/vista-previa`, internal only, saved draft, real
  aggregates, publishes nothing, banner and a way back) and `Ver versión
  actualmente publicada` (`/studio/e/[studyId]/vista-cliente`, unchanged).
- **The canvas is drawn at the previewed width** (1 120 / 720 / 360) and
  scrolls sideways inside its own box; the page never does. A scale control
  (100/75/50 %) shows the whole arrangement. The semáforo's missing-range
  warning is a short chip on the block and the full sentence in its card.
- Gates: `npm run test:experience-composer` (**143**, inside `npm test`) and
  `npm run test:calc-parity` (**19**, inside `npm test`);
  `npm run test:experience-editor-regression` (**35**) and
  `npm run test:filter-ux-live` (**51**) inside `npm run gates:live`. The
  regression gate drives thirty editable operations consecutively against a
  production build and asserts after EACH that the editor is still interactive
  and that no Server Action response carried a re-rendered tree. The filter-UX
  gate composes a disposable study, drives the eighteen filter-panel acceptance
  items on it, reads the real study without writing to it, and writes fifteen
  screenshots to `artifacts/filter-ux/` (gitignored).
  `npm run test:p8-acceptance-live` now visits the draft preview too — 21
  routes × 6 widths = 126 views.
- **A zero-traffic Cloudflare version exists and was NOT promoted.** Version
  `8ad38467-b6ea-4d4c-920b-4ddb9b612cb3`, tag `builder-9aa7159`, preview URL
  `https://8ad38467-becommunity-v1.ollinagencyllc.workers.dev`. Its
  `/api/health` answers 200 with `supabase: true`, `/login` renders, and every
  internal address — the builder and the new draft preview included —
  redirects an unauthenticated request to `/login`. The Worker's live version
  is still `e691ecd8-de9a-4a02-a8e3-13aad7e9e805` at 100 %, and the artifact
  was built from a checkout with NO `.env` file.
- **Measured on the Worker, before and after, same study, same platform:** the
  save action went from ~10 s / 7 788 B / truncated-and-errored / error
  boundary 4 of 4, to ~2 s / 147 B / clean 4 of 4. On BNI the recommendation
  result reads 30.8 over 39 unfiltered, 41.4 over 29 filtered to "Más de 5
  años", and 33.3 over 18 filtered to "Generación X"; the satisfaction results
  read 64.3 % / 60.7 % / 40.7 % / 37 % where all 55 previously read 0.0 %.

## Experience Composer — the dashboard builder, persisted and unpublished

Standing reference: `docs/EXPERIENCE_COMPOSER.md`. Read it before touching
anything under `src/lib/experience/**`.

- **The product direction is a governed data-experience builder.** Internal
  users compose pages, sections and blocks over the SAME canonical
  calculations, tenant authorization, approved qualitative evidence and
  immutable publication snapshots. It is not an unrestricted query tool, and no
  client-specific behaviour may be hardcoded: a client's configuration is
  registry DATA and becomes a reusable starting template.
- **Three layers.** Truth (imported data, canonical calculations, tenant
  access) is not editable from the builder. Meaning (semantic results and
  characteristics, categories, qualitative review, journeys, interpretations)
  is edited only through the governed workflows that already exist.
  Presentation (pages, blocks, layout, charts, filters, copy) is what the
  builder edits, and it references the other two only by opaque handle.
- **`ExperienceDefinitionV1` is a strict Zod boundary** enforced server-side:
  no unknown fields, no SQL/HTML/script/CSS/template syntax, no database key, no
  respondent, no recursion (blocks do not nest), and an explicit ceiling on
  every list and on the serialized byte length. A document a browser posts back
  goes through it exactly as a stored blob does.
- **A DRAFT IS STORED; NOTHING IS PUBLISHED.** Migrations `0023` and `0024`
  (applied to the provisional synthetic project `ontvqazsqiwisdddblif` on
  2026-08-30) create `study_experience_draft`, `study_experience_revision` and
  `study_experience_event`. RLS is enabled AND forced on all three, `anon` and
  `authenticated` are denied outright, and `service_role` holds only SELECT:
  every write goes through `save_study_experience_draft`, a `security definer`
  function that re-checks the internal role, derives `tenant_id` FROM THE STUDY
  ROW and refuses a document naming another study or client. A published
  revision is immutable — refused an UPDATE by trigger and by privilege — and
  **nothing writes one yet**. No client-facing route reads a composed
  definition; saving a draft leaves the client's own study page character for
  character identical, which the live gate proves.
- ⓘ **A lost update is SQLSTATE `55000`, never `40001`.** PostgREST retries a
  serialization failure, so a `40001` refusal never reaches the caller —
  measured at 125 098 ms and an HTTP 504 with no message, against 148 ms for
  `55000`. Any future refusal that must reach a browser needs a code the Data
  API delivers, and the live gate asserts the promptness as well as the code.
- ⓘ **The universal minimum-five suppression is a per-study POLICY, and nothing
  about current routes changed.** `show_all` / `warn_below` / `hide_below`,
  versioned, with a per-block override, editable in the builder. NEW composed
  experiences default to `show_all` (results visible from n = 1). EXISTING
  studies keep today's behaviour: the compatibility adapter stamps the legacy
  hide-below-five rule onto every definition it derives, a gate asserts the two
  agree at every base from 0 to 60, and a published snapshot freezes the policy
  it was published under. `src/lib/calc/disclosure.ts` and every client-facing
  surface are untouched. Tenant isolation, RLS, authorization and
  raw-personal-data protection are NOT configurable by any mode.
- **The canvas shows the study's own numbers.** `src/lib/experience/data.ts`
  resolves exactly the aggregates the document asks for, through
  `npsFromScores`, `csatTopBox`, `mean` and `percentage` and nothing else,
  rounded once at the precision the unit declares. The handle-to-key index
  never leaves the server. On the real BNI Cuicuilco study the builder renders
  a recommendation result of **30.8** over 39 answers — the same number the
  canonical function produces, asserted by the live gate — and none of the
  study's 123 canonical metric keys, no quote and no respondent identifier
  appears on the page.
- **Fifteen of the eighteen chart variants are drawn.** Mapa de calor, burbujas
  and rectángulos proporcionales are NOT, and each says so by name above the
  reference representation rather than being substituted silently. The semáforo
  is implemented and refuses to colour anything without a range somebody agreed
  to.
- **The pivot/comparison explorer is a block** (`pivot_explorer`, the
  nineteenth type), not a warning. It carries no author query: the reader writes
  it, through the same server-side allowlist P4E established.
- **A filter moves a block only when a connection names it.** Sharing a
  characteristic is not a connection, and duplicating a block or a page inherits
  none.
- **Layout has no coordinates.** A block declares an order and a span on a
  12-column grid; rows wrap. Overlap and horizontal overflow are impossible by
  construction, and every block is full width on a phone.
- **`/studio/e/[studyId]/construccion` is the builder.** It runs
  `requireInternal()` before any read; both Server Actions revalidate identity
  and role from scratch. Pages panel left, canvas centre, block card right, save
  state on top. The panels collapse on a computer and become drawers below their
  dock width — the pages at `lg`, the card at `xl`, so the canvas stays
  dominant. A block shows a drag handle and one compact menu, not five buttons;
  the handle drags with a pointer and moves with the arrow keys. Column widths
  are editable from 768 px up. It autosaves, says which state it is in, offers
  an explicit save and a retry, keeps undo and redo, and detects a second
  editor's save instead of overwriting it.
- **AI is deliberately out of scope** for the builder: no model call, no SDK,
  no secret, no table, no interface. The category advisor is untouched.
- ⓘ **All four of the adapter's original "cannot carry" warnings were defects,
  and all four are fixed rather than announced.** The pivot explorer was a MODEL
  gap and is now a block. A configured ideal range was a MODEL gap — the query
  carries `target`, `targetMaximum` and `targetLabel`, and the adapter places
  the study's configured range on the block that shows that result. A
  characteristic with more values than a chart can draw was an ADAPTER defect —
  a chart's legibility ceiling applied to a filter CONTROL, so the adapter
  dropped a filter the deployed dashboard offers; controls have their own,
  larger ceiling. A recorrido moment whose result the data no longer produces is
  invalid legacy configuration, is preserved visibly without a number, and is
  never repaired from this screen.
- Gates: `npm run test:experience-composer` (123 checks, inside `npm test`);
  `npm run test:experience-persistence-live` (23) and
  `npm run test:experience-builder-live` (20) inside `npm run gates:live`. The
  builder gate needs `npm run build && npm start` — React development calls
  `eval()` and this application's CSP correctly forbids it, so under `next dev`
  the builder never hydrates.
- **A zero-traffic Cloudflare version exists and was NOT promoted.** Version
  `dcb339cb-044f-4d8e-83a9-597ec76a392d`, tag `builder-f84c512`, preview URL
  `https://dcb339cb-becommunity-v1.ollinagencyllc.workers.dev`. Its
  `/api/health` answers 200 with `supabase: true`, `/login` renders, and the
  builder route redirects an unauthenticated request to `/login`. The Worker's
  live version is still `e691ecd8-de9a-4a02-a8e3-13aad7e9e805` at 100 %, and
  the artifact was built from a checkout with NO `.env` file, with credentials
  in the shell — Suite D is green on that build.
- **Before this may control the client dashboard**: publication (approve →
  snapshot → serve, on the ONE publication surface), a per-study switch on
  `/insights/e/[studyId]`, a client-side renderer that is not the builder's
  canvas, and a decision about the three undrawn variants. None is started.
  `docs/EXPERIENCE_COMPOSER.md` §22 is the list.

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
- **The Cuicuilco study's 31 qualitative observations are `pending`**, awaiting a
  real human editorial review. Their text and the generated suggestions are
  preserved; no theme is confirmed, no quote is approved, and nothing
  qualitative is client-visible. The study is `draft`.
- **The live suites refuse to run on an incoherent build or with stale synthetic
  accounts.** `/admin/upload` carries two upload forms, so the harness scopes
  its locators to the form that owns the control it will click; a first-match
  locator silently drove the wrong one and made eight Suite C checks look like a
  broken upload boundary.
- **The real study reconciles exactly** — 60 respondents, 3 282 quantitative
  answers, 31 qualitative answers, 123 metric keys, zero discrepancies across
  every key and every segment value — and remains `draft`. Re-prove it with
  `scripts/real-study-verify.mjs`.
- **Categories are reviewed by a person, between import and publication.**
  `/studio/e/[studyId]/categorias` finds answers that may be the same written
  two ways, shows what grouping each pair would change, and records the decision
  in an append-only ledger (`category_decision`, migration `0022`). Nothing ever
  merges automatically, at any confidence, from any source. Raw rows are never
  rewritten: the grouping is projected onto
  `segment_dimension.config.aliases`, the mechanism the calculation layer
  already read. Publishing pins the grouping into `study_category_snapshot` so
  a delivered report stays reproducible when a later decision changes the
  working state. Undo writes an inverse version and destroys nothing. The
  OpenAI advisor is implemented, tested against mocks, and **disabled**: no key
  is configured anywhere and `EVALUATION_APPROVED` is `false`. Standing
  reference: `docs/SEMANTIC_CATEGORY_REVIEW.md`. Gates:
  `test:categories` (324 checks), `test:category-evaluation` (0.0% false-merge
  rate over 33 labelled pairs), `test:categories-live`.
- **Journey editing no longer loses focus while typing.** The verified fix at
  `cda09ac` separates stable editor identity from the stored journey-stage id,
  removes the same unstable-key pattern from the import mapper, and adds both a
  deterministic gate (`test:journey-editor`) and a real-browser gate
  (`test:journey-editor-live`). The latter reproduced 26/26 caret losses on the
  prior Worker and then passed on localhost, preview and the live Worker at
  desktop and 375 px. The disposable study was restored and the Cuicuilco study
  was not written.
- **Cloudflare deployment has an open configuration precondition.** A manual
  `wrangler deploy` on 2026-08-28 replaced the two dashboard-managed public
  Supabase text variables and caused an approximately nine-minute HTTP 500
  incident. Service was rolled back, a preview version was verified, and Worker
  version `677979fc-b5fa-4704-ba9b-622cedf24f44` was promoted healthy with the
  two text bindings restored for that version. Before any later deploy, add and
  verify Wrangler's `keep_vars = true` protection (or the equivalent
  `--keep-vars` invocation) and confirm the Worker-level variables still exist.
  Secrets were not deleted by the deploy.
- **`keep_vars` is necessary but not sufficient, and that is now measured.** It
  preserves WORKER-level plain-text variables; the two public values currently
  live only at the VERSION level, so a `versions upload` without `--var` yields
  a version bound to `ASSETS` alone and every route answers 500. Proven on a
  zero-traffic preview on 2026-08-28 and never seen by a user. The durable fix
  is a human adding the two Text variables in the dashboard. Until then, upload
  with `--var` for both public values, verify the preview, and only then
  promote.
- **That precondition is now satisfied in the repository.** `wrangler.toml`
  carries `keep_vars = true`, and Suite D's new **D-g** check fails if it is
  removed, flipped, commented out, or joined by a `[vars]` block — with six
  synthetic drift cases exercised on every run. The public values stay in the
  dashboard and the privileged key stays an encrypted secret; neither is
  committed.
- **The Cuicuilco preview is a reading, not the instrument.** Until
  `claude/bni-executive-preview-hotfix` the study page opened with all 123
  results as cards and then crossed every one of them against a characteristic
  with 28 values — 852 KB of HTML, 122 000 characters of visible text, and the
  sentence "muy pocas respuestas para mostrarlo" repeated **1 455 times**. It
  now opens on the panorama, the retention series, the recorrido and the
  results the study's own configuration names; the complete inventory sits
  behind a closed `Explorar todos los resultados (124 resultados)` disclosure
  with a search, and one `Comparar por segmento` explorer replaces the matrix.
  Measured on the same page: 208 KB, 18 900 characters, **zero** repetitions.
  No formula, threshold, stored row or published snapshot moved.
  `computeStudyMetrics` gained `includeCrosses`, default `true`, so the PDF and
  every other caller keep the exact result they had. Gate:
  `npm run test:executive-preview` (63 checks).
- **54 is the right number, and it is not 60.** The study holds **60**
  respondent rows, **3 282** quantitative answers and **31** comments. Exactly
  **54** of those people left at least one answer of either kind; the other
  **six** are all `estado_membresia = Desertor` with `respondio_encuesta = No`
  and have no quantitative row and no comment. The screen counts response
  units, so it says 54, and the base sentence now states what it counts: *"Se
  cuenta a quien dejó al menos una respuesta."* This is a fact about the
  fieldwork, **not** an application defect and not a paging fault — the
  reconciliation in `scripts/real-study-verify.mjs` still matches the workbooks
  exactly. Nothing was corrected, deleted or re-imported. The retention series
  remains a single committed import of **six** periods; do not upload it again.

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

- Active verified P9 delivery baseline: `cda09acbfe0eab54e32a8505e3b6020c9dd68c10`
  on `claude/final-security-data-hardening`; it is pushed, deployed and
  live-verified. A first superseded commit contains a variable-name-shaped test
  fixture that Suite D's full-history D-d scan intentionally flags. The final
  tree contains no such shape, and the identical tree tested as a squash commit
  over `main` passes D-d. Preserve history on the branch; clear the reachable
  superseded blob only through the planned squash merge followed by branch
  deletion.
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
