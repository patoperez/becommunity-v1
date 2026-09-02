// =============================================================================
// Disposable PostgreSQL harness
// =============================================================================
// A thin, auditable wrapper around `psql` for the Unit 3 database gate. It adds
// no runtime dependency: `psql` is already required to apply a migration by
// hand, and the alternative — a Node driver — would put a package in the tree
// that only a test needs.
//
// WHAT IT REFUSES, AND WHY EACH RULE EXISTS.
//
//   remote host        A gate that can reach a hosted database is one typo away
//                      from writing respondent data into it. Only loopback and
//                      a unix socket directory are accepted; a socket path is
//                      the strongest form, because it is not routable at all.
//   embedded password  A credential in a connection string ends up in argv, in
//                      a process listing and in an error message. Local trust
//                      or PGPASSFILE instead.
//   ordinary db name   The work database must be unmistakably disposable, and
//                      `postgres`, `template0`, `template1` and anything that
//                      looks like an application or Supabase database are
//                      refused outright — including as the ADMIN database,
//                      except for `postgres`, which is the only database that
//                      exists before this harness creates its own.
//   configured project A run inherits the shell. If the Supabase environment is
//                      present at all, the gate refuses rather than trusting
//                      itself never to read it. Nothing here loads `.env.local`.
//
// Every rule below is executed by the OFFLINE gate too, so a weakened guard
// fails `npm test` and not only a run somebody might never do.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The only database-name shape this harness will create or write to. */
export const DISPOSABLE_DATABASE_PATTERN = /^becommunity_canonical_test_[a-z0-9_]{1,40}$/;

/** Hosts that cannot leave the machine. Anything else is refused. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Database names this harness must never touch, whatever else is configured.
 * `postgres` is allowed ONLY as the admin connection, because CREATE DATABASE
 * has to be issued from somewhere; it is never the work database.
 */
const FORBIDDEN_WORK_DATABASES = new Set([
  "postgres",
  "template0",
  "template1",
  "supabase",
  "supabase_admin",
  "becommunity",
  "becommunity_dev",
  "becommunity_staging",
  "becommunity_production",
  "app",
  "main",
  "production",
  "staging",
]);

/** Environment variables whose mere presence means a real project is in scope. */
export const FORBIDDEN_ENVIRONMENT = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
];

export class DisposableTargetError extends Error {}

const refuse = (reason) => {
  throw new DisposableTargetError(reason);
};

/**
 * Resolve and VALIDATE the connection target.
 *
 * Accepts either discrete variables or a libpq URL, and returns the normalised
 * target. Every refusal is a sentence naming the rule, never the value it
 * refused, so a mistyped connection string is not echoed into a log.
 */
