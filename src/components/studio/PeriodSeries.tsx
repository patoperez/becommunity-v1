import type { PeriodPoint } from "@/lib/ingestion/period-series";

export function PeriodSeries({ points }: { points: PeriodPoint[] }) {
  if (points.length === 0) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="period-series-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-evidence">Evolución</p>
          <h4 id="period-series-title" className="mt-1 text-xl">Retención y deserción</h4>
        </div>
        <p className="text-sm text-muted">{points.length} periodos comparables</p>
      </div>
      <div className="mt-5 overflow-x-auto pb-2">
        <div className="grid min-w-[34rem] gap-3" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(7rem, 1fr))` }}>
          {points.map((point) => (
            <article key={`${point.periodOrder}-${point.periodLabel}`} className="rounded-lg border border-line bg-surface-sunken p-3">
              <p className="text-xs font-semibold text-muted">{point.periodLabel}</p>
              <p className="mt-2 text-2xl font-semibold tabular text-positive">{point.retention}%</p>
              <p className="text-xs text-muted">retención</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
                <span className="block h-full bg-positive" style={{ width: `${point.retention}%` }} />
              </div>
              <p className="mt-3 text-base font-semibold tabular text-caution">{point.churn}%</p>
              <p className="text-xs text-muted">deserción</p>
            </article>
          ))}
        </div>
      </div>
      <details className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-strong">Cómo se calcula</summary>
        <p className="pb-2 text-sm text-muted">La retención descuenta las altas nuevas del cierre antes de compararlo con el inicio. La deserción divide las bajas entre las personas que iniciaron el periodo.</p>
      </details>
    </section>
  );
}

