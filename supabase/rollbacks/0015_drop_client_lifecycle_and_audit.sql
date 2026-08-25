-- =============================================================================
-- ROLLBACK for 0015_client_lifecycle_and_audit.sql — emergency use only.
-- =============================================================================
-- Not auto-applied and never placed in supabase/migrations/. Apply with:
--   npx supabase db query --linked -f supabase/rollbacks/0015_drop_client_lifecycle_and_audit.sql
--
-- Scope: drops exactly what 0015 created — one table, its policy, its indexes
-- and its grants (all removed with the table), and the two columns 0015 added
-- to public.tenant together with the partial index over one of them. It alters
-- no other table, no other policy, no other grant and no row of client data.
--
-- READ THIS BEFORE RUNNING IT. Two consequences are irreversible by this file:
--
--   1. Every administrative lifecycle record is destroyed with the table. If
--      that evidence matters, export it first:
--        copy (select * from public.admin_lifecycle_event order by occurred_at)
--          to stdout with csv header;
--
--   2. Which clients were archived is destroyed with `tenant.archived_at`.
--      After this runs, every client reads as active again, and Studio will
--      once more accept a new study, invitation or publication for a client
--      that had been archived.
--
-- The application tolerates the absence of both: `src/lib/studio/lifecycle.ts`
-- detects the missing column and the missing table, and the Studio client
-- surfaces then render the lifecycle controls as unavailable with a stated
-- reason rather than failing. Suspension is unaffected — it lives at the
-- authentication boundary, not in this schema.
-- =============================================================================

begin;

drop table if exists public.admin_lifecycle_event;

drop index if exists public.tenant_archived_idx;

alter table public.tenant
  drop column if exists archived_at,
  drop column if exists archived_by;

commit;
