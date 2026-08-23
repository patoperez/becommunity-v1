// =============================================================================
// Dependency-exception register matcher (docs/P7_PLAN.md §6.3).
// =============================================================================
// An exception excuses ONE advisory, on ONE package, at ONE installed version,
// at ONE severity. The seven §6.3 fields are preserved exactly; what is tightened
// is how they are read: identity is parsed and compared exactly, never by
// substring. A free-text field that merely *contains* a package name and an
// advisory id must not excuse a different version or a different severity.
//
// Pure module: no filesystem, no process, no network — so the self-test can
// exercise it directly. Nothing here handles or emits credential material.
// =============================================================================

/** The seven fields required by §6.3. An entry missing one is not an exception. */
export const REQUIRED_EXCEPTION_FIELDS = [
  "package_and_version",
  "advisory_id_and_severity",
  "dependency_path",
  "reachability",
  "compensating_control",
  "approver",
  "review_date",
];

/** §6.3 reachability vocabulary — exactly one of these three, nothing else. */
export const REACHABILITY_VALUES = ["Worker runtime", "build-time only", "dev-only"];

export const SEVERITIES = ["critical", "high", "moderate", "low"];

const PLACEHOLDER_APPROVERS =
  /^(tbd|todo|to be decided|pending|n\/a|na|none|unknown|anyone|someone|team|claude|codex|copilot|agent|ai|bot|automated|automation)$/i;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ADVISORY_ID = /^(?:GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}|CVE-\d{4}-\d{4,})$/i;

/**
 * `"js-yaml@4.3.0"` / `"@scope/pkg@1.2.3"` -> `{ name, version }`.
 * Requires an exact version; a range, tag, or bare name is not an identity.
 */
export function parsePackageAndVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return null;
  const name = trimmed.slice(0, at);
  const version = trimmed.slice(at + 1);
  if (!name || !EXACT_VERSION.test(version)) return null;
  return { name, version };
}

/** `"GHSA-5p4m-2wfm-xmqj high"` -> `{ id, severity }`. */
export function parseAdvisoryIdAndSeverity(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/[\s,;|]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [id, severity] = parts;
  if (!ADVISORY_ID.test(id)) return null;
  if (!SEVERITIES.includes(severity.toLowerCase())) return null;
  return { id: id.toUpperCase(), severity: severity.toLowerCase() };
}

/**
 * Completeness, human approval, live review date, and parseable identity.
 * Returns `{ ok: true, parsed }` or `{ ok: false, reason }`.
 */
export function validateEntry(entry, now = Date.now()) {
  const missing = REQUIRED_EXCEPTION_FIELDS.filter(
    (f) => typeof entry?.[f] !== "string" || entry[f].trim() === "",
  );
  if (missing.length > 0) return { ok: false, reason: `missing field(s): ${missing.join(", ")}` };

  const identity = parsePackageAndVersion(entry.package_and_version);
  if (!identity) {
    return {
      ok: false,
      reason: "package_and_version must be exactly `name@x.y.z` with an exact installed version",
    };
  }

  const advisory = parseAdvisoryIdAndSeverity(entry.advisory_id_and_severity);
  if (!advisory) {
    return {
      ok: false,
      reason: "advisory_id_and_severity must be exactly `<GHSA-…|CVE-…> <severity>`",
    };
  }

  if (!REACHABILITY_VALUES.includes(entry.reachability.trim())) {
    return {
      ok: false,
      reason: `reachability must be exactly one of: ${REACHABILITY_VALUES.join(" | ")}`,
    };
  }

  if (PLACEHOLDER_APPROVERS.test(entry.approver.trim())) {
    return { ok: false, reason: "approver is a placeholder, not a human approval" };
  }

  const review = Date.parse(entry.review_date);
  if (Number.isNaN(review)) return { ok: false, reason: "review_date is not a parseable date" };
  if (review < now) return { ok: false, reason: `review_date ${entry.review_date} has passed` };

  return { ok: true, parsed: { ...identity, advisoryId: advisory.id, severity: advisory.severity } };
}

/**
 * Split a register into validated entries and rejections. A rejection is a
 * FAILURE for the caller, never a silent drop — an incomplete exception makes
 * the gate redder, not greener.
 */
export function loadRegister(register, now = Date.now()) {
  const valid = [];
  const rejected = [];
  for (const entry of register?.exceptions ?? []) {
    const verdict = validateEntry(entry, now);
    if (verdict.ok) valid.push({ entry, parsed: verdict.parsed });
    else rejected.push({ entry, reason: verdict.reason });
  }
  return { valid, rejected };
}

