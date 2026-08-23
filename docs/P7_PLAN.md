# P7 — Full hardening, adversarial suites A–E, backups and incident response

> **Type:** implementation-ready plan produced by a read-only evidence inventory.
> **Evidence date:** 2026-08-22 (local). Live probes returned UTC timestamps of
> `2026-08-23T04:0x`.
> **Status:** plan only. No control in this document has been implemented,
> executed, or enabled by the task that produced it.
> Read `CLAUDE.md` and `docs/CURRENT_STATE.md` first; this document does not
> replace them.

---

## 1. Objective and final acceptance gate

P7 is the final V2 hardening and go-live-preparedness phase. It adds no product
features. It converts the security posture from *"implemented and documented"*
to *"adversarially proven, observable, and recoverable"*.

**Final acceptance gate (unchanged, from the architecture §8 phase table):**

1. **Adversarial suites A–E green**, executed as repeatable committed gates —
   behavioral, authenticated, through the real API/app, never through the
   Supabase SQL editor and never by asserting on source text alone; **and**
2. **backup restoration successfully demonstrated** — a real export restored into
   a verifiable state, with the restored numbers checked against the canonical
   calculation engine.

A suite is not green because a document says the control exists. A suite is green
only when an executable check attempts the attack and observes it fail.

---

## 2. Verified baseline

Collected read-only on 2026-08-22.

