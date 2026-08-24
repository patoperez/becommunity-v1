"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { SafeJourneyStage } from "@/lib/dashboard/view";
import type { Audience } from "@/lib/dashboard/audience";
import { SampleContext, MethodDisclosure } from "@/components/SampleContext";
import { domainFor } from "@/components/evidence/ScaleMark";
import { categoryAccent } from "@/lib/brand/categories";
import { unitLabel } from "@/lib/language/results";
import { sampleCopy } from "@/lib/language/sample";
import QualitativeInsights from "./QualitativeInsights";

/**
 * The experience map — the route itself carries the information.
 *
 * The route is one drawn trajectory, not a row of tiles: a single SVG spine
 * connects the touchpoints, each touchpoint owns a category colour from the
 * identity, and selection moves along it. Colour here means IDENTITY, never
 * verdict — the third stage is green because it is the third stage. Whether a
 * number is good is a judgement the product is not entitled to make, and the
 * semantic caution tokens stay reserved for the one thing it can prove: how
 * much evidence sits behind the number.
 *
 * Evidence strength is carried by SHAPE as well as colour — solid, half,
 * hollow-dashed — so the map survives a colour-blind reader and a grayscale
 * print.
 *
 * Selecting a touchpoint updates ONE compact evidence area: the number, the
 * plain-language base, the breakdown and, when they exist, the voices. Sections
 * that would be empty are omitted rather than rendered as placeholder boxes.
 *
 * It computes nothing. Every number arrived already rounded and already
 * suppression-checked.
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

/**
 * The node on the route.
 *
 * Fill = the touchpoint's own category colour (identity).
 * Shape = how much evidence is behind it (a claim the product can prove).
 */
function StageNode({
  state,
  selected,
  fill,
}: {
  state: EvidenceState;
  selected: boolean;
  fill: string;
}) {
  const hasEvidence = state === "measured" || state === "thin";
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {selected ? (
        <circle cx="17" cy="17" r="15.5" fill="none" stroke={fill} strokeWidth="2.5" />
      ) : null}
      <circle cx="17" cy="17" r="10" fill="var(--color-surface)" />
      <circle
        cx="17"
        cy="17"
        r="10"
        fill={hasEvidence ? fill : "none"}
        fillOpacity={state === "thin" ? 0.28 : 1}
        stroke={hasEvidence ? fill : "var(--color-line-strong)"}
        strokeWidth="2.5"
        strokeDasharray={hasEvidence ? undefined : "3 3"}
      />
      {/* A half-filled node reads as "partial evidence" without relying on hue. */}
      {state === "thin" ? <path d="M17 7a10 10 0 0 1 0 20z" fill={fill} /> : null}
    </svg>
  );
}

