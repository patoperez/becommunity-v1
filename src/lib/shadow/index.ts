/**
 * The shadow comparison — the SAFE surface.
 *
 * Everything exported here is pure and transport-free: the diagnostic
 * contract, the flag and allowlist policy, the semantic comparator, and the
 * workflow with its canonical reader injected.
 *
 * This barrel deliberately does NOT re-export `server.ts` OR `sink.ts`. Both
 * are `server-only` — the first holds the one code path that constructs a
 * privileged client, the second the one place a run may be recorded — and
 * re-exporting either here would make every importer of this file server-only
 * by accident. They are reached through `./server` and `./sink`, which exist to
 * make those imports deliberate acts — the same rule `canonical-source/index.ts`
 * and `canonical-commit/index.ts` follow.
 */
export {
  COMPARISON_RULES,
  COMPATIBILITY_CLASSIFICATIONS,
  MISMATCH_KINDS,
  NOTE_CODES,
  SHADOW_FINDING_KEYS,
  SHADOW_SECTIONS,
  SHADOW_STATUSES,
  decimalsRule,
  inertDiagnostics,
} from "./contract";
export type {
  ComparisonRule,
  CompatibilityClassification,
  MismatchKind,
  NoteCode,
  ShadowDiagnostics,
  ShadowFilterScope,
  ShadowFinding,
  ShadowFindingKey,
  ShadowSection,
  ShadowStatus,
} from "./contract";

export { runtimeShadowRecord, safeDimensionKeys } from "./diagnostics";
export type { ShadowRuntimeFinding, ShadowRuntimeRecord } from "./diagnostics";

export {
  DEFAULT_SHADOW_BUDGET_MS,
  ENV_SHADOW_BUDGET_MS,
  ENV_SHADOW_MODE,
  ENV_SHADOW_SCOPES,
  MAX_SHADOW_BUDGET_MS,
  SHADOW_ENABLED_LITERAL,
  parseShadowBudget,
  parseShadowScopes,
  resolveShadowPolicy,
} from "./policy";
export type { ShadowPolicy, ShadowScope } from "./policy";

export {
  CONFIGURATION_REQUIRED_PREFIXES,
  DIRECTLY_CORRESPONDING_LEGACY_KEYS,
  compareLegacyWithCanonical,
  parseLegacyBase,
  parseLegacyNumber,
  parseNpsBase,
} from "./compare";

export { TimeoutSignal, describeFilterScope, runShadowComparison } from "./orchestrate";
export type { CanonicalReader, ShadowRunParams } from "./orchestrate";
