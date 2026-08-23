// =============================================================================
// Suite D — secrets and supply chain (P7).
//
//   npm run suite:d          complete gate (merge gate; requires both builds)
//   npm run suite:d:local    Windows-local subset — NOT the complete Suite D
// =============================================================================
// Six deterministic checks, no credentials, no network mutation:
//
//   D-a  npm audit           zero critical/high, unless a complete, explicitly
//                            human-approved §6.3 exception record matches
//   D-b  exact pins          every direct dependency and devDependency is an
//                            exact version (R14)
//   D-c  lockfile            lockfileVersion, integrity/provenance on every
//                            resolved package, registry host allowlist, and
//                            `npm ci --dry-run` proving lock/manifest agreement
//   D-d  git history         no `.env` file ever tracked, and no secret-class
//                            material in any reachable blob (D2)
//   D-e  build artifacts     delegates to scripts/secret-leak-test.mjs (D1)
//   D-f  toolchain pin       package.json and CI declare the same exact npm,
//                            and CI proves it took effect before `npm ci`
//
// Reporting contract: this script prints commit / path / secret-class metadata
// only. It never prints a matched value or any fragment of one.
//
// `suite:d:local` exists for the documented Windows `cf:build` EPERM case. It
// prints a prominent banner and can never be quoted as "Suite D green".
// =============================================================================

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { scanText, looksBinary } from "./lib/secret-patterns.mjs";
import {
  loadRegister,
  matchesAdvisory,
  selfTest as exceptionSelfTest,
} from "./lib/dependency-exceptions.mjs";

const LOCAL_SUBSET = process.argv.includes("--local-subset");
const EXCEPTIONS_FILE = "security/dependency-exceptions.json";
const CI_WORKFLOW = ".github/workflows/ci.yml";
// D-f contract. REQUIRED_NPM must equal the npm that Cloudflare's build image
// runs; REQUIRED_NODE must equal the runtime this branch was verified against.
// Changing either is a deliberate, reviewed edit, and D-f stays red until
// package.json and the workflow are updated to agree with it.
const REQUIRED_NPM = "10.9.2";
const REQUIRED_NODE = "24.11.1";
const ALLOWED_REGISTRY_HOSTS = new Set(["registry.npmjs.org"]);
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);
// Paths that must never have been tracked, at any point in history.
const FORBIDDEN_HISTORY_PATHS = /(^|\/)\.env(\.|$)/;
const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/;

let failures = 0;
const results = [];
const fail = (check, m) => {
  console.error(`  x FAIL: ${m}`);
  failures++;
  results.push([check, "FAIL", m]);
};
const ok = (check, m) => {
  console.log(`  ✓ ${m}`);
  results.push([check, "PASS", m]);
};
const info = (m) => console.log(`  · ${m}`);

// `npm` is a shell script on Windows and needs a shell; `git` must NOT get one,
// or cmd.exe mangles `--batch-check=%(objectname) …` and the stdin pipe.
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32" && cmd !== "git",
    ...opts,
  });
}

function heading(title) {
  console.log("\n" + "-".repeat(72));
  console.log(title);
  console.log("-".repeat(72));
}

// ---------------------------------------------------------------------------
// Exception register (§6.3). An entry missing any of the seven required fields
// is NOT an exception: the advisory it names keeps failing the gate. Parsing and
// matching live in scripts/lib/dependency-exceptions.mjs so they are directly
// testable; that module's self-test runs as part of D-a.
// ---------------------------------------------------------------------------
function loadExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return { valid: [], rejected: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8"));
  } catch {
    return { valid: [], rejected: [{ reason: `${EXCEPTIONS_FILE} is not valid JSON`, entry: null }] };
  }
  return loadRegister(parsed);
}

/**
 * The versions actually installed for a vulnerable package, read from the
 * lockfile node paths npm audit names. An exception must match one of these —
 * naming some other version excuses nothing.
 */
function installedVersionsFor(vuln) {
  let lock;
  try {
    lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  } catch {
    return [];
  }
  const versions = new Set();
  for (const node of vuln.nodes ?? []) {
    const entry = lock.packages?.[node];
    if (entry?.version) versions.add(entry.version);
  }
  return [...versions];
}