/**
 * Does a validated entry actually excuse THIS advisory?
 *
 * `advisory` = `{ name, severity, advisoryIds: [...], installedVersions: [...] }`.
 * All four must line up exactly: package name, one installed version, the
 * advisory id, and the severity. No substring, no prefix, no "close enough".
 */
export function matchesAdvisory(validated, advisory) {
  const { parsed } = validated;
  if (parsed.name !== advisory.name) return false;
  if (!advisory.installedVersions.includes(parsed.version)) return false;
  if (parsed.severity !== advisory.severity) return false;
  return advisory.advisoryIds.some((id) => String(id).toUpperCase() === parsed.advisoryId);
}

/**
 * Focused self-test. Runs on every Suite D invocation so a regression in the
 * matcher shows up as a red gate rather than as a silently widened exception.
 * Fixtures are synthetic package metadata only — no credential-shaped literal.
 * Returns the ids of the cases that behaved incorrectly.
 */
export function selfTest(now = Date.now()) {
  const future = new Date(now + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const past = new Date(now - 24 * 3600 * 1000).toISOString().slice(0, 10);

  const base = {
    package_and_version: "example-lib@1.2.3",
    advisory_id_and_severity: "GHSA-aaaa-bbbb-cccc high",
    dependency_path: "root > example-parent > example-lib",
    reachability: "dev-only",
    compensating_control: "not reachable from any runtime path; pinned and monitored",
    approver: "A. Human (recorded in the PR review)",
    review_date: future,
  };

  const advisory = {
    name: "example-lib",
    severity: "high",
    advisoryIds: ["GHSA-AAAA-BBBB-CCCC"],
    installedVersions: ["1.2.3"],
  };

  const failures = [];
  const expectAccepted = (id, entry) => {
    const v = validateEntry(entry, now);
    if (!v.ok) return failures.push(`${id}: expected valid, rejected as "${v.reason}"`);
    if (!matchesAdvisory({ entry, parsed: v.parsed }, advisory)) {
      failures.push(`${id}: valid entry failed to match its own advisory`);
    }
  };
  const expectNoMatch = (id, entry) => {
    const v = validateEntry(entry, now);
    if (!v.ok) return; // rejected outright is an even stronger refusal
    if (matchesAdvisory({ entry, parsed: v.parsed }, advisory)) {
      failures.push(`${id}: entry wrongly excused the advisory`);
    }
  };
  const expectRejected = (id, entry) => {
    if (validateEntry(entry, now).ok) failures.push(`${id}: expected rejection, was accepted`);
  };

  expectAccepted("exact-valid", base);

  expectNoMatch("wrong-version", { ...base, package_and_version: "example-lib@1.2.4" });
  expectNoMatch("wrong-severity", {
    ...base,
    advisory_id_and_severity: "GHSA-aaaa-bbbb-cccc moderate",
  });
  expectNoMatch("wrong-advisory-id", {
    ...base,
    advisory_id_and_severity: "GHSA-dddd-eeee-ffff high",
  });
  expectNoMatch("wrong-package", { ...base, package_and_version: "other-lib@1.2.3" });
  // The substring trap the old matcher fell into: a name that merely CONTAINS
  // the vulnerable package's name must not excuse it.
  expectNoMatch("substring-package", { ...base, package_and_version: "not-example-lib@1.2.3" });
  expectNoMatch("free-text-identity", {
    ...base,
    package_and_version: "example-lib (any version) GHSA-aaaa-bbbb-cccc",
  });

  expectRejected("placeholder-approver", { ...base, approver: "TBD" });
  expectRejected("agent-approver", { ...base, approver: "automated" });
  expectRejected("expired-review-date", { ...base, review_date: past });
  expectRejected("incomplete-entry", { ...base, compensating_control: "" });
  const { compensating_control: _dropped, ...withoutField } = base;
  expectRejected("missing-field", withoutField);
  expectRejected("invalid-reachability", { ...base, reachability: "probably fine" });
  expectRejected("range-version", { ...base, package_and_version: "example-lib@^1.2.3" });
  expectRejected("bare-package-name", { ...base, package_and_version: "example-lib" });
  expectRejected("malformed-advisory", { ...base, advisory_id_and_severity: "GHSA-aaaa high" });

  return failures;
}
