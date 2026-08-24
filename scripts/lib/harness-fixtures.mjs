// =============================================================================
// P7 adversarial harness — fixture lifecycle (docs/P7_HARNESS_DESIGN.md §6).
// =============================================================================
// The ONLY module that owns the service credential, and it uses it only for the
// three narrow purposes `docs/P7_PLAN.md` §3 permits: metadata preflight,
// residue counts, and exact-id deletion. No other harness module reads that
// environment variable or imports the privileged client (asserted by G4).
//
// Two invariants do the heavy lifting:
//   - the run prefix is an OWNERSHIP/COLLISION namespace, never a deletion key;
//   - nothing is deleted unless the object is re-read by exact id and PROVEN to
//     belong to the current run. Absence from the deny-list is not ownership.
//
// The data gateway is injectable so the ownership and cleanup rules can be
// exercised offline against mock objects, with no remote rows created.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

/** Objects that are out of bounds for every mutating operation (§6.2). */
export const P6E_STUDY_ID = "ad275928-dbd1-4acf-9de9-fa1623b32a60";
export const P6E_IMPORT_BATCH_ID = "bd4f26db-093a-4e31-8fa9-de8281300c63";

/**
 * Every kind `track()` accepts needs three things: where it lives, how current-
 * run ownership is proven, and where it sits in the deletion order. A kind
 * without all three is rejected by `track()` rather than becoming a silently
 * undeletable ledger entry.
 *
 * PR 5 supported exactly `study` and `tenant`. Storage objects, import batches
 * and templates are deliberately absent: their safe deletion paths have not
 * been verified, and guessing at one is how a cleanup pass destroys real data.
 *
 * PR 6 adds exactly two more, both required by Suite A's scoped-identity
 * fixture and both with a verified deletion path: `clientProfile` (a row of
 * `public.profiles`, keyed by `user_id`) and `authUser` (an Auth identity,
 * which is not a PostgREST table and therefore carries `custom: "auth"`).
 * Deletion order runs child -> parent: study, profile, auth user, tenant.
 */
export const KINDS = Object.freeze({
  // order 0 = child, deleted before the tenant it belongs to.
  study: {
    order: 0,
    table: "study",
    idColumn: "id",
    prefixColumn: "name",
    columns: "id, name, tenant_id",
    owned(meta, context) {
      if (typeof meta?.name !== "string" || !meta.name.startsWith(context.prefix)) return false;
      if (!context.tenantId) return false;
      return meta.tenant_id === context.tenantId;
    },
  },
  // The profile goes before its Auth identity: deleting the identity cascades
  // the profile away, and a cleanup pass must never rely on a cascade it did
  // not assert.
  clientProfile: {
    order: 1,
    table: "profiles",
    idColumn: "user_id",
    prefixColumn: "full_name",
    columns: "user_id, tenant_id, role, full_name, data_scope",
    owned(meta, context) {
      if (typeof meta?.full_name !== "string" || !meta.full_name.startsWith(context.prefix)) return false;
      if (meta.role !== "client") return false;
      // A home tenant, when declared, must match exactly: the fixture lives in
      // an existing synthetic tenant, so the prefix alone is not enough.
      return !context.homeTenantId || meta.tenant_id === context.homeTenantId;
    },
  },
  authUser: {
    order: 2,
    custom: "auth",
    idColumn: "id",
    prefixColumn: "email",
    owned(meta, context) {
      return typeof meta?.email === "string" && meta.email.startsWith(context.prefix.toLowerCase());
    },
  },
  tenant: {
    order: 3,
    table: "tenant",
    idColumn: "id",
    prefixColumn: "name",
    columns: "id, name",
    owned(meta, context) {
      return typeof meta?.name === "string" && meta.name.startsWith(context.prefix);
    },
  },
});

const DEFAULT_PREFIXED_KINDS = ["tenant", "study"];

function base36(bytes) {
  return [...randomBytes(bytes)].map((b) => (b % 36).toString(36)).join("");
}

/** `P7H-<UTC>-<6 random base36>` — identifies the run, never selects a delete. */
export function newRunPrefix() {
  return stampedPrefix("P7H");
}

/**
 * `<tag>-<UTC>-<6 random base36>`. Suite A mints `P7A-` so its residue can never
 * be confused with PR 5's `P7H-` self-test fixtures, which remain a separate
 * workflow that creates no Auth user.
 */