// ---------------------------------------------------------------------------
// D-a — npm audit
// ---------------------------------------------------------------------------
function checkAudit() {
  heading("D-a  npm audit — zero critical/high (§6.3 exceptions only)");
  const proc = run("npm", ["audit", "--json"]);
  let report;
  try {
    report = JSON.parse(proc.stdout.toString("utf8"));
  } catch {
    fail("audit", "npm audit did not return parseable JSON");
    return;
  }
  const counts = report.metadata?.vulnerabilities ?? {};
  info(
    `advisory counts — critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, ` +
      `moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}`,
  );

  // The matcher decides which advisories can be excused, so a regression in it
  // silently widens every exception. Prove it still works on every run.
  const matcherFailures = exceptionSelfTest();
  matcherFailures.length === 0
    ? ok("audit", "exception matcher self-test: wrong version/severity/id/package, placeholder approver, expired and incomplete entries all rejected")
    : matcherFailures.forEach((f) => fail("audit", `exception matcher self-test: ${f}`));

  const { valid, rejected } = loadExceptions();
  for (const r of rejected) {
    fail("audit", `incomplete §6.3 exception rejected — ${r.reason}`);
  }
  if (valid.length > 0) {
    info(`${valid.length} complete, human-approved §6.3 exception(s) loaded`);
  }

  const blocking = [];
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (!BLOCKING_SEVERITIES.has(vuln.severity)) continue;
    const advisoryIds = vuln.via
      .filter((v) => typeof v === "object" && v.url)
      .map((v) => String(v.url).split("/").pop())
      .filter(Boolean);
    const advisory = {
      name,
      severity: vuln.severity,
      advisoryIds,
      installedVersions: installedVersionsFor(vuln),
    };
    const excused = valid.some((v) => matchesAdvisory(v, advisory));
    if (excused) {
      info(`${name} (${vuln.severity}) carried by an approved §6.3 exception`);
      continue;
    }
    blocking.push(`${name} [${vuln.severity}] via ${vuln.nodes.length} node(s)`);
  }

  blocking.length === 0
    ? ok("audit", "no unexcused critical or high advisory")
    : blocking.forEach((b) => fail("audit", `blocking advisory: ${b}`));

  const moderate = Object.entries(report.vulnerabilities ?? {}).filter(
    ([, v]) => v.severity === "moderate",
  );
  if (moderate.length > 0) {
    info(
      `moderate advisories present and documented in docs/P7_SUPPLY_CHAIN_REVIEW.md: ` +
        moderate.map(([n]) => n).join(", "),
    );
  }
}

// ---------------------------------------------------------------------------
// D-b — exact pins (R14)
// ---------------------------------------------------------------------------
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function checkPins() {
  heading("D-b  exact version pins on every direct dependency");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const loose = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!EXACT_VERSION.test(spec)) loose.push(`${field}.${name} = "${spec}"`);
    }
  }
  const total =
    Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
  loose.length === 0
    ? ok("pins", `all ${total} direct dependencies are exact-pinned`)
    : loose.forEach((l) => fail("pins", `not exact-pinned: ${l}`));
}

// ---------------------------------------------------------------------------
// D-c — lockfile consistency and provenance
// ---------------------------------------------------------------------------
function checkLockfile() {
  heading("D-c  lockfile consistency and provenance");
  if (!existsSync("package-lock.json")) {
    fail("lockfile", "package-lock.json is missing");
    return;
  }
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

  lock.lockfileVersion >= 3
    ? ok("lockfile", `lockfileVersion ${lock.lockfileVersion}`)
    : fail("lockfile", `lockfileVersion ${lock.lockfileVersion} — expected >= 3`);

  const resolved = Object.entries(lock.packages ?? {}).filter(([k, v]) => k && v.resolved);
  const noIntegrity = resolved.filter(([, v]) => !v.integrity).map(([k]) => k);
  noIntegrity.length === 0
    ? ok("lockfile", `all ${resolved.length} resolved packages carry an integrity hash`)
    : fail("lockfile", `missing integrity hash: ${noIntegrity.slice(0, 10).join(", ")}`);

  const foreign = new Set();
  for (const [, v] of resolved) {
    try {
      const host = new URL(v.resolved).host;
      if (!ALLOWED_REGISTRY_HOSTS.has(host)) foreign.add(host);
    } catch {
      foreign.add(String(v.resolved).slice(0, 40));
    }
  }
  foreign.size === 0
    ? ok("lockfile", "every package resolves to the public npm registry")
    : fail("lockfile", `unexpected resolution host(s): ${[...foreign].join(", ")}`);

  const dry = run("npm", ["ci", "--dry-run", "--ignore-scripts"]);
  dry.status === 0
    ? ok("lockfile", "npm ci --dry-run succeeds — lockfile and package.json agree")
    : fail(
        "lockfile",
        `npm ci --dry-run failed (exit ${dry.status}) — lockfile out of sync with package.json`,
      );
}

