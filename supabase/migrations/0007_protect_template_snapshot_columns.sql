-- =============================================================================
-- 0007 — Keep internal template provenance out of the client API surface
-- =============================================================================
-- study remains tenant-readable, but its copied template payload contains
-- internal column mappings and recoding configuration. Replace the broad table
-- SELECT grant with an explicit safe-column allowlist for authenticated users.
-- RLS continues to restrict those safe columns to the user's own tenant.
-- =============================================================================

begin;

revoke select on table public.study from authenticated;
grant select (
  id,
  tenant_id,
  name,
  period,
  status,
  dashboard_config,
  journey_definition,
  created_at
) on table public.study to authenticated;

commit;
