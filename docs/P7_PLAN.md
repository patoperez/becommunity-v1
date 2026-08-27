# P7 — Full hardening, adversarial suites A–E, backups and incident response

> **Execution status (2026-08-23):** this remains the approved plan and its
> evidence tables preserve the planning baseline. Operational completion status
> lives in `docs/CURRENT_STATE.md`. PRs 1-6 are merged; Suite A is green and
> deployed. The next unit is PR 7, `p7f-suites-b-c`. Historical “current” or
> “missing” wording below must not override that operational handoff.

> **Type:** implementation-ready plan produced by a read-only evidence inventory.
> **Evidence date:** 2026-08-22 (local). Live probes returned UTC timestamps of
> `2026-08-23T04:0x`.
> **Status:** approved execution plan. Its original evidence inventory is
> intentionally retained below; use `docs/CURRENT_STATE.md` for live progress.
> Read `CLAUDE.md` and `docs/CURRENT_STATE.md` first; this document does not
> replace them.

---


## 0.1 Migration numbering — `0015` is taken

This plan was written when `0014` was the highest migration in the repository,
and it reserved `0015` for the hardened `audit_log`. **`0015` is no longer
available:** P8.2 used it for `0015_client_lifecycle_and_audit.sql`, the client
archive columns and the bounded `admin_lifecycle_event` table. That table is
P8 *lifecycle* evidence — six administrative actions on clients and client
accounts — and is **not** the P7 audit log, which covers authentication,
every administrative mutation and every import, with retention, an internal
review surface and anomaly queries over it.

The P7 audit-log migration therefore takes **the next available number** at the
time it is written (`0016` as of this correction). Nothing else in this plan
changes, and this note does not resume P7.

## 1. Objective and the three distinct completion states

P7 is the final V2 hardening and go-live-preparedness phase. It adds no product
features. It converts the security posture from *"implemented and documented"* to
*"adversarially proven, observable, and recoverable"*.

The architecture's final gate for P7 is unchanged and is **not** redefined here:

> **All suites A–E green, and backup restore tested.**

Three states must be tracked separately. Conflating them is how a deferred
control becomes a claimed one.

### State 1 — P7 code-complete (implementation-ready)

Everything achievable against synthetic infrastructure is built, merged green,
and proven behaviorally: Suites A, B, C and D green; `suite:e:available` green
while `suite:e:full` stays red with E1 named (§5.1); audit logging live;
application-data export/import parity proven; incident playbook written; release
discipline corrected; compliance structure in place. Every merge reaches the
synthetic beta Worker automatically (§2.1), so "merged green" here means each PR
was reviewed and gated *before* the merge that deployed it.

**This state is reachable now.** It is what the P7 workstreams below deliver.

### State 2 — P7 final acceptance (the architecture gate)

Requires State 1 **plus** the two items that cannot be satisfied without external
prerequisites:

- **Suite E is not green.** E1 (login flood challenged/blocked at the edge)
  cannot execute without a Cloudflare zone. A suite with an unexecutable required
  attack is **red**, not "green with a deferral". Suite E therefore remains red
  until a custom domain exists.
- **Backup restore is not tested.** The application-data export/import parity
  proof (§10) demonstrates logical portability inside one project. It is **not**
  disaster recovery and does not satisfy this gate.

**P7 final acceptance is therefore blocked on external prerequisites** and cannot
be declared at State 1. Reaching State 1 and calling it "P7 complete" would be
exactly the overconfidence `system_context.md` §5 warns against.

### State 3 — Real-client go-live readiness

Requires State 2 **plus** the whole of §17: production Supabase project, Pro
activation, perimeter configuration, privacy/DPA execution, production-branch
cutover, and the suites re-run against production.

**Rule applied throughout this document:** a deferred, blocked, or unexecutable
check is recorded as deferred or red. It is never counted as passed, and no
status table in this plan may report it as green.

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
| Worker (Cloudflare API, read-only list) | script name **`becommunity-v1`**; current 100% version `2a508633-b985-474a-bc2d-e1ddf38a6c79`. **Synthetic-data beta environment**, not the future real-client production environment |
| Migrations | `0000`–`0013` (14 files), 2 rollbacks, 1 coverage SQL |
| Scripts | 40 files in `scripts/` |
| Deterministic suite | `npm test` chains 23 gates |
| CI | none — no `.github/` directory in the repository |
| `npm audit` (once) | **0 critical, 9 high, 3 moderate** |
| `gh` CLI | not installed on this machine |

Two baseline findings:

- **`main` currently deploys the synthetic beta Worker automatically.** PR #29
  was a documentation-only merge at `b529411`; no manual deployment was performed
  for it; shortly afterward Cloudflare created Worker version
  `2a508633-b985-474a-bc2d-e1ddf38a6c79`, which now serves 100% of traffic
  (`0454021a-e307-430b-bb36-27612b5faa0c`, the version `docs/CURRENT_STATE.md`
  records for the P6 closure, immediately precedes it). Treat the current `main`
  integration as **automatically rebuilding and deploying the beta Worker after
  every merge** unless later evidence proves otherwise. See §2.1 and R25.
- `wrangler.toml` on `main` declares `name = "be-community"`. **No Worker by that
  name exists on the account**; the live Worker is `becommunity-v1`. An unmerged
  branch `origin/update_worker_name_to_becommunity-v1` carries the one-line fix.

### 2.1 Deployment reality and the rules it imposes

1. The live Worker is a **synthetic-data beta environment**. It is not the future
   real-client production environment, which does not exist yet (R28).
2. **Merging to `main` currently appears to trigger an automatic Cloudflare
   rebuild and deployment.** Every plan section below assumes this.
3. Therefore **every implementation PR must pass its branch/preview gates and
   receive human approval before merge** — merge is the deploy decision, not a
   step that precedes a separate one.
4. **After each merge, perform one bounded check:** the production-alias health
   endpoint plus the focused smoke check relevant to that PR, then **record the
   merged commit sha and the resulting Worker version id in that PR's
   conversation/release record** — not in a repository file on the
   deploy-triggering branch (§9.2).
5. **Never** use repeated deployment retriggers, burst requests, or load loops to
   observe the result. One bounded pass, then stop.
6. **Changing or disabling the current Git deployment integration is an external
   Cloudflare mutation and is not authorized by this planning task.** It may be
   proposed to the human, never performed by an implementation PR.
7. The `production`-branch cutover (§13, RD4) remains a go-live action. Until it
   happens, `main` is the deploy branch for the beta in practice, whatever the
   documentation previously implied.

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
- **Any best-effort application-layer login throttle built to make Suite E look
  green.** See §15, resolved decision RD2.

### Reconciliation with `BeCommunity_V2_Technical_Architecture.docx`

The architecture document is historical input. Where it conflicts with verified
current decisions, code, or migrations, the current state wins.

| Architecture says | Current verified reality | Resolution |
|---|---|---|
| Kano modelling considered | Consultant's process documentation: *"No se va a utilizar este modelo"* | **Out of scope.** Do not build. |
| In-browser Arquero powers cross-filter and pivot (§2, §5.3) | Production uses the Workers-safe engine in `src/lib/calc/{table,engine,pivot}.ts`; Arquero 8.0.3 is a **dev-only parity oracle** because workerd forbids runtime code generation | **Current wins.** Arquero must never enter production-reachable code; `scripts/workers-runtime-safety-test.mjs` guards this. |
| Role tiers admin / consultant / client (§6.1 Suite A) | Only `internal` and `client` exist (`profiles.role` check constraint, `0000`); within a tenant, `profiles.data_scope` (`0012`) narrows a client user | **Resolved, not pending** — see RD1. Suite A's "consultant sees only assigned tenants" is intentionally out of scope for V2/P7; `data_scope` receives the behavioral substitute coverage (R2). |
| Tenant isolation via `can_access_tenant()` SECURITY DEFINER helpers in a `private` schema (§5.4) | Never built. Policies inline `tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))` | **Current wins** (`AUDIT_V1.md` §2.1). Do not refactor during P7; a policy rewrite is a human-review zone with no security gain. |
| CSP `img-src 'self' data: https:` (§5.2) | App emits `img-src 'self' data: <supabase-origin>` | **Current wins** — strictly narrower. Do not widen to match the document. |
| Backups via "GitHub Action → object storage" (§5.6) | No backup mechanism of any kind exists | One candidate for the *application-data export* only. It is **not** a disaster-recovery mechanism — see §10 and R35. |
| Supabase project is production | The connected project holds **synthetic test data only** and is not the final real-client project | **Current wins.** All P7 work executes against synthetic infrastructure. |
| MFA for internal accounts (§5.5) | Not configured; availability on the current tier unverified | Open decision D3; verify tier availability before promising it. |

### Standing rule on privileged access in gates

`service_role` bypasses RLS and grants. It is acceptable **only** for a narrowly
scoped metadata or RLS-coverage gate — reading catalog state, or seeding and
tearing down fixtures. It is **never** admissible as behavioral evidence for
tenant isolation or authorization. Every Suite A and Suite B assertion must
authenticate as a real synthetic identity using the publishable key.