export function stampedPrefix(tag) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${tag}-${stamp}-${base36(6)}`;
}

/** A password held only in memory, never printed, never persisted. */
export function newFixtureSecret() {
  return randomBytes(24).toString("base64url");
}

/**
 * The privileged gateway. Built here and nowhere else, so the credential never
 * appears in a module that produces evidence. It returns metadata and counts
 * only — never respondent rows, never the credential itself.
 */
export function createServiceRoleGateway() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "fixtures require NEXT_PUBLIC_SUPABASE_URL and the fixture service credential in the environment",
    );
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  /**
   * Auth identities are not a PostgREST table, so counting them means listing a
   * bounded page. This is pagination, not a retry: one page is requested, and a
   * full page is a hard failure rather than a signal to fetch another.
   */
  const AUTH_PAGE = 200;
  async function listAuthUsersOnce() {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: AUTH_PAGE });
    if (error) throw new Error(`auth inventory: ${error.message}`);
    const users = data?.users ?? [];
    if (users.length >= AUTH_PAGE) {
      throw new Error(
        `auth inventory returned a full page of ${AUTH_PAGE} — refusing to reason about residue from a truncated list`,
      );
    }
    return users;
  }

  return {
    async countPrefixed(kind, prefix) {
      const spec = KINDS[kind];
      if (spec.custom === "auth") {
        const needle = prefix.toLowerCase();
        return (await listAuthUsersOnce()).filter((u) => (u.email ?? "").startsWith(needle)).length;
      }
      const { count, error } = await admin
        .from(spec.table)
        .select(spec.idColumn, { count: "exact", head: true })
        .like(spec.prefixColumn, `${prefix}%`);
      if (error) throw new Error(`preflight ${spec.table}: ${error.message}`);
      return count ?? 0;
    },
    async readMeta(kind, id) {
      const spec = KINDS[kind];
      if (spec.custom === "auth") {
        const { data, error } = await admin.auth.admin.getUserById(id);
        // A deleted identity answers with an error, which the caller reads as
        // "absent"; a genuine transport failure would surface the same way, so
        // cleanup re-counts residue afterwards rather than trusting this alone.
        if (error || !data?.user) return null;
        return { id: data.user.id, email: data.user.email ?? null };
      }
      const { data, error } = await admin
        .from(spec.table)
        .select(spec.columns)
        .eq(spec.idColumn, id)
        .maybeSingle();
      if (error) throw new Error(`ownership read ${spec.table}: ${error.message}`);
      return data ?? null;
    },
    async deleteById(kind, id) {
      const spec = KINDS[kind];
      if (spec.custom === "auth") {
        const { error } = await admin.auth.admin.deleteUser(id);
        return { ok: !error };
      }
      const { error } = await admin.from(spec.table).delete().eq(spec.idColumn, id);
      return { ok: !error };
    },

    // --- Suite A fixture provisioning (setup and teardown ONLY) -------------
    // Nothing below issues a request whose RESULT is an authorization verdict.
    // Every Suite A assertion signs in as the real identity created here and
    // reaches the application or PostgREST through the publishable key.

    /**
     * Creates one synthetic Auth identity with a confirmed address, so no
     * invitation is generated and no message is ever sent. The password is
     * supplied by the caller from the runtime's random source and is neither
     * stored nor returned.
     */
    async createAuthUser({ email, password }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data?.user) {
        throw new Error(`fixture identity could not be created (${error?.code ?? error?.message ?? "empty response"})`);
      }
      return { id: data.user.id };
    },

    /** Same profile shape the application's own client-user path writes. */
    async upsertClientProfile({ userId, tenantId, fullName, dataScope }) {
      const { error } = await admin
        .from("profiles")
        .upsert(
          { user_id: userId, tenant_id: tenantId, role: "client", full_name: fullName, data_scope: dataScope },
          { onConflict: "user_id" },
        );
      if (error) throw new Error(`fixture profile could not be written (${error.code ?? error.message})`);
    },

    // --- metadata reads used for before/after accounting -------------------
    async countTable(table) {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
      if (error) throw new Error(`count ${table}: ${error.message}`);
      return count ?? 0;
    },
    async countAuthUsers() {
      return (await listAuthUsersOnce()).length;
    },
    async countProfiles() {
      const { count, error } = await admin.from("profiles").select("user_id", { count: "exact", head: true });
      if (error) throw new Error(`count profiles: ${error.message}`);
      return count ?? 0;
    },

    /**
     * A5 — privileged database-integrity control, NOT client authorization
     * evidence. Deliberately stamps a batch with a tenant that does not own the
     * study, so the composite foreign key `(study_id, tenant_id)` must reject
     * it. The marker makes the residue count exact. The referenced study is
     * only an FK target: no row of it is read, written or deleted.
     */
    async probeCompositeTenantStamp({ studyId, mismatchedTenantId, marker }) {
      const { error } = await admin.from("import_batch").insert({
        tenant_id: mismatchedTenantId,
        study_id: studyId,
        source_signature: `sha256:${"0".repeat(64)}`,
        file_name: marker,
        status: "staged",
        source_rows: 1,
        expected_respondents: 1,
        expected_quant: 0,
        expected_qual: 0,
      });
      const { count, error: countError } = await admin
        .from("import_batch")
        .select("id", { count: "exact", head: true })
        .eq("file_name", marker);
      if (countError) throw new Error(`stamping residue count: ${countError.message}`);
      return { code: error?.code ?? null, rejected: Boolean(error), rowsWithMarker: count ?? 0 };
    },
    async reportControl(id) {
      const { data, error } = await admin
        .from("study")
        .select("id, tenant_id, status, dashboard_config")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`report control metadata: ${error.message}`);
      if (!data) return null;
      return {
        tenantId: data.tenant_id,
        status: data.status,
        reportEnabled: (data.dashboard_config?.sections ?? {}).report !== false,
      };
    },
  };
}

export function createFixtures({
  prefix,
  protectedTenantIds = [],
  gateway,
  /** Kinds the preflight and residue counts sweep by prefix. */
  prefixedKinds = DEFAULT_PREFIXED_KINDS,
  /** When set, a `clientProfile` is only owned if it sits in exactly this tenant. */
  homeTenantId = null,
} = {}) {
  const data = gateway ?? createServiceRoleGateway();
  const ledger = [];
  const denied = new Set([P6E_STUDY_ID, P6E_IMPORT_BATCH_ID, ...protectedTenantIds.filter(Boolean)]);
  let sequence = 0;
  let halted = false;

  /**
   * Closes the ledger to new work. Called the moment a run is cancelled and
   * again before cleanup, so no fixture can be authorized or tracked while — or
   * after — cleanup runs. Idempotent.
   */
  function halt() {
    halted = true;
  }
  function assertOpen(what) {
    if (halted) {
      throw new Error(`fixture ledger is closed: refusing to ${what} after the run was cancelled or cleaned up`);
    }
  }

  const tenantEntry = () => ledger.find((entry) => entry.kind === "tenant") ?? null;
  const ownershipContext = () => ({ prefix, tenantId: tenantEntry()?.id ?? null, homeTenantId });
  const ownsId = (id) => ledger.some((entry) => entry.id === id);
  // Uniqueness is per (kind, id), not per id: a profile and the Auth identity it
  // belongs to legitimately share one UUID, and both must be ledgered so both
  // are deleted by exact id rather than one being left to a cascade.
  const ownsKindId = (kind, id) => ledger.some((entry) => entry.kind === kind && entry.id === id);

  /**
   * The mutation precondition (§6.2, §6.6). A mutating operation may only
   * target an object this run created; a creating operation with no existing
   * target is the sole exception. Being absent from the deny-list is NOT
   * sufficient — that would leave every pre-existing object one harness bug
   * away from being mutated.
   */
  function authorizeMutation(op, params = {}) {
    if (!op?.mutating) return;
    assertOpen("authorize a mutation");
    for (const value of Object.values(params)) {
      if (typeof value === "string" && denied.has(value)) {
        throw new Error("deny-list: refusing to mutate a protected object (id withheld)");
      }
    }
    for (const key of op.scopeParams ?? []) {
      const tenant = tenantEntry();
      if (!tenant) {
        throw new Error(
          "fixture scope: no throwaway tenant is ledgered yet, so no scoped fixture may be created",
        );
      }
      if (params[key] !== tenant.id) {
        throw new Error("fixture scope: refusing to place a fixture outside this run's throwaway tenant");
      }
    }
    for (const key of op.targetParams ?? []) {
      if (!ownsId(params[key])) {
        throw new Error("ownership: refusing to mutate an object this run does not own");
      }
    }
  }

  async function countAllPrefixed() {
    const counts = {};
    for (const kind of prefixedKinds) counts[kind] = await data.countPrefixed(kind, prefix);
    return counts;
  }

  async function preflight() {
    const counts = await countAllPrefixed();
    const collisions = Object.entries(counts).filter(([, n]) => n > 0);
    if (collisions.length) {
      throw new Error(
        `preflight collision for prefix ${prefix}: ` +
          collisions.map(([kind, n]) => `${kind}=${n}`).join(", ") +
          " — a previous run leaked; remove those objects manually before re-running",
      );
    }
    return counts;
  }

  function track(record) {
    assertOpen("track a fixture");
    if (!record?.kind || !record?.id) throw new Error("ledger: kind and id are required");
    if (!KINDS[record.kind]) {
      throw new Error(
        `ledger: kind "${record.kind}" has no ownership validator or deletion strategy — ` +
          "add and review one before tracking it",
      );
    }
    if (denied.has(record.id)) throw new Error("ledger: refusing to track a protected object");
    if (ownsKindId(record.kind, record.id)) throw new Error("ledger: this kind and id are already tracked");
    sequence += 1;
    const entry = { ...record, kind: record.kind, id: record.id, prefix, seq: sequence, createdAt: new Date().toISOString() };
    ledger.push(entry);
    return entry;
  }

  const reportControlMetadata = (studyId) => data.reportControl(studyId);

  async function residue(kinds) {
    const counts = {};
    for (const kind of kinds) {
      if (!KINDS[kind]) continue;
      counts[kind] = await data.countPrefixed(kind, prefix);
    }
    return counts;
  }

  /** Child kinds before the tenant; newest-first within the same kind (§6.7). */
  function deletionOrder() {
    return [...ledger].sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order || b.seq - a.seq);
  }

  /**
   * Deletes only ledger ids, and only after re-reading each object by exact id
   * and proving it belongs to this run. An id the harness captured wrongly
   * therefore cannot be deleted: ownership fails and the run goes red.
   */
  async function cleanup() {
    // Cleanup always runs with the ledger closed, so nothing can be created or
    // tracked while deletions are in flight.
    halt();
    const context = ownershipContext();
    const refused = [];
    const failed = [];
    const absent = [];
    let removed = 0;

    for (const entry of deletionOrder()) {
      const kind = entry.kind;
      let meta = null;
      try {
        meta = await data.readMeta(kind, entry.id);
      } catch {
        refused.push({ kind, id: entry.id });
        continue;
      }
      if (!meta) {
        absent.push({ kind, id: entry.id });
        continue;
      }
      if (!KINDS[kind].owned(meta, context)) {
        refused.push({ kind, id: entry.id });
        continue;
      }
      const result = await data.deleteById(kind, entry.id);
      if (result?.ok) removed += 1;
      else failed.push({ kind, id: entry.id });
    }

    let residual = {};
    let residualReadable = true;
    try {
      residual = await countAllPrefixed();
    } catch {
      residualReadable = false;
    }
    const leftOver = Object.entries(residual).filter(([, n]) => n !== 0);
    const clean =
      refused.length === 0 && failed.length === 0 && residualReadable && leftOver.length === 0;
    return {
      removed,
      refused,
      failed,
      absent,
      residual,
      residualReadable,
      leaked: [...refused, ...failed],
      clean,
    };
  }

  return {
    prefix,
    ledger,
    KINDS,
    /**
     * The narrow privileged surface: provisioning, metadata counts and exact-id
     * deletion. Exposed so a suite can perform fixture setup and before/after
     * accounting WITHOUT holding the credential itself. Nothing here may be
     * used to produce an authorization verdict.
     */
    gateway: data,
    authorizeMutation,
    preflight,
    track,
    residue,
    reportControlMetadata,
    deletionOrder,
    cleanup,
    halt,
    isHalted: () => halted,
    isDenied: (id) => denied.has(id),
    ownsId,
    ownsKindId,
  };
}
