-- =============================================================================
-- 0029 — durable canonical presentation drafts, BESIDE the legacy ones
-- =============================================================================
-- Depends on the study and tenant tables the chain established, and belongs to
-- the canonical set because a canonical presentation only means anything where
-- canonical results exist. Additive only: it creates two tables and one
-- function, alters no existing table, drops nothing, rewrites no row, and
-- changes no existing policy or grant outside its own objects.
--
-- NOT APPLIED TO THE HOSTED PROJECT. Like the rest of the canonical set, this
-- migration is proved against a disposable database and applied nowhere else.
--
-- HUMAN-REVIEW ZONE: authorization, least privilege and storage.
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS A NEW TABLE AND NOT A NEW ROW IN THE OLD ONE
-- -----------------------------------------------------------------------------
-- The question was asked of a real PostgreSQL before it was answered, against a
-- disposable database carrying the whole chain, with a legacy draft planted at
-- schema_version 2 revision 72 exactly as the hosted project holds one. Three
-- things came back, and together they settle it:
--
--   1. `study_experience_draft`'s PRIMARY KEY is `study_id` ALONE. A second
--      draft row for one study is refused with SQLSTATE 23505. So a canonical
--      draft cannot sit beside a legacy draft in that table — there is no
--      "beside" there.
--
--   2. `save_study_experience_draft` ACCEPTED a canonical document against that
--      legacy row. It moved revision 72 to 73, changed schema_version from 2 to
--      4, and replaced the definition bytes. It refuses nothing about the
--      family of the document: its only version rule is that the JSON's own
--      `schemaVersion` agrees with the argument, and its column admits anything
--      from 1 to 1000. The legacy draft was destroyed by a function doing
--      exactly what it was written to do.
--
--   3. There is no idempotency of any kind on that draft path. Replaying an
--      identical save — the ordinary consequence of a lost response — is
--      refused as a conflict, indistinguishable from somebody else's edit. The
--      `idempotency_key` column and its unique index exist on
--      `study_experience_event`, and only the publication RPC takes one.
--
-- The table accepting JSON is therefore not a licence to put canonical JSON in
-- it. Widening that table's primary key would not be additive — it would alter
-- a constraint on a table holding rows this project must not disturb, and every
-- existing reader of it assumes one draft per study. A separate table is the
-- smallest change that makes the legacy rows STRUCTURALLY unreachable from the
-- canonical path rather than merely unvisited by it.
--
-- -----------------------------------------------------------------------------
-- WHAT A ROW HOLDS, AND WHAT IT MUST NEVER HOLD
-- -----------------------------------------------------------------------------
-- A presentation document is CONFIGURATION: pages, blocks, layout, chart
-- choices, filter panels, explicit connections, authored copy, and references
-- to results by opaque registry handle. It carries no respondent, no answer, no
-- quote, no canonical address and no metric key. `src/lib/presentation/document.ts`
-- is the schema its contents must satisfy before they ever reach here, and
-- `src/lib/presentation/persistence.ts` is the only thing that shapes the
-- envelope this column stores.
--
-- The identity columns are DERIVED FROM THE DOCUMENT and repeated in the row on
-- purpose: a question like "which registry build was this authored against"
-- must be answerable without parsing half a megabyte of jsonb, and a CHECK
-- constraint can only defend a column.
--
-- `definition_sha256` is the AUTHOR'S digest over the canonical, key-sorted
-- serialization — the one `serializeDeterministic` produces. The database
-- cannot recompute it, because `jsonb::text` is PostgreSQL's own rendering and
-- not that serialization. It is stored so the reader that decodes the row can
-- verify the bytes it got are the bytes that were written, which is an
-- end-to-end checksum against corruption and against a write that went around
-- the encoder. It is deliberately NOT described as authentication: a caller who
-- can execute the function can supply both halves.
--
-- ROLLBACK, EXACTLY: supabase/rollbacks/0029_drop_canonical_presentation_draft.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The draft
-- -----------------------------------------------------------------------------
create table public.canonical_presentation_draft (
  study_id            uuid primary key references public.study (id) on delete cascade,
  tenant_id           uuid not null references public.tenant (id) on delete cascade,

  -- The family, as a column. A row of another family cannot be written here
  -- even by a caller holding the table's privileges directly.
  document_kind       text not null
                        check (document_kind = 'canonical_presentation'),

  -- EQUALITY, not a range. The legacy table's `between 1 and 1000` is what let
  -- a canonical document overwrite a legacy row; this column admits exactly the
  -- one version this path implements, so a future version is a deliberate
  -- migration rather than an accident.
  schema_version      integer not null check (schema_version = 4),

  -- The presentation-registry build the document was authored against.
  registry_version    text not null
                        check (registry_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),

  -- The registry fingerprint the document is bound to. A stored draft is always
  -- bound: binding is what makes a layout a document ABOUT a study, and an
  -- unbound row could never resolve.
  binding_fingerprint text not null
                        check (binding_fingerprint ~ '^[0-9a-f]{64}$'),

  revision            bigint not null default 1 check (revision >= 1),

  definition          jsonb not null
                        check (jsonb_typeof(definition) = 'object')
                        check (octet_length(definition::text) <= 524288),
  definition_sha256   text not null
                        check (definition_sha256 ~ '^[0-9a-f]{64}$'),

  created_by          uuid references auth.users (id) on delete set null,
  updated_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index canonical_presentation_draft_tenant_idx
  on public.canonical_presentation_draft (tenant_id, updated_at desc);

comment on table public.canonical_presentation_draft is
  'The mutable canonical presentation draft of one study, schema version four only. Presentation configuration: pages, blocks, layout, filter panels and authored copy, referencing results by opaque registry handle. Never a respondent, an answer, a quote, a canonical address or a metric key. It is a SEPARATE table from the legacy experience draft, so a legacy draft cannot be reached, reinterpreted or overwritten from this path.';

comment on column public.canonical_presentation_draft.revision is
  'Optimistic-concurrency token. save_canonical_presentation_draft refuses a write whose expected revision is not the stored one, so two editors cannot silently overwrite each other.';

comment on column public.canonical_presentation_draft.definition_sha256 is
  'The author digest over the canonical key-sorted serialization of the stored definition. An end-to-end checksum a reader verifies, not an authentication of the caller.';

-- -----------------------------------------------------------------------------
-- 2. The append-only event log
-- -----------------------------------------------------------------------------
-- Bounded metadata: who, when, which revision, and the idempotency key the save
-- was sent under. Never a definition and never a respondent.
--
-- THIS TABLE IS ALSO THE IDEMPOTENCY LEDGER. A save carrying a key that already
-- appears here for this study is a REPLAY: the function returns the revision it
-- returned the first time and writes nothing. That is what makes a retry after
-- a lost response safe, and it is why the unique index is not merely an index.
create table public.canonical_presentation_draft_event (
  id              uuid primary key default gen_random_uuid(),
  study_id        uuid not null references public.study (id) on delete cascade,
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  actor_user_id   uuid,
  action          text not null check (action in ('draft_created', 'draft_saved')),
  revision        bigint not null check (revision >= 1),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  note            text check (note is null or char_length(note) <= 200),
  occurred_at     timestamptz not null default now()
);

create unique index canonical_presentation_draft_event_idempotency_idx
  on public.canonical_presentation_draft_event (study_id, idempotency_key)
  where idempotency_key is not null;

create index canonical_presentation_draft_event_study_idx
  on public.canonical_presentation_draft_event (study_id, occurred_at desc);

comment on table public.canonical_presentation_draft_event is
  'Who saved a canonical presentation draft, when, to which revision, and under which idempotency key. Append-only: the refuse_canonical_presentation_event_update trigger raises on UPDATE. Bounded metadata only — never a definition, a respondent, an answer or a quote.';

create or replace function public.refuse_canonical_presentation_event_update()
returns trigger
language plpgsql
set search_path = ''
as $refuse$
begin
  raise exception using
    errcode = '2F002',
    message = 'a canonical presentation draft event is append-only';
end;
$refuse$;

drop trigger if exists refuse_update on public.canonical_presentation_draft_event;
create trigger refuse_update
  before update on public.canonical_presentation_draft_event
  for each row execute function public.refuse_canonical_presentation_event_update();

revoke execute on function public.refuse_canonical_presentation_event_update()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Lockdown — RLS, FORCE RLS, no browser role, and READ-ONLY for service_role
-- -----------------------------------------------------------------------------
-- `grant select`, not `grant all`. The only legitimate writer of either table is
-- the SECURITY DEFINER function below, which re-checks the actor's role and
-- derives the tenant from the study row. A service_role that could UPDATE the
-- draft directly could move a revision without an event and without a check,
-- which is the whole property this unit exists to guarantee. This is stricter
-- than the canonical data migrations, which grant all privileges because their
-- tables are bulk-written by the commit function.
do $security$
declare
  target text;
begin
  foreach target in array array['canonical_presentation_draft', 'canonical_presentation_draft_event'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('alter table public.%I force row level security', target);
    execute format(
      'create policy "deny_browser_roles" on public.%I for all to anon, authenticated using (false) with check (false)',
      target
    );
    execute format('revoke all privileges on table public.%I from anon, authenticated', target);
    execute format('revoke all privileges on table public.%I from service_role', target);
    execute format('grant select on table public.%I to service_role', target);
  end loop;
end $security$;

-- -----------------------------------------------------------------------------
-- 4. The only write path
-- -----------------------------------------------------------------------------
-- ORDER MATTERS AND IS THE POINT.
--
--   1. the actor is authorized BEFORE anything is read or locked;
--   2. the study row is read, and the TENANT COMES FROM IT — a caller never
--      names a tenant, so a caller cannot name somebody else's;
--   3. the document is checked for family, version and scope before it is
--      believed, so a legacy blob and a document about another study are both
--      refused here as well as in the encoder that produced them;
--   4. an idempotency key already recorded for this study SHORT-CIRCUITS — the
--      first answer is returned again and nothing is written;
--   5. an advisory lock on the study is taken BEFORE the first read a decision
--      depends on, so two concurrent saves of one study cannot both read the
--      same revision — including the case where no row exists yet, which a
--      row-level FOR UPDATE cannot lock and the legacy function therefore
--      leaves open;
--   6. the row and its event are written in the SAME transaction, so a failure
--      anywhere leaves neither.
--
-- 55000 rather than 40001 for a conflict: PostgREST retries a serialization
-- failure, so 40001 never reaches the caller. Migration 0024 learned that on the
-- legacy path and the lesson is not relearned here.
create or replace function public.save_canonical_presentation_draft(
  p_study_id            uuid,
  p_actor               uuid,
  p_definition          jsonb,
  p_registry_version    text,
  p_binding_fingerprint text,
  p_definition_sha256   text,
  p_expected_revision   bigint default null,
  p_idempotency_key     text default null,
  p_note                text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $save$
declare
  target        public.study%rowtype;
  current_row   public.canonical_presentation_draft%rowtype;
  replayed      public.canonical_presentation_draft_event%rowtype;
  created       boolean := false;
  next_revision bigint;
begin
  -- 1. AUTHORIZATION, before anything else happens.
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  -- 2. SCOPE, read from the database rather than accepted from the caller.
  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  -- 3. THE DOCUMENT, checked before it is believed.
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'definition must be an object';
  end if;
  if octet_length(p_definition::text) > 524288 then
    raise exception using errcode = '22023', message = 'definition is too large';
  end if;
  -- THE TYPE, AND THEN THE VALUE. `#>>` renders a jsonb value as text, which
  -- erases the difference between the NUMBER 4 and the STRING "4": both render
  -- as `4`, so a value check alone admits a document whose `schemaVersion` is a
  -- string. Nothing could then read that row back — the decoder requires a
  -- number — so the write would succeed and the draft would be permanently
  -- unopenable. The product's own validator refuses it long before here, which
  -- is exactly why this boundary must not assume the product is its only caller.
  if jsonb_typeof(p_definition -> 'documentKind') is distinct from 'string'
     or (p_definition #>> '{documentKind}') is distinct from 'canonical_presentation' then
    raise exception using errcode = '22023',
      message = 'this path stores canonical presentation documents only';
  end if;
  if jsonb_typeof(p_definition -> 'schemaVersion') is distinct from 'number'
     or (p_definition #>> '{schemaVersion}') is distinct from '4' then
    raise exception using errcode = '22023',
      message = 'this path stores schema version four only';
  end if;
  if jsonb_typeof(p_definition -> 'registryVersion') is distinct from 'string'
     or (p_definition #>> '{registryVersion}') is distinct from p_registry_version then
    raise exception using errcode = '22023',
      message = 'registry version disagrees with the document';
  end if;
  -- An unbound document is refused BEFORE the comparison, because two nulls are
  -- not distinct from each other and a template would otherwise walk past it.
  if p_binding_fingerprint is null then
    raise exception using errcode = '22023',
      message = 'an unbound document is not stored';
  end if;
  if jsonb_typeof(p_definition -> 'binding') is distinct from 'string'
     or (p_definition #>> '{binding}') is distinct from p_binding_fingerprint then
    raise exception using errcode = '22023',
      message = 'binding disagrees with the document';
  end if;
  if (p_definition #>> '{metadata,studyId}') is distinct from target.id::text then
    raise exception using errcode = '22023', message = 'definition names another study';
  end if;
  if (p_definition #>> '{metadata,tenantId}') is distinct from target.tenant_id::text then
    raise exception using errcode = '22023', message = 'definition names another client';
  end if;
  if p_definition_sha256 is null or p_definition_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'the definition digest is malformed';
  end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,120}$' then
    raise exception using errcode = '22023', message = 'the idempotency key is malformed';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception using errcode = '22023', message = 'note is too long';
  end if;

  -- 4. THE LOCK, TAKEN BEFORE THE FIRST READ THAT A DECISION DEPENDS ON.
  --
  -- `select … for update` locks a row that EXISTS. When none does it locks
  -- nothing, so two concurrent first saves both find no row, both insert, and
  -- the loser gets a primary-key violation — an untyped error a caller cannot
  -- tell from a real fault, arriving where a conflict was expected. The legacy
  -- draft function has exactly that hole and this one does not: an advisory
  -- lock keyed on the study serializes every save of the same study, whether a
  -- row exists yet or not.
  --
  -- It also closes the same hole in the replay check below, where two saves
  -- carrying one idempotency key would both miss the event and both insert it.
  --
  -- Transaction-scoped, so it is released by COMMIT or ROLLBACK and never has
  -- to be released by hand. A hash collision between two studies costs a little
  -- waiting and can never cost correctness.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  -- 5. THE REPLAY. A key already recorded for this study answers with the
  --    revision it produced the first time, and writes nothing at all.
  --
  -- IT ALSO ANSWERS WITH WHERE THE ROW IS NOW, and that is not decoration.
  --
  -- A replay says "the save under this key was applied, at revision N". It does
  -- NOT say "the draft is that save". Between the original attempt and the
  -- replay, somebody else may have saved twice: the key's revision is still N
  -- and the row is at N+2, holding a different document. A caller that read only
  -- `revision` would see a success, find the document it sent unchanged on
  -- screen, and report it stored — while the store holds somebody else's.
  --
  -- So both numbers cross. When they differ, the caller has been superseded and
  -- must say so rather than say «Guardado».
  if p_idempotency_key is not null then
    select * into replayed
      from public.canonical_presentation_draft_event
     where study_id = target.id
       and idempotency_key = p_idempotency_key;
    if found then
      select * into current_row
        from public.canonical_presentation_draft
       where study_id = target.id;
      return jsonb_build_object(
        'studyId', target.id,
        'revision', replayed.revision,
        'currentRevision', coalesce(current_row.revision, replayed.revision),
        'created', replayed.action = 'draft_created',
        'replayed', true
      );
    end if;
  end if;

  -- 6. THE ROW, read under the lock taken above.
  select * into current_row
    from public.canonical_presentation_draft
   where study_id = target.id
     for update;

  if not found then
    if p_expected_revision is not null then
      raise exception using errcode = '55000',
        message = 'the draft this edit was based on no longer exists';
    end if;
    created := true;
    next_revision := 1;
    insert into public.canonical_presentation_draft (
      study_id, tenant_id, document_kind, schema_version, registry_version,
      binding_fingerprint, revision, definition, definition_sha256,
      created_by, updated_by, created_at, updated_at
    ) values (
      target.id, target.tenant_id, 'canonical_presentation', 4, p_registry_version,
      p_binding_fingerprint, next_revision, p_definition, p_definition_sha256,
      p_actor, p_actor, now(), now()
    );
  else
    if p_expected_revision is null then
      raise exception using errcode = '55000',
        message = 'this study already has a canonical draft; reload before saving';
    end if;
    if p_expected_revision <> current_row.revision then
      raise exception using errcode = '55000',
        message = 'somebody else saved a newer version of this draft';
    end if;
    next_revision := current_row.revision + 1;
    update public.canonical_presentation_draft
       set registry_version    = p_registry_version,
           binding_fingerprint = p_binding_fingerprint,
           revision            = next_revision,
           definition          = p_definition,
           definition_sha256   = p_definition_sha256,
           updated_by          = p_actor,
           updated_at          = now()
     where study_id = target.id;
  end if;

  -- 7. THE EVENT, in the same transaction as the row it describes.
  insert into public.canonical_presentation_draft_event (
    study_id, tenant_id, actor_user_id, action, revision, idempotency_key, note
  ) values (
    target.id,
    target.tenant_id,
    p_actor,
    case when created then 'draft_created' else 'draft_saved' end,
    next_revision,
    p_idempotency_key,
    p_note
  );

  -- `currentRevision` equals `revision` on a real write by construction: this
  -- transaction holds the advisory lock and has just set the row to it. It is
  -- returned anyway so a caller reads ONE shape and never has to know which
  -- branch answered.
  return jsonb_build_object(
    'studyId', target.id,
    'revision', next_revision,
    'currentRevision', next_revision,
    'created', created,
    'replayed', false
  );
end;
$save$;

comment on function public.save_canonical_presentation_draft(uuid, uuid, jsonb, text, text, text, bigint, text, text) is
  'The only write path for a canonical presentation draft. Authorizes the actor before reading anything, derives the tenant from the study row, refuses a document of another family, version, study or client, replays an idempotency key without writing, and refuses a write whose expected revision is not the stored one (SQLSTATE 55000). It cannot reach the legacy experience draft: that table is not named anywhere in its body, which a migration-chain assertion checks.';

revoke execute on function public.save_canonical_presentation_draft(uuid, uuid, jsonb, text, text, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.save_canonical_presentation_draft(uuid, uuid, jsonb, text, text, text, bigint, text, text)
  to service_role;

commit;
