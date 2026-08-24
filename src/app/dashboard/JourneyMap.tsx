"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SafeJourneyStage } from "@/lib/dashboard/view";
import { SampleContext, MethodDisclosure } from "@/components/SampleContext";
import { domainFor } from "@/components/evidence/ScaleMark";
import { unitLabel } from "@/lib/language/results";
import { sampleCopy } from "@/lib/language/sample";
import QualitativeInsights from "./QualitativeInsights";

/**
 * The experience map — the first proof of the Interactive Insight Experience.
 *
 * What changed from the stepper it replaces:
 *  - it is a route, not a numbered sequence. The number under each touchpoint is
 *    its own result, never its position in a list;
 *  - every touchpoint carries its score, which is the method this has to serve;
 *  - selection works by click, tap, arrow key and tab — the old component told
 *    the reader to "pasa el cursor", which means nothing on a phone;
 *  - evidence state is carried by SHAPE (solid / half / hollow-dashed) as well
 *    as colour, so the map survives a colour-blind reader and a grayscale print;
 *  - selecting a touchpoint updates its number, its plain-language base, its
 *    calculated breakdown and what people said there, together;
 *  - the three kinds of content are labelled for what they are: calculated
 *    evidence, the consultant's reading, and the opportunity. Where the product
 *    holds no reading yet, it says so instead of leaving a gap.
 *
 * It computes nothing. Every number here was calculated server-side and arrived
 * already rounded and already suppression-checked.
 */

type EvidenceState = "measured" | "thin" | "hidden" | "absent";

function evidenceState(stage: SafeJourneyStage): EvidenceState {
  if (stage.visibility === "suppressed") return "hidden";
  if (stage.value == null) return "absent";
  return stage.visibility === "caution" ? "thin" : "measured";
}

const STATE_WORD: Record<EvidenceState, string> = {
  measured: "Con evidencia suficiente",
  thin: "Con poca evidencia",
  hidden: "Resultado protegido",
  absent: "Sin medición",
};

/** The node drawn on the route. Shape carries the state; colour only reinforces. */
function StageNode({ state, selected }: { state: EvidenceState; selected: boolean }) {
  const fill =
    state === "measured"
      ? "var(--study-accent)"
      : state === "thin"
        ? "var(--color-caution-line)"
        : "var(--color-surface)";
  const stroke =
    state === "measured"
      ? "var(--study-accent)"
      : state === "thin"
        ? "var(--color-caution)"
        : "var(--color-line-strong)";

  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {selected ? (
        <circle cx="14" cy="14" r="13" fill="none" stroke="var(--color-strong)" strokeWidth="2" />
      ) : null}
      <circle
        cx="14"
        cy="14"
        r="8"
        fill={fill}
        stroke={stroke}
        strokeWidth="2"
        strokeDasharray={state === "absent" || state === "hidden" ? "3 3" : undefined}
      />
      {/* A half-filled node reads as "partial evidence" without relying on hue. */}
      {state === "thin" ? (
        <path d="M14 6a8 8 0 0 1 0 16z" fill="var(--color-caution)" />
      ) : null}
    </svg>
  );
}

