# The canonical client read path

**Unit 6B.4B2I.** What a client actually receives after a canonical publication,
which route serves it, what it is allowed to read, and in what order a release
has to happen so a publication is not a silent no-op.

Everything below was measured against the code and against the hosted project
read-only, or executed against a disposable PostgreSQL. Nothing here is inferred
from a button's label.

---

## 1 · The route topology, before this unit

### Internal routes

| Route | Guard | What it rendered |
|---|---|---|
| `/studio` · `/dashboard` (internal branch) | `requireInternal()` / role read | Studio home |
| `/studio/e/[id]/construccion` | `requireInternal()` | The canonical composer |
| `/studio/e/[id]/revision` | `requireInternal()` | The canonical publication review — **the only place the canonical client experience was drawn** |
| `/studio/e/[id]/revision/dolor` | `requireInternal()` | The journey pain editor |
| `/studio/e/[id]/vista-cliente` | `requireInternal()` | **LEGACY P8** client preview |
| `/admin/preview/[id]` | role read | The same **LEGACY P8** preview, at its older address |
| `/studio/e/[id]/publicar` | `requireInternal()` | The **legacy** publication switch — it sets `study.status` |
| `/admin/*` | role read | Backoffice |

### Client-facing routes

| Route | Guard | What it rendered |
|---|---|---|
| `/` | — | Redirects to `/dashboard` |
| `/dashboard` · `/insights` | session + profile | The client home (legacy narrative, trends, study library) |
| **`/insights/e/[studyId]`** | session + profile + RLS | **LEGACY P8** study dashboard |
| `/api/studies/[id]/report` | session + RLS | **LEGACY** PDF, built by the legacy engine |

### The authorization boundary

`published_study_select` (migration 0010) is the whole of it: an `authenticated`
user may select a `study` row when their profile is `internal`, **or** when their
profile is `client`, the tenant matches, **and `study.status = 'published'`**.
Everything downstream — `loadAuthorizedStudyData`, and now the canonical reader —
authorizes by reading that row with the **reader's own session** and taking the
tenant from the row rather than from the request.

### The publication storage, and who read it

Migration 0030 created three tables and four functions, and migration 0031 added
the qualitative wrapper and its table:

- `canonical_presentation_revision` — the immutable snapshot (definition, render
  model, both digests, the full package identity, the acknowledged warnings);
- `canonical_presentation_publication` — one row per study, the active pointer;
- `canonical_presentation_publication_event` — the append-only log and the
  idempotency ledger;
- `canonical_publication_qualitative_signoff` — the sign-off recorded with a
  publication, in its transaction;
- `publish_canonical_presentation(…)`, `restore_canonical_presentation(…)`,
  `read_canonical_publication(study, tenant)`.

All three tables `force` RLS, deny `anon` and `authenticated` outright, and grant
`select` to `service_role` alone. The three functions are executable by
`service_role` alone.

**Application readers, before this unit: exactly one file** —
`src/lib/studio/publication-workspace.ts`, which is the internal review. It reads
the pointer and the snapshot for the review screen's own purposes. No
client-facing route named any of them.

### The two questions the audit had to answer

> **Can any real client-facing route resolve an immutable canonical publication?**
> **No.** `/insights/e/[studyId]` called `loadStudyDashboard`, whose `legacy`
> payload is `buildStudyDashboard(rows, qualitative, journey, filters, config)` —
> the P8 engine over legacy rows. The canonical publication tables were not
> reachable from it by any import path.

> **What production URL would a client receive after publication today?**
> `https://becommunity-v1.ollinagencyllc.workers.dev/insights/e/cd4d6acd-…`, and
> it would render the **legacy P8 dashboard** — the deployed Worker has no code
> that could read a canonical publication even though the hosted database has
> the tables.

> ⓘ **THE SENTENCE THAT USED TO STAND HERE WAS WRONG, AND UNIT 6B.4B2J MEASURED
> IT.** It read «Production is built from `main` (`c76762f4`), whose tree stops
> at migration `0021`». Neither half holds. `wrangler deployments list` shows the
> Worker serving version **`e691ecd8-de9a-4a02-a8e3-13aad7e9e805`**, deployed
> **2026-08-28T23:16:48Z** and built from commit **`4b0af06`** — which is on
> `claude/bni-executive-preview-hotfix`, is **not an ancestor of `main`**, is not
> an ancestor of this branch, and carries migrations up to **`0022`**. The claim
> was inferred from the documented «merge to main deploys» rule rather than read
> off the account. See §6a.