---

## 4. Requirement-to-evidence matrix

Status vocabulary: **Implemented** (executable or observable proof exists) ·
**Partial** (control exists but its verification is offline/static/manual, or it
covers only part of the requirement) · **Missing** · **Blocked** (external
prerequisite) · **Decision** (needs a human choice before work starts).

Verification vocabulary: **behavioral** (attempts the attack through the real
API/app) · **static** (asserts on source or SQL text) · **live** (touches the
real Supabase project) · **manual** · **absent**.

| ID | Requirement | Status | Repository evidence | Existing verification | Remaining gap | Depends on | Review zone | Safe now? |
|---|---|---|---|---|---|---|---|---|
| R1 | Cross-tenant read/write rejected for an authenticated user | Partial | `scripts/isolation-test.mjs` tests 1–4; `npm run test:isolation`; policies in `supabase/migrations/0000_init_schema_and_rls.sql` | behavioral + live | Not exercised through the **app** routes, only through PostgREST; no assertion that `import_batch` / `import_mapping` / `study_template` stay invisible to a client who legitimately holds a published study | synthetic tenants A/B (already in `.env.local`) | Authorization | Yes |
| R2 | `profiles.data_scope` cannot be bypassed | Missing | Enforcement is app-layer only: `applyDataScope` in `src/lib/studies/scope.ts`, called from `src/lib/studies/authorized.ts:84`; `scripts/data-scope-test.mjs` is a static check | static | No behavioral proof that a scoped client user cannot retrieve out-of-scope rows via the dashboard data action, the PDF route, or PostgREST. Raw-table reads are revoked (`0009`), so the app layer is the **only** enforcement point — it must be proven, not assumed | harness (PR 5) | Authorization | Yes |
| R3 | RLS on every public table, verified before deploy | Partial | `supabase/tests/rls_coverage.sql`; `CLAUDE.md` claims coverage "is tested before every deploy" | manual (SQL editor) | The query is **not executable from a script** — nothing in `package.json` runs it, so the claim overstates current reality. Needs an internal-only reporting function plus a gate script | migration `0014` | Authorization | Yes |
| R4 | Every mutating action/route rejects unauthenticated callers | Missing | Guards exist and are correct: `src/app/admin/clients/actions.ts:18,22`, `admin/qualitative/actions.ts:15,18`, `admin/studies/actions.ts:20,23`, `admin/upload/actions.ts:83,91`, `api/studies/[studyId]/report/route.ts:28`, `dashboard/data-actions.ts:32`, `src/lib/supabase/middleware.ts:81` | **static only** — `scripts/publication-boundary-test.mjs` asserts that the string `auth.getUser()` appears in the sources | No durable HTTP-level suite exists. No script issues a request to the app; the only app-level test (`responsive-layout-test.mjs`) drives an **authenticated** browser | harness (PR 5) | Authorization | Yes |
| R5 | Admin-only actions reject a `client` caller; client-side role tampering changes nothing | Missing | same guards as R4 | absent | Nothing exercises the Lovable-class failure mode at runtime | harness (PR 5) | Authorization | Yes |
| R6 | Zod at every untrusted boundary | Partial | `src/lib/validation/schemas.ts`, `src/lib/studies/scope.ts`, `src/lib/reporting/filters.ts`, `src/lib/ingestion/canonical.ts`, `src/lib/templates/schema.ts`, `src/lib/dashboard/config.ts`; `scripts/validation-test.mjs` (`npm run test:validation`) | offline unit | Schemas are proven in isolation; no proof the **routes** reject the same payloads with a safe status and no error leakage | harness (PR 5) | Secrets/config adjacent | Yes |
| R7 | Free-text XSS renders inert in dashboard and PDF | Missing | No `dangerouslySetInnerHTML` anywhere in `src/` (grep clean); quotes render through escaped JSX text nodes; publication requires `quote_approved` (`src/lib/studies/authorized.ts`) | absent | No end-to-end payload: ingest → triage → confirm → client dashboard → server PDF. The PDF path (`src/lib/reporting/pdf.ts`, pdf-lib) also needs a "hostile text does not corrupt or inject" case | synthetic study | Authorization / output | Yes |
| R8 | Malformed/oversized imports rejected with zero partial writes | Partial | `MAX_UPLOAD_BYTES` + `uploadSchema` (`src/lib/validation/schemas.ts`), `bodySizeLimit: "11mb"` (`next.config.ts`), atomic commit function (`supabase/migrations/0003_universal_ingestion_storage.sql`), `scripts/atomic-ingestion-test.mjs` (offline) and `scripts/atomic-ingestion-live-test.mjs` (`npm run test:atomic-live`) | offline + live | No HTTP-level oversize / wrong-MIME case; no post-failure residue count taken through the real upload path | harness (PR 5) | — | Yes |
| R9 | Pivot intents outside the allowlist are rejected before compute | Partial | Allowlist derivation and re-validation in `src/lib/calc/pivot.ts`; `scripts/pivot-test.mjs` exists | offline, **orphaned** | `scripts/pivot-test.mjs` is wired to **no** npm script and therefore never runs in `npm test`. No forged intent is submitted over the wire | — | — | Yes |
| R10 | Injection strings in filter/report params are parameterized, no error leakage | Missing | `src/lib/reporting/filters.ts`, `src/lib/calc/filters.ts` (`validateSegmentFilters`), PostgREST parameterization | absent | No adversarial parameter probe; no assertion that error responses never echo internals | harness (PR 5) | — | Yes |
| R11 | The artifact the browser/edge receives contains no secret | Partial | `scripts/secret-leak-test.mjs` (`npm run test:secrets`) scans `.next/static` | behavioral on the client bundle | It does **not** scan `.open-next/` — the bundle actually deployed — although `docs/CURRENT_STATE.md` warns that local OpenNext output can inline environment values | `cf:build` output (Linux build if Windows `EPERM`) | Secrets | Yes |
| R12 | `.env` gitignored; no secret in git history | Partial | `.gitignore:36` (`.env*`); `git log --all -- .env .env.local .env.production` returns nothing | manual (re-verified 2026-08-22) | Not automated as a gate; a future accidental commit would not be caught | — | Secrets | Yes |
| R13 | No high/critical dependency vulnerabilities | **Missing — currently failing** | `npm audit`: 0 critical, **9 high**, 3 moderate. High: `next` (middleware/proxy bypass advisory for App Router), `postcss`, `sharp`, `undici`, `nanoid`, `js-yaml`, `brace-expansion`, `miniflare`, `wrangler`; moderate: `@tailwindcss/postcss`, `uuid` (reached through the runtime dep `exceljs`) | absent (no gate) | No audit gate exists, and the current tree would fail one. Each advisory needs reachability analysis; the `next` advisory touches the **middleware auth gate**, a human-review zone | D-none (authorized for preparation; merge and deploy stay human-gated) | Secrets/config | Yes — analysis and remediation prepared in a reviewed PR |
| R14 | Dependencies pinned and provenance-verified | Partial | Runtime deps exact-pinned in `package.json`; `@tailwindcss/postcss`, `tailwindcss`, `eslint`, `typescript`, `@types/*` still use `^` ranges | manual | Range-pinned devDeps contradict the standing pin rule; no automated check | — | — | Yes |
| R15 | Security headers present on responses | Partial | `next.config.ts` static set; nonce CSP in `src/lib/supabase/middleware.ts`; **observed live** on `/login` 2026-08-22 | live, manual, one-off | No committed assertion; a regression would ship silently. The edge mirror is zone-dependent (R27) | — | Secrets/config | Yes |
| R16 | The app cannot be framed | Partial | `X-Frame-Options: DENY` + `frame-ancestors 'none'`, both observed live | live, manual | No committed assertion | — | — | Yes |
| R17 | Expired/invalid/tampered session is rejected and redirected | Missing | `getUser()` revalidation in `src/lib/supabase/middleware.ts:81` and in every protected page | absent | No test forges or expires a cookie and asserts the redirect/401 | harness (PR 5) | Authorization | Yes |
| R18 | Login endpoint rate-limited at the edge | **Blocked** | `docs/GO_LIVE_SECURITY.md` B2 documents the intended Cloudflare rule; nothing is configured | absent | Cloudflare rate-limiting rules require a **zone**; the Worker runs on `*.workers.dev`. Per RD2, no interim app-layer throttle will be built; Supabase Auth's own limits are the only control until a zone exists | custom domain | Authorization | **No** |
| R19 | Audit logging: authentication, admin mutations, imports | Missing | No audit table in any migration; no logger in `src/`. Partial provenance only: `import_batch` / `import_mapping` / `recoding_table` carry `created_by` + `created_at` (`0003`) | absent | The entire detection layer of the five-layer posture is absent. A breach today would be neither noticed nor reconstructable | the next available migration (see §0.1) | Authorization | Yes |
| R20 | Actionable anomaly monitoring and alerts | Missing | `docs/OPERATIONS.md` describes an Uptime Robot monitor on `/api/health`; the health route exists and returns 200 | absent in repo | Uptime Robot configuration is external and unverified from here; there is no denied-action-spike, failed-login-burst, or unusual-import alert. Cloudflare/Supabase anomaly alerting is largely zone/Pro-gated | R19, D2 | — | In-app signals yes; delivery channel per D2 |
| R21 | **Application-data export** mechanism (portability) | Missing | none | absent | No export of any kind exists. This is a useful interim control and a prerequisite for R22 — it is **not** a disaster-recovery backup (see §10) | — | Secrets/config | Yes |
| R22 | **Application-data export/import parity proof** | Missing | none | absent | Proves logical portability of application rows and metric parity after re-import. Does **not** satisfy the architecture's "backup restore tested" gate | R21 | — | Yes (synthetic) |
| R23 | Incident playbook (rotation, revocation, containment, recovery, verification) | Missing | `docs/GO_LIVE_SECURITY.md` covers perimeter setup, not incident response | absent | Must be written before launch. Writing it is safe; **executing** rotation/revocation is not part of P7 | R19, R21, R35 design | Secrets/config | Yes (write only) |
| R24 | `production` branch clean of prompt docs | Missing | `docs/GO_LIVE_SECURITY.md` B3 specifies the intended strategy; no `production` branch exists (31 remote branches, none named `production`) | absent | Per RD4 the branch is created only at the approved go-live transition; P7 delivers the documented procedure and strip list | go-live | — | Procedure yes; branch creation at go-live |
| R25 | Deployment strategy is correct and attributable | Partial | `wrangler.toml` names `be-community`; the live Worker is `becommunity-v1`; `origin/update_worker_name_to_becommunity-v1` carries the fix, unmerged. PR #29 (docs-only) was followed by Worker version `2a508633…` with no manual deploy — **`main` merges deploy the beta automatically** | live, read-only | Two problems. (a) The config names a Worker that does not exist, so an ad-hoc `npm run cf:deploy` from `main` would publish a **second, separate** Worker. (b) Because merge deploys, **merge approval is the deployment decision** and nothing currently ties a running version id back to a commit. **Urgent — PR 2** | — | Secrets/config | Yes |
| R26 | Deterministic gates enforced automatically | Missing | none — no `.github/` | absent | Every gate depends on a human remembering to run it. Per RD3, offline CI is recommended; live credential-bearing suites stay manual | — | — | Yes |
| R27 | Cloudflare perimeter: managed WAF, bot mode, TLS Full (Strict), edge header mirror, geo rules | Blocked | `docs/GO_LIVE_SECURITY.md` B1/B2 | absent | All of it needs a **zone**. `*.workers.dev` has no zone-level WAF, rate limiting, or Transform Rules | custom domain | Secrets/config | No |
| R28 | Separate staging and production Supabase projects | Blocked | `docs/GO_LIVE_SECURITY.md` B4; `docs/OPERATIONS.md` names the single dev project | absent | The production project does not exist. Creating it is explicitly forbidden until approved | D4 | Authorization | No |
| R29 | Supabase Pro activation trigger | Blocked | `docs/GO_LIVE_SECURITY.md` B5; architecture §9.2 | absent | Pro supplies leaked-password protection, session controls and daily backups + PITR. Trigger: **before the first real client receives a link** | D4, billing | — | No |
| R30 | MFA available for internal accounts | Decision | not configured | absent | Confirm availability on the current tier before committing to it | D3 | Authorization | Verification yes; enabling is D3 |
| R31 | Per-study personal-data record, privacy notice, DPA where required | Missing | `docs/PRODUCT_DATA_POLICY.md` covers disclosure control, not the LFPDPPP register | absent | Needs a per-study "what personal data, why" record and client-facing notice text. Structure is buildable now; wording waits on D5 | D5 | — | Structure yes |
| R32 | Data minimization / small-cell suppression | Implemented | `docs/PRODUCT_DATA_POLICY.md` §1 (n<5 suppressed, n<30 cautioned), implemented in `src/lib/calc/disclosure.ts` and exercised by the calculation gates | offline | Add a regression case proving suppression also holds in the **PDF** and after filter combinations that could enable differencing | — | Calculation | Yes |
| R33 | Right to deletion (tenant/study hard-delete, admin-only, audited) | Missing | `deleteClientUser` (`src/app/admin/clients/actions.ts:183`) and `deleteTemplate` (`src/app/admin/studies/actions.ts:124`) exist; **no tenant or study deletion path** | absent | LFPDPPP deletion readiness has no implementation. The DB primitive exists (`on delete cascade` throughout) | R19 (must be audited) | Authorization | Yes (synthetic) |
| R34 | Encryption in transit and at rest | Implemented | HTTPS + HSTS observed live; Supabase-managed encryption at rest | live | Confirm TLS mode **Full (Strict)** at the zone when one exists (folds into R27) | — | — | Yes |
| R35 | **Full project/database disaster recovery, restored into an isolated target and proven** | **Blocked** | none | absent | This is the requirement the architecture's "backup restore tested" gate actually names. Needs an approved database-level dump mechanism and an isolated restore target — neither exists, and this planning task must not request or extract a database password | D1, D4 | Secrets/config | **No** |

