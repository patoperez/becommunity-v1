/**
 * THE WORKER'S EXCEPTION BOUNDARY, AS A FUNCTION A GATE CAN RUN.
 *
 * `src/worker-entry.ts` cannot be imported offline — it imports the OpenNext
 * build output — so until Unit 6B.4B2P the boundary was checked by reading its
 * source text. This is the same boundary with the delegate as a parameter, so
 * `npm run test:runtime-resilience` EXECUTES it: a delegate that throws, one
 * that throws a string, one whose module failed to load, and one that succeeds.
 *
 * WHAT IT DOES: one call to the delegate. A rejection becomes the product's own
 * 503 with `Retry-After` and one structured line naming a closed code and a
 * route CLASS.
 *
 * WHAT IT CANNOT DO: catch a runtime TERMINATION. An invocation Cloudflare kills
 * for exceeding a resource limit never reaches the `catch`, so the request fails
 * without this boundary's answer. On `b80e30da`, Unit 6B.4B2O's soak saw thirty
 * Error 1101 pages and not one controlled 503, in minutes where Cloudflare
 * recorded twenty-eight `exceededResources` terminations and no thrown
 * exception — a match for the population, not proved request by request. This
 * boundary removes the category of REJECTIONS, and only that.
 *
 * WHAT IT MUST NOT DO, and does not:
 *   * it does not retry. A boundary that retries turns one failing request into
 *     several and an outage into a storm;
 *   * it does not serve stale, cached, empty or legacy content in place of what
 *     was asked for. «Unavailable» never becomes «empty»;
 *   * it does not read, alter or clear a cookie, so a session survives a blip;
 *   * it does not inspect or forward the thrown value. The reader gets a code.
 *
 * RELATIVE IMPORTS ON PURPOSE: wrangler bundles the entry with esbuild, which
 * does not necessarily honour the `@/*` path alias that Next resolves.
 */

import { recordRuntimeFailure, unavailableResponse } from "./unavailable";

export type FetchHandler<E, C> = (request: Request, env: E, ctx: C) => Promise<Response>;

export function withRuntimeBoundary<E, C>(delegate: FetchHandler<E, C>): FetchHandler<E, C> {
  return async (request, env, ctx) => {
    const started = Date.now();
    try {
      return await delegate(request, env, ctx);
    } catch (thrown) {
      // The pathname is used for TWO decisions and is never written by this
      // code: which shape of response to build, and which route CLASS to record.
      let pathname = "/";
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        // A request URL that will not parse is itself the failure; the default
        // route class is the honest answer.
      }
      const code = isModuleLoadFailure(thrown) ? "module_load_failed" : "worker_unhandled";
      recordRuntimeFailure({
        code,
        pathname,
        method: request.method,
        elapsedMs: Date.now() - started,
      });
      return unavailableResponse(code, pathname);
    }
  };
}

/**
 * The request-time `import()` in the generated entry is the one failure with a
 * name worth keeping apart: it means the artifact could not be loaded, not that
 * the application refused. Everything else is `worker_unhandled`.
 */
export function isModuleLoadFailure(thrown: unknown): boolean {
  const message = thrown instanceof Error ? thrown.message : String(thrown ?? "");
  return /dynamic module|Failed to fetch dynamically imported module|Cannot find module|module not found/i.test(message);
}
