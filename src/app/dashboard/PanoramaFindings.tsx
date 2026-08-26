"use client";

import { useCallback, useRef, useState } from "react";
import type { SampleVisibility } from "@/lib/calc/disclosure";
import { ScaleMark, PeerMark, AbsentMark } from "@/components/evidence/ScaleMark";
import { MethodDisclosure, SampleContext } from "@/components/SampleContext";
import { Forward } from "@/components/Actions";
import { categoryAccent } from "@/lib/brand/categories";

/**
 * The panorama's findings: ONE dominant lead, plus a compact navigator for the
 * rest.
 *
 * What this replaces: four cards of equal weight, each repeating its own
 * "Cómo se calcula" block, its own call to action and its own note about the
 * consultant's reading. Four things shouted at the same volume is the same
 * failure as a tile wall — the reader is told everything matters equally, which
 * is exactly what a school director cannot use.
 *
 * The lead is not "the biggest number" and not "the worst number". It is the
 * FIRST finding in the order the view model already ranks results in
 * (recommendation, then satisfaction, then the rest, alphabetically inside each
 * group) — deterministic, and derived from configuration rather than from an
 * arbitrary comparison the product is not entitled to make.
 *
 * Selecting a secondary finding replaces the dominant block in place: value,
 * visual, sample context, method disclosure and action all change together.
 * There is one method disclosure — the active finding's — never five.
 *
 * Everything here is presentation. Every number arrived already computed,
 * already rounded and already suppression-checked.
 */

export type PanoramaFinding = {
  id: string;
  /** The short name the navigator shows. */
  label: string;
  /** The human question the finding answers. */
  question: string;
  /** The dominant value, already formatted. Null when there is no result. */
  value: string | null;
  /** What the value is called, under the number. */
  caption: string;
  /** Only a measure with a real domain may be drawn on an absolute scale. */
  unit: "nps" | "percent" | null;
  numeric: number | null;
  /** For a score: the range of its own comparable peers. */
  peer: { min: number; max: number } | null;
  /** The sentence under the visual explaining what the visual is. */
  scaleNote: string | null;
  /** Movement, or another one-line context sentence. */
  context: string | null;
  /** Human-authored consultant reading. P8.4 supplies storage and publishing. */
  interpretation: string | null;
  sample: { visibility: SampleVisibility; count: number | null } | null;
  method: { summary: string; body: string[] };
  quote: { quote: string; theme: string | null } | null;
  /** `voice` findings are drawn in the qualitative colour, not the accent. */
  kind: "result" | "spotlight" | "voices";
  /** The label of the link into the study. */
  actionLabel: string;
};

