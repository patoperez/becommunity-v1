// =============================================================================
// Suite D — secrets and supply chain (P7).
//
//   npm run suite:d          complete gate (merge gate; requires both builds)
//   npm run suite:d:local    Windows-local subset — NOT the complete Suite D
// =============================================================================
// Five deterministic checks, no credentials, no network mutation:
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

const LOCAL_SUBSET = process.argv.includes("--local-subset");
const EXCEPTIONS_FILE = "security/dependency-exceptions.json";
const ALLOWED_REGISTRY_HOSTS = new Set(["registry.npmjs.org"]);
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);
const REQUIRED_EXCEPTION_FIELDS = [
  "package_and_version",
  "advisory_id_and_severity",
  "dependency_path",
  "reachability",
  "compensating_control",
  "approver",
  "review_date",
];
const PLACEHOLDER_APPROVERS = /^(tbd|todo|pending|n\/a|none|unknown|claude|agent|ai|automated)$/i;
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
// is NOT an exception: the advisory it names keeps failing the gate.
// ---------------------------------------------------------------------------
function loadExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return { valid: [], rejected: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8"));
  } catch {
    return { valid: [], rejected: [{ reason: `${EXCEPTIONS_FILE} is not valid JSON`, entry: null }] };
  }
  const valid = [];
  const rejected = [];
  for (const entry of parsed.exceptions ?? []) {
    const missing = REQUIRED_EXCEPTION_FIELDS.filter(
      (f) => typeof entry?.[f] !== "string" || entry[f].trim() === "",
    );
    if (missing.length > 0) {
      rejected.push({ reason: `missing field(s): ${missing.join(", ")}`, entry });
      continue;
    }
    if (PLACEHOLDER_APPROVERS.test(entry.approver.trim())) {
      rejected.push({ reason: "approver is a placeholder, not a human approval", entry });
      continue;
    }
    const review = Date.parse(entry.review_date);
    if (Number.isNaN(review)) {
      rejected.push({ reason: "review_date is not a parseable date", entry });
      continue;
    }
    if (review < Date.now()) {
      rejected.push({ reason: `review_date ${entry.review_date} has passed`, entry });
      continue;
    }
    valid.push(entry);
  }
  return { valid, rejected };
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
      .filter((v) => typeof v === "object")
      .map((v) => String(v.source ?? v.url ?? "").split("/").pop())
      .filter(Boolean);
    const excused = valid.some(
      (e) =>
        e.package_and_version.toLowerCase().includes(name.toLowerCase()) &&
        advisoryIds.some((id) => e.advisory_id_and_severity.includes(id)),
    );
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
