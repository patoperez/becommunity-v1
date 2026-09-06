/**
 * The database-backed canonical read model — the SAFE surface.
 *
 * Everything exported here is pure and transport-free: row shapes, the read
 * workflow with its transport injected, the assembler that turns rows into a
 * `CanonicalResultSource`, and the shared comparison order that lets the
 * in-memory and database adapters be compared as data.
 *
 * This barrel deliberately does NOT re-export `adapter.ts`. That module is
 * `server-only` and holds the one code path that has a database connection;
 * re-exporting it here would make every importer of this file server-only by
 * accident. The adapter is reached through `./server`, which exists to make
 * that import a deliberate act — the same rule `canonical-commit/index.ts`
 * follows for the write path.
 */
export { canonicalResultSourceFromRows } from "./assemble";
export type { CanonicalDatabaseAdapterOptions } from "./assemble";

export { normalizeCanonicalResultSource } from "./normalize";

export { keysetFilter, postgrestReadTransport, requireUuid } from "./postgrest";
export type { PostgrestReadClient, PostgrestScopedQuery } from "./postgrest";

export {
  CANONICAL_READS,
  CANONICAL_READ_PAGE_SIZE,
  CanonicalReadError,
  loadCanonicalRowSet,
  readCanonicalTable,
} from "./read";
export type {
  CanonicalReadName,
  CanonicalReadRequest,
  CanonicalReadScope,
  CanonicalReadTransport,
  LoadCanonicalRowSetOptions,
} from "./read";

export type {
  AttributeDefinitionRow,
  BandRuleRow,
  BandSchemeRow,
  CanonicalRowSet,
  CanonicalTableRead,
  CultureDimensionRow,
  ImportJobRow,
  JourneyModelRow,
  JourneyStageEvidenceLinkRow,
  JourneyStageRow,
  MetricDefinitionRow,
  OrganizationalUnitRow,
  PainPointCultureDimensionRow,
  PainPointJourneyStageRow,
  PainPointOrganizationalUnitRow,
  PainPointPerformanceDimensionRow,
  PainPointRow,
  ParticipantAttributeValueRow,
  PerformanceDimensionRow,
  PerformanceObservationRow,
  ResponseOptionRow,
  ResponseScaleRow,
  RetentionPeriodRow,
  StudyDomainRow,
  StudyParticipantRow,
  SurveyInstrumentRow,
  SurveyItemRow,
  SurveyResponseRow,
  SurveySessionRow,
} from "./rows";
