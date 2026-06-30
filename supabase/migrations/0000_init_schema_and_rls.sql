-- =============================================================================
-- Be Community — Fase 0: Canonical data model + Row Level Security (RLS)
-- =============================================================================
-- Source of truth: "Arquitectura Técnica Be Community", Sections 4.2 and 6.2.
--
-- GOLDEN RULE (Section 6.2): RLS is enabled on EVERY table in the public schema,
-- and each table's tenant-isolation policy is created in the SAME migration that
-- creates the table — so there is never an unprotected window. Enabling RLS
-- without a policy denies all access by default; the anon key is only safe
-- because of this (Section 6.3, Moltbook incident 6.1).
--
-- Isolation axis: every table carrying client data has tenant_id (denormalized,
-- Section 4.2) so each policy compares a single indexed column — no joins,
-- simple enough for a human to verify.
--
-- This migration is idempotent-friendly for dev (IF NOT EXISTS / DROP POLICY IF
-- EXISTS) and is the versioned, git-tracked source of the schema (Section 6.4).
-- =============================================================================

begin;

-- gen_random_uuid() — available on Supabase; ensure the extension is present.
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- profiles — the user -> tenant + role link table (Section 7.1).
-- This IS the canonical "user" entity from Section 4.2, implemented the
-- Supabase-idiomatic way: the auth identity lives in auth.users, and profiles
-- binds it to a tenant and role. RLS policies on every other table read
-- tenant_id from here, exactly as specified in Section 6.2.
--   role = 'client'   -> belongs to a tenant, sees only that tenant's data.
--   role = 'internal' -> Be Community staff; tenant_id is null. Their data
--                        access is governed by role on the server via the
--                        service_role key (Section 6.3), NOT by these policies.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid,                                  -- FK added after tenant exists
  role       text not null default 'client' check (role in ('client', 'internal')),
  full_name  text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- tenant — a school. The unit of isolation. Every datum belongs to a tenant.
