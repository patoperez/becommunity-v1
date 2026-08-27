/**
 * The account and client-organisation lifecycle, as a model (P8.2).
 *
 * Everything here is PURE, so the rules a consultant is trusting — what
 * "suspendido" means, when an impact preview has gone stale, whether a typed
 * organisation name really matches — can be proved without a browser and
 * without a database.
 *
 * TWO SEPARATE LIFECYCLES, DELIBERATELY NOT ONE.
 *
 * A PERSON has access, and access can be suspended and restored. Suspension is
 * enforced where authentication happens (Supabase Auth's own ban window), not
 * by a product column, precisely so the product can never display "activo" for
 * an identity the authentication server is already refusing — or the reverse.
 * There is exactly one source of truth and this module reads it.
 *
 * A CLIENT ORGANISATION has a working state, and the ordinary reversible action
 * is to ARCHIVE it. Archiving stops new work — no new study, no new invitation,
 * no new publication — and stops nothing else: it is a workflow state, not a
 * revocation, and the interface says so rather than implying that a client's
 * people were locked out. Locking a person out is suspension, above.
 *
 * Permanent deletion of a PERSON exists, is never the default, and never shares
 * a control with the reversible action. Permanent deletion of a CLIENT is
 * disabled in the product: it spans three systems with no shared transaction,
 * and the server refuses it (`TENANT_DELETION_DISABLED_REASON`). The impact
 * model below is kept live for the summary the interface still shows and for
 * the recoverable workflow that will re-enable it.
 */

/** How long a suspension lasts. Long enough to be indefinite; still a window. */
export const SUSPENSION_DURATION = "876000h";

/** The value that lifts a suspension. Supabase's own vocabulary. */
export const SUSPENSION_LIFTED = "none";

export type ClientUserAccess = "active" | "invited" | "suspended";

/** The three account facts this model reads. Nothing else is needed. */
export type ClientUserAccountFacts = {
  /** Supabase `banned_until`: a timestamp, the literal "none", or absent. */
  bannedUntil?: string | null;
  lastSignInAt?: string | null;
  emailConfirmedAt?: string | null;
};

/**
 * Whether the authentication server is currently refusing this identity.
 *
 * A ban that has already expired is not a suspension: reporting it as one would
 * show a locked account that can in fact sign in, which is exactly the
 * divergence this whole design exists to avoid.
 */