export function resolveDisposableTarget(env) {
  for (const name of FORBIDDEN_ENVIRONMENT) {
    if (typeof env[name] === "string" && env[name].trim() !== "") {
      refuse(
        `${name} is set. This gate refuses to run in an environment that carries a ` +
          "configured project, so it can never reach one by accident.",
      );
    }
  }

  const url = (env.CANONICAL_COMMIT_TEST_DATABASE_URL ?? "").trim();
  let host = (env.CANONICAL_COMMIT_TEST_PGHOST ?? "").trim();
  let port = (env.CANONICAL_COMMIT_TEST_PGPORT ?? "").trim();
  let user = (env.CANONICAL_COMMIT_TEST_PGUSER ?? "").trim();
  let adminDatabase = (env.CANONICAL_COMMIT_TEST_ADMIN_DB ?? "postgres").trim();

  if (url !== "") {
    if (!/^postgres(ql)?:\/\//.test(url)) refuse("Only a postgres:// or postgresql:// URL is accepted.");
    if (/supabase/i.test(url)) refuse("The connection string names Supabase.");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      refuse("The connection string is not a URL.");
    }
    if (parsed.password !== "") {
      refuse("The connection string carries a password. Use local trust or PGPASSFILE instead.");
    }
    if (parsed.username !== "") user = decodeURIComponent(parsed.username);
    // A unix socket is expressed as ?host=/path, which is the form libpq itself
    // documents and the only one that is not routable.
    const socket = parsed.searchParams.get("host");
    if (socket) host = socket;
    else if (parsed.hostname !== "") host = parsed.hostname;
    if (parsed.port !== "") port = parsed.port;
    const named = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    if (named !== "") adminDatabase = named;
  }

  if (host === "") refuse("No host was given. Set CANONICAL_COMMIT_TEST_PGHOST or a URL.");
  const isSocket = host.startsWith("/");
  if (!isSocket && !LOOPBACK_HOSTS.has(host)) {
    refuse(
      "The host is not local. This gate accepts only localhost, 127.0.0.1, ::1 " +
        "or an absolute unix socket directory.",
    );
  }
  if (user === "") refuse("No user was given. Set CANONICAL_COMMIT_TEST_PGUSER or a URL with a user.");
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(user)) refuse("The user name has an unexpected shape.");
  if (port !== "" && !/^\d{1,5}$/.test(port)) refuse("The port has an unexpected shape.");

  if (adminDatabase !== "postgres" && !DISPOSABLE_DATABASE_PATTERN.test(adminDatabase)) {
    refuse(
      "The admin database must be `postgres` — the only database that exists " +
        "before this harness creates its own — or itself a disposable one.",
    );
  }
  if (FORBIDDEN_WORK_DATABASES.has(adminDatabase) && adminDatabase !== "postgres") {
    refuse("The admin database names an ordinary application database.");
  }

  return { host, port, user, adminDatabase, isSocket };
}

/** A name this harness is allowed to create, write to and drop. */
export function assertDisposableWorkDatabase(name) {
  if (!DISPOSABLE_DATABASE_PATTERN.test(name)) {
    refuse(
      "The work database name must match becommunity_canonical_test_<suffix>, so " +
        "it cannot be mistaken for anything that matters.",
    );
  }
  if (FORBIDDEN_WORK_DATABASES.has(name)) refuse("That database name is on the refusal list.");
  return name;
}

/** A fresh, unmistakably disposable database name. */
export function disposableDatabaseName(label) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const salt = Math.random().toString(36).slice(2, 8);
  return assertDisposableWorkDatabase(
    `becommunity_canonical_test_${label.replace(/[^a-z0-9]/g, "").slice(0, 12)}_${stamp}_${salt}`,
  );
}

/**
 * A `psql` session against one database.
 *
 * SQL is always delivered through a FILE, never through `-c` or shell
 * interpolation, so no statement can be mangled or injected by a value.
 * Results come back as one JSON document, so parsing never depends on psql's
 * column formatting.
 */
export class DisposablePostgres {
  constructor(target, database, options = {}) {
    this.target = target;
    this.database = database;
    this.psql = options.psql ?? "psql";
    this.scratch = options.scratch ?? mkdtempSync(join(tmpdir(), "bc-canonical-"));
    this.ownsScratch = options.scratch === undefined;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 120_000;
  }

  connectionArgs(database = this.database) {
    const args = ["-h", this.target.host];
    if (this.target.port !== "") args.push("-p", this.target.port);
    args.push("-U", this.target.user, "-d", database);
    return args;
  }

