// =============================================================================
// The psql transport — level 2, a real local PostgreSQL
// =============================================================================
// This is the transport the database gate has always used, now behind the
// contract in `canonical-suite-transport.mjs` so a second implementation can
// answer the same assertions.
//
// It declares EVERY capability, because a local cluster this script created can
// do everything: apply migrations verbatim, inject a failing constraint, read
// `pg_catalog`, switch roles, and hold a row lock across two real sessions.
// That is exactly why level 2 is worth more than level 1 — and exactly why a
// REST transport, which can do none of those things, must declare them absent
// rather than pretend.
//
// THE RPC PATH IS DELIBERATELY INDIRECT. The payload is written to a private
// file and read back by the server with `pg_read_file`, so the exact bytes
// `JSON.stringify` produced are what PostgreSQL parses — no shell quoting, no
// truncation, no re-encoding. The call is made after `set role service_role`,
// so every RPC runs with the privileges the product actually uses.
//
// A CONSEQUENCE WORTH STATING: because the payload travels as a FILE PATH, this
// transport measures the plan's size but never sends it over a wire. It
// therefore cannot prove anything about a request-body limit. Only the REST
// transport can.
// =============================================================================

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const ROLLBACKS = join(ROOT, "supabase", "rollbacks");
const LIB = join(ROOT, "scripts", "lib");

/** Every tracked migration, in the order its number gives it. */
const MIGRATION_FILES = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

function migrationPath(prefix) {
  const file = MIGRATION_FILES.find((name) => name.startsWith(`${prefix}_`));
  if (!file) throw new Error(`no migration file for ${prefix}`);
  return join(MIGRATIONS, file);
}

const SNAPSHOT_SQL = readFileSync(join(LIB, "catalogue-snapshot.sql"), "utf8");

/** The signature of every function the transport may call. */
export const RPC_CALLS = {
  stage_canonical_package: (a) =>
    `public.stage_canonical_package((${a}.j->>'p_tenant_id')::uuid, (${a}.j->>'p_study_id')::uuid, ${a}.j->'p_request')`,
  commit_canonical_package: (a) =>
    `public.commit_canonical_package((${a}.j->>'p_import_job_id')::uuid, ${a}.j->'p_plan')`,
  rollback_canonical_package: (a) =>
    `public.rollback_canonical_package((${a}.j->>'p_import_job_id')::uuid, nullif(${a}.j->>'p_actor', '')::uuid)`,
};

/** A literal only ever built from harness-controlled uuids, labels and names. */
const literal = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

