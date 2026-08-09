# Go-Live Security Checklist (P0 Track B — deferred, edge-dependent)

> **Status: NOT executed. Execute at go-live**, when the Cloudflare custom domain
> (zone) and the production Supabase project exist. Everything here needs the
> edge/zone or a prod project and therefore can't be built or tested locally
> (see `docs/P0_PLAN.md` for the Track A / Track B split).
>
> Track A (least-privilege grants, Zod at every boundary, in-repo security
> headers, tooling) is **done and verified** via `npm run gates`. This file is the
> remaining perimeter + release work, staged so nothing is configured that can't
> be tested at the time it's turned on.

Current constraints these steps wait on (from the P0 kickoff answers):
- Worker runs on `*.workers.dev` — **no zone yet**, so no edge rules apply.
- Cloudflare **Free** + Supabase **Free** — honor free-tier limits (one rate-limit
  rule, no progressive block, limited managed WAF) until the Pro upgrade.
- **One** Supabase project (dev, `be-community-v2`, test data only) — the
  staging/prod split begins here.

---

## B1 — Edge security-header mirror (P0.3-B)

The app already emits the full header set in-repo (`next.config.ts` static set +
nonce CSP in `src/lib/supabase/middleware.ts`). At the edge, **mirror the static
set zone-wide** (via a Transform Rule or `_headers`) so static assets and any
non-app responses are covered at the perimeter too. Do **not** try to set the
nonce CSP at the edge — the nonce is per-request and belongs in the app.

```
# Cloudflare Transform Rule (or _headers) for the app hostname — static set only:
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

- Add `preload` to HSTS **only once the domain is stable** (§5.2) — it's hard to
  reverse.
- The app's CSP `connect-src` is env-derived; confirm `NEXT_PUBLIC_SUPABASE_URL`
  on the Worker points at the **production** Supabase origin so the CSP whitelists
  the right host (and nothing broader).
- **Verify:** `curl -I https://<domain>/login` shows the set; an iframe embed of
  the app is blocked.

---

## B2 — Rate limiting, WAF, bot management (P0.4)

All zone features (per §5.2). Apply in the Cloudflare dashboard.

| Setting | Value | Tier note |
|---|---|---|
| Rate rule 1 — auth | `http.request.uri.path eq "/login" and http.request.method eq "POST"` · **5 req / 1 min per IP** · action **Block** (10 min) | Free allows **one** rule → this is it |
| Rate rule 2 — API ceiling | dynamic paths · **100 req / 1 min per IP** · Managed Challenge | **Pro** (needs 2nd rule) |
| Progressive blocking | escalating timeouts on repeat offenders | **Pro** |
| WAF | Cloudflare **Managed Ruleset** | Free ruleset auto-applies; full managed rules = **Pro** |
| Bot management | **Bot Fight Mode: ON** (Super BFM on Pro) | Free = BFM |
| TLS | **Full (Strict)** | any tier |
| Geo (optional) | if clients are Mexico-only, Managed Challenge on non-MX traffic to `/login` | any tier |

**Free-tier plan:** apply **rate rule 1 only** (login is the asset that matters);
rely on Supabase Auth's built-in limits for the broader API until Pro. Turn on
rule 2 + progressive blocking + full managed WAF at the Pro upgrade.

**Verify:** a scripted >5 POST `/login`/min from one IP is blocked (429 / block
page).

---

## B3 — Production deploy branch + repo hygiene (P0.6)

- Create a **`production`** branch as the deploy branch; point Cloudflare's Git
  build at it. (Today deploys are manual `cf:deploy`, all local — no auto-deploy
  branch is set yet; document the intended strategy: `main` = working branch with
  prompt docs, `production` = clean deploy branch.)
- On `production` **only**, strip the standalone prompt docs (decision: **option
  (b)** — strip docs, keep code comments as normal engineering references; no
  release-rewrite machinery):
  - remove: `CLAUDE.md`, `AGENTS.md`, `system_context.md`, `AUDIT_V1.md`,
    `docs/FASE_*.md`, `docs/P0_PLAN.md`, `docs/GO_LIVE_SECURITY.md`.
  - keep: all of `src/**` (the `§`-citations in comments stay).

---

## B4 — Supabase staging/production split

The "staging-first" rule formally activates once a prod project with real data
exists. At go-live:

1. Create the **production** Supabase project (separate from dev `be-community-v2`).
2. Apply migrations **in order**: `0000_init_schema_and_rls.sql` →
   `0001_api_role_grants.sql` → `0002_least_privilege_client_reads.sql`.
3. Run `supabase/tests/rls_coverage.sql` query #1 → must return **zero rows**.
4. Run the **schema/grant/isolation verification** below (we hit real drift on the
   dev project — do not skip).
5. Set the Worker env matrix: prod `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY`
   (secret, **encrypted**).
6. **Never** migrate dev/test data into production.

### Provisioning gotchas (learned the hard way on `be-community-v2`)
The new Supabase key system does **not** auto-grant table privileges, and a
partially-applied schema fails silently. Before trusting a new project, confirm:
- All **8 tables** exist (missing tables → PostgREST `PGRST205` / HTTP 404).
- `service_role` can read every table (missing GRANTs → `42501` / 403 **even for
  the secret key**).
- `profiles.role` check allows **both** `'client'` and `'internal'`
  (`create table if not exists` will skip a pre-existing, drifted table).
- Anon is denied on every table; a client user's own-tenant writes are rejected.

The behavioral proof is `scripts/isolation-test.mjs` (tests 1–4) after seeding —
run it against production before any real client link goes out.

---

## B5 — Supabase Pro upgrade (triggers)

Upgrade to Pro (~$25/mo) **when the first real client gets a live link** (§9.2),
for:
- leaked-password protection,
- session controls,
- daily backups.
(Also unlocks rate rule 2, progressive blocking, full managed WAF above.)

---

## B6 — Final go-live gate (all must pass)

- [ ] `npm run gates` green against **production** env (typecheck, build, offline
      tests, isolation tests 1–4, secret-leak).
- [ ] Edge header mirror live; `curl -I` shows the set; app can't be iframed.
- [ ] Login flood (>5/min) blocked at the edge.
- [ ] RLS coverage query returns 0 rows on production.
- [ ] Worker env vars set (service_role as an **encrypted** secret).
- [ ] Uptime Robot on `/api/health` (see `docs/OPERATIONS.md`).
- [ ] `production` branch clean of prompt docs; Cloudflare builds from it.
- [ ] Supabase upgraded to Pro once the client link is live.
