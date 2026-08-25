# P8.2 completion — implementation review

> Record of the **running Be Community application**, not a prototype.
> Branch `claude/p8c-studio-workflows-completion-9bab28`, built from
> `ff87b8423a1da05ce5a1c24c7d392e7e888c6d06` (`origin/main`, the squash merge
> of PR #40 after the accepted first P8.2 slice at PR #39).
>
> No prototype directory was created. No remote database, external system or
> deployment was touched. No pull request was opened and nothing was merged.

---

## How to look at it yourself

Run it the way the repository requires — in WSL or Linux, never from Windows:

```bash
npm run build && npm start
```

Sign in with the internal test account and open these routes. Every
`/admin/*` address below still answers exactly as it did; the `/studio/*`
addresses are additions.

| What | Route | Replaces / joins |
|---|---|---|
| Studio home — *¿Qué necesita mi atención?* | `/studio` | `/dashboard` (which still answers and renders the same view) |
| Every study, filtered and paged | `/studio/estudios` | joins `/admin/studies` |
| Every client, filtered and paged | `/studio/clientes` | joins `/admin/clients` |
| One client: identity, people, studies, lifecycle | `/studio/clientes/[tenantId]` | new |
| The template library | `/studio/plantillas` | split out of `/admin/studies` |
| One study — the work surface | `/studio/e/[studyId]` | new |
| Its data and load history | `/studio/e/[studyId]/datos` | joins `/admin/upload` |
| Its results and recorrido | `/studio/e/[studyId]/indicadores` | joins the `/admin/studies` configurator |
| Its qualitative review | `/studio/e/[studyId]/cualitativo` | joins `/admin/qualitative` |
| The client's real screen | `/studio/e/[studyId]/vista-cliente` | joins `/admin/preview/[studyId]` |
| The publication decision | `/studio/e/[studyId]/publicar` | **new — the only surface that moves a study's state** |

---

## What changed, and why it mattered

**The consultant now knows what needs her.** `/studio` opens on the pending
work the product can actually prove: an import left staged or failed, a study
with no answers, comments nobody has reviewed, a moment of the recorrido
pointing at a result the study does not produce, and a draft carrying data that
has never been published. Each item names the client, the study, what is wrong
and where to fix it. The list is bounded and says how many it left out. It
claims no deadline, no assignee and no approval, because the schema holds none
of those.

**The study is the object of work.** It has an address, a header naming its
client, a state chip, a row of process steps that double as the progress
indicator, and a readiness panel that separates *impide seguir* from *se puede
mejorar*. "No publicable: sin datos" is a rule the server already enforced and
never explained; it is now said up front.

**The picker contract is finished.** P8.2's first slice retired the `data_scope`
textarea and the transcribed mapping targets. This one retires the last two:

- the recorrido's canonical metric key became a choice over the results the
  study genuinely produced, each shown with what it says today and what it rests
  on. A stage identifier is generated once from the first name and then frozen,
  because `qual_observation.confirmed_stage_key` points at it and regenerating
  it on a rename would detach every comment filed against that moment. A stored
  metric the data no longer produces is kept, marked *ya no aparece en los datos*
  and listed on the page — never dropped, never silently repointed;
- the qualitative theme box became a selection over the themes the study already
  carries, with their confirmed counts, plus a deliberate *tema nuevo* path that
  **refuses** a name colliding with an existing theme and says which one it
  matches. Typing "Comunicación" one week and "comunicacion interna" the next can
  no longer produce a third theme nobody notices.

**Growing lists stopped lying.** The qualitative review's `.limit(100)` and the
import history's global `.limit(30)` are gone. Both are counted, filtered and
paged, and every list states how many rows exist — so "these are all of them"
and "there are more" can never look the same. Bulk qualitative actions are
page-scoped and say so, because confirming a row the reviewer never read is the
one accident a human-in-the-loop workflow cannot afford.

**Publication left the configuration form.** It used to be a `<select>` between
the study name and the section checkboxes, so *publicado · visible al cliente*
could be chosen and saved without anyone looking at what the client would get.
It is now one surface, reached from the client preview, and the server refuses
independently: no acknowledgement, no publication; empty study, no publication;
archived client, no publication. `updateStudyConfiguration` may only ever
re-save the state that already holds.

**`window.confirm()` is gone from the product.** One accessible dialog replaces
it: labelled, described, escapable, focus-trapped, returning focus to its
trigger, disabling its confirm control while the action is in flight. Every use
names the object, the consequence, the reversibility and the recovery path, and
severity is honest — reverting an import is an ordinary control, and only a
permanent action reads as danger or can require typing.

**Suspending a person is no longer the same act as destroying their account.**
Suspension is enforced where authentication happens, so the product can never
show *con acceso* for an identity the Auth server is already refusing.
*Invitación pendiente* is a third, real state: an invited person who never
completed the invitation cannot open the portal, and saying they can would be a
lie a consultant would act on.

**Archiving a client is the ordinary reversible action.** It stops new studies,
new invitations and new publications — enforced on the server at the moment of
the write, not by hiding a control on a page that may have been rendered before
a colleague archived the client. It revokes nobody's existing access, and the
interface says so rather than letting an operator assume otherwise. Permanent
client deletion shows a counted impact summary, requires the client's own name
typed exactly, recomputes the impact at execution time and stops if a single
number moved, and handles every dependent object deliberately: identities and
Storage files are collected before the cascade, removed explicitly after it, and
anything that could not be removed is reported rather than swallowed.

---

## The migration, and the one thing it is not

`supabase/migrations/0015_client_lifecycle_and_audit.sql` is **additive only**:
two nullable columns on `tenant` with a partial index, and one new internal
table `admin_lifecycle_event` with RLS, FORCE RLS, a deny-browser-roles policy
and service-role-only grants — the pattern 0003 and 0006 established. It
creates no function, no security-definer helper, and alters no existing policy
or grant. `supabase/rollbacks/0015_*.sql` drops exactly what it created and
states out loud that doing so destroys the administrative evidence.

The audit table deliberately carries **no foreign key** to `tenant`, `profiles`
or `auth.users`. A cascade from the very object being deleted would erase the
record of the deletion.

**Suspension is deliberately not in this schema.** It lives at the
authentication boundary and is read back from the account itself, so there is
exactly one source of truth and the product cannot drift from what Auth does.

**The migration is NOT applied anywhere.** This branch mutates no remote
database, so the synthetic environment still lacks it. The application detects
that and degrades honestly rather than failing: `src/lib/studio/lifecycle.ts`
distinguishes "this column is not there" (Postgres `42703` and friends) from "a
query failed", the client page renders the archive and delete controls as
unavailable **with the reason stated**, and any administrative action that
succeeds without being recorded says so in its own success message. A real
query failure still throws.

---

## Measured in the running application

One bounded review, with a throwaway script that reused the repository's own
proxy mechanism: the fixture credentials were handed to Supabase by the process
and the browser only ever received the resulting session cookie, so no password
reached a form. It measures; it produces no screenshots.

| Check | Result |
|---|---|
| Horizontal overflow, 12 routes × {1280 px, 360 px} | none, after the correction below |
| `lang="es"`, `#contenido` landmark, skip link | present on every Studio route |
| Process steps on the six study surfaces | 6 steps rendered on each |
| Explicit parent (`Volver a …`) on every non-home route | present; no `history.back()` anywhere |
| Serialized objects visible on screen | none on any Studio route |
| Dialog `role="dialog"` + `aria-modal` + labelled + described | true at both widths |
| Focus enters the dialog | true at both widths |
| Escape closes it, focus returns to the trigger | true at both widths |
| Permanent dialog blocks confirm until the exact name matches | true, and still blocked on a wrong name |
| Severity wording | *nada se destruye* for archive/suspend; *No se puede deshacer.* for permanent |
| Logged-out `/studio`, `/studio/estudios`, `/studio/clientes`, `/studio/plantillas` | HTTP 307 → `/login` |

**Two defects it found, both corrected and re-measured:**

1. **Focus never entered the destructive dialog.** Every dialog carries its
   Server Action's fields as hidden inputs, and `input:not([disabled])` matches
   those — so the "first focusable" was a hidden input, `focus()` on it did
   nothing, and a keyboard user was left outside the dialog they had just
   opened. Excluding `[type="hidden"]` fixes it, and the completion gate now
   pins the exclusion.
2. **The client preview scrolled sideways at 360 px.** Its return control
   carries the study's own name, the acceptance fixture is called *ACEPTACIÓN
   P6E — DATOS SINTÉTICOS (TEST)*, and the notice's right-hand cluster was
   `shrink-0`, so the document measured 446 px inside a 360 px viewport. The
   cluster now shrinks, the label truncates, and the parent label is bounded at
   the source.

---

## Gates

Run in WSL 2 Ubuntu (Node 24.11.1, npm 10.9.2) on the exact final commit.

| Gate | Exit |
|---|---|
| `git diff --check` | 0 |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 (0 errors; 53 pre-existing warnings in `scripts/`) |
| `npm test` — 28 gates | 0 |
| `npm run test:studio-completion` | 0 — **44 checks** |
| `npm run test:studio-workflows` | 0 — 22 checks (slice one, unchanged) |
| `npm run build` | 0 |
| `npm run cf:build` | 0 |
| `npm run suite:d` | see the delivery report |

### What was NOT run, and why

- **`npm run gates:live` (`test:qualitative-live`, `suite:a`, `suite:b`,
  `suite:c`).** They drive the deployed synthetic environment, which does not
  have migration 0015. Suite B's catalogue now names the Studio addresses and
  the six lifecycle mutations, and those depend on that schema, so a run today
  would measure an environment the code was not written for and would prove
  nothing about the new paths. Applying the migration remotely is explicitly out
  of scope for this branch. **The live chain is deferred to the reviewed
  deployment step, and is not claimed green here.**
- **`npm run test:responsive-live` fails**, at 258 px, on the **client**
  dashboard: `tenant A @ 258px: text overflows its own box`. It was reproduced
  **identically at the baseline `ff87b84`** — same role, same width, same
  assertion — so it is inherited, not introduced. 258 px is below the 320 px
  floor the design brief states, and the offenders are client-surface captions
  (`ScaleMark`, the method disclosure, the sample-context line). It belongs to
  the P8.3/P8.5 client work.

---

## The frozen catalogue grew rather than bending

A Server Action is dispatched by POSTing to the page that renders it, so a
Studio address hosting one is a new protected POST path class. Six such classes
and five internal-only Studio page classes joined the catalogue, along with six
new mutations — suspend, restore, archive, restore, delete a client, and set
publication — as **denial-paths-only**, because their success would ban an Auth
identity, destroy a client organisation with everything under it, or change what
a real client account can see.

`operationsOnRoute` became one-to-**many**: a mutation reachable at both its
legacy and its Studio address genuinely travels on two protected paths, and
recording only the first would leave the second unproven. The self-test's
"exactly one route" assertion was replaced by completeness in **both**
directions — every mutation covered, every route class named by a mutation —
which is strictly more than the old statement. B9/B10/B11 now carry **10** path
classes instead of 4, and B3.6 additionally probes four Studio pages and the
study work surface. `suite-bc-selftest` reports 68 checks, green.

The harness's own upload-rollback driver was updated to open the product's
dialog and confirm inside it — two deliberate clicks, exactly as an operator
does — and its native-dialog handler no longer claims the product raises one.

---

## What is intentionally incomplete

1. **Migration 0015 is not applied to any environment.** Until it is, archiving
   and permanently deleting a client render as unavailable with the reason
   stated, and administrative events are not recorded. Suspension is unaffected.
2. **The live adversarial chain has not run against this branch.** See above.
3. **Template ownership is unchanged.** Decision D5 approved sharing templates
   across the internal team with the author shown; `study_template` is still
   filtered `.eq("created_by", user.id)` and the mutations are still scoped the
   same way. Making them visible without making them editable would create a
   state the interface cannot explain, so it is left whole for its own unit.
4. **`/admin/qualitative` still opens on a study `<select>`.** It is the legacy
   address and keeps its `?study=` contract; the study-scoped experience is at
   `/studio/e/[studyId]/cualitativo`.
5. **The interpretation surface (D2) and per-client thresholds (D4)** remain
   P8.4, exactly as the plan puts them.
6. **The comparison explorer's vocabulary is still untouched**, for the reason
   P8-A recorded: the adversarial suites drive those exact control names.

---

## Six questions for you

1. **Is "¿Qué necesita mi atención?" the right first screen?** It currently
   lists five kinds of pending work. Is that the list you would want at 9 a.m.,
   or is one of them noise?
2. **Archiving a client stops new work and revokes nobody's access.** Is that
   what you mean by archiving a client — or should archiving also close the
   door on the people who already have it?
3. **Suspension is enforced at sign-in, so a suspended person is refused the
   next time they try.** Should an already-open session be cut immediately as
   well, or is "cannot get back in" the right strength?
4. **Permanent client deletion keeps the team's templates** (they stop pointing
   at that client's study) **and the administrative record of the deletion.**
   Everything else goes. Is anything else worth keeping?
5. **Selection in the qualitative review is per page**, deliberately, so nothing
   you have not read can be confirmed. Does that match how you review, or do you
   want to carry a selection across pages?
6. **Publication is now only reachable through the client preview.** Is that a
   welcome discipline, or will there be a day you want to publish a correction
   without looking again?
