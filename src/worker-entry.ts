/**
 * THE WORKER'S ENTRY, WRAPPED IN THE EXCEPTION BOUNDARY.
 *
 * `wrangler.toml` points at THIS file rather than at `.open-next/worker.js`,
 * for one reason: the generated entry has no `try`/`catch` anywhere. Read it —
 * it awaits the middleware handler, then performs a REQUEST-TIME `import()` of
 * the server handler, then awaits that. A rejection from any of the three goes
 * straight to the edge, and Cloudflare answers **Error 1101, «Worker threw a
 * JavaScript exception»**, on whatever route the reader happened to ask for.
 *
 * Unit 6B.4B2N recorded thirteen 1101s on routes including `/login`, which reads
 * no study, no ledger and no canonical package. Unit 6B.4B2O's fault injection
 * could not reproduce them: against the real built artifact under workerd, no
 * injected upstream failure was seen to make the Worker throw.
 *
 * ⚠️ CORRECTED IN UNIT 6B.4B2P. This comment used to say every injected failure
 * «produced a CONTROLLED answer». Three did not: before 6B.4B2O's session bound,
 * `hang /auth/v1/user` on `/login` and on `/studio`, and `hang /rest/v1`, got no
 * response at all (`000000`), and `hang /rest/v1` still got none after it. The
 * rig's own verdict column mislabelled them. And the recorded 1101s were not
 * throws: in the minutes they occurred, Cloudflare's analytics record
 * `exceededResources` TERMINATIONS and no thrown exception.
 *
 * SO THIS FILE DOES NOT CLAIM TO KNOW WHAT FAILED. It removes ONE category —
 * rejections. The boundary itself lives in `src/lib/runtime/boundary.ts`, where
 * the offline gate can execute it; this file only connects it to the build
 * output.
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
// does not necessarily honour the path alias that Next resolves.
import { withRuntimeBoundary } from "./lib/runtime/boundary";

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
  fetch: withRuntimeBoundary<Env, WorkerContext>((request, env, ctx) => openNextWorker.fetch(request, env, ctx)),
};

export default worker;
