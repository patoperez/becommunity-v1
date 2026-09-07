/**
 * THE SINGLE-FIGURE AND EDITORIAL DRAWINGS.
 *
 * `kpi_value`, `kpi_with_base`, `gauge`, `callout` and `narrative` — five
 * variants that share one property: whatever number they carry is already
 * finished, and the only thing this file decides is how large it is printed and
 * what sits beside it.
 *
 * THE GAUGE IS NOT A DIAL. The approved dashboard tried a semicircular gauge for
 * the recommendation score and a −100..+100 rule, and removed both; the renewal
 * index is drawn as a bare number over a 0..100 reading rail. That is what is
 * adapted here — and the rail is drawn NEUTRAL, with one marker, because the
 * zone boundaries are business thresholds and this layer is not allowed to know
 * one. The zone a value is in arrives already decided, as `band.label`, and is
 * printed as a word.
 */

import type { RenderBlock, RenderValue } from "@/lib/presentation";
import { AbsenceNotice, type PresentationAudience } from "./absence";
import { BandChip, BaseLine, Figure } from "./primitives";
import { bandPalette, unitIsHundredScale } from "./vocabulary";

type LeafProps = { block: RenderBlock; audience: PresentationAudience };

/** The one number a `value` payload carries, or its absence. */
function soleValue(block: RenderBlock): { value: RenderValue | null; absent: React.ReactNode } {
  if (block.payload.shape === "value") return { value: block.payload.value, absent: null };
  if (block.payload.shape === "touchpoint") return { value: block.payload.satisfaction, absent: null };
  return { value: null, absent: null };
}

export function KpiValue({ block, audience, withBase = false }: LeafProps & { withBase?: boolean }) {
  const { value } = soleValue(block);
  if (!value) {
    const absence = block.payload.shape === "value" ? block.payload.absence : null;
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  return (
    <div>
      <p className="font-display text-[clamp(2.2rem,1.6rem+2.6vw,3.4rem)] font-bold leading-none text-strong">
        <Figure value={value} />
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BandChip value={value} />
      </div>
      {withBase && block.methodology.base ? <BaseLine base={block.methodology.base} className="mt-2" /> : null}
    </div>
  );
}

/**
 * A number on a 0..100 reading rail.
 *
 * The rail is the drawing; the marker's position is the value mapped onto a
 * length, which is geometry. No zone is painted, because painting one would
 * require a threshold, and a threshold is a business rule this layer must not
 * hold. A ratio may exceed 100 — TDP legitimately does — and the marker is
 * pinned at the end of the rail rather than the rail being rescaled, with the
 * exact figure printed above it either way.
 */
export function Gauge({ block, audience }: LeafProps) {
  const { value } = soleValue(block);
  if (!value) {
    const absence = block.payload.shape === "value" ? block.payload.absence : null;
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  const palette = bandPalette(value.band?.semanticColor ?? null);
  const onHundred = unitIsHundredScale(value.unit);
  const raw = value.value;
  const clampedForDrawing = raw < 0 ? 0 : raw > 100 ? 100 : raw;
  return (
    <div>
      <p className="font-display text-[clamp(2.2rem,1.6rem+2.6vw,3.4rem)] font-bold leading-none text-strong">
        <Figure value={value} />
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <BandChip value={value} />
      </div>
      {onHundred ? (
        <div className="mt-4">
          <div className="h-2 w-full rounded-full border border-line bg-surface-sunken" aria-hidden="true" />
          <div className="relative h-6" aria-hidden="true">
            <span
              className="absolute top-0 -translate-x-1/2 transition-[left] duration-[var(--motion-content)] ease-brand motion-reduce:transition-none"
              style={{ left: `${clampedForDrawing}%` }}
            >
              <span className={`block text-center text-[0.6rem] leading-none ${palette.text}`}>▲</span>
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span className="tabular">0</span>
            <span className="tabular">100</span>
          </div>
          {raw > 100 ? (
            <p className="mt-1 text-xs text-muted">
              La medición supera el 100 de la escala; la marca se queda en el extremo y la cifra exacta es la de
              arriba.
            </p>
          ) : null}
        </div>
      ) : null}
      {block.methodology.base ? <BaseLine base={block.methodology.base} className="mt-3" /> : null}
    </div>
  );
}

/**
 * A short aside on a tinted plate. Carries a figure only if the block has one.
 *
 * A TOUCHPOINT CARRIES THREE FIGURES, AND PRINTING ONE OF THEM UNLABELLED IS
 * NOT A SUMMARY, IT IS A SUBSTITUTION. An earlier version reached through
 * `soleValue`, drew the satisfaction alone with no label, and dropped the
 * process-unawareness silently — so a reader saw one number where the study
 * measured three and could not tell which one they were looking at.
 */
export function Callout({ block, audience }: LeafProps) {
  if (block.payload.shape === "touchpoint") {
    const { label, satisfaction, processUnawareness, unawarenessShare } = block.payload;
    const lines = [
      { caption: "Satisfacción", value: satisfaction },
      { caption: "Desconocimiento del proceso", value: processUnawareness },
      { caption: "Proporción que no lo conocía", value: unawarenessShare },
    ].filter((line) => line.value !== null);
    if (lines.length === 0) return null;
    return (
      <div className="rounded-xl border border-evidence-line bg-evidence-surface p-4">
        <p className="text-sm font-semibold text-strong [overflow-wrap:anywhere]">{label}</p>
        <dl className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
          {lines.map((line) => (
            <div key={line.caption}>
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">{line.caption}</dt>
              <dd className="mt-0.5 font-display text-xl font-bold text-strong">
                <Figure value={line.value as RenderValue} />
              </dd>
            </div>
          ))}
        </dl>
        {block.methodology.base ? <BaseLine base={block.methodology.base} className="mt-2" /> : null}
      </div>
    );
  }

  const { value } = soleValue(block);
  const body = block.payload.shape === "editorial" ? block.payload.body : null;
  if (block.payload.shape === "editorial" && body === null) {
    return <AbsenceNotice absence={block.payload.absence ?? { state: "configuration_required" }} audience={audience} />;
  }
  if (!value && !body) {
    const absence = block.payload.shape === "value" ? block.payload.absence : null;
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  return (
    <div className="rounded-xl border border-evidence-line bg-evidence-surface p-4">
      {value ? (
        <p className="font-display text-2xl font-bold leading-none text-strong">
          <Figure value={value} />
        </p>
      ) : null}
      {body ? <p className={`text-sm text-body ${value ? "mt-2" : ""}`}>{body}</p> : null}
    </div>
  );
}

/** Authored prose. Paragraph breaks are the author's; nothing else is markup. */
export function Narrative({ block, audience }: LeafProps) {
  if (block.payload.shape !== "editorial") return null;
  const { body, absence } = block.payload;
  if (body === null) {
    return <AbsenceNotice absence={absence ?? { state: "configuration_required" }} audience={audience} />;
  }
  // Split on blank lines and render each as its own escaped text node. There is
  // no `dangerouslySetInnerHTML` anywhere in this library and there will not be.
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-body [overflow-wrap:anywhere]">
          {paragraph}
        </p>
      ))}
    </div>
  );
}
