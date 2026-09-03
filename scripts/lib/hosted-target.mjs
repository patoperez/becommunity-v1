// =============================================================================
// Hosted-target authorization guard
// =============================================================================
// THIS IS THE OPPOSITE OF `disposable-postgres.mjs`, AND THE TWO MUST STAY
// SEPARATE MODULES.
//
//   `disposable-postgres.mjs` refuses ANYTHING that looks like Supabase. It
//   guards a gate whose whole job is to create and destroy databases, so its
//   safety property is "never touch something real".
//
//   This module accepts EXACTLY ONE named Supabase target and refuses
//   everything else. It guards a gate whose whole job is to touch something
//   real, so its safety property is "never touch a target nobody named".
//
// Merging them would destroy both: a guard that both refuses Supabase and
// accepts one Supabase project has no coherent rule left.
//
// -----------------------------------------------------------------------------
// WHY EACH RULE EXISTS
// -----------------------------------------------------------------------------
//   ref            The project is named explicitly, in the shape Supabase uses
//                  for a project ref, or the literal `local`. There is NO
//                  default: an unset variable is a refusal, never a fallback,
//                  because a fallback is how a run reaches a project nobody
//                  chose.
//   acknowledgement A second variable that must SPELL OUT the same ref. One
//                  variable can be supplied by a stale shell or an environment
//                  file; two that must agree, one of which names the target
//                  inside a sentence about mutation, cannot be supplied by
//                  accident. This is the rule that stops a `.env` alone from
//                  authorizing anything.
//   host           The API URL is derived from the ref and, if one is supplied,
//                  the supplied URL must resolve to exactly that host. A ref
//                  and a URL that disagree is a refusal, not a preference.
//   service key    Presence is required; the VALUE is never read for anything
//                  but presence, never logged, never returned in a message,
//                  never written to an artifact.
//   prefix         Every tenant and study a run creates carries it, and the
//                  runner refuses to write to any object that does not. It is
//                  what makes "delete exactly what this run made" decidable.
//
// EVERY REFUSAL NAMES THE RULE AND NEVER THE VALUE THAT BROKE IT. A message
// that quoted the value would put a project ref, an acknowledgement or — worst
// — a key fragment into a log.
//
// NO CODE PATH IN THIS MODULE READS A `.env` FILE, AT ANY POINT.
// =============================================================================

/** A Supabase project ref: twenty lowercase letters. */
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

/** The one non-project target: the local stack. */
export const LOCAL_REF = "local";

/** The local stack's API origin, fixed by the Supabase CLI's own defaults. */
export const LOCAL_API_ORIGIN = "http://127.0.0.1:54321";

/** Every run stamps its objects with this, so cleanup is decidable. */
export const DISPOSABLE_PREFIX_PATTERN = /^U4-[A-Z0-9]{6}$/;

export const ENV_REF = "CANONICAL_HOSTED_TARGET_REF";
export const ENV_ACKNOWLEDGE = "CANONICAL_HOSTED_ACKNOWLEDGE";
export const ENV_SERVICE_KEY = "CANONICAL_HOSTED_SERVICE_KEY";
export const ENV_PREFIX = "CANONICAL_HOSTED_DISPOSABLE_PREFIX";
export const ENV_API_URL = "CANONICAL_HOSTED_API_URL";
export const ENV_ANON_KEY = "CANONICAL_HOSTED_ANON_KEY";

export class HostedTargetError extends Error {}

const refuse = (reason) => {
  throw new HostedTargetError(reason);
};

/** The sentence the operator must write, for a given ref. */
export function acknowledgementFor(ref) {
  return `I-AUTHORIZE-MUTATION-OF-${ref}`;
}

/**
 * Objects a run must leave EXACTLY as it found them.
 *
 * The five legacy tables carry the product's existing data; the canonical
 * tables carry Unit 3's. A run creates its own tenant and study, writes a
 * package, reverses it, and deletes what it made — so every count in this list
 * must be identical before and after. Counts only: no row is ever read.
 */
export const PROTECTED_TABLES = Object.freeze([
  // Existing product tables.
  "tenant",
  "study",
  "respondent",
  "quant_response",
  "qual_observation",
  // Migration 0022 — ingestion foundation (18).
  "source_asset",
  "import_job",
  "import_job_asset",
  "visual_annotation",
  "person_private",
  "person_external_identifier",
  "study_participant",
  "membership_episode",
  "attribute_definition",
  "participant_attribute_value",
  "response_scale",
  "response_option",
  "survey_instrument",
  "study_domain",
  "survey_item",
  "survey_session",
  "survey_response",
  "source_lineage",
  // Migration 0023 — analysis model (16).
  "performance_dimension",
  "performance_observation",
  "band_scheme",
  "band_rule",
  "metric_definition",
  "metric_item_link",
  "journey_model",
  "journey_stage",
  "journey_stage_evidence_link",
  "organizational_unit",
  "culture_dimension",
  "pain_point",
  "pain_point_journey_stage",
  "pain_point_organizational_unit",
  "pain_point_performance_dimension",
  "pain_point_culture_dimension",
  // Migration 0024 — commit, ownership and rollback (2).
  "retention_period",
  "import_job_record",
]);

/**
 * Resolve and VALIDATE the hosted target.
 *
 * Returns `{ ref, isLocal, apiOrigin, restUrl, disposablePrefix, serviceKey }`.
 * `serviceKey` is the only field carrying a secret; it exists so the caller can
 * build a client and must never be logged, returned to a user, or written to an
 * artifact. `describeTarget()` below is the safe thing to print.
 */
