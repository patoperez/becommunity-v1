"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzePeriodSeriesFile, confirmPeriodSeriesFile, type PeriodSeriesResult } from "./actions";
import type { StudyOption, TenantOption } from "./UploadForm";

const inputClass = "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-50";

export function PeriodSeriesUpload({ tenants, studies, initialTenantId, initialStudyId }: {
  tenants: TenantOption[];
  studies: StudyOption[];
  initialTenantId?: string;
  initialStudyId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState(tenants.some((item) => item.id === initialTenantId) ? initialTenantId! : tenants[0]?.id ?? "");
  const tenantStudies = useMemo(() => studies.filter((item) => item.tenantId === tenantId), [studies, tenantId]);
  const [studyId, setStudyId] = useState(studies.some((item) => item.id === initialStudyId) ? initialStudyId! : "");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PeriodSeriesResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function data() {
    const value = new FormData();
    value.set("tenant_id", tenantId);
    value.set("study_id", studyId);
    if (file) value.set("file", file);
    return value;
  }

  function analyze() {
    setConfirmed(false);
    startTransition(async () => setResult(await analyzePeriodSeriesFile(data())));
  }

  function save() {
    startTransition(async () => {
      const next = await confirmPeriodSeriesFile(data());
      setResult(next);
      if (next.status === "success") router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-evidence">Serie histórica</p>
      <h2 className="mt-1 font-display text-lg font-semibold text-strong">Cargar retención y deserción por periodo</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">Usa una fila por mes, semestre o ciclo. Esta carga se guarda aparte de las respuestas: ningún periodo contará como persona.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto] lg:items-end">
        <label className="text-sm font-medium text-strong">Cliente
          <select value={tenantId} onChange={(event) => { setTenantId(event.target.value); setStudyId(""); setResult(null); }} className={`${inputClass} mt-1`}>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-strong">Estudio
          <select value={studyId} onChange={(event) => { setStudyId(event.target.value); setResult(null); }} className={`${inputClass} mt-1`}>
            <option value="">Selecciona un estudio…</option>
            {tenantStudies.map((study) => <option key={study.id} value={study.id}>{study.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-strong">Archivo CSV o Excel
          <input type="file" accept=".csv,.txt,.xlsx,.xlsm" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setResult(null); setConfirmed(false); }} className={`${inputClass} mt-1`} />
        </label>
        <button type="button" onClick={analyze} disabled={pending || !tenantId || !studyId || !file} className={buttonClass}>{pending ? "Revisando…" : "Revisar serie"}</button>
      </div>

      {result?.status === "error" ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger-line bg-danger-surface p-4 text-sm text-danger">
          <p className="font-medium">{result.message}</p>
          {result.errors?.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{result.errors.slice(0, 50).map((error, index) => <li key={index}>{error.row ? `Fila ${error.row}: ` : ""}{error.message}</li>)}</ul> : null}
        </div>
      ) : result?.status === "ready" ? (
        <div className="mt-5 rounded-xl border border-positive-line bg-positive-surface p-4">
          <p className="font-semibold text-positive">{result.points.length} periodos listos</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead><tr className="text-muted"><th className="py-2">Periodo</th><th>Inicio</th><th>Nuevos</th><th>Final</th><th>Perdidos</th><th>Retención</th><th>Deserción</th></tr></thead>
              <tbody>{result.points.map((point) => <tr key={point.periodOrder} className="border-t border-positive-line text-strong"><td className="py-2 font-medium">{point.periodLabel}</td><td>{point.startingMembers}</td><td>{point.newMembers}</td><td>{point.endingMembers}</td><td>{point.lostMembers}</td><td>{point.retention}%</td><td>{point.churn}%</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-2 text-sm text-body"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />Revisé los periodos y los conteos calculados.</label>
            <button type="button" onClick={save} disabled={pending || !confirmed} className={buttonClass}>{pending ? "Guardando…" : "Confirmar y guardar serie"}</button>
          </div>
        </div>
      ) : result?.status === "success" ? (
        <p role="status" className="mt-4 rounded-lg border border-positive-line bg-positive-surface p-4 text-sm font-medium text-positive">{result.message} {result.periods} periodos quedaron disponibles en la vista del estudio.</p>
      ) : null}
    </section>
  );
}

