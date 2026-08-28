# Deployment — Cloudflare (OpenNext adapter) + Supabase

Per §1.1, Cloudflare hosts the Next.js frontend and Supabase is the backend.
This app is **dynamic** (server components do RLS-scoped reads, Server Actions
handle login/logout/upload, the session middleware runs on every request), so it
is **not** a static export.

> **Configuration is split, and the split is a security boundary.**
> `SUPABASE_SERVICE_ROLE_KEY` is an **encrypted Worker secret** and must never be
> a build variable or reachable from a `.env` file at build time — the adapter
> compiles `.env` FILES into `.open-next/cloudflare/next-env.mjs` and ships them
> inside the bundle. Build the deployable artifact from a checkout with no
> `.env` file. See `docs/P9_HARDENING.md` §1 for the full table, the gate that
> enforces it, and the rotation procedure.

## Adapter: OpenNext (Cloudflare Workers)

We deploy with **[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)**
(the `@cloudflare/next-on-pages` adapter is deprecated). OpenNext runs the full
Next.js server on the **Node.js runtime inside a Cloudflare Worker**.

> **`nodejs_compat` is not a blanket guarantee.** workerd polyfills Node via
> `unenv`, whose unimplemented APIs *throw*. ExcelJS's Node entry reaches
> `process.umask()` at module load (through `unzipper` → `fstream`) and is fatal
> on Workers, which once broke CSV uploads too. `.xlsx` now loads ExcelJS's
> **browser** build lazily; see `src/lib/ingestion/parse.ts`. Verify any new Node
> dependency under real workerd before assuming it runs.

> **This is a Workers deployment, not a Pages project.** OpenNext produces a
> Worker (`.open-next/worker.js`) + static assets, deployed via Wrangler. If you
> previously created a **Pages** project, create a **Worker** instead (see
> "Cloudflare dashboard" below). The deprecated next-on-pages error about
> `/_middleware` no longer applies.

### Runtime notes (why the build now works)

