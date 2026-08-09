# P0 — Security Hardening Plan

> **Status: PROPOSED — awaiting approval. No code, migrations, or dashboard
> changes have been made.** Closes AUDIT_V1.md red flags #1–#4 and lays the
> perimeter before any V2 feature enlarges the attack surface. Everything here
> is a human-review zone: each diff is surfaced for review before applying,
> migrations go staging → production, all changes reversible.

---

## Execution order & why

```
P0.0  Preflight: prove runtime RLS (baseline) + environment inventory   [red flag #2]
P0.1  Least-privilege grants migration + new adversarial assertions     [red flag #1]
P0.2  Zod at every input boundary                                       [red flag #4]
P0.3  Security response headers                                         [red flag #3a]
P0.4  Rate limiting + WAF + Bot Fight Mode (Cloudflare dashboard)       [red flag #3b]
P0.5  Tooling: typecheck / test scripts
P0.6  Production-branch hygiene
P0.7  Run the full acceptance gate; close P0
```

P0.0 comes first because every later step is validated against the isolation
test — we need a **passing baseline** before changing grants, or a regression
would be indistinguishable from a pre-existing failure.

---

## P0.0 — Preflight: prove RLS at runtime + inventory

**Actions**
1. Verify `.env.local` has the isolation-test env (`TEST_USER_A/B_EMAIL/PASSWORD`,
   `TEST_TENANT_B_ID`). If absent, run `scripts/seed-test-data.mjs` (service_role,
   dev project only) to create the two tenants/users, then set the vars.
2. Run `node --env-file=.env.local scripts/isolation-test.mjs` against the live
   dev database. **Report the actual output verbatim.**
3. Inventory: how many Supabase projects exist (dev / staging / prod) and which
   one `.env.local` points at; whether the Worker has a custom domain (zone) or
   runs on `*.workers.dev`; which git branch Cloudflare builds from.

**Stop condition:** any isolation failure → halt P0, report, fix before anything else.

---

## P0.1 — Least-privilege grants (red flag #1, highest priority)

**Verified precondition (done in audit + this session):** the ONLY public-schema
write paths are `ingestStudyFile` (service_role admin client,
`src/app/admin/upload/actions.ts:74,118,131`) and the seed/cleanup scripts (all
service_role, confirmed by grep). Login/logout touch only the `auth` schema.
The dashboard is read-only. **No legitimate path uses `authenticated`-role
writes — removing them breaks nothing.**

**Migration `supabase/migrations/0002_least_privilege_client_reads.sql`:**

```sql
begin;
-- authenticated becomes read-only on the public schema
revoke insert, update, delete on all tables in schema public from authenticated;
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

-- drop the 18 client-facing write policies (6 data tables × insert/update/delete):
-- study, respondent, quant_response, qual_observation, segment_dimension,
-- journey_definition — each: drop policy "tenant_isolation_insert" / _update / _delete.
-- (SELECT policies untouched; profiles/tenant already had no write policies.)
commit;
```

**Rollback `0002_down.sql`** (kept alongside, never auto-applied): re-grant
`insert, update, delete` to `authenticated` + recreate the 18 policies verbatim
from `0000_init_schema_and_rls.sql:210-378`.

**Test changes — `scripts/isolation-test.mjs` gains Test 4 ("own-tenant write
rejection")**: authenticate as client A and assert `INSERT`, `UPDATE`, `DELETE`
against A's **own** tenant rows on all six data tables are rejected
(expect `42501 permission denied`). Note: existing Test 3 (cross-tenant insert)
keeps passing — it asserts "any error", and the error code shifts from an RLS
violation to a grant denial.

**Order of application:** staging project first → run full isolation test (v2,
with Test 4) → your sign-off → production → re-run against production.

**Also verified unaffected:** the app's ingest flow (service_role bypasses both
grants and RLS) and all dashboard reads (SELECT grant + policies untouched).

---

## P0.2 — Zod at every input boundary (red flag #4)

New module `src/lib/validation/schemas.ts`; whitelisted fields, reject-by-default.

