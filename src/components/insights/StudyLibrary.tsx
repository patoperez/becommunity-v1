import Link from "next/link";
import type { StudyDashboardPayload } from "@/lib/dashboard/view";
import { resultLanguage, studyStateLabel } from "@/lib/language/results";
import { insightsStudyHref } from "@/lib/insights/filters";
import { Forward } from "@/components/Actions";

type Study = {
  id: string;
  name: string;
  period: string | null;
  status: string;
};

export function StudyLibrary({
  studies,
  currentId,
}: {
  studies: { study: Study; dashboard: StudyDashboardPayload }[];
  currentId: string | null;
}) {
  if (studies.length === 0) return null;

  return (
    <section aria-labelledby="biblioteca-estudios" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-evidence">
            Tus estudios
          </p>
          <h2 id="biblioteca-estudios" className="mt-1.5 text-2xl">
            Elige qué quieres explorar
          </h2>
        </div>
        <p className="text-sm text-muted">
          Cada estudio conserva sus filtros en el enlace y en el informe.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {studies.map(({ study, dashboard }) => {
          const headline = [...dashboard.view.tiles, ...dashboard.view.averages]
            .find((metric) => metric.key !== "respondents" && metric.value != null);
          const language = headline ? resultLanguage(headline.key, headline.title) : null;
          const current = study.id === currentId;
          return (
            <Link
              key={study.id}
              href={insightsStudyHref(study.id)}
              className="group flex min-h-44 min-w-0 flex-col justify-between rounded-xl border border-line bg-surface p-5 transition-[border-color,transform,box-shadow] duration-[var(--motion-state)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised motion-reduce:hover:translate-y-0"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {current ? (
                    <span className="rounded-full bg-evidence-surface px-2 py-1 font-semibold text-evidence">
                      Más reciente
                    </span>
                  ) : null}
                  {study.period ? <span>{study.period}</span> : null}
                  <span>{studyStateLabel(study.status)}</span>
                </div>
                <h3 className="mt-3 break-words text-lg">{study.name}</h3>
                {headline && language ? (
                  <p className="mt-3 text-sm text-muted">
                    {language.name}: <span className="tabular font-semibold text-strong">{headline.value}</span>
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-muted">Abre el estudio para ver su recorrido.</p>
                )}
              </div>
              <span className="mt-5 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-evidence">
                Abrir el estudio <Forward />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
