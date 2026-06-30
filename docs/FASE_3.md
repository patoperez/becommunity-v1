# Fase 3 — Motor de cálculo (Arquero) + dashboard base

Deliverable (§3.1, Fase 3):
> *NPS, CSAT, segmentaciones y cruces calculados con librería; pruebas contra
> resultados de Excel conocidos.*

Status: ✅ **Complete. The mandatory §5.4 calculation gate PASSES.**

## What was built

| Piece | File |
|-------|------|
| Canonical metric definitions (NPS/CSAT/mean — once) | [src/lib/calc/metrics.ts](../src/lib/calc/metrics.ts) |
| Arquero engine (averages, counts, crosses) | [src/lib/calc/engine.ts](../src/lib/calc/engine.ts) |
| RLS-scoped study loader | [src/lib/calc/load.ts](../src/lib/calc/load.ts) |
| Dashboard metrics card | [src/app/dashboard/StudyCard.tsx](../src/app/dashboard/StudyCard.tsx) |
| Dashboard wiring | [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) |
| **Mandatory verification gate (§5.4)** | [scripts/calculation-test.mjs](../scripts/calculation-test.mjs) |

## Golden rule: one canonical definition, one place (§5.2)

`metrics.ts` holds the composite indicators **defined exactly once**:
- `npsFromScores(scores)` — the **only** NPS implementation: promoters (≥9) −
  detractors (≤6) over total, on a 0–10 scale, returned −100..100.
- `csatTopBox(scores, satisfiedMin)` — the only CSAT (Top-N-Box) implementation;
  the threshold is an explicit input so the scale is never guessed.
- `mean` / `percentage` — return `null`/0 explicitly, never a silent 0.

These are **never** re-implemented in a component or an Arquero rollup. `engine.ts`
uses Arquero only for relational work (filter/group/`op.average`/`op.count`/cross,
the §5.2 pattern) and delegates NPS/CSAT to `metrics.ts`. The dashboard renders
the engine's output; it never recomputes a metric itself.

## Scope (§5.4)

Included and implemented: averages, counts, percentages, NPS, CSAT/Top-2-Box,
segment crosses (the género × sat_maestros example). Out of scope by design:
statistical significance, regressions, correlations, seasonal time series.

## MANDATORY calculation gate (§5.4)

`npx tsx scripts/calculation-test.mjs` validates the engine against a fixed
dataset whose results were computed **by hand** (the "known Excel result"
stand-in). It is a gate — nothing was built on the dashboard until it passed.
All checks green:

- NPS([9,10,6,8,7,9,3,10]) = **25.0** (4 prom, 2 pass, 2 detr, n=8)
- mean(nps)=**7.75**, mean(sat)=**3.63** (3.625→2dp)
- CSAT(top-2-box, min 4)=**62.5%** (5/8)
- Arquero `metricAverages` sat=**3.625**, nps=**7.75**
- cross sat by genero: F=**4.25** (n4), M=**3.0** (n4)
- `computeStudyMetrics` orchestration matches all of the above; NPS excluded from
  the plain averages list; cross dimension auto-selected (`genero`).
- Edge cases: `mean([])=null`, `NPS([])=0`.

## Live verification (real data, Fase 2 fixtures)

Logged in as client A, the dashboard rendered RLS-scoped, engine-computed metrics
that match hand calculation:

- **Satisfacción 2026 Ingesta** — NPS **20** (2 prom −1 detr /5), CSAT **20%**
  (1/5 ≥9), avg sat_maestros **7**; cross by `genero`: nps F=**9** / M=**6.50**,
  sat F=**8** / M=**5.50**.
- **Satisfacción 2026 (TEST)** — 1 respondent, avg sat **8**, CSAT 0%.

No security regression: `scripts/isolation-test.mjs` still all green; production
build clean.

## Dependency

Pinned exact: `arquero 8.0.3`. Note Arquero parses expression functions from
source and does **not** capture closures — external values are passed via
`.params({…})` and read as the second predicate argument.

> Note: the §5.4 gate here uses a hand-computed dataset. The document also calls
> for a final validation against a **real** Be Community study already processed
> in Excel (e.g. Aníbal Ponce) before production — that remains a human-supervised
> step once a real study file is available.
