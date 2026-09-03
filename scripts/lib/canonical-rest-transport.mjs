// =============================================================================
// The REST transport — level 3, supabase-js over PostgREST
// =============================================================================
// The same suites, reached the way the PRODUCT reaches them: `createClient`
// with the service key, `.rpc(name, args)`, a JSON request body over HTTP.
// Everything level 2 cannot see lives here — the request-body limit, the
// supabase-js error shape, the service-role key path, the hosted statement
// timeout.
//
// -----------------------------------------------------------------------------
// WHAT IT DECLARES, AND WHY EACH ABSENCE IS HONEST
// -----------------------------------------------------------------------------
//   ddl: false                 PostgREST executes no DDL. A run cannot add a
//                              CHECK constraint to make a commit fail halfway,
//                              and it must not: a permanent failure-injection
//                              hook in the migration would be a real attack
//                              surface bought to make a test greener.
//   catalogue: false           pg_catalog is not exposed. Function ACLs, empty
//                              search paths and RLS flags are therefore proved
//                              at level 2 and by `test:rls-coverage`, not here.
//   rawSql: false              There is no arbitrary-SQL path, by design.
//   roleSwitch: <anon key?>    An anon-keyed client IS a second identity, so the
//                              privilege probes are real here — but only when an
//                              anon key was supplied.
//   concurrentSessions: false  Two simultaneous requests cannot be made to
//                              overlap deterministically. A probabilistic race
//                              is a flaky assertion, and a flaky assertion is
//                              worse than a declared skip.
//   rawErrorText: false        supabase-js surfaces PostgREST's `message`, which
//                              is the RAISE message — not the server's full
//                              error text.
//
// -----------------------------------------------------------------------------
// UNFILTERED COUNTS ARE DELTAS HERE, AND THAT IS NOT A FUDGE
// -----------------------------------------------------------------------------
// Level 2 runs against a database it just created, so `count(table)` with no
// filter means "rows this run wrote". A hosted project has pre-existing rows, so
// the same call would be meaningless. This transport takes a BASELINE census
// once, before anything is written, and an unfiltered count returns
// `absolute - baseline`. The assertion keeps its exact meaning; only the
// arithmetic changes. A negative delta would mean the run destroyed something
// that was already there, so it is a hard error rather than a clamp.
//
// NOTHING HERE READS A ROW OF ANY TABLE IT DID NOT CREATE. The census is counts
// only. The one place rows are read — `duplicateParticipations` — reads two
// columns of one study this run created, which holds synthetic fixtures.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { assertDisposableName } from "./hosted-target.mjs";

export class RestTransportError extends Error {}

const refuse = (reason) => {
  throw new RestTransportError(reason);
};

/** Tables an unfiltered count must be measured against a baseline for. */
export const CENSUS_TABLES = Object.freeze([
  "tenant",
  "study",
  "source_asset",
  "import_job",
  "import_job_asset",
  "import_job_record",
  "source_lineage",
]);

