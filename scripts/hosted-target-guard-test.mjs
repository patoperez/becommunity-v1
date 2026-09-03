// =============================================================================
// MANDATORY hosted-target guard gate
//   npx tsx scripts/hosted-target-guard-test.mjs
// =============================================================================
// `scripts/lib/hosted-target.mjs` decides whether a run may mutate a real
// Supabase project. That decision is worth exactly as much as the tests behind
// it, and a rule exercised only when somebody remembers to run a hosted gate is
// not a rule — so every refusal is executed HERE, in `npm test`. Weakening one
// is a red offline gate, not a surprise during a run against a live project.
//
// This gate is the mirror image of section [19] of `canonical-commit-test.mjs`,
// which does the same job for the DISPOSABLE guard. The two guards are opposite
// in shape on purpose: one refuses anything that looks like Supabase, the other
// accepts exactly one named Supabase target. Both are proved the same way.
//
// It contacts nothing. `resolveHostedTarget` is a pure function of an
// environment object, so every case below is a plain function call with a
// synthetic environment — no network, no filesystem, no `.env`.
//
// No credential appears in this file. The service-key fixture is an obviously
// synthetic token assembled at runtime, so no credential-shaped literal is
// committed to a file the history scanner reads.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

import {
  DISPOSABLE_PREFIX_PATTERN,
  ENV_ACKNOWLEDGE,
  ENV_ANON_KEY,
  ENV_API_URL,
  ENV_PREFIX,
  ENV_REF,
  ENV_SERVICE_KEY,
  HostedTargetError,
  LOCAL_API_ORIGIN,
  LOCAL_REF,
  PROJECT_REF_PATTERN,
  PROTECTED_TABLES,
  acknowledgementFor,
  assertDisposableName,
  assertProtectedObjectsUnchanged,
  describeTarget,
  isDisposableName,
  resolveHostedTarget,
} from "./lib/hosted-target.mjs";
import {
  ENV_EVIDENCE_DIR,
  EvidenceError,
  TRANSPORT_FIELDS,
  createTransportJournal,
  resolveEvidenceDirectory,
  serializedBytes,
  writeArtifact,
} from "./lib/hosted-evidence.mjs";
import { scanText } from "./lib/secret-patterns.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

// An obviously synthetic stand-in, assembled so no key-shaped literal is
// committed. Its VALUE is never asserted on; only its presence matters.
const FAKE_KEY = ["not", "a", "real", "service", "key"].join("-");
const HOSTED_REF = "abcdefghijklmnopqrst";
const OTHER_REF = "tsrqponmlkjihgfedcba";

const base = (overrides = {}) => ({
  [ENV_REF]: HOSTED_REF,
  [ENV_ACKNOWLEDGE]: acknowledgementFor(HOSTED_REF),
  [ENV_SERVICE_KEY]: FAKE_KEY,
  [ENV_PREFIX]: "U4-ABC123",
  ...overrides,
});

/** Returns the refusal message, or null when the target was accepted. */
const refused = (env) => {
  try {
    resolveHostedTarget(env);
    return null;
  } catch (thrown) {
    if (thrown instanceof HostedTargetError) return thrown.message;
    return `WRONG ERROR TYPE: ${thrown?.message ?? thrown}`;
  }
};

console.log("Be Community — hosted-target guard gate");

// ---- [1] The shapes the guard is built on ---------------------------------
console.log("\n[1] The patterns are what the contract says they are");
{
  check(PROJECT_REF_PATTERN.test(HOSTED_REF), "a twenty-letter ref matches the project-ref pattern");
  check(!PROJECT_REF_PATTERN.test("abcdefghijklmnopqrs"), "nineteen letters do not");
  check(!PROJECT_REF_PATTERN.test("abcdefghijklmnopqrstu"), "twenty-one letters do not");
  check(!PROJECT_REF_PATTERN.test("ABCDEFGHIJKLMNOPQRST"), "uppercase does not");
  check(!PROJECT_REF_PATTERN.test("abcdefghijklmnopqrs1"), "a digit does not");
  check(DISPOSABLE_PREFIX_PATTERN.test("U4-ABC123"), "U4-ABC123 is a valid disposable prefix");
  check(DISPOSABLE_PREFIX_PATTERN.test("U4-LOCAL1"), "and so is U4-LOCAL1");
  check(!DISPOSABLE_PREFIX_PATTERN.test("U4-abc123"), "a lowercase prefix is not");
  check(!DISPOSABLE_PREFIX_PATTERN.test("U4-ABC12"), "five characters after the dash are not");
  check(!DISPOSABLE_PREFIX_PATTERN.test("U3-ABC123"), "and neither is the wrong unit number");
  check(
    acknowledgementFor(HOSTED_REF) === `I-AUTHORIZE-MUTATION-OF-${HOSTED_REF}`,
    "the acknowledgement sentence names the ref verbatim",
  );
}

