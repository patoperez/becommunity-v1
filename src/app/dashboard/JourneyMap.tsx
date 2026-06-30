"use client";

import { useMemo, useState } from "react";
import { computeStageMetric, type LongRow, type StageMetric } from "@/lib/calc/engine";
import type { JourneyStage } from "@/lib/calc/journey";

function headline(m: StageMetric): string {
  if (m.value == null) return "—";
  if (m.unit === "nps") return String(m.value);
  if (m.unit === "percent") return `${m.value}%`;
  return m.value.toFixed(1);
}

function kindLabel(m: StageMetric): string {
  if (m.value == null) return "sin datos";
  if (m.kind === "nps") return "NPS";
  if (m.kind === "csat") return "Promedio";
  return "Promedio";
}

/**
 * Data-driven journey map (§8). Stages come entirely from the study's
 * journey_definition — there are no hardcoded stages. Hovering (or focusing /
 * tapping) a stage reveals that stage's real metrics, computed from THIS study's
 * data via the engine ("conectado a datos", §8.2).
 */
export default function JourneyMap({
  stages,
  rows,
}: {
  stages: JourneyStage[];
  rows: LongRow[];
}) {
  const stageMetrics = useMemo(
    () => stages.map((s) => ({ stage: s, metric: computeStageMetric(rows, s.metric) })),
    [stages, rows],
  );

  const [active, setActive] = useState(0);
  const current = stageMetrics[active];

  if (stages.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Journey map</h4>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Pasa el cursor por cada etapa para ver sus métricas reales.
      </p>

      {/* Stepper — rendered entirely from journey_definition */}
      <div className="mt-4 flex items-start gap-1 overflow-x-auto pb-2">
        {stageMetrics.map(({ stage, metric }, i) => {
          const isActive = i === active;
          const hasData = metric.value != null;
          return (
            <button
              key={stage.id}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-pressed={isActive}
              className="group flex min-w-[110px] flex-1 flex-col items-center text-center outline-none"
            >
              {/* connector + node */}
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : "bg-zinc-200 dark:bg-zinc-700"}`}
                />
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                    isActive
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-500 group-hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={`h-0.5 flex-1 ${i === stageMetrics.length - 1 ? "opacity-0" : "bg-zinc-200 dark:bg-zinc-700"}`}
                />
              </div>

              <span className="mt-1.5 px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                {stage.label}
              </span>
              <span
                className={`mt-0.5 text-lg font-semibold ${
                  hasData ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-600"
                }`}
              >
                {headline(metric)}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-zinc-400">{kindLabel(metric)}</span>
            </button>
          );
        })}
      </div>

      {/* Detail panel for the active stage (the hover read-out) */}
      {current ? (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{current.stage.label}</p>
              <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{current.stage.metric}</p>
            </div>
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {headline(current.metric)}
              <span className="ml-1 text-xs font-normal text-zinc-500">{kindLabel(current.metric)}</span>
            </p>
          </div>

          {current.stage.description ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{current.stage.description}</p>
          ) : null}

          {current.metric.value == null ? (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Esta etapa todavía no tiene datos en este estudio.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">Respuestas</p>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">n = {current.metric.n}</p>
              </div>
              {current.metric.detail.map((d) => (
                <div key={d.label}>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">{d.label}</p>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{d.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
