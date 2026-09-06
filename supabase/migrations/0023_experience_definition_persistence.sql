-- =============================================================================
-- 0023 — Persistent, versioned storage for composed experience definitions
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization + storage. This migration is ADDITIVE ONLY.
-- It creates three tables and one function. It alters no existing table, drops
-- nothing, rewrites no row and changes no existing policy or grant. Nothing it
-- creates is reachable from a client-facing route, and no client-facing
-- behaviour changes when it is applied.
--
-- ROLLBACK, EXACTLY (see docs/EXPERIENCE_COMPOSER.md §"Migración y reversa"):
--   drop function if exists public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text);
--   drop table if exists public.study_experience_event;
--   drop table if exists public.study_experience_revision;
--   drop table if exists public.study_experience_draft;
-- Running those four statements returns the database to its 0022 state. No
-- other object is touched, so nothing else has to be restored with them.
--
-- WHAT IS STORED, AND WHAT IS DELIBERATELY NOT
--
-- A definition is PRESENTATION: pages, blocks, layout, chart choices, filters,
-- connections, journeys, authored copy, and references by opaque handle to the
-- results and characteristics the server already knows about. It carries no
-- respondent, no answer, no quote, no canonical metric key and no column name —
-- see `src/lib/experience/definition.ts`, which is the schema this column's
-- contents must satisfy before they ever reach here.
--
-- THE TWO-TABLE SHAPE, AND WHY IT IS TWO
--
--   `study_experience_draft`     ONE mutable draft per study. Saving it is an
--                                ordinary edit and changes nothing a client
--                                sees.
--   `study_experience_revision`  IMMUTABLE published revisions. A row here is
--                                what a client would be served. It is written
--                                once and never updated: the trigger below
--                                refuses an UPDATE, and no role holds the
--                                UPDATE privilege on the table either, so the
--                                immutability is enforced twice and by
--                                construction rather than by convention.
--
-- Publication itself arrives in a later milestone. The revision table exists
-- NOW because the draft's `revision` counter and the publication's identity
-- have to be designed together: bolting an immutable history onto a mutable
-- row afterwards is how a "published" report starts drifting with its draft.
-- Nothing in this repository writes a revision yet, and that is stated rather
-- than hidden.
--
-- LOST UPDATES
--
-- Two consultants with the same study open must not silently overwrite each
-- other. `save_study_experience_draft` takes the revision the caller believes
-- it is editing and refuses — with SQLSTATE 40001, so the application can tell
-- a conflict from a failure — when the stored revision has moved on. The check
-- and the write happen in one statement under `for update`, so there is no
-- window between them.
--
-- AUTHORIZATION
--
-- Three independent layers, none of which trusts the browser:
--   1. the route and the Server Action run `requireInternal()` first;
--   2. RLS is enabled AND forced on all three tables, and `anon` and
--      `authenticated` are denied outright — a client-role session cannot read
--      or write a draft even with a valid JWT and a correct study id;
--   3. this function re-checks that the actor holds the `internal` role in
--      `public.profiles`, and derives `tenant_id` from the STUDY ROW rather
--      than from anything the caller sent.
--
-- The definition's own `metadata.studyId` / `metadata.tenantId` are compared
-- against the study row and the save is refused when they disagree, so a
-- document that names another tenant cannot be stored against this one even if
-- every layer above it were bypassed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- The mutable draft — one per study
-- -----------------------------------------------------------------------------
create table if not exists public.study_experience_draft (
  study_id       uuid primary key references public.study (id) on delete cascade,
  tenant_id      uuid not null references public.tenant (id) on delete cascade,
  -- The schema the stored document was written under. Read back by code that
  -- may be newer than the code that wrote it; `src/lib/experience/migrate.ts`
  -- owns what happens then, and refuses a version it does not know rather than
  -- guessing at one.
  schema_version integer not null check (schema_version between 1 and 1000),
  -- Monotonic. Never reused, never decremented: it is the optimistic-concurrency
  -- token, and a reused value would let a stale editor's save look current.
  revision       bigint not null default 1 check (revision >= 1),
  definition     jsonb not null
                   check (jsonb_typeof(definition) = 'object')
                   -- 512 KiB, the same ceiling `EXPERIENCE_LIMITS.serializedBytes`
                   -- declares in the application. Field limits multiply; this is
                   -- the bound that actually stops a schema-valid but
                   -- pathological document from being stored.
                   check (octet_length(definition::text) <= 524288),
  created_by     uuid references auth.users (id) on delete set null,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists study_experience_draft_tenant_idx
  on public.study_experience_draft (tenant_id, updated_at desc);

comment on table public.study_experience_draft is
  'The mutable composed-experience draft of one study. Presentation only: pages, blocks, layout, filters and authored copy, referencing results by opaque registry handle. Never a respondent, an answer, a quote or a canonical metric key. Saving it changes nothing a client sees.';

comment on column public.study_experience_draft.revision is
  'Optimistic-concurrency token. save_study_experience_draft refuses a write whose expected revision is not the stored one, so two editors cannot silently overwrite each other.';

-- -----------------------------------------------------------------------------
-- The immutable published revisions
-- -----------------------------------------------------------------------------
create table if not exists public.study_experience_revision (
  id             uuid primary key default gen_random_uuid(),
  study_id       uuid not null references public.study (id) on delete cascade,
  tenant_id      uuid not null references public.tenant (id) on delete cascade,
  revision       bigint not null check (revision >= 1),
  schema_version integer not null check (schema_version between 1 and 1000),
  definition     jsonb not null
                   check (jsonb_typeof(definition) = 'object')
                   check (octet_length(definition::text) <= 524288),
  published_by   uuid references auth.users (id) on delete set null,
  published_at   timestamptz not null default now(),
  -- One row per (study, revision). A second publication of the same revision is
  -- a bug, and the database says so rather than storing two answers to the same
  -- question.
  unique (study_id, revision)
);

create index if not exists study_experience_revision_study_idx
  on public.study_experience_revision (study_id, revision desc);

comment on table public.study_experience_revision is
  'Immutable published revisions of a composed experience. Written once, never updated: the refuse_experience_revision_update trigger raises on UPDATE and no role holds the UPDATE privilege. A client is served a revision, never the draft. No application path writes this table yet — publication is a later milestone.';

-- A published revision is what somebody was shown. Editing it in place would
-- change a delivered report retroactively, which is the exact failure the
-- product already learned about with published category groupings. Refused at
-- the table, so it is refused for the owner too and not only for a role that
-- happens to lack a grant.
create or replace function public.refuse_experience_revision_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '2F002',
    message = 'a published experience revision is immutable';
end;
$$;

drop trigger if exists refuse_update on public.study_experience_revision;
create trigger refuse_update
  before update on public.study_experience_revision
  for each row execute function public.refuse_experience_revision_update();

-- -----------------------------------------------------------------------------
-- The audit trail
-- -----------------------------------------------------------------------------
-- Modelled on `study_interpretation_event` (0017): append-only at the privilege
-- level, bounded metadata only, and never a fragment of the document itself.
create table if not exists public.study_experience_event (
  id            uuid primary key default gen_random_uuid(),
  study_id      uuid not null references public.study (id) on delete cascade,
  tenant_id     uuid not null references public.tenant (id) on delete cascade,
  actor_user_id uuid,
  action        text not null check (action in (
                  'draft_created',
                  'draft_saved',
                  -- Reserved for the publication milestone. No code path writes
                  -- either value today; the vocabulary is declared now so a
                  -- later migration does not have to rewrite the constraint.
                  'published',
                  'unpublished'
                )),
  revision      bigint check (revision is null or revision >= 1),
  -- What changed, in the author's own words, bounded. Never the document.
  note          text check (note is null or char_length(note) <= 200),
  occurred_at   timestamptz not null default now()
);

create index if not exists study_experience_event_study_idx
  on public.study_experience_event (study_id, occurred_at desc);

comment on table public.study_experience_event is
  'Who changed a composed experience, when, and to which revision. Bounded metadata only: never a definition, a respondent row, an answer or a quote.';

-- -----------------------------------------------------------------------------
-- RLS — enabled AND forced, browser roles denied outright
-- -----------------------------------------------------------------------------
alter table public.study_experience_draft enable row level security;
alter table public.study_experience_draft force row level security;
alter table public.study_experience_revision enable row level security;
alter table public.study_experience_revision force row level security;
alter table public.study_experience_event enable row level security;
alter table public.study_experience_event force row level security;

drop policy if exists "deny_browser_roles" on public.study_experience_draft;
create policy "deny_browser_roles" on public.study_experience_draft
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "deny_browser_roles" on public.study_experience_revision;
create policy "deny_browser_roles" on public.study_experience_revision
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "deny_browser_roles" on public.study_experience_event;
create policy "deny_browser_roles" on public.study_experience_event
  for all to anon, authenticated using (false) with check (false);

-- LEAST PRIVILEGE, EXPLICITLY.
--
-- Migration 0001 set default privileges that hand every new public table ALL to
-- `service_role` and the four DML verbs to `authenticated`. Both are revoked
-- here and only SELECT is granted back. Every write goes through the
-- `security definer` function below, which runs as the table owner — so the
-- application's own privileged role cannot write one of these tables directly
-- even by mistake, and the authorization checks in that function are the only
-- way in.
revoke all privileges on table public.study_experience_draft from anon, authenticated;
revoke all privileges on table public.study_experience_draft from service_role;
grant select on table public.study_experience_draft to service_role;

revoke all privileges on table public.study_experience_revision from anon, authenticated;
revoke all privileges on table public.study_experience_revision from service_role;
grant select on table public.study_experience_revision to service_role;

revoke all privileges on table public.study_experience_event from anon, authenticated;
revoke all privileges on table public.study_experience_event from service_role;
grant select on table public.study_experience_event to service_role;

-- -----------------------------------------------------------------------------
-- Saving a draft — the only write path
-- -----------------------------------------------------------------------------
create or replace function public.save_study_experience_draft(
  p_study_id          uuid,
  p_actor             uuid,
  p_definition        jsonb,
  p_schema_version    integer,
  p_expected_revision bigint default null,
  p_note              text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target  public.study%rowtype;
  current public.study_experience_draft%rowtype;
  created boolean := false;
  next_revision bigint;
begin
  -- 1. The actor. Read from the database, never from a claim the caller sent.
  if not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  -- 2. The study, which is also where the tenant comes from. A tenant id in the
  --    request would be a tenant id an attacker chose.
  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  -- 3. The document. Shape, size, and agreement with the study it claims.
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'definition must be an object';
  end if;
  if octet_length(p_definition::text) > 524288 then
    raise exception using errcode = '22023', message = 'definition is too large';
  end if;
  if p_schema_version is null or p_schema_version < 1 or p_schema_version > 1000 then
    raise exception using errcode = '22023', message = 'unsupported schema version';
  end if;
  if (p_definition #>> '{schemaVersion}') is distinct from p_schema_version::text then
    raise exception using errcode = '22023', message = 'schema version disagrees with the document';
  end if;
  if (p_definition #>> '{metadata,studyId}') is distinct from target.id::text then
    raise exception using errcode = '22023', message = 'definition names another study';
  end if;
  if (p_definition #>> '{metadata,tenantId}') is distinct from target.tenant_id::text then
    raise exception using errcode = '22023', message = 'definition names another client';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception using errcode = '22023', message = 'note is too long';
  end if;

  select * into current
    from public.study_experience_draft
   where study_id = target.id
     for update;

  if not found then
    -- Creating. An expected revision means the caller believed a draft was
    -- already there; somebody else has since removed it, and that is a
    -- conflict rather than a fresh start.
    if p_expected_revision is not null then
      raise exception using
        errcode = '40001',
        message = 'the draft this edit was based on no longer exists';
    end if;
    created := true;
    next_revision := 1;
    insert into public.study_experience_draft (
      study_id, tenant_id, schema_version, revision, definition,
      created_by, updated_by, created_at, updated_at
    ) values (
      target.id, target.tenant_id, p_schema_version, next_revision, p_definition,
      p_actor, p_actor, now(), now()
    );
  else
    -- Updating. A caller that does not say what it is replacing is refused: a
    -- blind write is exactly the lost update this column exists to prevent.
    if p_expected_revision is null then
      raise exception using
        errcode = '40001',
        message = 'this study already has a draft; reload before saving';
    end if;
    if p_expected_revision <> current.revision then
      raise exception using
        errcode = '40001',
        message = 'somebody else saved a newer version of this draft';
    end if;
    next_revision := current.revision + 1;
    update public.study_experience_draft
       set schema_version = p_schema_version,
           revision       = next_revision,
           definition     = p_definition,
           updated_by     = p_actor,
           updated_at     = now()
     where study_id = target.id;
  end if;

  insert into public.study_experience_event (
    study_id, tenant_id, actor_user_id, action, revision, note
  ) values (
    target.id,
    target.tenant_id,
    p_actor,
    case when created then 'draft_created' else 'draft_saved' end,
    next_revision,
    p_note
  );

  return jsonb_build_object(
    'studyId', target.id,
    'revision', next_revision,
    'created', created
  );
end;
$$;

comment on function public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text) is
  'The only write path for a composed-experience draft. Re-checks the internal role, derives the tenant from the study row, refuses a document that names another study or client, and refuses a write whose expected revision is not the stored one (SQLSTATE 40001).';

-- PostgreSQL grants EXECUTE on a new function to PUBLIC, which `anon` and
-- `authenticated` inherit. The revoke precedes the grant in the same migration
-- so no window exists in which the default stands.
revoke execute on function public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text)
  from public, anon, authenticated;
grant execute on function public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text)
  to service_role;

revoke execute on function public.refuse_experience_revision_update() from public, anon, authenticated;

commit;
