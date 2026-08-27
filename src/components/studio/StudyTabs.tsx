import Link from "next/link";
import type { StudioStudyWorkspace } from "@/lib/studio/study-workspace";
import {
  studioStudy,
  studioStudyData,
  studioStudyIndicators,
  studioStudyInterpretation,
  studioStudyPreview,
  studioStudyPublish,
  studioStudyQualitative,
} from "@/lib/studio/routes";

/**
 * The consultant's process, in order, doubling as the progress indicator.
 *
 * Each step says where it stands in one word, so "where is this study" is
 * answered by looking rather than by opening five screens. The words are
 * derived from real counts — never from a stored progress flag, which nothing
 * in the schema maintains and which would therefore lie the first time somebody
 * imported a file from another surface.
 */

export type StudyTabId =
  | "resumen"
  | "datos"
  | "indicadores"
  | "cualitativo"
  | "interpretacion"
  | "vista-cliente"
  | "publicar";

type Step = { id: StudyTabId; label: string; href: string; state: string; tone: "done" | "todo" | "quiet" };

export function studySteps(workspace: StudioStudyWorkspace): Step[] {
  const { study, counts, readiness } = workspace;
  const hasData = counts.quantResponses > 0 || counts.confirmedObservations > 0;
  return [
    {
      id: "resumen",
      label: "Resumen",
      href: studioStudy(study.id),
      state: readiness.blocking.length > 0 ? "con bloqueos" : "al día",
      tone: readiness.blocking.length > 0 ? "todo" : "done",
    },
    {
      id: "datos",
      label: "Datos",
      href: studioStudyData(study.id),
      state: hasData
        ? counts.unfinishedImports > 0
          ? "una carga a medias"
          : `${counts.respondents} personas`
        : "sin datos",
      tone: hasData && counts.unfinishedImports === 0 ? "done" : "todo",
    },
    {
      id: "indicadores",
      label: "Resultados y recorrido",
      href: studioStudyIndicators(study.id),
      state: study.stages.length === 0 ? "sin recorrido" : `${study.stages.length} momentos`,
      tone: study.stages.length === 0 ? "quiet" : "done",
    },
    {
      id: "cualitativo",
      label: "Lo que dijeron",
      href: studioStudyQualitative(study.id),
      state:
        counts.pendingObservations > 0
          ? `${counts.pendingObservations} por revisar`
          : counts.confirmedObservations > 0
            ? `${counts.confirmedObservations} confirmados`
            : "sin comentarios",
      tone:
        counts.pendingObservations > 0
          ? "todo"
          : counts.confirmedObservations > 0
            ? "done"
            : "quiet",
    },
    {
      id: "interpretacion",
      label: "Lectura del equipo",
      href: studioStudyInterpretation(study.id),
      state: "redactar y revisar",
      tone: "quiet",
    },
    {
      id: "vista-cliente",
      label: "Vista del cliente",
      href: studioStudyPreview(study.id),
      state: "revisar antes de publicar",
      tone: "quiet",
    },
    {
      id: "publicar",
      label: "Publicación",
      href: studioStudyPublish(study.id),
      state:
        study.status === "published"
          ? "publicado"
          : study.status === "archived"
            ? "archivado"
            : "borrador",
      tone: study.status === "published" ? "done" : "todo",
    },
  ];
}

const TONE: Record<Step["tone"], string> = {
  done: "text-positive",
  todo: "text-caution",
  quiet: "text-muted",
};

export function StudyTabs({
  workspace,
  current,
}: {
  workspace: StudioStudyWorkspace;
  current: StudyTabId;
}) {
  return (
    <nav aria-label="Pasos del estudio" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 px-1">
        {studySteps(workspace).map((step) => {
          const active = step.id === current;
          return (
            <li key={step.id}>
              <Link
                href={step.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-col justify-center rounded-lg border px-3.5 py-2 transition-colors duration-[var(--motion-state)] ${
                  active
                    ? "border-evidence-line bg-evidence-surface"
                    : "border-line bg-surface hover:bg-surface-sunken"
                }`}
              >
                <span className="text-sm font-semibold text-strong">{step.label}</span>
                <span className={`text-xs ${TONE[step.tone]}`}>{step.state}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