### Status counts

| Status | Count | IDs |
|---|---:|---|
| Implemented | 2 | R32, R34 |
| Partial | 11 | R1, R3, R6, R8, R9, R11, R12, R14, R15, R16, R25 |
| Missing | 16 | R2, R4, R5, R7, R10, R13, R17, R19, R20, R21, R22, R23, R24, R26, R31, R33 |
| Blocked on external prerequisite | 5 | R18, R27, R28, R29, R35 |
| Requires a human decision first | 1 | R30 |
| **Total** | **35** | |

R13 is counted once as Missing but is materially worse than the label: the gate
is absent **and** the current dependency tree would fail it today. R18 and R35 are
the two blocked items that keep P7 final acceptance (State 2) out of reach.

---

## 5. Suites A–E coverage matrix

Suite definitions follow the architecture §6.

| Suite | Required check (architecture §6) | Covered today by | Coverage verdict | P7 action | Reachable in State 1? |
|---|---|---|---|---|---|
| **A1** | Tenant A read/write against tenant B via direct API → zero rows / rejection | `scripts/isolation-test.mjs` tests 2 & 3 | **Green (behavioral)** | Keep; fold into `suite:a` | Yes |
| **A2** | Consultant sees only assigned tenants | — no consultant role exists | **N/A — resolved out of scope (RD1)** | Substitute the `data_scope` enforcement test (R2) | Yes |
| **A3** | Admin sees all; anonymous sees nothing | anon covered by `isolation-test.mjs` test 1; "internal sees all" untested | **Partial** | Add an internal-role positive control | Yes |
| **A4** | No public table with `rowsecurity = false` | `supabase/tests/rls_coverage.sql`, manual only | **Partial — claim overstated** | Make it executable (migration `0014` + gate) | Yes |
| **A5** | Cross-tenant `UPDATE` move rejected by `WITH CHECK` | Superseded: `0002` revoked client writes entirely; `isolation-test.mjs` test 4 proves own-tenant writes are denied | **Green, re-expressed** | Assert denial-by-grant **and** that the service-role write path cannot mis-stamp `tenant_id` (composite FKs in `0003`) | Yes |
| **B1** | Every mutating action/route unauthenticated → rejected | static regex assertions only | **Red** | Durable harness suite (§6.1) | Yes |
| **B2** | Admin-only action as a `client` → rejected | — | **Red** | Durable harness suite | Yes |
| **B3** | Tampered client-side role state → still rejected | — | **Red** | Durable harness suite | Yes |
| **C1** | XSS payload in free text renders inert | structural only (no `dangerouslySetInnerHTML`) | **Partial (structural, not behavioral)** | End-to-end payload through dashboard **and** PDF | Yes |
| **C2** | Malformed/oversized import rejected, zero partial writes | `atomic-ingestion-test.mjs` + `atomic-ingestion-live-test.mjs` | **Green at the data layer, Red at HTTP** | Add the HTTP-level case + residue count | Yes |
| **C3** | Pivot intent outside the allowlist rejected before compute | `scripts/pivot-test.mjs` — **not wired to any npm script** | **Partial — orphaned test** | Wire it in; add a forged-intent case through the app | Yes |
| **C4** | Injection strings in search/filter params → parameterized, no error leakage | — | **Red** | New probe | Yes |
| **D1** | Production bundle grep for secret patterns | `scripts/secret-leak-test.mjs` on `.next/static` | **Partial** | Extend to `.open-next/` | Yes |
| **D2** | `.env` gitignored, no secret in git history | manual verification | **Partial** | Automate as a gate | Yes |
| **D3** | `npm audit` clean of high/critical; packages verified | — | **Red, currently failing (9 high)** | Reachability analysis → compatible remediation → gate, all in one PR that merges green | Yes |
| **E1** | Login flood → challenged/blocked at the edge (`suite:e:full` only) | — | **Red — unexecutable without a zone** | **Cannot be made green in State 1.** No substitute control will be built (RD2); the check is recorded as red and keeps `suite:e:full` failing | **No** |
| **E2** | Security headers present | observed once, manually | **Partial** | Committed assertion against the deployed Worker | Yes |
| **E3** | Iframe load blocked | observed once, manually | **Partial** | Committed assertion | Yes |
| **E4** | Expired/invalid session token → rejected, redirected | — | **Red** | New session-resilience case | Yes |

