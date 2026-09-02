import type { PreflightFinding } from "../canonical-package/types";
import type { PlanIssue } from "./plan";
import type { CountDisagreement } from "./reconcile";

/**
 * The SAFE result of a commit or a rollback.
 *
 * Everything in this file is shown on an internal screen, written to logs and
 * stored on `import_job.error_report`, exactly like the preflight DTO. It
 * therefore carries structure, counts, codes and coordinates — and no name, no
 * answer, no qualitative text, no category value and no identifier.
 *
 * THE ERROR RULE. A PostgreSQL error message quotes the values that violated
 * the constraint, and in this schema those values are respondent data. So no
 * database message ever reaches this shape. The database returns a CODE it
 * raised itself (or the placeholder `DATABASE_CONSTRAINT`), and the sentence
 * an operator reads is written here, in Spanish, keyed by that code. An
 * unknown code gets a generic sentence and keeps the code — never the message.
 */

export const COMMIT_ERROR_MESSAGES: Record<string, string> = {
  PREFLIGHT_BLOCKED:
    "El paquete tiene hallazgos que impiden confirmarlo. Corrige el archivo fuente y vuelve a validarlo.",
  PROJECTION_BLOCKED:
    "El paquete se validó, pero no se pudo construir el plan canónico sin adivinar. Revisa los hallazgos de proyección.",
  PLAN_NOT_OBJECT: "El plan enviado no tiene la forma esperada.",
  PLAN_TOO_LARGE: "El plan supera el tamaño máximo admitido en una sola transacción.",
  PLAN_FAMILY_NOT_ARRAY: "Una familia del plan no llegó como lista.",
  JOB_NOT_FOUND: "El trabajo de importación no existe.",
  JOB_HAS_NO_STAGED_PLAN: "El trabajo no tiene un plan validado; vuelve a preparar el paquete.",
  PLAN_FINGERPRINT_MISMATCH:
    "El plan no corresponde al que se validó para este trabajo. Vuelve a preparar el paquete.",
  PLAN_FINGERPRINT_FROZEN:
    "El trabajo ya está confirmado o en curso y su plan no puede cambiar. Revierte primero si necesitas rehacerlo.",
  PLAN_FINGERPRINT_INVALID: "La huella del plan no tiene el formato esperado.",
  COMMITTED_PAYLOAD_DIFFERS:
    "Este paquete ya se confirmó con un contenido distinto. No se vuelve a escribir para no duplicar filas.",
  TENANT_SCOPE_MISMATCH: "El plan declara un cliente distinto al del trabajo de importación.",
  STUDY_SCOPE_MISMATCH: "El plan declara un estudio distinto al del trabajo de importación.",
  STUDY_TENANT_MISMATCH: "El estudio no pertenece al cliente indicado.",
  ILLEGAL_STATE_TRANSITION: "El trabajo de importación no está en un estado que permita confirmarlo.",
  PACKAGE_ROWS_PRESENT:
    "El trabajo todavía conserva filas canónicas de un intento anterior. Reviértelo antes de volver a confirmar.",
  ASSET_ROLE_UNKNOWN: "El plan cita un archivo que este trabajo no tiene registrado.",
  ASSET_SET_INVALID: "El conjunto de archivos del paquete no es válido.",
  ASSET_SET_MISMATCH: "El trabajo ya está asociado a otro conjunto de archivos.",
  ASSET_SET_NOT_DISTINCT:
    "El paquete repite un archivo o un papel. Cada papel necesita exactamente un archivo y cada archivo un papel.",
  IDEMPOTENCY_KEY_INVALID: "La clave de idempotencia del paquete no tiene el formato esperado.",
  MAPPING_VERSION_INVALID: "La versión de mapeo no es válida.",
  REQUEST_NOT_OBJECT: "La solicitud de preparación no tiene la forma esperada.",
  DUPLICATE_PERSON_KEY: "El plan repite una identidad; no se puede decidir cuál usar.",
  EXPECTED_COUNTS_MISSING: "El plan no declara los conteos esperados.",
  COUNT_MISMATCH:
    "Los conteos que midió la base de datos no coinciden con los del plan. No se escribió ninguna fila.",
  COUNT_FAMILY_UNDECLARED: "La base de datos escribió una familia que el plan no declara.",
  LEDGER_INCONSISTENT:
    "El registro de propiedad del paquete quedó incompleto, así que la reversión no podría identificar sus filas.",
  ONLY_COMMITTED_CAN_ROLL_BACK: "Sólo se puede revertir un paquete confirmado.",
  ROLLED_BACK_LEDGER_NOT_EMPTY:
    "El trabajo figura revertido pero todavía tiene filas registradas a su nombre. Requiere revisión humana.",
  DATABASE_CONSTRAINT:
    "La base de datos rechazó el paquete por una restricción de integridad. No quedó ninguna fila escrita.",
  RESULT_SHAPE_INVALID: "La base de datos devolvió un resultado que no se pudo interpretar.",
  COUNTS_NOT_RECONCILED:
    "Los conteos devueltos no cuadran con el plan. El paquete se revirtió para no dejar datos parciales.",
  CLIENT_TRANSPORT: "No se pudo completar la operación contra la base de datos.",
};