| Boundary | Current | Planned schema |
|---|---|---|
| `login` action (`login/actions.ts:12-17`) | manual `String().trim()` | `email: z.string().trim().max(254).email()`, `password: z.string().min(1).max(256)` — parse only these two fields from FormData |
| `ingestStudyFile` action (`admin/upload/actions.ts:56-72`) | manual coercion | `tenant_id: z.string().uuid()`, `study_name: z.string().trim().min(1).max(200)`, `period: z.string().trim().max(100).optional()`, `required_columns: z.array(z.string().regex(/^[a-z0-9_]+$/i)).max(50)` (post-split); `file` checked as today (instanceof File, ≤10 MB) **plus an extension allowlist mirrored from `parse.ts`** |
| `/login?error=` search param (`login/page.tsx:12,26-33`) | renders arbitrary query text | replace free-text with an **error-code allowlist**: actions redirect with `?error=invalid_credentials\|missing_fields`; the page maps codes → fixed Spanish messages, anything else renders nothing. (JSX already escapes, but rendering attacker-chosen URL text is unnecessary surface.) |
| `/api/health` | no input | no change (verified: reads nothing from the request) |
| Ingestion file contents | Zod already (`canonical.ts:65-77`) | unchanged |

Failure messages stay user-friendly and in Spanish, matching current UX.

---

## P0.3 — Security response headers (red flag #3a)

Per architecture doc **§5.2** ("Security response headers" block). Two layers:

**A. In-repo (versioned, testable via `cf:preview`):** `headers()` in
`next.config.ts` applying to `/(.*)`:

```
Content-Security-Policy:  default-src 'self'; script-src 'self' <see decision below>;
                          style-src 'self' 'unsafe-inline'; img-src 'self' data:;
                          connect-src 'self' https://<project-ref>.supabase.co;
                          frame-ancestors 'none'; base-uri 'self'; form-action 'self';
                          object-src 'none'
X-Frame-Options:          DENY
X-Content-Type-Options:   nosniff
Referrer-Policy:          strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains   (preload later, once domain is stable — §5.2)
Permissions-Policy:       geolocation=(), camera=(), microphone=()
```

**B. Cloudflare edge (Transform Rule):** mirror the same header set zone-wide so
static assets are covered too, exactly as §5.2 prefers. *Depends on a custom
domain (zone) — see open question Q1.*

**Two deliberate deviations from the §5.2 block — need your approval:**
1. **`script-src`**: the doc says `script-src 'self'`, but Next.js App Router
   injects inline bootstrap scripts — a literal `'self'` breaks the app. Plan:
   **nonce-based CSP** (`'nonce-…' 'strict-dynamic'`) generated in the existing
   middleware, the Next-supported pattern; verified under `cf:preview` before
   deploy. Fallback if the nonce pattern misbehaves under OpenNext:
   `script-src 'self' 'unsafe-inline'` as a *documented temporary* deviation.
2. **`img-src`**: doc says `'self' data: https:`; `https:` is any origin. Plan
   tightens to `'self' data:` (adding the Supabase storage origin only when we
   actually serve images from it) — consistent with the doc's own
   "connect-src … and nothing broader" instruction.

`connect-src` whitelists the **exact** Supabase project origin (public value),
nothing broader — per §5.2's note.

---

## P0.4 — Rate limiting + WAF (red flag #3b) — dashboard config, no code

Exact settings per §5.2 ("Rate limiting rules", "Bot management"):

| Setting | Value |
|---|---|
| Rate rule 1 — auth brute force | Expression: `http.request.uri.path eq "/login" and http.request.method eq "POST"` (covers the login server action, which POSTs to `/login`) · **5 req / 1 min per IP** · action **Block**, timeout 10 min |
| Rate rule 2 — API ceiling | All dynamic paths · **100 req / 1 min per IP** · action Managed Challenge |
| WAF | Enable Cloudflare **Managed Ruleset** (Free Managed Ruleset auto-applies on free tier; full managed rules need Pro) |
| Bot management | **Bot Fight Mode: ON** (Super BFM if Pro) |
| TLS | **Full (Strict)**; HSTS also enabled zone-side to match the header |
| Geo (optional, §5.2) | If clients are Mexico-only: Managed Challenge on non-MX traffic to `/login` |

