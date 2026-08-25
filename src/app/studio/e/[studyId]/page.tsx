import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { studySteps } from "@/components/studio/StudyTabs";
import { Forward } from "@/components/Actions";
import type { ReadinessItem } from "@/lib/studio/readiness";

export const metadata = { title: "Estudio · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

/**
 * One study — the work surface.
 *
 * It answers the four questions the information architecture asks of this
 * screen: what this study is, what state it is in, what is stopping the next
 * step, and what the next action is. The readiness panel separates BLOQUEA from
 * MEJORA, because a product that calls everything a blocker teaches its
 * operator to click past blockers.
 */
export default async function StudioStudyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const query = await searchParams;
  const { readiness, counts, study } = workspace;
  const steps = studySteps(workspace);
  const next =
    readiness.blocking.length > 0
      ? steps.find((step) => step.id === "datos")
      : counts.pendingObservations > 0
        ? steps.find((step) => step.id === "cualitativo")
        : study.status === "published"
          ? steps.find((step) => step.id === "vista-cliente")
          : steps.find((step) => step.id === "vista-cliente");

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="resumen"
      userEmail={user.email ?? ""}
      title={study.name}
      lead={readiness.summary}
      ok={query.ok}
      error={query.error}
    >
      <section aria-labelledby="resumen-estado" className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 id="resumen-estado" className="text-base font-semibold text-strong">
            ¿Cómo está el estudio?
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              ["Personas que respondieron", counts.respondents],
              ["Resultados numéricos", counts.quantResponses],
              ["Comentarios confirmados", counts.confirmedObservations],
              ["Comentarios por revisar", counts.pendingObservations],
              ["Cargas de datos", counts.importBatches],
              ["Momentos del recorrido", study.stages.length],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-muted">{label}</dt>
                <dd className="tabular font-display text-xl font-semibold text-strong">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-base font-semibold text-strong">¿Qué sigue?</h2>
          <p className="mt-1 text-sm text-body">{readiness.summary}</p>
          {next ? (
            <Link
              href={next.href}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]"
            >
              {next.label} <Forward />
            </Link>
          ) : null}
        </div>
      </section>

      <ReadinessGroup
        id="bloqueos"
        title="Impide seguir"
        empty="Nada impide publicarlo."
        tone="blocking"
        items={readiness.blocking}
      />
      <ReadinessGroup
        id="mejoras"
        title="Se puede mejorar"
        empty="No hay mejoras pendientes que el producto pueda detectar."
        tone="improvement"
        items={readiness.improvements}
      />
      <ReadinessGroup
        id="listo"
        title="Ya está resuelto"
        empty="Todavía no hay nada resuelto en este estudio."
        tone="done"
        items={readiness.done}
      />
    </StudyWorkSurface>
  );
}

const GROUP_TONE = {
  blocking: "border-danger-line bg-danger-surface",
  improvement: "border-caution-line bg-caution-surface",
  done: "border-positive-line bg-positive-surface",
} as const;

const GROUP_TEXT = {
  blocking: "text-danger",
  improvement: "text-caution",
  done: "text-positive",
} as const;

function ReadinessGroup({
  id,
  title,
  empty,
  tone,
  items,
}: {
  id: string;
  title: string;
  empty: string;
  tone: keyof typeof GROUP_TONE;
  items: ReadinessItem[];
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold text-strong">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2.5 space-y-2.5">
          {items.map((item) => (
            <li key={item.id} className={`rounded-xl border p-4 ${GROUP_TONE[tone]}`}>
              <p className={`text-sm font-semibold ${GROUP_TEXT[tone]}`}>{item.label}</p>
              <p className="mt-1 text-sm text-body">{item.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
