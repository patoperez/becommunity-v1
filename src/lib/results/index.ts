/**
 * The canonical study results read model — the SAFE surface.
 *
 * Everything exported here is pure, deterministic and free of any transport.
 * There is no Supabase client, no credential and no `server-only` marker in the
 * folder, which is what lets an offline gate run the real calculations over a
 * real projection and compare them with the approved dashboard.
 *
 * The BOUNDARY that matters is not a marker, it is a rule, and it is executed:
 * `npm run test:canonical-results` fails if any module here reaches a database
 * or a network, and if any React component or browser module in `src/` owns a
 * business formula. A future dashboard imports the CONTRACT and receives the
 * DOCUMENT; it never imports a calculator.
 */

export { buildCanonicalStudyResults } from "./build";
export type { BuildResultsOptions } from "./build";

export { CANONICAL_RESULTS_CONTRACT_VERSION, emptyAccounting, emptyBase } from "./contract";
export type {
  AnswerAccounting,
  AppliedFilter,
  AuthorityReference,
  CanonicalStudyResults,
  CohortResult,
  ConfigurationRequirement,
  CuratedFindingCount,
  FilterDimension,
  FilterResult,
  FilterValue,
  InstrumentBaseResult,
  JourneyExclusion,
  JourneyGroupResult,
  JourneyModelResult,
  JourneyResult,
  JourneyStageEvidenceLink,
  JourneyStageEvidenceResult,
  JourneyTouchpointResult,
  MetricResult,
  NpsDistribution,
  NpsScopeResult,
  PerformanceDimensionResult,
  PerformancePeriodResult,
  PeriodCount,
  PopulationResult,
  QualitativeGroupResult,
  QualitativeTerm,
  RenewalCategoryResult,
  RenewalResult,
  ResultBand,
  ResultBase,
  ResultCandidate,
  ResultInternalProvenance,
  ResultProvenance,
  ResultStatus,
  ResultUnit,
  ResultValue,
  RetentionPeriodResult,
  SemanticColor,
  StudyIdentity,
  StudyPeriod,
  UnavailableReason,
  UnresolvedItem,
  UnresolvedReason,
} from "./contract";

export { AUTHORITIES, authority, authorities } from "./authorities";
export type { AuthorityRank, RegisteredAuthority } from "./authorities";

export { CANONICAL_RESULTS_SPECS, CUICUILCO_RESULTS_V1 } from "./spec";
export type {
  ExcludedTouchpointSpec,
  ForbiddenCrossSpec,
  NpsScopeSpec,
  QualitativeGroupSpec,
  StudyResultsSpec,
} from "./spec";

export { emptyResultSource } from "./source";
export type {
  CanonicalResultSource,
  ResultAnswer,
  ResultAttributeDefinition,
  ResultAttributeValue,
  ResultBandRule,
  ResultBandScheme,
  ResultCultureDimension,
  ResultCuratedFinding,
  ResultDomain,
  ResultInstrument,
  ResultItem,
  ResultJourneyModel,
  ResultJourneyStage,
  ResultJourneyStageEvidence,
  ResultMetricDefinition,
  ResultNamedEntity,
  ResultParticipant,
  ResultPerformanceDimension,
  ResultPerformanceObservation,
  ResultRetentionPeriod,
  ResultScaleOption,
  ResultSession,
  ResultSourceIdentity,
} from "./source";

export { applyFilters, buildFilterDimensions, crossIsForbidden, ANSWERED_NOT_CARRIED, COHORT_DIMENSION_KEY } from "./filters";
export type { FilterEvaluation } from "./filters";

export { buildLookup, scopeParticipants, scopeSessions } from "./lookup";
export type { ResultLookup, ResultScope } from "./lookup";

export { RESULT_DECIMALS, makeValue, resolveBand, resolveSchemeBand, share } from "./measure";

export { buildPopulation } from "./population";
export { buildRecommendation } from "./recommendation";
export { buildRenewal } from "./renewal";
export { buildRetention } from "./retention";
export { buildJourney, buildStageEvidence } from "./journey";
export { buildPerformance } from "./performance";
export { buildCuratedFindingCounts, buildQualitativeGroups } from "./qualitative";

export { canonicalResultSourceFromCommitPlan } from "./adapters/commit-plan";
export type { CommitPlanAdapterOptions } from "./adapters/commit-plan";