export default function PanoramaFindings({
  findings,
  studyDestination,
}: {
  findings: PanoramaFinding[];
  studyDestination: string;
}) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Derived during render, so a shorter list clamps in the same pass rather
  // than through a second, cascading render.
  const index = findings.length === 0 ? 0 : Math.min(active, findings.length - 1);
  const current = findings[index];

  const move = useCallback(
    (next: number) => {
      const target = (next + findings.length) % findings.length;
      setActive(target);
      buttons.current[target]?.focus();
    },
    [findings.length],
  );

  if (!current) return null;

  const accent = current.kind === "voices"
    ? { fill: "var(--color-voice)", surface: "var(--color-voice-surface)", line: "var(--color-voice-line)" }
    : categoryAccent(index);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-xl">Lo que encontramos</h3>
        {findings.length > 1 ? (
          <p className="text-sm text-muted">
            {findings.length} hallazgos · elige uno para verlo
          </p>
        ) : null}
      </div>

      {/* The navigator. Compact, horizontal, scrollable on a phone — a way to
          choose, not four documents stacked on top of each other. */}
      {findings.length > 1 ? (
        <div
          role="group"
          aria-label="Hallazgos del estudio"
          className="mt-3 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {findings.map((finding, position) => {
            const selected = position === index;
            const tone = finding.kind === "voices"
              ? { fill: "var(--color-voice)", surface: "var(--color-voice-surface)", line: "var(--color-voice-line)" }
              : categoryAccent(position);
            return (
              <button
                key={finding.id}
                ref={(node) => {
                  buttons.current[position] = node;
                }}
                type="button"
                aria-pressed={selected}
                onClick={() => setActive(position)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault();
                    move(position + 1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault();
                    move(position - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    move(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    move(findings.length - 1);
                  }
                }}
                className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors duration-[var(--motion-state)] ${
                  selected
                    ? "border-transparent text-strong shadow-raised"
                    : "border-line bg-surface text-muted hover:bg-surface-sunken"
                }`}
                style={selected ? { backgroundColor: tone.surface, borderColor: tone.line } : undefined}
              >
                {/* The dot is the category mark. It identifies the finding; it
                    never says whether the number is good. */}
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: selected ? tone.fill : "var(--color-line-strong)" }}
                />
                <span className="whitespace-nowrap">{finding.label}</span>
                {finding.value ? (
                  <span className="tabular whitespace-nowrap text-muted">{finding.value}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* The dominant finding. One at a time, at a size that says it matters. */}
      <article
        aria-live="polite"
        className="mt-4 overflow-hidden rounded-2xl border bg-surface"
        style={{ borderColor: accent.line }}
      >
        <div className="grid gap-x-8 gap-y-5 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-start">
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-strong">{current.question}</h4>

            {/* A qualitative finding has no number, and must not be shown as a
                missing one: its dominant statement is the theme itself. */}
            {current.value != null ? (
              <>
                <p className="tabular mt-3 font-display text-[clamp(2.6rem,7vw,4rem)] font-semibold leading-none text-strong">
                  {current.value}
                </p>
                <p className="mt-1.5 text-base font-medium text-strong">{current.caption}</p>
              </>
            ) : current.kind === "voices" ? (
              <p className="mt-3 font-display text-[clamp(1.7rem,4.5vw,2.6rem)] font-semibold leading-tight text-strong">
                {current.caption}
              </p>
            ) : (
              <>
                <p className="tabular mt-3 font-display text-[clamp(2.6rem,7vw,4rem)] font-semibold leading-none text-strong">
                  —
                </p>
                <p className="mt-1.5 text-base font-medium text-strong">{current.caption}</p>
              </>
            )}

            <div className="mt-4">
              {current.value == null && current.kind !== "voices" ? (
                <>
                  <AbsentMark />
                  <p className="mt-1.5 text-xs text-muted">Sin resultado en esta medición</p>
                </>
              ) : current.unit && current.numeric != null ? (
                <>
                  <ScaleMark value={current.numeric} unit={current.unit} tone="accent" />
                  {current.scaleNote ? (
                    <p className="mt-1.5 text-xs text-muted">{current.scaleNote}</p>
                  ) : null}
                </>
              ) : current.peer && current.numeric != null ? (
                <>
                  <PeerMark
                    value={current.numeric}
                    min={current.peer.min}
                    max={current.peer.max}
                    tone="accent"
                  />
                  {current.scaleNote ? (
                    <p className="mt-1.5 text-xs text-muted">{current.scaleNote}</p>
                  ) : null}
                </>
              ) : current.scaleNote ? (
                <p className="text-xs text-muted">{current.scaleNote}</p>
              ) : null}
            </div>
          </div>

          <div className="min-w-0">
            {current.interpretation ? (
              <div className="mb-4 rounded-lg border border-evidence-line bg-evidence-surface px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-evidence">Lectura del equipo</p>
                <p className="mt-1 text-sm leading-relaxed text-strong">{current.interpretation}</p>
              </div>
            ) : null}
            {current.quote ? (
              <figure
                className="rounded-lg border-l-4 px-4 py-3"
                style={{ borderColor: accent.fill, backgroundColor: accent.surface }}
              >
                <blockquote className="text-lg leading-snug text-strong">
                  {`“${current.quote.quote}”`}
                </blockquote>
                {current.quote.theme ? (
                  <figcaption className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-voice">
                    {current.quote.theme}
                  </figcaption>
                ) : null}
              </figure>
            ) : null}

            {current.sample ? (
              <div className={current.quote ? "mt-4" : ""}>
                <SampleContext
                  visibility={current.sample.visibility}
                  count={current.sample.count}
                  detail={current.sample.visibility === "caution"}
                />
              </div>
            ) : null}

            {current.context ? (
              <p className={`text-sm text-muted ${current.sample || current.quote ? "mt-2.5" : ""}`}>
                {current.context}
              </p>
            ) : null}

            {/* ONE method disclosure — the active finding's. */}
            <MethodDisclosure summary={current.method.summary}>
              {current.method.body.map((paragraph, position) => (
                <p key={paragraph} className={position === 0 ? undefined : "mt-1.5"}>
                  {paragraph}
                </p>
              ))}
            </MethodDisclosure>
          </div>
        </div>

        {/* One way in, from the finding you are actually looking at. */}
        <div className="border-t px-5 py-3.5 sm:px-7" style={{ borderColor: accent.line }}>
          <a
            href={studyDestination}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
          >
            {current.actionLabel} <Forward />
          </a>
        </div>
      </article>
    </div>
  );
}
