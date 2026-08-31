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

## 7. Current phase (verified 2026-08-30)

P0-P8 are implementation-complete and owner-accepted. The synthetic beta has
the hardened V2 framework, guided ingestion, canonical calculations, client
Insights, Studio workflows, governed interpretation and bounded presentation
customisation. P9 established the real-study ingestion/reconciliation path, the
human semantic-category decision ledger and its disabled-by-default AI advisor,
and the verified Journey editor focus fix. Deferred controls that need the final
domain, a production Supabase environment, billing or full disaster recovery
remain explicit go-live work; they are not silently treated as green.

The active construction line is the governed **Experience Composer** on branch
`claude/experience-publication-versioning`, cut from
`claude/experience-builder-journeys-visuals-cloud` at
`b20c502b7a99942fa012ff3a462b278beda5ba60`.
Its schema version is 3. Internal
staff can compose pages and filter panels, collapse either editor sidebar
independently, define several reusable recorridos with exact awareness rules,
author semáforo standards that may become derived filters, use real heat-map /
bubble / treemap renderers, and create deterministic thematic clouds from
approved qualitative categories. The milestone's offline, production-browser
and disposable-live-data gates passed; the real Cuicuilco draft remained at
revision 72 with the same canonical hash.

The Composer now **publishes**, and only over an immutable revision. A draft is
frozen into a prepared revision of one exact draft revision, reviewed exactly as
it would be served, and then selected atomically as the active client
experience; a rollback appends a new event pointing at an older revision and
deletes nothing. Saving a draft still changes nothing a client sees, and a study
is served the composed experience only when it has an active published revision
— every other study keeps the legacy dashboard, one study at a time.

The decisions worth carrying forward: status is DERIVED from the pointer and the
event log rather than stored on a row that is never updated; a publication
freezes CONFIGURATION and fingerprints and never a number, so a corrected import
still moves what a client reads; a blocker is something the page would be lying
about and cannot be acknowledged, while a warning is acknowledged by its exact
code, by a named person, at a recorded time; and the client renderer draws no
sentence addressed to an author, which took two layers to get right and was
found by looking at a screenshot rather than at the code.

Each milestone is uploaded as a zero-traffic Cloudflare version and never
promoted; the current one is recorded in `docs/CURRENT_STATE.md`. Manual uploads must keep `keep_vars = true`, pass both
public Supabase text bindings while they remain version-only, and inherit the
encrypted service-role secret without exposing it to a build or committed file.

Every P7 authorization, tenant-isolation, RLS, calculation and ingestion
boundary remains in force. V2.5 content still follows authoritative documented
business definitions; never invent formulas. For exact operational state read
`docs/CURRENT_STATE.md`; for the Composer contract read
`docs/EXPERIENCE_COMPOSER.md`, especially sections 45-51.

## 8. How we work with AI

Most construction is AI-assisted (Claude Code) under human supervision. Antigravity may be used via the official Claude Code extension with a paid Anthropic key — no unofficial proxy setups (account-ban risk). Gemini is used to draft prompts and review outputs against this plan. The human supervisor is the final authority, especially in the three human-review zones. Verification over assumption is the throughline of the whole project — it's what has kept V1 secure and what must keep V2 secure.
