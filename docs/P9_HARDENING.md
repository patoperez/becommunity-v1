# P9 — Final hardening and the first real study

Everything here is a standing rule or a procedure, not a narrative. It covers
the boundary between what a build may see and what only the Worker may see, the
contract every complete database read now holds to, the ingestion reader's
limits, and how the BNI Cuicuilco study is reconciled against its source.

No credential, no participant value and no workbook content appears in this
file, and none may be added to it.

---

## 1. Configuration: what the build sees, and what only the Worker sees

**The split is a security boundary, not a convenience.**

| Variable | Build | Worker runtime | Why |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes (plain text) | public; inlined into the client bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | yes (plain text) | public by design, RLS-protected |
| `SUPABASE_SERVICE_ROLE_KEY` | **never** | **encrypted secret** | bypasses all RLS |

### Why "never" is literal

The OpenNext Cloudflare adapter compiles the project's **`.env` files** — not the
build environment — into `.open-next/cloudflare/next-env.mjs`, and replays them
into `process.env` inside the Worker. A `.env.local` sitting in the build
directory therefore ships its contents inside the deployed bundle. That is how a
service-role key reached a Worker once, and it is invisible in review: the file
is generated, gitignored and never read by a human.

At runtime the adapter applies the **Worker's own bindings first**, and only then
fills gaps from that snapshot. A real Worker secret always wins. The snapshot is
consequently never *needed* for a privileged value — only capable of leaking one.

### The rule

> Build the deployable artifact from a checkout with **no `.env` file**. Keep
> credentials in the shell environment.

Every credential-bearing script takes `--env-file-if-exists`, so the whole gate
chain runs that way.

### The gate that enforces it

`npm run test:secrets` (Suite D, D-e) fails when a privileged variable **name**
appears in the compiled env snapshot. It is value-independent on purpose: it is
red whether the build ran with the production key, with a synthetic canary, or
with nothing at all. It separately fails if the configured key's **value**
appears anywhere in `.next/static` or `.open-next`.

### Setting the runtime secret

Worker, then Settings, then Variables and Secrets:

- `NEXT_PUBLIC_SUPABASE_URL` — type **Text**
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — type **Text**
- `SUPABASE_SERVICE_ROLE_KEY` — type **Secret** (encrypted; write-only afterwards)

Equivalently, `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`.

Workers Builds, then Build variables, must contain **only** the two public
values. If `SUPABASE_SERVICE_ROLE_KEY` is present there, remove it: the build has
no use for it, and a build variable is visible to anything the build runs.

### Preserving dashboard variables during a Wrangler deploy

Wrangler treats repository configuration as authoritative. Without
`keep_vars = true` (or the `--keep-vars` flag), a deployment removes
dashboard-managed plain-text variables that are absent from the configuration;
secrets are preserved. On 2026-08-28 this exact behavior removed both public
Supabase text bindings and caused the Worker to return HTTP 500 until rollback.

The next deployment is blocked until all of the following hold:

1. `keep_vars = true` is committed in `wrangler.toml`, or the reviewed deploy
   command demonstrably includes `--keep-vars`;
2. both public values exist under Worker → Settings → Variables and Secrets;
3. both public values exist under Workers Builds → Build variables;
4. the intended Cloudflare account id is selected explicitly and a read-only
   listing proves that it owns the existing `becommunity-v1` Worker;
5. a zero-traffic preview version passes health, login and the focused smoke
   check before promotion when the deployment path permits version staging.

Never solve this by placing the service-role key in `[vars]`, a build variable,
or a repository file.

### Verifying the binding after a deploy

Do not add an endpoint that reports whether a secret is configured. Sign in as an
internal account and open any `/studio/**` page: every one of them reads through
the privileged client, so a missing secret fails immediately and visibly. A
client-facing page proves nothing — it never touches that path.

---

## 2. Rotating the privileged credential

Rotate **after** the corrected runtime-secret deployment is confirmed working,
never before: the old key is what keeps the site up until the new one is bound.

