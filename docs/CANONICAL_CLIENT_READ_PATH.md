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
> it would render the **legacy P8 dashboard**. Production is built from `main`
> (`c76762f4`), whose tree stops at migration `0021` and contains none of
> `src/lib/studio/publication-workspace.ts`, `presentation-workspace.ts` or the
> canonical presentation layer — so the deployed Worker has no code that could
> read a canonical publication even though the hosted database has the tables.

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

### The release sequence

| # | Step | Why here |
|---|---|---|
| 1 | Merge `codex/canonical-experience-integration` into `main` by the ordinary review | Production builds from `main` |
| 2 | Deploy to a **protected preview** Worker pointed at the hosted project | The reader is read-only and there is no publication, so a preview cannot change what a client sees |
| 3 | Preview QA as an authorized client: the study still renders exactly as it does today | This is the `not_published` branch; it must be byte-identical to current behaviour |
| 4 | Deploy to production and verify `/api/health` and one client route | Same reasoning; still no publication |
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