**«Publicar para el cliente» did not mean a client route was connected.** It
meant a row would be written that nothing a client can reach would read.

---

## 2 · The route topology, after this unit

Only one row changes, and it is the row that matters.

| Route | Change |
|---|---|
| **`/insights/e/[studyId]`** | Serves the **active canonical publication** when there is one; otherwise the documented legacy behaviour, unchanged |
| `/insights/e/[studyId]/actions.ts` | **New.** One Server Action, `previewPublishedStudyUnderSelection`, so a reader's filters recompute on the server |
| `/studio/e/[id]/vista-cliente` · `/admin/preview/[id]` | **Unchanged, and still LEGACY P8.** See §5 |

Nothing else moved. No route was added, renamed or removed.

### The three branches, and none of them is silent

```
loadPublishedClientExperience(requestClient, studyId)
  → { state: "published",     payload }  render the IMMUTABLE SNAPSHOT
  → { state: "not_published"          }  the documented legacy behaviour, unchanged
  → { state: "unreadable",    reason  }  a sentence — never the legacy engine
```

`unreadable` deliberately does **not** fall back. Answering a request for a
published study with different numbers computed by a different engine, and saying
nothing about it, is worse than an honest unavailable state.

---

## 3 · The canonical publication read contract

`src/lib/studies/published-presentation.ts` — `import "server-only"`, on its
first line.

### What it may read

Three things and no fourth: the `study` row (with the **reader's own session**,
so RLS decides), `canonical_presentation_publication`, and
`canonical_presentation_revision` — the last two named column by column, never
with a star, and every read scoped by **both** `study_id` and `tenant_id`.

`canonical_presentation_draft` is not named in the file, is not named in the body
of anything it calls on the publication path, and the offline gate asserts both.
**There is no branch in which a reader is served the thing an editor is still
working on.**

### What a client is given

The database's own projection, `read_canonical_publication`, whose whole body is
one `jsonb_build_object` of three keys — `version`, `publishedAt`, `renderModel`.
Expressed in SQL so it cannot acquire a fourth field by somebody widening a
`select`. Of those three the reading surface is handed `publishedAt`, the render
model and a count; the version stays on the server.

Absent by construction: the definition, both digests, the binding, the registry
build, the package identity, the plan fingerprint, the source draft revision, the
acknowledged warnings, the publisher, the note, the event log and the study's own
uuid.

### Authorization, and failing closed

`authorizeStudy` runs first, with the request-scoped client. The privileged
client — the only role that can read the publication tables at all — is
constructed **after** that has succeeded, and the tenant every later read uses
comes from the authorized row. A client of another tenant, a signed-in person
with no profile, and an anonymous visitor all get `not_published` and no payload;
a pointer filed under another tenant serves nothing.

### Immutability, and the one check that makes filtering safe

**What is served is always the stored snapshot**, byte for byte, even when the
recomputation below proves identical. The recomputation exists to decide whether
*filtering* is safe; letting its output become the served bytes would quietly
make the served thing a function of today's code.

A publication stores the render model resolved under the **neutral** selection.
The moment a reader ticks a filter a figure has to be recomputed, and a
recomputation is only honest if it is the published study's own arithmetic. So
rather than test the four things that could differ — evidence, registry build,
editorial content, resolver — and hope the list is complete, the reader
**recomputes the whole publication from scratch under the neutral selection and
requires the result to digest to `render_model_sha256`**, the digest stored at
publication.

- It reproduces → every input that could change a number is provably the one that
  was published, so recomputing under a filter is that same study filtered.
- It does not → the selection is **refused**, the immutable snapshot is served
  unchanged, and `filtersLive` is false, so the filter panels are not mounted at
  all rather than offered and refused on every click.

This is deliberately stricter than comparing binding fingerprints, and the live
gate proves the difference: deleting one answered `survey_response` leaves the
frozen document **still resolving** — same binding, same registry, same addresses
— while the model it produces no longer digests to what was published. A binding
comparison would have concluded that nothing had moved.

### Every number is computed on the server

The browser receives a finished render model and a count. `PublishedStudyView`
contains no `Math.`, no `.reduce(`, no `/ 100`, no `* 100` and no `toFixed(`, and
is handed no results. Contract C1, unchanged from the internal preview.

### It adds no door, and cannot publish

