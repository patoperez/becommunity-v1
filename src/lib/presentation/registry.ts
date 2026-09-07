/**
 * THE CANONICAL PRESENTATION REGISTRY — the bridge, and the only one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS.
 *
 * A registry is derived, deterministically, FROM a finished
 * `CanonicalStudyResults`. It answers exactly one question — "what may a
 * presentation name, and what may it do with each of those things?" — and it
 * answers it in two halves that must never be confused:
 *
 *   ENTRIES are describable. A handle, a semantic, a client-safe label, the
 *   formats and chart variants that already apply, whether the value is there,
 *   the base it rests on, how coarsely it was produced, and which filters it
 *   supports or refuses. Everything in an entry may be shown to a client.
 *
 *   ADDRESSES are not. An address says WHERE in the document a value already
 *   sits — `{ at: "recommendation.score", scopeIndex: 1 }` — and it is a
 *   POINTER, never an instruction. It stays server-side: `projectCatalog`
 *   drops it, the render model never carries it, and a gate asserts both.
 *
 * NO FORMULA LIVES HERE. There is no expression, no denominator, no threshold
 * and no arithmetic operator in this file. Resolution reads a value the
 * canonical layer already computed, formatted and rounded exactly once. If this
 * file ever needs a `+`, something has been designed wrong.
 *
 * HANDLES CARRY NO ADDRESS. Every handle is built from the closed vocabulary in
 * `capabilities.ts`, from a label the client is already shown, or from an
 * ordinal position — never from an item key, an attribute key, a metric key, an
 * instrument key or a table name. See `handles.ts` for why, and
 * `scripts/canonical-presentation-test.mjs` for the scan that proves it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  CanonicalStudyResults,
  FilterDimension,
  MetricResult,
  ResultBase,
  ResultUnit,
} from "../results/contract";
import {
  CANONICAL_PRESENTATION_REGISTRY_VERSION,
  COMPATIBLE_CHART_VARIANTS,
  SEMANTIC_UNITS,
  type ChartVariant,
  type PresentationAvailability,
  type PresentationSemantic,
  type ProvenanceCategory,
} from "./capabilities";
import {
  compareHandles,
  presentationHandle,
  slugifyLabel,
  type PresentationHandle,
} from "./handles";

/* -------------------------------------------------------------------------- */
/* the server-only address                                                     */
/* -------------------------------------------------------------------------- */

/**
 * WHERE a already-final value sits inside the results document.
 *
 * Every member addresses by ARRAY POSITION, never by canonical key. Two
 * reasons, and both matter: a position cannot leak a storage name, and a
 * position is stable for one document — which is the only lifetime an address
 * needs, because a registry is rebuilt whenever the document is.
 *
 * SERVER ONLY. This type is never serialized into a catalogue or a render
 * model, and the boundary gate fails if the string `"at"` reaches either.
 */
export type CanonicalAddress =
  | { at: "recommendation.score"; scopeIndex: number }
  | { at: "recommendation.distribution"; scopeIndex: number }
  | { at: "renewal.index" }
  | { at: "renewal.distribution" }
  | { at: "retention.period"; periodIndex: number; measure: "retention" | "attrition" }
  | { at: "retention.series" }
  | { at: "population.total" }
  | { at: "population.measured" }
  | { at: "population.cohorts" }
  | { at: "population.instruments" }
  | { at: "journey.group"; groupIndex: number }
  | {
      at: "journey.touchpoint";
      touchpointIndex: number;
      measure: "satisfaction" | "tdp" | "unawareShare" | "structure";
    }
  | { at: "qualitative.group"; groupIndex: number }
  | { at: "performance.dimension"; dimensionIndex: number }
  | { at: "filter.dimension"; dimensionIndex: number }
  | { at: "configuration.requirement"; requirementIndex: number };

/* -------------------------------------------------------------------------- */
/* the describable half                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The base a result rests on, at the coarseness a client may be shown.
 *
 * The three counts and nothing else: `AnswerAccounting`'s nine fields are an
 * auditor's tool, and publishing them per block would invite a surface to
 * recombine them — which is arithmetic, which is forbidden here.
 */
export type ResponseContext = {
  eligible: number;
  responded: number;
  valid: number;
};

