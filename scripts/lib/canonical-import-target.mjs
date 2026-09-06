// =============================================================================
// The REAL-IMPORT authorization guard
// =============================================================================
// THIS IS THE THIRD GUARD IN THIS FOLDER AND IT MUST STAY SEPARATE FROM THE
// OTHER TWO. Each one guards a different kind of run and each one's safety
// property contradicts the others':
//
//   `disposable-postgres.mjs`   refuses ANYTHING that looks like Supabase. It
//                               guards a gate whose job is to create and
//                               destroy whole databases.
//   `hosted-target.mjs`         accepts one named Supabase project and demands
//                               a `U4-` DISPOSABLE PREFIX, because every object
//                               that run makes it must be able to delete again.
//   this module                 accepts one named Supabase project, one named
//                               tenant, one named study and one named plan
//                               FINGERPRINT — and REFUSES a disposable prefix,
//                               because the rows this run writes are the real
//                               client's and must never be deletable "because
//                               the run made them".
//
// Merging any two of them would leave no coherent rule in either.
//
// -----------------------------------------------------------------------------
// WHY EACH RULE EXISTS
// -----------------------------------------------------------------------------
//   ref             The project is named explicitly. There is NO default: an
//                   unset variable is a refusal, never a fallback, because a
//                   fallback is how a run reaches a project nobody chose.
//   acknowledgement A second variable that must SPELL OUT the same ref inside a
//                   sentence about importing. One variable can be supplied by a
//                   stale shell or an environment file; two that must agree
//                   cannot be supplied by accident.
//   --project       And a THIRD naming, on the command line, at the moment of
//                   the act. An environment can be inherited; an argument is
//                   typed.
//   --execute       Absent, the operator is a DRY RUN and cannot mutate. The
//                   default is refusal, not action.
//   tenant, study   Full uuids, both of them. An eight-character prefix is not
//                   an identity: this project has already had two studies whose
//                   rows were identical and whose prefixes were not the thing
//                   that told them apart.
//   fingerprint     The exact plan the owner approved. The operator rebuilds
//                   the plan from the bytes it was handed and refuses if the
//                   fingerprint differs by one character.
//   mapping version The projection contract the fingerprint belongs to.
//   service key     Presence only. The VALUE is never read for anything else,
//                   never logged, never returned in a message, never written to
//                   an artifact.
//   evidence dir    Required for `--execute`, and validated OUTSIDE every git
//                   repository, because the import-job id has to survive the
//                   run and must never be committed.
//
// EVERY REFUSAL NAMES THE RULE AND NEVER THE VALUE THAT BROKE IT. A message
// that quoted the value would put a project ref, a study id, an acknowledgement
// or — worst — a key fragment into a log.
//
// NO CODE PATH IN THIS MODULE READS A `.env` FILE, AT ANY POINT.
// =============================================================================

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** A Supabase project ref: twenty lowercase letters. */
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

/** The one non-project target: a local PostgREST stack, for the rehearsal. */
export const LOCAL_REF = "local";
export const LOCAL_API_ORIGIN = "http://127.0.0.1:54321";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

export const ENV_REF = "CANONICAL_IMPORT_PROJECT_REF";
export const ENV_ACKNOWLEDGE = "CANONICAL_IMPORT_ACKNOWLEDGE";
export const ENV_SERVICE_KEY = "CANONICAL_IMPORT_SERVICE_KEY";
export const ENV_API_URL = "CANONICAL_IMPORT_API_URL";
export const ENV_TENANT = "CANONICAL_IMPORT_TENANT_ID";
export const ENV_STUDY = "CANONICAL_IMPORT_STUDY_ID";
export const ENV_FINGERPRINT = "CANONICAL_IMPORT_PLAN_FINGERPRINT";
export const ENV_MAPPING_VERSION = "CANONICAL_IMPORT_MAPPING_VERSION";
export const ENV_PACKAGE_KEY = "CANONICAL_IMPORT_PACKAGE_KEY";
export const ENV_EVIDENCE_DIR = "CANONICAL_IMPORT_EVIDENCE_DIR";
export const ENV_CLEAN_XLSX = "CANONICAL_IMPORT_CLEAN_XLSX";
export const ENV_PAIN_XLSX = "CANONICAL_IMPORT_PAIN_XLSX";

/** The variables `hosted-target.mjs` owns. Their presence here is a refusal. */
const DISPOSABLE_VARIABLES = ["CANONICAL_HOSTED_DISPOSABLE_PREFIX"];

export class ImportTargetError extends Error {}

const refuse = (reason) => {
  throw new ImportTargetError(reason);
};

/** The sentence the operator must write, for a given ref. */
export function acknowledgementFor(ref) {
  return `I-AUTHORIZE-CANONICAL-IMPORT-INTO-${ref}`;
}

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/**
 * Read a path recorded by git, which may be written for the OTHER platform.
 *
 * This repository is edited on Windows and its gates run in WSL, so a linked
 * worktree's `.git` file names the main repository as `C:/dev/.../repo`. Left
 * as-is, `resolve()` on Linux treats that as RELATIVE, the containment check
 * never matches, and the guard silently stops guarding. Same rule, same
 * reason, as `hosted-evidence.mjs`.
 */