export function isSuspended(facts: ClientUserAccountFacts, now: Date = new Date()): boolean {
  const raw = facts.bannedUntil;
  if (!raw || raw === SUSPENSION_LIFTED) return false;
  const until = Date.parse(raw);
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

/**
 * The one word Studio shows for a person's access.
 *
 * `invited` is a real, distinct state: the invitation was sent and the person
 * has never completed it. Calling that "activo" would tell a consultant someone
 * can already open the portal when they cannot, and calling it "suspendido"
 * would suggest somebody took the access away.
 */
export function clientUserAccess(
  facts: ClientUserAccountFacts,
  now: Date = new Date(),
): ClientUserAccess {
  if (isSuspended(facts, now)) return "suspended";
  const confirmed = Boolean(facts.emailConfirmedAt);
  const signedIn = Boolean(facts.lastSignInAt);
  return confirmed || signedIn ? "active" : "invited";
}

export const CLIENT_USER_ACCESS_LABEL: Record<ClientUserAccess, string> = {
  active: "Con acceso",
  invited: "Invitación pendiente",
  suspended: "Acceso suspendido",
};

export const CLIENT_USER_ACCESS_MEANING: Record<ClientUserAccess, string> = {
  active: "Puede entrar y ver lo que le corresponde.",
  invited: "Le enviamos la invitación y todavía no la completó, así que aún no puede entrar.",
  suspended: "No puede entrar. Su cuenta y sus datos siguen aquí y el acceso se puede devolver.",
};

export type TenantLifecycle = "active" | "archived";

export function tenantLifecycle(archivedAt: string | null | undefined): TenantLifecycle {
  return archivedAt ? "archived" : "active";
}

export const TENANT_LIFECYCLE_LABEL: Record<TenantLifecycle, string> = {
  active: "Activo",
  archived: "Archivado",
};

export const TENANT_LIFECYCLE_MEANING: Record<TenantLifecycle, string> = {
  active: "Se le pueden crear estudios, invitar personas y publicar resultados.",
  archived:
    "No admite estudios nuevos, invitaciones nuevas ni publicaciones nuevas. Sigue visible para el equipo y se puede reactivar. Quien ya tenía acceso lo conserva: para quitárselo a una persona, suspende su acceso.",
};

/** Why an action on an archived client was refused, in the operator's words. */
export const ARCHIVED_TENANT_REFUSAL =
  "Este cliente está archivado. Reactívalo antes de crear estudios, invitar personas o publicar.";

// ---------------------------------------------------------------------------
// The impact summary
// ---------------------------------------------------------------------------
//
// WHAT THIS IS NOW FOR. Permanent client deletion is DISABLED in the product
// (`TENANT_DELETION_DISABLED_REASON`), so none of this gates a destructive act
// today. It is kept, live and executable, for two reasons: knowing what a
// client is made of is worth showing before archiving it, and the freshness
// rule below is the part a recoverable deletion workflow will need unchanged
// when it arrives. Nothing here claims that a deletion is safe.

/**
 * What permanently deleting a client would destroy, counted.
 *
 * Every field is a COUNT. No name, no email, no answer and no quote is carried
 * here, so the summary can be rendered, logged and audited without moving
 * client content anywhere.
 */
export type TenantImpact = {
  clientUsers: number;
  studies: number;
  publishedStudies: number;
  respondents: number;
  quantResponses: number;
  qualObservations: number;
  importBatches: number;
  importMappings: number;
  recodingTables: number;
  storageObjects: number;
};

export const EMPTY_TENANT_IMPACT: TenantImpact = {
  clientUsers: 0,
  studies: 0,
  publishedStudies: 0,
  respondents: 0,
  quantResponses: 0,
  qualObservations: 0,
  importBatches: 0,
  importMappings: 0,
  recodingTables: 0,
  storageObjects: 0,
};

const IMPACT_KEYS = Object.keys(EMPTY_TENANT_IMPACT) as (keyof TenantImpact)[];

/** The exact field order the serialized preview uses, so it is comparable. */
export function serializeImpact(impact: TenantImpact): string {
  return IMPACT_KEYS.map((key) => `${key}:${impact[key]}`).join("|");
}

export function parseImpact(serialized: string): TenantImpact | null {
  const parts = String(serialized).split("|");
  if (parts.length !== IMPACT_KEYS.length) return null;
  const result = { ...EMPTY_TENANT_IMPACT };
  for (let index = 0; index < parts.length; index += 1) {
    const [key, value] = parts[index].split(":");
    if (key !== IMPACT_KEYS[index]) return null;
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0) return null;
    result[IMPACT_KEYS[index]] = count;
  }
  return result;
}

/**
 * Whether the summary the operator READ still describes the client as it is NOW.
 *
 * A summary is rendered when the page loads and read some time later. In
 * between, a colleague can import a file, publish a study or invite somebody,
 * so the figures on screen can already be stale. This is the comparison a
 * future deletion workflow must run at execution time before acting on a
 * summary somebody agreed to. It is not, on its own, transactional safety:
 * comparing counts says nothing about whether the deletion that follows can
 * complete across three systems, which is exactly why that deletion is
 * currently disabled.
 */
export function impactIsUnchanged(shown: TenantImpact, current: TenantImpact): boolean {
  return IMPACT_KEYS.every((key) => shown[key] === current[key]);
}

/** Exactly what moved, so the refusal can say so instead of "vuelve a intentar". */
export function impactDifferences(shown: TenantImpact, current: TenantImpact): string[] {
  return IMPACT_KEYS.filter((key) => shown[key] !== current[key]).map(
    (key) => `${IMPACT_LABEL[key]}: ${shown[key]} → ${current[key]}`,
  );
}

const IMPACT_LABEL: Record<keyof TenantImpact, string> = {
  clientUsers: "personas con acceso",
  studies: "estudios",
  publishedStudies: "estudios publicados",
  respondents: "personas que respondieron",
  quantResponses: "resultados numéricos",
  qualObservations: "comentarios",
  importBatches: "cargas de datos",
  importMappings: "lecturas de archivo guardadas",
  recodingTables: "tablas de equivalencias",
  storageObjects: "archivos guardados (logotipo)",
};

export type ImpactLine = { label: string; count: number };

/**
 * The summary as readable lines. Zero counts are kept: "0 estudios" is
 * information the operator needs, and hiding it would make an empty client and
 * a full one look the same in the dialog that destroys them.
 */
export function impactLines(impact: TenantImpact): ImpactLine[] {
  return IMPACT_KEYS.map((key) => ({ label: IMPACT_LABEL[key], count: impact[key] }));
}