/** One thing a presentation may name. Every field is client-safe. */
export type RegistryEntry = {
  handle: PresentationHandle;
  semantic: PresentationSemantic;
  /** Display text the client is already shown. Never a key. */
  label: string;
  /** The units this entry's values are already expressed in. */
  displayFormats: readonly ResultUnit[];
  /** The variants that may draw it. */
  compatibleVariants: readonly ChartVariant[];
  availability: PresentationAvailability;
  /** Null for structural entries that rest on no single base. */
  responseContext: ResponseContext | null;
  provenance: ProvenanceCategory;
  /** Filter dimensions this entry accepts, as handles. */
  supportedFilters: readonly PresentationHandle[];
  /** Filter dimensions an authority forbids crossing with it, as handles. */
  forbiddenFilters: readonly PresentationHandle[];
  /**
   * For a journey group: the touchpoint handles the SOURCE placed in it, in the
   * source's own order. Empty for everything else.
   *
   * This is the four-group evidence. The five VISIBLE routes the approved
   * dashboard draws are presentation configuration and live in the document,
   * never here — a route is a decision, a group is a fact.
   */
  members: readonly PresentationHandle[];
};

/**
 * The registry.
 *
 * `entries` is ordered by handle in codepoint order so two builds of the same
 * document enumerate identically. `addresses` is the server-only half.
 */
export type CanonicalPresentationRegistry = {
  registryVersion: string;
  /** The results contract this registry describes. A resolver cross-checks it. */
  contractVersion: string;
  entries: readonly RegistryEntry[];
  /** SERVER ONLY. Dropped by `projectCatalog`; absent from every render model. */
  addresses: ReadonlyMap<PresentationHandle, CanonicalAddress>;
};

/* -------------------------------------------------------------------------- */
/* building                                                                    */
/* -------------------------------------------------------------------------- */

/** The contract section an entry belongs to, for the forbidden-cross lookup. */
type ContractSection =
  | "population"
  | "recommendation"
  | "renewal"
  | "retention"
  | "journey"
  | "performance"
  | "qualitative"
  | "none";

type Draft = {
  handle: PresentationHandle;
  semantic: PresentationSemantic;
  label: string;
  availability: PresentationAvailability;
  responseContext: ResponseContext | null;
  provenance: ProvenanceCategory;
  section: ContractSection;
  members: PresentationHandle[];
  address: CanonicalAddress;
};

function contextOf(base: ResultBase): ResponseContext {
  return { eligible: base.eligible, responded: base.responded, valid: base.valid };
}

/**
 * Map a metric's own status onto the presentation vocabulary.
 *
 * A straight one-to-one, deliberately: collapsing `unavailable` and
 * `unresolved` into a single "no value" would erase the difference between
 * "there was nothing to calculate" and "the authorities disagree", and a client
 * surface that cannot tell those apart will eventually print the wrong caption
 * over an empty card.
 */
function availabilityOf(result: MetricResult): PresentationAvailability {
  return result.status;
}

/**
 * Disambiguate a slug that two labels produce, and never silently.
 *
 * The first claimant keeps the bare slug; every later one is suffixed with its
 * ordinal. A label that slugs to nothing at all falls back to the ordinal
 * alone, so an entry always has a handle and no two entries ever share one.
 */
