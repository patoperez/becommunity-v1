import { readFileSync } from "node:fs";
import { adaptPeriodSeries } from "../src/lib/ingestion/period-series.ts";
import { adaptMappedSurvey } from "../src/lib/ingestion/adapters/mapped-survey.ts";

let failures = 0;
const check = (condition, message) => condition ? console.log("  ✓", message) : (console.error("  ✗", message), failures++);

console.log("Be Community — real-study ingestion gate");

const mapped = adaptMappedSurvey({
  headers: ["priv_nombre", "seg_nivel", "q_nps"],
  rows: [{ priv_nombre: "Persona privada", seg_nivel: "Primaria", q_nps: "9" }],
}, {
  version: 1,
  name: "Privado",
  columns: [
    { sourceColumn: "priv_nombre", target: { kind: "private", key: "nombre" } },
    { sourceColumn: "seg_nivel", target: { kind: "segment", key: "nivel" } },
    { sourceColumn: "q_nps", target: { kind: "quantitative", metricKey: "nps" } },
  ],
  recodingTables: [],
});
check(mapped.ok && mapped.respondents[0].privateMetadata.nombre === "Persona privada", "private respondent fields survive canonical adaptation");
check(mapped.ok && !("nombre" in mapped.respondents[0].segments), "private fields never become filter segments");

const series = adaptPeriodSeries({
  headers: ["Periodo", "Miembros inicio", "Miembros nuevos", "Miembros final", "Miembros perdidos", "Retención (%)", "Deserción (%)"],
  rows: [
    { Periodo: "Enero", "Miembros inicio": "100", "Miembros nuevos": "20", "Miembros final": "94", "Miembros perdidos": "26", "Retención (%)": "74", "Deserción (%)": "26" },
    { Periodo: "Febrero", "Miembros inicio": "94", "Miembros nuevos": "10", "Miembros final": "90", "Miembros perdidos": "14", "Retención (%)": "85.11", "Deserción (%)": "14.89" },
  ],
});
check(series.ok && series.points.length === 2, "aggregate periods are accepted as two periods, not respondents");
check(series.ok && series.points[0].retention === 74 && series.points[0].churn === 26, "retention and churn are recalculated canonically");

const impossible = adaptPeriodSeries({
  headers: ["Periodo", "Miembros inicio", "Miembros nuevos", "Miembros final", "Miembros perdidos"],
  rows: [{ Periodo: "Marzo", "Miembros inicio": "100", "Miembros nuevos": "10", "Miembros final": "99", "Miembros perdidos": "3" }],
});
check(!impossible.ok, "internally impossible populations are rejected");

const migration = readFileSync(new URL("../supabase/migrations/0019_private_metadata_and_period_series.sql", import.meta.url), "utf8");
check(/private_metadata jsonb not null/.test(migration), "private metadata is stored on the raw respondent boundary");
check(/commit_import_batch_with_private[\s\S]*security definer/.test(migration), "private commit wrapper is security definer");
check(/revoke all on function public\.commit_import_batch_with_private\(uuid, jsonb\) from public, anon, authenticated/.test(migration), "browser roles cannot execute private commit");
check(/alter table public\.study_period_snapshot force row level security/.test(migration), "aggregate source table forces RLS");
check(/revoke all privileges on table public\.period_series_import, public\.study_period_snapshot from anon, authenticated/.test(migration), "aggregate source tables are invisible to browser roles");

const authorized = readFileSync(new URL("../src/lib/studies/authorized.ts", import.meta.url), "utf8");
check(!/select\([^)]*private_metadata/.test(authorized), "client-authorized loader never selects private metadata");

if (failures) process.exit(1);
console.log("RESULT: private metadata and aggregate-series contracts passed.");

