import { z } from "zod";
import { readXlsxWorkbook } from "../xlsx-reader";
import { WorkbookView } from "../canonical-package/sheet-view";
import { fileHash } from "../canonical-package/fingerprint";
import { preflightCanonicalPackage } from "../canonical-package/preflight";
import type { CanonicalPackageSpec } from "../canonical-package/spec";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../canonical-package/spec";
import type { CanonicalPackagePreflight } from "../canonical-package/types";
import { buildCanonicalCommitPlan } from "./projector";
import type { CanonicalCommitPlan } from "./plan";
import { planFingerprintMatches } from "./fingerprint";
import type { PackageProjectionSpec } from "./projection-spec";
import { CUICUILCO_PROJECTION_V1 } from "./projection-spec";
import { reconcileCounts } from "./reconcile";
import type { CanonicalCommitOutcome, CanonicalRollbackOutcome } from "./result";
import { commitErrorMessage, refusal, safeErrorCode } from "./result";

/**
 * The commit and rollback WORKFLOW, with the database behind one interface.
 *
 * WHY THE TRANSPORT IS INJECTED. The order of operations here is the safety
 * property — preflight the exact bytes, refuse on a blocker, project, stage the
 * fingerprint, commit once, reconcile, and revert if the counts disagree — and
 * an untestable order of operations is an unproved one. A `CommitTransport` is
 * a single `rpc` call, so the whole workflow runs against a fake in the gate
 * while `adapter.ts` supplies the real service-role client.
 *
 * It does NOT weaken the boundary. This module holds no Supabase client, no
 * credentials and no privilege; the only implementation that reaches a database
 * lives in `adapter.ts`, which is `server-only`. And a browser holding a
 * transport of its own still has nothing to call: migration 0024 revokes both
 * functions from `public`, `anon` and `authenticated` and grants them solely to
 * `service_role`, and every canonical table denies browser roles under RLS and
 * FORCE RLS.
 */

const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** One database call. The only thing this workflow can do to the outside world. */
export type CommitTransport = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export type CanonicalCommitFile = {
  fileName: string;
  bytes: ArrayBuffer;
  mediaType?: string;
};

export type CanonicalCommitParams = {
  tenantId: string;
  studyId: string;
  files: CanonicalCommitFile[];
  actorId?: string | null;
  spec?: CanonicalPackageSpec;
  projection?: PackageProjectionSpec;
};

const uuidSchema = z.string().uuid("El identificador no es un UUID válido.");

const paramsSchema = z.object({
  tenantId: uuidSchema,
  studyId: uuidSchema,
  actorId: uuidSchema.nullable().optional(),
});

type StageResult = { importJobId?: string; status?: string; assets?: number; planFingerprint?: string };

type CommitResult = {
  importJobId?: string;
  status?: string;
  replayed?: boolean;
  code?: string;
  counts?: Record<string, unknown>;
  planFingerprint?: string;
  commitAttempts?: number;
  rollbackCount?: number;
};

/**
 * Preflight, project, stage and commit — in that order, every time.
 *
 * Returns a SAFE outcome. No branch puts a source value, a database message or
 * a plan fragment into what it returns, and no branch logs one either.
 */