function uniqueSegment(used: Set<string>, label: string, ordinal: number): string {
  const base = slugifyLabel(label);
  if (base.length === 0) return `n${ordinal}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let candidate = `${base}-${ordinal}`;
  let bump = ordinal;
  while (used.has(candidate)) {
    bump += 1;
    candidate = `${base}-${bump}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Build the registry for one finished results document.
 *
 * Pure and deterministic: same document in, byte-identical registry out. It
 * reads the document and nothing else — no environment, no clock, no
 * randomness, no transport.
 */
export function buildCanonicalPresentationRegistry(
  results: CanonicalStudyResults,
): CanonicalPresentationRegistry {
  const drafts: Draft[] = [];

  /* ---- filter dimensions first: everything else references their handles ---- */

  const dimensionUsed = new Set<string>();
  const dimensionHandles: { handle: PresentationHandle; dimension: FilterDimension }[] = [];
  results.filters.dimensions.forEach((dimension, index) => {
    const handle = presentationHandle("dimension", uniqueSegment(dimensionUsed, dimension.label, index + 1));
    dimensionHandles.push({ handle, dimension });
    drafts.push({
      handle,
      semantic: "filter_dimension",
      label: dimension.label,
      availability: "available",
      responseContext: null,
      provenance: "source_reported",
      section: "none",
      members: [],
      address: { at: "filter.dimension", dimensionIndex: index },
    });
  });

  /** Dimensions an authority forbids crossing with `section`. */
  const forbiddenFor = (section: ContractSection): PresentationHandle[] =>
    section === "none"
      ? []
      : dimensionHandles
          .filter(({ dimension }) => dimension.forbiddenSections.some((entry) => entry.section === section))
          .map(({ handle }) => handle);

  /* ---- population ---- */

  drafts.push({
    handle: presentationHandle("population", "total"),
    semantic: "population_total",
    label: "Población del estudio",
    availability: "available",
    responseContext: null,
    provenance: "source_reported",
    section: "population",
    members: [],
    address: { at: "population.total" },
  });
  drafts.push({
    handle: presentationHandle("population", "measured"),
    semantic: "population_measured",
    label: "Personas con al menos un dato medido",
    availability: "available",
    responseContext: null,
    provenance: "source_reported",
    section: "population",
    members: [],
    address: { at: "population.measured" },
  });
  drafts.push({
    handle: presentationHandle("population", "cohorts"),
    semantic: "population_cohorts",
    label: "Participación por cohorte",
    availability: "available",
    responseContext: null,
    provenance: "source_reported",
    section: "population",
    members: [],
    address: { at: "population.cohorts" },
  });
  drafts.push({
    handle: presentationHandle("population", "instrument", "bases"),
    semantic: "instrument_base",
    label: "Base por instrumento",
    availability: "available",
    responseContext: null,
    provenance: "source_reported",
    section: "population",
    members: [],
    address: { at: "population.instruments" },
  });

  /* ---- recommendation ---- */

  const scopeUsed = new Set<string>();
  results.recommendation.scopes.forEach((scope, index) => {
    const segment = uniqueSegment(scopeUsed, scope.label, index + 1);
    drafts.push({
      handle: presentationHandle("value", "nps", segment),
      semantic: "recommendation_score",
      label: scope.label,
      availability: availabilityOf(scope.score),
      responseContext: contextOf(scope.score.base),
      provenance: "measured_aggregate",
      section: "recommendation",
      members: [],
      address: { at: "recommendation.score", scopeIndex: index },
    });
    drafts.push({
      handle: presentationHandle("distribution", "nps", segment),
      semantic: "recommendation_distribution",
      label: `Composición de las respuestas · ${scope.label}`,
      availability: scope.distribution.promoters === null ? "unavailable" : "available",
      responseContext: contextOf(scope.score.base),
      provenance: "derived_share",
      section: "recommendation",
      members: [],
      address: { at: "recommendation.distribution", scopeIndex: index },
    });
  });

  /* ---- renewal ---- */

  drafts.push({
    handle: presentationHandle("value", "renewal", "index"),
    semantic: "renewal_index",
    label: results.renewal.index.label,
    availability: availabilityOf(results.renewal.index),
    responseContext: contextOf(results.renewal.base),
    provenance: "measured_aggregate",
    section: "renewal",
    members: [],
    address: { at: "renewal.index" },
  });
  drafts.push({
    handle: presentationHandle("distribution", "renewal", "intention"),
    semantic: "renewal_distribution",
    label: "Distribución de la intención de renovar",
    availability: results.renewal.distribution === null ? "unavailable" : "available",
    responseContext: contextOf(results.renewal.base),
    provenance: "derived_share",
    section: "renewal",
    members: [],
    address: { at: "renewal.distribution" },
  });

  /* ---- retention ---- */

  drafts.push({
    handle: presentationHandle("series", "retention", "and", "attrition"),
    semantic: "retention_series",
    label: "Retención y deserción por periodo",
    availability: results.retention.periods.length === 0 ? "unavailable" : "available",
    responseContext: null,
    provenance: "source_reported",
    section: "retention",
    members: [],
    address: { at: "retention.series" },
  });
  results.retention.periods.forEach((period, index) => {
    const ordinal = String(index + 1);
    drafts.push({
      handle: presentationHandle("value", "retention", "rate", "p", ordinal),
      semantic: "retention_rate",
      label: `Retención · ${period.label}`,
      availability: availabilityOf(period.retention),
      responseContext: contextOf(period.retention.base),
      provenance: "measured_aggregate",
      section: "retention",
      members: [],
      address: { at: "retention.period", periodIndex: index, measure: "retention" },
    });
    drafts.push({
      handle: presentationHandle("value", "attrition", "rate", "p", ordinal),
      semantic: "attrition_rate",
      label: `Deserción · ${period.label}`,
      availability: availabilityOf(period.attrition),
      responseContext: contextOf(period.attrition.base),
      provenance: "measured_aggregate",
      section: "retention",
      members: [],
      address: { at: "retention.period", periodIndex: index, measure: "attrition" },
    });
  });

  /* ---- journey: FOUR SOURCE GROUPS, and the touchpoints the source placed ---- */

  const touchpointHandleByKey = new Map<string, PresentationHandle>();
  const groupOrdinalByKey = new Map<string, number>();
  results.journey.groups.forEach((group, index) => {
    groupOrdinalByKey.set(group.key, index + 1);
  });

  results.journey.touchpoints.forEach((touchpoint, index) => {
    const groupOrdinal = groupOrdinalByKey.get(touchpoint.groupKey);
    const group = results.journey.groups.find((candidate) => candidate.key === touchpoint.groupKey);
    // Position INSIDE the group, taken from the group's own ordered key list —
    // the source's column order — rather than from the flat array, so a handle
    // means the same thing whether or not the flat order ever changes.
    const withinGroup = group ? group.touchpointKeys.indexOf(touchpoint.key) + 1 : 0;
    const segment = `g${groupOrdinal ?? 0}-t${withinGroup}`;
    const structural = presentationHandle("journey-touchpoint", segment);
    touchpointHandleByKey.set(touchpoint.key, structural);

    drafts.push({
      handle: structural,
      semantic: "journey_touchpoint",
      label: touchpoint.label,
      availability: "available",
      responseContext: contextOf(touchpoint.satisfaction.base),
      provenance: "measured_aggregate",
      section: "journey",
      members: [],
      address: { at: "journey.touchpoint", touchpointIndex: index, measure: "structure" },
    });
    drafts.push({
      handle: presentationHandle("value", "touchpoint", "satisfaction", segment),
      semantic: "touchpoint_satisfaction",
      label: `Satisfacción · ${touchpoint.label}`,
      availability: availabilityOf(touchpoint.satisfaction),
      responseContext: contextOf(touchpoint.satisfaction.base),
      provenance: "measured_aggregate",
      section: "journey",
      members: [],
      address: { at: "journey.touchpoint", touchpointIndex: index, measure: "satisfaction" },
    });
    drafts.push({
      handle: presentationHandle("value", "touchpoint", "tdp", segment),
      semantic: "touchpoint_process_unawareness",
      label: `No lo conoce · ${touchpoint.label}`,
      availability: availabilityOf(touchpoint.tdp),
      responseContext: contextOf(touchpoint.tdp.base),
      provenance: "measured_aggregate",
      section: "journey",
      members: [],
      address: { at: "journey.touchpoint", touchpointIndex: index, measure: "tdp" },
    });
    drafts.push({
      handle: presentationHandle("value", "touchpoint", "unaware", "share", segment),
      semantic: "touchpoint_unawareness_share",
      label: `Proporción auxiliar de desconocimiento · ${touchpoint.label}`,
      availability: availabilityOf(touchpoint.unawareShareOfResponses),
      responseContext: contextOf(touchpoint.unawareShareOfResponses.base),
      provenance: "derived_share",
      section: "journey",
      members: [],
      address: { at: "journey.touchpoint", touchpointIndex: index, measure: "unawareShare" },
    });
  });

  const groupUsed = new Set<string>();
  results.journey.groups.forEach((group, index) => {
    const members = group.touchpointKeys
      .map((key) => touchpointHandleByKey.get(key))
      .filter((handle): handle is PresentationHandle => handle !== undefined);
    drafts.push({
      handle: presentationHandle("journey-group", uniqueSegment(groupUsed, group.label, index + 1)),
      semantic: "journey_group",
      label: group.label,
      availability: "available",
      responseContext: null,
      provenance: "source_reported",
      section: "journey",
      members,
      address: { at: "journey.group", groupIndex: index },
    });
  });

  /* ---- qualitative ---- */

  const qualitativeUsed = new Set<string>();
  results.qualitative.groups.forEach((group, index) => {
    drafts.push({
      handle: presentationHandle("qualitative", uniqueSegment(qualitativeUsed, group.label, index + 1)),
      semantic: "qualitative_terms",
      label: group.label,
      availability: group.terms.length === 0 ? "unavailable" : "available",
      responseContext: contextOf(group.base),
      provenance: "curated_category",
      section: "qualitative",
      members: [],
      address: { at: "qualitative.group", groupIndex: index },
    });
  });

  /* ---- performance ---- */

  const performanceUsed = new Set<string>();
  results.performance.dimensions.forEach((dimension, index) => {
    drafts.push({
      handle: presentationHandle("series", "performance", uniqueSegment(performanceUsed, dimension.label, index + 1)),
      semantic: "performance_series",
      label: dimension.label,
      availability: dimension.periods.length === 0 ? "unavailable" : "available",
      responseContext: null,
      provenance: "measured_aggregate",
      section: "performance",
      members: [],
      address: { at: "performance.dimension", dimensionIndex: index },
    });
  });

  /* ---- editorial and configuration slots ---- */

  const requirementUsed = new Set<string>();
  results.configurationRequired.forEach((requirement, index) => {
    drafts.push({
      handle: presentationHandle("editorial", uniqueSegment(requirementUsed, requirement.key, index + 1)),
      semantic: "editorial_slot",
      // NOT `requirement.key`. That key is contract vocabulary written in the
      // same snake_case as the warehouse — `journey_stage_evidence` contains the
      // canonical table name `journey_stage` — and an entry label is client-
      // facing text. The label says WHO owes the content; the blueprint supplies
      // the heading a reader actually sees.
      label:
        requirement.kind === "editorial_review"
          ? "Contenido editorial pendiente de redacción"
          : "Contenido pendiente de configuración del estudio",
      // A settled answer, never a defect: the contract states who supplies it.
      availability: "configuration_required",
      responseContext: null,
      provenance: requirement.kind === "editorial_review" ? "editorial" : "study_configuration",
      section: "none",
      members: [],
      address: { at: "configuration.requirement", requirementIndex: index },
    });
  });

  /* ---- finish ---- */

  const allDimensionHandles = dimensionHandles.map(({ handle }) => handle);
  const entries: RegistryEntry[] = drafts.map((draft) => {
    const forbidden = forbiddenFor(draft.section);
    const acceptsFilters = draft.section !== "none";
    const supported = acceptsFilters
      ? allDimensionHandles.filter((handle) => !forbidden.includes(handle))
      : [];
    return {
      handle: draft.handle,
      semantic: draft.semantic,
      label: draft.label,
      displayFormats: SEMANTIC_UNITS[draft.semantic],
      compatibleVariants: COMPATIBLE_CHART_VARIANTS[draft.semantic],
      availability: draft.availability,
      responseContext: draft.responseContext,
      provenance: draft.provenance,
      supportedFilters: supported.slice().sort(compareHandles),
      forbiddenFilters: forbidden.slice().sort(compareHandles),
      members: draft.members,
    };
  });

  entries.sort((a, b) => compareHandles(a.handle, b.handle));

  const addresses = new Map<PresentationHandle, CanonicalAddress>();
  for (const draft of drafts) addresses.set(draft.handle, draft.address);

  return {
    registryVersion: CANONICAL_PRESENTATION_REGISTRY_VERSION,
    contractVersion: results.contractVersion,
    entries,
    addresses,
  };
}

/** Look one entry up by handle. */
export function registryEntry(
  registry: CanonicalPresentationRegistry,
  handle: PresentationHandle,
): RegistryEntry | null {
  return registry.entries.find((entry) => entry.handle === handle) ?? null;
}