// ---------------------------------------------------------------------------
// D-d — git history (D2)
// ---------------------------------------------------------------------------
function firstCommitTouching(path) {
  const proc = run("git", ["log", "--all", "--format=%h", "-1", "--", path]);
  return proc.status === 0 ? proc.stdout.toString("utf8").trim() || "(unknown)" : "(unknown)";
}

function checkHistory() {
  heading("D-d  git history — no tracked .env, no secret-class material");

  const shallow = run("git", ["rev-parse", "--is-shallow-repository"]).stdout.toString("utf8").trim();
  if (shallow === "true") {
    fail(
      "history",
      "shallow clone — history cannot be scanned. Check out with fetch-depth: 0 in CI.",
    );
    return;
  }
  ok("history", "full history available (not a shallow clone)");

  const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  /(^|\n)\.env\*?\s*(\n|$)/.test(gitignore)
    ? ok("history", ".gitignore excludes .env files")
    : fail("history", ".gitignore does not exclude .env files");

  // Every (blob, path) pair reachable from any ref.
  const objects = run("git", ["rev-list", "--objects", "--all"]).stdout.toString("utf8");
  const blobPaths = new Map(); // sha -> path
  for (const line of objects.split("\n")) {
    const space = line.indexOf(" ");
    if (space === -1) continue;
    blobPaths.set(line.slice(0, space), line.slice(space + 1));
  }

  const everTracked = [...blobPaths.values()].filter(
    (p) => FORBIDDEN_HISTORY_PATHS.test(p) && !ENV_EXAMPLE.test(p),
  );
  everTracked.length === 0
    ? ok("history", "no .env file was ever tracked in any reachable commit")
    : [...new Set(everTracked)].forEach((p) =>
        fail("history", `.env file tracked in history: ${p} (first seen ${firstCommitTouching(p)})`),
      );

  // Content scan of every REF-REACHABLE blob, in one batched `git cat-file` pass.
  // Deliberately not `--batch-all-objects`: that also walks dangling objects left
  // by local resets and rebases, which no fresh clone ever receives. Scanning
  // them would make the gate depend on one machine's object database and report
  // differently in CI. What must be clean is the history that is published.
  const types = run("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: Buffer.from([...blobPaths.keys()].join("\n") + "\n", "utf8"),
  });
  const blobShas = types.stdout
    .toString("utf8")
    .split("\n")
    .filter((l) => l.endsWith(" blob"))
    .map((l) => l.split(" ")[0]);

  const batch = run("git", ["cat-file", "--batch"], {
    input: Buffer.from(blobShas.join("\n") + "\n", "utf8"),
  });
  const out = batch.stdout;
  const findings = [];
  let cursor = 0;
  let scanned = 0;
  while (cursor < out.length) {
    const nl = out.indexOf(0x0a, cursor);
    if (nl === -1) break;
    const header = out.subarray(cursor, nl).toString("utf8").split(" ");
    const size = Number(header[2]);
    if (!Number.isFinite(size)) break;
    const body = out.subarray(nl + 1, nl + 1 + size);
    cursor = nl + 1 + size + 1;
    scanned += 1;
    if (looksBinary(body)) continue;
    const hits = scanText(body.toString("utf8"));
    if (hits.length > 0) {
      const sha = header[0];
      findings.push({
        sha: sha.slice(0, 10),
        path: blobPaths.get(sha) ?? "(unreferenced blob)",
        classes: hits.map((h) => h.id),
      });
    }
  }

  // A scanner that silently reads nothing would "pass" forever. Refuse to.
  info(`scanned ${scanned} of ${blobShas.length} reachable blob(s)`);
  if (blobShas.length === 0 || scanned < blobShas.length) {
    fail(
      "history",
      `blob scan is incomplete (${scanned}/${blobShas.length}) — treat as RED, not as a pass`,
    );
    return;
  }

  findings.length === 0
    ? ok("history", "no secret-class material in any reachable blob")
    : findings.forEach((f) =>
        fail(
          "history",
          `secret class ${f.classes.join(", ")} in blob ${f.sha} at ${f.path} ` +
            `(first seen ${firstCommitTouching(f.path)})`,
        ),
      );
}

