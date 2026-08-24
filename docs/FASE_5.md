# Fase 5 — Journey map configurable conectado a datos

Deliverable (§3.1, Fase 5):
> *Recorrido por cliente, métricas por etapa, interacción al pasar el cursor.*

Status: ✅ **Code-complete; data-connected hover values verified headlessly.**

## What was built

| Piece | File |
|-------|------|
| Stage parser (defensive jsonb) | [src/lib/calc/journey.ts](../src/lib/calc/journey.ts) |
| Per-stage metric via engine | `computeStageMetric` in [src/lib/calc/engine.ts](../src/lib/calc/engine.ts) |
| Interactive journey component | [src/app/dashboard/JourneyMap.tsx](../src/app/dashboard/JourneyMap.tsx) |
| Dashboard wiring | [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx), [StudyCard.tsx](../src/app/dashboard/StudyCard.tsx) |
| Journey demo seed | [scripts/seed-journey-demo.mjs](../scripts/seed-journey-demo.mjs) |
| Headless verification | *retired in P7 PR 7* — the script was reachable by no npm script; `computeStageMetric` and `parseJourneyDefinition` are covered by `test:calc`, `test:cloudflare-calc`, `test:study-config` and `test:workers-runtime` |

## Configuración sobre código (§8.1, §8.3)

The journey is rendered **entirely from the study's `journey_definition` jsonb** —
there are no hardcoded stages. `parseJourneyDefinition` reads
`{ stages: [{ id, label, metric, description? }] }`, validating each entry and
dropping malformed ones (a bad config can never crash the UI). The same component
draws any client's journey.

**Out of scope by design (§8.3):** there is **no** drag-and-drop visual stage
builder. "Configurable" here means the journey is defined by editing the data
structure — exactly the realistic v1 scope the document calls for.

## Conectado a datos (§8.2)

Hovering (or focusing / tapping) a stage reveals that stage's **real** metrics for
THIS study, computed by the engine via `computeStageMetric`, which picks the
canonical indicator by metric-key convention:
- `nps_*` → **NPS** (with promoters/passives/detractors breakdown)
- `sat_*` / `csat` → **average** headline + **CSAT (Top-2-Box)** detail
- otherwise → **average**

All of these reuse the canonical definitions from `metrics.ts` (§5.2 golden rule)
— the journey never re-implements a formula.

## Verification (headless, real RLS-scoped data)

The since-retired `fase5-journey-check.mjs` (signed in as Tenant A) parsed all 6 stages
from `journey_definition` and computed each stage's metric:

| Stage | Metric | Kind | Value | Detail |
|-------|--------|------|-------|--------|
| Informes | sat_informes | CSAT | 7.75 | Top-2-Box 25% (2/8) |
| Admisión | nps_admision | NPS | **50** | 5 prom / 2 pas / 1 detr |
| Inscripción | sat_inscripcion | CSAT | 6.75 | Top-2-Box 0% |
| Primer día | sat_bienvenida | CSAT | 8.63 | Top-2-Box 62.5% (5/8) |
| Día a día | sat_operacion | CSAT | 7.00 | Top-2-Box 0% |
| Reinscripción | nps_general | NPS | 0 | 2 prom / 4 pas / 2 detr |

Spot-checks vs hand-computed: NPS admisión = **50** ✓, avg sat_informes = **7.75** ✓.

`tsc` 0 errors · `npm run build` clean (JourneyMap bundles for the browser) ·
`isolation-test.mjs` still green.

**Pending (same as Fase 4):** the live in-browser hover interaction was not
clicked through this session — the Chrome extension is disconnected. The exact
values the hover shows are verified headlessly; the dev server is up at
http://localhost:3000 (login as Tenant A → "Journey Demo 2026") to confirm
visually, or I can drive it once the extension reconnects.

## Fits the dashboard

`JourneyMap` renders at the top of a study's card (a journey naturally precedes
the metric breakdowns), above the headline tiles, averages, static crosses, and
the interactive `PivotExplorer` from Fase 4.
