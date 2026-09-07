# Canonical experience integration plan — the selective manifest

> **What this document is.** A file-by-file decision about the previous
> experience-builder line, `origin/claude/experience-publication-versioning` at
> **`6311f0af22259c5f8907ae93e22c3090daaffc85`**, measured against the canonical
> line at **`ad51496dfc6af9e97ea7f8e18cb14dd334d2637b`**. Their common ancestor
> is exactly `origin/main` (`c76762f428834b7401118b7d2ad7f0d40158d56a`), so the
> two lines diverged and neither contains the other.
>
> **This is not a merge plan.** No wholesale merge or wholesale cherry-pick of
> that branch happens, in Unit 6A or in Unit 6B. The branch is a source of
> PROVEN IDEAS — an editor model, a layout grid, an explicit filter-connection
> design, a publication lifecycle — and of one thing that must never be carried
> across: its data adapter, which reads a legacy study and computes.

---

## 1. The five classifications

| Verdict | Meaning |
|---|---|
| **REUSE** | The idea and substantially the code carry over, re-pointed at canonical types. |
| **ADAPT** | The design is right and the implementation must be rewritten against the canonical registry / results contract. |
| **REPLACE** | Unit 6A already built the canonical answer; the legacy module is superseded. |
| **DROP** | It must not come across at all, and the reason is a rule rather than a preference. |
| **DEFER** | Legitimate and wanted, but it is Studio-composer work and belongs to Unit 6B. |

---

## 2. What already happened, and what did not

**The migrations already crossed.** `0022_semantic_category_review`,
`0023_experience_definition_persistence`, `0024_experience_draft_conflict_code`
and `0025_experience_publication`, with their four reverse scripts, are in the
canonical tree and are **byte-identical** to the experience branch's copies —
verified by blob hash on both commits:

| migration | blob (identical on both lines) |
|---|---|
| `0022_semantic_category_review.sql` | `70f96fffd99ea90096b6cd5b525c9c71b892664a` |
| `0023_experience_definition_persistence.sql` | `a566a0852eb01b6cd6b2ac8bc8ef8f3344b83525` |
| `0024_experience_draft_conflict_code.sql` | `0b22849229210aff8168dcb3b43889b50ce57725` |
| `0025_experience_publication.sql` | `c26a4bfe5a6c62b83502834a491699d62642788e` |

All four are **already applied to the hosted project**. So the database already
has the draft, revision, event and publication tables — and the application layer
that used them was deliberately left behind. Unit 6A adds no migration and
changes none.

**Nothing else crossed.** At the canonical tip `src/lib/experience/` has **zero
files**, and every component, route, gate script and document listed below is
absent. Four applied migrations cite modules that do not exist here
(`0023:24` → `definition.ts`, `0023:82` → `migrate.ts`, `0024:38` → `storage.ts`,
`0025:87` → `serialize.ts`, and `0023:10` → `docs/EXPERIENCE_COMPOSER.md`).
Those citations are dangling today; Unit 6B is what makes them true again, and
this manifest is the plan for doing so deliberately rather than by import.

**One sentence in migration `0023` already describes Unit 6A's design.** The
comment on `study_experience_draft` (`0023…sql:105-106`) reads: *"Presentation
only: pages, blocks, layout, filters and authored copy, referencing results by
opaque registry handle. Never a respondent, an answer, a quote or a canonical
metric key."* That is the contract `src/lib/presentation/` now implements.

---

## 3. `src/lib/experience/*` — all 36 modules, 15 003 lines

