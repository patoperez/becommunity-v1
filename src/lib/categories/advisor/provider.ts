/**
 * The advisor as an interface, so the product never depends on one vendor —
 * and, more importantly, never depends on there being a vendor at all.
 *
 * EVERY OUTCOME IS A VALUE, NOT AN EXCEPTION. A timeout, a refusal, a malformed
 * answer, a rate limit, a missing model and an unreachable network are six
 * different things a consultant might want to know about, and none of them is a
 * reason for a screen to fail. They are returned as `AdvisorOutcome`s with a
 * plain Spanish sentence attached, the review screen shows that sentence beside
 * the candidate, and the manual workflow continues untouched.
 *
 * THE NULL PROVIDER IS THE DEFAULT, AND IT IS NOT A STUB. Shipping with no
 * advisor configured is the intended state of this release. `nullAdvisor`
 * returns a stated reason rather than throwing, so every code path that ever
 * runs with an advisor also runs, identically, without one.
 */

import type { AdvisorPackage, AdvisorVerdict } from "./contract";

export type AdvisorFailure =
  | "disabled"
  | "redacted"
  | "timeout"
  | "rate_limited"
  | "refused"
  | "malformed"
  | "model_unavailable"
  | "network"
  | "unauthorized";

export type AdvisorOutcome =
  | {
      ok: true;
      verdict: AdvisorVerdict;
      model: string;
      promptVersion: string;
      schemaVersion: string;
      /** Token counts only. Never content. */
      usage: { inputTokens: number; outputTokens: number } | null;
      cached: boolean;
    }
  | { ok: false; failure: AdvisorFailure; message: string };

export interface CategoryAdvisor {
  readonly name: string;
  advise(payload: AdvisorPackage, signal?: AbortSignal): Promise<AdvisorOutcome>;
}

/** The advisor when there is none. A first-class implementation, not a stub. */
export function nullAdvisor(message: string): CategoryAdvisor {
  return {
    name: "none",
    async advise(): Promise<AdvisorOutcome> {
      return { ok: false, failure: "disabled", message };
    },
  };
}

/**
 * How each failure reads on the review screen.
 *
 * Every one of them ends by saying the review continues, because that is the
 * fact a consultant needs and the one an error message usually omits.
 */
export const FAILURE_MESSAGE: Record<AdvisorFailure, string> = {
  disabled:
    "El asistente automático no está activo. Revisa las categorías con las diferencias que el " +
    "producto ya detectó.",
  redacted:
    "No se consultó al asistente porque los datos no eran seguros de enviar. La revisión manual " +
    "sigue completa.",
  timeout:
    "El asistente tardó demasiado y se canceló la consulta. Puedes decidir sin él.",
  rate_limited:
    "El asistente está recibiendo demasiadas consultas ahora mismo. Inténtalo más tarde o decide " +
    "sin él.",
  refused:
    "El asistente no quiso responder a esta consulta. Decide con las diferencias detectadas.",
  malformed:
    "El asistente respondió algo que no se pudo interpretar, así que se descartó. Decide sin él.",
  model_unavailable:
    "El modelo configurado no está disponible. No se sustituye por otro: la comparación dejaría " +
    "de ser válida. Decide sin él.",
  network: "No se pudo contactar con el asistente. Decide con las diferencias detectadas.",
  unauthorized:
    "La credencial del asistente no es válida. Avisa al equipo técnico; la revisión manual sigue " +
    "funcionando.",
};

/**
 * A bounded, tenant-keyed answer cache.
 *
 * WHAT IT IS FOR. Re-rendering a review screen must not re-ask the same
 * question, and two consultants opening the same study must not each pay for
 * it.
 *
 * WHAT IT IS NOT. Durable. It lives inside one server isolate, is capped, and
 * disappears on redeploy. That is a deliberate choice, not a shortcoming: an
 * advisory opinion is not a record, the record is the decision a person made,
 * and persisting model output would create a second store of derived content
 * with its own tenant-isolation surface for no benefit.
 *
 * ISOLATION. The key begins with the tenant id (see `advisorCacheKey`), so a
 * lookup cannot return another client's answer even in principle.
 */
export function createAdvisorCache(limit = 200) {
  const entries = new Map<string, AdvisorOutcome>();
  return {
    get(key: string): AdvisorOutcome | null {
      const held = entries.get(key);
      if (!held) return null;
      // Refresh recency: re-inserting moves the key to the end of the Map's
      // iteration order, which is what makes the eviction below least-recent.
      entries.delete(key);
      entries.set(key, held);
      return held.ok ? { ...held, cached: true } : held;
    },
    set(key: string, outcome: AdvisorOutcome): void {
      // Only successes are cached. Re-asking after a timeout is exactly what a
      // consultant expects a retry to do.
      if (!outcome.ok) return;
      entries.set(key, outcome);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * A per-tenant request budget for one server isolate.
 *
 * Bounds cost and concurrency together with one counter, because the failure
 * this guards against — a study with two hundred candidates and somebody
 * holding down "consultar" — produces both at once.
 */
export function createAdvisorLimiter(options: { perTenant: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    take(tenantId: string, now = Date.now()): boolean {
      const held = windows.get(tenantId);
      if (!held || now >= held.resetAt) {
        windows.set(tenantId, { count: 1, resetAt: now + options.windowMs });
        return true;
      }
      if (held.count >= options.perTenant) return false;
      held.count += 1;
      return true;
    },
  };
}
