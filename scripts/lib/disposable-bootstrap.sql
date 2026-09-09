-- =============================================================================
-- Minimal local substitutes for the platform objects the migrations expect
-- =============================================================================
-- The tracked migrations are written for a Supabase database and reference two
-- things a bare PostgreSQL cluster does not have: the three API roles, and the
-- `auth` schema that owns the authentication identity. This file supplies the
-- SMALLEST believable stand-in for each, so migrations 0000-0031 can be applied
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
--   * `auth.uid()` returns the JWT subject claim, as it does on Supabase, and
--     reads BOTH the per-claim GUC and the JSON claim set — see the function
--     below for why that is not a detail. The canonical gates do not depend on
--     its value, because those tables deny browser roles outright rather than
--     filtering by user; the browser QA of the durable draft DOES, because it
--     signs a real person in and the product reads their profile under RLS.
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

-- BOTH SPELLINGS, because PostgREST changed which one it sets.
--
-- Up to PostgREST 8 each claim was its own GUC — `request.jwt.claim.sub`. From
-- 9 onwards there is ONE GUC holding the whole claim set as JSON,
-- `request.jwt.claims`, and the per-claim form is not set at all. Supabase's own
-- `auth.uid()` reads both for exactly this reason, and so does this stand-in.
--
-- It was the per-claim form alone, and under the PostgREST this harness runs
-- (16.2) that made `auth.uid()` NULL for every request. Nothing in the canonical
-- gates noticed, because those tables deny browser roles outright rather than
-- filtering by user — but a policy of the form `user_id = auth.uid()` denied a
-- signed-in person their own `profiles` row, and the product correctly concluded
-- the account belonged to no tenant. A stand-in that silently answers NULL is
-- worse than one that is absent: it makes an authorization test pass for the
-- wrong reason in one direction and fail inexplicably in the other.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')
  )::uuid;
$$;

create function auth.role() returns text
language sql stable
as $$
  select coalesce(nullif(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'), ''), current_user::text);
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
