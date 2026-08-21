import { z } from "zod";

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "usa minúsculas, números y guion bajo; debe iniciar con letra");

export const recodingTableSchema = z.object({
  id: keySchema,
  version: z.number().int().positive(),
  values: z
    .record(z.string().min(1), z.number().finite())
    .refine((values) => Object.keys(values).length > 0, "incluye al menos una equivalencia"),
});

const commonTarget = { required: z.boolean().optional() };

export const columnTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ignore") }),
  z.object({ kind: z.literal("segment"), key: keySchema, ...commonTarget }),
  z
    .object({
      kind: z.literal("quantitative"),
      metricKey: keySchema,
      recodingTableId: keySchema.optional(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      ...commonTarget,
    })
    .refine((target) => target.min === undefined || target.max === undefined || target.min <= target.max, {
      message: "el mínimo no puede ser mayor que el máximo",
    }),
  z.object({
    kind: z.literal("qualitative"),
    theme: keySchema,
    source: keySchema.optional(),
    ...commonTarget,
  }),
]);

export const importMappingSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  columns: z
    .array(
      z.object({
        sourceColumn: z.string().trim().min(1).max(300),
        target: columnTargetSchema,
      }),
    )
    .min(1),
  recodingTables: z.array(recodingTableSchema).default([]),
});

export type RecodingTable = z.infer<typeof recodingTableSchema>;
export type ColumnTarget = z.infer<typeof columnTargetSchema>;
export type ImportMapping = z.infer<typeof importMappingSchema>;

/** Header identity ignores order, surrounding whitespace, and letter case. */
export function normalizeHeader(header: string): string {
  return header.trim().toLocaleLowerCase("es-MX");
}

export function validateUniqueHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (seen.has(normalized)) duplicates.add(header.trim());
    seen.add(normalized);
  }
  return [...duplicates];
}

/** Stable SHA-256 signature for recognizing repeat exports of one instrument. */
export async function sourceSignature(headers: string[]): Promise<string> {
  if (headers.length === 0 || headers.some((header) => normalizeHeader(header) === "")) {
    throw new Error("El archivo debe tener encabezados no vacíos.");
  }
  const duplicates = validateUniqueHeaders(headers);
  if (duplicates.length > 0) {
    throw new Error(`Encabezados duplicados: ${duplicates.join(", ")}.`);
  }
  const canonical = JSON.stringify(headers.map(normalizeHeader).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}
