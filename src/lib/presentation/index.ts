/**
 * THE CANONICAL PRESENTATION LAYER — the safe surface.
 *
 * Everything exported here is pure, deterministic and free of any transport.
 * There is no Supabase client, no credential and no `server-only` marker in the
 * folder, for the same reason `src/lib/results/` has none: an offline gate must
 * be able to build a registry, resolve a blueprint and compare the result with
 * the approved dashboard without a database anywhere near it.
 *
 * The boundary that matters is not a marker, it is a rule, and it is executed.
 * `npm run test:canonical-presentation` fails if a module here reaches a
 * database or a network, if it imports a calculator, if a canonical key reaches
 * a client-reachable structure, or if a value is computed rather than read.
 *
 * A future editor imports the CATALOGUE and receives a RENDER MODEL. It never
 * imports the registry's address map, and it never imports `src/lib/calc/`.
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

export { buildCanonicalPresentationRegistry, registryEntry } from "./registry";
export type {
  CanonicalAddress,
  CanonicalPresentationRegistry,
  RegistryEntry,
  ResponseContext,
} from "./registry";

export { projectPresentationCatalog } from "./catalog";
export type { PresentationCatalog, PresentationCatalogEntry } from "./catalog";

export {
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
  EditorialBlock,
  FilterPanelBlock,
  JourneyRoute,
  JourneyRoutesBlock,
  PresentationBlock,
  PresentationDocument,
  PresentationPage,
  PublicationMetadata,
  ResponsiveBehavior,
  ResultBlock,
  SampleDisplayPolicy,
} from "./document";

export { SERIALIZED_BYTE_LIMIT, serializeDeterministic, serializedBytes, withinSizeLimit } from "./serialize";

export { resolvePresentation } from "./resolve";
export type { ResolveInput } from "./resolve";

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
  RenderSeriesPoint,
  RenderTerm,
  RenderValue,
} from "./render-model";
