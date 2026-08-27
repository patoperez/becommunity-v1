import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalRespondent, IngestSummary } from "./canonical";

export type AtomicIngestParams = {
  tenantId: string;
  studyId: string;
  mappingId?: string | null;
  sourceSignature: string;
  fileName: string;
  sourceRows: number;
  createdBy?: string | null;
  respondents: CanonicalRespondent[];
};

export type AtomicIngestSummary = IngestSummary & { importBatchId: string };

type CommitResult = {
  import_batch_id: string;
  respondents: number;
  quant: number;
  qual: number;
};

function expectedSummary(respondents: CanonicalRespondent[]): IngestSummary {
  return {
    respondents: respondents.length,
    quant: respondents.reduce((count, respondent) => count + respondent.quant.length, 0),
    qual: respondents.reduce((count, respondent) => count + respondent.qual.length, 0),
  };
}

function canonicalPayload(respondents: CanonicalRespondent[]) {
  return respondents.map(({ id, privateMetadata, segments, quant, qual }) => ({
    id,
    privateMetadata,
    segments,
    quant,
    qual,
  }));
}

function safeFailureMessage(error: string): string {
  return error.replace(/[\r\n\t]+/g, " ").slice(0, 1000);
}

/**
 * Stage metadata, then commit every canonical response inside one PostgreSQL
 * transaction. The RPC derives tenant/study from the locked batch and stamps
 * every row; it never trusts tenant identifiers inside the JSON payload.
 */
export async function persistRespondents(
  client: SupabaseClient,
  params: AtomicIngestParams,
): Promise<AtomicIngestSummary> {
  const expected = expectedSummary(params.respondents);
  if (expected.respondents === 0) throw new RangeError("Cannot persist an empty import");
  if (!Number.isSafeInteger(params.sourceRows) || params.sourceRows < expected.respondents) {
    throw new RangeError("sourceRows must include every canonical respondent");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(params.sourceSignature)) {
    throw new RangeError("sourceSignature must be a SHA-256 signature");
  }
  const fileName = params.fileName.trim();
  if (fileName.length === 0 || fileName.length > 255) {
    throw new RangeError("fileName must contain 1 to 255 characters");
  }

  const { data: batch, error: stageError } = await client
    .from("import_batch")
    .insert({
      tenant_id: params.tenantId,
      study_id: params.studyId,
      mapping_id: params.mappingId ?? null,
      source_signature: params.sourceSignature,
      file_name: fileName,
      status: "staged",
      source_rows: params.sourceRows,
      expected_respondents: expected.respondents,
      expected_quant: expected.quant,
      expected_qual: expected.qual,
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (stageError || !batch) {
    throw new Error(`import_batch: ${stageError?.message ?? "could not stage import"}`);
  }

  const { data, error } = await client.rpc("commit_import_batch_with_private", {
    p_import_batch_id: batch.id,
    p_respondents: canonicalPayload(params.respondents),
  });

  if (error) {
    await client
      .from("import_batch")
      .update({ status: "failed", error_message: safeFailureMessage(error.message) })
      .eq("id", batch.id)
      .eq("status", "staged");
    throw new Error(`commit_import_batch_with_private: ${error.message}`);
  }

  const committed = data as CommitResult | null;
  if (
    !committed ||
    committed.import_batch_id !== batch.id ||
    committed.respondents !== expected.respondents ||
    committed.quant !== expected.quant ||
    committed.qual !== expected.qual
  ) {
    await client.rpc("rollback_import_batch", { p_import_batch_id: batch.id });
    throw new Error("commit_import_batch returned counts that do not match the staged preview");
  }

  return { ...expected, importBatchId: batch.id };
}

export async function rollbackImportBatch(
  client: SupabaseClient,
  importBatchId: string,
): Promise<void> {
  const { data, error } = await client.rpc("rollback_import_batch", {
    p_import_batch_id: importBatchId,
  });
  if (error) throw new Error(`rollback_import_batch: ${error.message}`);
  const result = data as { import_batch_id?: string; status?: string } | null;
  if (result?.import_batch_id !== importBatchId || result.status !== "rolled_back") {
    throw new Error("rollback_import_batch returned an invalid result");
  }
}
