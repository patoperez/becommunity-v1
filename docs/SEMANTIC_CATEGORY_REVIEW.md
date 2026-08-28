# Semantic category review

Standing reference for "Revisar categorías" — the step between importing a
study and publishing it, where a person decides whether the same answer arrived
written two ways.

No credential, no participant value and no workbook content appears in this
file, and none may be added to it.

---

## 1. The problem, and the problem the solution could cause

A first import can deliver one answer in two spellings, because two
questionnaires worded it differently. The reference study holds
`No he recuperado nada` from the members who stayed and `No recuperé nada` from
the members who left: one zero-return band, asked twice. Counted apart, nine
people become a five and a four in every count, percentage, filter, chart,
comparison, narrative and PDF the client receives.

**The cure is more dangerous than the disease.** A missed alias is a question a
consultant never got asked, and the next import asks it again. A false merge
silently moves people between categories in a report a school acts on, and
nothing on screen says so. The two failures are not comparable, and every
decision in this design resolves in favour of the second:

- nothing merges without a person, at any confidence, from any source;
- a machine-measured resemblance can never block a publication;
- a pair whose digits differ is never proposed on textual similarity;
- a pair where one side is negated and the other is not is never proposed;
- when in doubt, the product asks rather than acts, and abstains rather than asks.

## 2. Three layers, and the line between them

| Layer | Decided by | Applied | Reversible |
| --- | --- | --- | --- |
| **The fold** — case and surrounding/repeated whitespace | Code | Always, automatically | n/a |
| **A candidate** — accents, punctuation, invisible characters, wording resemblance | Code | Never. It is a question | n/a |
| **A decision** — grouped / separate / postponed | A person | Through the alias projection | Yes, as a new version |

The fold is defined once, in `src/lib/calc/segments.ts`, and this feature does
not widen it. Everything else is a question until somebody answers it.

## 3. Raw data is never rewritten

Nothing in this feature writes to `respondent`, `quant_response` or
`qual_observation`. Grouping happens on the way **out** of the database, through
`segment_dimension.config.aliases` — the same mechanism the calculation layer
has always read. Reconciliation against the source workbooks stays exact, and
removing a decision simply makes the next read group differently.

The total number of respondents and answers can therefore never change because
of a merge. `totalsUnchanged` states that in executable form and the gate
asserts it on every fixture.

## 4. The ledger

`public.category_decision` (migration `0022`) is append-only **at the privilege
level**: `service_role` holds `SELECT` and `INSERT` and nothing else. There is
no `UPDATE` and no `DELETE` path from the application, which is the only version
of "append-only" an auditor can verify.

Each row is a version carrying the actor, the time, the study, the
characteristic, the exact categories, the option set the question had at the
time, the decision, its reason, where the proposal came from, and — when a model
was consulted — the provider, model, prompt version and schema version.

- **Undo writes an inverse row** (`revoked`) pointing at what it reverses.
  Nothing is deleted, because the question a year from now is not "is this
  grouped" but "why did this number change between two reports".
- **Identity is `member_folds`** — the sorted, de-duplicated folded values. The
  same question re-detected in a different order, under a different rule, or
  after one spelling gained a respondent, is recognised as the same question.
- **`canonical_key` is assigned once** and carried forward across renames. A
  visible label may be rewritten freely. This is the journey editor's lesson:
  an identifier regenerated from a name is not an identifier.

### Rules enforced in SQL, not only in the interface

1. A value belongs to at most one category.
2. Two categories in one characteristic may not share a visible name.
3. A category's name may never be a member of another group — the only shape in
   which this flat mapping could form a chain, so refusing it makes cycles
   structurally impossible.
4. Only an `internal` account may record a decision.
5. The study must belong to the tenant the decision names, proved by a composite
   foreign key rather than by application code.

## 5. Publication

- Importing is never blocked. Saving is never blocked. Working is never blocked.
- A publication is blocked **only** by a deterministic, high-confidence,
  materially significant difference that nobody has decided:
  - two values that render identically (invisible characters, exotic spaces)
    always block;
  - an accent or punctuation difference blocks only when at least
    `MIN_BLOCKING_MOVED` people would change category **and** it reaches
    `MIN_BLOCKING_SHARE` of the characteristic or appears in the published
    reading.