/**
 * What permanent client deletion would deliberately KEEP, said out loud.
 *
 * Presented by the interface as "when this returns", because the deletion
 * itself is disabled.
 */
export const TENANT_DELETION_RETAINED = [
  "El registro administrativo de esta eliminación: quién la hizo, cuándo y qué cantidades destruyó.",
  "Las plantillas guardadas por el equipo. Dejan de apuntar a un estudio de este cliente y siguen sirviendo para otros.",
];

/** What permanent user deletion removes, and what it deliberately keeps. */
export const USER_DELETION_REMOVED = [
  "La cuenta de acceso y su perfil, incluida la parte de los resultados que tenía asignada.",
];

export const USER_DELETION_RETAINED = [
  "Los estudios, las respuestas y los comentarios del cliente. No pertenecen a esta persona.",
  "El registro administrativo de la eliminación, para poder explicar después qué pasó.",
];

// ---------------------------------------------------------------------------
// The exact-name confirmation
// ---------------------------------------------------------------------------

/**
 * Whitespace at the ends and repeated spaces inside are forgiven, because they
 * are transcription noise rather than a different name. Nothing else is:
 * letters, accents and capitals must match, which is the whole point of asking.
 */
function collapse(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function exactNameMatches(typed: string, name: string): boolean {
  const target = collapse(name);
  if (target === "") return false;
  return collapse(typed) === target;
}

/** Why the typed name was refused, in words that help the operator finish. */
export function nameConfirmationRefusal(typed: string, name: string): string | null {
  if (collapse(typed) === "") return `Escribe “${collapse(name)}” para confirmar.`;
  if (!exactNameMatches(typed, name)) {
    return `El nombre no coincide. Escríbelo tal como aparece: “${collapse(name)}”.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The bounds the administrative record is held to
// ---------------------------------------------------------------------------
//
// These live here, in the PURE module, because they are rules rather than
// plumbing: the database enforces one of them, the application enforces the
// other, and a gate has to be able to prove both without a server, a browser or
// a database.

const MAX_DETAIL_ENTRIES = 20;
const MAX_DETAIL_STRING = 120;

/**
 * The application's own encoded-size ceiling for `details`.
 *
 * The database enforces its own bound in migration 0015
 * (`AUDIT_DETAILS_DB_LIMIT_BYTES`). This one is deliberately STRICTER, by a
 * factor of two, so the application can never construct a record the database
 * would then reject: the two bounds are measured on slightly different
 * encodings — `JSON.stringify` here, canonical `jsonb::text` there — and a
 * margin removes the question entirely.
 */
export const MAX_DETAIL_BYTES = 2048;

/** The bound migration 0015 declares. Kept here so a gate can compare them. */
export const AUDIT_DETAILS_DB_LIMIT_BYTES = 4096;

/**
 * Keep the record small and boring on purpose. Numbers and short flags survive;
 * anything long is truncated and anything unexpected is dropped, so no client
 * payload can be smuggled into administrative evidence by a future caller.
 */
export function boundedDetails(details: LifecycleDetails | undefined): Record<string, unknown> {
  if (!details) return {};
  const entries = Object.entries(details).slice(0, MAX_DETAIL_ENTRIES);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    let next: unknown;
    if (typeof value === "number" && Number.isFinite(value)) next = value;
    else if (typeof value === "boolean" || value === null) next = value;
    else if (typeof value === "string") next = value.slice(0, MAX_DETAIL_STRING);
    else continue;
    // Entries are added one at a time and the encoded size is re-measured, so
    // the result is deterministic and can never exceed the ceiling. Dropping
    // the tail is the right failure: administrative metadata is diagnostic, and
    // losing the last count is better than losing the whole record.
    const candidate = { ...safe, [key]: next };
    if (encodedSize(candidate) > MAX_DETAIL_BYTES) break;
    safe[key] = next;
  }
  return safe;
}

/** The encoded size the bound is measured against. */
export function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? {})).length;
}


/**
 * The hard ceiling on how many stored objects one inventory will enumerate.
 *
 * Ten pages of a hundred, then it stops and SAYS it stopped. A branding bucket
 * holding more than this for one client is already anomalous, and the answer to
 * an anomaly is a stated incomplete result — never an unbounded loop, and never
 * a count that looks authoritative because the paging quietly ended.
 */
export const STORAGE_INVENTORY_CEILING = 1_000;

/** The bounded metadata an administrative record may carry. */
export type LifecycleDetails = Record<string, number | string | boolean | null>;
