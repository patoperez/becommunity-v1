-- =============================================================================
-- 0025 — Publication, version history and rollback for composed experiences
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization + storage. This migration EVOLVES the model
-- migration 0023 established rather than adding a second, competing one. It
-- creates ONE table, adds columns to two, widens one CHECK constraint, renames
-- two columns on a table that has never held a row, and creates three write
-- functions. It rewrites no row, drops no object, and changes no existing
-- policy or grant beyond the new table's own defaults.
--
-- `supabase/rollbacks/0025_drop_experience_publication.sql` reverses exactly
-- this file, statement for statement.
--
-- -----------------------------------------------------------------------------
-- THE LIFECYCLE, AND WHERE EACH STATE PHYSICALLY LIVES
-- -----------------------------------------------------------------------------
--
--   Borrador          `study_experience_draft`. Mutable, one per study, never
--                     visible to a client. Unchanged by this migration.
--
--   Revisión preparada
--                     one row in `study_experience_revision`. An IMMUTABLE
--                     snapshot of an exact draft revision, carrying the
--                     canonical definition hash, the draft revision it came
--                     from, and a fingerprint of the study/configuration it was
--                     computed against. It is not yet anything a client sees.
--
--   Publicada         `study_experience_publication.active_revision_id` points
--                     at it. That pointer row is the ONLY mutable thing in the
--                     publication model, and it holds no history: it is one
--                     answer to "what is a client served right now".
--
--   Sustituida        a revision that a later publication event replaced. It is
--                     not marked, moved, edited or deleted — it is simply no
--                     longer the row the pointer names, and the event that
--                     replaced it records that it did
--                     (`replaced_revision_id`).
--
--   Restaurada        a NEW `study_experience_event` row of kind `restored`,
--                     pointing at a revision that was already published once.
--                     Rollback never rewrites history to pretend it did not
--                     happen; it appends the fact that somebody went back.
--
-- STATUS IS DERIVED, NEVER STORED ON THE IMMUTABLE ROW. A revision's state is a
-- fact about the pointer and the event log at a moment in time, and a column
-- saying `superseded` would have to be UPDATEd on a table whose whole purpose
-- is that it is never updated. Deriving it costs one join and cannot drift.
--
-- -----------------------------------------------------------------------------
-- WHAT IS NEVER STORED HERE
-- -----------------------------------------------------------------------------
-- No calculated dashboard number. A revision stores the CONFIGURATION and the
-- fingerprints; every aggregate a client is shown is still computed at request
-- time by the canonical engine from the study's own rows. Freezing numbers into
-- a publication would make a delivered report disagree with the data behind it
-- the first time a correction was imported, and nobody would be told.
--
-- -----------------------------------------------------------------------------
-- WHY `published_by` / `published_at` ARE RENAMED RATHER THAN REUSED
-- -----------------------------------------------------------------------------
-- 0023 created them on the assumption that a revision is written AT the moment
-- it is published. It is not: a revision is PREPARED first, reviewed exactly as
-- it would be served, and only then selected as the active one — and the same
-- revision can be selected more than once, because that is what a rollback is.
-- A single `published_at` on the revision row could therefore only ever record
-- one of several publications, which is a column that is wrong as often as it
-- is right.
--
-- The table has never held a row (verified against the linked project before
-- this migration was written), so the rename destroys nothing and is exactly
-- reversible. Publication times live in the event log, where there can be more
-- than one of them.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The immutable revision becomes a PREPARED revision
-- -----------------------------------------------------------------------------
alter table public.study_experience_revision
  rename column published_by to prepared_by;
alter table public.study_experience_revision
  rename column published_at to prepared_at;