| Item | Observed value |
|---|---|
| Branch | `main`, clean working tree, `main` == `origin/main` |
| HEAD | `b529411e73de207513c52aa163f5a92ee95985e8` (`docs: close P6 and establish the P7 kickoff (#29)`) |
| App baseline | `2fe76705cf2b98439b37cc6ff9a79c3f147f41d1` (PR #28, last commit that changed application code) |
| Production URL | `https://becommunity-v1.ollinagencyllc.workers.dev` |
| Health probe (once) | `200` · `{"status":"ok","supabase":true,"ts":"2026-08-23T04:03:32.874Z"}` |
| Response headers on `/login` (once) | `strict-transport-security`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy`, and a per-request nonce `content-security-policy` — the full expected set is live |
| Worker (Cloudflare API, read-only list) | script name **`becommunity-v1`**; current 100% version `2a508633-b985-474a-bc2d-e1ddf38a6c79` |
| Migrations | `0000`–`0013` (14 files), 2 rollbacks, 1 coverage SQL |
| Scripts | 40 files in `scripts/` |
| Deterministic suite | `npm test` chains 23 gates |
| CI | none — no `.github/` directory in the repository |
| `npm audit` (once) | **0 critical, 9 high, 3 moderate** |
| `gh` CLI | not installed on this machine |

Two baseline deltas worth recording, neither of which blocks P7:

- `docs/CURRENT_STATE.md` records Worker version `0454021a-e307-430b-bb36-27612b5faa0c`
  as the post-P6 deployment. The Cloudflare API now reports
  `2a508633-b985-474a-bc2d-e1ddf38a6c79` at 100%, with `0454021a` immediately
  preceding it in the deployment list. Version IDs are not permanent identifiers;
  the running code is expected to be the same P6-closure bundle, but **that is an
  assumption, not a verified fact** — see R25.
- `wrangler.toml` on `main` declares `name = "be-community"`. **No Worker by that
  name exists on the account**; the live Worker is `becommunity-v1`. An unmerged
  branch `origin/update_worker_name_to_becommunity-v1` fixes exactly this.

---

## 3. Scope and non-goals

### In scope

Tenant-isolation coverage · server-side authorization coverage · input,
injection, XSS, upload and pivot-boundary coverage · secrets and supply-chain
verification · edge and authentication resilience · audit logging for
authentication, administrative mutations and imports · actionable anomaly
monitoring and alerting · backup creation and a demonstrated restore · an
incident-response playbook · production-branch hygiene and deployment strategy ·
Cloudflare perimeter/go-live controls · separate staging and production Supabase
environments · the Supabase Pro activation trigger · LFPDPPP data-minimization
and deletion-readiness requirements.

### Explicit non-goals

- Retention-diagnostic product features.
- New CEO/employee permission tiers (roles stay `internal` and `client`).
- Any CRM functionality.
- V2.5 named templates or any new business formula.
- Kano (out of scope by the consultant's own process documentation).
- Unrelated UI polish.
- New infrastructure adopted for convenience rather than for a required control.

### Reconciliation with `BeCommunity_V2_Technical_Architecture.docx`

The architecture document is historical input. Where it conflicts with verified
current decisions, code, or migrations, the current state wins. Recorded
reconciliations:

| Architecture says | Current verified reality | Resolution |
|---|---|---|
| Kano modelling considered | Consultant's process documentation: *"No se va a utilizar este modelo"* | **Out of scope.** Do not build. |
| In-browser Arquero powers cross-filter and pivot (§2, §5.3) | Production uses the Workers-safe engine in `src/lib/calc/{table,engine,pivot}.ts`; Arquero 8.0.3 is a **dev-only parity oracle** because workerd forbids runtime code generation | **Current wins.** Arquero must never enter production-reachable code; `scripts/workers-runtime-safety-test.mjs` guards this. |
| Role tiers admin / consultant / client (§6.1 Suite A) | Only `internal` and `client` exist (`profiles.role` check constraint, `0000`); within a tenant, `profiles.data_scope` (`0012`) narrows a client user | **Current wins.** Suite A's "consultant sees only assigned tenants" is re-expressed as a `data_scope` enforcement test (R2). See D5. |
| Tenant isolation via `can_access_tenant()` SECURITY DEFINER helpers in a `private` schema (§5.4) | Never built. Policies inline `tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))` | **Current wins** (`AUDIT_V1.md` §2.1). Do not refactor during P7; a policy rewrite is a human-review zone with no security gain. |
| CSP `img-src 'self' data: https:` (§5.2) | App emits `img-src 'self' data: <supabase-origin>` | **Current wins** — strictly narrower. Do not widen to match the document. |
| Backups via "GitHub Action → object storage" (§5.6) | No backup mechanism of any kind exists | Treated as **one candidate option**, not a decision. See §10 and D2. |
| Supabase project is production | The connected project holds **synthetic test data only** and is not the final real-client project | **Current wins.** All P7 work executes against synthetic infrastructure. |
| MFA for internal accounts (§5.5) | Not configured; availability on the current tier unverified | Human decision D6; verify tier availability before promising it. |

---

## 4. Requirement-to-evidence matrix

Status vocabulary: **Implemented** (executable or observable proof exists) ·
**Partial** (control exists but its verification is offline/static/manual, or the
control covers only part of the requirement) · **Missing** · **Blocked**
(external prerequisite) · **Decision** (needs a human choice before work starts).

Verification vocabulary: **behavioral** (attempts the attack through the real
API/app) · **static** (asserts on source or SQL text) · **live** (touches the
real Supabase project) · **manual** · **absent**.

| ID | Requirement | Status | Repository evidence | Existing verification | Remaining gap | Depends on | Review zone | Safe now? |
|---|---|---|---|---|---|---|---|---|
| R1 | Cross-tenant read/write rejected for an authenticated user | Partial | `scripts/isolation-test.mjs` tests 1–4; `npm run test:isolation`; policies in `supabase/migrations/0000_init_schema_and_rls.sql` | behavioral + live | Not exercised through the **app** routes, only through PostgREST; no assertion that `import_batch` / `import_mapping` / `study_template` stay invisible to a client who legitimately holds a published study | synthetic tenants A/B (already in `.env.local`) | Authorization | Yes |
| R2 | `profiles.data_scope` cannot be bypassed | Missing | Enforcement is app-layer only: `applyDataScope` in `src/lib/studies/scope.ts`, called from `src/lib/studies/authorized.ts:84`; `scripts/data-scope-test.mjs` is a static check | static | No behavioral proof that a scoped client user cannot retrieve out-of-scope rows via the dashboard data action, the PDF route, or PostgREST. Raw-table reads are revoked (`0009`), so the app layer is the **only** enforcement point — it must be proven, not assumed | R4 harness | Authorization | Yes |
| R3 | RLS on every public table, verified before deploy | Partial | `supabase/tests/rls_coverage.sql`; `CLAUDE.md` claims coverage "is tested before every deploy" | manual (SQL editor) | The query is **not executable from a script** — nothing in `package.json` runs it, so the claim overstates current reality. Needs an internal-only `security definer` reporting function plus a gate script | migration | Authorization | Yes |
| R4 | Every mutating action/route rejects unauthenticated callers | Missing | Guards exist and are correct: `src/app/admin/clients/actions.ts:18,22`, `admin/qualitative/actions.ts:15,18`, `admin/studies/actions.ts:20,23`, `admin/upload/actions.ts:83,91`, `api/studies/[studyId]/report/route.ts:28`, `dashboard/data-actions.ts:32`, `src/lib/supabase/middleware.ts:81` | **static only** — `scripts/publication-boundary-test.mjs` asserts that the string `auth.getUser()` appears in the sources | No HTTP-level suite exists. No script issues a request to the app; the only app-level test (`responsive-layout-test.mjs`) drives an **authenticated** browser | running app (local or preview) | Authorization | Yes |
| R5 | Admin-only actions reject a `client` caller; client-side role tampering changes nothing | Missing | same guards as R4 | absent | Nothing exercises the Lovable-class failure mode at runtime | R4 harness | Authorization | Yes |
| R6 | Zod at every untrusted boundary | Partial | `src/lib/validation/schemas.ts`, `src/lib/studies/scope.ts`, `src/lib/reporting/filters.ts`, `src/lib/ingestion/canonical.ts`, `src/lib/templates/schema.ts`, `src/lib/dashboard/config.ts`; `scripts/validation-test.mjs` (`npm run test:validation`) | offline unit | Schemas are proven in isolation; no proof the **routes** reject the same payloads with a safe status and no error leakage | R4 harness | Secrets/config adjacent | Yes |
| R7 | Free-text XSS renders inert in dashboard and PDF | Missing | No `dangerouslySetInnerHTML` anywhere in `src/` (grep clean); quotes render through escaped JSX text nodes; publication requires `quote_approved` (`src/lib/studies/authorized.ts`) | absent | No end-to-end payload: ingest → triage → confirm → client dashboard → server PDF. The PDF path (`src/lib/reporting/pdf.ts`, pdf-lib) also needs a "hostile text does not corrupt or inject" case | synthetic study | Authorization / output | Yes |
| R8 | Malformed/oversized imports rejected with zero partial writes | Partial | `MAX_UPLOAD_BYTES` + `uploadSchema` (`src/lib/validation/schemas.ts`), `bodySizeLimit: "11mb"` (`next.config.ts`), atomic commit function (`supabase/migrations/0003_universal_ingestion_storage.sql`), `scripts/atomic-ingestion-test.mjs` (offline) and `scripts/atomic-ingestion-live-test.mjs` (`npm run test:atomic-live`) | offline + live | No HTTP-level oversize / wrong-MIME case; no post-failure residue count taken through the real upload action | R4 harness | — | Yes |
| R9 | Pivot intents outside the allowlist are rejected before compute | Partial | Allowlist derivation and re-validation in `src/lib/calc/pivot.ts`; `scripts/pivot-test.mjs` exists | offline, **orphaned** | `scripts/pivot-test.mjs` is wired to **no** npm script and therefore never runs in `npm test`. No forged intent is submitted over the wire | — | — | Yes |
| R10 | Injection strings in filter/report params are parameterized, no error leakage | Missing | `src/lib/reporting/filters.ts`, `src/lib/calc/filters.ts` (`validateSegmentFilters`), PostgREST parameterization | absent | No adversarial parameter probe; no assertion that error responses never echo internals | R4 harness | — | Yes |
| R11 | The artifact the browser/edge receives contains no secret | Partial | `scripts/secret-leak-test.mjs` (`npm run test:secrets`) scans `.next/static` | behavioral on the client bundle | It does **not** scan `.open-next/` — the bundle actually deployed — although `docs/CURRENT_STATE.md` warns that local OpenNext output can inline environment values | `cf:build` output (Linux build if Windows `EPERM`) | Secrets | Yes |
| R12 | `.env` gitignored; no secret in git history | Partial | `.gitignore:36` (`.env*`); `git log --all -- .env .env.local .env.production` returns nothing | manual (re-verified 2026-08-22) | Not automated as a gate; a future accidental commit would not be caught | — | Secrets | Yes |
| R13 | No high/critical dependency vulnerabilities | **Missing — currently failing** | `npm audit`: 0 critical, **9 high**, 3 moderate. High: `next` (middleware/proxy bypass advisory for App Router), `postcss`, `sharp`, `undici`, `nanoid`, `js-yaml`, `brace-expansion`, `miniflare`, `wrangler`; moderate: `@tailwindcss/postcss`, `uuid` (reached through the runtime dep `exceljs`) | absent (no gate) | No audit gate exists, and the current tree would fail one. Each advisory needs reachability triage; the `next` advisory touches the **middleware auth gate**, a human-review zone | D4 (upgrade approval) | Secrets/config | Triage yes; upgrades need approval |
| R14 | Dependencies pinned and provenance-verified | Partial | Runtime deps exact-pinned in `package.json`; `@tailwindcss/postcss`, `tailwindcss`, `eslint`, `typescript`, `@types/*` still use `^` ranges | manual | Range-pinned devDeps contradict the standing pin rule; no automated check | — | — | Yes |
| R15 | Security headers present on responses | Partial | `next.config.ts` static set; nonce CSP in `src/lib/supabase/middleware.ts`; **observed live** on `/login` 2026-08-22 | live, manual, one-off | No committed assertion; a regression would ship silently. Edge mirror is zone-dependent (R27) | — | Secrets/config | Yes |
| R16 | The app cannot be framed | Partial | `X-Frame-Options: DENY` + `frame-ancestors 'none'`, both observed live | live, manual | No committed assertion | — | — | Yes |
| R17 | Expired/invalid/tampered session is rejected and redirected | Missing | `getUser()` revalidation in `src/lib/supabase/middleware.ts:81` and in every protected page | absent | No test forges or expires a cookie and asserts the redirect/401 | R4 harness | Authorization | Yes |
| R18 | Login endpoint rate-limited | Blocked + Decision | `docs/GO_LIVE_SECURITY.md` B2 documents the intended Cloudflare rule; nothing is configured | absent | Cloudflare rate-limiting rules require a **zone**; the Worker runs on `*.workers.dev`. Interim options: rely on Supabase Auth's built-in limits, or add a Worker/app-layer throttle | custom domain, or D1 | Authorization | Only if D1 picks the app-layer option |
| R19 | Audit logging: authentication, admin mutations, imports | Missing | No audit table in any migration; no logger in `src/`. Partial provenance only: `import_batch` / `import_mapping` / `recoding_table` carry `created_by` + `created_at` (`0003`) | absent | The entire detection layer of the five-layer posture is absent. A breach today would be neither noticed nor reconstructable | migration | Authorization | Yes |
| R20 | Actionable anomaly monitoring and alerts | Missing | `docs/OPERATIONS.md` describes an Uptime Robot monitor on `/api/health`; the health route exists and returns 200 | absent in repo | Uptime Robot configuration is external and unverified from here; there is no 401/403-spike, failed-login-burst, or unusual-import alert. Cloudflare/Supabase anomaly alerting is largely zone/Pro-gated | R19, D3 | — | Partly (in-app signals yes; external channel per D3) |
| R21 | Backups exist | Missing | none | absent | Supabase Free has **no** backups. Data loss today would be total. Only synthetic data is at risk right now, which makes this the cheapest moment to build and prove the mechanism | D2 | — | Yes |
| R22 | Restore demonstrated | Missing | none | absent | The acceptance gate explicitly requires a **demonstrated** restore, not a backup file | R21 | — | Yes (synthetic only) |
| R23 | Incident playbook (rotation, revocation, containment, recovery, verification) | Missing | `docs/GO_LIVE_SECURITY.md` covers perimeter setup, not incident response | absent | Must be written before launch. Writing it is safe; **executing** rotation/revocation is not part of P7 | R19, R21 | Secrets/config | Yes (write only) |
| R24 | `production` branch clean of prompt docs | Missing | `docs/GO_LIVE_SECURITY.md` B3 specifies the intended strategy; no `production` branch exists (31 remote branches, none named `production`) | absent | Branch creation is a human-gated action; P7 delivers the documented procedure and the strip list | D7 | — | Procedure yes; branch creation is D7 |
| R25 | Deployment strategy is correct and attributable | Partial | `wrangler.toml` names `be-community`; the live Worker is `becommunity-v1`; `origin/update_worker_name_to_becommunity-v1` carries the one-line fix, unmerged. The deployment list shows `Source: Unknown (deployment)` and `Secret Change` entries | live, read-only | **A local `npm run cf:deploy` from `main` would publish a second, separate Worker instead of updating production.** Deploys are manual, unattributed, and not tied to a commit | — | Secrets/config | Yes |
| R26 | Gates enforced automatically | Missing | none — no `.github/` | absent | Every gate depends on a human remembering to run it | D7 | — | Yes |
| R27 | Cloudflare perimeter: managed WAF, bot mode, TLS Full (Strict), edge header mirror, geo rules | Blocked | `docs/GO_LIVE_SECURITY.md` B1/B2 | absent | All of it needs a **zone**. `*.workers.dev` has no zone-level WAF, rate limiting, or Transform Rules | custom domain | Secrets/config | No |
| R28 | Separate staging and production Supabase projects | Blocked | `docs/GO_LIVE_SECURITY.md` B4; `docs/OPERATIONS.md` names the single dev project | absent | The production project does not exist. Creating it is explicitly forbidden until approved | D8 | Authorization | No |
| R29 | Supabase Pro activation trigger | Blocked + Decision | `docs/GO_LIVE_SECURITY.md` B5; architecture §9.2 | absent | Pro supplies leaked-password protection, session controls and daily backups. Trigger: **before the first real client receives a link** | D8, billing | — | No |
| R30 | MFA available for internal accounts | Decision | not configured | absent | Confirm availability on the current tier before committing to it | D6 | Authorization | Verification yes; enabling is D6 |
| R31 | Per-study personal-data record, privacy notice, DPA where required | Missing (Decision on legal text) | `docs/PRODUCT_DATA_POLICY.md` covers disclosure control, not the LFPDPPP register | absent | Needs a per-study "what personal data, why" record and client-facing notice text | D9 | — | Structure yes; legal text is D9 |
| R32 | Data minimization / small-cell suppression | Implemented | `docs/PRODUCT_DATA_POLICY.md` §1 (n<5 suppressed, n<30 cautioned), implemented in `src/lib/calc/disclosure.ts` and exercised by the calculation gates | offline | Add a regression case proving suppression also holds in the **PDF** and after filter combinations that could enable differencing | — | Calculation | Yes |
| R33 | Right to deletion (tenant/study hard-delete, admin-only, audited) | Missing | `deleteClientUser` (`src/app/admin/clients/actions.ts:183`) and `deleteTemplate` (`src/app/admin/studies/actions.ts:124`) exist; **no tenant or study deletion path** | absent | LFPDPPP deletion readiness has no implementation. The DB primitive exists (`on delete cascade` throughout) | R19 (must be audited) | Authorization | Yes (synthetic) |
| R34 | Encryption in transit and at rest | Implemented | HTTPS + HSTS observed live; Supabase-managed encryption at rest | live | Confirm TLS mode **Full (Strict)** at the zone when one exists (folds into R27) | — | — | Yes |

### Status counts

| Status | Count | IDs |
|---|---:|---|
| Implemented | 2 | R32, R34 |
| Partial | 11 | R1, R3, R6, R8, R9, R11, R12, R14, R15, R16, R25 |
| Missing | 15 | R2, R4, R5, R7, R10, R13, R17, R19, R20, R21, R22, R23, R24, R26, R33 |
| Blocked on external prerequisite | 3 | R27, R28, R29 |
| Requires a human decision first | 3 | R18, R30, R31 |
| **Total** | **34** | |

R13 is counted once as Missing but is materially worse than the label: the gate is
absent **and** the current dependency tree would fail it today.

---

## 5. Suites A–E coverage matrix

Suite definitions follow the architecture §6.

| Suite | Required check (architecture §6) | Covered today by | Coverage verdict | P7 action |
|---|---|---|---|---|
| **A1** | Tenant A read/write against tenant B via direct API → zero rows / rejection | `scripts/isolation-test.mjs` tests 2 & 3 | **Green (behavioral)** | Keep; fold into `suite:a` |
| **A2** | Consultant sees only assigned tenants | — no consultant role exists | **N/A — reconciled** | Replace with the `data_scope` enforcement test (R2) |
| **A3** | Admin sees all; anonymous sees nothing | anon covered by `isolation-test.mjs` test 1; "internal sees all" untested | **Partial** | Add an internal-role positive control |
| **A4** | No public table with `rowsecurity = false` | `supabase/tests/rls_coverage.sql`, manual only | **Partial — claim overstated** | Make it executable (migration + gate) |
| **A5** | Cross-tenant `UPDATE` move rejected by `WITH CHECK` | Superseded: `0002` revoked client writes entirely; `isolation-test.mjs` test 4 proves own-tenant writes are denied | **Green, re-expressed** | Assert denial-by-grant **and** that the service-role write path cannot mis-stamp `tenant_id` (composite FKs in `0003`) |
| **B1** | Every mutating action/route unauthenticated → rejected | static regex assertions only | **Red** | New HTTP suite |
| **B2** | Admin-only action as a `client` → rejected | — | **Red** | New HTTP suite |
| **B3** | Tampered client-side role state → still rejected | — | **Red** | New HTTP suite |
| **C1** | XSS payload in free text renders inert | structural only (no `dangerouslySetInnerHTML`) | **Partial (structural, not behavioral)** | End-to-end payload through dashboard **and** PDF |
| **C2** | Malformed/oversized import rejected, zero partial writes | `atomic-ingestion-test.mjs` + `atomic-ingestion-live-test.mjs` | **Green at the data layer, Red at HTTP** | Add the HTTP-level case + residue count |
| **C3** | Pivot intent outside the allowlist rejected before compute | `scripts/pivot-test.mjs` — **not wired to any npm script** | **Partial — orphaned test** | Wire it in; add a forged-intent-over-the-wire case |
| **C4** | Injection strings in search/filter params → parameterized, no error leakage | — | **Red** | New probe |
| **D1** | Production bundle grep for secret patterns | `scripts/secret-leak-test.mjs` on `.next/static` | **Partial** | Extend to `.open-next/` |
| **D2** | `.env` gitignored, no secret in git history | manual verification | **Partial** | Automate as a gate |
| **D3** | `npm audit` clean of high/critical; packages verified | — | **Red, currently failing (9 high)** | Gate + triage + approved upgrades |
| **E1** | Login flood → challenged/blocked | — | **Blocked (no zone)** | Decision D1; document honestly either way |
| **E2** | Security headers present | observed once, manually | **Partial** | Committed assertion against the deployed Worker |
| **E3** | Iframe load blocked | observed once, manually | **Partial** | Committed assertion |
| **E4** | Expired/invalid session token → rejected, redirected | — | **Red** | New session-resilience case |

### Gate reconciliation — current scripts mapped to suites

| Script / npm command | Nature | Suite | Note |
|---|---|---|---|
| `test:isolation` → `isolation-test.mjs` | behavioral, live | **A** | The strongest existing gate. Live-only by necessity; correctly excluded from the offline `npm test` |
| `supabase/tests/rls_coverage.sql` | manual SQL | **A** | Not executable — the "tested before every deploy" claim in `CLAUDE.md` is stale |
| `test:client-boundary`, `test:publication-boundary`, `test:client-preview`, `test:data-scope`, `test:client-admin`, `test:study-config`, `test:tenant-branding`, `test:longitudinal`, `test:narrative-home`, `test:qualitative`, `test:import-center`, `test:templates` | **static** — `readFile` + regex over `src/**` and `supabase/migrations/**` | A/B (nominally) | Useful as anti-regression tripwires for structure. **They cannot prove runtime enforcement** and must not be counted as Suite A/B coverage |
| `test:server-pdf` | mixed: reads route source **and** builds a PDF | B/C | Partly static |
| `test:validation` | offline unit | **C** | Schemas only, not routes |
| `test:atomic-ingestion`, `test:atomic-live`, `test:ingestion-core` | offline + live | **C** | Genuine zero-partial-write proof |
| `test:bi-filters` | offline | **C** | Filter logic only |
| `test:secrets` | behavioral on the client bundle | **D** | Misses `.open-next/` |
| `test:calc`, `test:business-calc`, `test:cloudflare-calc`, `test:confirmed-qualitative` | offline correctness | — | Calculation integrity, not a security suite |
| `test:workers-runtime`, `test:workers-ingestion` | offline structural | — | Guards the Arquero / ExcelJS runtime constraints |
| `test:responsive-live` | live browser, **authenticated** | — | Layout only; not an adversarial gate |
| `client-admin-live-test.mjs`, `template-live-test.mjs`, `tenant-branding-live-test.mjs`, `import-center-live-test.mjs`, `qualitative-triage-live-test.mjs` | live via **`service_role`** | — | **These prove the database accepts a privileged write. They prove nothing about authorization**, because `service_role` bypasses RLS and grants. Keep them as functional tests; never cite them as Suite A/B evidence |
| `pivot-test.mjs` | offline | **C** | **Orphaned** — reachable by no npm script |
| `fase4-realdata-check.mjs`, `fase5-journey-check.mjs`, `ingest-test.ts` | legacy | — | Orphaned V1-era checks; retire or re-home in PR 12 |
| `seed-test-data.mjs`, `seed-journey-demo.mjs`, `cleanup-test-fixtures.mjs` | fixtures | — | Support scripts for the live suites |

**Duplicate coverage.** The static boundary tests overlap heavily with each other
— several re-assert the same `loadAuthorizedStudyData` invariants. They are cheap
and are not the bottleneck: do **not** delete them; simply stop treating them as
suite coverage.

**Tests that rely on privileged access instead of authenticated API behavior.**
The five `*-live-test.mjs` scripts listed above authenticate with the
service-role key. That is correct for exercising a functional path, and wrong as
evidence for Suites A or B. P7's new suites must sign in as the real synthetic
identities (`TEST_USER_A_*`, `TEST_USER_B_*`, `TEST_INTERNAL_*`, already present
in `.env.local`) and use the publishable key only.

**Stale or overstated claims to correct during P7:**

1. `CLAUDE.md` — "Coverage is tested before every deploy" (R3): true only if a
   human runs the SQL by hand. Fix by making it executable, after which the claim
   holds.
2. `docs/OPERATIONS.md` — the Uptime Robot monitor is described as the operating
   arrangement; it is external and unverified from the repository (R20).
3. `docs/GO_LIVE_SECURITY.md` B3 — describes a `production` branch that does not
   exist (R24). The document is honest that it is not executed; P7 must not
   inherit it as done.

---

## 6. Phased workstreams (dependency order)

- **W1 — Verifiability foundations.** Make the RLS coverage claim executable; build
  the HTTP adversarial harness that Suites B, C and E all depend on. Nothing else
  can be honestly proven until a test can talk to the running app.
- **W2 — Suite A completion.** `data_scope` enforcement, internal positive
  control, executable coverage gate, service-role stamping proof.
- **W3 — Suite B.** Behavioral server-side authorization: unauthenticated,
  wrong-role, and role tampering.
- **W4 — Suite C.** XSS end-to-end, upload abuse at HTTP, pivot allowlist over the
  wire, parameter injection; re-home the orphaned pivot test.
- **W5 — Suite D.** Secret scan extended to the deployed artifact, git-history
  gate, dependency audit gate, then the approved upgrade work.
- **W6 — Suite E (what a zone-less deployment allows).** Header, frame and session
  resilience assertions; the rate-limit decision recorded honestly.
- **W7 — Detection.** Audit logging first, then anomaly signals and alerting on
  top of it.
- **W8 — Recovery.** Backup export, restore proof, incident playbook.
- **W9 — Release discipline.** Worker identity, deploy strategy, production-branch
  procedure, optional CI.
- **W10 — Compliance readiness.** Personal-data register, deletion paths,
  suppression regression.
- **W11 — Closure.** Deferred go-live checklist and handoff update.

W1 gates W3, W4 and W6. W7 gates the recovery content of W8. W5, W9 and W10 are
independent and may proceed in parallel if review capacity allows.

---

## 7. Proposed PR sequence

Each PR is narrow, independently reviewable, and independently revertible.

| PR | Branch | Title | Contents | Human-review zone |
|---:|---|---|---|---|
| **1** | `docs/p7-evidence-plan` | docs: P7 evidence inventory and implementation plan | **This document only.** No code, tests, migrations, or config | — |
| **2** | `p7a-adversarial-harness` | test(p7): add the HTTP adversarial harness | `scripts/lib/http-harness.mjs`: attach to an app origin, sign in as the synthetic A / B / internal identities, carry cookies, forge and expire them. No assertions of its own | Authorization |
| **3** | `p7b-rls-coverage-gate` | feat(security): make RLS coverage executable | migration `0014` — internal-only `security definer` function returning tables lacking RLS or policies (`search_path = ''`, revoked from `anon`/`authenticated`); `scripts/rls-coverage-test.mjs`; rollback `0014_*.sql`; correct the `CLAUDE.md` claim | **Yes — authorization** |
| **4** | `p7c-suite-a` | test(security): complete Suite A | `scripts/suite-a-isolation.mjs` — absorbs `isolation-test.mjs`, adds `data_scope` bypass attempts (dashboard action, PDF route, PostgREST), an internal positive control, and a service-role tenant-stamping proof | **Yes — authorization** |
| **5** | `p7d-suite-b` | test(security): add Suite B server-side authorization | `scripts/suite-b-authorization.mjs` — every admin action and the report route, unauthenticated and as `client`; role tampering; expects redirect/401/403/404 with no data body | **Yes — authorization** |
| **6** | `p7e-suite-c` | test(security): add Suite C input, injection and upload | `scripts/suite-c-input.mjs`; wire `pivot-test.mjs` in as `test:pivot` inside `npm test`; XSS payload end-to-end into dashboard HTML and the generated PDF; oversize/corrupt upload at HTTP with a residue count; forged pivot intent; parameter injection probes | Authorization / output |
| **7** | `p7f-suite-d-gate` | test(security): add the Suite D supply-chain gate | `scripts/suite-d-supply-chain.mjs` — fail on high/critical `npm audit`, scan git history for env files, extend the secret scan to `.open-next/`; **reports the current 9 highs as failures without changing dependencies** | **Yes — secrets/config** |
| **8** | `p7g-dependency-remediation` | fix(deps): resolve high-severity advisories | Approved upgrades/overrides from D4, one logical group per commit, full suite re-run after each. `next` is upgraded only with explicit approval because the advisory touches the middleware auth gate | **Yes — secrets/config** |
| **9** | `p7h-suite-e` | test(security): add Suite E edge and auth resilience | `scripts/suite-e-edge.mjs` against the deployed Worker: header set, frame denial, expired/invalid/tampered session; rate-limit status recorded per D1 | **Yes — authorization** |
| **10** | `p7i-audit-log` | feat(security): add audit logging | migration `0015` — `audit_log` with forced RLS, internal-read-only, no `anon`/`authenticated` grants, service-role writes only; `src/lib/audit/log.ts`; instrumentation of login/logout, all admin mutations, and import commit/rollback; internal backoffice view; rollback script | **Yes — authorization** |
| **11** | `p7j-anomaly-alerts` | feat(ops): add anomaly signals and alerting | Derived signals over `audit_log` (failed-login bursts, denied-action spikes, cross-tenant probes, unusual import volume), an internal review surface, and the alert wiring chosen in D3; `docs/MONITORING.md` | Authorization |
| **12** | `p7k-backup-restore` | feat(ops): add backup export and restore proof | `scripts/backup-export.mjs` (service-role export, per table, checksummed manifest), `scripts/restore-verify.mjs` (restore into a **fresh synthetic tenant**, compare row counts and recomputed metrics), `docs/BACKUP_RESTORE.md`; retire or re-home the orphaned V1-era scripts | **Yes — secrets/config** |
| **13** | `p7l-incident-playbook` | docs: add the incident response playbook | `docs/INCIDENT_PLAYBOOK.md` — detect, contain, rotate, revoke, recover, verify, communicate. Written, never executed | **Yes — secrets/config** |
| **14** | `p7m-release-discipline` | fix(deploy): correct Worker identity and document the deploy strategy | `wrangler.toml` → `becommunity-v1` (supersedes the unmerged branch); `docs/DEPLOYMENT.md` deploy/rollback procedure with version pinning; `production`-branch procedure and strip list; optional CI workflow per D7 | **Yes — secrets/config** |
| **15** | `p7n-compliance-readiness` | feat(compliance): personal-data register and deletion readiness | Per-study personal-data record; audited tenant/study hard-delete (internal-only, logged to `audit_log`); suppression regression in the PDF path; `docs/DATA_PROTECTION.md` shell for D9's legal text | **Yes — authorization** |
| **16** | `p7z-closure` | docs: close P7 and record the deferred go-live checklist | Suite results, restore-proof record, `docs/CURRENT_STATE.md` update, deferred checklist (§17) | — |

---

## 8. Verification gates per PR

**Every** PR runs, and must pass:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Additional, per PR:

| PR | Additional required gates |
|---:|---|
| 1 | `git diff --check`; secret scan of the changed document; confirm only `docs/P7_PLAN.md` changed |
| 2 | Harness self-test against a local dev server; `npm run test:secrets` |
| 3 | `npm run test:rls-coverage` (new) returns zero uncovered tables; `npm run test:isolation` still green; the rollback script applied and re-applied once on the synthetic project |
| 4 | `npm run suite:a`; `npm run test:isolation`; `npm run test:client-boundary`, `test:publication-boundary`, `test:data-scope` |
| 5 | `npm run suite:b` against a local build **and** once against the deployed Worker |
| 6 | `npm run suite:c`; `npm run test:pivot` (newly wired); `npm run test:atomic-live`; post-run residue count = 0 |
| 7 | `npm run suite:d` — expected to **fail** on the 9 highs; the PR lands the gate and records the failing baseline explicitly rather than hiding it |
| 8 | `npm run suite:d` now green; full `npm run gates`; suites A, B, C, E re-run; deployed smoke check of `/login` and `/api/health` |
| 9 | `npm run suite:e` against the deployed Worker |
| 10 | `npm run suite:a` + `suite:b` (audit writes must not open a read path); `npm run test:isolation`; verify `anon` and `authenticated` hold zero privileges on `audit_log` |
| 11 | Signals reproduced from seeded synthetic audit rows; no client-visible surface added |
| 12 | Export → restore into a fresh tenant → recomputed metrics match the source study exactly → fixture teardown verified |
| 13 | Documentation review only; no command in the playbook is executed |
| 14 | `wrangler deployments list --name becommunity-v1` (read-only) confirms identity; **no deploy in the PR** |
| 15 | `npm run suite:a` + `suite:b`; deletion path exercised on a throwaway synthetic tenant only; audit entries confirmed |
| 16 | `npm run gates`; full suites A–E; restore proof re-read for accuracy |

Standing rules: never alter an expected calculation to make a test green; never
mark an unexecuted check as passed; never insert acceptance rows by hand to
bypass the real workflow.

---

## 9. Rollback and recovery strategy

| Mutation | Rollback |
|---|---|
| Migration `0014` (RLS coverage function) | `supabase/rollbacks/0014_drop_rls_coverage_fn.sql`; the function is read-only and grantless, so dropping it removes the gate and nothing else |
| Migration `0015` (`audit_log`) | `supabase/rollbacks/0015_drop_audit_log.sql`; instrumentation sits behind `src/lib/audit/log.ts`, so reverting the app code alone stops writes without a schema change |
| Backup export runs | Read-only against the database; the only artifact is a local file. No rollback needed |
| Restore proof | **Restores into a brand-new synthetic tenant, never over existing rows.** Teardown deletes exactly the fixture ids it created. The P6E acceptance study `ad275928-dbd1-4acf-9de9-fa1623b32a60` and the two draft `Satisfacción 2026 (TEST)` studies are explicitly out of bounds |
| Dependency upgrades (PR 8) | Revert the commit together with `package-lock.json`; the previous lockfile is the rollback artifact. Verified by re-running the full suite |
| Worker identity change (PR 14) | Configuration only, no deploy in the PR. If a later deploy misbehaves, roll back by redeploying the prior version id recorded in the deploy log |
| `production` branch creation (deferred, D7) | Branch deletion; no history rewrite is ever performed on `main` |
| Cloudflare or Supabase infrastructure | **Not touched during P7 implementation.** Perimeter and project-split work is deferred to the go-live checklist under human execution |

No P7 PR mutates production infrastructure, credentials, or real data — and no
real data exists yet.

---

## 10. Backup and restore proof design (synthetic data)

**Constraint.** Supabase Free provides no backups. The available credentials are
the project URL, the publishable key and the service-role key — there is no
Postgres connection string in the environment, and P7 must not request or extract
one.

**Recommended mechanism (pending D2):** a service-role logical export over the
existing API.

1. `scripts/backup-export.mjs` reads every public table in dependency order
   (`tenant` → `profiles` → `study` → `respondent` → `quant_response` →
   `qual_observation` → `segment_dimension` → `journey_definition` →
   `import_mapping` → `recoding_table` → `import_batch` → `study_template`),
   paginating deterministically, writing NDJSON plus a manifest with per-table row
   counts and a content checksum.
2. The manifest records the schema version (highest applied migration), the export
   timestamp, and the project ref. It never records keys.
3. Output goes to an operator-chosen local path, is **not** committed, and the
   `.gitignore` entry lands with the script.

**Restore proof — the actual acceptance artifact:**

1. Create a **new synthetic tenant** and a new study id inside the same dev
   project. Never restore over the source rows.
2. Replay the export into the new ids, remapping tenant/study/respondent ids
   consistently and preserving every foreign key.
3. Verify: per-table row counts match the manifest; every foreign key resolves;
   and — the part that matters — the canonical engine recomputes **identical**
   metric values for the restored study as for the source study, using the
   existing calculation gates rather than a bespoke comparison.
4. Record the proof: source study id, restored study id, counts, metric-parity
   result, timestamps, operator.
5. Tear down the restored fixture, and verify the teardown.

**Alternatives recorded for D2:** (a) `supabase db dump` via the CLI — needs a
database password the human must supply and P7 must not extract; (b) a scheduled
GitHub Action writing to object storage (the architecture's suggestion) — needs a
repository secret and a storage bucket, i.e. new infrastructure plus a human
decision; (c) Supabase Pro daily backups + PITR — the real long-term answer, and
the reason R29 exists. The recommendation is to build the service-role export now
so a proven restore procedure exists **independently of tier**, then hand primary
responsibility to Pro backups at go-live while keeping the export as the
verification mechanism.

---

## 11. Audit logging and alerting design boundaries

**`audit_log` (migration `0015`), append-only:**

- Columns: `id`, `occurred_at`, `actor_user_id` (nullable for anonymous attempts),
  `actor_role`, `tenant_id` (nullable for internal-scope actions), `action`
  (enumerated, not free text), `target_type`, `target_id`, `outcome`
  (`allowed` / `denied` / `error`), `metadata` jsonb, `request_ip`, `user_agent`.
- RLS forced. **No grants to `anon` or `authenticated`.** Reads are internal-only
  through a server path; writes are service-role only. The table must never widen
  the client read surface — PR 10's gate re-runs Suites A and B for exactly this
  reason.

**What is logged:** authentication events (login success, login failure, logout,
session rejection); administrative mutations (client/user create, invite, delete,
data-scope change, study create/configure/publish/archive, template
create/delete, branding change); and imports (analyze, preview, commit, rollback,
with batch id and row counts).

**What is never logged:** passwords, tokens, cookies, keys, full request bodies,
or raw respondent free-text. `metadata` carries identifiers and counts, not
content. Personal data inside logs is itself an LFPDPPP exposure.

**Alerting boundaries.** Without a zone and without Pro, the realistic detection
surface is what the application itself can observe. P7 therefore builds signals
**over `audit_log`** — failed-login bursts per actor and per IP, denied-action
spikes, cross-tenant probe attempts, out-of-hours administrative mutations,
anomalous import volume — surfaced on an internal review page and emitted through
the channel chosen in D3. Cloudflare-native anomaly alerting, Logpush, and
Supabase alert rules are recorded as **deferred** (R27/R29), never claimed. The
existing Uptime Robot keyword monitor on `/api/health` remains the availability
alert; its configuration is verified by the human at go-live rather than asserted
here.

---

## 12. Incident playbook deliverables

`docs/INCIDENT_PLAYBOOK.md` (PR 13) — written before launch, executed never
during P7:

1. **Severity classification** — suspected cross-tenant exposure, credential
   compromise, secret exposure, data loss or corruption, availability loss.
2. **Detect** — where to look first: `audit_log` queries, Worker logs, Supabase
   auth logs, the health monitor.
3. **Contain** — take the app offline at the Worker; disable the affected account;
   state honestly what containment is impossible without a zone.
4. **Rotate** — the exact order for rotating the service-role key, the publishable
   key, and the Cloudflare build/runtime variables, including the rebuild step
   required because `NEXT_PUBLIC_*` values are inlined at build time.
5. **Revoke** — invalidate refresh tokens and force re-authentication; note what
   requires Pro session controls.
6. **Recover** — restore from the §10 backup using the proven procedure.
7. **Verify** — re-run suites A–E and the isolation gate before declaring recovery.
8. **Communicate** — who is told, in what order, and the LFPDPPP notification
   considerations.
9. **Post-incident** — write the timeline, and add the regression test that would
   have caught it.

Every rotation and revocation step is a **human-executed** runbook entry. P7 does
not rotate, revoke, or rehearse rotation against live credentials.

---

## 13. Production branch and deployment strategy

**Current reality:** manual local `cf:deploy`, no CI, no `production` branch, and
a `wrangler.toml` naming a Worker that does not exist on the account. Deployment
entries show `Source: Unknown (deployment)` — nothing ties a running version to a
commit.

**Target state:**

1. `wrangler.toml` names `becommunity-v1` (PR 14) so a local deploy updates
   production instead of silently creating a second Worker.
2. `main` remains the working branch carrying prompt docs. `production` is the
   deploy branch, created by the human at go-live (D7), stripped of `CLAUDE.md`,
   `AGENTS.md`, `system_context.md`, `AUDIT_V1.md`, `docs/FASE_*.md`,
   `docs/P0_PLAN.md`, `docs/P7_PLAN.md` and `docs/GO_LIVE_SECURITY.md`. All of
   `src/**` is kept intact, code comments included.
3. Every deploy records the commit sha and the resulting Worker version id in the
   handoff, so rollback is "redeploy version X" rather than archaeology.
4. Deploys happen only after `npm run gates` plus suites A–E pass.
5. CI (D7): if adopted, a GitHub Actions workflow runs `typecheck`, `lint`, `test`
   and `build` plus the offline suites on every PR. Live suites stay manual — they
   need synthetic identities and would put credentials in CI. **Recommended: adopt
   CI for offline gates only.**

---

## 14. Executable now vs blocked on an external prerequisite

### Executable now, against synthetic infrastructure

R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13 (gate + triage), R14, R15,
R16, R17, R19, R20 (in-app signals), R21, R22, R23, R25, R26, R32, R33 — that is
**PRs 2–7 and 9–15**, plus the triage half of PR 8.

This covers the whole of Suites A–D, the executable portion of Suite E, audit
logging, backup and restore proof, the incident playbook, release discipline, and
compliance readiness. **The P7 acceptance gate itself — suites A–E green and a
demonstrated restore — is achievable now**, with Suite E's rate-limit item
recorded honestly as zone-deferred rather than claimed.

### Blocked on an external prerequisite

| Blocked item | Prerequisite | Consequence for P7 |
|---|---|---|
| R27 — WAF, bot management, edge header mirror, TLS Full (Strict), geo rules | **Custom domain / Cloudflare zone** | Suite E's perimeter checks stay deferred; the in-app header set is already live and will be asserted |
| R18 — login rate limiting at the edge | the same zone | D1 decides whether an interim app-layer throttle ships in P7 |
| R28 — staging/production Supabase split | **Production Supabase project** (creation is human-gated) | The staging-first migration rule formally activates then; P7 must not create it |
| R29 — Pro: leaked-password protection, session controls, daily backups + PITR | **Billing decision** | Trigger stays "before the first real client receives a link" |
| R30 — MFA for internal accounts | tier verification + D6 | Not claimed until verified |
| R31 — privacy notice / DPA text | **Legal input (D9)** | P7 delivers the register structure, not the legal wording |
| HSTS `preload` | a stable custom domain | Deliberately not set; adding it is hard to reverse |

**None of these may be marked complete because a document describes them.** They
live in §17.

---

## 15. Human decisions and approvals required

| # | Decision | Needed before | Recommendation |
|---|---|---|---|
| **D1** | Interim login rate limiting: rely on Supabase Auth's built-in limits until a zone exists, or ship a Worker/app-layer throttle now | PR 9 | Ship a small app-layer throttle on the login action — cheap, testable today, and Suite E gets a real green instead of a deferral |
| **D2** | Backup mechanism: service-role export (no new infra) vs `supabase db dump` (needs a DB password) vs GitHub Action + object storage (new infra + secrets) | PR 12 | Service-role export now; Pro backups take over at go-live with the export retained as the verification path |
| **D3** | Alert channel for anomaly signals: email through the existing monitor, or a new service | PR 11 | Keep it inside what already exists; do not add infrastructure for convenience |
| **D4** | Approve the dependency upgrade window, in particular `next` (the advisory touches the middleware auth gate) | PR 8 | Approve; triage first, upgrade in one reviewed group, re-run every suite. This is the highest-severity finding that already has a fix available |
| **D5** | Confirm that "consultant sees only assigned tenants" (architecture Suite A2) is formally out of scope for V2 given that only `internal` and `client` exist | PR 4 | Confirm out of scope; record it in the suite as an intentional N/A with the `data_scope` test substituted |
| **D6** | MFA for internal accounts — verify availability on the current tier, then decide | before go-live | Verify first; do not promise it in any document until verified |
| **D7** | When to create the `production` branch, switch deploys to it, and whether to adopt CI for offline gates | PR 14 / go-live | Adopt CI for offline gates now; create `production` at go-live |
| **D8** | Create the production Supabase project and activate Pro | go-live | Trigger remains: before the first real client receives a link |
| **D9** | Privacy notice and DPA wording; retention periods per study | PR 15 / go-live | Legal input required; P7 ships the structure only |

---

## 16. P7 definition of done

P7 is done when **all** of the following hold:

1. Suites **A, B, C, D and E** exist as committed, repeatable, behavioral gates and
   all pass — with every deferred item explicitly named as deferred, never as
   passed.
2. `npm audit` reports **no high or critical** vulnerabilities, or every remaining
   one carries a written, human-approved reachability exemption.
3. A backup has been produced **and restored**, and the restored study's metrics
   match the source exactly under the canonical engine, with the proof recorded.
4. `audit_log` captures authentication, administrative mutations and imports, and
   adding it demonstrably did not widen the client read surface.
5. Anomaly signals exist over that log and reach a human through a chosen channel.
6. `docs/INCIDENT_PLAYBOOK.md` exists and has been reviewed.
7. The deploy path is unambiguous: correct Worker identity, documented
   deploy/rollback, and a documented `production`-branch procedure.
8. Deletion readiness and the personal-data register exist for LFPDPPP.
9. `npm run gates` is green and `docs/CURRENT_STATE.md` records the P7 outcome.
10. §17 exists, is accurate, and no item in it is described anywhere as complete.

P7 does **not** require a custom domain, a production Supabase project, Pro
billing, or a real client. Those gate **go-live**, not P7.

---

## 17. Deferred go-live checklist

Controls that cannot honestly be completed yet. Each stays open until executed by
a human against real production infrastructure.

- [ ] Custom domain attached; Cloudflare zone active.
- [ ] Edge security-header mirror live; `curl -I` shows the full set on the custom
      domain; iframe embedding blocked at the perimeter.
- [ ] HSTS `preload` added — **only** once the domain is stable.
- [ ] TLS mode **Full (Strict)**.
- [ ] Cloudflare Managed WAF ruleset enabled (log-then-block after tuning).
- [ ] Bot Fight Mode enabled.
- [ ] Login rate-limit rule live; a scripted login flood is blocked at the edge.
- [ ] Optional geo challenge on `/login` if the client base is Mexico-only.
- [ ] Production Supabase project created, separate from the synthetic dev project.
- [ ] Migrations `0000` → latest applied **in order** to production; RLS coverage
      returns zero rows there; the provisioning gotchas re-verified (all tables
      present, service-role reads work, `profiles.role` accepts both values, anon
      denied everywhere).
- [ ] Suites A–E run **against production** before any client link is issued.
- [ ] Worker environment matrix set for production, including the build-time
      `NEXT_PUBLIC_*` variables; the service-role key stored as an **encrypted**
      secret.
- [ ] CSP `connect-src` confirmed to name the production Supabase ref.
- [ ] Supabase **Pro** activated: leaked-password protection, session controls,
      daily backups + PITR.
- [ ] MFA decision executed for internal accounts.
- [ ] Pro backups verified by an actual restore — not assumed.
- [ ] Uptime Robot monitor confirmed live against the production `/api/health`,
      with the `"supabase":true` keyword alert.
- [ ] `production` branch created, stripped per §13, and made the deploy source.
- [ ] Privacy notice delivered per client; DPA executed where required; the
      per-study personal-data register completed.
- [ ] Incident playbook rehearsed once as a tabletop exercise, including a rotation
      dry run in a non-production project.
- [ ] Real client data never present in the dev/staging project — re-confirmed.

---

*Produced by a read-only inventory. No production infrastructure, Supabase
project, Cloudflare configuration, credential, dataset, migration, test, or
application source file was modified, created, or deleted in producing it.*