Everything that touches canonical data arrives through
`presentation-workspace.ts` — the composer's declared loader — and through
`journey-pain-workspace.ts`, which reaches it through that same file. The reader
takes **no** import of `publication-workspace.ts`: that module can publish and
restore, and a client-facing route should not have a write function in its import
graph even one the database would refuse.

The dependency gate proves this by **cutting**: it removes the declared loaders
from the import graph and requires the canonical layer to become unreachable from
the page. That is «every path goes through a declared door», where the earlier
single-path check could only say «the shortest one does».

---

## 4 · The same screen, proved as text

The client's surface and the internal review's preview put the **same test hook**
— `presentacion-canonica` — around the same renderer with the same audience. The
browser QA reads that subtree on both and requires them to be equal.

Measured on the real Cuicuilco package in a disposable stack: **15 692
characters, character-for-character identical.** That is what makes «revisé la
vista del cliente» a true statement rather than a hope, and it is what carries
the approved-dashboard comparison of Unit 6B.4B2H forward to the client's own
screen.

---

## 5 · Legacy P8, stated plainly

`/studio/e/[id]/vista-cliente` and `/admin/preview/[id]` render `ClientPreviewView`,
which is the **legacy P8 experience**: `loadAuthorizedStudyData` →
`buildStudyDashboard` → `NarrativeHome`, `LongitudinalTrends`, `StudyCard`. They
are **internal legacy previews** and they are **not** evidence about the canonical
client experience.

They keep their addresses and their behaviour. Renaming them would break the
frozen adversarial catalogue and every bookmark, for no gain: what was missing
was never a name, it was a client route that reads a publication, and that now
exists.

`/api/studies/[id]/report` is likewise legacy: `buildStudyPdf` over legacy rows.
**It is not part of a canonical publication**, and the canonical client surface
offers no download control. A publication's report, if one is ever wanted, has to
be built from the published render model — not from a second engine's recount.

---

## 6 · Deployment before publication, and why

**Deploy the capable reader first. Publish second.** This is not a convention; it
follows from the routes as they actually behave.

**Publishing first is a silent no-op with a misleading audit record.** Production
runs `main`, which has no canonical code at all. A publication would write an
immutable snapshot, move the pointer and record a named person's acknowledgement
— and every client would keep being served the legacy P8 dashboard, with no
indication that anything had been published. The first person to notice would be
the client, comparing what they were promised against what they can see.

**Deploying first changes nothing anybody sees.** With no publication, the new
reader answers `not_published` on its first branch and the legacy behaviour is
preserved byte for byte — proved by the live gate's section [2] and by the page
returning before `loadAuthorizedStudyData` is ever called. The deployment can
therefore be verified at leisure, and publication becomes the single, deliberate
moment at which a client's screen changes.

### Two blockers this unit found, which are not this unit's to fix

1. **`study.status` for Cuicuilco is `draft`.** `published_study_select` gives a
   client a study only when it is `published`, and the canonical publish path
   does **not** touch that column — it is a different decision, made on
   `/studio/e/[id]/publicar`. A canonical publication alone therefore leaves the
   study invisible to its own client. The live gate executes exactly this case
   and records it.
2. **The Cuicuilco tenant has zero profiles.** No client account exists, so
   «verify with a real client account» has no account to verify with. One has to
   be provisioned through the backoffice first.

## 6a · The deployment topology, as Unit 6B.4B2J OBSERVED it

Everything in this section was read off the Cloudflare account with
`wrangler deployments list` / `wrangler versions list`, or measured against the
deployed hosts. It replaces what earlier units inferred.

| | |
|---|---|
| Worker | one only: **`becommunity-v1`**, on `*.workers.dev`, no zone, no route, no custom domain |
| Deployed version | **`e691ecd8-de9a-4a02-a8e3-13aad7e9e805`**, 100% of traffic |
| Deployed since | **2026-08-28T23:16:48Z** — ten deployments in total, none since |
| Built from | commit **`4b0af06`**, on `claude/bni-executive-preview-hotfix` |
| Relation to `main` | **not an ancestor.** `main` last moved 2026-08-28T09:22Z, *before* this version was built |
| Relation to this branch | **not an ancestor.** Their merge base is `c76762f4` (= `main`) |

### A branch push builds a VERSION, and never a deployment

The earlier docs called this «not determinable». It is determinable, and it was
determined by correlating four pushes with the version list:

| pushed commit | push time (UTC) | version created |
|---|---|---|
| `5176416` (6B.4B2E) | 10:48:27Z | 10:49:56Z |
| `e1c5748` (6B.4B2G) | 19:41:35Z | 19:43:09Z |
| `1a5385d` (6B.4B2H) | 00:04:38Z | 00:06:16Z |
| `18dd8c5` (6B.4B2I) | 02:08:34Z | 02:10:24Z |

Four for four, about ninety seconds after each push — while the deployed version
has not moved since 2026-08-28. **Workers Builds is connected and builds this
branch into versions; it does not deploy them.** So a protected
release-candidate preview already exists for every push, at
`https://<version-id-prefix>-becommunity-v1.ollinagencyllc.workers.dev`, and
6B.4B2J's own upload (`e2cabbf9`, tag `rc-6b4b2j-18dd8c5`) is one more of the
same kind rather than new infrastructure.

### `keep_vars` is missing from this branch, and production has it

`wrangler.toml` on the deployed commit `4b0af06` sets **`keep_vars = true`**
(line 37) with a documented rationale. **Neither this branch's `wrangler.toml`
nor `main`'s contains it.** With `keep_vars` at its default `false`, a
`wrangler deploy` deletes every dashboard-set plain-text variable before
applying those in the configuration — and the configuration declares none. A
deploy of this branch as it stands would therefore strip
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the Worker.

The 14 commits in the deployed version that are on neither `main` nor this
branch include `d25d0e4 fix(deploy): keep the dashboard's variables when
Wrangler deploys` — the fix that added it — along with the «Revisar categorías»
feature and three insights readability fixes.

ⓘ **RECONCILED, AND CLOSED.** Unit 6B.4B2K ported six of them, leaving 17 files
byte-identical to production — `keep_vars = true` among them, with Suite D's own
enforcement. Three are documentation. The remaining five are «Revisar
categorías», and Unit 6B.4B2L **replaced the capability canonically** rather
than cherry-picking them: the surface is `/studio/e/<id>/revision/categorias`,
the storage is migration `0034`, and the differences from the legacy feature are
deliberate and listed in `docs/CURRENT_STATE.md`. **Nothing a merge would remove
is now unaccounted for**, and the one thing it WOULD remove that has no canonical
counterpart is the legacy screen's ability to merge participant ATTRIBUTE values
— which canonically is a filter dimension with a named methodological authority
behind it, and which no recorded decision has ever used: the hosted ledger holds
two rows, both `separate`, whose projection is empty.

### A canonical read fails on the Cloudflare edge and nowhere else

Measured on `/studio/e/<cuicuilco>/revision/dolor`, whose counters read
«unreviewed / approved / excluded / unresolved»:

| where | counters |
|---|---|
| local Node, this commit, hosted database | **0 / 15 / 0 / 0** — correct |
| local workerd (`wrangler dev`), the same artifact | **0 / 15 / 0 / 0** — correct |
| deployed version `e2cabbf9` (built here) | **0 / 0 / 0 / 0** |
| deployed version `fcdd9970` (**built by Cloudflare** from the same commit) | **0 / 0 / 0 / 0** |
| deployed version `2784061d` (Cloudflare, previous commit) | **0 / 0 / 0 / 0** |

So it is not the build, not this commit, and not workerd: it is **deployment on
the Cloudflare edge**. `loadCuratedPainReviewEvidence` throws there, and
`loadJourneyPainReview` catches it and returns an applicable-but-empty review —
which the publication preflight then reports as two **hard blockers**,
`required_content_missing` and `journey_pain_review_incomplete`, on a study
whose fifteen decisions are all recorded and approved.

**The leading hypothesis is the Workers free-plan 50-subrequest ceiling.** The
revision page runs `readAndBuild`'s twenty-six paged reads before it reaches the
curated-pain read, and the qualitative sign-off — later still — also comes back
as `qualitative_review_pending` when it is `current` locally. Both late reads
degrade; the early ones do not. It is a hypothesis, not a measurement: the
thrown `CanonicalReadError` code is swallowed and surfaced nowhere, so pinning
it needs one instrumented version.

**Two consequences that matter more than the cause.** First, a canonical read
failure is presented to a reviewer as «the editorial review is unfinished» —
indistinguishable from real unfinished work, on the screen whose whole job is to
say whether the work is done. Second, the client's own filtered read
(`previewPublishedPresentationUnderSelection`) performs the same `readAndBuild`
plus the same pain read, so **the canonical client path cannot be assumed to
work on Cloudflare until this is resolved.** Nothing in this repository has ever
exercised it there: every gate to date ran under Node or local workerd.