const whereOf = (filter) => {
  const entries = Object.entries(filter ?? {});
  if (entries.length === 0) return "";
  return ` where ${entries.map(([column, value]) => `${column} = ${literal(value)}`).join(" and ")}`;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the psql transport for one disposable database.
 *
 * `journal` is the optional shared list the runner uses to record size and
 * duration per RPC. It records BYTES and MILLISECONDS — never a payload.
 */
export function psqlSuiteTransport(db, journal) {
  let sequence = 0;

  const spawnPsql = (file) =>
    new Promise((resolve) => {
      const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", ...db.connectionArgs(), "-f", file];
      const child = spawn("psql", args, { env: { ...process.env, PGCLIENTENCODING: "UTF8" } });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

  /** The SQL body that calls `commit_canonical_package` from a payload file. */
  const commitBody = (planFile) =>
    "create temp table _rpc_arg(j jsonb);\n" +
    `insert into _rpc_arg select pg_read_file($payload$${planFile}$payload$)::jsonb;\n` +
    "grant select on _rpc_arg to service_role;\n" +
    "set role service_role;\n" +
    `select coalesce(${RPC_CALLS.commit_canonical_package("a")}::text, 'null') from _rpc_arg a;\n` +
    "reset role;\n";

  const sqlstateOfProbe = (sql) => {
    try {
      db.run(sql);
      return null;
    } catch (thrown) {
      return thrown.sqlstate ?? "unknown";
    }
  };

  return {
    kind: "psql",
    capabilities: {
      ddl: true,
      catalogue: true,
      rawSql: true,
      roleSwitch: true,
      concurrentSessions: true,
      rawErrorText: true,
    },

    // ---- the product's own CommitTransport ---------------------------------
    async rpc(name, args) {
      const build = RPC_CALLS[name];
      if (!build) return { data: null, error: { message: "UNKNOWN_FUNCTION" } };
      const file = db.writePayload(`rpc-${name}-${sequence++}`, args);
      const bytes = statSync(file).size;
      const sql =
        "create temp table _rpc_arg(j jsonb);\n" +
        `insert into _rpc_arg select pg_read_file($payload$${file}$payload$)::jsonb;\n` +
        "grant select on _rpc_arg to service_role;\n" +
        "set role service_role;\n" +
        `select coalesce(${build("a")}::text, 'null') from _rpc_arg a;\n` +
        "reset role;\n";
      const started = process.hrtime.bigint();
      try {
        const data = db.json(sql);
        journal?.push({ name, bytes, ms: Number(process.hrtime.bigint() - started) / 1e6, ok: true });
        return { data, error: null };
      } catch (thrown) {
        journal?.push({
          name,
          bytes,
          ms: Number(process.hrtime.bigint() - started) / 1e6,
          ok: false,
          sqlstate: thrown.sqlstate,
        });
        // The raw message is handed to the code under test, exactly as
        // supabase-js would hand it over. It is never logged from here.
        return { data: null, error: { message: thrown.databaseMessage ?? "" } };
      } finally {
        rmSync(file, { force: true });
      }
    },

    // ---- measurement -------------------------------------------------------
    count(table, filter) {
      return Number(db.run(`select count(*) from public.${table}${whereOf(filter)};`).trim());
    },

    counts(tables) {
      const sorted = [...new Set(tables)].sort();
      const sql =
        "select json_build_object(" +
        sorted.map((t) => `'${t}', (select count(*) from public.${t})`).join(", ") +
        ")::text;";
      return JSON.parse(db.run(sql).trim());
    },

    readJob(id) {
      return db.json(
        `select row_to_json(x)::text from (
           select status, commit_attempts, rollback_count, last_error_code,
                  committed_at is not null as has_committed_at,
                  rolled_back_at is not null as has_rolled_back_at,
                  payload_digest is not null as has_digest,
                  actual_counts, error_report
           from public.import_job where id = ${literal(id)}
         ) x;`,
      );
    },

    // ---- scope -------------------------------------------------------------
    createStudy(label) {
      return db.json(
        `set role service_role;
         with t as (
           insert into public.tenant (name) values (${literal(`${label} tenant`)}) returning id
         ), s as (
           insert into public.study (tenant_id, name) select id, ${literal(`${label} study`)} from t returning id, tenant_id
         )
         select json_build_object('tenant', s.tenant_id::text, 'studyId', s.id::text)::text from s;`,
      );
    },

    createStudyInTenant(tenantId, label) {
      return db
        .run(
          `set role service_role;
           insert into public.study (tenant_id, name) values (${literal(tenantId)}, ${literal(`${label} study`)}) returning id;`,
        )
        .trim();
    },

    /**
     * How many (person, cohort) pairs appear more than once in one study.
     *
     * A participation is the pair, so any number above zero means the same
     * person was enrolled twice — the exact damage a non-atomic retry would do.
     */
    duplicateParticipations(studyId) {
      return Number(
        db
          .run(
            `select count(*) from (
               select person_id, cohort_key from public.study_participant
               where study_id = ${literal(studyId)} group by 1,2 having count(*) > 1
             ) d;`,
          )
          .trim(),
      );
    },

    // ---- capability: rawSql -------------------------------------------------
    sql(text) {
      return db.run(text);
    },
    json(text) {
      return db.json(text);
    },

    // ---- capability: ddl ----------------------------------------------------
    applySqlFile(path) {
      db.applyFile(path);
    },
    applyMigration(prefix) {
      db.applyFile(migrationPath(prefix));
    },
    applyRollback(name) {
      db.applyFile(join(ROLLBACKS, name));
    },
    /**
     * Bootstrap, then migrations 0000..upTo in their REAL order.
     *
     * The migrations are applied verbatim. Nothing is rewritten to make them
     * apply, because a migration edited for the test would prove the edit, not
     * the migration.
     */
    prepare(upTo = 24) {
      db.applyFile(join(LIB, "disposable-bootstrap.sql"));
      for (const name of MIGRATION_FILES) {
        const number = Number(name.slice(0, 4));
        if (number > upTo) break;
        db.applyFile(join(MIGRATIONS, name));
      }
    },

    // ---- capability: catalogue ---------------------------------------------
    catalogueSnapshot() {
      return JSON.parse(db.run(SNAPSHOT_SQL).trim());
    },
    functionFacts(names) {
      return db.json(
        `select json_agg(json_build_object(
           'name', p.proname,
           'secdef', p.prosecdef,
           'config', coalesce(array_to_json(p.proconfig), '[]'::json),
           'acl', coalesce(array_to_string(p.proacl::text[], ','), '')
         ) order by p.proname)::text
         from pg_catalog.pg_proc p
         join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in (${names.map(literal).join(",")});`,
      );
    },
    tableSecurityFacts(names) {
      return db.json(
        `select json_agg(json_build_object(
           'name', c.relname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity,
           'policies', (select count(*) from pg_catalog.pg_policy p where p.polrelid = c.oid)
         ) order by c.relname)::text
         from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname in (${names.map(literal).join(",")});`,
      );
    },
    objectsPresent() {
      return db.json(
        "select json_build_object('ledger', to_regclass('public.import_job_record') is not null, " +
          "'fn', to_regprocedure('public.commit_canonical_package(uuid, jsonb)') is not null)::text;",
      );
    },

    // ---- capability: roleSwitch --------------------------------------------
    /** The SQLSTATE a role gets when it calls a function, or null if it worked. */
    probeFunctionExecute(role, fn, spec) {
      return sqlstateOfProbe(`set role ${role};\nselect public.${fn}(${spec.sql});\n`);
    },
    /** The SQLSTATE a role gets when it reads a table, or null if it worked. */
    probeTableRead(role, table) {
      return sqlstateOfProbe(`set role ${role};\nselect * from public.${table} limit 1;\n`);
    },

    // ---- capability: concurrentSessions -------------------------------------
    /**
     * Two genuinely overlapping commits of ONE job.
     *
     * A holds the job lock for `holdSeconds` AFTER committing the package,
     * inside one explicit transaction. B starts while that lock is held, so it
     * really does wait on the row rather than on a sleep in the harness. That
     * determinism is why this case is psql-only: firing two REST calls at once
     * would prove the same thing only probabilistically.
     */
    async raceCommit({ jobId, plan, holdSeconds = 3, staggerMs = 900 }) {
      const planFile = db.writePayload("race-plan", { p_import_job_id: jobId, p_plan: plan });
      const slow = join(db.scratch, "race-a.sql");
      const fast = join(db.scratch, "race-b.sql");
      const body = commitBody(planFile);
      writeFileSync(slow, `begin;\n${body}select pg_sleep(${holdSeconds});\ncommit;\n`, { mode: 0o600 });
      writeFileSync(fast, body, { mode: 0o600 });

      const runA = spawnPsql(slow);
      await delay(staggerMs);
      const runB = spawnPsql(fast);
      const [outA, outB] = await Promise.all([runA, runB]);
      const parse = (out) => {
        const line = out.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"))[0];
        return line ? JSON.parse(line) : null;
      };
      return [
        { completed: outA.code === 0, code: outA.code, result: parse(outA) },
        { completed: outB.code === 0, code: outB.code, result: parse(outB) },
      ];
    },
  };
}
