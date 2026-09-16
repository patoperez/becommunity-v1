/**
 * THE WORKER'S EXCEPTION BOUNDARY.
 *
 * `wrangler.toml` points at THIS file rather than at `.open-next/worker.js`,
 * for one reason: the generated entry has no `try`/`catch` anywhere. Read it —
 * it awaits the middleware handler, then performs a REQUEST-TIME `import()` of
 * the server handler, then awaits that. A rejection from any of the three goes
 * straight to the edge, and Cloudflare answers **Error 1101, «Worker threw a
 * JavaScript exception»**, on whatever route the reader happened to ask for.
 *
 * Unit 6B.4B2N recorded thirteen of those on routes including `/login`, which
 * reads no study, no ledger and no canonical package. Unit 6B.4B2O could not
 * reproduce them: against the real built artifact under workerd, every upstream
 * failure it could inject — a refused connection, a reset mid-body, malformed
 * JSON, a truncated body, HTTP 500, HTTP 503 and a hang, on the auth lookup and
 * on the data reads — produced a CONTROLLED answer and never a throw. And the
 * exception itself is not recoverable from Cloudflare: Workers Logs was not
 * enabled on this Worker when it happened, so nothing was retained.
 *
 * SO THIS FILE DOES NOT CLAIM TO KNOW WHAT THREW. It removes the category.
 * Whatever rejects inside the Worker — a module that fails to load at request
 * time, an upstream that dies in a way no injection reproduced, a runtime limit,
 * something not yet imagined — the reader gets the product's own «no disponible
 * por ahora» with HTTP 503 and `Retry-After`, and Workers Logs gets one
 * structured line naming a closed code and a route CLASS.
 *
 * WHAT IT MUST NOT DO, and does not:
 *   * it does not retry. A boundary that retries turns one failing request into
 *     several and an outage into a storm;
 *   * it does not serve stale, cached, empty or legacy content in place of what
 *     was asked for. «Unavailable» never becomes «empty»;
 *   * it does not read, alter or clear a cookie, so a session survives a blip;
 *   * it does not inspect or forward the thrown value. The reader gets a code.
 */

// The generated OpenNext entry. `.open-next/` is a build output and is not in
// git, so this import resolves only after `npm run cf:build` — which is exactly
// the condition the previous `main = ".open-next/worker.js"` had.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- see the note below
// @ts-ignore  — the specifier resolves at BUNDLE time, not at typecheck time:
// `.open-next/` is a build output, so `npm run typecheck` runs before it exists
// and `next build` (which cf:build invokes first) would fail on it. `@ts-expect-error`
// cannot be used here because the directive would then be "unused" whenever the
// build output IS present, and the check has to pass in both states.
import openNextWorker from "../.open-next/worker.js";

// A RELATIVE import on purpose: wrangler bundles this file with esbuild, which
// does not necessarily honour the `@/*` path alias that Next resolves.
import { recordRuntimeFailure, unavailableResponse } from "./lib/runtime/unavailable";

// The adapter's Durable Object classes must stay exported from the entry
// module. Nothing in `wrangler.toml` binds them today, but dropping them would
// make this entry silently narrower than the one it replaces.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- see the note above
// @ts-ignore  — same build-output specifier as above.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "../.open-next/worker.js";

type Env = Record<string, unknown>;

/**
 * The Worker context, declared locally rather than pulled from
 * `@cloudflare/workers-types`: this file is bundled by wrangler, and the
 * generated `cloudflare-env.d.ts` is not in git, so a global type would make
 * `npm run typecheck` depend on a build output.
 */
interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const started = Date.now();
    try {
      return await openNextWorker.fetch(request, env, ctx);
    } catch (thrown) {
      // The pathname is used for TWO decisions and is never logged: which shape
      // of response to build, and which route CLASS to record.
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
  },
};

export default worker;

/**
 * The request-time `import()` in the generated entry is the one failure with a
 * name worth keeping apart: it means the artifact could not be loaded, not that
 * the application refused. Everything else is `worker_unhandled`.
 */
function isModuleLoadFailure(thrown: unknown): boolean {
  const message = thrown instanceof Error ? thrown.message : String(thrown ?? "");
  return /dynamic module|Failed to fetch dynamically imported module|Cannot find module|module not found/i.test(message);
}
