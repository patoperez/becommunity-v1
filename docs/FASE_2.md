# Fase 2 — Ingesta + esquema canónico + adaptadores

Deliverable (§3.1, Fase 2):
> *Cargar un estudio desde Excel/Forms hacia el esquema; validación de entrada
> con mensajes claros.*

Status: ✅ **Complete and behaviorally verified.**

## What was built

| Piece | File |
|-------|------|
| Canonical types + Zod guards | [src/lib/ingestion/canonical.ts](../src/lib/ingestion/canonical.ts) |
| File parsing (CSV via papaparse, XLSX via exceljs) | [src/lib/ingestion/parse.ts](../src/lib/ingestion/parse.ts) |
| Wide-survey adapter (mapping + validation) | [src/lib/ingestion/adapters/wide-survey.ts](../src/lib/ingestion/adapters/wide-survey.ts) |
| Persistence (chunked, injected client) | [src/lib/ingestion/persist.ts](../src/lib/ingestion/persist.ts) |
| Upload UI (internal-only) | [src/app/admin/upload/page.tsx](../src/app/admin/upload/page.tsx), [UploadForm.tsx](../src/app/admin/upload/UploadForm.tsx) |
| Server action (authZ + validate + persist) | [src/app/admin/upload/actions.ts](../src/app/admin/upload/actions.ts) |
| Dashboard internal entry point | [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx) |

## Adapter pattern (§2: separate capture from presentation)

The pipeline is three decoupled layers, so adding a new source never touches the
DB or the dashboard:

```
file bytes ──▶ parse.ts ──▶ { headers, rows }     (format-agnostic)
            ──▶ SourceAdapter.adapt() ──▶ canonical respondents + Zod-validated
            ──▶ persist.ts ──▶ respondent / quant_response / qual_observation
```

`SourceAdapter` is an interface; `wideSurveyAdapter` is the first implementation.
Its column contract (one row per respondent):

| Prefix | Maps to | Example |
|--------|---------|---------|
| `seg_<key>` | `respondent.segments[key]` | `seg_nivel` → `{nivel: …}` |
| `q_<metric>` | `quant_response {metric_key, value:number}` | `q_nps` → `nps` |
| `qual_<theme>` | `qual_observation {theme, quote, source}` | `qual_sugerencia` |
| `source` | overrides the source of that row's qualitative rows | default `encuesta` |

A new file shape (Google Forms export, mystery-shopper sheet, …) = a new adapter
implementing `SourceAdapter`. Nothing downstream changes.

## Strict server-side validation (§6.4 — MANDATORY)

- All parsing + validation runs **on the server**, inside the server action,
  **before any DB write**. The order is deliberate: parse → adapt+validate →
  *(only if valid)* create study → persist. A bad file creates **nothing**.
- Per-cell numeric checks with **clear, located messages**:
  `Fila 2 · columna 'q_nps': Se esperaba un número… pero se recibió 'nueve'.`
- Missing-required-column messages: `Falta la columna obligatoria 'seg_nivel'.`
- Errors are **collected, not fail-fast** — the user sees everything wrong at once.
- A final **Zod** guard (`quantSchema`/`qualSchema`/`segmentsSchema`) re-validates
  the built records as the last gate before persistence.

## Authorization (§6.4 defense in depth, §7.1 role-based)

- Only an authenticated **internal** user (`profiles.role = 'internal'`,
  `tenant_id` null) can reach `/admin/upload`. Enforced **server-side** in both
  the page and the server action — the hidden link is not the control.
- Writes use the **service_role** admin client (§6.3, server-only) **after** the
  role check passes, because internal users have no tenant and RLS would
  otherwise block cross-tenant admin writes.

## Behavioral verification

`npx tsx scripts/ingest-test.ts` (against the live DB) — all passed:
- **Good file** → 5 respondents, 10 `quant_response` (`nps`×5, `sat_maestros`×5),
  4 `qual_observation`; DB counts confirmed; `nps` values = `[6,7,8,9,10]`.
- **Malformed file** → 2 errors flagging the exact bad cells (row + column),
  nothing written.
- **Missing required column** → `Falta la columna obligatoria 'seg_nivel'.`

In-browser (live app):
- Internal user uploaded the good CSV → "Carga completa … Encuestados: 5 ·
  Cuantitativas: 10 · Cualitativas: 4"; DB verified.
- Malformed CSV → red error panel "No se cargó ningún dato." with the two
  row/column-precise messages; **0 studies created** (validation precedes write).
- Client (non-internal) user → "Acceso denegado"; unauthenticated → redirect to
  `/login`.
- `scripts/isolation-test.mjs` re-run → still all green (no RLS regression).

## Dependency note (§6.4 supply chain)

Pinned exact: `zod 4.4.3`, `papaparse 5.5.4`, `exceljs 4.4.0`, `@types/papaparse`,
dev `tsx`. **exceljs was chosen over SheetJS `xlsx`** — the npm `xlsx` has a
prototype-pollution history (CVE-2023-30533) and distributes fixes off-npm.
`npm audit` flags two moderate transitive items: `next`→`postcss` (known
false-positive; "fix" downgrades Next to 9.x) and `exceljs`→`uuid`
(GHSA-w5hq-g745-h8pq — only affects uuid v3/v5/v6 with a provided buffer; exceljs
uses v4 and we only read xlsx server-side → not reachable). Neither is force-fixed
because the "fix" introduces breaking downgrades.

## Test data left in place

The good UI upload created study **"Satisfacción 2026 Ingesta"** under
**Colegio Alfa (TEST A)** (5 respondents). Useful as a fixture for Fase 3 (the
calc engine needs real rows). Remove with the rest of the TEST fixtures before
production.