// ---------------------------------------------------------------------------
// D-e — build artifacts (D1), delegated to the single secret scanner
// ---------------------------------------------------------------------------
function checkArtifacts() {
  heading("D-e  build-artifact secret scan (scripts/secret-leak-test.mjs)");
  const args = ["--env-file-if-exists=.env.local", "scripts/secret-leak-test.mjs"];
  if (LOCAL_SUBSET) args.push("--client-only");
  const proc = spawnSync(process.execPath, args, { stdio: "inherit" });
  proc.status === 0
    ? ok("artifacts", LOCAL_SUBSET ? "client-bundle scan passed (server output NOT scanned)" : "client and OpenNext server output are clean")
    : fail("artifacts", `secret-leak gate failed (exit ${proc.status})`);
}

// ---------------------------------------------------------------------------
// D-f — toolchain pin (npm resolver parity with the deploy build)
//
// npm 10 and npm 11 disagree about peer edges beneath a platform-excluded
// optional dependency: npm 11 prunes those nodes out of the lockfile, npm 10's
// `npm ci` still walks the edges and aborts with EUSAGE. Cloudflare's build
// image runs npm 10.9.2, so a lockfile regenerated under npm 11 can pass every
// gate in this repository and still break the deploy build before it starts —
// which is exactly what happened. The lockfile must therefore be authored and
// validated by one declared npm, and CI must prove it is running that npm and
// not merely asking for it.
//
// This is a structural check over the tracked files, not a probe of whatever
// npm happens to be on the current machine: a developer on npm 11 still gets a
// truthful red when the declaration and the workflow drift apart.
// ---------------------------------------------------------------------------

