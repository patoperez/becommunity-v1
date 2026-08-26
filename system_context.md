# system_context.md — Be Community Platform

> Background, decisions, and rationale. This is the "why" behind `CLAUDE.md`'s
> "what". Read when you need context for a decision; `CLAUDE.md` is the day-to-day rulebook.

---

## 1. The business and the real goal

Be Community is a consulting firm serving private schools. Its product is **voice-of-the-customer research**: satisfaction studies, NPS, CSAT, categorized open-ended feedback, mystery shopping, and focus groups. Kano was considered historically but is explicitly out of scope. The consultant collects data from many sources, processes it (historically in Excel), draws conclusions, and delivers dashboards and presentations to each school.

The platform exists to solve four real pains, in priority order (all are Priority 1 for V2 — none is dropped):
1. **Manual calculations/crosses redone every study** — the biggest time sink and error source.
2. **Static, low-interactivity presentation** — deliverables that don't engage.
3. **Clients don't consume fragmented file deliverables** — value delivered but not used.
4. **No memory across studies** — can't easily compare waves or see sector trends.

**Design boundary (critical):** the platform does NOT rebuild Excel, Google Forms, or survey tools. Data *capture* stays in the consultant's existing tools. The platform takes over the moment raw data exists, and owns everything after that. Trying to absorb capture would mean building a worse spreadsheet — the trap we explicitly avoid.

## 2. Data reality (why the architecture is what it is)

This is **small data with rich structure**, not big data. Even the largest imaginable client (a university) produces studies of ~1,000–2,500 responses, because research uses representative sampling, not censuses. Volume is never the bottleneck. This is why:
- All calculation is done fresh, in-memory through the canonical Workers-safe
  engine, with no pre-aggregation. Arquero is retained only as a dev/test parity
  oracle because its runtime code generation is incompatible with workerd.
- We never build "big data" machinery (pipelines, caches, materialized rollups). It would add complexity for a problem that doesn't exist.

What IS complex: the *structure* (nested segmentation — level → grade → group, plus demographics), the *mix* of quantitative and qualitative data, and the *repeatability with variation* (a fixed core + per-client variable parts). The template system exists to capture exactly that "fixed core + variable slots" shape.

## 3. V1 — what was built (verify specifics in the audit)

- **Multi-tenant model:** `Tenant → Profiles → Studies → Responses`, with roles: `internal` (Be Community: admin, consultant) vs `client` (school, read-only dashboards).
- **Defense in depth foundation:** forced RLS on every table (`enable` + `force row level security`), with tenant isolation enforced by an **inline subquery inside each table's policies** — `tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))`, the `(select auth.uid())` wrapper giving per-query caching; `tenant_id` denormalized and indexed on every data table; explicit GRANTs to `authenticated`, none to `anon`. *(Correction, V1 audit 2026-07-07: the original Fase 0 design called for SECURITY DEFINER helper functions in a `private` schema; those were never built. The code — the inline-subquery pattern in `supabase/migrations/0000_init_schema_and_rls.sql` — is the source of truth, and the divergence is resolved in its favor: it works and is simpler to review. See `AUDIT_V1.md` §2.1.)*
- **Ingestion via adapter pattern:** raw flat files mapped to a canonical schema. Column-prefix convention (to be confirmed in audit): `seg_<key>` = segments/dimensions, `q_<metric>` = quantitative metrics, `qual_<theme>` = qualitative text.
- **On-the-fly calculation:** NPS, CSAT, Top-Box computed live from relational data via Arquero.
- **Configuration over code:** the journey map (and similar UI) renders from a JSON definition stored on the `study` row, not from hardcoded React.
- **Deployment:** Cloudflare via OpenNext adapter (Node compat mode was needed because the edge runtime conflicted with middleware + ingestion). Node compat is necessary but **not sufficient**: workerd's `unenv` shims throw on unimplemented APIs, so `.xlsx` parsing uses ExcelJS's browser build, loaded lazily.

### Hard lessons from V1 (do not repeat)
- The new Supabase key system does **not** auto-grant table privileges. RLS being enabled is not enough; `authenticated` needs explicit GRANTs or every query silently returns nothing. (Cost us a full debugging cycle.)
- The Supabase **SQL editor bypasses RLS** (runs privileged). Isolation must be tested via the authenticated API, never the editor — the editor always "passes" and proves nothing.
- Security bugs in generated code "look correct" and "work." Only adversarial, behavioral tests catch them.

## 4. V2 — mandate and the five modules

V2 is an uncompromised full-suite release. All modules are Priority 1; order of construction is by technical dependency, not importance.

- **M1 Universal ingestion:** visual column mapper (accept raw exports as-is, auto-map by source signature), staged validation with row-level errors and zero partial writes, recoding tables as data, qualitative intake.
- **M2 Advanced BI:** live cross-filtering (in-browser Arquero), guarded dynamic pivot (allowlisted fields), data-connected journey map, **human-in-the-loop qualitative analysis** (AI/heuristics suggest tags/clusters; the consultant confirms; only confirmed tags reach client views), one-click PDF export.
- **M3 Client portal:** one URL per school, everything inside, consumption-first narrative home; multi-user per tenant.
- **M4 Longitudinal memory:** wave-over-wave comparison; internal-only anonymized cross-tenant sector benchmarking (admin backoffice, never in client portals).
- **M5 Visual backoffice:** tenant/user CRUD, journey builder, dashboard configurator, import center with rollback.