- A wording resemblance **never** blocks. Neither does anything a model said:
  `src/lib/categories/gate.ts` imports nothing from the advisor and reads no
  confidence value, and the gate test asserts that against the module's code.
- Three honest ways past a block: group them, record that they stay separate, or
  postpone with a written reason of at least 10 characters. All three are
  decisions in the ledger with an author. There is no override flag.
- `setStudyPublication` re-derives the gate from the database, so a caller that
  never opened the review screen is refused on the same grounds.

## 6. A published report stays reproducible

Publishing pins the grouping into `public.study_category_snapshot`. From then on
the client reads that exact set of decisions; a decision recorded afterwards
changes Studio immediately and changes what the client sees only when somebody
publishes again. Studio says so explicitly ("el cliente todavía ve las
categorías anteriores") rather than leaving a consultant to guess.

The pin is applied through the same parser as the live configuration, so there
is one grouping code path whatever the source. A study with no pin — a draft, or
one published before `0022` — reads its live configuration exactly as before.

The internal client preview shows the **pinned** version, because a preview that
shows something the client is not seeing is not a preview.

## 7. Memory

A previous decision is evidence about a previous question, offered as a
suggestion and never applied.

- Bounded by tenant, on the query (`.eq("tenant_id", …)`), in the recall
  function, and by RLS. Three independent layers.
- Matched on the exact same set of categories in the same characteristic —
  never on an overlap, because a decision about three values says nothing
  reliable about two of them.
- The context signature carries the characteristic, the language **and the whole
  option set**, so a decision taken over a different scale is marked
  `context_changed` and carries an explicit instruction to check it again.
- Disagreement between two studies of one client is surfaced, never resolved.
- Nothing is retroactive. A study already reviewed is never revisited because a
  later study decided something.

## 8. Stale review

A later import can add an option, remove one, or reword one. The decision is not
wrong because of that, but it was made about a different option set:

- `context_changed` — the question moved. Re-confirm before publishing.
- `member_absent` — a value is gone. Reported, and deliberately **not**
  auto-revoked: the decision was correct when it was made, and destroying the
  record of a correct judgement is worse than carrying an inert one.

## 9. The advisor

Optional, replaceable, and off.

- A typed server-side HTTP adapter over the Responses API — no SDK, because
  `nodejs_compat` is not a guarantee that a Node library runs under workerd, and
  this repository already carries one production incident from assuming
  otherwise.
- `store: false`, Structured Outputs with a strict closed schema, a configurable
  reasoning effort, a strict timeout, one controlled retry for transient classes
  only, a per-tenant budget, and a bounded tenant-keyed cache.
- **No fallback to another model.** If the configured model is unavailable the
  answer is "unavailable", because a substituted model's answers would no longer
  be comparable to the evaluation that approved it.
- Every failure — disabled, redacted, timeout, rate limit, refusal, malformed,
  unknown model, network, bad credential — is a value with a Spanish sentence
  that ends by saying the manual review still works.
- The key is read in exactly one module (`advisor/service.ts`, which carries the
  `server-only` guard), travels in one header, and never reaches a log, an error
  message, an outcome, a database row or the ledger.
- What is sent: the characteristic key, its question wording if the study has
  one, the option set with **aggregate counts**, the candidate labels, and a
  constant sector description. What is never sent: a respondent, a quote, a row,
  an identifier, an email, a private column, another client's anything.
  `redactionRefusal` **refuses** rather than sanitising, because a category
  column containing an email address is a mapping mistake somebody should fix.
- Every imported label is untrusted data: delivered inside a fenced JSON
  document the system prompt names as data, to a model with no tools, no
  network and no database, and the response is re-validated on return whatever
  Structured Outputs promised. `requiresHumanReview` is forced to `true` rather
  than trusted.

### Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `CATEGORY_AI_ENABLED` | unset (off) | must be exactly `true` |
| `OPENAI_API_KEY` | unset | Cloudflare **secret**, never a build variable |
| `OPENAI_ALIAS_MODEL` | `gpt-5.6-terra` | no fallback to any other model |
| `OPENAI_ALIAS_REASONING_EFFORT` | `low` | |
| `OPENAI_ALIAS_TIMEOUT_MS` | `12000` | clamped to 60 s |

### The acceptance criteria this feature ships blocked on

`EVALUATION_APPROVED` in `src/lib/categories/advisor/flags.ts` is `false`. All
three of the following must hold before a human may flip it in a reviewed
commit:

1. `npm run test:category-evaluation-live` reports a measured **false-merge rate
   of 0.000** over the committed fixture — counting both `different` pairs and
   `context` pairs the model proposed merging.
2. It reports **recall ≥ 0.60** on true aliases.
3. A named person records both numbers, the model id and the date in section 11
   below, and states that they read the individual failures.

An environment variable cannot satisfy this. That is the point: a key is present
whenever somebody pastes one, and neither a key nor a flag is evidence that the
thing is good enough to put in front of a consultant making a decision a client
will act on.

## 10. Measured results — deterministic path

`npm run test:category-evaluation`, 33 labelled pairs, 2026-08-28:

| Metric | Result |
| --- | --- |
| **False merge (automatic)** | **0 / 12 — 0.0%** |
| False merge (blind acceptance of every proposal) | 0 / 12 — 0.0% |
| Missed alias | 1 / 11 — 9.1% |
| Recall on aliases needing a decision | 10 / 11 — 90.9% |
| Abstention | 17 / 33 — 51.5% |
| Context-dependent pairs presented as certain | 0 / 6 |

The one miss is `"No aplica"` vs `"No aplica en mi caso"`. It is missed
deliberately: catching it needs a subset rule, and a subset rule would also
propose `"Primaria"` vs `"Primaria alta"`, which are different answers. Given
the asymmetry in §1 the miss is the correct trade, and the pair remains
groupable through the manual control on the review screen.

Two guards were added *because* the fixture measured them, and both took the
blind-acceptance rate from 16.7% to 0%:

- **digits**: two phrases that disagree about a number are never proposed on
  textual similarity (`1 a 5 empleados` vs `6 a 50 empleados`);
- **negation**: a pair where one side is negated and the other is not is never
  proposed (`Lo recomendaría` vs `No lo recomendaría`). Symmetric negations are
  unaffected, which is why the real `No he recuperado nada` / `No recuperé nada`
  pair is still raised.

## 11. Measured results — AI-assisted path

**NOT RUN. No `OPENAI_API_KEY` is configured in any environment this branch was
verified against, so the advisor has no measured result.** This is recorded as
an absence, not as a pass.

| Date | Model | False merge | Recall | Approved by |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

## 12. Gates

```
npm run test:categories             # 324 deterministic checks
npm run test:category-evaluation    # the labelled fixture, deterministic path
npm run test:category-evaluation-live   # adds the model; needs a key
npm run test:categories-live        # end-to-end against a running app
```

`npm run suite:d` covers the deployment configuration (`D-g`).

## 13. Verified live

Against the provisional project `ontvqazsqiwisdddblif` (`be-community-dev`) and
the synthetic beta Worker `becommunity-v1`, 2026-08-28:

- migration `0022` applied and recorded; both tables RLS-enabled **and** forced,
  browser roles denied, `service_role` holding `SELECT, INSERT` on the ledger and
  nothing else, and zero public tables missing RLS anywhere in the schema;
- `test:categories-live` — 54 checks: the SQL refusals, the append-only
  privileges, the projection, the publication pin, undo as an inverse version,
  and tenant isolation;
- `test:categories-e2e` — 13 checks through a real browser against the deployed
  Worker: the screen renders, pressing *Agrupar* records an attributed decision
  and updates the projection, the raw spellings stay on the respondents, and
  undo appends a reversal;
- `test:p8-acceptance-live` — 108 views across 18 routes and 6 widths, including
  `/studio/e/[studyId]/categorias` at 320 px;
- `test:journey-editor-live` — 13 checks: the journey focus fix is intact on
  this build.

Every run used a disposable study and deleted it. The real study was
fingerprinted before and after and is unchanged: 60 respondents, 3 282
quantitative answers, 31 qualitative answers, 123 metric keys, `draft`, and zero
category decisions.