// ---- [2] Every refusal --------------------------------------------------
console.log("\n[2] Every rule refuses, and names the rule rather than the value");
{
  const cases = [
    ["a missing ref", { ...base(), [ENV_REF]: undefined }, ENV_REF],
    ["an empty ref", { ...base(), [ENV_REF]: "   " }, ENV_REF],
    ["a malformed ref (too short)", { ...base(), [ENV_REF]: "abcdefghij" }, ENV_REF],
    ["a malformed ref (uppercase)", { ...base(), [ENV_REF]: "ABCDEFGHIJKLMNOPQRST" }, ENV_REF],
    ["a malformed ref (digits)", { ...base(), [ENV_REF]: "abcdefghijklmnopqr12" }, ENV_REF],
    ["a ref that is a hostname", { ...base(), [ENV_REF]: `${HOSTED_REF}.supabase.co` }, ENV_REF],
    ["a missing acknowledgement", { ...base(), [ENV_ACKNOWLEDGE]: undefined }, ENV_ACKNOWLEDGE],
    ["an empty acknowledgement", { ...base(), [ENV_ACKNOWLEDGE]: "" }, ENV_ACKNOWLEDGE],
    [
      "an acknowledgement naming a DIFFERENT ref",
      { ...base(), [ENV_ACKNOWLEDGE]: acknowledgementFor(OTHER_REF) },
      ENV_ACKNOWLEDGE,
    ],
    [
      "an acknowledgement with the wrong wording",
      { ...base(), [ENV_ACKNOWLEDGE]: `I-AUTHORISE-MUTATION-OF-${HOSTED_REF}` },
      ENV_ACKNOWLEDGE,
    ],
    [
      "an acknowledgement for local while the ref is hosted",
      { ...base(), [ENV_ACKNOWLEDGE]: acknowledgementFor(LOCAL_REF) },
      ENV_ACKNOWLEDGE,
    ],
    ["a missing service key", { ...base(), [ENV_SERVICE_KEY]: undefined }, ENV_SERVICE_KEY],
    ["an empty service key", { ...base(), [ENV_SERVICE_KEY]: "  " }, ENV_SERVICE_KEY],
    ["a missing disposable prefix", { ...base(), [ENV_PREFIX]: undefined }, ENV_PREFIX],
    ["a malformed disposable prefix", { ...base(), [ENV_PREFIX]: "RUN-1" }, ENV_PREFIX],
    ["a lowercase disposable prefix", { ...base(), [ENV_PREFIX]: "U4-abc123" }, ENV_PREFIX],
    [
      "an API URL whose host is not the ref's",
      { ...base(), [ENV_API_URL]: "https://evil.example.com" },
      ENV_API_URL,
    ],
    [
      "an API URL for a DIFFERENT Supabase project",
      { ...base(), [ENV_API_URL]: `https://${OTHER_REF}.supabase.co` },
      ENV_API_URL,
    ],
    [
      "an API URL that merely contains the ref as a prefix",
      { ...base(), [ENV_API_URL]: `https://${HOSTED_REF}.supabase.co.evil.example` },
      ENV_API_URL,
    ],
    [
      "a plaintext API URL for a hosted project",
      { ...base(), [ENV_API_URL]: `http://${HOSTED_REF}.supabase.co` },
      ENV_API_URL,
    ],
    ["an API URL that is not a URL at all", { ...base(), [ENV_API_URL]: "not a url" }, ENV_API_URL],
    [
      "a loopback API URL while the ref is hosted",
      { ...base(), [ENV_API_URL]: LOCAL_API_ORIGIN },
      ENV_API_URL,
    ],
    [
      "a hosted API URL while the ref is local",
      {
        ...base({ [ENV_REF]: LOCAL_REF, [ENV_ACKNOWLEDGE]: acknowledgementFor(LOCAL_REF) }),
        [ENV_API_URL]: `https://${HOSTED_REF}.supabase.co`,
      },
      ENV_API_URL,
    ],
    ["an empty environment", {}, ENV_REF],
  ];

  let allRefused = true;
  let allNamedTheRule = true;
  let leakedAValue = [];
  for (const [label, env, expectedVariable] of cases) {
    const message = refused(env);
    if (message === null) {
      allRefused = false;
      bad(`it ACCEPTED ${label}`);
      continue;
    }
    if (!message.startsWith("WRONG ERROR TYPE") && !message.includes(expectedVariable)) {
      allNamedTheRule = false;
    }
    // The message must never quote the value that broke the rule.
    for (const secret of [FAKE_KEY, OTHER_REF]) {
      if (message.includes(secret)) leakedAValue.push(`${label} -> ${secret.slice(0, 6)}…`);
    }
    check(true, `it refuses ${label}`);
  }
  check(allRefused, `all ${cases.length} invalid environments were refused`);
  check(allNamedTheRule, "every refusal names the variable whose rule it broke");
  check(
    leakedAValue.length === 0,
    `no refusal quotes the value that broke it${leakedAValue.length ? `: ${leakedAValue.join(", ")}` : ""}`,
  );

  // A HostedTargetError, not a bare Error — callers discriminate on the type.
  let correctType = false;
  try {
    resolveHostedTarget({});
  } catch (thrown) {
    correctType = thrown instanceof HostedTargetError;
  }
  check(correctType, "a refusal throws HostedTargetError");
}