### 5.1 Suite E exit contract — two commands, no ambiguity

"The executable subset passes" and "every merged PR is green" only coexist if the
merge gate and the release-status check are **different commands**. They are:

| Command | Contains | Exit behavior | Role |
|---|---|---|---|
| `npm run suite:e:available` | E2, E3, E4 only | **Must exit 0** for the PR to merge. Prints a prominent banner on every run stating that **this is not the complete Suite E** and naming E1 as blocked | **Merge gate** |
| `npm run suite:e:full` | E1, E2, E3, E4 | **Must exit non-zero** while E1 is blocked, and does so by design, not by accident. It reports E1 as blocked-and-unexecuted, never as skipped or passed | **Release-status command** — not a merge gate until the Cloudflare zone exists |
| `npm run suite:e` | alias of `suite:e:full` | inherits the non-zero exit | Prevents anyone from typing the obvious command and calling the partial suite "Suite E green" |

Rules that follow:

- No document, PR description, handoff entry, or status table may write
  "Suite E green" on the strength of `suite:e:available`.
- `suite:e:full` becomes a merge gate only after the zone exists and E1 executes.
- `npm run gates` includes `suite:e:available`, never `suite:e:full`, so the
  standard gate chain stays green while release status stays honest.

**Suite verdicts at State 1:** A green · B green · C green · D green ·
**E: `suite:e:available` green, `suite:e:full` red with E1 named.** Suite E is
green only when `suite:e:full` exits 0 — at which point State 2 also requires R35.

### Gate reconciliation — current scripts mapped to suites

| Script / npm command | Nature | Suite | Note |
|---|---|---|---|
| `test:isolation` → `isolation-test.mjs` | behavioral, live | **A** | The strongest existing gate. Live-only by necessity; correctly excluded from the offline `npm test` |
| `supabase/tests/rls_coverage.sql` | manual SQL | **A** | Not executable — the "tested before every deploy" claim in `CLAUDE.md` is stale |
| `test:client-boundary`, `test:publication-boundary`, `test:client-preview`, `test:data-scope`, `test:client-admin`, `test:study-config`, `test:tenant-branding`, `test:longitudinal`, `test:narrative-home`, `test:qualitative`, `test:import-center`, `test:templates` | **static** — `readFile` + regex over `src/**` and `supabase/migrations/**` | A/B (nominally) | Useful anti-regression tripwires for structure. **They cannot prove runtime enforcement** and must not be counted as Suite A/B coverage |
| `test:server-pdf` | mixed: reads route source **and** builds a PDF | B/C | Partly static |
| `test:validation` | offline unit | **C** | Schemas only, not routes |
| `test:atomic-ingestion`, `test:atomic-live`, `test:ingestion-core` | offline + live | **C** | Genuine zero-partial-write proof |
| `test:bi-filters` | offline | **C** | Filter logic only |
| `test:secrets` | behavioral on the client bundle | **D** | Misses `.open-next/` |
| `test:calc`, `test:business-calc`, `test:cloudflare-calc`, `test:confirmed-qualitative` | offline correctness | — | Calculation integrity, not a security suite |
| `test:workers-runtime`, `test:workers-ingestion` | offline structural | — | Guards the Arquero / ExcelJS runtime constraints |
| `test:responsive-live` | live browser, **authenticated** | — | Layout only; not an adversarial gate |
| `client-admin-live-test.mjs`, `template-live-test.mjs`, `tenant-branding-live-test.mjs`, `import-center-live-test.mjs`, `qualitative-triage-live-test.mjs` | live via **`service_role`** | — | **These prove the database accepts a privileged write. They prove nothing about authorization.** Keep them as functional tests; never cite them as Suite A/B evidence |
| `pivot-test.mjs` | offline | **C** | **Orphaned** — reachable by no npm script |
| `fase4-realdata-check.mjs`, `fase5-journey-check.mjs`, `ingest-test.ts` | legacy | — | Orphaned V1-era checks; retire or re-home in PR 7 |
| `seed-test-data.mjs`, `seed-journey-demo.mjs`, `cleanup-test-fixtures.mjs` | fixtures | — | Support scripts for the live suites |

**Duplicate coverage.** The static boundary tests overlap heavily — several
re-assert the same `loadAuthorizedStudyData` invariants. They are cheap and are
not the bottleneck: do **not** delete them; stop treating them as suite coverage.

**Stale or overstated claims to correct during P7:**

1. `CLAUDE.md` — "Coverage is tested before every deploy" (R3): true only if a
   human runs the SQL by hand. Fix by making it executable, after which the claim
   holds.
2. `docs/OPERATIONS.md` — the Uptime Robot monitor is described as the operating
   arrangement; it is external and unverified from the repository (R20).
3. `docs/GO_LIVE_SECURITY.md` B3 — describes a `production` branch that does not
   exist (R24).

---

## 6. Design constraints that must be settled before implementation

### 6.1 The adversarial HTTP harness must be durable

Next.js Server Actions are invoked over a private wire protocol: hashed
Next-Action identifiers and an internal serialization format, both of which change
between builds and are not a public contract. **A harness that posts synthesized
action IDs or hand-built RSC payloads is forbidden** — it would be brittle,
would silently start passing for the wrong reason after a build, and would give
false confidence in the exact place where confidence must be earned.

The harness must use one of the following, chosen and **reviewed before any code
is written**:

1. **Real browser interaction through the application's own client runtime** —
   drive the rendered UI so the framework constructs the request itself. Highest
   fidelity; slowest. Precedent exists in `scripts/responsive-layout-test.mjs`,
   which already drives a browser against a running app.
2. **Progressive-enhancement form submission**, but only where a form genuinely
   works without client JavaScript and that behavior is stable. Each such
   endpoint must be verified to degrade, not assumed to.
3. **A deliberately designed stable test seam** — a narrow, explicitly versioned
   entry point that exercises the same server-side authorization path. It must
   **not** weaken production authorization: no bypass, no extra trust, no
   environment flag that could be enabled in production, and it must itself be
   covered by Suite B.

Route handlers (`/api/studies/[studyId]/report`) and page loads are ordinary HTTP
and need none of this — they can be attacked directly today.

**Deliverable before implementation:** a short harness design note appended to
this plan or added as `docs/P7_HARNESS_DESIGN.md`, human-reviewed, naming the
chosen mechanism per endpoint class. PR 5 does not start until it is approved.

### 6.2 Every merged commit must be green

No PR may be merged with a known-failing gate, and no PR may be proposed whose
expected outcome is a red suite on `main`. Where a gate cannot yet pass, the
sequence changes so that the remediation lands with — or before — the gate that
enforces it.

### 6.3 Dependency exception register

If an advisory cannot be removed without breaking compatibility, it may be
excepted **only** through a human-approved register entry recording: package and
version · advisory ID and severity · full dependency path · whether the
vulnerable code is reachable at runtime in the Worker, at build time only, or in
dev tooling only · the compensating control · the approver · and a **review
date**. An exception without all seven fields is not an exception; the gate stays
red and the PR does not merge.

### 6.4 Privilege model for every security-definer helper

PostgreSQL grants `EXECUTE` on a new function to `PUBLIC` by default. A
`security definer` function that is merely "not documented as callable" is
therefore callable by `anon` and `authenticated`. Every such helper introduced by
P7 — the `0014` RLS-coverage reporting function, and any helper added by the
audit-log migration — must carry this exact shape in the same migration that
creates it:

```sql
create or replace function <schema>.<name>(<args>)
returns <type>
language sql
security definer
set search_path = ''
as $$ ... $$;

revoke execute on function <schema>.<name>(<argtypes>) from public, anon, authenticated;
grant  execute on function <schema>.<name>(<argtypes>) to service_role;
```

Requirements:

- The `revoke` and the `grant` name the **fully qualified signature**, including
  argument types — a bare function name does not disambiguate overloads.
- The `revoke` precedes the `grant`, and both live in the **same migration** as
  the `create`, so no window exists in which the default `PUBLIC` grant stands.
- No table-level grants are added for the helper's benefit; it reads catalog or
  internal state under its own definer rights.
- The helper returns **metadata only** (table names, flags, counts). It must never
  return tenant rows, respondent data, or anything that would make it a read
  path around RLS.
- The gate script asserts the privilege model itself: `anon` and `authenticated`
  attempting to execute the function must be **rejected**, and that assertion runs
  as those roles, not as the service role.