alter table public.study_experience_revision
  -- The canonical definition hash: SHA-256 over the key-sorted serialization
  -- `src/lib/experience/serialize.ts` produces. It is what makes "this is the
  -- same arrangement" checkable without diffing two documents field by field,
  -- and it is what the review screen, the history screen and the gates all
  -- quote. Lower-case hex, exactly 64 characters, checked here so a truncated
  -- or upper-cased value cannot be stored and then fail to match forever.
  add column if not exists definition_sha256 text not null
    check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  -- The EXACT draft revision this snapshot was taken from. A prepared revision
  -- is a statement about one draft revision; without this the staleness rule
  -- has nothing to compare against.
  add column if not exists source_draft_revision bigint not null
    check (source_draft_revision >= 1),
  -- A stamp over the study and configuration the review was carried out
  -- against — the semantic registry, the sample-visibility policy and the
  -- category grouping. Bounded, opaque, and never a fragment of the study.
  add column if not exists study_fingerprint text not null
    check (char_length(study_fingerprint) between 1 and 200),
  -- The EXACT warning codes a named person acknowledged, sorted by the
  -- application before it is sent. Publication re-asserts this set: an
  -- acknowledgement of three warnings does not authorize publishing a fourth.
  add column if not exists acknowledged_warnings text[] not null default '{}',
  add column if not exists acknowledged_by uuid references auth.users (id) on delete set null,
  add column if not exists acknowledged_at timestamptz,
  -- Why this revision was prepared, in the author's own words. Internal, and
  -- never rendered to a client.
  add column if not exists prepared_note text
    check (prepared_note is null or char_length(prepared_note) <= 200);

-- A warning code is a short identifier from a closed vocabulary, never free
-- text a person typed. Bounded at the database so the column cannot become a
-- second, unreviewed note field.
alter table public.study_experience_revision
  add constraint study_experience_revision_ack_bounded
  check (
    array_length(acknowledged_warnings, 1) is null
    or (
      array_length(acknowledged_warnings, 1) <= 64
      and array_to_string(acknowledged_warnings, ',') ~ '^[a-z0-9_,]*$'
      and char_length(array_to_string(acknowledged_warnings, ',')) <= 2048
    )
  );

comment on column public.study_experience_revision.prepared_at is
  'When this immutable snapshot was taken. NOT when it was published: a revision may be published, superseded and restored, so publication times live in study_experience_event where there can be more than one.';

comment on column public.study_experience_revision.definition_sha256 is
  'SHA-256 over the canonical, key-sorted serialization of the definition. The identity a review screen, a history row and a gate all quote.';

-- -----------------------------------------------------------------------------
-- 2. The audit trail learns the publication vocabulary
-- -----------------------------------------------------------------------------
-- 0023 already reserved `published` / `unpublished` in this constraint,
-- precisely so this milestone would not have to rewrite it blind. It still has
-- to be widened for `revision_prepared` and `restored`, which 0023 could not
-- have named because the shape of a rollback had not been decided.
do $$
declare
  constraint_name text;
begin
  -- Found by what it CHECKS rather than by the name PostgreSQL happened to
  -- generate, so this migration does not depend on a naming convention it did
  -- not choose.
  select con.conname into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'study_experience_event'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%draft_created%';
  if constraint_name is not null then
    execute format('alter table public.study_experience_event drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.study_experience_event
  add constraint study_experience_event_action_check
  check (action in (
    'draft_created',
    'draft_saved',
    'revision_prepared',
    'published',
    'restored',
    'unpublished'
  ));

alter table public.study_experience_event
  -- Which immutable revision this event is about. Null for the two draft
  -- actions, which are about a draft revision NUMBER and not about a snapshot.
  add column if not exists revision_id uuid
    references public.study_experience_revision (id) on delete cascade,
  -- The revision that STOPPED being the active one because of this event. This
  -- is the whole superseded relationship, and it is also the whole rollback
  -- relationship: a restore records what it displaced exactly as a publication
  -- does.
  add column if not exists replaced_revision_id uuid
    references public.study_experience_revision (id) on delete cascade,
  -- The warning codes acknowledged for THIS act.
  add column if not exists acknowledged_warnings text[] not null default '{}',
  -- The caller's own name for one attempt. A network retry carries the same
  -- key, finds the event it already wrote, and returns it instead of
  -- publishing twice.
  add column if not exists idempotency_key text
    check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_.:-]{8,120}$');