// ---- [3] What the guard accepts ------------------------------------------
console.log("\n[3] A complete, correct environment is accepted — and nothing else is");
{
  const hosted = resolveHostedTarget(base());
  check(hosted.ref === HOSTED_REF, "a hosted target resolves its ref");
  check(hosted.isLocal === false, "and is not marked local");
  check(
    hosted.apiOrigin === `https://${HOSTED_REF}.supabase.co`,
    `the API origin is derived from the ref (${hosted.apiOrigin})`,
  );
  check(hosted.restUrl === `https://${HOSTED_REF}.supabase.co/rest/v1/`, "and the REST URL from that origin");
  check(hosted.disposablePrefix === "U4-ABC123", "the disposable prefix is carried through");

  const explicit = resolveHostedTarget(base({ [ENV_API_URL]: `https://${HOSTED_REF}.supabase.co/` }));
  check(explicit.apiOrigin === `https://${HOSTED_REF}.supabase.co`, "an explicit URL that AGREES with the ref is accepted");

  const local = resolveHostedTarget({
    [ENV_REF]: LOCAL_REF,
    [ENV_ACKNOWLEDGE]: acknowledgementFor(LOCAL_REF),
    [ENV_SERVICE_KEY]: FAKE_KEY,
    [ENV_PREFIX]: "U4-LOCAL1",
  });
  check(local.isLocal === true, "the literal 'local' resolves to the local stack");
  check(local.apiOrigin === LOCAL_API_ORIGIN, `on 127.0.0.1:54321 (${local.apiOrigin})`);
  check(
    resolveHostedTarget({
      [ENV_REF]: LOCAL_REF,
      [ENV_ACKNOWLEDGE]: acknowledgementFor(LOCAL_REF),
      [ENV_SERVICE_KEY]: FAKE_KEY,
      [ENV_PREFIX]: "U4-LOCAL1",
      [ENV_API_URL]: LOCAL_API_ORIGIN,
    }).apiOrigin === LOCAL_API_ORIGIN,
    "and an explicit loopback URL is accepted for it",
  );

  const anon = resolveHostedTarget(base({ [ENV_ANON_KEY]: "anon-stand-in" }));
  check(anon.anonKey === "anon-stand-in", "an anon key is carried when supplied");
  check(resolveHostedTarget(base()).anonKey === null, "and is null when it is not");
}

