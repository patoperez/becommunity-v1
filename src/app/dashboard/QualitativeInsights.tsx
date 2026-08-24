"use client";

import type { SafeQualitativeSummary } from "@/lib/dashboard/view";
import { RankedBars } from "@/components/evidence/ScaleMark";
import { humanize } from "@/lib/language/results";

/**
 * What people said — themes and quotes.
 *
 * Three defects retired here, all from the audit's accessibility section:
 *  - quantity was encoded as FONT SIZE (`0.75 + 0.35 * count/max` rem, floored
 *    at 12 px). It is now bar length plus a written count;
 *  - the count was also carried only in a `title` attribute, which is
 *    unavailable on touch and unreliable in screen readers. It is now text;
 *  - the non-compact case returned `null` when nothing was confirmed, so a
 *    reader could not tell "no qualitative work was done" from "nothing found".
 *
 * The quotes were the smallest type on the page and are the only part of the
 * product written by the people being studied. They are now the largest text in
 * this block.
 *
 * Qualitative results are deliberately NOT turned into a KPI or a percentage.
 */
export default function QualitativeInsights({
  summary,
  compact = false,
}: {
  summary: SafeQualitativeSummary;
  compact?: boolean;
}) {
  const nothing =
    summary.themes.length === 0 &&
    summary.quotes.length === 0 &&
    !summary.hasSuppressedThemes;

  if (nothing) {
    return (
      <p
        className={`${compact ? "mt-2" : "mt-3"} rounded-lg border border-dashed border-line-strong bg-surface px-3.5 py-3 text-sm text-muted`}
      >
        {compact
          ? "Nadie dejó comentarios sobre este momento, o todavía no se han revisado."
          : "Todavía no hay comentarios revisados y confirmados para este estudio. Cuando el equipo de Be Community termine la revisión, aparecerán aquí con sus citas."}
      </p>
    );
  }

  const max = summary.themes[0]?.count ?? 1;
  const themes = summary.themes.slice(0, compact ? 3 : 8).map((theme) => ({
    label: humanize(theme.theme),
    count: theme.count,
    caution: theme.visibility === "caution",
  }));
  const quotes = summary.quotes.slice(0, compact ? 2 : 3);

  return (
    <div className={compact ? "mt-3" : ""}>
      {compact ? null : (
        <>
          <h5 className="text-xl">¿Qué están diciendo las personas?</h5>
          <p className="mt-1 text-sm text-muted">
            Temas confirmados por una persona del equipo, nunca por el sistema.
            Se ordenan por cuántas veces aparecen, no por importancia.
          </p>
        </>
      )}

      {themes.length > 0 ? (
        <div className={compact ? "" : "mt-4"}>
          <RankedBars items={themes} max={max} />
          {themes.some((theme) => theme.caution) ? (
            <p className="mt-2.5 text-xs text-caution">
              <span aria-hidden="true">◐ </span>
              Los temas marcados así se apoyan en pocas personas: léelos como un
              indicio.
            </p>
          ) : null}
        </div>
      ) : null}

      {summary.hasSuppressedThemes ? (
        <p className="mt-3 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-xs text-caution">
          Hay temas que no mostramos porque los mencionaron muy pocas personas y
          podrían quedar identificadas.
        </p>
      ) : null}

      {quotes.length > 0 ? (
        <div className={compact ? "mt-3 grid gap-2.5" : "mt-6 grid gap-3"}>
          {quotes.map((quote, index) => (
            <figure
              key={`${quote.quote}-${index}`}
              className="rounded-lg border-l-4 border-voice bg-voice-surface px-4 py-3"
            >
              <blockquote
                className={`text-strong ${compact ? "text-base" : "text-lg leading-snug"}`}
              >
                {`“${quote.quote}”`}
              </blockquote>
              {quote.theme ? (
                <figcaption className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-voice">
                  {humanize(quote.theme)}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}
