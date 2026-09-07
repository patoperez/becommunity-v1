/**
 * WHETHER THE SHADOW MAY RUN AT ALL — decided once, from an injected
 * environment, before any canonical module is asked to do anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DISABLED IS THE DEFAULT, AND IT IS THE DEFAULT TWICE OVER. An unset flag is
 * off; an unparseable flag is off; a flag set to anything but the exact literal
 * is off. There is no truthiness here: `"false"`, `"0"`, `"no"` and a typo all
 * mean off, because a feature that turns itself on when somebody sets it to
 * `"false"` is worse than no flag at all.
 *
 * AND AN EXACT ALLOWLIST, NOT A PATTERN. The flag alone authorizes nothing: the
 * tenant and study must BOTH appear, as full uuids, in one entry of
 * `BECOMMUNITY_SHADOW_SCOPES`. A prefix is not an identity — this project has
 * already had two studies whose rows were identical and whose eight-character
 * prefixes were not what told them apart.
 *
 * THE ENVIRONMENT IS INJECTED. This module never reads `process.env` itself, so
 * the offline gate can execute every refusal without a global, and so the file
 * stays pure and transport-free. `server.ts` is the only place that supplies
 * the real environment.
 *
 * NOTHING HERE IS AN AUTHORIZATION CHECK. The user, the session and the tenant
 * are validated by `loadAuthorizedStudyData` before this is ever consulted;
 * this decides only whether an already-authorized study may ALSO be read
 * canonically. Both must hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The one literal that turns the shadow on. Anything else means off. */
export const SHADOW_ENABLED_LITERAL = "enabled";

export const ENV_SHADOW_MODE = "BECOMMUNITY_SHADOW_MODE";
export const ENV_SHADOW_SCOPES = "BECOMMUNITY_SHADOW_SCOPES";
export const ENV_SHADOW_BUDGET_MS = "BECOMMUNITY_SHADOW_BUDGET_MS";

/** The default and the ceiling for the shadow's wall-clock budget. */
export const DEFAULT_SHADOW_BUDGET_MS = 1500;
export const MAX_SHADOW_BUDGET_MS = 5000;

export type ShadowScope = { tenantId: string; studyId: string };

export type ShadowPolicy =
  | { allowed: false; reason: "disabled_by_flag" | "scope_not_allowlisted"; budgetMs: number }
  | { allowed: true; budgetMs: number };

/**
 * Parse `tenant:study,tenant:study` into exact pairs.
 *
 * An entry that is not two full uuids separated by one colon is DROPPED, not
 * repaired: a half-understood allowlist entry must never widen the allowlist.
 */
export function parseShadowScopes(raw: unknown): ShadowScope[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const scopes: ShadowScope[] = [];
  for (const entry of raw.split(",")) {
    const parts = entry.trim().toLowerCase().split(":");
    if (parts.length !== 2) continue;
    const [tenantId, studyId] = parts;
    if (!UUID.test(tenantId) || !UUID.test(studyId)) continue;
    if (scopes.some((scope) => scope.tenantId === tenantId && scope.studyId === studyId)) continue;
    scopes.push({ tenantId, studyId });
  }
  return scopes;
}

/** The budget, clamped. An absent, malformed or excessive value falls back. */
export function parseShadowBudget(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_SHADOW_BUDGET_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return DEFAULT_SHADOW_BUDGET_MS;
  return Math.min(parsed, MAX_SHADOW_BUDGET_MS);
}

/**
 * Decide, for one already-authorized study, whether the shadow may run.
 *
 * The order matters and is the safety property: the flag is checked first, so a
 * deployment with the flag off never even parses an allowlist, and a scope that
 * is absent from the allowlist is refused before any canonical module is named.
 */
export function resolveShadowPolicy(env: Record<string, string | undefined>, scope: ShadowScope): ShadowPolicy {
  const budgetMs = parseShadowBudget(env[ENV_SHADOW_BUDGET_MS]);
  if (env[ENV_SHADOW_MODE] !== SHADOW_ENABLED_LITERAL) {
    return { allowed: false, reason: "disabled_by_flag", budgetMs };
  }
  const tenantId = scope.tenantId.toLowerCase();
  const studyId = scope.studyId.toLowerCase();
  if (!UUID.test(tenantId) || !UUID.test(studyId)) {
    return { allowed: false, reason: "scope_not_allowlisted", budgetMs };
  }
  const allowed = parseShadowScopes(env[ENV_SHADOW_SCOPES]).some(
    (entry) => entry.tenantId === tenantId && entry.studyId === studyId,
  );
  return allowed ? { allowed: true, budgetMs } : { allowed: false, reason: "scope_not_allowlisted", budgetMs };
}
