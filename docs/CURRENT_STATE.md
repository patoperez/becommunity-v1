# Current state — Be Community V2

> Authoritative operational handoff. Last verified: **2026-08-22**.
> Read this after `CLAUDE.md` at the start of every new coding session.
> Historical files (`AUDIT_V1.md`, `docs/FASE_*.md`) explain past decisions but
> do not override this state.

## Product and roadmap boundary

Be Community is a multi-tenant BI and data-storytelling platform for an
education-sector consultancy. It begins when raw research data already exists;
it is not a CRM, survey-capture system, or replacement for Excel/Forms.

The V2 construction order remains:

1. P0 security hardening
2. P1 canonical calculation layer
3. P2 universal ingestion
4. P3 template framework
5. P4 advanced BI
6. P5 client portal and longitudinal memory
7. P6 visual backoffice
8. P7 full hardening, adversarial suites, backups and incident response

Do not change that priority because of an incidental feature question. In
particular, retention UI and separate CEO/employee permission tiers are not the
current task. Business content and named starter templates belong to V2.5 and
must use documented authoritative definitions rather than invented rules.

## Verified source and deployment baseline

- Application-code baseline: `1a95cdf6081b07871153a5ce98f2db11cca2e7bb`
  (`P6E: restore CSV/XLSX ingestion on Cloudflare Workers (#24)`). PR #25
  updated documentation only; always start new work from the current
  `origin/main` rather than treating this application baseline as the branch tip.
- Worker version verified during P6E acceptance:
  `d43ff9ab-b837-49f2-8c34-03b0f236096e`. Later documentation-only merges may
  produce a new Cloudflare version ID with the same application code; confirm
  the current deployment rather than treating this ID as permanent.
- Production URL: `https://becommunity-v1.ollinagencyllc.workers.dev`
- The connected Supabase project contains **synthetic test data only**. This is
  not yet the separate real-client production environment required at go-live.
- Supported roles today: `internal` and `client`. CEO and employee test accounts
  intentionally have the same `internal` permissions; do not claim otherwise.

Never place passwords, service-role keys, cookies, tokens, or connection-string
passwords in this document, commits, PR descriptions, screenshots, or logs.

## Completed framework

P0-P6 capabilities are implemented, including:

- forced RLS and least-privilege client reads;
- server-side authorization and tenant/publication boundaries;
- CSV/XLSX ingestion, mapping, preview, atomic commit and rollback;
- canonical calculations and documented rounding policy;
- template save/instantiate framework with copy semantics;
- live filters, guarded pivot, data-connected journey and qualitative review;
- server-generated authenticated PDF reports;
- longitudinal and narrative client views with per-user data scopes;
- client/user backoffice, study configurator, tenant branding and internal
  client preview.

Arquero is a dev-only parity oracle. Production calculation modules must remain
free of runtime code generation. ExcelJS must remain lazy and use its browser
build on the XLSX branch; CSV must never evaluate its Node dependency graph.

## P6E acceptance record

Synthetic acceptance study:

- ID: `ad275928-dbd1-4acf-9de9-fa1623b32a60`
- Tenant A: `298c79c0-a88e-487b-a63d-3d7062c6111e`
- Name: `ACEPTACIÓN P6E — DATOS SINTÉTICOS (TEST)`
- Status: `published` for human visual acceptance
- Import batch: `bd4f26db-093a-4e31-8fa9-de8281300c63` (`committed`)
- Counts: 20 respondents, 80 quantitative responses, 0 qualitative
  observations, 1 import batch

Technical production acceptance completed with **108 checks and 0 failures**:

- deployed CSV and XLSX analyze/preview;
- CSV commit and database reference integrity;
- 77 expected calculation/filter/pivot/journey assertions;
- internal preview and authenticated PDF;
- draft and publication boundaries;
- Tenant A access and Tenant B isolation;
- 41 tailed production requests with no 5xx, uncaught exception,
  `process.umask`, runtime code-generation or Supabase-key error.

The two older `Satisfacción 2026 (TEST)` studies remain draft and must not be
published, modified or deleted during this acceptance work.

## Current task — finish P6 human visual acceptance

Human review passed desktop client behavior, Tenant B isolation, internal/CEO
navigation, logged-out boundaries, calculations and PDF content. It found two
genuine visual defects:

1. **Narrow-mobile document overflow.** On the data-rich Tenant A dashboard,
   the blue header ends at the real viewport edge while the study card widens
   the document to the right. Content beyond the viewport is clipped on the
   phone. Find the actual min-content/flex/grid cause. Do not hide it with a
   global `overflow-x: hidden`; any necessary horizontal scroll must remain
   contained inside the relevant table/chart component.
2. **PDF pagination.** The accepted report has correct content and calculations,
   but page two pressures/clips its footer and the final methodology disclaimer
   is orphaned on an otherwise mostly empty third page. Rebalance pagination
   without shrinking text to an uncomfortable size or changing calculations.

The next code change must be a narrow P6 visual-fix PR. It must preserve
formulas, ingestion, RLS, roles and synthetic data, and it must stop for review
before merge/deployment. After it merges, repeat only the targeted mobile/PDF
human checks plus quick Tenant B/internal smoke tests.

P6 is closed only after those checks pass. **Then** begin P7 from a separate,
explicitly planned task.

## Known constraints carried forward

- `npm run cf:build` can fail on Windows with OpenNext's documented symlink
  `EPERM`; Cloudflare's Linux branch build is the authoritative bundle check.
- Local OpenNext output can contain inlined environment values. `.open-next/`
  is gitignored; purge partial output after checks and run `npm run test:secrets`.
- The current synthetic environment is not the final staging/production split.
- P7/go-live work still includes the full adversarial audit, audit logging and
  alerts, backup/restore proof, incident playbook, edge controls, monitoring,
  clean production branch, separate production Supabase project and the Pro
  upgrade trigger documented in `docs/GO_LIVE_SECURITY.md` and
  `docs/OPERATIONS.md`.

## Required verification discipline

Use the scripts in `package.json` as the source of truth. At minimum, every PR
must run its focused tests plus:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Security/release work also runs the applicable live isolation and secret gates.
Never mark an unexecuted check as passed, never alter expected calculations to
make a test green, and never bypass the real application workflow by manually
inserting acceptance rows.
