import { z } from "zod";

/**
 * Input-boundary schemas (§5.3 "Input validation with Zod at every boundary").
 * Reject-by-default, whitelisted fields only. These guard the untrusted edges
 * (form fields, params) the same way `src/lib/ingestion/canonical.ts` guards the
 * file-ingestion boundary. Parse with `.safeParse`; never trust raw FormData.
 */

// ---- Auth / login boundary --------------------------------------------------
export const loginSchema = z.object({
  // trim first, then bound length, then format-check. Max 254 = RFC 5321 local+domain.
  email: z.string().trim().min(1).max(254).email(),
  // Bounded to stop absurd payloads; Supabase enforces real password policy.
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Study upload boundary --------------------------------------------------
/** Extensions accepted by the parser (mirrors src/lib/ingestion/parse.ts). */
export const ALLOWED_UPLOAD_EXTENSIONS = ["csv", "txt", "xlsx", "xlsm"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** The message the product shows for an over-limit source, in one place. */
export const UPLOAD_TOO_LARGE_MESSAGE = "El archivo supera el límite de 10 MB.";

/**
 * The upload size rule, as one predicate both boundaries share.
 *
 * Strictly greater than the limit: a file of exactly `MAX_UPLOAD_BYTES` is
 * accepted, which is what "límite de 10 MB" means. The upload action applies
 * the same rule server-side and remains the authoritative check; this exists so
 * the browser can refuse an over-limit source before any request is dispatched,
 * because the request would otherwise be truncated by the framework's own body
 * cap and the operator would see nothing at all.
 */
export function exceedsUploadLimit(sizeInBytes: number): boolean {
  return Number.isFinite(sizeInBytes) && sizeInBytes > MAX_UPLOAD_BYTES;
}

export const uploadSchema = z.object({
  tenant_id: z.string({ message: "Selecciona un cliente (tenant)." }).uuid("Cliente inválido."),
  study_name: z
    .string()
    .trim()
    .min(1, "Indica el nombre del estudio.")
    .max(200, "El nombre del estudio es demasiado largo (máx. 200)."),
  // Empty period is allowed → pass `undefined` (not "").
  period: z.string().trim().max(100, "El periodo es demasiado largo (máx. 100).").optional(),
  // Whitelisted header names only: letters, digits, underscore.
  required_columns: z
    .array(z.string().regex(/^[A-Za-z0-9_]+$/, "Nombre de columna obligatoria inválido."))
    .max(50, "Demasiadas columnas obligatorias (máx. 50)."),
});
export type UploadInput = z.infer<typeof uploadSchema>;