| Verdict | Lines | Module | Decision and canonical replacement |
|---|---:|---|---|
| **DROP** | 955 | `adapter.ts` | The legacy-study → definition bridge. It reads `parseDashboardConfig` / `parseJourneyDefinition` and builds an experience out of a legacy dashboard. Two independent reasons it may not cross: it is a **legacy data adapter**, and it **stamps `LEGACY_SAMPLE_POLICY` (`hide_below 5`) on every definition it produces**. The canonical replacement is `buildCanonicalPresentationRegistry` over a `CanonicalStudyResults`, whose default is `show_all`. |
| **DROP** | 1079 | `data.ts` | The aggregate resolver. It delegates formulas to `src/lib/calc/*` — correct for its architecture, forbidden for this one, where the server has already produced every final value. Replaced by `resolve.ts`, which reads and never computes. |
| **DROP** | 164 | `band-filters.ts` | Classifies each respondent into a band and writes a derived column onto **every row of that respondent**. That is a per-person derivation in the presentation layer. Bands arrive from the canonical `ResultBand` instead. |
| **DROP** | 261 | `bands.ts` | Band vocabulary and `classify()`. Band ranges are a documented business rule owned by the canonical band functions; a second classifier is a second source of truth. |
| **DROP** | 71 | `template-suggestions.ts` | Suggested filter names for adapted templates — an artefact of `adapter.ts`, which is dropped. |
| **REPLACE** | 274 | `registry.ts` | The legacy semantic registry (`SemanticMetric` / `SemanticDimension` / `AGGREGATIONS`). Superseded by `src/lib/presentation/registry.ts`. The legacy one names an **aggregation** a block should perform; the canonical one names a **result that already exists**. |
| **REPLACE** | 76 | `resolve.ts` | Superseded by `src/lib/presentation/resolve.ts`. |
| **REPLACE** | 349 | `fixtures.ts` | A demo registry of nine invented concepts. Unit 6A's gate builds a synthetic *study-shaped* fixture instead, so what is proven is the real partition (29/6/10/10) rather than a toy. |
| **ADAPT** | 1237 | `definition.ts` | **The most valuable single file.** Its Zod discipline (`z.strictObject` everywhere, so unknown fields are rejected), its three string kinds, and its closed vocabularies are the model for `src/lib/presentation/document.ts`. Adapted, not copied: the canonical document binds by opaque handle, and its `schemaVersion` is **4** so it can never collide with the legacy 1–3. |
| **ADAPT** | 391 | `filters.ts` | **The proven idea Unit 6A most depends on.** `definition.ts:753-773` states it exactly: *"Sharing a characteristic is not a connection… Nothing is ever matched by key; a block responds when, and only when, a connection names it."* Adapted as `connectedFilterPanelIds`. `inertConnections` and `removalConsequence` are Unit 6B editor affordances. |
| **ADAPT** | 232 | `layout.ts` | The 12-track responsive grid and its three breakpoints carry over as `GRID_COLUMNS` and `BlockPlacement.span`. `rowsFor` / `spanClass` are renderer helpers and belong with the renderer in 6B. |
| **ADAPT** | 220 | `sample-policy.ts` | The mode vocabulary and the per-block override carry over. **The direction is inverted where it matters**: `DEFAULT_SAMPLE_POLICY` is `show_all`, `LEGACY_SAMPLE_POLICY` is not ported, and the two suppressing modes now REQUIRE `authoredBy` and `rationale` so a hide-below rule cannot be defaulted, inherited or stamped. |
| **ADAPT** | 72 | `serialize.ts` | Canonical key-sorted JSON + byte ceiling. Adapted as `src/lib/presentation/serialize.ts`; the 512 KiB limit is kept because the database CHECK (`0023…sql:93-96`) enforces exactly `524288`. |
| **ADAPT** | 314 | `migrate.ts` | Its five stated rules are adopted wholesale — forward only, never in place, **a published snapshot is never migrated**, an unknown version is a refusal that NAMES the version, and every step is tested against a frozen fixture. Unit 6A migrates nothing; it establishes the boundary those rules police. |
| **ADAPT** | 765 | `blocks.ts` | The block catalogue as a DATA TABLE with capability flags is the right shape. Unit 6A carries the minimum it needs (four block kinds); the full catalogue with its authoring affordances is 6B. |
| **ADAPT** | 424 | `charts.ts` | Chart-variant catalogue and `compatibleVariants`. Unit 6A implements the compatibility relation as `COMPATIBLE_CHART_VARIANTS`, keyed by canonical SEMANTIC rather than by legacy metric family. `isRendererImplemented` / `alternativeVariant` are 6B. |
| **ADAPT** | 69 | `text.ts` | The authored-text boundary. Unit 6A applies the same idea narrowly (control characters and bidirectional overrides refused; escaping left to React). The full injection surface is revisited in 6B. |
| **ADAPT** | 141 | `ids.ts` | Opaque FNV-1a identifiers with a kind prefix. Unit 6A's documents use author-supplied ids validated by pattern; minting belongs to the editor, so the module itself lands in 6B. |
| **ADAPT** | 109 | `limits.ts` | Ceilings. Unit 6A pins the ones the database enforces; the editor-facing ones are 6B. |
| **ADAPT** | 171 | `fingerprint.ts` | `SHA256_HEX`, `STUDY_FINGERPRINT_PATTERN`, `IDEMPOTENCY_KEY_PATTERN` and `definitionHash`. The patterns are mirrored in `src/lib/presentation/persistence.ts` — NOT in the authorable document, which Unit 6A.1 stripped of every database-owned field. The hashing itself is 6B, because nothing in 6A/6A.1 writes a revision. |
| **ADAPT** | 687 | `validate.ts` | Hard/soft codes against a registry. Unit 6A implements the hard half as typed `PresentationErrorCode`s; the SOFT codes (advice that does not block) are an editor concern and land in 6B. |
| **ADAPT** | 276 | `client-visibility.ts` | Contract C11 — absence is not a client-facing finding. Unit 6A preserves the states (`configuration_required` survives resolution intact); the *rendering* rule belongs to the client renderer in 6B. |
| **DEFER** | 2560 | `editor.ts` | Every builder edit as a pure function, with undo/redo. Wanted, unchanged in spirit, and squarely Unit 6B. |
| **DEFER** | 860 | `diff.ts` | Structural diff between two definitions. 6B. |
| **DEFER** | 653 | `preflight.ts` | Publication blockers and warnings. 6B — but note `LOW_SAMPLE_RESPONSES = 5` must become a WARNING about an authored policy, never an automatic suppression. |
| **DEFER** | 652 | `publication.ts` | Reads/writes the 0025 tables. 6B. Unit 6A deliberately touches no table. |
| **DEFER** | 383 | `defaults.ts` | Factories for new blocks/pages. 6B. |
| **DEFER** | 337 | `inventory.ts` | Human-readable inventory for the review screen. 6B. |
| **DEFER** | 322 | `theme-cloud.ts` | Deterministic word-cloud layout. 6B, and it pairs with the approved dashboard's measured Archimedean cloud. |
| **DEFER** | 315 | `builder-workspace.ts` | `server-only` builder state loader. 6B. |
| **DEFER** | 253 | `client-experience.ts` | Client-facing selection/resolution. 6B. |
| **DEFER** | 182 | `storage.ts` | Draft load/save via RPC. 6B. |
| **DEFER** | 167 | `publication-workspace.ts` | Publish-review screen state. 6B. |
| **DEFER** | 150 | `review.ts` | Review/approval model. 6B. |
| **DEFER** | 113 | `viewer-params.ts` | URL ⇄ viewer selection. 6B. |
| **DROP** | 111 | `study-snapshot.ts` | Builds a `LegacyStudySnapshot` from the legacy tables — the input half of the dropped adapter. |

