-- =============================================================================
-- 0011 — Canonical study publication states
-- =============================================================================
-- The provisioned database had a historical check constraint that did not
-- accept `published`, while the application and architecture use that state.
-- Normalize the lifecycle before publication-aware RLS can be relied upon.
-- =============================================================================

begin;

alter table public.study
  drop constraint if exists study_status_check;

alter table public.study
  add constraint study_status_check
  check (status in ('draft', 'published', 'archived'));

commit;
