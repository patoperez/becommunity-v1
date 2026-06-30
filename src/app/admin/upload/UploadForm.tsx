"use client";

import { useActionState } from "react";
import { ingestStudyFile, type IngestState } from "./actions";

const initialState: IngestState = { status: "idle" };

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function UploadForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(ingestStudyFile, initialState);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tenant_id" className={labelClass}>Cliente (tenant)</label>
          <select id="tenant_id" name="tenant_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Selecciona un cliente…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="study_name" className={labelClass}>Nombre del estudio</label>
            <input id="study_name" name="study_name" required placeholder="Satisfacción 2026" className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="period" className={labelClass}>Periodo (opcional)</label>
            <input id="period" name="period" placeholder="2026" className={inputClass} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="required_columns" className={labelClass}>
            Columnas obligatorias (opcional, separadas por coma)
          </label>
          <input id="required_columns" name="required_columns" placeholder="seg_nivel, seg_grupo" className={inputClass} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className={labelClass}>Archivo (CSV o XLSX)</label>
          <input id="file" name="file" type="file" accept=".csv,.txt,.xlsx,.xlsm" required className={inputClass} />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? "Procesando…" : "Cargar y validar"}
        </button>

        {state.status === "success" && state.summary ? (
          <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
            <p className="font-medium">{state.message}</p>
            <p className="mt-1">
              Encuestados: {state.summary.respondents} · Respuestas cuantitativas: {state.summary.quant} · Observaciones cualitativas: {state.summary.qual}
            </p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <p className="font-medium">{state.message}</p>
            {state.errors && state.errors.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {state.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    {e.row ? `Fila ${e.row}` : "Archivo"}
                    {e.column ? ` · columna '${e.column}'` : ""}: {e.message}
                  </li>
                ))}
                {state.errors.length > 50 ? <li>… y {state.errors.length - 50} más.</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Formato del archivo</h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Una fila por encuestado. Las columnas se mapean al modelo canónico por su prefijo:
        </p>
        <ul className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-400">
          <li><code className="font-mono text-zinc-900 dark:text-zinc-100">seg_&lt;clave&gt;</code> → segmento (p. ej. <code>seg_nivel</code>, <code>seg_genero</code>)</li>
          <li><code className="font-mono text-zinc-900 dark:text-zinc-100">q_&lt;métrica&gt;</code> → respuesta numérica (p. ej. <code>q_nps</code>, <code>q_sat_maestros</code>)</li>
          <li><code className="font-mono text-zinc-900 dark:text-zinc-100">qual_&lt;tema&gt;</code> → observación cualitativa (texto)</li>
          <li><code className="font-mono text-zinc-900 dark:text-zinc-100">source</code> → fuente de lo cualitativo (opcional; por defecto <code>encuesta</code>)</li>
        </ul>
        <p className="mt-3 text-zinc-500 dark:text-zinc-500">
          Los valores de <code>q_*</code> deben ser números (decimales con punto). Las celdas vacías se omiten.
        </p>
      </section>
    </div>
  );
}
