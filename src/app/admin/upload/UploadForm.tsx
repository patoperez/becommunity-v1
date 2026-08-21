"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeImportFile,
  confirmImportFile,
  previewImportFile,
  rollbackLatestImport,
  type AnalyzeResult,
  type ConfirmResult,
  type PreviewResult,
  type RollbackResult,
} from "./actions";
import {
  QUALITATIVE_SOURCES,
  type IngestError,
} from "@/lib/ingestion/canonical";
import type { ColumnTarget, ImportMapping, RecodingTable } from "@/lib/ingestion/mapping";

export type TenantOption = { id: string; name: string };
export type StudyOption = { id: string; tenantId: string; name: string; period: string | null };
export type ImportHistoryItem = {
  id: string;
  tenantName: string;
  studyName: string;
  fileName: string;
  status: "staged" | "committed" | "failed" | "rolled_back";
  respondents: number;
  quant: number;
  qual: number;
  createdAt: string;
  committedAt: string | null;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
const smallInputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
const primaryButton =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const secondaryButton =
  "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

function ErrorList({ errors }: { errors?: IngestError[] }) {
  if (!errors?.length) return null;
  return (
    <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm">
      {errors.slice(0, 100).map((error, index) => (
        <li key={`${error.row}-${error.column}-${index}`}>
          {error.row ? `Fila ${error.row}` : "Archivo"}
          {error.column ? ` · ${error.column}` : ""}: {error.message}
        </li>
      ))}
      {errors.length > 100 ? <li>… y {errors.length - 100} errores más.</li> : null}
    </ul>
  );
}

function targetForKind(kind: ColumnTarget["kind"], header: string): ColumnTarget {
  const key = header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(seg|q|qual)_/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "campo";
  if (kind === "segment") return { kind, key: /^[a-z]/.test(key) ? key : `campo_${key}` };
  if (kind === "quantitative") return { kind, metricKey: /^[a-z]/.test(key) ? key : `metrica_${key}` };
  if (kind === "qualitative") return { kind, theme: /^[a-z]/.test(key) ? key : `tema_${key}`, source: "encuesta" };
  return { kind: "ignore" };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chihuahua",
  }).format(new Date(value));
}

