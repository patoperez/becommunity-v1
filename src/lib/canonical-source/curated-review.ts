/**
 * THE CURATED-REVIEW READ — the four columns an internal editor needs, and
 * nothing that is anybody's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A SEPARATE READ AND NOT A WIDER `CanonicalResultSource`.
 *
 * `rows.ts` deliberately does not select `pain_point.raw_text` or
 * `normalized_text`, and `docs/CANONICAL_RESULTS_MODEL.md` §12 says why: the
 * canonical READ MODEL is what a client is eventually served from, and a
 * consultant's prose is not cleared for that. That decision stands and is not
 * touched here — `CanonicalResultSource` gains no field, `ResultCuratedFinding`
 * gains no field, the results contract does not move, and golden parity is
 * still 531 of 531 because nothing this file does is part of that document.
 *
 * What this file is, is the INTERNAL editorial read: the text a named internal
 * reviewer must be able to see in order to approve, edit, exclude or map it.
 * It lands in a Studio surface, never in a client render model, and the phrase
 * a client eventually reads is the one the reviewer APPROVED — stored as
 * presentation configuration by migration 0032 — not the one read here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS SELECTED, AND WHAT IS UNREACHABLE.
 *
 * Three tables, eleven columns:
 *
 *   `pain_point`               id, normalized_text, review_status
 *   `pain_point_journey_stage` pain_point_id, journey_stage_id, display_order
 *   `journey_stage`            id, key, label, stage_order, journey_model_id
 *
 * `raw_text` is NOT selected — `normalized_text` is the same consultant
 * sentence with its whitespace regularised by the projector, and reading both
 * would put two spellings of one phrase on a screen where a person has to
 * decide which is «the» phrase. `created_by`, `reviewed_by`,
 * `source_visual_annotation_id` and `superseded_by_id` are not selected either:
 * the first two name people and the last two are storage identities.
 *
 * AND THERE IS NO RESPONDENT ANYWHERE ON THIS PATH. `pain_point` has no
 * respondent column in any shape — its provenance is a workbook cell, through
 * `visual_annotation` — so a respondent identity, a survey comment or an
 * adjacent free-text answer is not something this read redacts. It is something
 * that does not exist in these tables to be read. `person`, `person_private`,
 * `qual_observation`, `quant_response` and `survey_response` are not named in
 * this file and no join reaches them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS PURE. The paging, the ceilings and the keyset discipline are
 * `read.ts`'s, unchanged: every read is scoped by tenant AND study before any
 * window, every page is proved to be in key order, and a set larger than its
 * declared ceiling THROWS rather than being truncated. The database client
 * lives in `adapter.ts` behind `server-only`, exactly as it does for every
 * other canonical read.
 */

import {
  CanonicalReadError,
  readCanonicalTable,
  type CanonicalReadScope,
  type CanonicalReadTransport,
} from "./read";

/** One curated pain row, as an internal reviewer must see it. */
export type CuratedPainRow = {
  id: string;
  /** The curated phrase, whitespace-normalized by the projector. */
  normalizedText: string;
  /** The canonical table's own review state for the SOURCE row. */
  reviewStatus: string;
};

/** One link from a curated pain row to the curated stage the source placed it in. */
export type CuratedPainStageLink = {
  painPointId: string;
  journeyStageId: string;
  displayOrder: number;
};

/** One curated journey stage, by the label the source gave it. */
export type CuratedStageRow = {
  id: string;
  label: string;
  stageOrder: number;
};

export type CuratedPainEvidence = {
  painPoints: CuratedPainRow[];
  stageLinks: CuratedPainStageLink[];
  stages: CuratedStageRow[];
};

/**
 * The three reads, declared as data so their columns are auditable.
 *
 * The ceilings are deliberately tight. A study's curated pain queue is tens of
 * rows — Cuicuilco's is fifty — and a ceiling of half a million would mean a
 * runaway read looked like a big study rather than like a refusal.
 */
export const CURATED_REVIEW_READS = {
  painPoints: {
    table: "pain_point",
    // `raw_text` is deliberately not selected. Neither is any actor column.
    columns: ["id", "normalized_text", "review_status"],
    keyColumns: ["id"],
    maxRows: 5_000,
  },
  stageLinks: {
    table: "pain_point_journey_stage",
    columns: ["pain_point_id", "journey_stage_id", "display_order"],
    keyColumns: ["pain_point_id", "journey_stage_id"],
    maxRows: 20_000,
  },
  stages: {
    table: "journey_stage",
    columns: ["id", "label", "stage_order"],
    keyColumns: ["id"],
    maxRows: 5_000,
  },
} as const;

const text = (value: unknown, table: string): string => {
  if (typeof value !== "string") throw new CanonicalReadError("READ_COLUMN_NOT_TEXT", table);
  return value;
};

const whole = (value: unknown, table: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CanonicalReadError("READ_COLUMN_NOT_NUMBER", table);
  }
  return value;
};

/**
 * Read one study's curated pain evidence.
 *
 * SEQUENTIAL, not pooled. Three small reads against a bounded set do not need
 * the six-way pool `loadCanonicalRowSet` uses for twenty-six families, and a
 * pool here would be concurrency for its own sake in a path a person waits on
 * once per screen.
 */
export async function loadCuratedPainEvidence(
  transport: CanonicalReadTransport,
  scope: CanonicalReadScope,
  signal?: AbortSignal,
): Promise<CuratedPainEvidence> {
  const painRows = await readCanonicalTable<Record<string, unknown>>(
    transport,
    CURATED_REVIEW_READS.painPoints,
    scope,
    undefined,
    signal,
  );
  const linkRows = await readCanonicalTable<Record<string, unknown>>(
    transport,
    CURATED_REVIEW_READS.stageLinks,
    scope,
    undefined,
    signal,
  );
  const stageRows = await readCanonicalTable<Record<string, unknown>>(
    transport,
    CURATED_REVIEW_READS.stages,
    scope,
    undefined,
    signal,
  );

  return {
    painPoints: painRows.map((row) => ({
      id: text(row.id, "pain_point"),
      normalizedText: text(row.normalized_text, "pain_point"),
      reviewStatus: text(row.review_status, "pain_point"),
    })),
    stageLinks: linkRows.map((row) => ({
      painPointId: text(row.pain_point_id, "pain_point_journey_stage"),
      journeyStageId: text(row.journey_stage_id, "pain_point_journey_stage"),
      displayOrder: whole(row.display_order, "pain_point_journey_stage"),
    })),
    stages: stageRows.map((row) => ({
      id: text(row.id, "journey_stage"),
      label: text(row.label, "journey_stage"),
      stageOrder: whole(row.stage_order, "journey_stage"),
    })),
  };
}
