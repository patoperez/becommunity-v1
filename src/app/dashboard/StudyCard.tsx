import type { LongRow, StudyMetrics } from "@/lib/calc/engine";
import type { PivotAllowlist } from "@/lib/calc/pivot";
import type { JourneyStage } from "@/lib/calc/journey";
import { formatScore } from "@/lib/calc/format";
import PivotExplorer from "./PivotExplorer";
import JourneyMap from "./JourneyMap";

type Study = { id: string; name: string; period: string | null; status: string };

// Single shared policy: values arrive pre-rounded from the calc layer; this
// formats only (docs/CALCULATION_POLICY.md §4).
const fmt = formatScore;

function label(metricKey: string): string {
  return metricKey.replace(/_/g, " ");
}

function Tile({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}

export default function StudyCard({
  study,
  metrics,
  rows,
  allowlist,
  journeyStages,
}: {
  study: Study;
  metrics: StudyMetrics;
  rows: LongRow[];
  allowlist: PivotAllowlist;
  journeyStages: JourneyStage[];
}) {
  const empty = metrics.respondents === 0;
  const canPivot = rows.length > 0 && allowlist.dimensions.length > 0 && allowlist.metrics.length > 0;
  const hasJourney = journeyStages.length > 0 && rows.length > 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{study.name}</h3>
          {study.period ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{study.period}</p>
          ) : null}
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {study.status}
        </span>
      </div>

      {empty ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Este estudio todavía no tiene datos cargados.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {/* Data-connected journey map (§8), rendered from journey_definition */}
          {hasJourney ? <JourneyMap stages={journeyStages} rows={rows} /> : null}

          {/* Headline tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile title="Encuestados" value={String(metrics.respondents)} />
            {metrics.nps ? (
              <Tile
                title="NPS"
                value={String(metrics.nps.nps)}
                sub={`${metrics.nps.promoters} prom · ${metrics.nps.detractors} detr · n=${metrics.nps.total}`}
              />
            ) : null}
            {metrics.csat.map((c) => (
              <Tile
                key={c.metric_key}
                title={`CSAT ${label(c.metric_key)}`}
                value={`${c.result.csat}%`}
                sub={`Top-box ≥${c.result.satisfiedMin} · ${c.result.satisfied}/${c.result.total}`}
              />
            ))}
          </div>

          {/* Averages */}
          {metrics.averages.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Promedios</h4>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {metrics.averages.map((a) => (
                  <Tile key={a.metric_key} title={label(a.metric_key)} value={fmt(a.average)} sub={`n=${a.n}`} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Cross by segment (§5.2 example) */}
          {metrics.crossSegment && metrics.crosses.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Cruce por <span className="font-mono">{metrics.crossSegment}</span>
              </h4>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                {metrics.crosses.map((cross) => (
                  <div key={cross.metric_key} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <div className="bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                      {label(cross.metric_key)} (promedio)
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {cross.rows.map((row) => (
                          <tr key={row.segment} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{row.segment}</td>
                            <td className="px-3 py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-50">{fmt(row.average)}</td>
                            <td className="px-3 py-1.5 text-right text-xs text-zinc-400">n={row.n}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Interactive dynamic cross-tabulation (§5.3) */}
          {canPivot ? <PivotExplorer rows={rows} allowlist={allowlist} /> : null}
        </div>
      )}
    </section>
  );
}
