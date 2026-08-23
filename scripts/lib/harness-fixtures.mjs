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
 * PR 5 supports exactly `study` and `tenant`. Storage objects, import batches
 * and templates are deliberately absent: their safe deletion paths have not
 * been verified, and guessing at one is how a cleanup pass destroys real data.
 */
export const KINDS = Object.freeze({
  // order 0 = child, deleted before the tenant it belongs to.
  study: {
    order: 0,
    table: "study",
    columns: "id, name, tenant_id",
    owned(meta, context) {
      if (typeof meta?.name !== "string" || !meta.name.startsWith(context.prefix)) return false;
      if (!context.tenantId) return false;
      return meta.tenant_id === context.tenantId;
    },
  },
  tenant: {
    order: 1,
    table: "tenant",
    columns: "id, name",
    owned(meta, context) {
      return typeof meta?.name === "string" && meta.name.startsWith(context.prefix);
    },
  },
});

const PREFIXED_KINDS = ["tenant", "study"];

function base36(bytes) {
  return [...randomBytes(bytes)].map((b) => (b % 36).toString(36)).join("");
}

/** `P7H-<UTC>-<6 random base36>` — identifies the run, never selects a delete. */
export function newRunPrefix() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `P7H-${stamp}-${base36(6)}`;
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
  return {
    async countPrefixed(kind, prefix) {
      const spec = KINDS[kind];
      const { count, error } = await admin
        .from(spec.table)
        .select("id", { count: "exact", head: true })
        .like("name", `${prefix}%`);
      if (error) throw new Error(`preflight ${spec.table}: ${error.message}`);
      return count ?? 0;
    },
    async readMeta(kind, id) {
      const spec = KINDS[kind];
      const { data, error } = await admin.from(spec.table).select(spec.columns).eq("id", id).maybeSingle();
      if (error) throw new Error(`ownership read ${spec.table}: ${error.message}`);
      return data ?? null;
    },
    async deleteById(kind, id) {
      const spec = KINDS[kind];
      const { error } = await admin.from(spec.table).delete().eq("id", id);
      return { ok: !error };
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

export function createFixtures({ prefix, protectedTenantIds = [], gateway } = {}) {
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
  const ownershipContext = () => ({ prefix, tenantId: tenantEntry()?.id ?? null });
  const ownsId = (id) => ledger.some((entry) => entry.id === id);

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
    for (const kind of PREFIXED_KINDS) counts[kind] = await data.countPrefixed(kind, prefix);
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
    if (ownsId(record.id)) throw new Error("ledger: this id is already tracked");
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
  };
}
