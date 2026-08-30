# Calculation Policy — precision, rounding, and contracts

> **Scope:** the *generic*, V1-validated metric layer (`src/lib/calc/metrics.ts`,
> `engine.ts`). Every statement here was **verified empirically** against the code
> (P1, 2026-08-09), not assumed.
>
> This document does **not** define business-specific formulas. Confirmed named
> indicators, recoding tables and documented crosses live in
> `docs/CALCULATION_CATALOG.md`. A formula absent from that catalog must not be
> invented (CLAUDE.md standing rule).
>
> Calculation code is a **human-review zone**. A wrong number does not throw — it
> misleads a client.

---

## 1. Single rounding helper

All canonical metrics — and the engine, pivot and display layers — round through
**one** exported helper in `metrics.ts`:

```ts
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * f)) / f;
}
```

No metric may round ad-hoc. If the policy changes, it changes here, once.

## 2. Rounding mode — half away from zero (Excel `ROUND()` parity)

Halves round **away from zero**, symmetrically, matching Excel's `ROUND()`:

| Input | Result | Mirror |
|---|---|---|
| `0.125` → 2 dp | `0.13` | `-0.125` → **`-0.13`** |
| `6.25` → 1 dp | `6.3` | `-6.25` → **`-6.3`** |
| `33.35` → 1 dp | `33.4` | `-33.35` → **`-33.4`** |

`round(-x) === -round(x)` at every tie.

> **History.** V1 used JavaScript's bare `Math.round`, which rounds halves toward
> **+∞** — asymmetric for negatives (`-0.125` → `-0.12`). Since NPS spans
> −100..100 that was client-facing and diverged from the Excel workbooks this
> platform must reproduce. Switched in P1. Measured impact: **CSAT/percentage
> unaffected** (0 divergences across 3,128,750 count/total pairs — the range is
> non-negative); **NPS differs in 0.058%** of (n, diff) combinations, all
> negative, only when n is a multiple of 16. Every changed case is enumerated in
> `scripts/calculation-test.mjs` §[8].

## 3. The `Number.EPSILON` nudge is load-bearing

`Math.abs(value) + Number.EPSILON` is applied **before** scaling. It compensates
for binary values falling just short of a decimal half:

| Case | Without nudge | With nudge (current) |
|---|---|---|
| `roundTo(1.005, 2)` | `1` ❌ | **`1.01`** ✅ |

(`1.005 * 100 === 100.49999999999999` in IEEE-754.) Applying it to the absolute
value is what preserves this correction under half-away-from-zero. The nudge is
absolute (`2.22e-16`), so it is effective near unity and swamped at large
magnitudes — a targeted correction, not a general fix.

## 4. Declared precision — and the round-exactly-once rule

Precision is declared once, in `DECIMALS` (`src/lib/calc/metrics.ts`):

| Unit | Decimals | Applies to |
|---|---|---|
| `nps` | **1** | NPS (−100..100) |
| `percent` | **1** | CSAT, any percentage (0..100) |
| `score` | **2** | `mean`, engine averages, cross averages, pivot cells |
| `journeyHeadline` | **1** | journey-map headline score |

**Every value is rounded EXACTLY ONCE.** *Where* that happens depends on whether
anything downstream consumes the value:

| Output | Rounded where | Why |
|---|---|---|
| `mean`, `percentage`, `npsFromScores`, `csatTopBox` | canonical function | they *are* the reported metric definitions |
| `metricAverages`, `crossAverage` | calc layer (`DECIMALS.score`) | **display-terminal** — traced: consumed only by `StudyCard` rendering |
| `computeStageMetric().value` | calc layer (`DECIMALS.journeyHeadline`) | display-terminal — consumed only by the `JourneyMap` headline |
| **`computePivot` cells** | **NOT rounded — kept RAW** | **non-terminal**: `PivotExplorer` derives `maxBar` and the bar-width ratio `(value / maxBar) * 100` from them. Rounding internally would feed rounding error into a later calculation. |

Anything kept raw is rounded once at the **presentation boundary**,
`formatNumber` (`src/lib/calc/format.ts`), which applies the canonical `roundTo`.

> ⚠️ **`toFixed` is not the policy and must never be used to round.** It does not
> implement half-away-from-zero reliably and is subject to binary representation:
> `(1.005).toFixed(2) === "1.00"` and `(2.675).toFixed(2) === "2.67"`, where the
> canonical helper gives `1.01` and `2.68`. `formatNumber` rounds with `roundTo`
> first and uses `toFixed` only to pad, which cannot alter an already-rounded
> value. Enforced by `scripts/calculation-test.mjs` §[9].
>
> **Rule for new code:** before rounding an aggregate inside the calc layer,
> check whether anything derives from it. If yes, keep it raw and round at the
> boundary.

> **History.** V1 had two competing paths: the canonical helper (NPS/CSAT/mean)
> *and* ad-hoc `toFixed()` in three components. Engine averages, cross averages
> and pivot cells were returned **raw** and rounded only at display; the journey
> map rounded a 2 dp value again with `toFixed(1)` — **double rounding**, which
> shifts numbers (raw `3.445` → `3.45` → `"3.5"`, where rounding once gives
> `"3.4"`). Unified in P1: the calc layer rounds, `formatNumber` formats.

## 5. Validity filters — deliberately different per metric