// ---- [4] The safe description carries no secret ---------------------------
console.log("\n[4] The printable description of a target carries no credential");
{
  const target = resolveHostedTarget(base({ [ENV_ANON_KEY]: "anon-stand-in" }));
  const described = describeTarget(target);
  const serialized = JSON.stringify(described);
  check(!serialized.includes(FAKE_KEY), "describeTarget() omits the service key");
  check(described.serviceKeyPresent === true, "while still reporting that one was supplied");
  check(described.anonKeyPresent === true, "and that an anon key was too");
  check(
    Object.keys(described).sort().join(",") ===
      "anonKeyPresent,apiOrigin,authenticatedKeyPresent,disposablePrefix,isLocal,ref,serviceKeyPresent",
    `it exposes exactly the safe fields (${Object.keys(described).sort().join(",")})`,
  );
  check(scanText(serialized).length === 0, "and the secret scanner finds nothing in it");
}

// ---- [5] Disposable naming ------------------------------------------------
console.log("\n[5] A run may only touch objects it stamped as its own");
{
  const target = resolveHostedTarget(base());
  check(isDisposableName(target, "U4-ABC123 tenant"), "a name carrying the prefix is this run's");
  check(!isDisposableName(target, "BNI Cuicuilco"), "an ordinary client name is not");
  check(!isDisposableName(target, "U4-ZZZ999 tenant"), "and neither is ANOTHER run's prefix");
  check(!isDisposableName(target, null), "a missing name is not disposable either");

  let refusedForeign = false;
  try {
    assertDisposableName(target, "the tenant", "BNI Cuicuilco");
  } catch (thrown) {
    refusedForeign = thrown instanceof HostedTargetError;
  }
  check(refusedForeign, "writing to an object without the prefix is refused");
  check(
    assertDisposableName(target, "the tenant", "U4-ABC123 disposable tenant") ===
      "U4-ABC123 disposable tenant",
    "and an object carrying it is allowed through",
  );
}

// ---- [6] The protected-object census --------------------------------------
console.log("\n[6] A run must leave every pre-existing object exactly as it found it");
{
  check(PROTECTED_TABLES.length === 41, `41 protected tables are enumerated (${PROTECTED_TABLES.length})`);
  check(new Set(PROTECTED_TABLES).size === PROTECTED_TABLES.length, "with no duplicates");
  for (const required of [
    "tenant",
    "study",
    "respondent",
    "quant_response",
    "qual_observation",
    "import_job",
    "import_job_record",
    "retention_period",
    "survey_response",
    "source_lineage",
  ]) {
    check(PROTECTED_TABLES.includes(required), `the census covers ${required}`);
  }

  const census = Object.fromEntries(PROTECTED_TABLES.map((table, index) => [table, index]));
  check(assertProtectedObjectsUnchanged(census, { ...census }) === true, "an identical census passes");

  const moved = (mutate) => {
    const after = { ...census };
    mutate(after);
    try {
      assertProtectedObjectsUnchanged(census, after);
      return null;
    } catch (thrown) {
      return thrown instanceof HostedTargetError ? thrown.message : `WRONG TYPE: ${thrown}`;
    }
  };
  check((moved((a) => (a.tenant += 1)) ?? "").includes("tenant: 0 -> 1"), "one extra row is refused, and named");
  check((moved((a) => (a.survey_response -= 1)) ?? "").includes("survey_response"), "one missing row is refused too");
  check(moved((a) => delete a.pain_point) !== null, "a table missing from the after census is a finding");
  check(
    (() => {
      try {
        assertProtectedObjectsUnchanged(census, { ...census, brand_new_table: 3 });
        return false;
      } catch {
        return true;
      }
    })(),
    "and so is a table that appeared during the run",
  );
  check(moved((a) => (a.tenant = "0")) !== null, "a non-integer count is refused rather than compared loosely");
  for (const bad of [null, undefined, "census", 7]) {
    let rejected = false;
    try {
      assertProtectedObjectsUnchanged(bad, census);
    } catch {
      rejected = true;
    }
    check(rejected, `a census that is ${JSON.stringify(bad) ?? "undefined"} is refused`);
  }
}