  /**
   * Run SQL and return stdout. Throws a REDACTED error on failure: the message
   * PostgreSQL produced is kept on the error object for the flow under test to
   * consume, and is never placed in the thrown message, which is what gets
   * logged.
   */
  run(sql, { database = this.database, variables = {}, expectJson = false } = {}) {
    const file = join(this.scratch, `stmt-${Math.random().toString(36).slice(2)}.sql`);
    writeFileSync(file, sql, { mode: 0o600 });
    const args = [
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      // Verbose verbosity is what makes psql print the SQLSTATE. Without it an
      // assertion can only see the word "ERROR", which distinguishes nothing.
      "-v",
      "VERBOSITY=verbose",
      ...Object.entries(variables).flatMap(([key, value]) => ["-v", `${key}=${value}`]),
      ...this.connectionArgs(database),
      "-f",
      file,
    ];
    try {
      const stdout = execFileSync(this.psql, args, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        timeout: this.statementTimeoutMs,
        // `execFileSync` forwards the child's stderr to this process unless
        // stdio says otherwise, and a PostgreSQL error message quotes the
        // values that violated the constraint. Capturing it is a privacy
        // requirement, not a tidiness one.
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning" },
      });
      return expectJson ? parseJsonResult(stdout) : stdout;
    } catch (thrown) {
      const detail = `${thrown.stderr ?? ""}`.trim();
      const error = new Error(`psql refused a statement (sqlstate ${sqlstateOf(detail) ?? "unknown"})`);
      // Kept for the code under test, never for the console.
      error.databaseMessage = detail;
      error.sqlstate = sqlstateOf(detail);
      throw error;
    } finally {
      rmSync(file, { force: true });
    }
  }

  /** One JSON value. The query must select exactly one row and one column. */
  json(sql, options = {}) {
    return this.run(sql, { ...options, expectJson: true });
  }

  /** Apply a .sql file verbatim, in one psql invocation. */
  applyFile(path, database = this.database) {
    const args = [
      "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
      ...this.connectionArgs(database), "-f", path,
    ];
    try {
      execFileSync(this.psql, args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: this.statementTimeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PGCLIENTENCODING: "UTF8", PGOPTIONS: "-c client_min_messages=warning" },
      });
    } catch (thrown) {
      const detail = `${thrown.stderr ?? ""}`.trim();
      const error = new Error(`applying ${path} failed (sqlstate ${sqlstateOf(detail) ?? "unknown"})`);
      error.databaseMessage = detail;
      error.sqlstate = sqlstateOf(detail);
      throw error;
    }
  }

  /** Write a payload to a private file this database can read back verbatim. */
  writePayload(name, value) {
    const file = join(this.scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return file;
  }

  dispose() {
    if (this.ownsScratch) rmSync(this.scratch, { recursive: true, force: true });
  }
}

function parseJsonResult(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === "" || trimmed === "null") return null;
  return JSON.parse(trimmed);
}

/** The five-character SQLSTATE, which is a class code and carries no value. */
export function sqlstateOf(message) {
  if (/^[0-9A-Z]{5}$/.test(message)) return message;
  // Read from the position psql puts it in under verbose verbosity, NOT by
  // scanning for any five-character token: the word `ERROR` is itself five
  // uppercase characters, so a looser pattern returns it for every failure and
  // makes every SQLSTATE assertion vacuously wrong.
  const labelled = message.match(/(?:ERROR|FATAL|PANIC|WARNING):\s+([0-9A-Z]{5}):/);
  if (labelled) return labelled[1];
  // Fallback for a message that names the state without the label. A SQLSTATE
  // always carries at least one digit, which is what separates it from a word.
  return message.match(/\b(?=[0-9A-Z]{5}\b)(?=[0-9A-Z]*[0-9])([0-9A-Z]{5})\b/)?.[1] ?? null;
}

/**
 * Create a disposable database, hand it to `work`, and drop it whatever
 * happens. The drop runs on the failure path too, so a broken assertion never
 * leaves a database behind.
 */
export async function withDisposableDatabase(target, label, work) {
  const name = disposableDatabaseName(label);
  const admin = new DisposablePostgres(target, target.adminDatabase);
  admin.run(`create database ${quoteIdentifier(name)};`, { database: target.adminDatabase });
  const db = new DisposablePostgres(target, name, { scratch: admin.scratch });
  try {
    return await work(db, name);
  } finally {
    try {
      db.dispose();
    } finally {
      // Terminate anything still attached, then drop. A leftover session from a
      // failed concurrency check must not keep the database alive.
      admin.run(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid();`,
        { database: target.adminDatabase },
      );
      admin.run(`drop database if exists ${quoteIdentifier(name)};`, { database: target.adminDatabase });
      admin.dispose();
    }
  }
}

export function quoteIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    refuse("An identifier this harness builds must be a plain lowercase name.");
  }
  return `"${name}"`;
}