- **`npsFromScores`** ignores non-finite values **and** anything outside `0..10`.
  The 0–10 scale is intrinsic to the NPS definition, so an out-of-scale value is
  bad data and must not skew the score.
- **`csatTopBox`** and **`mean`** ignore **non-finite only** — no range check.
  This is intentional: `satisfiedMin` is an **explicit input**, so the same
  function serves a 1–5 scale (Top-2-Box = `min 4`) and a 0–10 scale
  (`min 9`). The scale is never guessed — configuration over code.

### 5.1 Where the explicit input comes from

`satisfiedMin` being an explicit input only helps if somebody supplies it.
`DEFAULT_CSAT_MIN` is 9, and three client-facing paths — the dashboard view, the
server PDF and the longitudinal series — called `computeStudyMetrics` with no
`csatMin` at all, so a study answered 1–5 reported a confident, wrong **0 %** on
every satisfaction result. The composer had already been corrected by deriving
the scale itself, which is the defect exactly: **one fact, derived twice, and
only one of the two right.**

`src/lib/calc/scale.ts` is now the single derivation, and all four read it.

| | |
| --- | --- |
| `observedScales(rows)` | the span of each result's own answers |
| `documentedTopBoxMinimum(scale)` | `4` for 1–5, `9` for 0–10, **`null`** for anything else |
| `topBoxMinimums(rows)` | the map, per metric key |
| `resolveTopBoxMinimum(key, { explicit, declared })` | an explicit caller wins; otherwise the documented one |

Three rules follow from it, and each is asserted by
`scripts/calculation-parity-test.mjs` (`npm run test:calc-parity`, inside
`npm test`):

1. **`null` means do not compute it.** A result on a scale the catalogue does
   not document has no honest Top-2-Box, so every surface OMITS it and keeps
   the result's average. A missing Top-2-Box and a `0 %` are different
   statements and only one of them is true.
2. **The threshold comes from the whole study; the numbers come from the
   selection.** A filter leaving only middling answers of a 0–10 result would
   otherwise make it read as a 1–5 one and move its threshold from 9 to 4 — a
   wrong number produced by the act of filtering. Callers derive the map once
   from the unfiltered rows and pass it down; `/api/studies/[id]/report` passes
   `allRows` beside the narrowed `rows` for exactly this reason.
3. **An explicit `csatMin` still wins**, so every caller that stated one keeps
   the result it always had.

## 6. NPS band definition (canonical, V1-validated)

```
promoters  = score >= 9
passives   = score 7..8
detractors = score <= 6
NPS = (%promoters − %detractors)        -- expressed on a −100..100 scale
```

## 7. Empty-set contract (note the inconsistency)

| Function | Empty input | Meaning |
|---|---|---|
| `mean([])` | **`null`** | explicit "no data" — no silent 0 |
| `npsFromScores([])` | `{ nps: 0, total: 0 }` | numeric **0**, not null |
| `csatTopBox([], min)` | `{ csat: 0, total: 0 }` | numeric **0**, not null |
| `percentage(n, 0)` | `0` | division guard |
| `engine.nps()` / `engine.csat()` | **`null`** | wrappers convert empty → null |

⚠️ **Consumers must check `total`, never treat `0` as "measured zero".** An NPS
of `0` means *balanced promoters/detractors*; `total: 0` means *no data*. The
dashboard is safe because it renders through the `engine` wrappers, which return
`null`. Harmonizing the raw functions to return `null` would be an API change —
**not made**; flagged for review.

## 8. Empty-table contract (engine)

An Arquero table built from `[]` has **no columns**, so any column reference
throws (`Invalid column reference`). A study with **zero quantitative rows is a
legitimate state** (e.g. a qualitative-only upload, which the ingestion adapter
accepts). Therefore `valuesFor`, `metricAverages`, and `crossAverage` return the
empty result for an empty table.

This guard is **numerically inert** — it cannot change any value for a table that
has rows. See `AUDIT`-style note in §[5] of the calculation gate.

## 9. Aggregation rules

- Relational work (filter/group/average/count/cross) is **Arquero, declarative** —
  never hand-rolled loops (`engine.ts`).
- Composite indicators are **never** recomputed inside an Arquero rollup; they
  delegate to the canonical definitions in `metrics.ts`.
- `crossAverage` labels a `null`/`undefined` segment `"(sin dato)"`. Note that
  `loadStudyRows` normalizes missing segments to `""` (empty string), which is
  **not** `null`, so it renders as an empty label in the cross table. Cosmetic;
  the pivot path masks it with `|| "(sin dato)"`.

## 10. The gate

`scripts/calculation-test.mjs` (`npm run test:calc`) validates every rule above
against **hand-computed** expectations. It is a **gate**: nothing is built on the
engine until it passes. Expectations are computed by hand in the comments so a
reviewer can verify them without running the code.

`scripts/calculation-parity-test.mjs` (`npm run test:calc-parity`) is the second
gate, and it asks a different question: not "is this formula right" but **"does
every surface produce the same number from the same rows"**. One study, a 1–5
result, a 0–10 result and one on a scale nobody documented; the expected
Top-2-Box computed by hand; and then the engine, the client dashboard, the
server PDF — read out of the produced BYTES, not out of its layout — and the
longitudinal series all asserted to agree with it and with each other. A formula
can be right in one place and absent in three, which is what §5.1 is about.