-- One event per (study, key). This is the idempotency guarantee, and it is a
-- database constraint rather than a read-then-write in the function, because a
-- read-then-write has a window and two retries can land inside it.
create unique index if not exists study_experience_event_idempotency_idx
  on public.study_experience_event (study_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists study_experience_event_revision_idx
  on public.study_experience_event (revision_id)
  where revision_id is not null;

-- The audit trail is append-only at the privilege level already (0023 granted
-- `service_role` SELECT and nothing else, and every write goes through a
-- security-definer function). The trigger makes it append-only for the OWNER
-- too, which is the same protection `study_experience_revision` has had since
-- 0023 and for the same reason.
--
-- DELETE IS DELIBERATELY NOT REFUSED. `study_id` cascades from `public.study`,
-- and a trigger that raised on DELETE would make a study undeletable — which
-- would break the disposable-fixture cleanup every live gate depends on, and
-- would be discovered at the worst possible moment. No role holds the DELETE
-- privilege, which is the control that actually applies to an API caller.
create or replace function public.refuse_experience_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '2F002',
    message = 'a composed-experience event is append-only';
end;
$$;

drop trigger if exists refuse_update on public.study_experience_event;
create trigger refuse_update
  before update on public.study_experience_event
  for each row execute function public.refuse_experience_event_update();

revoke execute on function public.refuse_experience_event_update() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. The active pointer — one row per study, and the only mutable thing here
-- -----------------------------------------------------------------------------
create table if not exists public.study_experience_publication (
  study_id           uuid primary key references public.study (id) on delete cascade,
  tenant_id          uuid not null references public.tenant (id) on delete cascade,
  -- What a client is served.
  --
  -- `on delete cascade` rather than `restrict`, and the reason is worth stating
  -- because `restrict` reads as the safer word. Deleting a STUDY cascades to
  -- its revisions and to this row at the same time, and PostgreSQL does not
  -- promise which one it reaches first — a `restrict` here would therefore make
  -- a study undeletable at random, which would break the disposable-fixture
  -- cleanup every live gate ends with. What actually protects an active
  -- revision from being removed is that NO ROLE HOLDS DELETE on
  -- `study_experience_revision`: there is no path that removes one except
  -- removing the whole study, and that removes this row with it.
  active_revision_id uuid not null
                       references public.study_experience_revision (id) on delete cascade,
  -- The event that put it there. Read by the history screen to mark the active
  -- row and to say whether it got there by a publication or by a restoration.
  active_event_id    uuid not null,
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create index if not exists study_experience_publication_tenant_idx
  on public.study_experience_publication (tenant_id, updated_at desc);

comment on table public.study_experience_publication is
  'Which immutable revision each study currently serves to its client. One row per study, mutated only by publish_/restore_study_experience_revision under optimistic concurrency. It holds NO history: history is study_experience_event, which is append-only.';

alter table public.study_experience_publication enable row level security;
alter table public.study_experience_publication force row level security;

drop policy if exists "deny_browser_roles" on public.study_experience_publication;
create policy "deny_browser_roles" on public.study_experience_publication
  for all to anon, authenticated using (false) with check (false);

-- Least privilege, exactly as 0023 established it for its three tables:
-- migration 0001's default privileges are revoked and only SELECT is granted
-- back, so even the application's privileged role cannot move a study's
-- published revision except through the functions below.
revoke all privileges on table public.study_experience_publication from anon, authenticated;
revoke all privileges on table public.study_experience_publication from service_role;
grant select on table public.study_experience_publication to service_role;

-- -----------------------------------------------------------------------------
-- 4. Who may prepare, and who may publish
-- -----------------------------------------------------------------------------
-- ONE PLACE, DELIBERATELY. Today the product has exactly two roles, `internal`
-- and `client`, and CEO and employee accounts are both `internal` with the same
-- permissions. So the honest statement is: the privileged role for preparing,
-- publishing and restoring is `internal`, and it is checked against the
-- database rather than against anything the caller sent. It is factored out
-- here so that a future publisher tier is one function body rather than three
-- copies that can disagree — not because such a tier exists today.
create or replace function public.assert_experience_publisher(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;
end;
$$;

revoke execute on function public.assert_experience_publisher(uuid) from public, anon, authenticated;
grant execute on function public.assert_experience_publisher(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Preparing an immutable revision from an exact draft revision
-- -----------------------------------------------------------------------------
-- The snapshot is not "whatever the browser posted". The function compares the
-- definition it is given against the STORED DRAFT at the revision the caller
-- named, as `jsonb` — which is key-order-insensitive, so it is an equality of
-- documents rather than of bytes. A prepared revision is therefore provably the
-- draft it claims to be, even if every layer above this one were bypassed.
create or replace function public.prepare_study_experience_revision(
  p_study_id             uuid,
  p_actor                uuid,
  p_definition           jsonb,
  p_schema_version       integer,
  p_source_draft_revision bigint,
  p_definition_sha256    text,
  p_study_fingerprint    text,
  p_acknowledged_warnings text[] default '{}',
  p_blocking_codes       text[] default '{}',
  p_note                 text default null,
  p_idempotency_key      text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target       public.study%rowtype;
  draft        public.study_experience_draft%rowtype;
  existing     public.study_experience_event%rowtype;
  new_revision bigint;
  revision_row public.study_experience_revision%rowtype;
  event_id     uuid;
begin
  perform public.assert_experience_publisher(p_actor);

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  -- IDEMPOTENCY, BEFORE ANYTHING IS WRITTEN. A retry of the same attempt
  -- returns the revision the first attempt created. The unique index is what
  -- makes this safe under a genuine race; this lookup is what makes the retry
  -- return the right answer instead of a constraint violation.
  if p_idempotency_key is not null then
    select * into existing
      from public.study_experience_event
     where study_id = target.id
       and idempotency_key = p_idempotency_key;
    if found then
      if existing.action <> 'revision_prepared' then
        raise exception using
          errcode = '55000',
          message = 'that idempotency key already names a different action';
      end if;
      select * into revision_row
        from public.study_experience_revision where id = existing.revision_id;
      return jsonb_build_object(
        'revisionId', revision_row.id,
        'revision', revision_row.revision,
        'created', false,
        'eventId', existing.id
      );
    end if;
  end if;

  -- A blocker is a finding the product would be lying about, and the surface
  -- that can see one needs the semantic registry, which this function does not
  -- have. What it CAN do is refuse to record a preparation the application
  -- itself says is blocked, so a caller cannot skip its own preflight and still
  -- get a revision.
  if p_blocking_codes is not null and array_length(p_blocking_codes, 1) is not null then
    raise exception using
      errcode = '55000',
      message = 'this revision has findings that block publication';
  end if;

  if p_definition_sha256 is null or p_definition_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'definition hash is malformed';
  end if;
  if p_study_fingerprint is null or char_length(p_study_fingerprint) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'study fingerprint is malformed';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception using errcode = '22023', message = 'note is too long';
  end if;
  if p_schema_version is null or p_schema_version < 1 or p_schema_version > 1000 then
    raise exception using errcode = '22023', message = 'unsupported schema version';
  end if;
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'definition must be an object';
  end if;
  if octet_length(p_definition::text) > 524288 then
    raise exception using errcode = '22023', message = 'definition is too large';
  end if;
  -- The same three agreements `save_study_experience_draft` enforces. A
  -- document that names another study or another client cannot be snapshotted
  -- against this one.
  if (p_definition #>> '{schemaVersion}') is distinct from p_schema_version::text then
    raise exception using errcode = '22023', message = 'schema version disagrees with the document';
  end if;
  if (p_definition #>> '{metadata,studyId}') is distinct from target.id::text then
    raise exception using errcode = '22023', message = 'definition names another study';
  end if;
  if (p_definition #>> '{metadata,tenantId}') is distinct from target.tenant_id::text then
    raise exception using errcode = '22023', message = 'definition names another client';
  end if;

  -- The draft, locked, so no save can land between the comparison and the
  -- snapshot.
  select * into draft
    from public.study_experience_draft
   where study_id = target.id
     for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'this study has no saved draft to prepare from';
  end if;
  if draft.revision <> p_source_draft_revision then
    raise exception using
      errcode = '55000',
      message = 'the draft moved on while this revision was being reviewed';
  end if;
  -- `jsonb` equality, not text equality: key order is an accident of
  -- construction and must not be the difference between a valid snapshot and a
  -- refusal.
  if draft.definition <> p_definition then
    raise exception using
      errcode = '55000',
      message = 'this snapshot is not the saved draft at that revision';
  end if;

  -- Revision numbers are per study, monotonic, and never reused. `for update`
  -- on the draft row above is what serialises two concurrent preparations of
  -- the same study, so the max() below cannot be read twice with the same
  -- answer.
  select coalesce(max(revision), 0) + 1 into new_revision
    from public.study_experience_revision
   where study_id = target.id;

  insert into public.study_experience_revision (
    study_id, tenant_id, revision, schema_version, definition,
    prepared_by, prepared_at, definition_sha256, source_draft_revision,
    study_fingerprint, acknowledged_warnings, acknowledged_by, acknowledged_at,
    prepared_note
  ) values (
    target.id, target.tenant_id, new_revision, p_schema_version, p_definition,
    p_actor, now(), p_definition_sha256, p_source_draft_revision,
    p_study_fingerprint, coalesce(p_acknowledged_warnings, '{}'),
    case when coalesce(array_length(p_acknowledged_warnings, 1), 0) > 0 then p_actor end,
    case when coalesce(array_length(p_acknowledged_warnings, 1), 0) > 0 then now() end,
    p_note
  ) returning * into revision_row;

  insert into public.study_experience_event (
    study_id, tenant_id, actor_user_id, action, revision, note,
    revision_id, acknowledged_warnings, idempotency_key
  ) values (
    target.id, target.tenant_id, p_actor, 'revision_prepared', new_revision, p_note,
    revision_row.id, coalesce(p_acknowledged_warnings, '{}'), p_idempotency_key
  ) returning id into event_id;

  return jsonb_build_object(
    'revisionId', revision_row.id,
    'revision', new_revision,
    'created', true,
    'eventId', event_id
  );
end;
$$;

comment on function public.prepare_study_experience_revision(uuid, uuid, jsonb, integer, bigint, text, text, text[], text[], text, text) is
  'Takes an immutable snapshot of the saved draft at an exact revision. Re-checks the internal role, derives the tenant from the study row, refuses a document that is not the stored draft at that revision, refuses a preparation the caller itself reports as blocked, and is idempotent per (study, idempotency key).';

-- -----------------------------------------------------------------------------
-- 6. The one body publication and restoration share
-- -----------------------------------------------------------------------------
-- Publication and restoration differ in two facts — whether the snapshot must
-- still match the draft, and which word the event records. Everything else is
-- identical, and writing it twice is how the two start disagreeing about who
-- may do it.
create or replace function public.select_study_experience_revision(
  p_study_id                  uuid,
  p_actor                     uuid,
  p_revision_id               uuid,
  p_expected_active_revision_id uuid,
  p_acknowledged_warnings     text[],
  p_blocking_codes            text[],
  p_note                      text,
  p_idempotency_key           text,
  p_kind                      text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target      public.study%rowtype;
  revision_row public.study_experience_revision%rowtype;
  pointer     public.study_experience_publication%rowtype;
  draft       public.study_experience_draft%rowtype;
  existing    public.study_experience_event%rowtype;
  previous_id uuid;
  event_id    uuid;
begin
  if p_kind not in ('published', 'restored') then
    raise exception using errcode = '22023', message = 'unsupported publication kind';
  end if;

  perform public.assert_experience_publisher(p_actor);

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  if p_idempotency_key is not null then
    select * into existing
      from public.study_experience_event
     where study_id = target.id
       and idempotency_key = p_idempotency_key;
    if found then
      if existing.action <> p_kind then
        raise exception using
          errcode = '55000',
          message = 'that idempotency key already names a different action';
      end if;
      return jsonb_build_object(
        'revisionId', existing.revision_id,
        'eventId', existing.id,
        'replacedRevisionId', existing.replaced_revision_id,
        'kind', existing.action,
        'created', false
      );
    end if;
  end if;

  if p_blocking_codes is not null and array_length(p_blocking_codes, 1) is not null then
    raise exception using
      errcode = '55000',
      message = 'this revision has findings that block publication';
  end if;

  -- THE REVISION, AND THE TENANT IT BELONGS TO.
  --
  -- Both are checked. A revision id is a well-formed uuid whatever tenant it
  -- came from, and a valid identifier from another client is exactly the
  -- request this check exists to refuse — the study row is the authority on
  -- which tenant this is, never the caller.
  select * into revision_row
    from public.study_experience_revision
   where id = p_revision_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'that revision does not exist';
  end if;
  if revision_row.study_id <> target.id or revision_row.tenant_id <> target.tenant_id then
    raise exception using
      errcode = '42501',
      message = 'that revision belongs to another study';
  end if;

  -- THE ACKNOWLEDGEMENT, EXACTLY. Publication re-asserts the set the prepared
  -- revision recorded; an acknowledgement of three warnings never authorizes a
  -- fourth. A restoration passes null: it is republishing something a person
  -- already acknowledged once, and re-typing the same consent adds nothing.
  if p_acknowledged_warnings is not null then
    if coalesce(array_length(p_acknowledged_warnings, 1), 0)
       <> coalesce(array_length(revision_row.acknowledged_warnings, 1), 0)
       or not (
         p_acknowledged_warnings <@ revision_row.acknowledged_warnings
         and revision_row.acknowledged_warnings <@ p_acknowledged_warnings
       ) then
      raise exception using
        errcode = '55000',
        message = 'the acknowledged warnings are not the ones this revision recorded';
    end if;
  end if;

  -- STALENESS — publication only. The snapshot must still BE the saved draft:
  -- same revision number and the same document. A restoration is a deliberate
  -- return to something older and is not held to this.
  if p_kind = 'published' then
    select * into draft
      from public.study_experience_draft
     where study_id = target.id
       for update;
    if not found then
      raise exception using
        errcode = '55000',
        message = 'this study no longer has the draft this revision was prepared from';
    end if;
    if draft.revision <> revision_row.source_draft_revision
       or draft.definition <> revision_row.definition then
      raise exception using
        errcode = '55000',
        message = 'the draft changed after this revision was prepared; prepare a fresh one';
    end if;
  end if;

  -- THE POINTER, LOCKED. Two people publishing different revisions at the same
  -- moment: one wins, the other is told what happened rather than silently
  -- overwriting it.
  select * into pointer
    from public.study_experience_publication
   where study_id = target.id
     for update;
  previous_id := case when found then pointer.active_revision_id end;

  if p_expected_active_revision_id is distinct from previous_id then
    raise exception using
      errcode = '55000',
      message = 'the published revision changed while you were deciding; reload and look again';
  end if;

  insert into public.study_experience_event (
    study_id, tenant_id, actor_user_id, action, revision, note,
    revision_id, replaced_revision_id, acknowledged_warnings, idempotency_key
  ) values (
    target.id, target.tenant_id, p_actor, p_kind, revision_row.revision, p_note,
    revision_row.id, previous_id,
    coalesce(p_acknowledged_warnings, revision_row.acknowledged_warnings, '{}'),
    p_idempotency_key
  ) returning id into event_id;

  if previous_id is null then
    insert into public.study_experience_publication (
      study_id, tenant_id, active_revision_id, active_event_id, updated_by, updated_at
    ) values (
      target.id, target.tenant_id, revision_row.id, event_id, p_actor, now()
    );
  else
    update public.study_experience_publication
       set active_revision_id = revision_row.id,
           active_event_id    = event_id,
           updated_by         = p_actor,
           updated_at         = now()
     where study_id = target.id;
  end if;

  return jsonb_build_object(
    'revisionId', revision_row.id,
    'revision', revision_row.revision,
    'eventId', event_id,
    'replacedRevisionId', previous_id,
    'kind', p_kind,
    'created', true
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Publishing — one atomic selection of an already-prepared revision
-- -----------------------------------------------------------------------------
-- Everything below happens in ONE statement's transaction. Either the event is
-- written and the pointer moves, or neither happens and the client keeps being
-- served exactly what they were being served before.
create or replace function public.publish_study_experience_revision(
  p_study_id                  uuid,
  p_actor                     uuid,
  p_revision_id               uuid,
  p_expected_active_revision_id uuid default null,
  p_acknowledged_warnings     text[] default '{}',
  p_blocking_codes            text[] default '{}',
  p_note                      text default null,
  p_idempotency_key           text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.select_study_experience_revision(
    p_study_id, p_actor, p_revision_id, p_expected_active_revision_id,
    p_acknowledged_warnings, p_blocking_codes, p_note, p_idempotency_key,
    'published'
  );
end;
$$;

comment on function public.publish_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text) is
  'Atomically makes one prepared revision the active client experience. Refuses a stale snapshot, a mismatched acknowledgement, a lost pointer update and a cross-tenant revision; idempotent per (study, idempotency key).';

-- -----------------------------------------------------------------------------
-- 8. Restoring — a NEW publication event pointing at an OLDER revision
-- -----------------------------------------------------------------------------
-- The same transaction, the same guarantees, and deliberately NOT the same
-- word. Nothing is deleted, nothing is rewritten, and the revision being
-- replaced stays in history exactly where it was.
--
-- The one rule it does not share with publication is the staleness check: a
-- restoration is a deliberate return to something older, so "the draft has
-- moved on since this was prepared" is the normal case rather than a refusal.
create or replace function public.restore_study_experience_revision(
  p_study_id                  uuid,
  p_actor                     uuid,
  p_revision_id               uuid,
  p_expected_active_revision_id uuid,
  p_reason                    text,
  p_idempotency_key           text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if reason is null then
    raise exception using errcode = '22023', message = 'a restoration has to say why';
  end if;
  return public.select_study_experience_revision(
    p_study_id, p_actor, p_revision_id, p_expected_active_revision_id,
    null, '{}', reason, p_idempotency_key, 'restored'
  );
end;
$$;

comment on function public.restore_study_experience_revision(uuid, uuid, uuid, uuid, text, text) is
  'Atomically returns a study to a previously prepared revision by APPENDING a restoration event. Nothing is deleted and no historical row is rewritten. Requires a stated reason; idempotent per (study, idempotency key).';

-- -----------------------------------------------------------------------------
-- 9. Privileges
-- -----------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on a new function to PUBLIC, which `anon` and
-- `authenticated` inherit. The revoke precedes the grant in the same
-- transaction, so no window exists in which the default stands.
revoke execute on function public.prepare_study_experience_revision(uuid, uuid, jsonb, integer, bigint, text, text, text[], text[], text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_study_experience_revision(uuid, uuid, jsonb, integer, bigint, text, text, text[], text[], text, text)
  to service_role;

revoke execute on function public.publish_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text)
  from public, anon, authenticated;
grant execute on function public.publish_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text)
  to service_role;

revoke execute on function public.restore_study_experience_revision(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.restore_study_experience_revision(uuid, uuid, uuid, uuid, text, text)
  to service_role;

-- The shared body is an implementation detail of the two above. NOBODY holds
-- EXECUTE on it — not even `service_role` — so the only ways in are the two
-- named entry points, each of which states its own rules.
revoke execute on function public.select_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text, text)
  from public, anon, authenticated, service_role;

commit;