**Plan-tier reality (flagged honestly):** the Free plan includes **one** rate
limiting rule and fixed (not progressive) block timeouts. If we stay on Free
until the first live client (§9.2 stance): apply **rule 1 only** (login is the
asset that matters), accept Supabase Auth's own built-in limits as the
compensating control for rule 2, and enable rules 2 + progressive blocking +
full managed WAF when the planned Pro upgrade happens.

**Dependency:** all of the above are **zone** features. If the Worker runs only
on `*.workers.dev` (no custom domain), none of it applies → step 1 becomes
"attach the custom domain". See Q1.

Deliverable: settings applied by you or with you in the dashboard (I can't and
shouldn't hold Cloudflare credentials), then verified from outside — a scripted
login flood must hit the block.

---

## P0.5 — Tooling & hygiene

`package.json` additions (no new dependencies; wraps existing gates):

```json
"typecheck":      "tsc --noEmit",
"test":           "npm run test:calc",                 // offline gates
"test:calc":      "tsx scripts/calculation-test.mjs",
"test:isolation": "node --env-file=.env.local scripts/isolation-test.mjs",
"test:secrets":   "node --env-file=.env.local scripts/secret-leak-test.mjs",
"gates":          "npm run typecheck && npm run build && npm run test && npm run test:isolation && npm run test:secrets"
```

(`test:isolation`/`test:secrets` need a live project + env, so they're separate
from the offline `test`; `gates` is the pre-deploy everything-run.)

**Staging/production Supabase split:** inventoried in P0.0. If only one project
exists, create the **staging** project (free tier), apply migrations 0000+0001
there, and document the env matrix in `docs/DEPLOYMENT.md`. Real client data
never enters staging (standing rule).

---

## P0.6 — Production-branch hygiene

- Create a **`production`** branch as the deploy branch; point Cloudflare's Git
  build at it (currently unknown which branch it builds — Q4).
- On `production` only, strip: `CLAUDE.md`, `AGENTS.md`, `system_context.md`,
  `AUDIT_V1.md`, `docs/FASE_*.md`, `docs/P0_PLAN.md`.
- **§-citations inside source comments:** stripping them from code on one branch
  creates permanent merge friction between `main` and `production`. Options:
  **(a)** a scripted release step that rewrites comments on `production`
  (automatable, but adds release machinery), or **(b)** keep code comments as
  normal engineering references and strip only the standalone docs. I recommend
  **(b)** for now — decision is yours (Q5).

---

## P0.7 — Acceptance gate (all must pass to close P0)

| # | Check | How verified |
|---|---|---|
| 1 | Cross-tenant isolation holds | `test:isolation` (tests 1–3) green vs. staging AND production |
| 2 | Client writes rejected, even own-tenant | new Test 4 green |
| 3 | Security headers present; app can't be iframed | `curl -I` shows the set; iframe embed attempt blocked (`frame-ancestors 'none'` + XFO DENY) |
| 4 | Login flood blocked | scripted >5 POST `/login`/min from one IP → 429/block page |
| 5 | Zod rejects malformed input on every boundary | targeted bad-input tests: non-UUID tenant_id, oversize fields, bogus `?error=`, wrong file ext |
| 6 | No secrets in bundle | `test:secrets` green after `cf:build` |
| 7 | `typecheck`, `build`, all gates green | `npm run gates` |

---

## Open questions (blockers to resolve at approval)

- **Q1.** Does the Worker have a **custom domain** (Cloudflare zone), or does it
  run on `*.workers.dev`? (Gates P0.3-B and all of P0.4.)
- **Q2.** Cloudflare plan: Free or Pro? (Rate-rule count, progressive blocking,
  full managed WAF.)
- **Q3.** How many Supabase projects exist today, and which does `.env.local`
  point to? (Staging-first rule needs a staging target.)
- **Q4.** Which branch does Cloudflare currently build from?
- **Q5.** Production-branch comment policy: option (a) scripted rewrite or
  (b) strip docs only (recommended)?
- **Q6.** Approve the two CSP deviations from §5.2 (nonce-based `script-src`;
  tightened `img-src`)?

---

*Nothing in this plan has been executed. Awaiting approval — and answers to
Q1–Q6 — before any migration, code, or dashboard change.*