export async function runCanonicalCommit(
  transport: CommitTransport,
  params: CanonicalCommitParams,
): Promise<CanonicalCommitOutcome> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return refusal("RESULT_SHAPE_INVALID", null);

  const spec = params.spec ?? CUICUILCO_PACKAGE_SPEC_V1;
  const projection = params.projection ?? CUICUILCO_PROJECTION_V1;

  // 1. The preflight runs HERE, over the bytes this call was handed. There is
  //    no parameter for a previously-computed report, so a caller cannot assert
  //    that a package is clean; it has to be clean.
  const preflight = await preflightCanonicalPackage(
    params.files.map(({ fileName, bytes }) => ({ fileName, bytes })),
    spec,
  );
  if (!preflight.confirmationAllowed || preflight.packageIdempotencyKey === null) {
    return refusal("PREFLIGHT_BLOCKED", null, {
      status: "blocked",
      findings: preflight.findings.filter((finding) => finding.severity === "blocker"),
    });
  }

  // 2. Bind each uploaded file to the role the preflight resolved, by CONTENT.
  //    A file name is never identity, here or anywhere in the package contract.
  const workbooks = new Map<string, WorkbookView>();
  const roleByHash = new Map<string, string>();
  for (const asset of preflight.assets) {
    if (asset.role) roleByHash.set(asset.sha256, asset.role);
  }
  const assetRequests: Array<Record<string, unknown>> = [];
  for (const file of params.files) {
    const sha256 = await fileHash(file.bytes);
    const role = roleByHash.get(sha256);
    if (!role) return refusal("PREFLIGHT_BLOCKED", null, { status: "blocked" });
    workbooks.set(role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
    assetRequests.push({
      role,
      sha256,
      fileName: file.fileName,
      mediaType: file.mediaType ?? XLSX_MEDIA_TYPE,
      sizeBytes: file.bytes.byteLength,
      workbookMetadata: assetMetadata(preflight, sha256),
    });
  }

  // 3. Project. A blocker here means the plan could not be built without
  //    guessing, so nothing is staged and nothing is written.
  const build = buildCanonicalCommitPlan({
    tenantId: params.tenantId,
    studyId: params.studyId,
    packageIdempotencyKey: preflight.packageIdempotencyKey,
    spec,
    projection,
    workbooks,
  });
  if (!build.ok) {
    return refusal("PROJECTION_BLOCKED", null, {
      status: "blocked",
      issues: build.issues.filter((issue) => issue.severity === "blocker"),
    });
  }
  const plan = build.plan;
  if (!planFingerprintMatches(plan)) return refusal("PLAN_FINGERPRINT_MISMATCH", null);

  // 4. Stage the package, its assets and the fingerprint of THIS plan.
  const staged = await callRpc<StageResult>(transport, "stage_canonical_package", {
    p_tenant_id: params.tenantId,
    p_study_id: params.studyId,
    p_request: {
      specId: plan.specId,
      mappingVersion: plan.mappingVersion,
      idempotencyKey: plan.packageIdempotencyKey,
      planFingerprint: plan.planFingerprint,
      manifest: safeManifest(preflight, plan),
      expectedCounts: plan.expectedCounts,
      assets: assetRequests,
      createdBy: params.actorId ?? null,
    },
  });
  if (!staged.ok) return refusal(staged.code, null);
  const importJobId = staged.value?.importJobId;
  if (typeof importJobId !== "string") return refusal("RESULT_SHAPE_INVALID", null);

  // 5. Commit. One statement, one transaction, all or nothing.
  const committed = await callRpc<CommitResult>(transport, "commit_canonical_package", {
    p_import_job_id: importJobId,
    p_plan: plan,
  });
  if (!committed.ok) return refusal(committed.code, importJobId);

  const result = committed.value;
  if (!result || result.importJobId !== importJobId) {
    return refusal("RESULT_SHAPE_INVALID", importJobId);
  }
  if (result.status === "failed") {
    // The function caught the failure inside its own subtransaction, so the
    // rows of the failed attempt are already gone and the job records it.
    const code = typeof result.code === "string" ? result.code : "DATABASE_CONSTRAINT";
    return {
      ok: false,
      status: "failed",
      importJobId,
      code,
      message: commitErrorMessage(code),
      findings: [],
      issues: [],
      disagreements: [],
    };
  }
  if (result.status !== "committed") return refusal("RESULT_SHAPE_INVALID", importJobId);

  // 6. Reconcile what the database measured against what the plan declared. A
  //    replay reports the counts of the commit that already happened, which
  //    must still reconcile: if they do not, the stored package is not this one.
  const reconciliation = reconcileCounts(plan.expectedCounts, result.counts);
  if (!reconciliation.ok) {
    const reverted = await callRpc(transport, "rollback_canonical_package", {
      p_import_job_id: importJobId,
      p_actor: params.actorId ?? null,
    });
    return refusal(reverted.ok ? "COUNTS_NOT_RECONCILED" : "ROLLED_BACK_LEDGER_NOT_EMPTY", importJobId, {
      status: "failed",
      disagreements: reconciliation.disagreements,
    });
  }

  return {
    ok: true,
    status: "committed",
    replayed: result.replayed === true,
    importJobId,
    packageIdempotencyKey: plan.packageIdempotencyKey,
    planFingerprint: plan.planFingerprint,
    counts: { measured: reconciliation.measured, ownership: reconciliation.ownership },
    commitAttempts: typeof result.commitAttempts === "number" ? result.commitAttempts : 0,
    rollbackCount: typeof result.rollbackCount === "number" ? result.rollbackCount : 0,
  };
}

/**
 * Reverse a committed package.
 *
 * Idempotent by contract: rolling back a package that is already rolled back
 * answers the same way instead of refusing, so a retrying operator is never
 * told the package is still committed when it is not.
 */