function normalizeRecordedPath(raw) {
  const trimmed = raw.trim();
  const windows = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  if (windows && process.platform !== "win32") {
    return `/mnt/${windows[1].toLowerCase()}/${windows[2].replace(/\\/g, "/")}`;
  }
  return trimmed;
}

function mainRepositoryRoot() {
  const dotGit = join(REPO_ROOT, ".git");
  try {
    if (!existsSync(dotGit)) return null;
    const match = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    // <main>/.git/worktrees/<name>  ->  <main>
    return resolve(dirname(dirname(dirname(normalizeRecordedPath(match[1])))));
  } catch {
    return null;
  }
}

const isInside = (parent, child) => {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};

/**
 * Resolve and VALIDATE the evidence directory. Creates it if it does not exist.
 *
 * The import-job id is the one operational fact that has to outlive the run,
 * and it is exactly the sort of thing a `git add -A` would sweep into a commit.
 * So the directory is proved to be outside the worktree AND outside the main
 * repository the worktree is linked to, before anything is written.
 */
export function resolveImportEvidenceDirectory(env) {
  const raw = env[ENV_EVIDENCE_DIR];
  if (typeof raw !== "string" || raw.trim() === "") {
    refuse(`${ENV_EVIDENCE_DIR} is not set. An execution must leave its import-job id somewhere outside Git.`);
  }
  const chosen = resolve(raw.trim());
  if (!chosen.startsWith(sep) && !/^[A-Za-z]:[\\/]/.test(chosen)) {
    refuse(`${ENV_EVIDENCE_DIR} must be an absolute path.`);
  }
  if (isInside(REPO_ROOT, chosen)) {
    refuse(
      `${ENV_EVIDENCE_DIR} is inside the worktree. Evidence written into the tree is evidence ` +
        "the next `git add -A` commits.",
    );
  }
  const mainRoot = mainRepositoryRoot();
  if (mainRoot && isInside(mainRoot, chosen)) {
    refuse(`${ENV_EVIDENCE_DIR} is inside the main repository this worktree is linked to.`);
  }
  mkdirSync(chosen, { recursive: true, mode: 0o700 });
  return chosen;
}

/**
 * Parse the command line.
 *
 * `--execute` is the only thing that turns the operator from a dry run into a
 * mutation, and it is inert without `--project <ref>` naming the same project
 * the environment named.
 */
export function parseImportArguments(argv) {
  const options = { execute: false, project: null, expectReplay: false, rollbackJobId: null, unknown: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--execute") options.execute = true;
    else if (argument === "--expect-replay") options.expectReplay = true;
    else if (argument === "--project") options.project = argv[++index] ?? null;
    else if (argument.startsWith("--project=")) options.project = argument.slice("--project=".length);
    else if (argument === "--rollback-import-job") options.rollbackJobId = argv[++index] ?? null;
    else if (argument.startsWith("--rollback-import-job=")) {
      options.rollbackJobId = argument.slice("--rollback-import-job=".length);
    } else options.unknown.push(argument);
  }
  if (options.unknown.length > 0) refuse("the operator was given an argument it does not recognise.");
  if (options.rollbackJobId !== null && !UUID.test(options.rollbackJobId)) {
    refuse("--rollback-import-job needs the import job's uuid.");
  }
  return options;
}

/**
 * Resolve and VALIDATE the whole target.
 *
 * Returns everything the operator needs and exactly one field carrying a
 * secret — `serviceKey`, which exists so a client can be built and must never
 * be logged, returned to a user or written to an artifact. `describeImportTarget`
 * below is the safe thing to print.
 */
