/**
 * THE RENDER MODEL — what a client surface receives, and the end of the line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY NUMBER HERE IS ALREADY FINAL.
 *
 * `value` was computed, rounded exactly once at its declared precision, and
 * formatted by the canonical layer on the server. A renderer draws `formatted`.
 * It does not divide, sum, average, re-round, rescale, clamp or convert
 * anything, and there is deliberately nothing in these types it could do that
 * arithmetic WITH: no numerator beside a denominator, no raw row, no per-person
 * datum, no accounting partition to recombine.
 *
 * WHAT IS ABSENT, AND ON PURPOSE.
 *
 *   - No `ResultInternalProvenance`. The canonical metric key, the source
 *     families and the authority statements stop at the server.
 *   - No `ResultBand.schemeKey`. A band arrives as a semantic colour and a
 *     label; the scheme that named it is configuration, not client copy.
 *   - No `CanonicalAddress`. The registry's server-only half never crosses.
 *   - No respondent, no free text, no identifier of any kind — the canonical
 *     contract has nowhere to put one, and neither does this.
 *
 * A ratio that exceeds 100 arrives EXCEEDING 100. `touchpoint_process_unawareness`
 * is a ratio over the valid base and the approved dashboard publishes 133.3% for
 * one touchpoint. Nothing in this file or in the resolver clamps it, and the
 * gate re-checks that with the real figure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ResultUnit, SemanticColor, UnavailableReason, UnresolvedReason } from "../results/contract";
import type {
  ChartVariant,
  MethodologyDisclosureLevel,
  PresentationAvailability,
  PresentationSemantic,
  ProvenanceCategory,
} from "./capabilities";
import type { AuthoredCopy, BlockPlacement } from "./document";
import type { ResponseContext } from "./catalog";

/** A band, stripped of the scheme key that named it. */
export type RenderBand = {
  semanticColor: SemanticColor;
  label: string | null;
};

/** One finished number. */
export type RenderValue = {
  value: number;
  unit: ResultUnit;
  decimals: number;
  /** What a renderer draws. Produced on the server by the canonical formatter. */
  formatted: string;
  band: RenderBand | null;
};

/** Why there is no number, in the contract's own vocabulary. */
export type RenderAbsence =
  | { state: "unavailable"; reason: UnavailableReason }
  | { state: "unresolved"; reason: UnresolvedReason }
  | { state: "configuration_required" }
  /**
   * A person decided this is not published, and that is ALL a reader is told.
   *
   * Unit 6A carried the threshold, the author's name and the internal rationale
   * here. Those are audit fields — who decided and why — and shipping them to a
   * browser publishes the study's own deliberation beside the gap it made. If a
   * reader should be told something, the policy carries a separately authored
   * `publicNote` and it arrives on the block, not in here.
   */
  | { state: "withheld_by_policy" };

/** One already-counted, already-shared category. */
export type RenderCategory = {
  label: string;
  /** A documented qualifier the source states beside the label, when it has one. */
  note: string | null;
  /** Null when there was no base at all. Never a filled-in zero. */
  count: number | null;
  /** Already rounded once at percent precision. Null on an empty base. */
  share: number | null;
  band: RenderBand | null;
};

/** One measured quantity inside a series point. */
export type RenderMeasure = {
  label: string;
  value: RenderValue | null;
  absence: RenderAbsence | null;
};

/**
 * One period of a series.
 *
 * A period carries a LIST of measures rather than one value, because retention
 * and attrition are two results of the same period and drawing them from two
 * separately-resolved series would let them drift out of step.
 */
export type RenderSeriesPoint = {
  label: string;
  order: number;
  base: ResponseContext | null;
  measures: RenderMeasure[];
};

/** One curated term. */
export type RenderTerm = {
  label: string;
  count: number;
  share: number | null;
};

/** One cohort's participation accounting. */
export type RenderCohort = {
  label: string;
  total: number;
  measured: number;
  responded: number;
  notParticipated: number;
  participationUnknown: number;
};

/** One instrument's base. */
export type RenderInstrumentBase = {
  label: string;
  base: ResponseContext;
};