- The rollback script drops the function, which removes the grant with it.

---

## 7. Phased workstreams (dependency order)

- **W1 — Urgent correctness of the release path.** Worker identity, then the
  dependency advisory work. Both are live risks that must not wait behind test
  construction, and because merging to `main` deploys the beta (§2.1), both reach
  the running environment as soon as they are approved — which is precisely why
  their pre-merge review matters more than any later PR's.
- **W2 — Verifiability foundations.** Executable RLS coverage; the reviewed,
  durable adversarial harness.
- **W3 — Suites A–C.** Isolation and `data_scope`; then authorization, input,
  injection, upload and pivot boundaries.
- **W4 — Suite E, executable subset.** Headers, frame denial, session resilience.
  E1 stays red and blocked.
- **W5 — Detection.** Hardened audit logging, then anomaly signals and alerting.
- **W6 — Portability and recovery.** Application-data export and parity proof;
  incident playbook; the design (not execution) of full disaster recovery.
- **W7 — Compliance readiness.** Personal-data register, audited deletion,
  suppression regression.
- **W8 — Closure.** State-1 declaration, honest gate status, deferred checklist.

W2 gates W3 and W4. W5 gates the recovery content of W6. W1 and W7 are
independent.

---

## 8. Proposed PR sequence

Eleven implementation PRs plus a closure PR. Consolidation is by risk boundary:
test-only work is grouped, while authorization, migrations, secrets/config, audit
logging, backup/restore and dependency upgrades each stay independently
reviewable.

**Merge is deployment.** Per §2.1, merging any of these PRs to `main` currently
rebuilds and deploys the synthetic beta Worker. Every row therefore requires
branch/preview gates plus human approval **before** merge, and one bounded
post-merge health-and-smoke pass with the resulting version id recorded in that
PR's own conversation/release record (§9.2). Test-only PRs still deploy — a merge
that changes no runtime code still produces a new Worker version, exactly as PR
#29 did.

| PR | Branch | Title | Contents | Human-review zone | Merges green? |
|---:|---|---|---|---|---|
| **1** | `docs/p7-evidence-plan` | docs: P7 evidence inventory and implementation plan | **This document only.** No code, tests, migrations, or config | — | n/a |
| **2** | `p7a-worker-identity` | fix(deploy): correct the Worker identity and document beta deployment discipline | `wrangler.toml` → `becommunity-v1`, superseding `origin/update_worker_name_to_becommunity-v1`; `docs/DEPLOYMENT.md` deploy/rollback procedure, the post-merge record template, and the rule that the commit-sha → version-id mapping is recorded in the PR record rather than in a repository file (§9.2); the documented `production`-branch procedure and strip list (branch created only at go-live, RD4); `docs/DEPLOYMENT.md` corrected to describe the automatic `main` → beta deployment as it actually behaves. **Configuration-only in source, but merging it may automatically rebuild and deploy the beta Worker** — so it requires pre-merge review and post-merge version/health verification | **Yes — secrets/config** | Yes |
| **3** | `p7b-supply-chain` | fix(deps): analyse and remediate dependency advisories, add the supply-chain gate | Per-advisory reachability analysis (runtime-in-Worker / build-only / dev-only) with the dependency path recorded; compatible remediation; any residual advisory carried as a §6.3 register entry; **then** `scripts/suite-d-supply-chain.mjs` wired in (audit threshold, git-history env scan, secret scan extended to `.open-next/`); offline CI workflow running the deterministic gates (RD3). Full regression suite on the branch. **Because merge deploys the beta, the pre-merge review is the deployment authorization**; the post-merge bounded health-and-smoke pass and version-id record are mandatory for this PR in particular, since it changes the dependency tree the Worker is built from | **Yes — secrets/config** | Yes — gate and remediation land together |
| **4** | `p7c-rls-coverage-gate` | feat(security): make RLS coverage executable | migration `0014` — an internal-only reporting function over the catalog (`security definer`, `search_path = ''`) with the exact privilege model in §6.4, i.e. `revoke execute … from public, anon, authenticated;` followed by `grant execute … to service_role;` and no table grants; `scripts/rls-coverage-test.mjs` invoking it with the narrowly scoped service role (permitted per §3, metadata only); rollback `0014_*.sql`; correct the stale `CLAUDE.md` claim | **Yes — authorization** | Yes |
| **5** | `p7d-adversarial-harness` | test(p7): add the reviewed adversarial HTTP harness | `docs/P7_HARNESS_DESIGN.md` (approved per §6.1) and `scripts/lib/http-harness.mjs`: attach to an app origin, sign in as the synthetic A / B / internal identities, carry cookies, forge and expire them. No hashed action IDs, no hand-built wire payloads. No assertions of its own | Authorization | Yes |
| **6** | `p7e-suite-a` | test(security): complete Suite A | `scripts/suite-a-isolation.mjs` — absorbs `isolation-test.mjs`, adds `data_scope` bypass attempts (dashboard path, PDF route, PostgREST), an internal-role positive control, and a service-role tenant-stamping proof. All assertions authenticate as real identities | **Yes — authorization** | Yes |
| **7** | `p7f-suites-b-c` | test(security): add Suites B and C | `scripts/suite-b-authorization.mjs` (every admin mutation and the report route, unauthenticated and as `client`; role tampering) and `scripts/suite-c-input.mjs` (XSS payload end-to-end into dashboard HTML **and** the generated PDF; oversize/corrupt upload with a residue count; forged pivot intent; parameter-injection probes). Wires `pivot-test.mjs` in as `test:pivot`; retires or re-homes the orphaned V1-era scripts | **Yes — authorization** | Yes |
| **8** | `p7g-suite-e-split` | test(security): add Suite E as `suite:e:available` and `suite:e:full` | `scripts/suite-e-edge.mjs` against the deployed beta Worker, exposed through the three commands in §5.1: `suite:e:available` (E2–E4, exits 0, prints the "not the complete Suite E" banner), `suite:e:full` (adds E1, exits non-zero while blocked), and `suite:e` aliasing `suite:e:full`. `npm run gates` picks up `suite:e:available` only | **Yes — authorization** | Yes — the merge gate is `suite:e:available` |
| **9** | `p7h-audit-log` | feat(security): add hardened audit logging | the next available migration (§0.1) — `audit_log` per §11; `src/lib/audit/log.ts`; instrumentation of login/logout, all admin mutations, and import commit/rollback; internal-only review surface; retention job; rollback script | **Yes — authorization** | Yes |
| **10** | `p7i-anomaly-signals` | feat(ops): add anomaly signals and alert delivery | Bounded, indexed queries over `audit_log` (failed-login bursts, denied-action spikes, cross-tenant probes, unusual import volume), internal review surface, and the delivery channel chosen in D2; `docs/MONITORING.md` | Authorization | Yes |
| **11** | `p7j-data-portability` | feat(ops): add application-data export and import-parity proof | `scripts/data-export.mjs` and `scripts/import-parity-verify.mjs` per §10.1; `docs/DATA_PORTABILITY.md` stating in its first paragraph that this is **not** disaster recovery. Names the R35 gap explicitly | **Yes — secrets/config** | Yes |
| **12** | `p7k-incident-playbook` | docs: add the incident playbook and the disaster-recovery design | `docs/INCIDENT_PLAYBOOK.md` (§12) plus the §10.2 disaster-recovery **design**: mechanism, isolated target, verification steps, and the approvals required. Written, never executed; no database credential is requested or used | **Yes — secrets/config** | Yes |
| **13** | `p7l-compliance-readiness` | feat(compliance): personal-data register and deletion readiness | Per-study personal-data record; audited tenant/study hard-delete (internal-only, logged to `audit_log`); suppression regression in the PDF path; `docs/DATA_PROTECTION.md` structure with D5's wording left as a marked placeholder | **Yes — authorization** | Yes |
| **14** | `p7z-state-1-closure` | docs: declare P7 code-complete and record the blocked acceptance gate | Suite results with Suite E recorded **red**; parity-proof record; `docs/CURRENT_STATE.md` updated to say **State 1 reached, State 2 blocked**; the §17 checklist | — | Yes |

---

## 9. Verification gates and rollback per PR

### 9.1 Pre-merge gates

**Every** PR runs on its branch, and must pass, **before** merge — because merge
deploys the beta (§2.1):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Additional, per PR:

| PR | Additional required gates |
|---:|---|
| 2 | `wrangler deployments list --name becommunity-v1` (read-only) confirms the identity the config now names; the documented deploy/rollback procedure reviewed. **Merging deploys the beta**, so the pre-merge review is the deployment authorization; post-merge, one bounded `/api/health` + `/login` check and the new version id recorded in the PR record |
| 3 | Reachability analysis reviewed per advisory; `npm run suite:d` **green** at merge (or every residual advisory carried by a complete §6.3 register entry); `npm run gates`; suites re-run on the branch; CI workflow green on the PR itself. Post-merge, one bounded `/api/health` + `/login` smoke check and the new version id recorded in the PR record — mandatory here because this PR changes the dependency tree the Worker is built from |
| 4 | `npm run test:rls-coverage` returns zero uncovered tables; `npm run test:isolation` still green; the rollback script applied and re-applied once on the synthetic project; **the §6.4 privilege model verified behaviorally** — `anon` and `authenticated` attempting `execute` on the new function are rejected, asserted while authenticated as those roles, not as the service role |
| 5 | Harness design note approved **before** implementation; harness self-test against a running app; explicit check that no hashed action ID or private wire payload is constructed; `npm run test:secrets` |
| 6 | `npm run suite:a`; `npm run test:isolation`; `npm run test:client-boundary`, `test:publication-boundary`, `test:data-scope` |
| 7 | `npm run suite:b` and `npm run suite:c` against a local build **and** once against the deployed Worker; `npm run test:pivot` (newly wired); `npm run test:atomic-live`; post-run residue count = 0 |
| 8 | `npm run suite:e:available` exits **0** and prints its "not the complete Suite E" banner; `npm run suite:e:full` exits **non-zero** and names E1 as blocked-and-unexecuted; `npm run suite:e` confirmed to alias `suite:e:full`; `npm run gates` confirmed to include only `suite:e:available`. Both exit contracts reviewed so a blocked check can never be mistaken for a pass |
| 9 | `npm run suite:a` + `suite:b` (audit writes must not open a read path); `npm run test:isolation`; `anon` and `authenticated` confirmed to hold zero privileges on `audit_log`; retention job exercised; a simulated failed-login flood confirms the write-amplification control (§11) holds; a forced audit-write failure confirms legitimate operations still succeed |
| 10 | Signals reproduced from seeded synthetic audit rows; query plans bounded; no client-visible surface added |
| 11 | Export → re-import into a fresh synthetic tenant → recomputed metrics match the source study exactly → fixture teardown verified; the documentation's non-DR disclaimer reviewed |
| 12 | Documentation review only; no command in the playbook is executed; no database credential requested |
| 13 | `npm run suite:a` + `suite:b`; deletion path exercised on a throwaway synthetic tenant only; audit entries confirmed |
| 14 | `npm run gates`; suites A–D green; `suite:e:available` green and `suite:e:full` red with E1 named; parity proof re-read for accuracy; the final beta version id recorded as the State-1 milestone baseline (§9.2) |

Standing rules: never alter an expected calculation to make a test green; never
mark an unexecuted check as passed; never insert acceptance rows by hand to
bypass the real workflow.

### 9.2 Post-merge verification (every PR, because merge deploys)

One bounded pass, then stop:

1. `GET /api/health` on the production alias → expect `200 {"supabase":true}`.
2. The focused smoke check for that PR's surface (for most PRs, `/login` returning
   200 with the full header set; for PR 3, additionally that the app still boots
   under the changed dependency tree).
3. Record the resulting Worker version id alongside the merged commit sha — **in
   that pull request's conversation or release record, not in a repository file
   on the deploy-triggering branch.**

**Where the record lives, and why it is not `docs/CURRENT_STATE.md` per merge.**
Because merging to `main` deploys (§2.1), committing every post-merge version id
into a tracked file recurses: merge produces version A → a commit records A →
that documentation merge deploys and produces version B → the recorded value is
already stale. The rule is therefore:

- **`docs/CURRENT_STATE.md` records milestone/baseline deployments only** — phase
  closures and release baselines — and states explicitly that version ids are not
  permanent identifiers. It is not a per-merge deployment log.
- **Every ordinary merge's commit-sha → Worker-version mapping is recorded outside
  the deploy-triggering branch**, in the merged PR's conversation/release record,
  using the post-merge record template in `docs/DEPLOYMENT.md`.
- **The State-1 closure PR (PR 14) may update the milestone baseline once**,
  accepting that its own documentation merge can produce a later, code-identical
  Worker version. That is the accepted, bounded cost of having a baseline at all.
- **Never create a follow-up documentation merge whose only purpose is to record a
  Worker version.** It deploys, so it invalidates the very value it records.

**Forbidden:** repeated deployment retriggers, burst request loops, load tests, or
polling the deployment API in a loop. If the bounded pass fails, roll back per
§9.3 rather than re-running it.

### 9.3 Rollback and recovery per mutation

| Mutation | Rollback |
|---|---|
| Any merged PR (all of them deploy) | Revert the merge commit on `main` and let the integration deploy the reverted tree; **or**, if the running Worker must be corrected faster than a rebuild allows, redeploy the previously recorded version id. Both require the version ids from §9.2 to have been recorded — which is why recording them is a gate, not a nicety |
| PR 2 — Worker identity | Configuration revert. If the corrected name were ever to target the wrong script, redeploy the last known-good version id and revert the commit |
| PR 3 — dependency remediation | Revert the commit together with `package-lock.json`; the previous lockfile is the rollback artifact. Verified by re-running the full suite and one bounded health pass |
| Migration `0014` (RLS coverage function) | `supabase/rollbacks/0014_drop_rls_coverage_fn.sql`. Dropping the function removes its `service_role` grant with it; the function is metadata-only and grantless to the API roles, so nothing else changes |
| The `audit_log` migration (§0.1) | A matching `supabase/rollbacks/<n>_drop_audit_log.sql`, numbered to match. Instrumentation sits behind `src/lib/audit/log.ts`, so reverting the app code alone stops writes without a schema change |
| Data export runs (§10.1) | Read-only against the database; the only artifact is a local file. No rollback needed |
| Import-parity proof (§10.1) | Imports into a **brand-new synthetic tenant**, never over existing rows. Teardown deletes exactly the fixture ids it created. The P6E acceptance study `ad275928-dbd1-4acf-9de9-fa1623b32a60` and the two draft `Satisfacción 2026 (TEST)` studies are out of bounds |
| Audited hard-delete path (PR 13) | Exercised only on a throwaway synthetic tenant. There is no undo for a hard delete — that is the point of it — so the gate is fixture isolation, not rollback |
| The Cloudflare Git integration itself | **Not touched.** Changing or disabling it is an external mutation outside this plan's authorization (§2.1 rule 6) |
| Supabase project, keys, or perimeter configuration | **Not touched** during P7 implementation. Deferred to §17 under human execution |

---

## 10. Backup: two distinct proofs

The architecture's gate says *"backup restore tested"*. That means disaster
recovery. The two proofs below are **not** interchangeable, and only the second
satisfies the gate.

### 10.1 Application-data export/import parity — executable now (R21, R22)

**What it is.** A service-role logical export of the public application tables
over the existing API, and a re-import into a fresh synthetic tenant with metric
parity verified by the canonical engine.

**What it explicitly does NOT preserve or restore:**

- Supabase **Auth identities** (`auth.users`, credentials, refresh tokens);
- **schema, functions, triggers, grants and RLS policies** — the export carries
  rows, not the structures that protect them;
- **storage objects**, if and when the branding/logo bucket holds anything that
  matters;
- **project configuration** (auth settings, URL allow-lists, rate limits);
- **encrypted secrets** and Worker environment variables.

Restoring rows into a new tenant **inside the same project** proves logical
import portability. It proves nothing about recovery from project loss,
compromise, or accidental deletion — the source project is still there,
supplying every structure the restored rows depend on.

**Mechanism.** `scripts/data-export.mjs` reads every public table in dependency
order (`tenant` → `profiles` → `study` → `respondent` → `quant_response` →
`qual_observation` → `segment_dimension` → `journey_definition` →
`import_mapping` → `recoding_table` → `import_batch` → `study_template`),
paginating deterministically, writing NDJSON plus a manifest with per-table row
counts, a content checksum, the schema version (highest applied migration), the
export timestamp and the project ref. **The manifest never records keys.** Output
goes to an operator-chosen local path, is not committed, and the `.gitignore`
entry lands with the script.

**Parity proof.** `scripts/import-parity-verify.mjs` creates a new synthetic
tenant and study id, replays the export with consistent id remapping, then
verifies: row counts match the manifest; every foreign key resolves; and the
canonical engine recomputes **identical** metric values for the re-imported study
as for the source, using the existing calculation gates. Record source id,
target id, counts, parity result, timestamps and operator. Tear the fixture down
and verify the teardown. The P6E acceptance study
`ad275928-dbd1-4acf-9de9-fa1623b32a60` and the two draft `Satisfacción 2026 (TEST)`
studies are out of bounds.

**Value.** Real and worth having now: it protects against application-level data
corruption, gives the incident playbook something concrete to invoke, and proves
the import path works. It is an **interim control**, not the acceptance artifact.

### 10.2 Full project/database disaster recovery — blocked (R35)

**What the gate actually requires.** A database-level dump that captures schema,
functions, triggers, policies, grants and data, plus a documented path for Auth
identities, storage objects and project configuration — restored into an
**isolated target** (a separate project or instance), with the restored system
verified by running the isolation and calculation gates against it.