- **Middleware must be Edge.** Next 16's `proxy.ts` convention forces the Node.js
  runtime, which OpenNext rejects ("Node.js middleware is not currently
  supported"). We therefore use the **`middleware.ts`** convention
  ([src/middleware.ts](../src/middleware.ts)), which runs on the Edge runtime.
- **No `runtime = "edge"` on routes.** Under OpenNext the routes run on Node, so
  those exports were removed. This is necessary for Node-style code but, as
  above, is not sufficient for every Node library.

## Prerequisites

- A **production** Supabase project (separate from dev — §6.4). Apply migrations:
  1. `supabase/migrations/0000_init_schema_and_rls.sql`
  2. `supabase/migrations/0001_api_role_grants.sql`
  Then run `supabase/tests/rls_coverage.sql` — query #1 must return **zero rows**.
- A Cloudflare account.

## Build & deploy commands

```bash
npm run build        # next build (plain — must pass first; runs flawlessly)
npm run cf:build     # opennextjs-cloudflare build  -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + wrangler deploy (to Cloudflare Workers)
```

`cf:deploy` is a manual, local deploy path kept for exceptional recovery (for
example redeploying a known-good version). The normal path to the beta Worker is
a reviewed merge to `main` — see "Deployment discipline" below.

> **Windows note:** `npm run cf:build` may fail locally on Windows with
> `EPERM: symlink` (OpenNext's file-tracing step needs symlink privileges).
> This is a local-only limitation — Cloudflare's build runs on **Linux**, where
> it succeeds. Enable Windows "Developer Mode" if you want it to run locally.

`wrangler.toml` encodes the Worker name `becommunity-v1`, the entry point
`main = .open-next/worker.js`, `nodejs_compat`, the compatibility date, and the
static-assets binding. The name must match the live Worker: if it names a script
that does not exist on the account, an ad-hoc `npm run cf:deploy` silently
publishes a **second, separate** Worker instead of updating the running one.

> **RESOLVED IN THE REPOSITORY, WITH ONE HUMAN STEP LEFT.** `keep_vars = true`
> is committed and Suite D's **D-g** check enforces it. But `keep_vars` only
> preserves variables that exist on the WORKER, and the two public values
> currently exist only on a VERSION — so `wrangler versions upload` still needs
> `--var` for both until somebody adds them as Text variables in the dashboard.
> Measured on a zero-traffic preview: without them, every route answers 500.
> See `docs/P9_HARDENING.md` §"What `keep_vars` does NOT do".
>
> **Always upload a zero-traffic preview and curl `/api/health` and `/login`
> before promoting.** That is what turned this from an outage into a non-event.

> **Original precondition (2026-08-28): preserve dashboard vars.** By
> default, `wrangler deploy` deletes dashboard-managed plain-text variables that
> are not declared in the Wrangler configuration; encrypted secrets are
> preserved. Before the next deployment, set `keep_vars = true` in
> `wrangler.toml` (preferred repository-level protection) or prove that the
> invocation uses `--keep-vars`. Until one of those protections is present and
> reviewed, **do not deploy**. The Journey hotfix deployment demonstrated the
> failure mode by removing `NEXT_PUBLIC_SUPABASE_URL` and
> `NEXT_PUBLIC_SUPABASE_ANON_KEY`, making every route return HTTP 500 until a
> rollback and corrected preview promotion restored service.

This operator can access multiple Cloudflare accounts. A manual deploy must set
the intended `CLOUDFLARE_ACCOUNT_ID`, confirm with a read-only deployment list
that `becommunity-v1` already exists in that account, and refuse to upload if the
identity is ambiguous. The live Worker is in the Ollin account; account names or
URLs are not a substitute for checking the exact account id at execution time.

## Deployment discipline — the current synthetic beta

The Worker this repository deploys to is **`becommunity-v1`**
(`https://becommunity-v1.ollinagencyllc.workers.dev`), and `wrangler.toml` names
it. It is a **synthetic-data beta environment**. It is *not* the future
real-client production environment — that environment, with its own separate
Supabase project, does not exist yet.

**Observed behavior indicates that merging to `main` rebuilds and deploys that
beta automatically.** PR #29 was documentation-only, no manual deployment was
performed for it, and Cloudflare version `2a508633-b985-474a-bc2d-e1ddf38a6c79`
appeared afterward serving 100% of traffic. The Cloudflare Git-integration
settings themselves have **not** been read directly through configured read-only
tooling, so this is inferred from deployment evidence rather than from an
inspected dashboard configuration. Treat it as the operating assumption unless
later evidence disproves it.

The rules that follow from it:

1. **Merge approval is deployment approval.** There is no separate deploy step to
   review afterwards, and a merge that changes no runtime code still produces a
   new Worker version — exactly as PR #29 did.
2. **Every implementation PR passes its full pre-merge gates and receives explicit
   human approval before merge:**

   ```bash
   npm run typecheck && npm run lint && npm test && npm run build
   ```

   plus the focused gates for the surface it touches. No PR is auto-merged.
3. **After merge, perform exactly one bounded verification pass:** the
   production-alias `/api/health` endpoint, plus the focused smoke check for what
   changed (for most changes, `/login` returning 200 with the full
   security-header set). Then stop.
4. **Record the merged commit sha and the resulting Worker version id** — see
   "Post-merge record" below.
5. **No repeated deployment retriggers, burst request loops, load tests, or
   polling loops** to observe a deployment. One bounded pass; if it fails, roll
   back rather than re-running it.
6. **The `production` branch is a go-live action, not a beta one.** The clean
   `production` deploy branch is created and connected to Cloudflare **only at the
   approved real-client go-live transition** (see
   [GO_LIVE_SECURITY.md](GO_LIVE_SECURITY.md) B3). Until then `main` is in
   practice the beta's deploy branch, whatever earlier documentation implied.
7. **Changing the Cloudflare Git-integration settings is an external mutation.**
   Modifying, disabling, or re-pointing the integration is done by a human in the
   Cloudflare dashboard. It is never performed by an implementation PR and is not
   authorized by one.

### Post-merge record

Record the merged-commit → Worker-version mapping **outside the deploy-triggering
branch** — in the merged pull request's conversation or release record:

```
Merged commit:
Worker version:
Health:
Focused smoke:
Rollback version:
Verified at:
```

Never open a follow-up documentation PR whose only purpose is to write a Worker
version id into the repository. That merge itself deploys and produces a newer
version, so the committed value is stale the moment it lands.

`docs/CURRENT_STATE.md` therefore records **milestone/baseline deployments only**
(phase closures and release baselines) and states there that version ids are not
permanent identifiers. Ordinary merges are not recorded in it.

### Rollback

- Revert the merge commit on `main` and let the integration rebuild and deploy the
  reverted tree; **or**
- if the running Worker must be corrected faster than a rebuild allows, redeploy
  the previously recorded Worker version id.

Both depend on the post-merge record above having been written — which is why
recording it is a gate, not a nicety.

## Cloudflare dashboard (Workers + Git)

How the connected Worker was created — Workers & Pages → **Create** → **Workers**
→ **Connect to Git** → select `patoperez/becommunity-v1`, then:

| Setting | Value |
|---------|-------|
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| (Output) | configured by `wrangler.toml` (`.open-next/worker.js` + assets) |

## Environment variables (Worker → Settings → Variables)

| Variable | Type | Notes |
|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Plain | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plain | Public — safe only because RLS is on every table (§6.3) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Encrypted secret** | Server only — bypasses RLS. NEVER `NEXT_PUBLIC_*` |

Worker-level Variables and Secrets and Workers Builds variables are separate
surfaces. The two public values must be present in both places for the current
OpenNext build/runtime contract. After every deploy, verify `/api/health`,
`/login`, and one authenticated `/studio/**` route in one bounded pass.

### Secret-leak gate

```bash
npm run build && npm run cf:build && npm run test:secrets
```

`npm run test:secrets` scans **both** shipped artifacts: `.next/static` (what the
browser downloads) and `.open-next` (the Worker bundle). A missing artifact is a
**failure**, never a skip. On Windows, where `cf:build` hits the documented EPERM
limitation, run `npm run test:secrets:client` — it scans the client bundle only
and says so loudly; it is **not** the gate. `npm run suite:d` on Linux CI is.

> **A local OpenNext build inlines your `.env.local`.** `cf:build` writes
> `.open-next/cloudflare/next-env.mjs` containing every variable from a local
> `.env*` file **as a literal**, service-role key included. Cloudflare's own build
> checks out the repository, where no `.env*` file exists, so the deployed Worker
> is unaffected — its values arrive as runtime bindings. But treat local OpenNext
> output as secret-bearing: never `cf:deploy` from a machine with a populated
> `.env.local`, never upload `.open-next` anywhere, and purge it after a check.
> `npm run test:secrets` now fails on exactly this.

## Go-live checklist (§6.5 + §9.2)

- [ ] Migrations applied to production Supabase; RLS coverage query returns 0 rows.
- [ ] `npm run build` passes; `scripts/secret-leak-test.mjs` passes.
- [ ] Behavioral isolation test passes against production (see `scripts/isolation-test.mjs`).
- [ ] Worker env vars set (service_role as an encrypted secret).
- [ ] Uptime Robot configured against `/api/health` — see [OPERATIONS.md](OPERATIONS.md).
- [ ] Supabase upgraded to **Pro** once a real client has the link (§9.2).
