"use client";

import type { SafeQualitativeSummary } from "@/lib/dashboard/view";
import type { Audience } from "@/lib/dashboard/audience";
import { RankedBars } from "@/components/evidence/ScaleMark";
import { humanize } from "@/lib/language/results";
import { QualitativeCloud } from "@/components/evidence/QualitativeCloud";

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
 * ABSENCE IS NOT A CLIENT-FACING FINDING. If nothing has been confirmed and
 * approved, the client sees NOTHING here — no card, no heading, no dashed
 * placeholder, no promise that a review is under way. That is Be Community's
 * own unfinished work, and a published study is a finished editorial product.
 * The internal preview says it plainly instead, marked as internal, because
 * there it is operational information a consultant needs before publishing.
 *
 * The quotes were the smallest type on the page and are the only part of the
 * product written by the people being studied. They are now the largest text in
 * this block.
 *
 * Qualitative results are deliberately NOT turned into a KPI or a percentage.
 */
export function hasPublishableQualitative(summary: SafeQualitativeSummary): boolean {
  return (
    summary.themes.length > 0 ||
    summary.quotes.length > 0 ||
    summary.hasSuppressedThemes
  );
}

export default function QualitativeInsights({
  summary,
  compact = false,
  audience = "client",
}: {
  summary: SafeQualitativeSummary;
  compact?: boolean;
  audience?: Audience;
}) {
  if (!hasPublishableQualitative(summary)) {
    // The client gets silence. The internal preview gets the operational fact,
    // visibly marked so it can never be mistaken for client content.
    if (audience !== "preview") return null;
    return (
      <p
        className={`${compact ? "mt-2" : "mt-3"} rounded-lg border border-caution-line bg-caution-surface px-3.5 py-2.5 text-xs text-caution`}
      >
        <span className="font-semibold">Sólo para el equipo:</span>{" "}
        {compact
          ? "ningún tema ni cita está aprobado para este momento; el cliente no ve nada aquí."
          : "ningún tema ni cita está aprobado en este estudio; el cliente no ve esta sección."}
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
          {compact ? null : <QualitativeCloud items={themes.map(({ label, count }) => ({ label, count }))} />}
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
