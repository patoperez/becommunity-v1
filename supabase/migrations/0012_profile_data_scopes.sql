-- =============================================================================
-- 0012 — Optional per-user segment scope
-- =============================================================================
-- {} means all published data in the user's tenant. A configured object maps
-- canonical segment keys to allowed values, e.g. {"area":["administracion"]}.
-- Users cannot mutate profiles; P6 will expose this through internal-only CRUD.
-- =============================================================================

begin;

alter table public.profiles
  add column if not exists data_scope jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_data_scope_object_check,
  add constraint profiles_data_scope_object_check
    check (jsonb_typeof(data_scope) = 'object');

comment on column public.profiles.data_scope is
  'Server-enforced segment allowlist. Empty object grants the full tenant view.';

commit;
