-- =============================================================================
-- Minimal local substitutes for the platform objects the migrations expect
-- =============================================================================
-- The tracked migrations are written for a Supabase database and reference two
-- things a bare PostgreSQL cluster does not have: the three API roles, and the
-- `auth` schema that owns the authentication identity. This file supplies the
-- SMALLEST believable stand-in for each, so migrations 0000-0024 can be applied
-- VERBATIM to a disposable database.
--
-- It is test scaffolding and nothing else. It is never applied to any hosted
-- project, it creates no application data, and every object it makes is thrown
-- away with the database.
--
-- WHERE THE STAND-IN DIFFERS FROM SUPABASE, AND WHY IT DOES NOT MATTER HERE:
--
--   * `service_role` is created with BYPASSRLS, which is what Supabase gives it.
--     Without that the FORCE RLS on every canonical table would deny the very
--     role the product uses, and the gate would prove the opposite of the truth.
--   * `anon` and `authenticated` are created with NOLOGIN and no privileges of
--     their own, exactly as the product relies on. The gate reaches them with
--     SET ROLE, which applies their privileges without needing a password.
--   * `auth.uid()` returns the JWT subject claim, as it does on Supabase. No
--     test in this gate depends on its value: the canonical tables deny browser
--     roles outright rather than filtering by user.
-- =============================================================================

-- Roles are CLUSTER-wide, not per-database, and this file is applied once per
-- disposable database. Creating them unconditionally would fail on the second
-- database of the same run, so each is created only if the cluster lacks it.
do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $roles$;

create schema auth;

-- The authentication identity. Several migrations reference `auth.users (id)`
-- with ON DELETE SET NULL / CASCADE, so the column type and the primary key are
-- the only parts of its real shape that matter.
create table auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text);
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
-- Migration 0013 registers a public bucket for tenant branding. Only the bucket
-- REGISTRY is needed for the migration to apply; no object store is involved and
-- no test in this gate reads or writes a file. The column set matches the one
-- that migration inserts into, and nothing more.
create schema storage;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