**Why it is blocked.** It needs (a) an approved database-level access mechanism
and (b) an isolated restore target. Neither exists. **This planning task must not
request, extract, or store a database password**, and no P7 implementation PR may
do so either — that is a human-executed credential handling step.

**Deliverable in P7 (PR 12):** the *design* only — mechanism options, the
isolated-target requirement, the exact verification steps, the credential-handling
boundary, and the approvals needed (D1, D4). Execution moves to §17.

**Long-term answer.** Supabase Pro daily backups + PITR (R29), verified by an
actual restore rather than assumed. The §10.1 export remains as an independent
cross-check afterwards.

---

## 11. Audit logging and alerting design boundaries

### 11.1 `audit_log` requirements (the next available migration, §0.1)

Append-only. Columns: `id`, `occurred_at`, `actor_user_id` (nullable for
anonymous attempts), `actor_role`, `tenant_id` (nullable for internal-scope
actions), `action` (enumerated, not free text), `target_type`, `target_id`,
`outcome` (`allowed` / `denied` / `error`), `metadata` jsonb, `request_ip`,
`user_agent`.

Mandatory design requirements — each is a review checkpoint, not a suggestion:

1. **No client-readable access.** RLS forced. **No grants of any kind to `anon`
   or `authenticated`.** Reads happen only through an internal-role server path;
   writes only via the service role. Adding the table must not widen the client
   read surface, and PR 9 re-runs Suites A and B to prove it.
2. **Any security-definer helper follows §6.4 exactly** — fully qualified
   signature, `revoke execute … from public, anon, authenticated;` then
   `grant execute … to service_role;`, both in the creating migration, with
   `search_path = ''` and no table grants. The gate asserts the revocation
   behaviorally, as `anon` and `authenticated`.
3. **Bounded retention.** A defined retention window with a scheduled purge, and
   the window documented in `docs/DATA_PROTECTION.md`. An unbounded audit table is
   both a cost problem and a personal-data problem.
4. **Metadata schema validation and size limits.** `metadata` is validated
   against a Zod schema at the write boundary and rejected if it exceeds a fixed
   byte ceiling; a database-level `check` enforces the ceiling independently.
   Only identifiers, counts and enumerated reasons — never free-form payloads.
5. **Never logged:** passwords, tokens, cookies, API keys, session identifiers,
   full request bodies, uploaded file contents, or respondent free-text.
6. **`request_ip` and `user_agent` are personal data.** They are recorded because
   they are needed for detection, and are therefore subject to the same retention
   window, access restriction, deletion path and register entry as any other
   personal data. Truncation or hashing of the IP must be evaluated in review
   against the detection value it would cost.
7. **Indexes and bounded queries.** Indexes on `(occurred_at)`,
   `(actor_user_id, occurred_at)`, `(tenant_id, occurred_at)` and
   `(action, outcome, occurred_at)`. Every read path — the internal surface and
   every anomaly signal — is time-bounded and row-limited. No unbounded scans.
8. **Failure behavior must not break legitimate operations.** An audit-write
   failure must never abort a successful login, a valid admin mutation, or a
   committed import. Failures degrade: the operation proceeds, the failure itself
   is surfaced as a health signal. Conversely, an audit-write failure must never
   silently convert a denied action into an allowed one — denial is decided before
   logging, never by it.
9. **Write-amplification control.** Failed-login and denied-action traffic is
   attacker-controlled and could otherwise be used to inflate the table without
   limit. Required: per-actor and per-IP coalescing within a short window
   (increment a count on an existing row rather than inserting a new one), a hard
   per-window insert ceiling, and an overflow marker row so the suppression is
   itself visible. This must be exercised by a simulated flood in PR 9's gates.
10. **Append-only in practice.** No update or delete grants beyond the retention
    purge, which runs as a named, reviewed job.

### 11.2 What is logged

Authentication events (login success, login failure, logout, session rejection);
administrative mutations (client/user create, invite, delete, data-scope change,
study create/configure/publish/archive, template create/delete, branding change);
imports (analyze, preview, commit, rollback, with batch id and row counts); and
audited deletions (R33).

### 11.3 Alerting boundaries

Without a zone and without Pro, the realistic detection surface is what the
application itself observes. P7 builds signals **over `audit_log`** — failed-login
bursts per actor and per IP, denied-action spikes, cross-tenant probe attempts,
out-of-hours administrative mutations, anomalous import volume — surfaced on an
internal review page and delivered through the channel chosen in D2.
Cloudflare-native anomaly alerting, Logpush, and Supabase alert rules are recorded
as **deferred** (R27/R29), never claimed. The existing Uptime Robot keyword
monitor on `/api/health` remains the availability alert; its configuration is
verified by the human at go-live rather than asserted here.

---

## 12. Incident playbook deliverables

`docs/INCIDENT_PLAYBOOK.md` (PR 12) — written before launch, executed never
during P7:

1. **Severity classification** — suspected cross-tenant exposure, credential
   compromise, secret exposure, data loss or corruption, availability loss.
2. **Detect** — `audit_log` queries, Worker logs, Supabase auth logs, the health
   monitor.
3. **Contain** — take the app offline at the Worker; disable the affected account;
   state honestly what containment is impossible without a zone.
4. **Rotate** — the exact order for rotating the service-role key, the publishable
   key, and the Cloudflare build/runtime variables, including the rebuild step
   required because `NEXT_PUBLIC_*` values are inlined at build time.
5. **Revoke** — invalidate refresh tokens and force re-authentication; note what
   requires Pro session controls.
6. **Recover** — two clearly separated paths: the §10.1 export for
   application-data corruption, and the §10.2 disaster-recovery procedure for
   project loss, with the latter marked **blocked until D1/D4 are approved**.
7. **Verify** — re-run suites A–D and the isolation gate before declaring
   recovery; `suite:e:available` is the most that can be verified without a
   zone, and `suite:e:full` will still exit non-zero — that is expected, not a
   sign the recovery failed.
8. **Communicate** — who is told, in what order, and the LFPDPPP notification
   considerations.
9. **Post-incident** — write the timeline, add the regression test that would have
   caught it.

Every rotation and revocation step is a **human-executed** runbook entry. P7 does
not rotate, revoke, or rehearse rotation against live credentials.

---

## 13. Production branch and deployment strategy

**Current reality.** `main` is wired to a Cloudflare Git integration that
**rebuilds and deploys the synthetic beta Worker automatically after every
merge** — PR #29, a documentation-only change, produced Worker version
`2a508633…` with no manual deploy (§2.1). There is no CI on pull requests, no
`production` branch, and `wrangler.toml` names a Worker that does not exist on the
account. Deployment entries show `Source: Unknown (deployment)`, so nothing ties a
running version back to a commit.

**Target state:**

1. `wrangler.toml` names `becommunity-v1` (**PR 2, first implementation PR**), so
   any ad-hoc `cf:deploy` targets the real beta Worker instead of silently
   creating a second one.
2. **Merge to `main` is the deployment decision.** Every implementation PR
   therefore carries its full branch/preview gates and explicit human approval
   *before* merge. There is no separate "deploy step" to review later, and no PR
   — dependency remediation included — is auto-merged.
3. **After every merge**, one bounded post-merge pass per §9.2: production-alias
   health, the focused smoke check, and the resulting Worker version id recorded
   alongside the commit sha **in that PR's conversation/release record** — not in
   a tracked file on the deploy-triggering branch, which would recurse (§9.2).
   `docs/CURRENT_STATE.md` keeps milestone/baseline deployments only. That record
   is what makes "redeploy version X" a real rollback rather than archaeology.
4. **No retrigger loops.** One bounded verification pass per merge. If it fails,
   roll back per §9.3.
5. **The Git integration itself is not modified.** Changing, disabling, or
   re-pointing it is an external Cloudflare mutation outside this plan's
   authorization; it may be proposed to the human, never performed by a PR.
6. The Worker being deployed is the **synthetic-data beta**, not the future
   real-client production environment (R28). `production` remains the eventual
   deploy branch, **created only at the approved go-live transition** (RD4),
   stripped of `CLAUDE.md`, `AGENTS.md`, `system_context.md`, `AUDIT_V1.md`,
   `docs/FASE_*.md`, `docs/P0_PLAN.md`, `docs/P7_PLAN.md`,
   `docs/P7_HARNESS_DESIGN.md` and `docs/GO_LIVE_SECURITY.md`. All of `src/**` is
   kept intact, code comments included. Until that cutover, `main` is in practice
   the beta's deploy branch, whatever earlier documentation implied.
7. CI (RD3): a GitHub Actions workflow runs `typecheck`, `lint`, `test`, `build`
   and the deterministic offline suites on every PR, landing with PR 3. This
   matters more than it would in a manual-deploy world — with merge-deploys, the
   pull request is the last gate before the beta changes. Live,
   credential-bearing suites stay manual; putting synthetic identity credentials
   into CI would create a new secret-handling surface for no gain.

---

## 14. Executable now vs blocked on an external prerequisite