1. Supabase, Project Settings, API Keys: create a **new secret key**.
2. Set it as the Worker's `SUPABASE_SERVICE_ROLE_KEY` **secret**.
3. Redeploy (or trigger a new deployment) and confirm an internal Studio page
   still loads.
4. Update the maintainer's local shell environment or protected credential file.
5. **Revoke the old secret key** in Supabase.
6. Re-run `npm run test:secrets` against a fresh build.

Rotating the **database password** (Project Settings, Database) does not affect
the application: the app reaches Supabase over the Data API with the keys above
and holds no Postgres connection string. Rotate it independently, and update only
the tooling that uses it directly.

The **publishable/anon key is not a secret** and is not rotated as one. It is
designed to ship to browsers and is meaningless unless RLS is wrong.

Never paste a key into a document, a commit, a log, a chat message or a
screenshot. The gates read keys from the environment and print only class names.

---

## 3. The pagination consistency contract

`src/lib/supabase/paginate.ts` is the only way to read a set that can exceed the
Data API's 1000-row cap.

**What it guarantees**

- **No duplicates.** Every page asks for rows strictly after the previous page's
  last primary key.
- **No skipped pre-existing rows.** A row present for the whole read, and not
  deleted, is returned exactly once.
- **No silent truncation.** Exceeding the caller's declared maximum throws.
- **No unordered read.** Every page is checked for strictly increasing keys, so
  a forgotten `.order()` fails on the first page instead of returning a set with
  holes in it.

**What it does not guarantee, and does not claim**

These are separate HTTP requests and separate transactions. There is **no
snapshot**. A row inserted during the read appears only if its key sorts after
the cursor; a row deleted during the read is absent. Neither can corrupt the rows
that were actually read. Work that needs a true point-in-time view must run
inside one transaction — an RPC — not through this helper.

**Why keyset and not offset.** `.range(1000, 1999)` asks for rows by position in
an order SQL never promised. Two requests may disagree about which rows those
are: one row counted twice, another never read. That is the same silent wrong
denominator the 1000-row cap produced, one layer deeper.

**Paged lists a person reads by page number** (the qualitative review, the import
history, the people list) use offset paging deliberately — a human needs page
numbers — and therefore require a **total** order: a sort column plus the primary
key as tiebreaker. `created_at` alone is not unique.

Gate: `npm run test:data-completeness`.

---

## 4. The ingestion reader: what it supports and what it refuses

`src/lib/ingestion/xlsx-reader.ts` parses SpreadsheetML directly. ExcelJS is not
reachable from production code: under workerd its `xlsx.load` hangs the third
request that calls it.

**Supported structures** — namespace-prefixed elements (the real exporter writes
every element as `x:`), relationship attributes in either order, absolute and
relative worksheet targets, shared strings including values split across several
runs, inline strings, XML entities including numeric ones, blank and omitted
cells (later columns keep their position), the 1900 and 1904 date systems,
built-in and custom date formats, and formula cells through their cached value.

**Deliberately unsupported** — styling, charts, formula evaluation, writing, and
any sheet after the first.

**Ceilings** (`XLSX_LIMITS`) — expanded bytes per part and per workbook, rows,
columns, cells and shared strings. Expanded size is checked against the archive's
own declaration *before* decompression, then against what was actually produced,
so a zip bomb is refused rather than allocated. Every ceiling produces a plain
Spanish sentence.

**No partial writes.** The reader touches no database, and an import commits in a
single transaction after parsing succeeds. A refusal leaves nothing behind. The
one historical failed batch on the real study wrote no respondents, no answers
and no observations.

Gates: `npm run test:xlsx-hardening`, `npm run test:workers-ingestion`.

---

## 5. One category, one name

The same characteristic collected through two questionnaires arrives written two
ways. The real study holds `Legal y Contable` from the members who stayed and
`Legal y contable` from the members who left: one letter of case, and a chapter
whose four legal firms were counted as three and one.

Grouping happens **on the way out of the database**. The stored row always keeps
exactly what was imported, so reconciliation against the source stays exact, and
removing a rule simply makes the next read group differently.