export default function JourneyMap({
  stages,
  audience = "client",
}: {
  stages: SafeJourneyStage[];
  audience?: Audience;
}) {
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
  const accent = categoryAccent(activeIndex);

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

      {/* The route: one continuous spine, drawn behind the touchpoints.
          Horizontal on a wide screen, vertical on a phone — the same component
          reflowing, never a strip the reader has to drag. */}
      <div
        role="group"
        aria-label="Momentos del recorrido"
        className="relative mt-6 flex flex-col md:flex-row md:items-stretch"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[1.68rem] top-6 bottom-6 w-[3px] rounded-full bg-surface-sunken md:left-[8%] md:right-[8%] md:top-[1.55rem] md:bottom-auto md:h-[3px] md:w-auto"
        />

        {stages.map((stage, index) => {
          const state = evidenceState(stage);
          const selected = index === activeIndex;
          const isLowest = stage.id === lowestId;
          const tone = categoryAccent(index);
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
              className={`group relative z-10 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left transition-colors duration-[var(--motion-state)] md:flex-col md:items-center md:gap-0 md:px-2 md:py-3 md:text-center ${
                selected ? "shadow-raised" : "border-transparent hover:bg-surface-sunken/60"
              }`}
              style={
                selected
                  ? { backgroundColor: tone.surface, borderColor: tone.line }
                  : undefined
              }
            >
              <span className="relative z-10 rounded-full bg-surface md:mb-2">
                <StageNode state={state} selected={selected} fill={tone.fill} />
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
                  <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full border border-line bg-surface px-2 py-0.5 text-[0.7rem] font-semibold text-muted md:self-center">
                    <span aria-hidden="true">▼</span> El más bajo
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {current ? (
        <StageDetail
          stage={current}
          isLowest={current.id === lowestId}
          audience={audience}
          accentLine={accent.line}
          accentSurface={accent.surface}
        />
      ) : null}
    </section>
  );
}

function StageDetail({
  stage,
  isLowest,
  audience,
  accentLine,
  accentSurface,
}: {
  stage: SafeJourneyStage;
  isLowest: boolean;
  audience: Audience;
  accentLine: string;
  accentSurface: string;
}) {
  const state = evidenceState(stage);
  const domain = domainFor(stage.unit);
  const copy = sampleCopy(stage.visibility, stage.n, "people");
  const hasVoices =
    stage.qualitative.themes.length > 0 ||
    stage.qualitative.quotes.length > 0 ||
    stage.qualitative.hasSuppressedThemes;

  return (
    <div
      // Announcing the change means a screen-reader user gets the same
      // "everything updated together" experience a sighted reader gets.
      aria-live="polite"
      className="mt-5 overflow-hidden rounded-xl border"
      style={{ borderColor: accentLine, backgroundColor: accentSurface }}
    >
      {/* ONE compact evidence area, not three document-sized boxes. */}
      <div className="grid gap-x-8 gap-y-4 p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h5 className="text-lg">{stage.label}</h5>
            <p className="tabular font-display text-3xl font-semibold leading-none text-strong">
              {stage.value ?? "—"}
            </p>
          </div>
          {stage.description ? (
            <p className="mt-1.5 max-w-prose text-sm text-muted">{stage.description}</p>
          ) : null}

          {state === "absent" ? (
            <p className="mt-3 text-sm text-muted">
              Este momento todavía no tiene resultados en el estudio.
            </p>
          ) : state === "hidden" ? (
            <p className="mt-3 text-sm text-caution">
              {copy.headline}. {copy.detail}
            </p>
          ) : (
            <>
              <div className="mt-3">
                <SampleContext
                  visibility={stage.visibility}
                  count={stage.n}
                  detail={stage.visibility === "caution"}
                />
              </div>
              {stage.detail.length > 0 ? (
                <dl className="mt-3 flex flex-wrap gap-x-7 gap-y-2">
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
                  {domain
                    ? ` (${domain.label})`
                    : ", en la escala que usa el instrumento de tu comunidad"}
                  .
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
        </div>

        {/*
          Voices only when there is something approved to show. A published
          study says nothing at all where a moment carries numbers only: an
          explanation of what was not published is internal information, and it
          appears in the preview instead.
        */}
        <div className="min-w-0">
          {hasVoices ? (
            <>
              <h6 className="text-xs font-semibold uppercase tracking-[0.12em] text-voice">
                Lo que dijeron las personas aquí
              </h6>
              <QualitativeInsights summary={stage.qualitative} compact audience={audience} />
            </>
          ) : audience === "preview" ? (
            <QualitativeInsights summary={stage.qualitative} compact audience={audience} />
          ) : null}
        </div>
      </div>

      {/*
        Internal readiness, marked as internal. The client's view never carries
        it — a published study is a composed piece of work, not a list of what
        the consultancy has not finished.
      */}
      {audience === "preview" ? (
        <p className="border-t border-caution-line bg-caution-surface px-5 py-2.5 text-xs text-caution">
          <span className="font-semibold">Sólo para el equipo:</span> este momento
          {hasVoices ? "" : " no tiene comentarios aprobados y"} todavía no puede
          llevar una lectura del consultor publicada.
        </p>
      ) : null}
    </div>
  );
}
