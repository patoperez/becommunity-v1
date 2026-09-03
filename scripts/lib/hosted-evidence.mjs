// =============================================================================
// Evidence artifacts for a hosted-transport run
// =============================================================================
// A run against a real project has to leave a record, and that record has to be
// safe to keep. Two rules make it so, and both are enforced here rather than
// asked of the caller:
//
//   OUTSIDE THE REPOSITORY. The evidence directory must not be the worktree, a
//   descendant of it, or a descendant of the main repository this worktree is
//   linked to. Evidence written inside the tree gets committed by the next
//   `git add -A`, and a transport journal is exactly the sort of file that
//   should never be.
//
//   SCANNED BEFORE IT IS WRITTEN. Every artifact goes through
//   `secret-patterns.mjs` first. If the scanner finds anything, the write is
//   REFUSED — the artifact is not written truncated, redacted or "mostly
//   clean". A secret scanner that runs after the write is a log of the leak.
//
// The transport journal is shape-checked rather than trusted: each record may
// carry only the fields listed in `TRANSPORT_FIELDS`, so an argument object or
// a response body cannot be added to it by a later edit without that edit
// failing loudly. Payload and response sizes are recorded in BYTES; their
// contents never are.
//
// No screenshots, ever.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { scanText } from "./secret-patterns.mjs";

export class EvidenceError extends Error {}

const refuse = (reason) => {
  throw new EvidenceError(reason);
};

export const ENV_EVIDENCE_DIR = "CANONICAL_HOSTED_EVIDENCE_DIR";

/** The artifacts a complete run produces, in the order it produces them. */
export const ARTIFACTS = Object.freeze([
  "baseline.json",
  "catalogue-pre.json",
  "catalogue-post.json",
  "transport.json",
  "assertions.json",
  "cleanup.json",
]);

/**
 * The ONLY fields a transport record may carry.
 *
 * `arguments` and `body` are deliberately absent, and an unknown field is a
 * refusal rather than a silent drop: a field that is dropped quietly today is a
 * field somebody re-adds tomorrow.
 */
export const TRANSPORT_FIELDS = Object.freeze([
  "name",
  "payloadBytes",
  "httpStatus",
  "wallMs",
  "responseBytes",
  "code",
  "ok",
  "sequence",
]);

const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

/**
 * Read a path recorded by git, which may be written for the OTHER platform.
 *
 * This repository is edited on Windows and its gates run in WSL, so a linked
 * worktree's `.git` file names the main repository as `C:/dev/.../repo`. Left
 * as-is, `resolve()` on Linux treats that as a RELATIVE path, the containment
 * check never matches, and the guard silently stops guarding. Translating the
 * drive letter to its `/mnt/<letter>` mount is what keeps the rule real.
 */
function normalizeRecordedPath(raw) {
  const trimmed = raw.trim();
  const windows = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  if (windows && process.platform !== "win32") {
    return `/mnt/${windows[1].toLowerCase()}/${windows[2].replace(/\\/g, "/")}`;
  }
  return trimmed;
}

/**
 * The main repository a linked worktree points at.
 *
 * In a linked worktree `.git` is a FILE holding `gitdir: <path>/.git/worktrees/
 * <name>`, so the real repository directory is exactly three levels up from
 * that. When `.git` is an ordinary directory this returns null and the worktree
 * check alone applies.
 */
function mainRepositoryRoot() {
  const dotGit = join(REPO_ROOT, ".git");
  try {
    if (!existsSync(dotGit)) return null;
    const contents = readFileSync(dotGit, "utf8");
    const match = contents.match(/^gitdir:\s*(.+)$/m);
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
 * `stamp` is supplied by the caller rather than read from a clock here, so a
 * run's directory name is reproducible from its own log.
 */
export function resolveEvidenceDirectory(env, stamp) {
  if (typeof stamp !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(stamp)) {
    refuse("the evidence stamp must be a short plain identifier supplied by the caller.");
  }

  const raw = env[ENV_EVIDENCE_DIR];
  const chosen =
    typeof raw === "string" && raw.trim() !== ""
      ? resolve(raw.trim())
      : join(tmpdir(), "becommunity-unit4-evidence", stamp);

  if (isInside(REPO_ROOT, chosen)) {
    refuse(
      "the evidence directory is inside the worktree. Evidence written into the tree " +
        "is evidence the next `git add -A` commits.",
    );
  }
  const mainRoot = mainRepositoryRoot();
  if (mainRoot && isInside(mainRoot, chosen)) {
    refuse("the evidence directory is inside the main repository this worktree is linked to.");
  }
  if (!chosen.startsWith(sep) && !/^[A-Za-z]:[\\/]/.test(chosen)) {
    refuse("the evidence directory must be an absolute path.");
  }

  mkdirSync(chosen, { recursive: true });
  return chosen;
}

/**
 * Write one artifact, after scanning it.
 *
 * The scan is the gate, not a warning: findings mean the artifact is not
 * written at all. `scanText` returns `[{id, count}]` and never the matched
 * text, so a refusal names the CLASS of secret and never the secret.
 */
export function writeArtifact(directory, name, value) {
  if (!ARTIFACTS.includes(name)) {
    refuse(`'${name}' is not one of this run's declared artifacts.`);
  }
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const findings = scanText(serialized);
  if (findings.length > 0) {
    refuse(
      `${name} was NOT written: the secret scanner found ` +
        `${findings.map((f) => `${f.count}x ${f.id}`).join(", ")}. ` +
        "An artifact is scanned before it is written, never after.",
    );
  }
  const path = join(directory, name);
  writeFileSync(path, serialized, { mode: 0o600 });
  return path;
}

/**
 * A transport journal that cannot record an argument or a response body.
 *
 * Every record is shape-checked on the way in, so the prohibition is structural
 * rather than a convention a later edit could forget.
 */
export function createTransportJournal() {
  const records = [];
  return {
    record(entry) {
      if (!entry || typeof entry !== "object") refuse("a transport record must be an object.");
      const unknown = Object.keys(entry).filter((key) => !TRANSPORT_FIELDS.includes(key));
      if (unknown.length > 0) {
        refuse(
          `a transport record may not carry ${unknown.join(", ")}. ` +
            "Arguments and response bodies are never journalled.",
        );
      }
      if (typeof entry.name !== "string" || entry.name === "") refuse("a transport record needs the RPC name.");
      for (const numeric of ["payloadBytes", "wallMs", "responseBytes"]) {
        if (entry[numeric] !== undefined && typeof entry[numeric] !== "number") {
          refuse(`a transport record's ${numeric} must be a number of bytes or milliseconds.`);
        }
      }
      records.push({ sequence: records.length, ...entry });
      return records[records.length - 1];
    },
    all() {
      return records.slice();
    },
    summary() {
      const byName = new Map();
      for (const record of records) {
        const current = byName.get(record.name) ?? { name: record.name, calls: 0, maxPayloadBytes: 0, maxWallMs: 0 };
        current.calls += 1;
        current.maxPayloadBytes = Math.max(current.maxPayloadBytes, record.payloadBytes ?? 0);
        current.maxWallMs = Math.max(current.maxWallMs, record.wallMs ?? 0);
        byName.set(record.name, current);
      }
      return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    },
  };
}

/** Byte length of a value once serialized — the number, never the content. */
export function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