**The fold** — lexical, automatic, no configuration. Values that differ only by
letter case or by surrounding/repeated whitespace are one value. Accents,
punctuation and wording are deliberately **not** folded: merging different words
is never lexical.

**An alias** — editorial, configured per study, stored on
`segment_dimension.config.aliases`. Only a person who has read both instruments
can say that two different wordings are the same closed answer. Written with
`scripts/segment-alias-configure.mjs`, which refuses any wording nobody in the
study actually used.

**Scopes match through the same fold.** A data scope saved as `Legal y Contable`
authorises the rows that arrived as `Legal y contable`. Without that, a client
would be scoped to part of their own segment.

**What is left over is a question, not an answer.** `residualCollisions` reports
values that differ by more than case or spacing so a consultant can decide; it
never merges them.

### Applied to BNI Cuicuilco

| Segment | Values | Resolution |
| --- | --- | --- |
| `giro` | `Legal y Contable` / `Legal y contable` | **Fold.** Case only. Automatic. |
| `giro` | `Capacitación y Coaching` / `Capacitación y coaching` | **Fold.** Case only. Automatic. |
| `roi_membresia` | `No he recuperado nada` / `No recuperé nada` | **Alias.** Configured. |

The two `giro` pairs are file-disjoint: the title-case spelling appears only in
the active-members workbook, the lower-case spelling only in the former-members
workbook. Same category, two data-entry conventions.

The `roi_membresia` pair is also file-disjoint and occupies the same position in
an otherwise identical ordinal scale (`Menos del 50%`, `51% a 100%`, `+100%`),
so the two wordings are the same zero-return band asked twice. Leaving them
apart splits nine people into a five and a four and understates the group. The
canonical label is the wording the plurality used; changing it is one command
and rewrites no data.

A scan of **all 13 segment keys** for case, whitespace, accent and punctuation
collisions found exactly these three pairs and no others.

Gate: `npm run test:segments`.

---

## 6. The membership history

Two different things can be wrong with a retention series, and treating them
alike is how a real membership event gets erased.

**Arithmetic is a defect.** Within a period `ending = starting - lost + new`
must hold, and the stored rate must be the canonical function's result at the
precision the column stores (`numeric(7,2)`).

**A discontinuity is a question.** A period opening with a different roster than
the previous one closed with may be a member approved between the two dates, or a
mistyped count. Only the source can say. It is reported with both numbers and an
explicit instruction not to adjust it — never silently corrected.

Both are **internal**. A client is shown a history the firm has checked, not a
note that two rows disagree.

**Displayed rounding.** The stored rate is the value the source authored, already
rounded once by `numeric(7,2)`. Rendering it and rounding again to the declared
percent precision is a double rounding, and a double rounding is not always the
same number as a single one. The read path therefore derives every published rate
from the exact integer counts with the canonical function — one rounding of an
exact input.

### Applied to BNI Cuicuilco

Six periods. Every row adds up and every stored rate is the canonical one.

One discontinuity: the first period closes with 21 members and the second opens
with 22. **It is not an import error.** The consultant's own reference workbook —
the one marked not to import — carries the same 21 and the same 22, so the
import reproduced its source faithfully. What the +1 *means* is a question for
whoever owns the chapter's roster, and it is the one item on this study still
awaiting a human answer. Do not change the number to make the sequence tidy.

Gate: `npm run test:periods`.

---

## 7. Journey stage identifiers

A stage id is a **stable opaque identifier**. Studio derives it from the label
once, when the stage is created, and never regenerates it: renaming a moment must
not orphan the observations whose `confirmed_stage_key` points at it. An id that
no longer reads like its label is therefore **normal after a rename** and is not,
by itself, a defect.

It is a defect when the ids were never generated by the product. The real
Cuicuilco journey was written by an external script and its identifiers sat one
position out of step with the labels and metrics they belonged to — the stage
labelled "Reuniones uno a uno" carried the id `dar_referencias`, which is the id
the product would have given the *previous* stage. Client-visible labels and
metrics were correct throughout; the internal identifier named the wrong thing.

