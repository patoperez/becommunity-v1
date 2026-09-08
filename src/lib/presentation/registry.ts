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
  AppliedFilter,
  CanonicalStudyResults,
  FilterDimension,
  MetricResult,
  ResultBase,
} from "../results/contract";
import {
  CANONICAL_PRESENTATION_REGISTRY_VERSION,
  COMPATIBLE_CHART_VARIANTS,
  SEMANTIC_UNITS,
  type PresentationAvailability,
  type PresentationSemantic,
  type ProvenanceCategory,
} from "./capabilities";
import { sha256Hex } from "../ingestion/canonical-commit/sha256";
import type { PresentationCatalog, RegistryEntry, ResponseContext } from "./catalog";
import type { PresentationDocument } from "./document";
import {
  compareHandles,
  presentationHandle,
  slugifyLabel,
  type PresentationHandle,
} from "./handles";
import {
  filterOptionToken,
  viewerPanelOffers,
  type ViewerConstraint,
  type ViewerOffer,
} from "./viewer";

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
 * WHICH EXACT RESULTS DOCUMENT a registry was built from. SERVER ONLY.
 *
 * Unit 6A checked only that the contract VERSIONS agreed, which is a check two
 * different studies pass together. Because every `CanonicalAddress` is an array
 * POSITION, a registry from study A handed study B's results resolves every
 * handle successfully and silently answers with the wrong numbers — the worst
 * failure this layer could have, because nothing looks broken.
 *
 * None of these fields reaches a catalogue or a render model. They exist so the
 * resolver can refuse.
 */
export type RegistrySource = {
  tenantId: string;
  studyId: string;
  specId: string;
  mappingVersion: number;
  calculationVersion: string;
  packageIdempotencyKey: string;
  planFingerprint: string;
};

/**
 * The registry.
 *
 * `entries` is ordered by handle in codepoint order so two builds of the same
 * document enumerate identically. `addresses` and `source` are the server-only
 * half; `binding` is the one piece a stored document may keep.
 */
export type CanonicalPresentationRegistry = {
  registryVersion: string;
  /** The results contract this registry describes. A resolver cross-checks it. */
  contractVersion: string;
  /** SERVER ONLY. The exact results document behind this registry. */
  source: RegistrySource;
  /**
   * The BINDING FINGERPRINT — 64 hex, and safe to store in a document.
   *
   * A one-way digest over the study scope, the plan and package identity, both
   * versions, and the ENTIRE ordered handle-to-address map. It exposes none of
   * those (that is what a digest is for) and it changes whenever any of them
   * does — which is precisely what makes a saved binding refuse instead of
   * silently retargeting after a label is renamed, a group reordered, or a
   * dimension or touchpoint inserted earlier.
   */
  binding: string;
  entries: readonly RegistryEntry[];
  /** SERVER ONLY. Dropped by `projectCatalog`; absent from every render model. */
  addresses: ReadonlyMap<PresentationHandle, CanonicalAddress>;
  /**
   * SERVER ONLY. What each filter dimension may be constrained to.
   *
   * The token is an ORDINAL POSITION, the label is the study's own Spanish, and
   * the `value` is the canonical string the filter engine matches on. Only the
   * first two ever cross to a browser; the third is the reason this map is on
   * the server half, because a cohort's value is the enum `active` and an
   * attribute's is a respondent's own answer text.
   *
   * A reader's selection therefore arrives as positions and is turned back into
   * values HERE, which is what makes it impossible for a browser to name a
   * value the study never offered.
   */
  filterOptions: ReadonlyMap<PresentationHandle, readonly RegistryFilterOption[]>;
};