/** Split a workflow into its `- name:` steps, preserving order. */
export function workflowSteps(text) {
  const steps = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const named = /^(\s{4,})- name:\s*(.+?)\s*$/.exec(line);
    if (named) {
      current = { name: named[2], lines: [] };
      steps.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  // Collapse whitespace so the assertions survive re-indentation.
  return steps.map((s) => ({ name: s.name, body: s.lines.join(" ").replace(/\s+/g, " ") }));
}

/**
 * Pure evaluator for D-f, so the detector itself can be exercised offline with
 * synthetic drift rather than only against this branch's real files. Returns one
 * entry per assertion, in report order.
 */
export function evaluateToolchain({
  packageManager,
  workflow,
  npm = REQUIRED_NPM,
  node = REQUIRED_NODE,
}) {
  const checks = [];
  const add = (id, passed, message) => checks.push({ id, ok: passed, message });

  add(
    "declaration",
    packageManager === `npm@${npm}`,
    packageManager === `npm@${npm}`
      ? `package.json declares packageManager "npm@${npm}"`
      : `package.json declares packageManager ${JSON.stringify(packageManager ?? null)} — ` +
          `expected exactly "npm@${npm}"`,
  );

  if (workflow == null) {
    add("workflow", false, `${CI_WORKFLOW} is missing — the npm pin cannot be enforced`);
    return checks;
  }

  const nodePinned = new RegExp(`(^|\\s)node-version:\\s*${node}(\\s|$)`).test(workflow);
  add(
    "node",
    nodePinned,
    nodePinned
      ? `CI pins node-version to exactly ${node}`
      : `CI does not pin node-version to exactly ${node}`,
  );

  // Any npm@<spec> other than the contract version — `latest`, `^10`, a tag —
  // reintroduces the drift this pin exists to stop.
  const floating = [
    ...new Set(
      [...workflow.matchAll(/npm@([^\s"'`;]+)/g)].map((m) => m[1]).filter((v) => v !== npm),
    ),
  ];
  add(
    "no-floating",
    floating.length === 0,
    floating.length === 0
      ? `CI names no npm version other than ${npm}`
      : `CI names a non-contract npm spec: ${floating.join(", ")}`,
  );

  const steps = workflowSteps(workflow);
  const pinIndex = steps.findIndex((s) => s.body.includes(`npm install --global npm@${npm}`));
  const installIndex = steps.findIndex((s) => /(^| )npm ci( |$)/.test(s.body));

  add(
    "pin-present",
    pinIndex >= 0,
    pinIndex >= 0
      ? `CI installs npm@${npm} globally (step: "${steps[pinIndex].name}")`
      : `no CI step installs npm@${npm} globally`,
  );

  // Installing is not proof. The step must read the version back and exit
  // non-zero on a mismatch, so a silently ineffective install is a red job
  // rather than a lockfile validated by the wrong npm.
  const pinBody = pinIndex >= 0 ? steps[pinIndex].body : "";
  const asserted =
    pinBody.includes("npm --version") && pinBody.includes(npm) && /exit 1\b/.test(pinBody);
  add(
    "pin-asserted",
    asserted,
    asserted
      ? `the pin step asserts npm --version is exactly ${npm} and fails otherwise`
      : "the pin step does not read npm --version back and fail on a mismatch",
  );

  const ordered = installIndex >= 0 && pinIndex >= 0 && pinIndex < installIndex;
  add(
    "pin-ordered",
    ordered,
    installIndex < 0
      ? "no CI step installs from the lockfile with `npm ci`"
      : ordered
        ? "the npm pin runs before the lockfile install"
        : "`npm ci` runs before npm is pinned — the lockfile is validated by the wrong npm",
  );

  return checks;
}

/* <drift-vocabulary> — every way this pin can rot, as synthetic inputs. */
const GOOD_WORKFLOW = [
  "jobs:",
  "  gates-offline:",
  "    steps:",
  "      - name: Set up Node",
  "        with:",
  `          node-version: ${REQUIRED_NODE}`,
  "      - name: Pin npm to the lockfile-authoring version",
  "        run: |",
  `          npm install --global npm@${REQUIRED_NPM}`,
  '          actual="$(npm --version)"',
  `          if [ "$actual" != "${REQUIRED_NPM}" ]; then`,
  "            exit 1",
  "          fi",
  "      - name: Install from the lockfile",
  "        run: npm ci",
].join("\n");

const PIN_STEP_HEADER = "      - name: Pin npm to the lockfile-authoring version";
const PIN_STEP_BODY = [
  "        run: |",
  `          npm install --global npm@${REQUIRED_NPM}`,
  '          actual="$(npm --version)"',
  `          if [ "$actual" != "${REQUIRED_NPM}" ]; then`,
  "            exit 1",
  "          fi",
].join("\n");

const DRIFT_CASES = [
  {
    why: "the declaration is missing",
    input: { packageManager: undefined, workflow: GOOD_WORKFLOW },
  },
  {
    why: "the declaration drifted to npm 11",
    input: { packageManager: "npm@11.6.2", workflow: GOOD_WORKFLOW },
  },
  {
    why: "the declaration names another package manager",
    input: { packageManager: "pnpm@10.9.2", workflow: GOOD_WORKFLOW },
  },
  {
    why: "the workflow is missing",
    input: { packageManager: `npm@${REQUIRED_NPM}`, workflow: null },
  },
  {
    why: "CI stopped pinning npm",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: GOOD_WORKFLOW.replace(`          npm install --global npm@${REQUIRED_NPM}\n`, ""),
    },
  },
  {
    why: "CI floated the npm version",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: GOOD_WORKFLOW.split(`npm@${REQUIRED_NPM}`).join("npm@latest"),
    },
  },
  {
    why: "CI installs npm but never proves it took effect",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: [
        "jobs:",
        "  gates-offline:",
        "    steps:",
        "      - name: Set up Node",
        "        with:",
        `          node-version: ${REQUIRED_NODE}`,
        PIN_STEP_HEADER,
        "        run: |",
        `          npm install --global npm@${REQUIRED_NPM}`,
        "      - name: Install from the lockfile",
        "        run: npm ci",
      ].join("\n"),
    },
  },
  {
    why: "the pin runs after the lockfile install",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: [
        "jobs:",
        "  gates-offline:",
        "    steps:",
        "      - name: Set up Node",
        "        with:",
        `          node-version: ${REQUIRED_NODE}`,
        "      - name: Install from the lockfile",
        "        run: npm ci",
        PIN_STEP_HEADER,
        PIN_STEP_BODY,
      ].join("\n"),
    },
  },
  {
    why: "the lockfile install step disappeared",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: GOOD_WORKFLOW.replace("        run: npm ci", "        run: true"),
    },
  },
  {
    why: "the Node pin drifted",
    input: {
      packageManager: `npm@${REQUIRED_NPM}`,
      workflow: GOOD_WORKFLOW.replace(REQUIRED_NODE, "24.12.0"),
    },
  },
];
/* </drift-vocabulary> */

