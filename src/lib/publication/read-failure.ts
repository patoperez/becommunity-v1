/**
 * WHY A READ FAILED, IN EIGHT WORDS AND NEVER IN A SENTENCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES. Every transport failure on the canonical read path
 * used to collapse to one code, `CLIENT_TRANSPORT`, because `safeErrorCode`
 * exists to make sure a PostgreSQL message — which in this schema quotes
 * respondent data — never reaches a screen or a log. That was the right
 * instinct and the wrong resolution: it protected the data by destroying the
 * diagnosis. Unit 6B.4B2J then spent a whole deployment unable to say whether a
 * canonical read on the Cloudflare edge was refused, cancelled, timed out or
 * simply not allowed to open another connection.
 *
 * SO THE CLASSIFICATION IS A FUNCTION, AND ITS RANGE IS FINITE. Eight closed
 * codes. The thrown value is READ and never RETAINED: this module returns one
 * of eight constants and nothing else — not the message, not a substring of it,
 * not its length. A caller therefore cannot leak a message by forwarding what
 * it was told, because it was never told.
 *
 * WHY MESSAGE MATCHING IS ACCEPTABLE HERE AND NOWHERE ELSE. The patterns below
 * are matched against the message; the message is then discarded. Matching is
 * one-way — it can only ever choose among eight outcomes — so no amount of
 * attacker-controlled text can turn this into an information channel wider than
 * three bits. That is the opposite of forwarding the text.
 *
 * WHY `SUBREQUEST_BUDGET_EXHAUSTED` HAS ITS OWN CODE. It is the one failure
 * that is neither the database's fault nor the network's: the runtime refused
 * to open another connection because this HTTP request had already opened its
 * allowance. It needs its own word because the remedy is different from every
 * other code here — fewer requests, not a retry — and because a platform
 * ceiling must never be reported to a person as missing data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The eight ways a canonical read can fail. There is no ninth. */
export const TRANSPORT_FAILURE_CODES = [
  /** The request was refused for who it was: 401, 403, or an RLS denial. */
  "AUTHORIZATION_REFUSED",
  /** The database answered, and the answer was an error. */
  "DATABASE_REFUSED",
  /** The answer arrived and could not be parsed as what it claimed to be. */
  "DECODE_FAILED",
  /** The answer did not arrive in time. */
  "TIMED_OUT",
  /** The caller gave up first. */
  "CANCELLED",
  /** The connection failed before an answer existed. */
  "NETWORK_FAILED",
  /** The runtime refused to open another outbound connection for this request. */
  "SUBREQUEST_BUDGET_EXHAUSTED",
  /** Something else. Deliberately last, and deliberately not a catch-all name. */
  "UNKNOWN_INTERNAL",
] as const;

export type TransportFailureCode = (typeof TRANSPORT_FAILURE_CODES)[number];

/**
 * What a person may be told about each code.
 *
 * NONE OF THESE SENTENCES ACCUSES ANYBODY OF UNFINISHED WORK, and none of them
 * describes the study. They describe the READ. That distinction is the entire
 * point of this file: "no se pudo leer" and "no hay nada" are different facts,
 * and Unit 6B.4B2J proved what it costs to conflate them.
 */
export const TRANSPORT_FAILURE_DETAIL: Record<TransportFailureCode, string> = {
  AUTHORIZATION_REFUSED:
    "La base de datos rechazó la lectura por permisos. No es que falte información: es que esta sesión no pudo leerla.",
  DATABASE_REFUSED:
    "La base de datos respondió con un error a la lectura. No se muestra nada porque no se leyó nada, no porque no haya nada.",
  DECODE_FAILED:
    "La respuesta llegó con una forma que este lector no reconoce. Se prefiere no mostrar nada antes que mostrar algo mal leído.",
  TIMED_OUT: "La lectura tardó más de lo permitido y se abandonó. No se alcanzó a leer el material.",
  CANCELLED: "La lectura se canceló antes de terminar. No se alcanzó a leer el material.",
  NETWORK_FAILED: "No se pudo conectar con la base de datos. No se alcanzó a leer el material.",
  SUBREQUEST_BUDGET_EXHAUSTED:
    "Esta pantalla agotó el número de consultas que el servidor permite por petición, así que las últimas lecturas no llegaron a hacerse. Es un límite de la infraestructura, no una falta de revisión.",
  UNKNOWN_INTERNAL:
    "La lectura falló por una razón que este lector no supo clasificar. No se leyó el material.",
};