**Totals for `src/lib/experience/`:** REUSE 0 · ADAPT 14 · REPLACE 3 · DROP 6 · DEFER 13 — **36 files**.

There is no REUSE in this folder, and that is the honest result: every module
either binds to legacy types or belongs to an editor that does not exist yet.

---

## 4. Everything else on that branch

| Verdict | Count | Area | Decision |
|---|---:|---|---|
| **DEFER** | 9 | `src/components/studio/experience/*` | `ExperienceBuilder`, `BlockView`, `Charts`, `DraftPreview`, `JourneyManager`, `SemaforoManager`, `AuthoringPanels`, `ExploreViews`, `Audience`. The Studio composer UI. Unit 6A builds no React. |
| **DEFER** | 4 | `src/components/studio/publication/*` | Publication review, restore, revision preview. 6B. |
| **DEFER** | 1 | `src/components/insights/PublishedExperience.tsx` | The client renderer. 6B, and it must RECEIVE a render model. |
| **DEFER** | 10 | `src/app/studio/e/[studyId]/{construccion,categorias,vista-previa,publicar}` + `src/app/insights/e/[studyId]/experience-actions.ts` | Routes and server actions. 6B. Unit 6A adds no route — the canonical layer still has exactly ONE door to the application, and this unit does not open a second. |
| **DROP** | 8 + 5 | `src/lib/categories/*` and `src/lib/categories/advisor/*` | The semantic-category advisor stack, including an **OpenAI provider**. Adjacent to the experience builder, not part of it, and out of scope: no AI classification belongs in this line of work. Migration `0022` (its schema) is already applied and stays. |
| **DROP** | 1 | `src/lib/dashboard/results.ts` | A legacy-results module. Superseded by `src/lib/results/`. |
| **ADAPT** | 1 | `src/lib/calc/scale.ts` | A calculation-correctness addition. If it fixes a real defect it belongs in the CALCULATION layer on its own merits, reviewed as calculation code — never imported as part of an experience port. |
| **DEFER** | 13 | `scripts/experience-*.mjs`, `scripts/journey-editor-*.mjs`, `scripts/renderer-parity-test.mjs`, `scripts/executive-preview-test.mjs`, `scripts/category-*.mjs`, `scripts/lib/publication-live-harness.mjs` | The experience gate suite. 6B rebuilds these against the canonical binding layer; the category ones are dropped with the advisor. |
| **DEFER** | 1 | `docs/EXPERIENCE_COMPOSER.md` (2404 lines) | The composer specification. 6B reads it as a source, and rewrites what it keeps. |
| **DONE** | 4 + 4 | `supabase/migrations/0022–0025` + rollbacks | Already present, byte-identical, already applied. **Never re-apply, never edit.** |
| **N/A** | ~20 | Modifications to files that also exist on the canonical line | `M`-status files (`src/lib/dashboard/view.ts`, `src/lib/studio/*`, `wrangler.toml`, `package.json`, …). These are the branch's own edits to shared files and are NOT ported: the canonical line has diverged, and re-applying a diff written against `main` is how a silent regression enters. |

