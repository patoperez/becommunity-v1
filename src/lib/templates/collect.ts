import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { importMappingSchema } from "@/lib/ingestion/mapping";
import {
  EMPTY_TEMPLATE_PAYLOAD,
  templatePayloadSchema,
  type TemplatePayload,
} from "./schema";

type StudyConfig = {
  id: string;
  dashboard_config: unknown;
  journey_definition: unknown;
  template_snapshot: unknown;
};

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parentFirst<T extends { id: string; parent_id: string | null }>(rows: T[]): T[] {
  const pending = [...rows];
  const ordered: T[] = [];
  const emitted = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex((row) => !row.parent_id || emitted.has(row.parent_id));
    const [next] = pending.splice(index >= 0 ? index : 0, 1);
    ordered.push(next);
    emitted.add(next.id);
  }
  return ordered;
}

/** Collects configuration only. It deliberately never selects response values or quotes. */
export async function collectStudyTemplatePayload(
  admin: SupabaseClient,
  study: StudyConfig,
): Promise<TemplatePayload> {
  const prior = templatePayloadSchema.safeParse(study.template_snapshot);
  const baseline = prior.success ? prior.data : EMPTY_TEMPLATE_PAYLOAD;

  const [{ data: metrics }, { data: dimensions }, { data: recodings }, { data: batches }] = await Promise.all([
    admin.from("quant_response").select("metric_key").eq("study_id", study.id),
    admin.from("segment_dimension").select("id, key, label, parent_id, config").eq("study_id", study.id),
    admin.from("recoding_table").select("key, name, version, values").eq("study_id", study.id).eq("is_active", true),
    admin.from("import_batch").select("mapping_id").eq("study_id", study.id).not("mapping_id", "is", null),
  ]);

  const mappingIds = [...new Set((batches ?? []).map((row) => row.mapping_id as string).filter(Boolean))];
  const { data: mappings } = mappingIds.length
    ? await admin.from("import_mapping").select("source_signature, configuration").in("id", mappingIds)
    : { data: [] as { source_signature: string; configuration: unknown }[] };

  const dimensionRows = parentFirst((dimensions ?? []) as {
    id: string; key: string; label: string | null; parent_id: string | null; config: unknown;
  }[]);
  const keyById = new Map(dimensionRows.map((row) => [row.id, row.key]));
  const discoveredMetrics = (metrics ?? []).map((row) => String(row.metric_key));
  const validMappings = (mappings ?? []).flatMap((row) => {
    const mapping = importMappingSchema.safeParse(row.configuration);
    return mapping.success ? [{ sourceSignature: row.source_signature, mapping: mapping.data }] : [];
  });

  return templatePayloadSchema.parse({
    version: 1,
    metricSet: [...new Set([...baseline.metricSet, ...discoveredMetrics])].sort(),
    segmentationDimensions: dimensionRows.length
      ? dimensionRows.map((row) => ({
          key: row.key,
          label: row.label,
          parentKey: row.parent_id ? keyById.get(row.parent_id) ?? null : null,
          config: objectOrEmpty(row.config),
        }))
      : baseline.segmentationDimensions,
    recodingTables: recodings?.length
      ? recodings.map((row) => ({
          key: String(row.key),
          name: String(row.name),
          version: Number(row.version),
          values: objectOrEmpty(row.values),
        }))
      : baseline.recodingTables,
    columnMappings: validMappings.length ? validMappings : baseline.columnMappings,
    journeyDefinition: objectOrEmpty(study.journey_definition),
    dashboardConfig: objectOrEmpty(study.dashboard_config),
    qualitativeCategories: baseline.qualitativeCategories,
  });
}