`scripts/journey-identifier-repair.mjs` realigns them and refuses when anything
points at them: any observation carrying a confirmed stage key, or any
interpretation (draft or published) citing a stage, blocks the repair. The
Cuicuilco study had neither, so the repair was applied and verified.

**Mixed scales are not compared.** NPS and 1–5 CSAT do not share a unit. The
journey's "lowest touchpoint" is chosen within the largest group of stages that
share a unit, and only when that group has at least two members, so an NPS stage
is never ranked against a CSAT stage.

---

## 8. The human qualitative-review boundary

**AI execution is not Be Community editorial confirmation.** A theme is a finding
the firm stands behind and a quote is a participant's words the firm chose to
publish. Neither may be created by inference.

`review_qual_observations` records a confirmation as a human decision: it stamps
`reviewed_by` and `reviewed_at` and makes the observation client-eligible. An
automated run that calls it produces rows nothing can distinguish afterwards —
except their timestamps. **Many confirmations sharing one timestamp to the
microsecond are a single bulk call, not many judgements.**

Migration `0021` adds the only supported way to undo one:
`reset_qual_observation_review` returns named observations to `pending`, clears
the confirmed theme, stage and quote approval, removes the reviewer stamp, and
**writes its own audit record in the same transaction** — so the reset cannot
succeed unrecorded. It preserves `quote`, `theme` and `suggested_theme`: the
participant's words and the generated suggestion stay for the human who will
actually decide. It is idempotent and takes an explicit id list.

Driven by `scripts/qualitative-review-reset.mjs`, which prints the provenance
first, is dry-run by default, and requires a backup directory outside the working
tree.

**Publication is unaffected and deliberately so.** Unconfirmed observations are
simply not read for a client; unapproved quotes are not shown. The product allows
publishing a study with no qualitative content, and absence renders as nothing —
no placeholder, no empty card. Making qualitative review a publication blocker
would be wrong. The existing boundary already refuses an empty study, an archived
client, and any publication that did not pass through the client preview with an
explicit acknowledgement.

---

## 9. Reconciling a real study

`scripts/real-study-verify.mjs` is read-only and must pass before a real study is
published and after anything touches it.

```
npx tsx scripts/real-study-verify.mjs --study <uuid> \
  --workbook <path.xlsx> --workbook <path.xlsx>
```

It compares every metric key by **count and by sum**, every segment value, the
membership history's arithmetic and continuity, the qualitative review state
including provenance, and the journey. The arithmetic is done in the script, not
by the calculation engine: a check that asks the engine whether the engine is
right proves nothing.

It prints no participant value, no quote and nothing from `private_metadata` —
protected fields are counted, never read. Workbook paths are arguments; real
study files live outside this repository and stay there.

---

## 10. Recovery and rollback

**Code.** Every change here is a normal commit on a branch. Revert the commit and
redeploy.

**Migration `0021`.** `supabase/rollbacks/0021_drop_qualitative_review_reset.sql`
drops the function and narrows the audit vocabulary. It deliberately does **not**
restore observations to `confirmed`: pending human review is the state the
migration exists to reach.

**Study configuration.** Both writing tools take a backup before they change
anything — the journey definition, or the review-state columns — into a directory
outside the working tree. Restoring is writing that JSON back to the same row.

**The data itself is never rewritten.** Segment canonicalisation and retention
rounding are read-time derivations. Nothing in this work altered a respondent, an
answer or an observation's text, which is why the reconciliation stayed exact
throughout.

**Never re-import to repair.** The study's 60 respondents are reconciled; a
re-import risks duplicating them. Repair configuration, or restore from a backup.

---

## 11. Running the live suites: one build, one server, one order

The live suites drive a real browser against a real server. Two environment
faults have masqueraded as product failures, and both are now refused by a
preflight before any fixture object is created.

### The order, and why each step is where it is

```
rm -rf .next          # nothing from an earlier build survives
npm run build         # the ONE build the browser and the server will share
npm run start         # serve exactly that build
npm run gates:live    # qualitative-live, private-metadata-live, Suite A, B, C
npm run cf:build      # LAST — it rewrites .next for the Worker
```