// ---- [7] Structural rules the guard depends on ----------------------------
console.log("\n[7] The guard reads no environment file and holds no default target");
{
  const source = read("scripts/lib/hosted-target.mjs");
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  check(!/\.env/.test(stripped), "no code path in the guard mentions a .env file");
  check(!/readFileSync|readFile|import\s*\(/.test(stripped), "it reads no file at all");
  // Building a URL string is the module's job; OPENING one is not. The property
  // is that it makes no request and imports nothing that could.
  check(
    !/\bfetch\s*\(|XMLHttpRequest|node:https?\b|node:net\b|node:tls\b|node:dgram\b/.test(stripped),
    "it makes no request and imports no transport module",
  );
  check(
    (stripped.match(/^import .*/gm) ?? []).length === 0,
    "in fact it imports nothing at all — it is a pure function of an environment object",
  );
  check(
    !new RegExp(`${ENV_REF}\\s*\\]?\\s*(?:\\?\\?|\\|\\|)`).test(stripped),
    "the ref has no fallback: an unset variable is a refusal, never a default",
  );
  check(scanText(source).length === 0, "the guard's own source carries no secret-shaped token");
  check(scanText(read("scripts/hosted-target-guard-test.mjs")).length === 0, "and neither does this gate");

  // The two guards must stay separate modules with opposite rules.
  const disposable = read("scripts/lib/disposable-postgres.mjs");
  check(
    !/hosted-target/.test(disposable) && !/disposable-postgres/.test(stripped),
    "the disposable guard and the hosted guard do not import each other",
  );
  check(
    /supabase/i.test(disposable) && /refuse/.test(disposable),
    "the disposable guard still refuses Supabase",
  );

  const pkg = JSON.parse(read("package.json"));
  check(
    (pkg.scripts?.test ?? "").includes("test:hosted-target-guard"),
    "this gate is registered in the offline test chain",
  );
  check(
    typeof pkg.scripts?.["test:canonical-commit-hosted"] === "string",
    "the hosted transport runner has its own script",
  );
  check(
    !(pkg.scripts?.test ?? "").includes("test:canonical-commit-hosted"),
    "and is kept OUT of the offline chain: an unexecuted transport test is never an offline result",
  );
  check(
    !(pkg.scripts?.test ?? "").includes("test:canonical-commit-live"),
    "the database gate is still out of the offline chain too",
  );
  check(
    !/--env-file/.test(pkg.scripts?.["test:canonical-commit-hosted"] ?? ""),
    "and the hosted runner's own command loads no environment file",
  );
}


// ---- [8] The evidence writer ---------------------------------------------
console.log("\n[8] Evidence lands outside the tree, and is scanned before it is written");
{
  const stamp = "gatecheck";
  const insideTree = join(root, "evidence");
  let refusedInside = null;
  try {
    resolveEvidenceDirectory({ [ENV_EVIDENCE_DIR]: insideTree }, stamp);
  } catch (thrown) {
    refusedInside = thrown instanceof EvidenceError ? thrown.message : `WRONG TYPE: ${thrown}`;
  }
  check(refusedInside !== null && !refusedInside.startsWith("WRONG"), "an evidence directory inside the worktree is refused");

  // A path in the MAIN repository, which is a sibling of this worktree rather
  // than a descendant of it — so only the main-repository rule can refuse it.
  const insideMain = join(root, "..", "becommunity-software", "evidence");
  check(!insideMain.startsWith(root + sep), "the main repository is a sibling of this worktree, not a descendant");
  let refusedMain = null;
  try {
    resolveEvidenceDirectory({ [ENV_EVIDENCE_DIR]: insideMain }, stamp);
  } catch (thrown) {
    refusedMain = thrown instanceof EvidenceError ? thrown.message : null;
  }
  check(refusedMain !== null, "and so is one inside the main repository this worktree is linked to");
  check(
    (refusedMain ?? "").includes("main repository"),
    "the refusal names the main-repository rule, so the worktree rule did not answer for it",
  );

  for (const badStamp of ["", "../escape", "a/b", "x".repeat(65)]) {
    let rejected = false;
    try {
      resolveEvidenceDirectory({}, badStamp);
    } catch {
      rejected = true;
    }
    check(rejected, `a stamp of ${JSON.stringify(badStamp).slice(0, 20)} is refused`);
  }

  const dir = resolveEvidenceDirectory({}, stamp);
  check(!dir.startsWith(root), `the default evidence directory is outside the tree (${dir.length} chars)`);

  let refusedUnknown = false;
  try {
    writeArtifact(dir, "notes.json", { a: 1 });
  } catch (thrown) {
    refusedUnknown = thrown instanceof EvidenceError;
  }
  check(refusedUnknown, "an artifact name the run never declared is refused");

  // A synthetic service-role JWT, assembled at runtime so no credential-shaped
  // literal is committed to a file the history scanner reads.
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const syntheticServiceJwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ role: "service_role", iss: "supabase", ref: "gatecanary" }),
    "GATECANARYSIGNATURENOTREAL",
  ].join(".");
  let refusedSecret = null;
  try {
    writeArtifact(dir, "baseline.json", { leaked: syntheticServiceJwt });
  } catch (thrown) {
    refusedSecret = thrown instanceof EvidenceError ? thrown.message : null;
  }
  check(refusedSecret !== null, "an artifact carrying a service-role JWT is REFUSED, not redacted");
  check(
    (refusedSecret ?? "").includes("service-role-jwt") && !(refusedSecret ?? "").includes(syntheticServiceJwt),
    "and the refusal names the secret CLASS without quoting the secret",
  );
  check(!existsSync(join(dir, "baseline.json")), "the refused artifact was not written at all");

  const written = writeArtifact(dir, "baseline.json", { serverVersion: "17.6.1", tables: 41 });
  check(existsSync(written), "a clean artifact is written");
  check(JSON.parse(readFileSync(written, "utf8")).tables === 41, "and round-trips");

  const journal = createTransportJournal();
  journal.record({ name: "commit_canonical_package", payloadBytes: 2704662, httpStatus: 200, wallMs: 716, responseBytes: 812, code: "committed", ok: true });
  check(journal.all().length === 1 && journal.all()[0].sequence === 0, "a transport record is journalled with its sequence");
  for (const forbidden of [{ name: "x", args: {} }, { name: "x", body: "..." }, { name: "x", arguments: [1] }, { name: "x", plan: {} }]) {
    let rejected = false;
    try {
      journal.record(forbidden);
    } catch (thrown) {
      rejected = thrown instanceof EvidenceError;
    }
    check(rejected, `a transport record carrying '${Object.keys(forbidden).filter((k) => k !== "name")[0]}' is refused`);
  }
  check(
    TRANSPORT_FIELDS.every((f) => !["args", "arguments", "body", "plan", "request", "response"].includes(f)),
    "the journal's field list cannot express an argument or a response body",
  );
  check(journal.summary()[0].maxPayloadBytes === 2704662, "the summary reports payload SIZE and nothing else");
  // {"a":"bc"} is ten bytes; the helper measures the serialized form, not the value.
  check(serializedBytes({ a: "bc" }) === 10, `serializedBytes measures bytes (${serializedBytes({ a: "bc" })})`);

  rmSync(dir, { recursive: true, force: true });
  check(!existsSync(dir), "the gate leaves no evidence directory behind");

  check(scanText(read("scripts/lib/hosted-evidence.mjs")).length === 0, "the evidence module carries no secret-shaped token");
  const evidenceSource = read("scripts/lib/hosted-evidence.mjs");
  check(
    (evidenceSource.match(/screenshot\w*/gi) ?? []).length === 1 && /No screenshots, ever\./.test(evidenceSource),
    "its only mention of a screenshot is the line forbidding them",
  );
  check(
    !/\b(png|jpe?g|webp|toBuffer|captureScreenshot)\b/i.test(evidenceSource),
    "and it names no image format and no capture call, so it could not write one",
  );

}