---

## 5. Package scripts and dependencies

- **Dependencies: no change, and that is a decision.** The experience branch's
  `package.json` differs in scripts and in the advisor's requirements. Unit 6A
  adds **no dependency**, and the two gate scripts it registers use the pinned
  toolchain already present (`tsx`). The lockfile is untouched, which also keeps
  Suite D's **D-f** npm-10 lockfile check exactly where it was.
- **Scripts added by Unit 6A — two, and only one runs in `npm test`:**

| script | in `npm test`? | why |
|---|---|---|
| `test:canonical-presentation` | **yes** | Fully synthetic and offline. Runs everywhere. |
| `test:canonical-presentation-parity` | **no** | Needs the two real workbooks, whose paths are machine-specific. Run without them it reports itself SKIPPED — never as a pass. This mirrors `test:canonical-results-parity` exactly. |

---

## 6. What Unit 6B is, stated precisely

Unit 6B is **selective Studio composer integration against the Unit 6A binding
layer**. It is *not* a merge of `claude/experience-publication-versioning`, and
no part of it is satisfied by cherry-picking that branch.

Concretely, 6B:

1. rebuilds the editor state machine (`editor.ts`'s pure-function + undo/redo
   design) over `PresentationDocument`;
2. rebuilds the block catalogue and authoring panels over the **catalogue
   projection**, never over the registry's address map;
3. brings back draft persistence and the immutable publication lifecycle against
   the already-applied `0023`–`0025` tables, writing `schemaVersion = 4`;
4. builds the client renderer, which RECEIVES a `PresentationRenderModel` and
   owns no formula;
5. answers the one open compatibility question below.

**The question Unit 6A left open is now ANSWERED, by reading rather than
guessing.** Unit 6A claimed the database could not reveal the stored versions.
That was wrong: `schema_version` is `not null`, and the save RPC requires it to
equal `definition.schemaVersion`, so the value was always readable. A read-only
inventory on 2026-09-06 found:

| study | `schema_version` | JSON `schemaVersion` | `documentKind` | revision | family |
|---|---:|---:|---|---:|---|
| ACEPTACIÓN P6E — DATOS SINTÉTICOS (TEST) | 3 | 3 | absent | 14 | legacy experience |
| La voz de las y los Nets de Cuicuilco | **2** | 2 | absent | 72 | legacy experience |

Column and JSON agree on both rows; neither is malformed; neither is a canonical
presentation document. Nothing was mutated.

So 6B does not need to decide what those rows are — it needs to honour what they
are. The owner's stated policy applies cleanly: **retain both as evidence, create
a new v4 canonical presentation from the approved blueprint, and never
automatically convert a layout built on the legacy model.** The real study's
draft is at version 2, so any future conversion would need the legacy v2→v3 step
before v3→v4 even existed — which is precisely the automatic conversion the
policy rules out.

---

## 7. The rule this manifest exists to enforce

A wholesale merge would bring `adapter.ts` and `data.ts` with everything else,
and with them a frontend that computes and a `hide_below 5` stamped onto every
adapted study. Both are one import away at all times. That is why the answer to
"can we just merge the branch?" is no, and why this file is a manifest rather
than a merge plan.
