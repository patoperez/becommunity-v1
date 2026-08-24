"use client";

import { useCallback, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

/**
 * The client portal before anything is published.
 *
 * It replaces four paragraphs explaining publication mechanics — which is
 * internal workflow, not the reader's business — with a headline, two short
 * sentences, one quiet contact line, and one small thing to do.
 *
 * `Qué encontrarás aquí` is GENERIC ORIENTATION. Each sentence describes what
 * that area of a Be Community study is, in general. Nothing here reads this
 * tenant's data, claims progress, or promises that this particular study will
 * contain any of these areas — a study without qualitative work has no Voces,
 * and the copy is written so that stays true.
 *
 * No progress bar and no invented stage: the product does not know how far
 * along the work is, so it does not pretend to.
 */

type Area = {
  id: string;
  label: string;
  sentence: string;
  color: string;
  surface: string;
  line: string;
};

const AREAS: Area[] = [
  {
    id: "hallazgos",
    label: "Hallazgos",
    sentence:
      "Los resultados que más importan, con lo que significan y qué tan confiables son.",
    color: "var(--color-blue)",
    surface: "var(--color-sky-surface)",
    line: "var(--color-sky-line)",
  },
  {
    id: "recorrido",
    label: "Recorrido",
    sentence:
      "Cada momento de la experiencia, con su resultado y lo que se observó ahí.",
    color: "var(--color-magenta)",
    surface: "var(--color-magenta-surface)",
    line: "var(--color-magenta-line)",
  },
  {
    id: "voces",
    label: "Voces",
    sentence: "Lo que las personas escribieron, en sus propias palabras.",
    color: "var(--color-lavender)",
    surface: "var(--color-lavender-surface)",
    line: "var(--color-lavender-line)",
  },
];

export default function StudyComingSoon() {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = AREAS[active];

  const move = useCallback((next: number) => {
    const index = (next + AREAS.length) % AREAS.length;
    setActive(index);
    buttons.current[index]?.focus();
  }, []);

  return (
    <section
      aria-labelledby="preparando-titulo"
      className="mx-auto max-w-2xl rounded-2xl border border-line bg-surface px-6 py-10 text-center sm:px-10"
    >
      <div aria-hidden="true" className="flex justify-center gap-2">
        {AREAS.map((area, index) => (
          <BrandMark
            key={area.id}
            color={area.color}
            size={26}
            rotate={index % 2 === 0 ? -8 : 7}
          />
        ))}
      </div>

      <h2 id="preparando-titulo" className="mt-5 text-2xl">
        Estamos preparando tu estudio
      </h2>
      <p className="mx-auto mt-3 max-w-prose text-base leading-relaxed text-muted">
        Cuando esté listo, aparecerá aquí. No necesitas hacer nada por ahora.
      </p>

      <div className="mt-8 rounded-xl border border-line bg-surface-page p-5">
        <p className="text-sm font-semibold text-strong">Qué encontrarás aquí</p>
        <div
          role="group"
          aria-label="Áreas de un estudio"
          className="mt-3 flex flex-wrap justify-center gap-2"
        >
          {AREAS.map((area, index) => {
            const selected = index === active;
            return (
              <button
                key={area.id}
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
                  }
                }}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-[background-color,border-color,transform] duration-[var(--motion-state)] ease-brand motion-reduce:transition-none ${
                  selected
                    ? "text-strong"
                    : "border-line bg-surface text-muted hover:bg-surface-sunken"
                } ${selected ? "-translate-y-0.5 motion-reduce:translate-y-0" : ""}`}
                style={
                  selected
                    ? { backgroundColor: area.surface, borderColor: area.line }
                    : undefined
                }
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: selected ? area.color : "var(--color-line-strong)",
                  }}
                />
                {area.label}
              </button>
            );
          })}
        </div>

        {/* One sentence, replaced in place. The live region means a screen
            reader hears the change the same way a sighted reader sees it. */}
        <p
          aria-live="polite"
          className="mx-auto mt-4 min-h-[3rem] max-w-prose text-sm leading-relaxed text-strong"
        >
          {current.sentence}
        </p>
        <p className="mt-1 text-xs text-muted">
          Así se componen los estudios de Be Community. El tuyo mostrará las áreas
          que su investigación incluya.
        </p>
      </div>

      <p className="mt-6 text-sm text-muted">
        ¿Esperabas verlo hoy? Escríbele a la persona de Be Community que te dio el
        acceso.
      </p>
    </section>
  );
}