export function commitErrorMessage(code: string): string {
  return (
    COMMIT_ERROR_MESSAGES[code] ??
    "La operación no se completó. Revisa el código del error y el registro del trabajo de importación."
  );
}

export type CanonicalCommitCounts = {
  /** Family counts the database measured for itself. */
  measured: Record<string, number>;
  /** Ownership and ledger detail (`_personsReused` and friends). */
  ownership: Record<string, number>;
};

export type CanonicalCommitSuccess = {
  ok: true;
  status: "committed";
  /** True when the package was already committed and nothing was written again. */
  replayed: boolean;
  importJobId: string;
  packageIdempotencyKey: string;
  planFingerprint: string;
  counts: CanonicalCommitCounts;
  commitAttempts: number;
  rollbackCount: number;
};

export type CanonicalCommitFailure = {
  ok: false;
  status: "blocked" | "failed" | "refused";
  importJobId: string | null;
  code: string;
  message: string;
  /** Preflight blockers, already privacy-safe by Unit 2's own contract. */
  findings: PreflightFinding[];
  /** Projection blockers, privacy-safe by the same rule. */
  issues: PlanIssue[];
  disagreements: CountDisagreement[];
};

export type CanonicalCommitOutcome = CanonicalCommitSuccess | CanonicalCommitFailure;

export type CanonicalRollbackOutcome =
  | {
      ok: true;
      status: "rolled_back";
      replayed: boolean;
      importJobId: string;
      removed: Record<string, number>;
      retainedSharedIdentities: number;
      rollbackCount: number;
    }
  | { ok: false; status: "refused"; importJobId: string; code: string; message: string };

/**
 * Reduce anything thrown or returned by the transport to a SAFE code.
 *
 * The message is deliberately discarded. A Supabase client error carries the
 * PostgreSQL message verbatim, and this schema's constraint messages quote the
 * failing key values — a respondent's identifier, a name, an answer. Only a
 * code the migrations raise themselves is recognised; everything else becomes
 * `CLIENT_TRANSPORT`.
 */
export function safeErrorCode(raw: unknown): string {
  const candidate =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object" && typeof (raw as { message?: unknown }).message === "string"
        ? (raw as { message: string }).message
        : "";
  const trimmed = candidate.trim();
  if (/^[A-Z][A-Z0-9_]{1,59}$/.test(trimmed) && trimmed in COMMIT_ERROR_MESSAGES) return trimmed;
  // Every uppercase token is considered, not just the first: PostgREST wraps the
  // message, and a sentinel-looking identifier from the failing row can easily
  // precede the code the migration raised.
  for (const match of trimmed.matchAll(/\b([A-Z][A-Z0-9_]{1,59})\b/g)) {
    if (Object.prototype.hasOwnProperty.call(COMMIT_ERROR_MESSAGES, match[1])) return match[1];
  }
  return "CLIENT_TRANSPORT";
}

export function refusal(
  code: string,
  importJobId: string | null,
  extra: Partial<Pick<CanonicalCommitFailure, "findings" | "issues" | "disagreements" | "status">> = {},
): CanonicalCommitFailure {
  return {
    ok: false,
    status: extra.status ?? "refused",
    importJobId,
    code,
    message: commitErrorMessage(code),
    findings: extra.findings ?? [],
    issues: extra.issues ?? [],
    disagreements: extra.disagreements ?? [],
  };
}