export function resolveImportTarget(env, options) {
  // (a) nothing from the DISPOSABLE guard may be in scope. Its prefix means
  //     "everything this run makes may be deleted afterwards", which is the
  //     opposite of what a real import means.
  for (const name of DISPOSABLE_VARIABLES) {
    if (typeof env[name] === "string" && env[name].trim() !== "") {
      refuse(
        `${name} is set. That variable belongs to the disposable acceptance run, whose rule is that ` +
          "everything it creates may be deleted again. A real import must never run under it.",
      );
    }
  }

  // (b) the ref
  const rawRef = env[ENV_REF];
  if (typeof rawRef !== "string" || rawRef.trim() === "") {
    refuse(`${ENV_REF} is not set. This operator has no default target: a target nobody named is a refusal.`);
  }
  const ref = rawRef.trim();
  const isLocal = ref === LOCAL_REF;
  if (!isLocal && !PROJECT_REF_PATTERN.test(ref)) {
    refuse(`${ENV_REF} is neither the literal '${LOCAL_REF}' nor a twenty-letter Supabase project ref.`);
  }

  // (c) the acknowledgement, which must spell out the SAME ref
  const rawAck = env[ENV_ACKNOWLEDGE];
  if (typeof rawAck !== "string" || rawAck.trim() === "") {
    refuse(`${ENV_ACKNOWLEDGE} is not set. A target alone does not authorize an import.`);
  }
  if (rawAck.trim() !== acknowledgementFor(ref)) {
    refuse(
      `${ENV_ACKNOWLEDGE} does not name the target in ${ENV_REF}. The two must agree, so neither a ` +
        "stale shell nor an environment file can authorize a run on its own.",
    );
  }

  // (d) and the command line must name it a third time, whenever it mutates
  if (options.execute) {
    if (typeof options.project !== "string" || options.project.trim() === "") {
      refuse("--execute needs --project <ref>. A mutation is named on the command line, not only in the environment.");
    }
    if (options.project.trim() !== ref) {
      refuse(`--project does not name the target in ${ENV_REF}.`);
    }
  }

  // (e) the host, derived from the ref and refused if a supplied URL disagrees
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
    if (parsed.host !== expectedHost) refuse(`${ENV_API_URL} does not resolve to the host the target ref implies.`);
    if (!isLocal && parsed.protocol !== "https:") refuse(`${ENV_API_URL} must use https for a hosted project.`);
    apiOrigin = `${parsed.protocol}//${parsed.host}`;
  }

  // (f) the service key — presence only
  const serviceKey = env[ENV_SERVICE_KEY];
  if (typeof serviceKey !== "string" || serviceKey.trim() === "") {
    refuse(`${ENV_SERVICE_KEY} is not set. Its value is never logged; only its presence is checked here.`);
  }

  // (g) the exact tenant and the exact study, both as full uuids
  const tenantId = (env[ENV_TENANT] ?? "").trim();
  const studyId = (env[ENV_STUDY] ?? "").trim();
  if (!UUID.test(tenantId)) refuse(`${ENV_TENANT} is not a full uuid. A prefix is not an identity.`);
  if (!UUID.test(studyId)) refuse(`${ENV_STUDY} is not a full uuid. A prefix is not an identity.`);

  // (h) the exact plan the owner approved
  const planFingerprint = (env[ENV_FINGERPRINT] ?? "").trim();
  if (!FINGERPRINT.test(planFingerprint)) {
    refuse(`${ENV_FINGERPRINT} is not a sha256 plan fingerprint. The operator imports one named plan and no other.`);
  }
  const mappingVersion = Number((env[ENV_MAPPING_VERSION] ?? "").trim());
  if (!Number.isInteger(mappingVersion) || mappingVersion <= 0) {
    refuse(`${ENV_MAPPING_VERSION} is not a positive integer.`);
  }
  const rawPackageKey = (env[ENV_PACKAGE_KEY] ?? "").trim();
  if (rawPackageKey !== "" && !FINGERPRINT.test(rawPackageKey)) {
    refuse(`${ENV_PACKAGE_KEY} is set but is not a sha256 package key.`);
  }

  // (i) the two source files
  const cleanPath = (env[ENV_CLEAN_XLSX] ?? "").trim();
  const painPath = (env[ENV_PAIN_XLSX] ?? "").trim();
  if (cleanPath === "" || painPath === "") {
    refuse(`${ENV_CLEAN_XLSX} and ${ENV_PAIN_XLSX} must both name a readable workbook.`);
  }
  if (!existsSync(cleanPath) || !existsSync(painPath)) refuse("one of the two source workbooks does not exist.");

  // (j) evidence, only when the run may mutate
  const evidenceDirectory = options.execute ? resolveImportEvidenceDirectory(env) : null;

  return Object.freeze({
    ref,
    isLocal,
    apiOrigin,
    expectedHost,
    restUrl: `${apiOrigin}/rest/v1/`,
    serviceKey: serviceKey.trim(),
    tenantId,
    studyId,
    planFingerprint,
    mappingVersion,
    packageIdempotencyKey: rawPackageKey === "" ? null : rawPackageKey,
    cleanPath,
    painPath,
    evidenceDirectory,
    execute: options.execute === true,
    expectReplay: options.expectReplay === true,
    rollbackJobId: options.rollbackJobId,
  });
}

/**
 * The safe description of a target.
 *
 * Everything here may be printed, logged and written to an artifact. The
 * service key is deliberately absent, and the file paths are reduced to their
 * base names because a full path can name a person's home directory.
 */
export function describeImportTarget(target) {
  const base = (path) => path.replace(/^.*[\\/]/, "");
  return {
    ref: target.ref,
    isLocal: target.isLocal,
    apiOrigin: target.apiOrigin,
    tenantId: target.tenantId,
    studyId: target.studyId,
    planFingerprint: target.planFingerprint,
    mappingVersion: target.mappingVersion,
    packageIdempotencyKey: target.packageIdempotencyKey,
    cleanFile: base(target.cleanPath),
    painFile: base(target.painPath),
    serviceKeyPresent: typeof target.serviceKey === "string" && target.serviceKey.length > 0,
    mode: target.execute ? "EXECUTE" : "DRY RUN",
    evidenceDirectory: target.evidenceDirectory,
  };
}
