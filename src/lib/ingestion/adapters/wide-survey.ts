import { randomUUID } from "node:crypto";
import type {
  AdaptOptions,
  AdaptResult,
  CanonicalRespondent,
  IngestError,
  ParsedFile,
  SourceAdapter,
} from "../canonical";
import { quantSchema, qualSchema, segmentsSchema } from "../canonical";

/**
 * Wide-survey adapter: one row per respondent. Column prefixes drive the mapping
 * to the canonical schema (§4.2):
 *
 *   seg_<key>     -> respondent.segments[key]        (e.g. seg_nivel -> nivel)
 *   q_<metric>    -> quant_response { metric_key, value:number }
 *   qual_<theme>  -> qual_observation { theme, quote, source, category:null }
 *   source        -> overrides the source for that row's qualitative rows
 *
 * Empty cells are skipped (no row produced). A fully-empty data row is ignored.
 * Adding a different file shape = a new adapter implementing SourceAdapter; the
 * DB and dashboard never change (§2).
 */

const SEG = "seg_";
const Q = "q_";
const QUAL = "qual_";
const SOURCE_COL = "source";

const NUMERIC = /^-?\d+(\.\d+)?$/;

function adapt(file: ParsedFile, opts: AdaptOptions = {}): AdaptResult {
  const errors: IngestError[] = [];
  const headers = file.headers;

  const segCols = headers.filter((h) => h.startsWith(SEG));
  const qCols = headers.filter((h) => h.startsWith(Q));
  const qualCols = headers.filter((h) => h.startsWith(QUAL));

  // ---- Header-level validation (fail before reading any row) ----------------
  if (qCols.length === 0 && qualCols.length === 0) {
    errors.push({
      row: null,
      column: null,
      message:
        "El archivo no contiene columnas de métricas (prefijo 'q_') ni cualitativas (prefijo 'qual_'). Revisa el encabezado.",
    });
  }
  for (const req of opts.requiredColumns ?? []) {
    if (!headers.includes(req)) {
      errors.push({ row: null, column: req, message: `Falta la columna obligatoria '${req}'.` });
    }
  }
  if (file.rows.length === 0) {
    errors.push({ row: null, column: null, message: "El archivo no contiene filas de datos." });
  }
  if (errors.length > 0) return { ok: false, errors };

  // ---- Row-level validation (collect ALL errors, never fail-fast) -----------
  const respondents: CanonicalRespondent[] = [];
  const defaultSource = opts.defaultSource ?? "encuesta";

  file.rows.forEach((row, idx) => {
    const lineNo = idx + 2; // header occupies line 1

    const segments: Record<string, string> = {};
    for (const c of segCols) {
      const v = (row[c] ?? "").trim();
      if (v) segments[c.slice(SEG.length)] = v;
    }

    const quant: CanonicalRespondent["quant"] = [];
    for (const c of qCols) {
      const raw = (row[c] ?? "").trim();
      if (raw === "") continue; // unanswered metric — skip, not an error
      if (!NUMERIC.test(raw)) {
        errors.push({
          row: lineNo,
          column: c,
          message: `Se esperaba un número en '${c}' pero se recibió '${raw}'.`,
        });
        continue;
      }
      quant.push({ metric_key: c.slice(Q.length), value: Number(raw) });
    }

    const source = (row[SOURCE_COL] ?? "").trim() || defaultSource;
    const qual: CanonicalRespondent["qual"] = [];
    for (const c of qualCols) {
      const v = (row[c] ?? "").trim();
      if (v === "") continue;
      qual.push({ source, category: null, theme: c.slice(QUAL.length), quote: v });
    }

    if (Object.keys(segments).length === 0 && quant.length === 0 && qual.length === 0) {
      return; // empty data row
    }
    respondents.push({ id: randomUUID(), segments, quant, qual });
  });

  if (errors.length > 0) return { ok: false, errors };

  // ---- Final Zod guard before persistence (§6.4) ----------------------------
  let quantCount = 0;
  let qualCount = 0;
  for (const r of respondents) {
    const segParse = segmentsSchema.safeParse(r.segments);
    if (!segParse.success) {
      errors.push({ row: null, column: null, message: `Segmentos inválidos: ${segParse.error.issues[0]?.message}` });
    }
    for (const q of r.quant) {
      if (!quantSchema.safeParse(q).success) {
        errors.push({ row: null, column: q.metric_key, message: `Métrica inválida '${q.metric_key}'.` });
      }
      quantCount++;
    }
    for (const q of r.qual) {
      if (!qualSchema.safeParse(q).success) {
        errors.push({ row: null, column: q.theme, message: `Observación cualitativa inválida '${q.theme}'.` });
      }
      qualCount++;
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    respondents,
    summary: { respondents: respondents.length, quant: quantCount, qual: qualCount },
  };
}

export const wideSurveyAdapter: SourceAdapter = {
  id: "wide_survey",
  label: "Encuesta — formato ancho (una fila por encuestado)",
  adapt,
};

/** Registry of available adapters (§2: configuration over code). */
export const adapters: Record<string, SourceAdapter> = {
  [wideSurveyAdapter.id]: wideSurveyAdapter,
};