/** One filter control a panel offers. */
export type RenderFilterDimension = {
  /** The opaque handle, so a selection can name it without naming storage. */
  handle: string;
  label: string;
  options: { value: string; participants: number }[];
};

/** One VISIBLE journey route: a presentation decision, resolved. */
export type RenderRoute = {
  id: string;
  title: string;
  order: number;
  /** The label of the SOURCE group it draws from. Evidence behind the decision. */
  sourceGroupLabel: string;
  points: RenderRoutePoint[];
};

/** One touchpoint as a route draws it. */
export type RenderRoutePoint = {
  handle: string;
  label: string;
  order: number;
  satisfaction: RenderValue | null;
  /** TDP. A ratio; it may exceed 100 and is never clamped. */
  processUnawareness: RenderValue | null;
  base: ResponseContext | null;
  absence: RenderAbsence | null;
};

/** What a block actually carries, by shape. */
export type RenderPayload =
  | { shape: "value"; value: RenderValue | null; absence: RenderAbsence | null }
  | { shape: "categories"; categories: RenderCategory[]; absence: RenderAbsence | null }
  | { shape: "series"; points: RenderSeriesPoint[] }
  | { shape: "terms"; terms: RenderTerm[]; total: number; excluded: { label: string; count: number }[] }
  | { shape: "cohorts"; cohorts: RenderCohort[] }
  | { shape: "instrument_bases"; instruments: RenderInstrumentBase[] }
  | { shape: "touchpoint"; label: string; satisfaction: RenderValue | null; processUnawareness: RenderValue | null; unawarenessShare: RenderValue | null }
  | { shape: "journey_group"; label: string; touchpointCount: number }
  | { shape: "routes"; routes: RenderRoute[] }
  | { shape: "filter_controls"; dimensions: RenderFilterDimension[] }
  | { shape: "editorial"; body: string | null; absence: RenderAbsence | null };

/**
 * How the methodology was disclosed for this block.
 *
 * `explanation` is the contract's own client-safe prose — the ONLY provenance
 * field that may be rendered — and it is present only when the block's
 * disclosure level asked for it. There is no level that yields a formula.
 */
export type RenderMethodology = {
  level: MethodologyDisclosureLevel;
  explanation: string | null;
  base: ResponseContext | null;
};

/**
 * The resolved sample outcome — three states, and an approved sentence.
 *
 * The comparison that chose the state happened on the SERVER. What crosses the
 * boundary is a decision already made and, where somebody authored one, the
 * sentence they wrote for a reader. Never a threshold to compare against:
 * comparing is calculating.
 */
export type RenderSampleDisplay =
  | { state: "shown" }
  | { state: "shown_with_note"; note: string }
  | { state: "withheld_by_policy"; note: string | null };

/** One resolved block. */
export type RenderBlock = {
  id: string;
  semantic: PresentationSemantic | null;
  chartVariant: ChartVariant | null;
  copy: AuthoredCopy;
  placement: BlockPlacement;
  visible: boolean;
  availability: PresentationAvailability;
  provenance: ProvenanceCategory | null;
  payload: RenderPayload;
  methodology: RenderMethodology;
  /**
   * WHAT HAPPENED TO THIS BLOCK'S SAMPLE, and nothing about who decided it.
   *
   * Unit 6A published the whole authored `SampleDisplayPolicy` on every block —
   * threshold, author, rationale — which is exactly the internal material a
   * client renderer must never receive. A Studio surface may eventually be given
   * an authoring DTO that carries it; the public model gets the OUTCOME.
   */
  sampleDisplay: RenderSampleDisplay;

  /** Panels that move this block. Empty means nothing moves it. */
  connectedFilterPanelIds: string[];
};

export type RenderPage = {
  id: string;
  title: string;
  order: number;
  blocks: RenderBlock[];
};

/** The whole serializable result. */
export type PresentationRenderModel = {
  /** The presentation document shape this was resolved from. */
  schemaVersion: number;
  /** The results contract the numbers came from. */
  contractVersion: string;
  /** The presentation registry version that bound them. */
  registryVersion: string;
  title: string;
  locale: string;
  pages: RenderPage[];
};