/**
 * Positive and negative control for the detector, run inside D-f on every
 * invocation. A regression here surfaces as a red gate rather than as a pin
 * that silently stopped detecting anything.
 */
function toolchainSelfTest() {
  const good = evaluateToolchain({
    packageManager: `npm@${REQUIRED_NPM}`,
    workflow: GOOD_WORKFLOW,
  });
  const goodFailures = good.filter((c) => !c.ok);
  if (goodFailures.length > 0) {
    fail(
      "toolchain",
      `self-test positive control failed: ${goodFailures.map((c) => c.id).join(", ")}`,
    );
    return;
  }
  const undetected = DRIFT_CASES.filter(
    (c) => !evaluateToolchain(c.input).some((check) => !check.ok),
  );
  undetected.length === 0
    ? ok(
        "toolchain",
        `self-test: a correct pin passes and all ${DRIFT_CASES.length} drift cases are caught`,
      )
    : undetected.forEach((c) => fail("toolchain", `drift NOT caught by D-f: ${c.why}`));
}

function checkToolchain() {
  heading("D-f  toolchain pin — npm resolver parity with the deploy build");

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const workflow = existsSync(CI_WORKFLOW) ? readFileSync(CI_WORKFLOW, "utf8") : null;

  for (const check of evaluateToolchain({ packageManager: pkg.packageManager, workflow })) {
    check.ok ? ok("toolchain", check.message) : fail("toolchain", check.message);
  }
  toolchainSelfTest();
}

// ---------------------------------------------------------------------------
console.log("=".repeat(72));
console.log("SUITE D — secrets and supply chain" + (LOCAL_SUBSET ? "   [LOCAL SUBSET]" : ""));
if (LOCAL_SUBSET) {
  console.log("!! This run does NOT include the OpenNext server-output scan.");
  console.log("!! It is NOT the complete Suite D and must never be quoted as one.");
}
console.log("=".repeat(72));

checkAudit();
checkPins();
checkLockfile();
checkHistory();
checkArtifacts();
checkToolchain();

console.log("\n" + "=".repeat(72));
const passed = results.filter((r) => r[1] === "PASS").length;
console.log(`Checks: ${passed} passed, ${failures} failed`);
if (failures > 0) {
  console.error("RESULT: SUITE D RED. Do not merge.");
  process.exit(1);
}
if (LOCAL_SUBSET) {
  console.log("RESULT: local subset passed.");
  console.log("!! NOT the complete Suite D — the OpenNext server output was not scanned.");
  console.log("!! Only `npm run suite:d` on Linux CI is the merge gate.");
  process.exit(0);
}
console.log("RESULT: SUITE D GREEN.");
