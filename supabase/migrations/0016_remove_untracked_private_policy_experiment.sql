-- =============================================================================
-- 0016 — Remove the untracked `private` helper/policy experiment
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization. This migration REMOVES policies. Read the
-- preservation list below before approving it.
--
-- WHAT THIS IS
--
-- The synthetic project carried a set of Row Level Security policies, and a
-- `private` schema of helper functions behind them, that exist in NO tracked
-- migration. `docs/P7_PLAN.md` §0/§184 and `system_context.md` both record the
-- decision: the Fase 0 design once proposed SECURITY DEFINER helpers in a
-- `private` schema, they were never adopted, and the divergence was resolved in
-- favour of the tracked inline-subquery policies that 0000-0015 actually
-- create. The experiment was applied to the database anyway and never reached
-- the repository.
--
-- It is not merely redundant. `private.can_access_tenant()` queries
-- `public.consultant_assignments`, a table that does not exist in any
-- migration, so every policy calling it RAISES rather than filtering:
--
--     ERROR:  relation "public.consultant_assignments" does not exist
--
-- The practical effect is that `public.tenant` could not be read by ANY
-- authenticated role — client or internal — because PostgreSQL evaluates every
-- permissive policy, and one of them threw before the canonical
-- `tenant_isolation_select` could return a row.
--
-- WHAT THIS REMOVES — and nothing else
--
--   public.profiles        profiles_admin_write, profiles_select_self
--   public.tenant          tenant_admin_write, tenant_select
--   public.respondent      respondent_select
--   public.quant_response  quant_select
--   public.qual_observation qual_select
--   private.can_access_tenant(uuid), private.current_role(),
--   private.current_tenant(), private.is_admin()
--   the `authenticated` USAGE grant on schema `private`
--   the `private` schema itself, ONLY once proven empty and unreferenced
--
-- WHAT THIS PRESERVES, EXACTLY
--
--   * `profiles_select_own`      (0000) — a user reads only their own profile
--   * `tenant_isolation_select`  (0000) — a client reads only their own tenant
--   * `published_study_select`   (0010) — clients see published studies only
--   * every `deny_browser_roles` policy (0003, 0006, 0015)
--   * RLS and FORCE RLS on every table — no flag is touched
--   * every grant and revocation made by 0000-0015, including 0002's
--     least-privilege client reads and 0009's publication boundary, which
--     deliberately leaves `confirmed_qual_observation` readable by
--     `service_role` only. That is intentional and is NOT restored here.
--   * the direct-browser denial on respondent / quant_response /
--     qual_observation. Dropping the rogue SELECT policies RESTORES that
--     denial: those tables are left with no permissive policy, so RLS plus
--     FORCE RLS denies browser roles by default, which is the tracked design.
--   * every row of data. This migration touches no table contents.
--
-- IT IS SAFE ON A CLEAN DATABASE. Every statement is guarded: on a database
-- built only from the tracked migrations none of these objects exists, every
-- drop is a no-op, and the schema drop is skipped because the schema is absent.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The untracked policies.
-- -----------------------------------------------------------------------------
-- `drop policy if exists` on a missing TABLE would still error, so each drop is
-- guarded on the table's existence as well. That is what makes this portable to
-- a database where a later migration has renamed or removed one of them.
do $$
declare
  target record;
begin
  for target in
    select *
    from (values
      ('profiles',         'profiles_admin_write'),
      ('profiles',         'profiles_select_self'),
      ('tenant',           'tenant_admin_write'),
      ('tenant',           'tenant_select'),
      ('respondent',       'respondent_select'),
      ('quant_response',   'quant_select'),
      ('qual_observation', 'qual_select')
    ) as t(table_name, policy_name)
  loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = target.table_name
        and policyname = target.policy_name
    ) then
      execute format('drop policy %I on public.%I', target.policy_name, target.table_name);
      raise notice 'dropped untracked policy %.% ', target.table_name, target.policy_name;
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. The helpers those policies called, now unreferenced.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    raise notice 'schema private is absent; nothing to remove';
    return;
  end if;

  -- Revoke before dropping so the grant cannot outlive a partially-removed
  -- object, and so the intent is visible in the migration rather than implied
  -- by the drop.
  execute 'revoke all on schema private from authenticated';

  drop function if exists private.can_access_tenant(uuid);
  drop function if exists private.current_role();
  drop function if exists private.current_tenant();
  drop function if exists private.is_admin();
end $$;

-- -----------------------------------------------------------------------------
-- 3. The schema, and ONLY once nothing depends on it.
-- -----------------------------------------------------------------------------
-- Three independent checks, all of which must be clear:
--   a. the schema holds no remaining relation, routine, type or sequence;
--   b. no policy expression anywhere still names it;
--   c. no view or routine outside it still names it.
-- If any check finds something, the schema is KEPT and the migration says so.
-- Leaving a schema behind is a cosmetic remainder; dropping one that something
-- still needs is an outage.
do $$
declare
  leftover_objects integer;
  referencing_policies integer;
  referencing_routines integer;
  referencing_views integer;
begin
  if not exists (select 1 from pg_namespace where nspname = 'private') then
    return;
  end if;

  select count(*) into leftover_objects
  from (
    select 1 from pg_class where relnamespace = 'private'::regnamespace
    union all
    select 1 from pg_proc where pronamespace = 'private'::regnamespace
    union all
    select 1 from pg_type t
      where t.typnamespace = 'private'::regnamespace
        and t.typtype <> 'b'
  ) as remaining;

  select count(*) into referencing_policies
  from pg_policies
  where coalesce(qual, '') || coalesce(with_check, '') like '%private.%';

  select count(*) into referencing_routines
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema', 'private')
    and p.prokind in ('f', 'p')
    and pg_get_functiondef(p.oid) like '%private.%';

  select count(*) into referencing_views
  from pg_views
  where schemaname not in ('pg_catalog', 'information_schema')
    and definition like '%private.%';

  if leftover_objects = 0
     and referencing_policies = 0
     and referencing_routines = 0
     and referencing_views = 0 then
    execute 'drop schema private restrict';
    raise notice 'dropped empty, unreferenced schema private';
  else
    raise notice 'schema private KEPT: % object(s), % policy ref(s), % routine ref(s), % view ref(s)',
      leftover_objects, referencing_policies, referencing_routines, referencing_views;
  end if;
end $$;

commit;