`next build` and the OpenNext build write into the **same** `.next` directory.
Running `cf:build` and then `next start` serves client assets from one build
while the server resolves Server Actions from another, and every action fails
with `Failed to find Server Action` — which reads exactly like a broken
workflow. `assertServedBuildIsCoherent` compares the served pages against
`.next/BUILD_ID` and refuses to run when they disagree, naming this order.

### Stale synthetic accounts

`assertFixtureCredentials` signs in as each configured actor against Supabase
Auth **before** the harness creates anything. A removed or renamed synthetic
account now fails with the environment variable to repair
(`TEST_INTERNAL_EMAIL` / `TEST_INTERNAL_PASSWORD`, …) and the command that
recreates it, instead of aborting the run and leaving a report that says the
suite was red. It never prints a credential. These are throwaway accounts in the
synthetic project; no client, respondent or real user is involved.

### The upload page has two forms

`/admin/upload` renders the membership-series uploader **above** the main import
form, and both label a client select `Cliente` and a file input
`Archivo CSV o Excel`. A locator that takes the first match therefore fills one
form and clicks the other form's still-disabled button: the Server Action never
runs, nothing changes in the DOM, and the probe reports `unclassified`.

That is what made eight Suite C checks fail — on the audited baseline as well as
on this branch. It was never a product defect: the upload boundary accepts,
refuses and rolls back exactly as designed. The driver now anchors on the button
it is going to click and walks up to the nearest container holding both a select
and a file input, which is one form — what an operator sees and uses. It then
waits for the product to enable that control instead of racing React's state
update, and if the control never enables it says which half of the form is
missing rather than reporting an unexplained refusal.

`npm run test:suite-bc-selftest` pins all of it offline.

---

## 12. What was applied to the provisional project, and how

### Migration `0021`

Applied through the project's own tracked workflow, not by pasting SQL:

```
npx supabase db push --dry-run --linked   # names exactly 0021 and nothing else
npx supabase db push --linked
```

Verified afterwards against the live database:

- `supabase_migrations.schema_migrations` ends `… 0019, 0020, 0021`.
- `public.reset_qual_observation_review(p_ids uuid[], p_study_id uuid, p_actor uuid, p_reason text)`
  returns `integer`, is `SECURITY DEFINER`, carries `search_path=""`, and is owned
  by `postgres`.
- Execute privilege: `service_role` **true**; `anon`, `authenticated` and
  `public` **false**.
- Every check constraint on `admin_lifecycle_event` is still `validated`. The
  action list keeps all seven original values and adds
  `qualitative_review_reset`; `subject_kind` adds `study`.

The guards were exercised against the live function before it was used in
anger. A non-internal actor, an observation outside the study, an empty reason,
an empty id list and an unknown study were each refused with their intended
SQLSTATE, and the study still held its 31 confirmations afterwards — the
function changes nothing on the path to a refusal.

### The qualitative reset

One call, 31 observations, one audit record, written in the same transaction.

| | before | after |
| --- | --- | --- |
| `confirmed` | 31 | **0** |
| `pending` | 0 | **31** |
| `rejected` | 0 | 0 |
| approved quotes | 0 | 0 |
| `reviewed_by` stamps | 31 | **0** |
| `reviewed_at` stamps | 31 | **0** |
| `confirmed_theme` | 31 | **0** |
| `confirmed_stage_key` | 0 | 0 |
| `suggested_theme` | 31 | **31** |
| non-empty `quote` | 31 | **31** |
| source `theme` | 11 + 20 | **11 + 20** |

The evidence is preserved and the decision is not: participants' words and the
generated suggestions are exactly as imported, and nothing is client-visible.
The study stayed `draft` throughout.

Idempotent, proved twice: the tool reports "Nothing is confirmed. Nothing to
do.", and the function called again with the same 31 ids returns `0` and writes
**no** second audit event — a run that moves nothing is not an administrative
action.

The backup of the previous review state (review-state columns only — no quote,
no respondent id, no private metadata) is written outside the working tree by
the tool itself, and its path is deliberately not recorded here.
