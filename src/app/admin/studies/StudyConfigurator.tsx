"use client";

import Link from "next/link";
import type { JourneyStage } from "@/lib/calc/journey";
import type { DashboardSectionKey, DashboardSections } from "@/lib/dashboard/config";
import { updateStudyConfiguration } from "./actions";
import { studyStateLabel } from "@/lib/language/results";
import { JourneyStagesFields } from "@/components/studio/JourneyStagesFields";
import type { JourneyMetricOption } from "@/lib/studio/journey-picker";

type Study = { id: string; name: string; period: string | null; status: string };

const sectionLabels: Record<DashboardSectionKey, string> = {
  narrative: "Panorama narrativo",
  trends: "Tendencias históricas",
  filters: "Filtros interactivos",
  journey: "Journey map",
  qualitative: "Hallazgos cualitativos",
  metrics: "Indicadores y promedios",
  segments: "Cruces por segmento",
  pivot: "Explorador pivote",
  report: "Descarga de informe PDF",
};

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/**
 * Configuring one study.
 *
 * TWO THINGS CHANGED HERE, AND BOTH ARE ABOUT CONSEQUENCE.
 *
 * 1. THE RECORRIDO IS CHOSEN, NOT TYPED. The stage identifier and the canonical
 *    metric key used to be free text with the placeholder `metric_key`. They
 *    are now `JourneyStagesFields`, which offers the results this study
 *    genuinely produced and keeps every stage's stored id stable across a
 *    rename.
 *
 * 2. PUBLICATION LEFT THIS FORM. It used to be a `<select>` sitting between the
 *    study name and the section checkboxes, so "publicado · visible al cliente"
 *    could be chosen and saved without ever looking at what the client would
 *    see. The state now travels as a hidden field that this form cannot change,
 *    and changing it happens on the publication surface, which is reachable
 *    only through the client preview. The stored enum is unchanged.
 */
export default function StudyConfigurator({ study, sections, initialStages, metricOptions, previewHref, publishHref }: {
  study: Study;
  sections: DashboardSections;
  initialStages: JourneyStage[];
  /** The results this study produced, for the recorrido picker. */
  metricOptions: JourneyMetricOption[];
  previewHref: string;
  publishHref: string;
}) {
  return <details className="rounded-xl border border-line bg-surface p-5 open:shadow-raised">
    <summary className="min-h-11 cursor-pointer list-none">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-strong">{study.name}</p><p className="text-xs text-muted">{study.period ?? "Sin periodo"} · {initialStages.length} momentos</p></div><span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${study.status === "published" ? "border-positive-line bg-positive-surface text-positive" : study.status === "archived" ? "border-line bg-surface-sunken text-muted" : "border-caution-line bg-caution-surface text-caution"}`}>{studyStateLabel(study.status)}</span></div>
    </summary>
    <form action={updateStudyConfiguration} className="mt-5 space-y-7 border-t border-line pt-5">
      <input type="hidden" name="study_id" value={study.id} />
      {/*
        The stored enum, carried unchanged. This form can no longer move it:
        the value it submits is always the state the study already has, and the
        Server Action refuses anything else and says where to go instead.
      */}
      <input type="hidden" name="status" value={study.status} />

      <JourneyStagesFields
        initialStages={initialStages}
        options={metricOptions}
        submitLabel="Guardar configuración"
        submitClassName="min-h-11 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <section>
          <h3 className="text-sm font-semibold text-strong">Identidad</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className={input} name="name" required maxLength={200} defaultValue={study.name} aria-label="Nombre del estudio" />
            <input className={input} name="period" maxLength={100} defaultValue={study.period ?? ""} placeholder="Periodo" aria-label="Periodo del estudio" />
          </div>
        </section>

        <section className="rounded-xl border border-sky-line bg-sky-surface p-4">
          <h3 className="text-sm font-semibold text-strong">¿Quién lo ve ahora?</h3>
          <p className="mt-1 text-sm text-body">
            {study.status === "published"
              ? "Está publicado: el cliente lo ve tal como está."
              : study.status === "archived"
                ? "Está archivado: el cliente no lo ve."
                : "Es un borrador: solo lo ve el equipo interno."}
          </p>
          <p className="mt-1 text-xs text-muted">
            Publicar, despublicar o archivar se decide después de mirar la vista del cliente.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={previewHref} className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken">
              Ver como el cliente
            </Link>
            <Link href={publishHref} className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken">
              Decidir la publicación
            </Link>
          </div>
        </section>

        <section><h3 className="text-sm font-semibold text-strong">Secciones visibles</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(sectionLabels).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-page px-3 py-2 text-sm text-strong"><input type="checkbox" name={`section_${key}`} defaultChecked={sections[key as DashboardSectionKey]} />{label}</label>)}</div></section>
      </JourneyStagesFields>
    </form>
  </details>;
}