export async function runCanonicalRollback(
  transport: CommitTransport,
  importJobId: string,
  actorId?: string | null,
): Promise<CanonicalRollbackOutcome> {
  const id = uuidSchema.safeParse(importJobId);
  const actor = actorId ? uuidSchema.safeParse(actorId) : null;
  if (!id.success || (actor !== null && !actor.success)) {
    return {
      ok: false,
      status: "refused",
      importJobId,
      code: "RESULT_SHAPE_INVALID",
      message: commitErrorMessage("RESULT_SHAPE_INVALID"),
    };
  }

  const reverted = await callRpc<{
    importJobId?: string;
    status?: string;
    replayed?: boolean;
    counts?: Record<string, unknown>;
    rollbackCount?: number;
  }>(transport, "rollback_canonical_package", {
    p_import_job_id: importJobId,
    p_actor: actorId ?? null,
  });
  if (!reverted.ok) {
    return {
      ok: false,
      status: "refused",
      importJobId,
      code: reverted.code,
      message: commitErrorMessage(reverted.code),
    };
  }
  const result = reverted.value;
  if (!result || result.importJobId !== importJobId || result.status !== "rolled_back") {
    return {
      ok: false,
      status: "refused",
      importJobId,
      code: "RESULT_SHAPE_INVALID",
      message: commitErrorMessage("RESULT_SHAPE_INVALID"),
    };
  }

  const counts = (result.counts ?? {}) as Record<string, unknown>;
  const removedRaw = counts._removed;
  const removed: Record<string, number> = {};
  if (removedRaw && typeof removedRaw === "object") {
    for (const [key, value] of Object.entries(removedRaw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isInteger(value)) removed[key] = value;
    }
  }
  return {
    ok: true,
    status: "rolled_back",
    replayed: result.replayed === true,
    importJobId,
    removed,
    retainedSharedIdentities:
      typeof counts._retainedSharedIdentities === "number" ? counts._retainedSharedIdentities : 0,
    rollbackCount: typeof result.rollbackCount === "number" ? result.rollbackCount : 0,
  };
}

type RpcOutcome<T> = { ok: true; value: T | null } | { ok: false; code: string };

/**
 * One RPC call, with the transport's own error reduced to a SAFE code.
 *
 * A PostgreSQL error message quotes the values that violated the constraint,
 * and in this schema those values are respondent data. The message is read
 * once, mapped to a code the migrations raise themselves, and then discarded —
 * never returned, never logged.
 */
async function callRpc<T>(
  transport: CommitTransport,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcOutcome<T>> {
  try {
    const { data, error } = await transport.rpc(name, args);
    if (error) return { ok: false, code: safeErrorCode(error) };
    return { ok: true, value: (data ?? null) as T | null };
  } catch (thrown) {
    return { ok: false, code: safeErrorCode(thrown) };
  }
}

/** Privacy-safe structure for `source_asset.workbook_metadata`. */
function assetMetadata(preflight: CanonicalPackagePreflight, sha256: string): Record<string, unknown> {
  const asset = preflight.assets.find((candidate) => candidate.sha256 === sha256);
  if (!asset) return {};
  return {
    role: asset.role,
    dateSystem: asset.dateSystem,
    sheetSignature: asset.sheetSignature,
    structuralSignature: asset.structuralSignature,
    sheets: asset.sheets.map((sheet) => ({
      name: sheet.name,
      index: sheet.index,
      state: sheet.state,
      expected: sheet.expected,
      maxRow: sheet.maxRow,
      maxColumn: sheet.maxColumn,
      populatedCells: sheet.populatedCells,
      mergedRanges: sheet.mergedRanges,
    })),
  };
}

/**
 * What is stored on `import_job.manifest`.
 *
 * The preflight report is already privacy-safe by Unit 2's own contract — it is
 * built to be displayed, logged and stored — so it is kept whole, and the plan
 * contributes only its counts and its fingerprint. No plan row goes here.
 */
export function safeManifest(
  preflight: CanonicalPackagePreflight,
  plan: CanonicalCommitPlan,
): Record<string, unknown> {
  return {
    preflight,
    plan: {
      specId: plan.specId,
      mappingVersion: plan.mappingVersion,
      planFingerprint: plan.planFingerprint,
      packageIdempotencyKey: plan.packageIdempotencyKey,
      expectedCounts: plan.expectedCounts,
    },
  };
}
