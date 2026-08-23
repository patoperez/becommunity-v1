-- =============================================================================
-- ROLLBACK for 0014_rls_coverage_reporting.sql — emergency use only.
-- =============================================================================
-- Not auto-applied and never placed in supabase/migrations/. Apply with:
--   npx supabase db query --linked -f supabase/rollbacks/0014_drop_rls_coverage_reporting.sql
--
-- Scope: drops exactly one function, by its fully qualified zero-argument
-- signature. Dropping it removes its service_role EXECUTE grant with it. It
-- alters no table, policy, table grant, row of data, or other function, and it
-- touches no other migration — 0014 added nothing else to drop.
--
-- After this runs, npm run test:rls-coverage fails by design: the coverage
-- inventory is no longer executable. That is the intended signal, not a
-- regression to work around.
-- =============================================================================

drop function if exists public.rls_coverage_report();