export function resolveHostedTarget(env) {
  // (a) the ref
  const rawRef = env[ENV_REF];
  if (typeof rawRef !== "string" || rawRef.trim() === "") {
    refuse(`${ENV_REF} is not set. This gate has no default target: a target nobody named is a refusal.`);
  }
  const ref = rawRef.trim();
  const isLocal = ref === LOCAL_REF;
  if (!isLocal && !PROJECT_REF_PATTERN.test(ref)) {
    refuse(`${ENV_REF} is neither the literal '${LOCAL_REF}' nor a twenty-letter Supabase project ref.`);
  }

  // (b) the acknowledgement, which must spell out the SAME ref
  const rawAck = env[ENV_ACKNOWLEDGE];
  if (typeof rawAck !== "string" || rawAck.trim() === "") {
    refuse(
      `${ENV_ACKNOWLEDGE} is not set. A target alone does not authorize a mutation; ` +
        "the acknowledgement must name it explicitly.",
    );
  }
  if (rawAck.trim() !== acknowledgementFor(ref)) {
    refuse(
      `${ENV_ACKNOWLEDGE} does not name the target in ${ENV_REF}. ` +
        "The two must agree, so neither a stale shell nor an environment file can authorize a run on its own.",
    );
  }

  // (c) the host, derived from the ref and refused if a supplied URL disagrees
  const derivedOrigin = isLocal ? LOCAL_API_ORIGIN : `https://${ref}.supabase.co`;
  const expectedHost = isLocal ? "127.0.0.1:54321" : `${ref}.supabase.co`;
  let apiOrigin = derivedOrigin;
  const rawUrl = env[ENV_API_URL];
  if (typeof rawUrl === "string" && rawUrl.trim() !== "") {
    let parsed;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      refuse(`${ENV_API_URL} is not a URL.`);
    }
    if (parsed.host !== expectedHost) {
      refuse(`${ENV_API_URL} does not resolve to the host the target ref implies.`);
    }
    if (!isLocal && parsed.protocol !== "https:") {
      refuse(`${ENV_API_URL} must use https for a hosted project.`);
    }
    apiOrigin = `${parsed.protocol}//${parsed.host}`;
  }

  // (d) the service key — presence only. Its value is never inspected further.
  const serviceKey = env[ENV_SERVICE_KEY];
  if (typeof serviceKey !== "string" || serviceKey.trim() === "") {
    refuse(`${ENV_SERVICE_KEY} is not set. Its value is never logged; only its presence is checked here.`);
  }

  // (e) the disposable prefix
  const rawPrefix = env[ENV_PREFIX];
  if (typeof rawPrefix !== "string" || rawPrefix.trim() === "") {
    refuse(`${ENV_PREFIX} is not set. Without it a run cannot prove which objects are its own.`);
  }
  const disposablePrefix = rawPrefix.trim();
  if (!DISPOSABLE_PREFIX_PATTERN.test(disposablePrefix)) {
    refuse(`${ENV_PREFIX} does not match the required U4-XXXXXX shape.`);
  }

  const anonKey = typeof env[ENV_ANON_KEY] === "string" && env[ENV_ANON_KEY].trim() !== ""
    ? env[ENV_ANON_KEY].trim()
    : null;

  return Object.freeze({
    ref,
    isLocal,
    apiOrigin,
    expectedHost,
    restUrl: `${apiOrigin}/rest/v1/`,
    disposablePrefix,
    serviceKey: serviceKey.trim(),
    anonKey,
  });
}

/**
 * The safe description of a target. Everything here may be printed, logged and
 * written to an artifact; the service key is deliberately absent.
 */
export function describeTarget(target) {
  return {
    ref: target.ref,
    isLocal: target.isLocal,
    apiOrigin: target.apiOrigin,
    disposablePrefix: target.disposablePrefix,
    serviceKeyPresent: typeof target.serviceKey === "string" && target.serviceKey.length > 0,
    anonKeyPresent: target.anonKey !== null,
  };
}

/** True when a name belongs to this run and may therefore be deleted by it. */
export function isDisposableName(target, name) {
  return typeof name === "string" && name.includes(target.disposablePrefix);
}

/** Refuse to write to an object this run did not create. */
export function assertDisposableName(target, label, name) {
  if (!isDisposableName(target, name)) {
    refuse(
      `${label} does not carry this run's disposable prefix. A run may only create, ` +
        "write to and delete objects it stamped as its own.",
    );
  }
  return name;
}

/**
 * Compare two protected-object censuses and refuse if ANY count moved.
 *
 * A census is `{ tableName: integerCount }`. Both sides must describe the same
 * set of tables: a table that appears on one side only is itself a finding,
 * because it means the schema changed under the run.
 */
export function assertProtectedObjectsUnchanged(before, after) {
  if (!before || typeof before !== "object") refuse("the 'before' census is missing.");
  if (!after || typeof after !== "object") refuse("the 'after' census is missing.");

  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const moved = [];
  for (const name of names) {
    const from = before[name];
    const to = after[name];
    if (typeof from !== "number" || !Number.isInteger(from)) {
      moved.push(`${name}: not counted before`);
      continue;
    }
    if (typeof to !== "number" || !Number.isInteger(to)) {
      moved.push(`${name}: not counted after`);
      continue;
    }
    if (from !== to) moved.push(`${name}: ${from} -> ${to}`);
  }
  if (moved.length > 0) {
    refuse(
      `${moved.length} protected object count(s) changed across the run: ${moved.join(", ")}. ` +
        "A run must leave every pre-existing object exactly as it found it.",
    );
  }
  return true;
}
