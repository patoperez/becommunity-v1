import type { ReactNode } from "react";
import type { SampleVisibility } from "@/lib/calc/disclosure";
import { sampleCopy, type SampleUnit } from "@/lib/language/sample";

/**
 * The one component that says what a result rests on (P8 contract C4).
 *
 * It replaces five different inline phrasings, all of which exposed `n=` to a
 * school director. The exact count is not deleted — it moves into
 * `<MethodDisclosure>`, which is where methodology is deliberately revealed.
 *
 * The tone is carried by a word and a shape, never by colour alone.
 */

const GLYPH: Record<string, string> = {
  standard: "●",
  caution: "◐",
  suppressed: "○",
  "no-data": "○",
};

const TONE_CLASS: Record<string, string> = {
  standard: "text-muted",
  caution: "text-caution",
  suppressed: "text-caution",
  "no-data": "text-muted",
};

export function SampleContext({
  visibility,
  count,
  unit = "people",
  detail = false,
}: {
  visibility: SampleVisibility;
  count: number | null;
  unit?: SampleUnit;
  /** Show the second sentence too. Off in tight places, on where it matters. */
  detail?: boolean;
}) {
  const copy = sampleCopy(visibility, count, unit);
  return (
    <p className={`flex items-start gap-1.5 text-sm ${TONE_CLASS[copy.tone]}`}>
      <span aria-hidden="true" className="mt-[0.15em] text-[0.7em] leading-none">
        {GLYPH[copy.tone]}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {copy.headline}
        {detail && copy.detail ? (
          <span className="block text-muted">{copy.detail}</span>
        ) : null}
      </span>
    </p>
  );
}

/**
 * The panel where precision is allowed to appear: how a result is calculated,
 * the exact base, and the disclosure rule. Collapsed by default, so the always-
 * visible layer stays in ordinary words while nothing is hidden from a reader
 * who wants it.
 */
export function MethodDisclosure({
  summary = "Cómo se calcula y sobre qué base",
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-3 rounded-lg border border-line bg-surface-sunken/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-strong">
        <span
          aria-hidden="true"
          className="inline-block transition-transform duration-[var(--motion-state)] group-open:rotate-90"
        >
          ›
        </span>
        {summary}
      </summary>
      <div className="border-t border-line px-3.5 py-3 text-sm leading-relaxed text-muted [overflow-wrap:anywhere]">
        {children}
      </div>
    </details>
  );
}
