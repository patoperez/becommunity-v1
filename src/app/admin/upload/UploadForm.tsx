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
import type { IngestError } from "@/lib/ingestion/canonical";
import { UPLOAD_TOO_LARGE_MESSAGE, exceedsUploadLimit } from "@/lib/validation/schemas";
import type { ImportMapping } from "@/lib/ingestion/mapping";
import { MappingWorkbench } from "./MappingWorkbench";
import { ImportPreview } from "./ImportPreview";

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
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-[var(--motion-state)] hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50";

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
  initialTenantId,
  initialStudyId,
}: {
  tenants: TenantOption[];
  studies: StudyOption[];
  history: ImportHistoryItem[];
  initialTenantId?: string;
  initialStudyId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const validInitialTenant = tenants.some((tenant) => tenant.id === initialTenantId)
    ? initialTenantId ?? ""
    : tenants[0]?.id ?? "";
  const validInitialStudy = studies.some(
    (study) => study.id === initialStudyId && study.tenantId === validInitialTenant,
  ) ? initialStudyId ?? "" : "";
  const [tenantId, setTenantId] = useState(validInitialTenant);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmResult | null>(null);
  const [rollbackState, setRollbackState] = useState<RollbackResult | null>(null);
  const [studyMode, setStudyMode] = useState<"existing" | "new">("existing");
  const [studyId, setStudyId] = useState(validInitialStudy);
  const [studyName, setStudyName] = useState("");
  const [period, setPeriod] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const tenantStudies = useMemo(
    () => studies.filter((study) => study.tenantId === tenantId),
    [studies, tenantId],
  );
  const latestCommittedId = history.find((item) => item.status === "committed")?.id ?? null;
  const samplesByHeader = useMemo(
    () =>
      Object.fromEntries(
        (analysis?.status === "ready" ? analysis.columns : []).map((column) => [
          column.header,
          column.samples,
        ]),
      ),
    [analysis],
  );

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
    if (studyMode === "existing" && studyId) data.set("study_id", studyId);
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
      <section className="rounded-xl border border-line bg-surface p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-evidence">Paso 1</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-strong">Elige el archivo y revísalo</h2>
            <p className="mt-1 text-sm text-muted">Revisar el archivo no guarda nada todavía.</p>
          </div>
          {analysis?.status === "ready" ? (
            <span className="rounded-full border border-positive-line bg-positive-surface px-3 py-1 text-xs font-medium text-positive">
              {analysis.sourceRows} filas en el archivo
            </span>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <label className="space-y-1.5 text-sm font-medium text-strong">
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
          <label className="space-y-1.5 text-sm font-medium text-strong">
            Archivo CSV o Excel
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xlsm"
              className={inputClass}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                resetAfterSourceChange();
                // Refuse an over-limit source here, before anything is
                // dispatched. The upload action applies the same rule and stays
                // the authoritative check, but the request never reaches it: the
                // framework caps the request body first, and the operator would
                // otherwise be left with no message at all.
                if (selected && exceedsUploadLimit(selected.size)) {
                  setFile(null);
                  setAnalysis({ status: "error", message: UPLOAD_TOO_LARGE_MESSAGE });
                  return;
                }
                setFile(selected);
              }}
            />
          </label>
          <button type="button" onClick={analyze} disabled={pending || !tenantId || !file} className={primaryButton}>
            {pending ? "Revisando…" : "Revisar archivo"}
          </button>
        </div>

        {analysis?.status === "error" ? (
          <div role="alert" className="mt-4 rounded-lg border border-danger-line bg-danger-surface p-3 text-sm text-danger">
            {analysis.message}
          </div>
        ) : analysis?.status === "ready" ? (
          <div className="mt-4 rounded-lg border border-evidence-line bg-evidence-surface p-3 text-sm text-body">
            <span className="font-medium">
              {analysis.mappingSource === "saved"
                ? "Ya habíamos leído un archivo con esta misma estructura, así que reutilizamos esa lectura. Revísala y ajústala si hace falta."
                : analysis.mappingSource === "template"
                  ? "Se reconoció la estructura guardada en la plantilla del estudio y se aplicó automáticamente."
                  : "Es la primera vez que vemos esta estructura. Preparamos una propuesta: revísala antes de continuar."}
            </span>
            {analysis.notice ? <p className="mt-1">{analysis.notice}</p> : null}
          </div>
        ) : null}
      </section>

      {analysis?.status === "ready" && mapping ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-evidence">Paso 2</p>
            <h2 className="mt-1 text-lg font-semibold text-strong">Decide qué es cada columna</h2>
            <p className="mt-1 text-sm text-muted">
              Elige el destino de cada columna. Lo que no elijas se queda fuera del estudio.
            </p>
          </div>

          <MappingWorkbench
            mapping={mapping}
            samplesByHeader={samplesByHeader}
            known={analysis.knownDestinations}
            onChange={updateMapping}
          />

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={previewImport} disabled={pending} className={primaryButton}>
              {pending ? "Comprobando…" : "Ver cómo quedará"}
            </button>
          </div>

          {preview?.status === "error" ? (
            <div role="alert" className="mt-4 rounded-lg border border-danger-line bg-danger-surface p-4 text-danger">
              <p className="font-medium">{preview.message}</p>
              <ErrorList errors={preview.errors} />
            </div>
          ) : null}
        </section>
      ) : null}

      {preview?.status === "ready" && mapping ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-voice">Paso 3</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-strong">Revisa cómo quedará y confirma</h2>
          </div>

          <ImportPreview
            summary={preview.summary}
            sample={preview.sample}
            sourceRows={preview.sourceRows}
          />

          <div className="mt-6 grid gap-4 rounded-xl border border-line p-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-medium text-strong">¿A qué estudio entra?</p>
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
            <div className="flex flex-col justify-between gap-4 rounded-lg border border-caution-line bg-caution-surface p-4">
              <label className="flex items-start gap-3 text-sm text-caution">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                Revisé cómo se leyó el archivo y los conteos. Al confirmar se guarda todo junto, o no se guarda nada.
              </label>
              <button type="button" onClick={confirmImport} disabled={pending || !canConfirm} className={primaryButton}>
                {pending ? "Confirmando…" : "Confirmar y guardar"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {confirmation ? (
        <div role={confirmation.status === "error" ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${confirmation.status === "success" ? "border-positive-line bg-positive-surface text-positive" : "border-danger-line bg-danger-surface text-danger"}`}>
          <p className="font-medium">{confirmation.message}</p>
          {confirmation.status === "success" ? (
            <p className="mt-1">Se {confirmation.mappingReused ? "reutilizó la lectura guardada" : "guardó esta lectura para la próxima vez"} · {confirmation.summary.respondents} personas.</p>
          ) : <ErrorList errors={confirmation.errors} />}
        </div>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Historial</p>
          <h2 className="mt-1 font-display text-lg font-semibold text-strong">Importaciones recientes</h2>
          <p className="mt-1 text-sm text-muted">Solo la última carga confirmada se puede deshacer.</p>
        </div>
        {rollbackState ? (
          <div className={`mt-4 rounded-lg p-3 text-sm ${rollbackState.status === "success" ? "border border-positive-line bg-positive-surface text-positive" : "border border-danger-line bg-danger-surface text-danger"}`}>{rollbackState.message}</div>
        ) : null}
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium text-strong">{item.fileName}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.status === "committed" ? "border border-positive-line bg-positive-surface text-positive" : item.status === "rolled_back" ? "border border-line bg-surface-sunken text-muted" : item.status === "failed" ? "border border-danger-line bg-danger-surface text-danger" : "border border-caution-line bg-caution-surface text-caution"}`}>{item.status.replace("committed", "confirmado").replace("rolled_back", "revertido").replace("failed", "fallido").replace("staged", "preparado")}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{item.tenantName} · {item.studyName} · {formatDate(item.committedAt ?? item.createdAt)}</p>
                <p className="mt-1 text-xs text-muted">{item.respondents} personas · {item.quant} resultados numéricos · {item.qual} comentarios</p>
              </div>
              {item.id === latestCommittedId ? (
                <button type="button" onClick={() => rollback(item.id)} disabled={pending} className="min-h-11 rounded-lg border border-danger-line px-3 py-2 text-sm font-semibold text-danger transition-colors duration-[var(--motion-state)] hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50">Deshacer esta carga</button>
              ) : null}
            </div>
          ))}
          {history.length === 0 ? <p className="rounded-xl border border-line bg-surface-sunken p-6 text-center text-sm text-muted">Todavía no hay importaciones.</p> : null}
        </div>
      </section>
    </div>
  );
}
