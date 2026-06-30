import { z } from "zod";

/**
 * Canonical ingestion types (§2, §4.2). Every external source is translated to
 * these shapes by an adapter; nothing downstream (DB, dashboards) ever sees the
 * raw file format. Adding a new source = adding a new adapter, never touching
 * the visual or storage layers.
 */

/** A raw parsed row: header -> cell text. All values are strings pre-validation. */
export type RawRow = Record<string, string>;

/** A parsed file: ordered headers + the data rows. */
export type ParsedFile = {
  headers: string[];
  rows: RawRow[];
};

/** One canonical respondent with its quantitative + qualitative records. */
export type CanonicalRespondent = {
  /** Generated up-front so child rows (quant/qual) can reference it before insert. */
  id: string;
  segments: Record<string, string>;
  quant: { metric_key: string; value: number }[];
  qual: { source: string; category: string | null; theme: string; quote: string }[];
};

/** A single, human-readable validation problem (§6.4: clear messages). */
export type IngestError = {
  /** 1-based line number in the file (header is line 1), or null for file-level. */
  row: number | null;
  column: string | null;
  message: string;
};

export type IngestSummary = {
  respondents: number;
  quant: number;
  qual: number;
};

export type AdaptResult =
  | { ok: true; respondents: CanonicalRespondent[]; summary: IngestSummary }
  | { ok: false; errors: IngestError[] };

export type AdaptOptions = {
  /** Header names that MUST be present, e.g. ['seg_nivel'] -> "Falta la columna…". */
  requiredColumns?: string[];
  /** Default 'source' for qualitative rows when the file has no source column. */
  defaultSource?: string;
};

/** An ingestion source adapter (§2). New formats implement this interface. */
export interface SourceAdapter {
  id: string;
  label: string;
  adapt(file: ParsedFile, opts: AdaptOptions): AdaptResult;
}

/**
 * Final Zod guards — the last gate before anything touches the database (§6.4).
 * Even though the adapter builds these records, we re-validate the built shapes
 * so a bug in an adapter can never push malformed rows into Postgres.
 */
export const segmentsSchema = z.record(z.string(), z.string());

export const quantSchema = z.object({
  metric_key: z.string().min(1),
  value: z.number().refine((v) => Number.isFinite(v), { message: "valor no finito" }),
});

export const qualSchema = z.object({
  source: z.string().min(1),
  category: z.string().nullable(),
  theme: z.string().min(1),
  quote: z.string().min(1),
});