export default function JourneyMap({ stages }: { stages: SafeJourneyStage[] }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Derived during render rather than synced through an effect: if the stage
  // list shrinks under a filter, the selection clamps in the same pass instead
  // of causing a second, cascading render.
  const activeIndex = stages.length === 0 ? 0 : Math.min(active, stages.length - 1);
  const current = stages[activeIndex];

  // The lowest of the touchpoints that share a scale. A factual ordering of
  // numbers already computed — not a threshold and not an alert.
  const lowestId = useMemo(() => {
    const groups = new Map<string, SafeJourneyStage[]>();
    for (const stage of stages) {
      if (stage.numeric == null) continue;
      groups.set(stage.unit, [...(groups.get(stage.unit) ?? []), stage]);
    }
    let best: SafeJourneyStage[] = [];
    for (const group of groups.values()) if (group.length > best.length) best = group;
    if (best.length < 2) return null;
    return best.reduce((low, stage) =>
      (stage.numeric as number) < (low.numeric as number) ? stage : low,
    ).id;
  }, [stages]);

  const move = useCallback(
    (next: number) => {
      const index = (next + stages.length) % stages.length;
      setActive(index);
      buttons.current[index]?.focus();
    },
    [stages.length],
  );

  if (stages.length === 0) return null;

  const measured = stages.filter((stage) => stage.value != null).length;

  return (
    <section
      aria-labelledby="recorrido-titulo"
      className="rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-evidence">
            Recorrido
          </p>
          <h4 id="recorrido-titulo" className="mt-1.5 text-xl">
            ¿Cómo se vive cada momento?
          </h4>
        </div>
        <p className="text-sm text-muted">
          {measured === stages.length
            ? `${stages.length} momentos, todos con resultado`
            : `${measured} de ${stages.length} momentos tienen resultado`}
        </p>
      </div>

      {/* The route. Horizontal on wide screens, a vertical trajectory on a
          phone — the same component, not a strip the reader has to drag. */}
      <div
        role="group"
        aria-label="Momentos del recorrido"
        className="relative mt-6 flex flex-col gap-1 md:flex-row md:items-stretch md:gap-0"
      >
        {stages.map((stage, index) => {
          const state = evidenceState(stage);
          const selected = index === activeIndex;
          const isLowest = stage.id === lowestId;
          return (
            <button
              key={stage.id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(index + 1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  move(index - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  move(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  move(stages.length - 1);
                }
              }}
              className={`group relative flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-[var(--motion-state)] md:flex-col md:items-center md:gap-0 md:px-1.5 md:text-center ${
                selected ? "bg-surface-sunken" : "hover:bg-surface-sunken/60"
              }`}
            >
              {/* The connecting route: a segment on each side of the node, drawn
                  vertically on a phone and horizontally on a wide screen. */}
              <span
                aria-hidden="true"
                className="absolute left-[1.42rem] top-0 h-full w-0.5 md:left-0 md:top-[calc(0.625rem+13px)] md:h-0.5 md:w-full"
              >
                <span
                  className={`absolute inset-x-0 top-0 h-1/2 bg-line-strong md:inset-y-0 md:left-0 md:h-full md:w-1/2 ${
                    index === 0 ? "opacity-0" : ""
                  }`}
                />
                <span
                  className={`absolute inset-x-0 bottom-0 h-1/2 bg-line-strong md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-1/2 ${
                    index === stages.length - 1 ? "opacity-0" : ""
                  }`}
                />
              </span>

              <span className="relative z-10 rounded-full bg-surface md:mb-2">
                <StageNode state={state} selected={selected} />
              </span>

              <span className="relative z-10 flex min-w-0 flex-1 flex-col md:w-full md:flex-none">
                <span className="truncate text-sm font-semibold text-strong md:whitespace-normal">
                  {stage.label}
                </span>
                <span className="tabular font-display text-2xl font-semibold leading-tight text-strong">
                  {stage.value ?? "—"}
                </span>
                <span className="text-xs text-muted">
                  {stage.value == null
                    ? STATE_WORD[state]
                    : `${unitLabel(stage.unit)}${domainFor(stage.unit) ? ` · ${domainFor(stage.unit)?.label}` : ""}`}
                </span>
                {isLowest ? (
                  <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full border border-caution-line bg-caution-surface px-2 py-0.5 text-[0.7rem] font-semibold text-caution md:self-center">
                    <span aria-hidden="true">▼</span> El más bajo
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {current ? <StageDetail stage={current} isLowest={current.id === lowestId} /> : null}
    </section>
  );
}

function StageDetail({ stage, isLowest }: { stage: SafeJourneyStage; isLowest: boolean }) {
  const state = evidenceState(stage);
  const domain = domainFor(stage.unit);
  const copy = sampleCopy(stage.visibility, stage.n, "people");

  return (
    <div
      // Announcing the change means a screen-reader user gets the same
      // "everything updated together" experience a sighted reader gets.
      aria-live="polite"
      className="mt-5 rounded-xl border border-line bg-surface-page p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h5 className="text-lg">{stage.label}</h5>
          {stage.description ? (
            <p className="mt-1 max-w-prose text-sm text-muted">{stage.description}</p>
          ) : null}
        </div>
        <p className="tabular font-display text-4xl font-semibold leading-none text-strong">
          {stage.value ?? "—"}
        </p>
      </div>

      {/* 1 — Calculated evidence. */}
      <section className="mt-5">
        <h6 className="text-xs font-semibold uppercase tracking-[0.12em] text-evidence">
          Lo que dicen los números
        </h6>

        {state === "absent" ? (
          <p className="mt-2 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm text-muted">
            Este momento todavía no tiene resultados en el estudio. Puede ser que
            no se haya preguntado por él, o que nadie lo haya contestado aún.
          </p>
        ) : state === "hidden" ? (
          <p className="mt-2 rounded-lg border border-caution-line bg-caution-surface px-3.5 py-3 text-sm text-caution">
            {copy.headline}. {copy.detail}
          </p>
        ) : (
          <>
            <div className="mt-2.5">
              <SampleContext
                visibility={stage.visibility}
                count={stage.n}
                detail={stage.visibility === "caution"}
              />
            </div>
            {stage.detail.length > 0 ? (
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                {stage.detail.map((item) => (
                  <div key={item.label}>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      {item.label}
                    </dt>
                    <dd className="tabular text-base font-semibold text-strong">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <MethodDisclosure summary="Cómo se lee este número">
              <p>
                Se expresa como {unitLabel(stage.unit)}
                {domain ? ` (${domain.label})` : ", en la escala que usa el instrumento de tu comunidad"}.
              </p>
              <p className="mt-1.5">{copy.methodology}</p>
              {isLowest ? (
                <p className="mt-1.5">
                  Es el más bajo entre los momentos que se miden en esta misma
                  escala. Que sea el más bajo no significa por sí solo que esté
                  mal: esa lectura la hace el equipo de Be Community.
                </p>
              ) : null}
            </MethodDisclosure>
          </>
        )}
      </section>

      {/* 2 — What people said there. */}
      <section className="mt-5 border-t border-line pt-4">
        <h6 className="text-xs font-semibold uppercase tracking-[0.12em] text-voice">
          Lo que dijeron las personas aquí
        </h6>
        <QualitativeInsights summary={stage.qualitative} compact />
      </section>

      {/* 3 — The consultant's reading, and the opportunity. Both are honest
             placeholders: the product holds no field for them yet, and P8-A
             adds no migration. What it will contain is stated, so the absence
             is a state rather than a gap. */}
      <section className="mt-5 border-t border-line pt-4">
        <h6 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          Lectura del consultor
        </h6>
        <p className="mt-2 rounded-lg border border-dashed border-line-strong bg-surface px-3.5 py-3 text-sm text-muted">
          Todavía no hay una lectura publicada para este momento. Aquí aparecerá
          lo que el equipo de Be Community concluye a partir de la evidencia de
          arriba, y la oportunidad concreta que propone atender.
        </p>
      </section>
    </div>
  );
}