### The release sequence

| # | Step | Why here |
|---|---|---|
| 0 | ~~Resolve the edge canonical-read failure~~ **DONE (6B.4B2K)** — the fifty-subrequest ceiling was measured and removed; the review page costs 26 requests and the category review 18 | Until this passed, the canonical experience did not work where it would be served |
| 0b | ~~Decide what to do about the five «Revisar categorías» commits~~ **DONE (6B.4B2L)** — the capability is replaced canonically | A deploy would otherwise have made that decision silently |
| 0c | **Apply migration `0034`** to the hosted project, by the documented path, with a fresh verified backup and a restore rehearsal first | Until it is applied the category review is read-only: it shows the categories and refuses to record a decision, which is safe but is not the feature |
| 1 | ~~Restore `keep_vars = true`~~ **DONE (6B.4B2K)** — it is in `wrangler.toml` with its incident comment, and Suite D's D-g fails if it is removed or flipped | Otherwise a deploy strips the Worker's variables and regresses shipped work |
| 2 | Merge `codex/canonical-experience-integration` into `main` by the ordinary review | — but note that merging does **not** deploy; see §6a |
| 3 | Protected preview QA on the version Workers Builds produces from the merge commit | The reader is read-only and there is no publication, so a preview cannot change what a client sees |
| 4 | **Deploy explicitly** — `wrangler versions deploy`, or the documented `wrangler deploy` — and verify `/api/health` and one client route | A merge alone leaves production on `e691ecd8` |
| 5 | Provision a real client account in the Cuicuilco tenant | Blocker 2. Nothing can be verified as a client without one |
| 6 | Set `study.status = 'published'` on `/studio/e/[id]/publicar` | Blocker 1. Until this, RLS hides the study from its own client |
| 7 | **The controlled publication**: on `/studio/e/[id]/revision`, tick `granular_filter_dimensions`, tick the final confirmation, press «Publicar para el cliente» | The only step that changes a client's screen |
| 8 | Verify as the real client account, at three viewports, and compare against the approved dashboard | The client's own screen, not a preview of it |
| 9 | Rollback, if needed | See below |

### Rollback

Three independent levers, in increasing order of reach:

- **Hide the study** — set `study.status` back on `/studio/e/[id]/publicar`. RLS
  then refuses the row to every client of that tenant, immediately, and the
  publication is untouched.
- **Publish a corrected version** — the pointer moves; every earlier snapshot is
  kept and remains immutable. There is no «unpublish»: the model is
  forward-only, which is what makes an audit trail meaningful.
- **Roll back the Worker** — Cloudflare keeps prior deployments. The previous
  build has no canonical reader, so a client returns to the legacy dashboard.
  The publication rows remain and are served again the moment a capable build
  is deployed.

`restore_canonical_presentation` is **not** a rollback: it brings a snapshot back
into the working **draft** as a new draft revision. It moves no pointer and
changes nothing a client sees.

---

## 7 · The gates

| Gate | What it holds |
|---|---|
| `npm run test:canonical-client-publication` | Offline: the closed vocabularies and their sentences, the contract file's purity, the reader's tables and its one RPC, the page's three branches, the action's two parameters, the surface's arithmetic-free-ness, and the SQL projection's three keys. **99 checks** |
| `npm run test:canonical-client-publication-live` | Disposable PostgreSQL + PostgREST: publication through the real publish path, the immutable snapshot served, an editor's later save reaching nobody, a second publication, replay, authorization for four kinds of reader, server-side filtering, drift refusal, a malformed pointer. **78 checks** |
| `npm run qa:canonical-client-publication` | The real routes in a real browser against a disposable published study built from the real package: what each reader sees, the whole approved layout, operable and combinable filters, show-all, three viewports, and the character-for-character comparison with the internal review. **64 checks** |
| `npm run test:shadow-boundary` | The door table, now a **cut**: remove the declared loaders and the canonical layer must become unreachable from the page |

Each was proved to discriminate by perturbing the thing it protects and watching
it fail, then restoring the file byte-identically: the served model becoming the
recomputation, the page consulting the legacy engine first, the reading surface
starting to calculate, the client reader dropped from the door's loaders, and the
client reader importing the module that can publish. **5/5 caught.**
