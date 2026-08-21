import { z } from "zod";
import { importMappingSchema } from "@/lib/ingestion/mapping";

const keySchema = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/);

export const templatePayloadSchema = z.object({
  version: z.literal(1),
  metricSet: z.array(keySchema).max(500),
  segmentationDimensions: z.array(z.object({
    key: keySchema,
    label: z.string().trim().max(120).nullable(),
    parentKey: keySchema.nullable(),
    config: z.record(z.string(), z.unknown()),
  })).max(100),
  recodingTables: z.array(z.object({
    key: keySchema,
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
    values: z.record(z.string().min(1), z.number().finite()),
  })).max(100),
  columnMappings: z.array(z.object({
    sourceSignature: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    mapping: importMappingSchema,
  })).max(100),
  journeyDefinition: z.record(z.string(), z.unknown()),
  dashboardConfig: z.record(z.string(), z.unknown()),
  qualitativeCategories: z.array(z.string().trim().min(1).max(120)).max(200),
});

export type TemplatePayload = z.infer<typeof templatePayloadSchema>;

export const EMPTY_TEMPLATE_PAYLOAD: TemplatePayload = {
  version: 1,
  metricSet: [],
  segmentationDimensions: [],
  recodingTables: [],
  columnMappings: [],
  journeyDefinition: {},
  dashboardConfig: {},
  qualitativeCategories: [],
};

export function cloneTemplatePayload(payload: TemplatePayload): TemplatePayload {
  return templatePayloadSchema.parse(structuredClone(payload));
}

export function templatePreview(payload: TemplatePayload) {
  return {
    metrics: payload.metricSet.length,
    dimensions: payload.segmentationDimensions.length,
    mappings: payload.columnMappings.length,
    journeyStages: Array.isArray(payload.journeyDefinition.stages)
      ? payload.journeyDefinition.stages.length
      : 0,
    qualitativeCategories: payload.qualitativeCategories.length,
  };
}
