/**
 * THE CLIENT-SAFE PRESENTATION SURFACE - schemas, catalogue DTOs, render types.
 *
 * WHAT THIS BARREL DELIBERATELY DOES NOT EXPORT.
 *
 * Unit 6A exported `buildCanonicalPresentationRegistry`, `CanonicalAddress`,
 * `CanonicalPresentationRegistry` and `resolvePresentation` from here. Nothing
 * imported them yet, so nothing was broken - but the machinery that binds a
 * handle to a POSITION inside a results document was one `import` away from a
 * `"use client"` file, and a boundary that depends on nobody noticing is not a
 * boundary.
 *
 * So the split is explicit. Everything reachable from here is a SHAPE: the
 * closed vocabulary, opaque handle helpers, typed errors, the authorable
 * document and its validator, deterministic serialization, the catalogue rows an
 * editor may browse, and the public render-model types a renderer draws.
 *
 * The registry's address map, exact result binding, persistence encoding and
 * resolution live in `./server`, behind `import "server-only"`. An offline gate
 * may import the pure implementation modules directly - that is what gates are
 * for - but production client code cannot reach them through this file, and an
 * import-graph gate proves it.
 */

export {
  CANONICAL_PRESENTATION_REGISTRY_VERSION,
  COMPATIBLE_CHART_VARIANTS,
  METHODOLOGY_DISCLOSURE_LEVELS,
  PRESENTATION_SEMANTICS,
  SEMANTIC_UNITS,
  chartVariantIsCompatible,
} from "./capabilities";
export type {
  ChartVariant,
  MethodologyDisclosureLevel,
  PresentationAvailability,
  PresentationSemantic,
  ProvenanceCategory,
} from "./capabilities";

export {
  PRESENTATION_FACETS,
  compareHandles,
  handleFacet,
  isPresentationHandle,
  parsePresentationHandle,
  presentationHandle,
  slugifyLabel,
} from "./handles";
export type { PresentationFacet, PresentationHandle } from "./handles";

export { PresentationError, compareIssues, failure, issue, success } from "./errors";
export type { PresentationErrorCode, PresentationIssue, PresentationOutcome } from "./errors";

/** Catalogue ROWS only. The registry that produces them is server-only. */
export type {
  PresentationCatalog,
  PresentationCatalogEntry,
  RegistryEntry,
  ResponseContext,
} from "./catalog";

export {
  DEFAULT_DISPLAY_FORMAT,
  DEFAULT_SAMPLE_POLICY,
  GRID_COLUMNS,
  LEGACY_EXPERIENCE_SCHEMA_VERSIONS,
  PRESENTATION_DOCUMENT_KIND,
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  duplicateBlock,
  duplicatePage,
  validatePresentationDocument,
} from "./document";
export type {
  AuthoredCopy,
  BlockPlacement,
  Breakpoint,
  DisplayFormat,
  EditorialBlock,
  FilterPanelBlock,
  JourneyRoute,
  JourneyRoutesBlock,
  PresentationBlock,
  PresentationDocument,
  PresentationPage,
  ResponsiveBehavior,
  ResultBlock,
  SampleDisplayPolicy,
} from "./document";

export { SERIALIZED_BYTE_LIMIT, serializeDeterministic, serializedBytes, withinSizeLimit } from "./serialize";

/** Public render-model TYPES. The resolver that produces them is server-only. */
export type {
  PresentationRenderModel,
  RenderAbsence,
  RenderBand,
  RenderBlock,
  RenderCategory,
  RenderCohort,
  RenderFilterDimension,
  RenderInstrumentBase,
  RenderMeasure,
  RenderMethodology,
  RenderPage,
  RenderPayload,
  RenderRoute,
  RenderRoutePoint,
  RenderSampleDisplay,
  RenderSeriesPoint,
  RenderTerm,
  RenderValue,
} from "./render-model";
