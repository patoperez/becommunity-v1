"use client";

import { summarizeConfirmedQualitative, type ConfirmedQualitative } from "@/lib/qualitative/published";

function label(value: string) { return value.replace(/_/g, " "); }

export default function QualitativeInsights({ rows, compact = false }: { rows: ConfirmedQualitative[]; compact?: boolean }) {
  const summary = summarizeConfirmedQualitative(rows);
  if (rows.length === 0) return compact ? <p className="mt-3 text-xs text-zinc-500">Sin temas confirmados para esta etapa.</p> : null;
  const visibleThemes = summary.themes.filter((theme) => theme.visibility !== "suppressed");
  const max = visibleThemes[0]?.count ?? 1;
  return <section className={compact ? "mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800" : "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"}>
    <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Temas cualitativos confirmados</h5>
    <p className="mt-0.5 text-xs text-zinc-500">Solo decisiones humanas; los conteos pequeños se suprimen.</p>
    {summary.themes.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{visibleThemes.map((theme) => <span key={theme.theme} title={`${theme.count} observaciones · n=${theme.n}`} className={`rounded-full px-3 py-1 ${theme.visibility === "caution" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"}`} style={{ fontSize: `${0.75 + 0.35 * (theme.count / max)}rem` }}>{label(theme.theme)} · {theme.count}{theme.visibility === "caution" ? " · base pequeña" : ""}</span>)}{summary.themes.some((theme) => theme.visibility === "suppressed") ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">Hay temas con muestra insuficiente</span> : null}</div> : null}
    {summary.quotes.length > 0 ? <div className="mt-4 grid gap-2">{summary.quotes.slice(0, compact ? 2 : 3).map((quote) => <blockquote key={quote.id} className="rounded-lg border-l-4 border-violet-300 bg-violet-50 px-3 py-2 text-sm italic text-zinc-700 dark:bg-violet-950/30 dark:text-zinc-300">“{quote.quote}”{quote.themeVisibility !== "suppressed" ? <footer className="mt-1 text-xs not-italic text-zinc-500">{label(quote.theme)}</footer> : null}</blockquote>)}</div> : null}
  </section>;
}
