# Fase 4 — Cruces dinámicos interactivos

Deliverable (§3.1, Fase 4):
> *Filtros que recalculan en vivo (género × dimensión, etc.)*

Status: ✅ **Code-complete and logically verified.** In-browser click-through is
pending a reconnected browser extension (see "Verification" note).

## What was built

| Piece | File |
|-------|------|
| Pivot core: `PivotIntent`, allowlist, validation, compute | [src/lib/calc/pivot.ts](../src/lib/calc/pivot.ts) |
| Interactive explorer (live recalc) | [src/app/dashboard/PivotExplorer.tsx](../src/app/dashboard/PivotExplorer.tsx) |
| Dashboard wiring (rows + allowlist per study) | [src/app/dashboard/StudyCard.tsx](../src/app/dashboard/StudyCard.tsx), [page.tsx](../src/app/dashboard/page.tsx) |
| **Validation + computation gate** | [scripts/pivot-test.mjs](../scripts/pivot-test.mjs) |
| Real-data check | *retired in P7 PR 7* — the script was reachable by no npm script; its pivot coverage now executes as `npm run test:pivot` and, behaviorally, as Suite C's C3 |

## `PivotIntent` exactly as §5.3

```ts
type PivotIntent = {
  rows: string[];
  columns: string[];
  values: { field: string; agg: "avg" | "count" | "sum" | "min" | "max" }[];
};
```

The user's interactive selection (row dim, column dim, metric, aggregation) is
modeled as this validated structure — never imperative free control.

## MANDATORY: validate against an allowlist BEFORE computing

- `buildAllowlist(rows)` derives the permitted `dimensions` (segment keys) and
  `metrics` (metric keys) **from the user's own RLS-scoped data**. A user can only
  ever reference fields that exist in their tenant's study.
- `validatePivotIntent(intent, allowlist)` runs **before** any computation and
  rejects: unknown row/column dimensions, unknown metric fields (e.g. injection-
  style names), invalid aggregations, row == column, and empty selections.
- `computePivot(rows, intent, allowlist)` **re-validates and throws** on an
  invalid intent — so it is structurally impossible to drive Arquero with an
  unvalidated or out-of-scope intent (defense in depth on top of the UI check).
- The UI rebuilds the allowlist client-side from the data it received; it never
  trusts an externally supplied field list.

## Live recalculation

`PivotExplorer` is a client component. On every selector change it: builds the
intent → validates against the allowlist → (if valid) recomputes with Arquero in
the browser (§5.1) via `useMemo` → re-renders. Invalid selections surface a clear
error and **do not** compute. Results render as a cross-tab **table** and, for the
1-dimensional case, a **bar chart**.

## Verification

- **Pivot gate** (`npx tsx scripts/pivot-test.mjs`) — PASSED: allowlist derivation,
  six rejection cases (incl. injection-style metric and invalid agg), `computePivot`
  throws on invalid intent, and crosses match hand-computed values (genero × nivel
  avg, count, sum).
- **Real data** (recorded 2026 with the since-retired `fase4-realdata-check.mjs`, signed in as Tenant A,
  RLS-scoped) — genero × nivel avg sat_maestros returned the correct grid
  (F: preescolar 8 / primaria 9 / secundaria 7; M: 6 / 5 / —); adversarial
  `rows:['ssn']` rejected before compute.
- `tsc` 0 errors; `npm run build` clean (the client explorer bundles Arquero for
  the browser); `isolation-test.mjs` still green (no security regression).
- **Pending:** the actual in-browser click-through (live selector interaction).
  The Chrome extension disconnected at the end of the prior session, so this final
  manual confirmation was not run. The dev server is up at http://localhost:3000;
  it can be confirmed by reconnecting the extension or by you logging in as Tenant A
  and using the "Explorador de cruces" on a study.
