import { z } from "zod";
import { foldSegmentValue } from "@/lib/calc/segments";

export type DataScope = Record<string, string[]>;

const dimensionSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}_-]+$/u);
const valueSchema = z.string().trim().min(1).max(200);
const scopeSchema = z.record(dimensionSchema, z.array(valueSchema).min(1).max(100))
  .refine((scope) => Object.keys(scope).length <= 20, "too many scope dimensions");

export function parseDataScope(value: unknown): DataScope {
  const parsed = scopeSchema.safeParse(value ?? {});
  if (!parsed.success) throw new Error("Invalid profile data scope");
  return Object.fromEntries(Object.entries(parsed.data).map(([dimension, values]) => [
    dimension,
    [...new Set(values)],
  ]));
}

/**
 * Empty scope means full tenant access; dimensions combine with AND.
 *
 * Values are compared through the same lexical fold the rest of the product
 * groups characteristics by (src/lib/calc/segments.ts). A scope saved as
 * "Legal y Contable" and a row that arrived as "Legal y contable" are the same
 * category — matching them by exact string would silently hide a person's data
 * from someone authorized to see it, and would break the moment a study
 * canonicalises its labels.
 */
export function applyDataScope<T extends Record<string, unknown>>(rows: T[], scope: DataScope): T[] {
  const entries = Object.entries(scope).map(([dimension, allowed]) => [
    dimension,
    new Set(allowed.map(foldSegmentValue)),
  ] as const);
  if (!entries.length) return rows;
  return rows.filter((row) => entries.every(([dimension, allowed]) => {
    const value = row[dimension];
    return value != null && allowed.has(foldSegmentValue(String(value)));
  }));
}
