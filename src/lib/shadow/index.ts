/**
 * The shadow comparison — the SAFE surface.
 *
 * Everything exported here is pure and transport-free: the diagnostic
 * contract, the flag and allowlist policy, the semantic comparator, and the
 * workflow with its canonical reader injected.
 *
 * This barrel deliberately does NOT re-export `server.ts`. That module is
 * `server-only` and holds the one code path that constructs a privileged
 * client; re-exporting it here would make every importer of this file
 * server-only by accident. It is reached through `./server`, which exists to
 * make that import a deliberate act — the same rule `canonical-source/index.ts`
 * and `canonical-commit/index.ts` follow.
 */
export {
  COMPATIBILITY_CLASSIFICATIONS,
  MISMATCH_KINDS,
  SHADOW_STATUSES,
  inertDiagnostics,
} from "./contract";
export type {
  CompatibilityClassification,
  MismatchKind,
  ShadowDiagnostics,
  ShadowFinding,
  ShadowStatus,
} from "./contract";

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

export { filterFingerprint, runShadowComparison } from "./orchestrate";
export type { CanonicalReader, ShadowRunParams } from "./orchestrate";