export default function UploadForm({
  tenants,
  studies,
  history,
}: {
  tenants: TenantOption[];
  studies: StudyOption[];
  history: ImportHistoryItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmResult | null>(null);
  const [rollbackState, setRollbackState] = useState<RollbackResult | null>(null);
  const [studyMode, setStudyMode] = useState<"existing" | "new">("existing");
  const [studyId, setStudyId] = useState("");
  const [studyName, setStudyName] = useState("");
  const [period, setPeriod] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const tenantStudies = useMemo(
    () => studies.filter((study) => study.tenantId === tenantId),
    [studies, tenantId],
  );
  const latestCommittedId = history.find((item) => item.status === "committed")?.id ?? null;

  function resetAfterSourceChange() {
    setAnalysis(null);
    setMapping(null);
    setPreview(null);
    setConfirmation(null);
    setConfirmed(false);
  }

  function actionData(includeMapping = false) {
    const data = new FormData();
    data.set("tenant_id", tenantId);
    if (file) data.set("file", file);
    if (includeMapping && mapping) data.set("mapping_json", JSON.stringify(mapping));
    return data;
  }

  function analyze() {
    setPreview(null);
    setConfirmation(null);
    startTransition(async () => {
      const result = await analyzeImportFile(actionData());
      setAnalysis(result);
      setMapping(result.status === "ready" ? result.mapping : null);
      setConfirmed(false);
    });
  }

  function updateMapping(next: ImportMapping) {
    setMapping(next);
    setPreview(null);
    setConfirmation(null);
    setConfirmed(false);
  }

  function updateTarget(index: number, target: ColumnTarget) {
    if (!mapping) return;
    const columns = mapping.columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, target } : column,
    );
    updateMapping({ ...mapping, columns });
  }

  function updateTable(index: number, table: RecodingTable) {
    if (!mapping) return;
    const previousId = mapping.recodingTables[index]?.id;
    const recodingTables = mapping.recodingTables.map((item, tableIndex) => tableIndex === index ? table : item);
    const columns = previousId && previousId !== table.id
      ? mapping.columns.map((column) => column.target.kind === "quantitative" && column.target.recodingTableId === previousId
          ? { ...column, target: { ...column.target, recodingTableId: table.id } }
          : column)
      : mapping.columns;
    updateMapping({ ...mapping, columns, recodingTables });
  }

  function previewImport() {
    startTransition(async () => {
      const result = await previewImportFile(actionData(true));
      setPreview(result);
      if (result.status === "ready") setMapping(result.mapping);
      setConfirmation(null);
      setConfirmed(false);
    });
  }

  function confirmImport() {
    const data = actionData(true);
    data.set("study_mode", studyMode);
    if (studyMode === "existing") data.set("study_id", studyId);
    else {
      data.set("study_name", studyName);
      data.set("period", period);
    }
    startTransition(async () => {
      const result = await confirmImportFile(data);
      setConfirmation(result);
      if (result.status === "success") {
        setPreview(null);
        setConfirmed(false);
        router.refresh();
      }
    });
  }

  function rollback(batchId: string) {
    if (!window.confirm("¿Revertir la importación más reciente? Se eliminarán únicamente las filas de ese lote.")) return;
    startTransition(async () => {
      const result = await rollbackLatestImport(batchId);
      setRollbackState(result);
      if (result.status === "success") router.refresh();
    });
  }

  const canConfirm = preview?.status === "ready" && confirmed && (
    studyMode === "existing" ? Boolean(studyId) : Boolean(studyName.trim())
  );

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Paso 1</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Selecciona y analiza la fuente</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">El análisis no escribe nada en la base de datos.</p>
          </div>
          {analysis?.status === "ready" ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              {analysis.sourceRows} filas detectadas
            </span>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <label className="space-y-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Cliente
            <select
              value={tenantId}
              onChange={(event) => {
                setTenantId(event.target.value);
                setStudyId("");
                resetAfterSourceChange();
              }}
              className={inputClass}
            >
              <option value="" disabled>Selecciona un cliente…</option>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Archivo CSV o Excel
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xlsm"
              className={inputClass}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                resetAfterSourceChange();
              }}
            />
          </label>
          <button type="button" onClick={analyze} disabled={pending || !tenantId || !file} className={primaryButton}>
            {pending ? "Analizando…" : "Analizar"}
          </button>
        </div>

        {analysis?.status === "error" ? (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {analysis.message}
          </div>
        ) : analysis?.status === "ready" ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <span className="font-medium">
              {analysis.mappingSource === "saved"
                ? `Mapeo guardado v${analysis.mappingVersion} reutilizado automáticamente.`
                : "Instrumento nuevo: revisa el mapeo propuesto."}
            </span>
            {analysis.notice ? <p className="mt-1">{analysis.notice}</p> : null}
          </div>
        ) : null}
      </section>

      {analysis?.status === "ready" && mapping ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400">Paso 2</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Mapea las columnas</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Cada encabezado debe tener un destino explícito o quedar ignorado.</p>
          </div>

          <label className="mb-5 block space-y-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Nombre del mapeo reutilizable
            <input
              value={mapping.name}
              maxLength={120}
              onChange={(event) => updateMapping({ ...mapping, name: event.target.value })}
              className={inputClass}
            />
          </label>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Columna y muestras</th>
                  <th className="px-4 py-3">Destino</th>
                  <th className="px-4 py-3">Configuración</th>
                  <th className="px-4 py-3">Obligatoria</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {mapping.columns.map((column, index) => {
                  const samples = analysis.columns.find((item) => item.header === column.sourceColumn)?.samples ?? [];
                  const target = column.target;
                  return (
                    <tr key={column.sourceColumn} className="align-top">
                      <td className="px-4 py-3">
                        <p className="max-w-xs font-medium text-zinc-900 dark:text-zinc-100">{column.sourceColumn}</p>
                        <p className="mt-1 max-w-xs truncate text-xs text-zinc-500" title={samples.join(" · ")}>{samples.join(" · ") || "Sin valores"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={target.kind}
                          onChange={(event) => updateTarget(index, targetForKind(event.target.value as ColumnTarget["kind"], column.sourceColumn))}
                          className={smallInputClass}
                        >
                          <option value="ignore">Ignorar</option>
                          <option value="segment">Segmento</option>
                          <option value="quantitative">Métrica cuantitativa</option>
                          <option value="qualitative">Texto cualitativo</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {target.kind === "segment" ? (
                          <input aria-label="Clave de segmento" value={target.key} onChange={(event) => updateTarget(index, { ...target, key: event.target.value })} className={smallInputClass} />
                        ) : target.kind === "quantitative" ? (
                          <div className="flex flex-wrap gap-2">
                            <input aria-label="Clave de métrica" value={target.metricKey} onChange={(event) => updateTarget(index, { ...target, metricKey: event.target.value })} className={smallInputClass} />
                            <input aria-label="Mínimo" type="number" placeholder="Mín." value={target.min ?? ""} onChange={(event) => updateTarget(index, { ...target, min: event.target.value === "" ? undefined : Number(event.target.value) })} className={`${smallInputClass} w-20`} />
                            <input aria-label="Máximo" type="number" placeholder="Máx." value={target.max ?? ""} onChange={(event) => updateTarget(index, { ...target, max: event.target.value === "" ? undefined : Number(event.target.value) })} className={`${smallInputClass} w-20`} />
                            <select aria-label="Tabla de recodificación" value={target.recodingTableId ?? ""} onChange={(event) => updateTarget(index, { ...target, recodingTableId: event.target.value || undefined })} className={smallInputClass}>
                              <option value="">Sin recodificación</option>
                              {mapping.recodingTables.map((table) => <option key={table.id} value={table.id}>{table.id}</option>)}
                            </select>
                          </div>
                        ) : target.kind === "qualitative" ? (
                          <div className="flex flex-wrap gap-2">
                            <input aria-label="Tema cualitativo" value={target.theme} onChange={(event) => updateTarget(index, { ...target, theme: event.target.value })} className={smallInputClass} />
                            <select aria-label="Fuente cualitativa" value={target.source ?? "encuesta"} onChange={(event) => updateTarget(index, { ...target, source: event.target.value as (typeof QUALITATIVE_SOURCES)[number] })} className={smallInputClass}>
                              {QUALITATIVE_SOURCES.map((source) => <option key={source} value={source}>{source.replace("_", " ")}</option>)}
                            </select>
                          </div>
                        ) : <span className="text-xs text-zinc-400">No se importará</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {target.kind !== "ignore" ? (
                          <input type="checkbox" checked={target.required ?? false} onChange={(event) => updateTarget(index, { ...target, required: event.target.checked })} />
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-zinc-900 dark:text-zinc-100">Tablas de recodificación</h3>
                <p className="text-xs text-zinc-500">Convierte etiquetas como “Muy satisfecho” a valores numéricos.</p>
              </div>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => updateMapping({
                  ...mapping,
                  recodingTables: [...mapping.recodingTables, { id: `tabla_${mapping.recodingTables.length + 1}`, version: 1, values: { "Muy satisfecho": 5 } }],
                })}
              >
                Añadir tabla
              </button>
            </div>
            <div className="mt-4 space-y-4">
              {mapping.recodingTables.map((table, tableIndex) => (
                <div key={`${table.id}-${tableIndex}`} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={table.id} aria-label="ID de tabla" onChange={(event) => updateTable(tableIndex, { ...table, id: event.target.value })} className={smallInputClass} />
                    <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => updateMapping({
                      ...mapping,
                      columns: mapping.columns.map((column) => column.target.kind === "quantitative" && column.target.recodingTableId === table.id ? { ...column, target: { ...column.target, recodingTableId: undefined } } : column),
                      recodingTables: mapping.recodingTables.filter((_, index) => index !== tableIndex),
                    })}>Eliminar tabla</button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {Object.entries(table.values).map(([label, value], valueIndex) => (
                      <div key={`${label}-${valueIndex}`} className="flex gap-2">
                        <input value={label} aria-label="Etiqueta" onChange={(event) => {
                          const entries = Object.entries(table.values);
                          entries[valueIndex] = [event.target.value, value];
                          updateTable(tableIndex, { ...table, values: Object.fromEntries(entries) });
                        }} className={`${smallInputClass} min-w-0 flex-1`} />
                        <input type="number" value={value} aria-label="Valor" onChange={(event) => updateTable(tableIndex, { ...table, values: { ...table.values, [label]: Number(event.target.value) } })} className={`${smallInputClass} w-24`} />
                        <button type="button" className="px-1 text-zinc-400 hover:text-red-600" aria-label="Eliminar equivalencia" onClick={() => {
                          const values = { ...table.values };
                          delete values[label];
                          updateTable(tableIndex, { ...table, values });
                        }}>×</button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="mt-3 text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-300" onClick={() => updateTable(tableIndex, { ...table, values: { ...table.values, [`Etiqueta ${Object.keys(table.values).length + 1}`]: 0 } })}>
                    + Añadir equivalencia
                  </button>
                </div>
              ))}
              {mapping.recodingTables.length === 0 ? <p className="text-sm text-zinc-400">No se necesitan si el archivo ya contiene números.</p> : null}
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={previewImport} disabled={pending} className={primaryButton}>
              {pending ? "Validando…" : "Generar vista previa"}
            </button>
          </div>

          {preview?.status === "error" ? (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <p className="font-medium">{preview.message}</p>
              <ErrorList errors={preview.errors} />
            </div>
          ) : null}
        </section>
      ) : null}

      {preview?.status === "ready" && mapping ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-400">Paso 3</p>
            <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Revisa y confirma</h2>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Encuestados", preview.summary.respondents],
              ["Respuestas numéricas", preview.summary.quant],
              ["Observaciones", preview.summary.qual],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Muestra de hasta 5 filas</h3>
            {preview.sample.map((row) => (
              <details key={row.sourceRow} className="rounded-lg border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
                <summary className="cursor-pointer font-medium">Fila {row.sourceRow} · {row.quant.length} métricas · {row.qual.length} textos</summary>
                <pre className="mt-3 overflow-auto rounded bg-zinc-950 p-3 text-xs text-zinc-100">{JSON.stringify({ segments: row.segments, quant: row.quant, qual: row.qual }, null, 2)}</pre>
              </details>
            ))}
          </div>

          <div className="mt-6 grid gap-4 rounded-xl border border-zinc-200 p-4 md:grid-cols-2 dark:border-zinc-800">
            <div className="space-y-3">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Destino</p>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={studyMode === "existing"} onChange={() => setStudyMode("existing")} /> Estudio existente</label>
                <label className="flex items-center gap-2"><input type="radio" checked={studyMode === "new"} onChange={() => setStudyMode("new")} /> Crear estudio</label>
              </div>
              {studyMode === "existing" ? (
                <select value={studyId} onChange={(event) => setStudyId(event.target.value)} className={inputClass}>
                  <option value="">Selecciona un estudio…</option>
                  {tenantStudies.map((study) => <option key={study.id} value={study.id}>{study.name}{study.period ? ` · ${study.period}` : ""}</option>)}
                </select>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input value={studyName} onChange={(event) => setStudyName(event.target.value)} placeholder="Nombre del estudio" className={inputClass} />
                  <input value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="Periodo (opcional)" className={inputClass} />
                </div>
              )}
            </div>
            <div className="flex flex-col justify-between gap-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-950/40">
              <label className="flex items-start gap-3 text-sm text-amber-950 dark:text-amber-100">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                Confirmo que revisé el mapeo, los conteos y la muestra. Esta acción escribirá el lote completo de forma atómica.
              </label>
              <button type="button" onClick={confirmImport} disabled={pending || !canConfirm} className={primaryButton}>
                {pending ? "Confirmando…" : "Confirmar importación"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {confirmation ? (
        <div role={confirmation.status === "error" ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${confirmation.status === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"}`}>
          <p className="font-medium">{confirmation.message}</p>
          {confirmation.status === "success" ? (
            <p className="mt-1">Mapeo v{confirmation.mappingVersion} {confirmation.mappingReused ? "reutilizado" : "guardado"} · {confirmation.summary.respondents} encuestados.</p>
          ) : <ErrorList errors={confirmation.errors} />}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Historial</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Importaciones recientes</h2>
          <p className="mt-1 text-sm text-zinc-500">Solo el último lote confirmado puede revertirse.</p>
        </div>
        {rollbackState ? (
          <div className={`mt-4 rounded-lg p-3 text-sm ${rollbackState.status === "success" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>{rollbackState.message}</div>
        ) : null}
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{item.fileName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "committed" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : item.status === "rolled_back" ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" : item.status === "failed" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}>{item.status.replace("committed", "confirmado").replace("rolled_back", "revertido").replace("failed", "fallido").replace("staged", "preparado")}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{item.tenantName} · {item.studyName} · {formatDate(item.committedAt ?? item.createdAt)}</p>
                <p className="mt-1 text-xs text-zinc-400">{item.respondents} encuestados · {item.quant} numéricas · {item.qual} cualitativas</p>
              </div>
              {item.id === latestCommittedId ? (
                <button type="button" onClick={() => rollback(item.id)} disabled={pending} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">Revertir último lote</button>
              ) : null}
            </div>
          ))}
          {history.length === 0 ? <p className="rounded-xl bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:bg-zinc-950">Todavía no hay importaciones.</p> : null}
        </div>
      </section>
    </div>
  );
}