// ---- [9] The hosted runner refuses, and refuses FIRST ---------------------
// Sections [1] to [7] prove the guard function refuses. This section proves the
// RUNNER consults it before it does anything else, by actually starting it with
// an incomplete environment and watching it exit. It is safe to run inside the
// offline gate precisely because the refusal happens before a client is built:
// nothing is contacted, and no evidence directory is created.
console.log("\n[9] Starting the hosted runner without authorization stops it");
{
  const runner = join(root, "scripts", "canonical-commit-hosted-test.mjs");
  const HOSTED_VARS = [ENV_REF, ENV_ACKNOWLEDGE, ENV_SERVICE_KEY, ENV_PREFIX, ENV_API_URL, ENV_ANON_KEY];

  const start = (overrides) => {
    const env = { ...process.env };
    for (const name of HOSTED_VARS) delete env[name];
    env[ENV_EVIDENCE_DIR] = join(tmpdir(), `bc-gate-evidence-${Math.random().toString(36).slice(2)}`);
    Object.assign(env, overrides);
    try {
      execFileSync(process.execPath, ["--import", "tsx", runner], {
        encoding: "utf8",
        env,
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stderr: "", evidence: env[ENV_EVIDENCE_DIR] };
    } catch (thrown) {
      return { code: thrown.status, stderr: `${thrown.stderr ?? ""}`, evidence: env[ENV_EVIDENCE_DIR] };
    }
  };

  const bare = start({});
  check(bare.code === 2, `an unauthorized start exits 2 (${bare.code})`);
  check(/^REFUSED: /m.test(bare.stderr), "saying REFUSED, on stderr");
  check(bare.stderr.includes(ENV_REF), "and naming the rule that stopped it");
  check(!existsSync(bare.evidence), "and it created no evidence directory before refusing");

  const mismatched = start({
    [ENV_REF]: HOSTED_REF,
    [ENV_ACKNOWLEDGE]: acknowledgementFor(OTHER_REF),
    [ENV_SERVICE_KEY]: FAKE_KEY,
    [ENV_PREFIX]: "U4-ABC123",
  });
  check(mismatched.code === 2, `an acknowledgement for a DIFFERENT project exits 2 (${mismatched.code})`);
  check(!mismatched.stderr.includes(HOSTED_REF), "and the refusal does not echo the ref that was refused");
  check(!mismatched.stderr.includes(FAKE_KEY), "nor the key it was handed");
  check(!existsSync(mismatched.evidence), "and again nothing was written");

  const runnerSource = read("scripts/canonical-commit-hosted-test.mjs");
  const guardAt = runnerSource.indexOf("resolveHostedTarget(process.env)");
  check(guardAt > 0, "the runner resolves the target from the environment it was given");
  check(
    guardAt < runnerSource.indexOf("restSuiteTransport("),
    "and it does so BEFORE it builds a transport that could open a connection",
  );
  // `process.env` is the environment it was GIVEN; a FILE is a different thing.
  // Every `.env` in the runner must be that one, and nothing may read a file.
  const withoutComments = runnerSource.replace(/^\s*\/\/.*$/gm, "");
  const envMentions = withoutComments.match(/[\w.]*\.env\b/g) ?? [];
  check(
    envMentions.every((mention) => mention === "process.env") &&
      !/dotenv|--env-file|readFileSync|readFile\(/.test(runnerSource),
    `the runner reads its environment, never an environment FILE (${[...new Set(envMentions)].join(", ")})`,
  );
  const rest = read("scripts/lib/canonical-rest-transport.mjs");
  check(
    /persistSession: false/.test(rest) && /autoRefreshToken: false/.test(rest),
    "the REST transport holds no session, exactly as the product's admin client does",
  );
  check(scanText(rest).length === 0 && scanText(runnerSource).length === 0, "neither carries a secret-shaped token");
  check(
    /ddl: false/.test(rest) && /catalogue: false/.test(rest) && /concurrentSessions: false/.test(rest),
    "and it declares the capabilities it does NOT have, so those assertions skip instead of vanishing",
  );
}

// ---- [10] The local stack, and the second identity it mints ---------------
// The local PostgREST substitute exists so level 3 can be exercised on a machine
// with no container runtime. It is still a thing that starts a server and mints
// credentials, so the same rules apply to it: nothing is read from a file,
// nothing listens beyond loopback, and no key reaches a log or an artifact.
console.log("\n[10] The local PostgREST substitute keeps the same promises");
{
  const stack = read("scripts/lib/local-postgrest-stack.mjs");
  const driver = read("scripts/canonical-commit-local-stack.mjs");
  const pkg = JSON.parse(read("package.json"));

  check(
    !/dotenv|--env-file|readFileSync|["'`][^"'`\n]*\.env["'`]/.test(stack),
    "the stack module reads no environment file",
  );
  check(scanText(stack).length === 0 && scanText(driver).length === 0, "and neither carries a secret-shaped token");
  check(
    /randomBytes\(/.test(stack) && !/jwt-secret = "[A-Za-z0-9]{8,}"/.test(stack),
    "the signing secret is generated per run, never a literal",
  );
  check(/mode: 0o600/.test(stack), "the config file that holds it is private to the invoking user");
  check(
    (stack.match(/server-host = "127\.0\.0\.1"/g) ?? []).length === 1 &&
      /listen\(port, "127\.0\.0\.1"\)/.test(stack),
    "PostgREST and the shim both listen on loopback only",
  );
  check(
    /export function mintJwt/.test(stack) && /createHmac\("sha256"/.test(stack),
    "the role tokens are HS256 JWTs minted with node:crypto, so no key is fetched from anywhere",
  );
  check(
    !/console\.log\([^)]*serviceKey|console\.log\([^)]*anonKey|console\.log\([^)]*secret/.test(stack + driver),
    "and no key or secret is ever printed",
  );
  check(
    typeof pkg.scripts?.["test:canonical-commit-local-stack"] === "string",
    "the local-stack driver has its own script",
  );
  check(
    !(pkg.scripts?.test ?? "").includes("test:canonical-commit-local-stack"),
    "and it is OUT of the offline chain too",
  );

  // The transport suite must never be reachable from the LOCAL gate: `psql`
  // hands the server a file path, so it has no body to limit and no key to
  // present, and reporting T1 as passed there would be a lie.
  const localRunner = read("scripts/canonical-commit-live-test.mjs");
  const hostedRunner = read("scripts/canonical-commit-hosted-test.mjs");
  check(
    !/canonical-transport-suite/.test(localRunner) && /canonical-transport-suite/.test(hostedRunner),
    "the transport suite runs from the hosted runner only",
  );
  const transportSuiteSource = read("scripts/lib/canonical-transport-suite.mjs");
  check(
    /t\.kind !== "rest"/.test(transportSuiteSource),
    "and it refuses to answer for a transport that is not HTTP, skipping instead",
  );

  // The optional second identity.
  const guard = read("scripts/lib/hosted-target.mjs");
  check(/ENV_AUTHENTICATED_KEY/.test(guard), "the guard knows about an optional authenticated-role key");
  const withBoth = resolveHostedTarget(
    base({ [ENV_ANON_KEY]: `${FAKE_KEY}-anon`, CANONICAL_HOSTED_AUTHENTICATED_KEY: `${FAKE_KEY}-auth` }),
  );
  const described = describeTarget(withBoth);
  check(described.anonKeyPresent === true && described.authenticatedKeyPresent === true, "and reports both as present");
  check(
    !JSON.stringify(described).includes(FAKE_KEY),
    "while the safe description still carries no key value of any kind",
  );
  const withoutEither = resolveHostedTarget(base());
  check(
    withoutEither.anonKey === null && withoutEither.authenticatedKey === null,
    "an absent browser-role key is null, never a fallback to the service key",
  );
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log(
  "RESULT: the hosted-target guard accepts exactly one named target, refuses everything else,\n" +
    "        and never quotes the value that broke a rule. GATE PASSED.",
);