/** Read one string field without trusting the shape it came in. */
function textOf(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const held = (value as Record<string, unknown>)[key];
  return typeof held === "string" ? held : "";
}

function statusOf(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const held = (value as Record<string, unknown>)[key];
    if (typeof held === "number" && Number.isInteger(held)) return held;
  }
  return null;
}

/**
 * Classify a thrown value, or a PostgREST error object, into exactly one code.
 *
 * ORDER MATTERS AND IT IS NOT ALPHABETICAL. The runtime's own refusals are
 * tested first, because a Worker that will not open another connection reports
 * itself through an error whose message would otherwise be read as a generic
 * network failure — and "the platform stopped us" must never be reported as
 * "the database was unreachable".
 */
export function classifyTransportFailure(raw: unknown, aborted = false): TransportFailureCode {
  if (aborted) return "CANCELLED";

  // 0. A CODE THAT WAS ALREADY DECIDED, AT THE PLACE THAT COULD SEE THE TRUTH.
  //
  //    The canonical readers reduce every transport failure to a safe code
  //    BEFORE re-throwing, so by the time a caller catches it the runtime's own
  //    words are gone — which is the point, and which is also how Unit 6B.4B2J
  //    ended up unable to name a failure it had watched happen fifty times.
  //    `CanonicalReadError` therefore carries the classification it made at the
  //    catch site, and this line honours it. Without it the answer here would
  //    be `UNKNOWN_INTERNAL` for every canonical read in the product.
  const carried = textOf(raw, "transport");
  if ((TRANSPORT_FAILURE_CODES as readonly string[]).includes(carried)) {
    return carried as TransportFailureCode;
  }

  const name = textOf(raw, "name");
  const message = typeof raw === "string" ? raw : textOf(raw, "message");
  const code = textOf(raw, "code");
  const probe = `${name} ${message} ${code}`;
  const status = statusOf(raw);

  // 1. THE RUNTIME'S OWN CEILING. Cloudflare Workers phrase this several ways
  //    across versions; all of them mean the same thing and none of them means
  //    the database said no.
  if (/too many subrequests|subrequest limit|too many api requests|limit of [0-9]+ subrequest/i.test(probe)) {
    return "SUBREQUEST_BUDGET_EXHAUSTED";
  }
  // Six simultaneous connections is a queue, not an error — but the runtime
  // does refuse when a request holds more open connections than it may.
  if (/too many open (?:connections|streams)|connection limit/i.test(probe)) {
    return "SUBREQUEST_BUDGET_EXHAUSTED";
  }

  // 2. CANCELLATION, which reaches us as an AbortError long before any status.
  if (name === "AbortError" || /\baborted\b|operation was aborted/i.test(probe)) return "CANCELLED";

  // 3. TIMEOUT. A deadline is not a cancellation: nobody gave up, time ran out.
  if (name === "TimeoutError" || /timed ?out|timeout|deadline exceeded|etimedout/i.test(probe)) {
    return "TIMED_OUT";
  }

  // 4. WHO, before WHAT. An RLS refusal and a 401 are the same class of answer.
  if (status === 401 || status === 403) return "AUTHORIZATION_REFUSED";
  if (/^(?:42501|PGRST301|PGRST302|PGRST303)$/i.test(code)) return "AUTHORIZATION_REFUSED";
  if (/permission denied|not authorized|jwt (?:expired|invalid)|row-level security/i.test(probe)) {
    return "AUTHORIZATION_REFUSED";
  }

  // 5. THE DATABASE ANSWERED WITH AN ERROR. A PostgREST code is decisive; so is
  //    any other 4xx or 5xx that reached us as a response rather than a failure
  //    to connect.
  if (/^PGRST[0-9]{3}$/i.test(code)) return "DATABASE_REFUSED";
  if (/^[0-9A-Z]{5}$/.test(code)) return "DATABASE_REFUSED";
  if (status !== null && status >= 400) return "DATABASE_REFUSED";

  // 6. A SHAPE WE COULD NOT READ.
  if (name === "SyntaxError" || /unexpected token|is not valid json|failed to parse/i.test(probe)) {
    return "DECODE_FAILED";
  }

  // 7. NO ANSWER AT ALL.
  if (
    /fetch failed|failed to fetch|network|econnreset|econnrefused|enotfound|socket|dns|tls|connection (?:closed|reset)/i.test(
      probe,
    )
  ) {
    return "NETWORK_FAILED";
  }

  return "UNKNOWN_INTERNAL";
}