-- -----------------------------------------------------------------------------
create table if not exists public.tenant (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Now that tenant exists, wire profiles.tenant_id -> tenant(id).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_tenant_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_tenant_id_fkey
      foreign key (tenant_id) references public.tenant (id) on delete cascade;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- study — a concrete study of a tenant. Holds dashboard + journey config.
-- -----------------------------------------------------------------------------
create table if not exists public.study (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant (id) on delete cascade, -- isolation
  name               text not null,
  period             text,
  status             text not null default 'draft',
  dashboard_config   jsonb not null default '{}'::jsonb,   -- which sections to show
  journey_definition jsonb not null default '{}'::jsonb,   -- stages + metric per stage
  created_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- respondent — a response unit within a study, with arbitrary, nestable
-- segmentation attributes held in jsonb (Section 4.1: segmentation is arbitrary).
-- -----------------------------------------------------------------------------
create table if not exists public.respondent (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete cascade,  -- isolation (denormalized)
  study_id   uuid not null references public.study (id)  on delete cascade,
  segments   jsonb not null default '{}'::jsonb,  -- e.g. {nivel:'preescolar', grupo:'2A', genero:'F'}
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- quant_response — a numeric/scale value for a metric from a respondent.
-- -----------------------------------------------------------------------------
create table if not exists public.quant_response (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id)     on delete cascade,  -- isolation
  study_id      uuid not null references public.study (id)      on delete cascade,
  respondent_id uuid references public.respondent (id)          on delete cascade,
  metric_key    text not null,        -- e.g. 'nps', 'sat_maestros'
  value         numeric,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- qual_observation — coded qualitative text (first-class citizen, Section 4.1).
-- -----------------------------------------------------------------------------
create table if not exists public.qual_observation (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id)  on delete cascade,  -- isolation
  study_id      uuid not null references public.study (id)   on delete cascade,
  respondent_id uuid references public.respondent (id)       on delete set null, -- nullable (Section 4.2)
  source        text,                 -- 'encuesta', 'mystery_shopper', 'focus_group'
  category      text,
  theme         text,
  quote         text,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- segment_dimension — flexible, nestable segmentation definition per study
-- (nivel -> grado -> grupo), not fixed columns (Section 4.1/4.2).
-- -----------------------------------------------------------------------------
create table if not exists public.segment_dimension (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete cascade,  -- isolation
  study_id   uuid not null references public.study (id)  on delete cascade,
  key        text not null,           -- e.g. 'nivel'
  label      text,
  parent_id  uuid references public.segment_dimension (id) on delete cascade,  -- nestable
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- journey_definition — stages of a study's journey and the metric per stage.
-- -----------------------------------------------------------------------------
create table if not exists public.journey_definition (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id) on delete cascade,  -- isolation
  study_id    uuid not null references public.study (id)  on delete cascade,
  stage_key   text not null,
  stage_label text,
  stage_order integer,
  metric_key  text,                   -- which metric lives in this stage
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- Indexes on tenant_id (and key FKs). RLS queries tenant_id on every request;
-- without an index, performance degrades severely (Section 6.2 note).
-- =============================================================================
create index if not exists idx_profiles_tenant_id           on public.profiles (tenant_id);
create index if not exists idx_study_tenant_id              on public.study (tenant_id);
create index if not exists idx_respondent_tenant_id         on public.respondent (tenant_id);
create index if not exists idx_respondent_study_id          on public.respondent (study_id);
create index if not exists idx_quant_response_tenant_id     on public.quant_response (tenant_id);
create index if not exists idx_quant_response_study_id      on public.quant_response (study_id);
create index if not exists idx_quant_response_respondent_id on public.quant_response (respondent_id);
create index if not exists idx_qual_observation_tenant_id   on public.qual_observation (tenant_id);
create index if not exists idx_qual_observation_study_id    on public.qual_observation (study_id);
create index if not exists idx_segment_dimension_tenant_id  on public.segment_dimension (tenant_id);
create index if not exists idx_segment_dimension_study_id   on public.segment_dimension (study_id);
create index if not exists idx_journey_definition_tenant_id on public.journey_definition (tenant_id);
create index if not exists idx_journey_definition_study_id  on public.journey_definition (study_id);

-- =============================================================================
-- ROW LEVEL SECURITY — MANDATORY on every public table (Section 6.2).
-- Pattern: tenant_id = (select tenant_id from profiles where user_id = (select auth.uid()))
--   - auth.uid() wrapped in (select ...) so Postgres caches it per-query
--     instead of per-row (>100x speedup on large tables, Section 6.2 note).
--   - USING filters existing rows (SELECT/UPDATE/DELETE); WITH CHECK validates
--     new/modified rows (INSERT/UPDATE). UPDATE needs both, or a user could
--     move a row to another tenant (Section 6.2 note).
-- Writes to profiles/tenant themselves are performed server-side with the
-- service_role key (provisioning), so no client write policies are granted here.
-- =============================================================================

-- ---- profiles ---------------------------------------------------------------
alter table public.profiles enable row level security;
-- Hardening: also apply RLS to the table owner so nothing slips through.
alter table public.profiles force row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (user_id = (select auth.uid()));

-- ---- tenant -----------------------------------------------------------------
-- tenant has no tenant_id; its id IS the tenant key. A user may read only the
-- tenant row they belong to.
alter table public.tenant enable row level security;
alter table public.tenant force row level security;

drop policy if exists "tenant_isolation_select" on public.tenant;
create policy "tenant_isolation_select" on public.tenant
  for select using (
    id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- study ------------------------------------------------------------------
alter table public.study enable row level security;
alter table public.study force row level security;

drop policy if exists "tenant_isolation_select" on public.study;
create policy "tenant_isolation_select" on public.study
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.study;
create policy "tenant_isolation_insert" on public.study
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.study;
create policy "tenant_isolation_update" on public.study
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.study;
create policy "tenant_isolation_delete" on public.study
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- respondent -------------------------------------------------------------
alter table public.respondent enable row level security;
alter table public.respondent force row level security;

drop policy if exists "tenant_isolation_select" on public.respondent;
create policy "tenant_isolation_select" on public.respondent
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.respondent;
create policy "tenant_isolation_insert" on public.respondent
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.respondent;
create policy "tenant_isolation_update" on public.respondent
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.respondent;
create policy "tenant_isolation_delete" on public.respondent
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- quant_response ---------------------------------------------------------
alter table public.quant_response enable row level security;
alter table public.quant_response force row level security;

drop policy if exists "tenant_isolation_select" on public.quant_response;
create policy "tenant_isolation_select" on public.quant_response
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.quant_response;
create policy "tenant_isolation_insert" on public.quant_response
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.quant_response;
create policy "tenant_isolation_update" on public.quant_response
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.quant_response;
create policy "tenant_isolation_delete" on public.quant_response
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- qual_observation -------------------------------------------------------
alter table public.qual_observation enable row level security;
alter table public.qual_observation force row level security;

drop policy if exists "tenant_isolation_select" on public.qual_observation;
create policy "tenant_isolation_select" on public.qual_observation
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.qual_observation;
create policy "tenant_isolation_insert" on public.qual_observation
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.qual_observation;
create policy "tenant_isolation_update" on public.qual_observation
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.qual_observation;
create policy "tenant_isolation_delete" on public.qual_observation
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- segment_dimension ------------------------------------------------------
alter table public.segment_dimension enable row level security;
alter table public.segment_dimension force row level security;

drop policy if exists "tenant_isolation_select" on public.segment_dimension;
create policy "tenant_isolation_select" on public.segment_dimension
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.segment_dimension;
create policy "tenant_isolation_insert" on public.segment_dimension
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.segment_dimension;
create policy "tenant_isolation_update" on public.segment_dimension
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.segment_dimension;
create policy "tenant_isolation_delete" on public.segment_dimension
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- ---- journey_definition -----------------------------------------------------
alter table public.journey_definition enable row level security;
alter table public.journey_definition force row level security;

drop policy if exists "tenant_isolation_select" on public.journey_definition;
create policy "tenant_isolation_select" on public.journey_definition
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_insert" on public.journey_definition;
create policy "tenant_isolation_insert" on public.journey_definition
  for insert with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_update" on public.journey_definition;
create policy "tenant_isolation_update" on public.journey_definition
  for update using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  ) with check (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

drop policy if exists "tenant_isolation_delete" on public.journey_definition;
create policy "tenant_isolation_delete" on public.journey_definition
  for delete using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );

-- =============================================================================
-- API ROLE GRANTS. PostgREST gates table access by GRANTs; RLS then restricts
-- rows. BOTH are required — without a grant the API returns 42501 even with RLS
-- correct. anon is intentionally NOT granted, so unauthenticated API calls are
-- hard-denied on top of RLS (defense in depth, §6.4). 'authenticated' gets CRUD
-- but every row is filtered by the tenant-isolation policies above; tables with
-- no write policy (tenant, profiles) stay effectively read-only to clients.
-- =============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

commit;

-- =============================================================================
-- POST-MIGRATION SELF-CHECK (Section 6.5 "RLS coverage" gate).
-- Must return ZERO rows: any public table without RLS is the most common and
-- most serious mistake. Run this after applying the migration.
-- =============================================================================
-- select c.relname as table_without_rls
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