/** One value a filter dimension may be constrained to. SERVER ONLY as a whole. */
export type RegistryFilterOption = {
  /** Opaque ordinal token — the only half a browser ever sees, with the label. */
  token: string;
  /** The study's own words for this value. Client-safe. */
  label: string;
  /** The canonical value the filter engine matches on. NEVER crosses. */
  value: string;
  /** How many people carry it in the UNFILTERED population. Client-safe. */
  participants: number;
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

/**
 * WHICH SECTIONS A PARTICIPANT FILTER CAN ACTUALLY MOVE.
 *
 * This was `draft.section !== "none"`, and that was wrong for exactly one
 * section. RETENTION is measured over the period's ROSTER — the membership at
 * the start of the period — and not over the people who answered anything, so
 * `buildRetention` refuses to recompute under ANY participant selection and
 * returns `cross_not_permitted` for every period. The registry meanwhile
 * advertised that retention supported every dimension, so the editor would
 * happily connect a retention block to a panel, the resolver would accept the
 * connection, and the block would then go blank at reading time under a refusal
 * the author was never shown.
 *
 * A capability the calculation layer does not have must not be advertised. It
 * is a `Record` over the closed section vocabulary rather than an exclusion
 * list, so a section added later cannot inherit an answer nobody gave.
 *
 * `none` is the sections that are not a measurement at all — a filter control,
 * an editorial slot — and they accept nothing for a different reason: there is
 * no number to recompute.
 */
const SECTION_ACCEPTS_PARTICIPANT_FILTERS: Readonly<Record<ContractSection, boolean>> = Object.freeze({
  population: true,
  recommendation: true,
  renewal: true,
  // The roster is not the respondents. `src/lib/results/retention.ts` states it
  // and enforces it; this is the same fact, said where an editor can read it.
  retention: false,
  journey: true,
  performance: true,
  qualitative: true,
  none: false,
});

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
  const filterOptions = new Map<PresentationHandle, readonly RegistryFilterOption[]>();
  results.filters.dimensions.forEach((dimension, index) => {
    const handle = presentationHandle("dimension", uniqueSegment(dimensionUsed, dimension.label, index + 1));
    dimensionHandles.push({ handle, dimension });
    // THE OPTIONS, MINTED ONCE, HERE.
    //
    // The token is the value's ORDINAL POSITION in the dimension the canonical
    // layer published. That list is derived from the source alone and never
    // from an active selection, so a position means the same thing for as long
    // as the package behind it does — and the binding fingerprint already
    // refuses a document whose package moved.
    filterOptions.set(
      handle,
      dimension.values.map((value, position) => ({
        token: filterOptionToken(position),
        label: value.label,
        value: value.value,
        participants: value.participants,
      })),
    );
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
    // NOT `requirement.key`. Those keys are contract vocabulary written in the
    // same snake_case as the warehouse, and one of them —
    // `journey_stage_evidence` — contains the canonical table name
    // `journey_stage`. Slugifying it to `journey-stage-evidence` does not stop
    // it being that name; it only stops a scan written in snake_case from
    // seeing it, which is worse. The handle is built from the requirement's
    // SECTION and KIND instead: closed vocabulary, no storage name, and stable
    // as long as a section does not need two slots of the same kind — and if it
    // ever does, `uniqueSegment` disambiguates with an ordinal.
    drafts.push({
      handle: presentationHandle(
        "editorial",
        uniqueSegment(requirementUsed, `${requirement.section} ${requirement.kind}`, index + 1),
      ),
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
    const acceptsFilters = SECTION_ACCEPTS_PARTICIPANT_FILTERS[draft.section];
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

  const source: RegistrySource = {
    tenantId: results.study.tenantId,
    studyId: results.study.studyId,
    specId: results.study.specId,
    mappingVersion: results.study.mappingVersion,
    calculationVersion: results.study.calculationVersion,
    packageIdempotencyKey: results.study.packageIdempotencyKey,
    planFingerprint: results.study.planFingerprint,
  };

  return {
    registryVersion: CANONICAL_PRESENTATION_REGISTRY_VERSION,
    contractVersion: results.contractVersion,
    source,
    binding: presentationBindingFingerprint({
      registryVersion: CANONICAL_PRESENTATION_REGISTRY_VERSION,
      contractVersion: results.contractVersion,
      source,
      addresses,
    }),
    entries,
    addresses,
    filterOptions,
  };
}

/**
 * The binding fingerprint.
 *
 * Everything that could make a saved handle mean something different goes in:
 * the study it belongs to, the plan and package that produced it, both
 * versions, and every handle beside the exact address it resolves to, in a
 * fixed order. A rename, a reorder or an insertion moves at least one handle or
 * one address, so the digest moves with it.
 *
 * `sha256Hex` is the product's own synchronous SHA-256 — self-contained,
 * allocation-light, workerd-safe, and already pinned against
 * `crypto.subtle.digest` by the Unit 3 gate, so this cannot drift from the hash
 * every other identity in the system uses.
 */
export function presentationBindingFingerprint(input: {
  registryVersion: string;
  contractVersion: string;
  source: RegistrySource;
  addresses: ReadonlyMap<PresentationHandle, CanonicalAddress>;
}): string {
  const map = [...input.addresses.entries()]
    .sort((a, b) => compareHandles(a[0], b[0]))
    .map(([handle, address]) => {
      const fields = Object.keys(address)
        .sort()
        .map((key) => `${key}=${String((address as Record<string, unknown>)[key])}`)
        .join(",");
      return `${handle}->${fields}`;
    })
    .join("\n");
  const scope = [
    `registry=${input.registryVersion}`,
    `contract=${input.contractVersion}`,
    `tenant=${input.source.tenantId}`,
    `study=${input.source.studyId}`,
    `spec=${input.source.specId}`,
    `mapping=${input.source.mappingVersion}`,
    `calculation=${input.source.calculationVersion}`,
    `package=${input.source.packageIdempotencyKey}`,
    `plan=${input.source.planFingerprint}`,
  ].join("\n");
  return sha256Hex(`${scope}\n--\n${map}`);
}

/** Look one entry up by handle. */
export function registryEntry(
  registry: CanonicalPresentationRegistry,
  handle: PresentationHandle,
): RegistryEntry | null {
  return registry.entries.find((entry) => entry.handle === handle) ?? null;
}

/**
 * Bind a template to one registry — the explicit instantiation act.
 *
 * A study-agnostic template may travel unbound; the moment it becomes a
 * document ABOUT a study it must say which registry produced the handles it
 * names, so a later resolution can prove the address map has not moved
 * underneath it. Binding is therefore something a caller does on purpose, never
 * something resolution does silently on the caller's behalf.
 */
export function bindPresentationDocument<T extends { registryVersion: string; binding: string | null }>(
  document: T,
  registry: CanonicalPresentationRegistry,
): T {
  return { ...document, registryVersion: registry.registryVersion, binding: registry.binding };
}

/**
 * What this document, against this registry, legitimately offers a reader.
 *
 * TWO HALVES FROM TWO PLACES, and neither may be taken from the request. Which
 * panels exist and which dimensions each one OFFERS comes from the DOCUMENT —
 * an author put the control there, and putting it there is what made the cross
 * it creates get checked against every block that panel moves. Which option
 * tokens exist comes from the REGISTRY, which minted them from the study's own
 * unfiltered values.
 *
 * A selection is validated against this and against nothing else.
 */
export function viewerOfferFor(
  document: PresentationDocument,
  registry: CanonicalPresentationRegistry,
): ViewerOffer {
  const options = new Map<PresentationHandle, ReadonlySet<string>>();
  for (const [handle, list] of registry.filterOptions) {
    options.set(handle, new Set(list.map((option) => option.token)));
  }
  return { panels: viewerPanelOffers(document), options };
}

/**
 * Turn a reader's positions back into the values the filter engine matches on.
 *
 * THE ONLY PLACE THE TRANSLATION HAPPENS, and it is a lookup rather than a
 * parse: a token that is not in the map produced by this study's own results is
 * refused, so there is no string a browser can send that becomes a value the
 * study never published. `null` means refuse — never "apply what parsed".
 *
 * One `AppliedFilter` per constraint, and constraints repeating a dimension are
 * NOT merged. `applyFilters` requires a person to satisfy every entry, so two
 * panels constraining the same dimension differently intersect — which is what
 * "several panels moving one block combine as AND" means. Merging them here
 * could produce an empty value list, and an empty list means "not constrained"
 * to that engine: the one spelling that would turn "nobody matches" into
 * "everybody matches".
 */
export function viewerAppliedFilters(
  registry: CanonicalPresentationRegistry,
  results: CanonicalStudyResults,
  constraints: readonly ViewerConstraint[],
): AppliedFilter[] | null {
  const applied: AppliedFilter[] = [];
  for (const constraint of constraints) {
    const handle = constraint.handle as PresentationHandle;
    const address = registry.addresses.get(handle);
    if (!address || address.at !== "filter.dimension") return null;
    const dimension = results.filters.dimensions[address.dimensionIndex];
    if (!dimension) return null;
    const options = registry.filterOptions.get(handle);
    if (!options) return null;

    const values: string[] = [];
    for (const token of constraint.options) {
      const option = options.find((candidate) => candidate.token === token);
      if (!option) return null;
      values.push(option.value);
    }
    if (values.length === 0) return null;
    applied.push({ dimensionKey: dimension.key, values });
  }
  return applied;
}

/**
 * Project a registry into its client-reachable catalogue.
 *
 * The address map is dropped and nothing replaces it. `entries` is already
 * sorted by handle when the registry is built, so the catalogue is
 * deterministic without re-sorting.
 */
export function projectPresentationCatalog(registry: CanonicalPresentationRegistry): PresentationCatalog {
  return {
    registryVersion: registry.registryVersion,
    contractVersion: registry.contractVersion,
    entries: registry.entries,
  };
}