### Executable now, against synthetic infrastructure (delivers State 1)

R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R19,
R20 (in-app signals), R21, R22, R23, R25, R26, R31 (structure), R32, R33 — that
is **PRs 2–13**.

This covers Suites A–D in full, the executable subset of Suite E, audit logging,
application-data portability with a parity proof, the incident playbook, release
discipline, and compliance structure.

**It does not deliver State 2.** Suite E stays red because E1 cannot run, and the
architecture's backup-restore gate stays unmet because R35 is blocked.

### Blocked on an external prerequisite

| Blocked item | Prerequisite | Consequence |
|---|---|---|
| **R18 / E1** — login flood blocked at the edge | **Custom domain / Cloudflare zone** | **`suite:e:full` stays red; P7 final acceptance (State 2) is blocked.** No substitute throttle will be built (RD2) |
| **R35** — full project/database disaster recovery proof | **Approved DB-level access mechanism + isolated restore target** (D1, D4) | **The architecture's "backup restore tested" gate is unmet; State 2 is blocked.** §10.1 does not substitute |
| R27 — WAF, bot management, edge header mirror, TLS Full (Strict), geo rules | the same zone | Perimeter checks deferred; the in-app header set is already live and will be asserted |
| R28 — staging/production Supabase split | **Production Supabase project** (creation is human-gated) | The staging-first migration rule formally activates then; P7 must not create it |
| R29 — Pro: leaked-password protection, session controls, daily backups + PITR | **Billing decision (D4)** | Trigger stays "before the first real client receives a link" |
| R30 — MFA for internal accounts | tier verification + D3 | Not claimed until verified |
| R31 wording — privacy notice / DPA text | **Legal input (D5)** | P7 delivers the register structure, not the legal language |
| HSTS `preload` | a stable custom domain | Deliberately not set; adding it is hard to reverse |

**None of these may be marked complete because a document describes them.**

---

## 15. Decisions

### Resolved — treat as settled, do not reopen

| # | Resolved decision |
|---|---|
| **RD1** | The consultant role described in the architecture does not exist and is **intentionally out of scope for V2 and P7**. Roles remain `internal` and `client`. Suite A2 is recorded as N/A; `profiles.data_scope` receives the behavioral substitute coverage (R2). |
| **RD2** | **No in-memory or best-effort application login throttle will be built** merely to turn Suite E green. Until a zone-backed control is approved, Supabase Auth's own limits are the control, and E1 stays explicitly blocked and red. |
| **RD3** | **Offline CI is adopted** for the deterministic gates (`typecheck`, `lint`, `test`, `build`, offline suites), landing with PR 3. Live, credential-bearing suites remain manual. |
| **RD4** | The **`production` branch is created only at the approved go-live transition**. P7 delivers the procedure and strip list, not the branch. |

### Open — human decision required

| # | Decision | Needed before | Note |
|---|---|---|---|
| **D1** | Full backup mechanism and isolated restore target for R35 — which database-level dump path, and what the restore target is | PR 12 design review; execution at go-live | Requires credential handling that only a human performs. The §10.1 export is the interim control meanwhile |
| **D2** | Delivery channel for anomaly alerts | PR 10 | Prefer what already exists; do not add infrastructure for convenience |
| **D3** | MFA for internal accounts — verify availability on the current tier, then decide | before go-live | Verify first; promise it in no document until verified |
| **D4** | Create the production Supabase project and activate Pro | go-live | Trigger remains: before the first real client receives a link. Also unblocks R29 and part of R35 |
| **D5** | Privacy notice and DPA wording; retention periods per study (including the `audit_log` window and IP/user-agent treatment) | PR 13 / go-live | Legal input required; P7 ships the structure with marked placeholders |

Dependency remediation (R13) is **authorized for preparation** in a reviewed PR.
It is not authorized for automatic merge. Because merging to `main` deploys the
synthetic beta (§2.1), the human merge approval **is** the deployment
authorization — which is why the reachability analysis and the full branch gates
must be reviewed before it, not after.

---

## 16. Definition of done

### 16.1 State 1 — P7 code-complete (the target of this plan)

1. Suites **A, B, C and D** exist as committed, repeatable, behavioral gates and
   all pass.
2. **`npm run suite:e:available` exits 0** with its "not the complete Suite E"
   banner, and **`npm run suite:e:full` exits non-zero** naming E1 as
   blocked-and-unexecuted. Suite E is *not* green; it is honestly split.
3. `npm audit` reports no high or critical vulnerabilities, or every residual one
   carries a complete §6.3 register entry. Every merged commit is green.
4. The Worker identity is correct; the deploy path is documented **as it actually
   behaves** (merge to `main` deploys the beta), and every merged commit has its
   resulting Worker version id recorded per §9.2 — in that PR's record, with
   `docs/CURRENT_STATE.md` holding milestone baselines only.
5. `audit_log` meets every requirement in §11.1, captures the §11.2 events, and
   demonstrably did not widen the client read surface.
6. Anomaly signals exist over that log and reach a human through a chosen channel.
7. Application-data export and import-parity proof exist and are recorded, with
   their non-DR status stated in the documentation itself.
8. `docs/INCIDENT_PLAYBOOK.md` exists and is reviewed, including the R35 design
   marked blocked.
9. Deletion readiness and the personal-data register structure exist for LFPDPPP.
10. `npm run gates` is green (it includes `suite:e:available`, never
    `suite:e:full`); `docs/CURRENT_STATE.md` records **State 1 reached, State 2
    blocked**, naming R18/E1 and R35 as the blockers, and carries the State-1
    **milestone baseline** — the Worker version id and the commit that produced
    it, marked as a non-permanent identifier, updated this once and never
    maintained per merge (§9.2).

### 16.2 State 2 — P7 final acceptance (architecture gate, currently blocked)

State 1, **plus**:

11. A Cloudflare zone exists, the edge rate-limit rule is live, and **`npm run
    suite:e:full` exits 0** because E1 actually executes and passes — at which
    point `suite:e:full` also becomes a merge gate.
12. A **full project/database disaster recovery** has been performed into an
    isolated target and verified by running the isolation and calculation gates
    against the restored system (R35).

Until 11 and 12 both hold, P7 is not accepted, regardless of how much of State 1
is complete.

### 16.3 State 3 — go-live readiness

State 2, plus every item in §17.

---

## 17. Deferred go-live checklist

Controls that cannot honestly be completed yet. Each stays open until executed by
a human against real production infrastructure. Items marked **[gates State 2]**
also block P7 final acceptance, not merely go-live.

- [ ] Custom domain attached; Cloudflare zone active. **[gates State 2]**
- [ ] Login rate-limit rule live; E1 executes and passes so `npm run suite:e:full`
      exits 0 and becomes a merge gate. **[gates State 2]**
- [ ] Full project/database disaster recovery performed into an isolated target
      and verified by the isolation and calculation gates. **[gates State 2]**
- [ ] Edge security-header mirror live; `curl -I` shows the full set on the custom
      domain; iframe embedding blocked at the perimeter.
- [ ] HSTS `preload` added — **only** once the domain is stable.
- [ ] TLS mode **Full (Strict)**.
- [ ] Cloudflare Managed WAF ruleset enabled (log-then-block after tuning).
- [ ] Bot Fight Mode enabled.
- [ ] Optional geo challenge on `/login` if the client base is Mexico-only.
- [ ] Production Supabase project created, separate from the synthetic dev project.
- [ ] Migrations `0000` → latest applied **in order** to production; RLS coverage
      returns zero rows there; the provisioning gotchas re-verified (all tables
      present, service-role reads work, `profiles.role` accepts both values, anon
      denied everywhere).
- [ ] Suites A–D and `suite:e:full` run **against the production project and
      domain** before any client link is issued.
- [ ] Worker environment matrix set for production, including the build-time
      `NEXT_PUBLIC_*` variables; the service-role key stored as an **encrypted**
      secret.
- [ ] CSP `connect-src` confirmed to name the production Supabase ref.
- [ ] Supabase **Pro** activated: leaked-password protection, session controls,
      daily backups + PITR.
- [ ] Pro backups verified by an actual restore — not assumed.
- [ ] MFA decision executed for internal accounts.
- [ ] Uptime Robot monitor confirmed live against the production `/api/health`,
      with the `"supabase":true` keyword alert.
- [ ] `production` branch created, stripped per §13, and made the deploy source;
      the Cloudflare Git integration re-pointed from `main` (beta) to `production`
      — a human-executed Cloudflare change, never made by an implementation PR.
- [ ] Privacy notice delivered per client; DPA executed where required; the
      per-study personal-data register completed with approved retention periods.
- [ ] Incident playbook rehearsed once as a tabletop exercise, including a rotation
      dry run in a non-production project.
- [ ] Real client data never present in the dev/staging project — re-confirmed.

---

*Produced by a read-only inventory. No production infrastructure, Supabase
project, Cloudflare configuration, credential, dataset, migration, test, or
application source file was modified, created, or deleted in producing it.*