### Template system (hard requirement, non-negotiable)
Word-style start experience: "Blank study" or "From template", backed by an **unlimited personal library** where every template has a custom name, description, preview. "Save as template" is a first-class action. Templates instantiate by **deep copy** — editing a template never mutates already-created studies (avoids silently rewriting delivered client work). V2 ships the full mechanism; V2.5 populates the actual named templates from the documented workflow.

## 5. Security posture (the honest version)

The goal is **not "impenetrable"** — no system is, and claiming it caused the very breaches we studied (Moltbook: RLS disabled, 1.5M tokens exposed; Lovable CVE-2025-48757: inverted access logic). The real goal:
- **Defense in depth** — five independent layers (Cloudflare edge, Next.js app, Postgres/RLS, Supabase Auth, detection/response). A bypass of one lands on another.
- **Minimal attack surface** — fewer doors; e.g., no free-form query surface, allowlisted pivots, optional geo challenges.
- **Contained blast radius** — one failure exposes at most one tenant, never everything.
- **Detection** — audit logs, alerts, backups, an incident playbook written before launch.

The number-one adversary is our own AI-generated code, not an external hacker. Hence the human-review zones (authorization, calculations, secrets) and the adversarial test suites that gate every phase. Full detail in the V2 architecture doc, Sections 5–7.

## 6. Infrastructure & cost stance

Supabase Cloud (not self-hosted — self-hosting was considered and deferred; it's more work and less secure unless a contractual data-residency requirement appears, which would migrate the same Postgres without an app rewrite). Free tier through build/testing; Pro (~$25/mo) only when the first real client has live access, for leaked-password protection, session controls, and daily backups. Cloudflare free tier hosts and provides the security perimeter. Cost is ~$0 until a live client exists.

## 7. Current phase (verified 2026-08-25)

P0-P6 of the V2 framework have been implemented. P6E synthetic acceptance was
completed against the deployed Cloudflare Worker: CSV/XLSX ingestion, canonical
calculations, filters, pivot, journey, server PDF, publication boundaries and
Tenant A/Tenant B isolation passed 108 automated checks with no failures.

Human acceptance then found two visual defects in mobile layout and PDF
pagination. PR #28 fixed both without changing calculations or security
boundaries; the real-phone and final two-page PDF checks passed, the change was
merged and deployed, and P6 is now closed.

P7 engineering is complete on `p7f-suites-b-c` at `b8fcfc4`; PR #38 is its
separate delivery unit so P8 does not obscure P7 provenance. Deferred controls
that require a custom domain, final production environment, billing or full DR
return as a bounded go-live pass after the product experience is complete; they
are not silently treated as green.

P8 product experience implementation is active in an isolated worktree that
intentionally descended from that P7 head. Discovery and standalone visual
comparison are finished. The
approved direction is an Interactive Insight Experience: guided `Recorrido` and
bounded `Explorar` for clients, a no-code Studio for internal staff, progressive
disclosure, rich evidence-connected journeys and controlled Be Community /
co-branded / white-label presentation. Work now proceeds in reviewable slices
of the real product, not additional detached HTML prototypes. P8-A is complete
and owner-accepted at `3659a38` (delivery PR #37). P8.2's first owner-review
slice — the no-code access-scope picker and guided mapping/readable import
preview — is owner-accepted and merged at `b1abfef` (delivery PR #39), with its
storage, authorization and ingestion contracts unchanged.

The remaining P8.2 scope is now implemented, synthetic-acceptance-complete and
awaiting owner review: Studio's
own `/studio/**` addresses beside every preserved `/admin/**` one, the
actionable home, the study work surface, the journey-metric and theme pickers,
visible paging, publication reachable only through the client preview, one
accessible destructive-action dialog, and the account and client lifecycle. That
lifecycle needed its own reviewed boundary, and got the smallest one that could
carry it: migration `0015` adds two nullable columns and one internal audit
table and changes no existing policy, grant or function. Suspending a person is
deliberately NOT in that schema — it is enforced at the authentication boundary
and read back from the account, so the product cannot show "con acceso" for an
identity Auth is already refusing. `0015` is applied to the synthetic project
only. At `543889a` the canonical offline chain, the complete live adversarial
chain and exact-ledger lifecycle acceptance passed; all disposable acceptance
objects were removed and the protected fixture remained unchanged. Permanent
client deletion remains intentionally disabled until a recoverable cross-system
workflow exists.

P8.3 is implementation-complete on `p8d-insights-data-story` and awaiting owner
review. It adds the authorized per-study Insights route, compact study library,
URL/report filter parity, guided comparison over the unchanged pivot allowlist,
adaptive longitudinal list/chart plus table, canonical sample language on screen
and in the PDF, and explicit loading/error/invalid-filter states. It changes no
formula, ingestion contract, role, RLS policy, migration or publication boundary.
Every P7 and
calculation boundary remains in force. V2.5 content still follows authoritative
documented business definitions; never invent formulas.

## 8. How we work with AI

Most construction is AI-assisted (Claude Code) under human supervision. Antigravity may be used via the official Claude Code extension with a paid Anthropic key — no unofficial proxy setups (account-ban risk). Gemini is used to draft prompts and review outputs against this plan. The human supervisor is the final authority, especially in the three human-review zones. Verification over assumption is the throughline of the whole project — it's what has kept V1 secure and what must keep V2 secure.