const clientFor = (target, key) =>
  createClient(target.apiOrigin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/**
 * Build the REST transport.
 *
 * `journal` records SIZE and DURATION per call — never a payload and never a
 * response body. `registry` collects the ids this run created so cleanup can
 * delete exactly those and nothing else.
 */
export function restSuiteTransport(target, { journal, registry, censusTables } = {}) {
  const service = clientFor(target, target.serviceKey);
  const anon = target.anonKey ? clientFor(target, target.anonKey) : null;
  const created = registry ?? { tenants: [], studies: [], jobs: [] };
  const baseline = new Map();
  let sequence = 0;

  const absoluteCount = async (table, filter) => {
    let query = service.from(table).select("*", { count: "exact", head: true });
    if (filter) query = query.match(filter);
    const { count, error } = await query;
    if (error) refuse(`counting public.${table} failed with ${error.code ?? "no code"}.`);
    return count ?? 0;
  };

  const transport = {
    kind: "rest",
    capabilities: {
      ddl: false,
      catalogue: false,
      rawSql: false,
      roleSwitch: anon !== null,
      concurrentSessions: false,
      rawErrorText: false,
    },
    created,

    /**
     * The ABSOLUTE row count of a table — no baseline subtraction.
     *
     * This is the census reader. It exists as its own method so a census can
     * never accidentally be taken as a delta, which would make "unchanged"
     * trivially true.
     */
    absolute(table) {
      return absoluteCount(table);
    },

    /** Count every census table once, BEFORE the run writes anything. */
    async takeBaseline(tables = censusTables ?? CENSUS_TABLES) {
      for (const table of tables) baseline.set(table, await absoluteCount(table));
      return Object.fromEntries([...baseline.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    },

    // ---- the product's own CommitTransport ---------------------------------
    async rpc(name, args) {
      const payloadBytes = Buffer.byteLength(JSON.stringify(args), "utf8");
      const started = process.hrtime.bigint();
      const { data, error, status } = await service.rpc(name, args);
      const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
      journal?.record?.({
        name,
        payloadBytes,
        httpStatus: status ?? 0,
        wallMs,
        responseBytes: data === undefined || data === null ? 0 : Buffer.byteLength(JSON.stringify(data), "utf8"),
        code: error?.code ?? "",
        ok: !error,
        sequence: sequence++,
      });
      if (error) {
        // supabase-js hands over PostgREST's `message`, which for this
        // migration's `raise … using message = 'COUNT_MISMATCH'` is exactly the
        // sentinel `safeErrorCode` looks for. It is passed through unchanged and
        // never logged from here.
        return { data: null, error: { message: error.message ?? "" } };
      }
      return { data, error: null };
    },

    // ---- measurement -------------------------------------------------------
    async count(table, filter) {
      const absolute = await absoluteCount(table, filter);
      if (filter) return absolute;
      if (!baseline.has(table)) return absolute;
      const delta = absolute - baseline.get(table);
      if (delta < 0) {
        refuse(
          `public.${table} has FEWER rows than the baseline census recorded. ` +
            "A run must never destroy a row it did not create.",
        );
      }
      return delta;
    },

    async counts(tables) {
      const sorted = [...new Set(tables)].sort();
      const out = {};
      for (const table of sorted) out[table] = await transport.count(table);
      return out;
    },

    async readJob(id) {
      const { data, error } = await service
        .from("import_job")
        .select(
          "status,commit_attempts,rollback_count,last_error_code,committed_at,rolled_back_at,payload_digest,actual_counts,error_report",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) refuse(`reading the import job failed with ${error.code ?? "no code"}.`);
      if (!data) return null;
      return {
        status: data.status,
        commit_attempts: data.commit_attempts,
        rollback_count: data.rollback_count,
        last_error_code: data.last_error_code,
        has_committed_at: data.committed_at !== null,
        has_rolled_back_at: data.rolled_back_at !== null,
        has_digest: data.payload_digest !== null,
        actual_counts: data.actual_counts,
        error_report: data.error_report,
      };
    },

    // ---- scope -------------------------------------------------------------
    async createStudy(label) {
      const tenantName = assertDisposableName(target, "the tenant", `${target.disposablePrefix} ${label} tenant`);
      const { data: tenant, error: tenantError } = await service
        .from("tenant")
        .insert({ name: tenantName })
        .select("id")
        .single();
      if (tenantError) refuse(`creating the disposable tenant failed with ${tenantError.code ?? "no code"}.`);
      created.tenants.push(tenant.id);
      const studyId = await transport.createStudyInTenant(tenant.id, label);
      return { tenant: tenant.id, studyId };
    },

    async createStudyInTenant(tenantId, label) {
      const studyName = assertDisposableName(target, "the study", `${target.disposablePrefix} ${label} study`);
      const { data, error } = await service
        .from("study")
        .insert({ tenant_id: tenantId, name: studyName })
        .select("id")
        .single();
      if (error) refuse(`creating the disposable study failed with ${error.code ?? "no code"}.`);
      created.studies.push(data.id);
      return data.id;
    },

    /**
     * Two columns of ONE study this run created, so a duplicate participation is
     * detectable without a `group by`. The rows are this run's own synthetic
     * fixtures; no pre-existing row is ever read.
     */
    async duplicateParticipations(studyId) {
      const { data, error } = await service
        .from("study_participant")
        .select("person_id,cohort_key")
        .eq("study_id", studyId);
      if (error) refuse(`reading this run's participations failed with ${error.code ?? "no code"}.`);
      const seen = new Set();
      let duplicates = 0;
      for (const row of data ?? []) {
        const key = JSON.stringify([row.person_id, row.cohort_key]);
        if (seen.has(key)) duplicates += 1;
        else seen.add(key);
      }
      return duplicates;
    },

    /**
     * A hosted target is already migrated. `prepare` therefore VERIFIES rather
     * than applies, and refuses any partial schema, because a suite that
     * silently ran against migrations 0000-0023 would be measuring the wrong
     * database.
     */
    async prepare(upTo = 24) {
      if (upTo !== 24) {
        refuse(
          `this transport cannot roll the schema back to ${upTo}: it applies no migration and reverses none.`,
        );
      }
      for (const table of ["import_job_record", "retention_period"]) {
        const { error } = await service.from(table).select("*", { count: "exact", head: true });
        if (error) refuse(`public.${table} is not reachable, so migration 0024 is not applied to this target.`);
      }
    },

    // ---- capability: roleSwitch --------------------------------------------
    /** The SQLSTATE a role gets when it calls a function, or null if it worked. */
    async probeFunctionExecute(role, fn, spec) {
      const client = role === "service_role" ? service : anon;
      if (!client) refuse(`no client is configured for the role '${role}'.`);
      const { error } = await client.rpc(fn, spec.rest);
      return error?.code ?? null;
    },

    /** The SQLSTATE a role gets when it reads a table, or null if it worked. */
    async probeTableRead(role, table) {
      const client = role === "service_role" ? service : anon;
      if (!client) refuse(`no client is configured for the role '${role}'.`);
      const { error } = await client.from(table).select("*").limit(1);
      return error?.code ?? null;
    },
  };

  return transport;
}

/**
 * Delete exactly what a run created, in reverse-dependency order.
 *
 * Every id came from this run's own inserts, and every name carries the run's
 * disposable prefix — the two together are what make "delete what we made"
 * decidable on a database that also holds real work.
 */
export async function deleteRunObjects(target, registry) {
  const service = clientFor(target, target.serviceKey);
  const removed = {};

  const del = async (table, column, values) => {
    if (values.length === 0) return;
    const { error, count } = await service.from(table).delete({ count: "exact" }).in(column, values);
    if (error) throw new RestTransportError(`cleanup of public.${table} failed with ${error.code ?? "no code"}.`);
    removed[table] = (removed[table] ?? 0) + (count ?? 0);
  };

  const studies = [...new Set(registry.studies)];
  const tenants = [...new Set(registry.tenants)];

  // Import jobs belonging to this run's studies, and everything hanging off them.
  const { data: jobs, error: jobError } = await service
    .from("import_job")
    .select("id")
    .in("study_id", studies.length > 0 ? studies : ["00000000-0000-4000-8000-000000000000"]);
  if (jobError) throw new RestTransportError(`listing this run's import jobs failed with ${jobError.code ?? "no code"}.`);
  const jobIds = (jobs ?? []).map((row) => row.id);

  await del("import_job_record", "import_job_id", jobIds);
  await del("source_lineage", "import_job_id", jobIds);
  await del("import_job_asset", "import_job_id", jobIds);
  await del("import_job", "id", jobIds);
  await del("source_asset", "tenant_id", tenants);
  await del("study", "id", studies);
  await del("tenant", "id", tenants);
  return removed;
}
