"use client";

import type { ImportPreviewRow, IngestSummary } from "@/lib/ingestion/canonical";
import { summarizePreviewRow } from "@/lib/ingestion/destinations";

/**
 * The readable import preview.
 *
 * What it replaces was five `JSON.stringify` dumps in a black box, presented as
 * the last human check before an atomic write. Nobody can verify an import from
 * a serialized object, so the check was theatre.
 *
 * This is a VIEW of the same canonical payload — the very objects the commit
 * will persist, handed over by `previewMappedImport` — never a second reading
 * of the file. The counts, the validation errors, the explicit confirmation and
 * the atomic write behind it are unchanged.
 */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function ImportPreview({
  summary,
  sample,
  sourceRows,
}: {
  summary: IngestSummary;
  sample: ImportPreviewRow[];
  sourceRows: number;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Personas", summary.respondents, "Cada fila con datos se guarda como una persona."],
          ["Resultados numéricos", summary.quant, "Calificaciones que entrarán a los cálculos."],
          ["Comentarios abiertos", summary.qual, "Textos que después pasan por revisión."],
        ].map(([label, value, hint]) => (
          <div key={String(label)} className="rounded-xl border border-line bg-surface-sunken p-4">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 font-display text-3xl font-semibold text-strong">{value}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="font-display text-base font-semibold text-strong">
          Cómo se leyeron las primeras filas
        </h3>
        <p className="mt-1 text-sm text-muted">
          El archivo trae {plural(sourceRows, "fila", "filas")}. Estas son las primeras, tal como
          quedarán guardadas.
        </p>

        <ul className="mt-3 space-y-2">
          {sample.map((raw) => {
            const row = summarizePreviewRow(raw);
            return (
              <li key={row.sourceRow} className="rounded-xl border border-line bg-surface">
                <details>
                  <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-strong">
                    Persona de la fila {row.sourceRow}
                    <span className="block text-xs font-normal text-muted">
                      {plural(row.filters.length, "dato para filtrar", "datos para filtrar")} ·{" "}
                      {plural(row.results.length, "resultado", "resultados")} ·{" "}
                      {plural(row.comments.length, "comentario", "comentarios")}
                    </span>
                  </summary>

                  <div className="space-y-4 border-t border-line px-4 py-4">
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                        Datos para filtrar
                      </h4>
                      {row.filters.length > 0 ? (
                        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {row.filters.map((entry) => (
                            <div key={entry.label} className="flex flex-wrap gap-x-2 text-sm">
                              <dt className="text-muted">{entry.label}:</dt>
                              <dd className="text-strong">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="mt-1 text-sm text-muted">
                          Esta fila no trae ninguno, así que no se podrá separar por características.
                        </p>
                      )}
                    </section>

                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                        Resultados numéricos
                      </h4>
                      {row.results.length > 0 ? (
                        <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {row.results.map((entry, index) => (
                            <div key={`${entry.label}-${index}`} className="flex flex-wrap gap-x-2 text-sm">
                              <dt className="text-muted">{entry.label}:</dt>
                              <dd className="font-semibold text-strong">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="mt-1 text-sm text-muted">Esta fila no trae calificaciones.</p>
                      )}
                    </section>

                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                        Comentarios abiertos
                      </h4>
                      {row.comments.length > 0 ? (
                        <ul className="mt-2 space-y-2">
                          {row.comments.map((entry, index) => (
                            <li
                              key={`${entry.label}-${index}`}
                              className="rounded-lg border border-voice-line bg-voice-surface px-3 py-2"
                            >
                              <p className="text-xs text-voice">
                                {entry.label} · {entry.source}
                              </p>
                              <p className="mt-1 text-sm text-body">“{entry.quote}”</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm text-muted">Esta fila no trae texto abierto.</p>
                      )}
                    </section>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
