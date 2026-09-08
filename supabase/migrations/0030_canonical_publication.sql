-- =============================================================================
-- 0030 — the canonical publication lifecycle, in tables of its own
-- =============================================================================
-- Depends on the canonical presentation draft the previous migration created,
-- and belongs to the canonical set for the same reason it does: a canonical
-- publication only means anything where a canonical draft exists. Additive
-- only: it creates three tables and four functions, alters no existing table,
-- drops nothing, rewrites no row, and changes no policy or grant outside its
-- own objects.
--
-- APPLIED TO NO PROJECT. Unlike the presentation-draft migration, this one has
-- been proved against a disposable PostgreSQL and applied nowhere else. The
-- hosted activation is a later, separately authorized phase.
--
-- HUMAN-REVIEW ZONE: authorization, least privilege and storage.
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- WHY THE EXISTING PUBLICATION MODEL COULD NOT BE REUSED
-- -----------------------------------------------------------------------------
-- The question was put to a real PostgreSQL before it was answered.
-- `scripts/canonical-publication-audit.mjs` applies the whole chain to a
-- disposable database, plants the two legacy experience drafts exactly as the
-- hosted project holds them, saves a canonical schema-version-four draft beside
-- one of them through its own RPC, and then asks the experience-publication
-- migration to publish it. Nine findings came back, every one the outcome of a
-- statement that ran rather than of an argument about the SQL:
--
--   A  `prepare_study_experience_revision` reads the LEGACY draft table by study
--      id and compares the snapshot against that row. It cannot see the
--      canonical draft at all — refused 55000 at the canonical revision AND at
--      the legacy one — so it can never originate from an exact canonical draft
--      revision, which is the first lifecycle invariant.
--
--   B  `study_experience_revision.schema_version` is CHECKed as a RANGE and the
--      table carries no family discriminator. A schema-version-TWO legacy
--      definition was accepted there as a prepared revision.
--
--   C  The active pointer is keyed on `study_id` ALONE and the revision table is
--      unique on `(study_id, revision)`. Two families would share ONE pointer
--      and ONE version sequence: publishing either would replace what the other
--      had published, and a canonical version number would be decided by how
--      many legacy revisions happened to exist.
--
--   D  A legacy revision carries one unstructured `study_fingerprint` of up to
--      200 characters — the audit stored the single character «x» in it — and no
--      column for the binding, the registry build, the results contract, the
--      calculation version, the package identity or the plan. Binding, package
--      and calculation identity cannot be stored, compared or attributed there.
--
--   E  UPDATE is refused twice and DELETE only by privilege: the audit deleted a
--      prepared revision as the table owner. Every SECURITY DEFINER function
--      runs as that owner.
--
--   F  Publication re-reads the LEGACY draft and refuses unless the snapshot is
--      still that row — so a canonical publication's staleness would be decided
--      by a legacy v2/v3 document.
--
--   G  The only route into that path is to write the canonical document INTO the
--      legacy draft, which the legacy save RPC accepts: a planted v2 row at
--      revision 72 became a v4 row at revision 73 with different bytes.
--      Publishing canonically through the legacy model REQUIRES destroying a
--      legacy draft.
--
--   H  The legacy event log's `action` CHECK is a closed six-value legacy
--      vocabulary — a canonical action is refused 23514 — over one shared
--      `(study_id, idempotency_key)` namespace, on a table holding 86 hosted
--      rows.
--
--   I  A legacy revision stores CONFIGURATION and fingerprints and nothing else,
--      by its own stated design, and recomputes every published number at
--      request time from current data.
--
-- So this migration is the smallest additive answer: canonical-only storage, in
-- its own tables, that cannot collide with the legacy model because it does not
-- share an object with it.
--
-- -----------------------------------------------------------------------------
-- REPRODUCIBILITY NEEDS BOTH HALVES, AND THAT IS THE ONE REAL DESIGN DECISION
-- -----------------------------------------------------------------------------
-- A publication must reproduce the EXACT render model a person approved, even
-- after the working draft, the canonical rows, the calculators or the registry
-- have moved. Two candidate answers exist and neither is sufficient alone.
--
--   STORING THE RESOLVED RENDER MODEL is what makes reproduction exact. It is
--   already a public shape — finished, formatted values with no address, no
--   canonical key and no respondent — so storing it adds no new disclosure. It
--   is the only mechanism that survives a change to the code that produced it.
--   Measured on the real approved layout: 24 blocks, 77 660 serialized bytes.
--
--   PINNING THE CANONICAL PACKAGE IDENTITY is what makes DRIFT VISIBLE. A stored
--   model alone cannot tell anybody that the study's evidence has since been
--   re-imported; and the moment a reader is offered a filter, a figure has to be
--   recomputed, and it must be provably recomputed over the same package. The
--   binding fingerprint already digests the study scope, the plan, the package,
--   both versions and the whole handle-to-address map, and it is stored beside
--   its parts so a mismatch can be ATTRIBUTED rather than merely detected.
--
-- BOTH, therefore. The render model is the answer that is served; the identity
-- columns are the answer to "is this still true of the study", asked every time
-- a review or a later publication runs. Neither substitutes for the other.
--
-- -----------------------------------------------------------------------------
-- WHAT A ROW MAY NEVER HOLD
-- -----------------------------------------------------------------------------
-- No respondent, no answer, no quote, no canonical address, no metric key, no
-- threshold and no formula. A render model is finished text and finished
-- numbers; a definition is configuration. `src/lib/presentation/render-model.ts`
-- is the shape the first column must satisfy and `document.ts` the second, both
-- long before either reaches here.
--
-- ROLLBACK, EXACTLY: supabase/rollbacks/0030_drop_canonical_publication.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The immutable publication snapshot
-- -----------------------------------------------------------------------------
create table public.canonical_presentation_revision (
  id                  uuid primary key default gen_random_uuid(),
  study_id            uuid not null references public.study (id) on delete cascade,
  tenant_id           uuid not null references public.tenant (id) on delete cascade,

  -- The publication version, per study, monotonic and never reused. It is
  -- deliberately NOT called `revision`: a draft revision and a publication
  -- version are different sequences that a reviewer has to be able to say apart
  -- out loud, and one word for both is how «revisión 3» stops meaning anything.
  version             bigint not null check (version >= 1),

  -- The family, the version, and the registry build — as columns, so a question
  -- about identity is answerable without parsing a megabyte of jsonb, and so a
  -- CHECK can defend it.
  document_kind       text not null check (document_kind = 'canonical_presentation'),
  -- EQUALITY, never a range. The audit's finding B is the whole reason.
  schema_version      integer not null check (schema_version = 4),
  registry_version    text not null check (registry_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  binding_fingerprint text not null check (binding_fingerprint ~ '^[0-9a-f]{64}$'),

  -- IDENTITY, IN PARTS. The binding fingerprint above is a digest OVER all of
  -- these, so it already refuses when any of them moves. They are stored beside
  -- it because a digest says only THAT something moved; these say WHICH, and a
  -- reviewer told "the package changed" can act where one told "the fingerprint
  -- changed" can only shrug.
  results_contract_version text not null check (results_contract_version ~ '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'),
  calculation_version text not null check (calculation_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
  spec_id             text not null check (spec_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  mapping_version     integer not null check (mapping_version >= 1),
  package_idempotency_key text not null check (package_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._+-]{0,199}$'),
  plan_fingerprint    text not null check (plan_fingerprint ~ '^[A-Za-z0-9][A-Za-z0-9:._+-]{0,199}$'),

  -- The EXACT canonical draft revision this snapshot was taken from. Without it
  -- "publish exactly what was reviewed" has nothing to be exact about.
  source_draft_revision bigint not null check (source_draft_revision >= 1),

  -- WHAT WAS APPROVED, in both halves.
  definition          jsonb not null
                        check (jsonb_typeof(definition) = 'object')
                        check (octet_length(definition::text) <= 524288),
  definition_sha256   text not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  -- The resolved render model — the reproducibility half. Four mebibytes, which
  -- is a little over twenty-five times the real approved layout's 77 660 bytes
  -- and a bound that stops a pathological document rather than a real one.
  render_model        jsonb not null
                        check (jsonb_typeof(render_model) = 'object')
                        check (octet_length(render_model::text) <= 2097152),
  render_model_sha256 text not null check (render_model_sha256 ~ '^[0-9a-f]{64}$'),

  -- The EXACT warning codes a named person acknowledged, sorted by the caller.
  -- A closed short vocabulary, never free text: this column must not become a
  -- second, unreviewed note field.
  acknowledged_warnings text[] not null default '{}'
    check (
      array_length(acknowledged_warnings, 1) is null
      or (
        array_length(acknowledged_warnings, 1) <= 64
        and array_to_string(acknowledged_warnings, ',') ~ '^[a-z0-9_,]*$'
        and char_length(array_to_string(acknowledged_warnings, ',')) <= 2048
      )
    ),

  -- A PLAIN UUID, WITH NO FOREIGN KEY, AND THAT IS A CORRECTION.
  --
  -- The earlier publication model declares `prepared_by … references auth.users
  -- on delete set null` on a table whose trigger refuses every UPDATE. Those two
  -- decisions cannot both hold: removing an authentication identity makes
  -- PostgreSQL issue exactly that UPDATE, the trigger raises 2F002, and the user
  -- becomes undeletable for as long as the row exists. An immutable row must not
  -- participate in `on delete set null` at all. The earlier event table already
  -- reached the same conclusion and stores a bare uuid; this does too.
  published_by        uuid,
  published_at        timestamptz not null default now(),
  note                text check (note is null or char_length(note) <= 200),

  -- One row per (study, version). A second publication under one version is a
  -- bug, and the database says so rather than storing two answers to one
  -- question.
  unique (study_id, version)
);

create index canonical_presentation_revision_study_idx
  on public.canonical_presentation_revision (study_id, version desc);

comment on table public.canonical_presentation_revision is
  'An IMMUTABLE canonical publication snapshot: the exact schema-version-four presentation document that was approved, the resolved render model it produced, and the identity it was produced under. Written once and never updated; deletable only with the whole study. It is a SEPARATE table from the legacy experience publication model, so the two can never share a version sequence, a pointer or a family. The legacy tables are named in this file only inside its header, never in a statement, so a textual gate can prove this path cannot reach them.';

comment on column public.canonical_presentation_revision.render_model is
  'The resolved render model as approved. Stored so a publication reproduces exactly what a person saw, whatever later happens to the draft, the canonical rows or the code. Finished values only: no address, no canonical key, no respondent, no threshold and no formula.';

comment on column public.canonical_presentation_revision.version is
  'The publication version, per study. Deliberately not called a revision: a draft revision is a different sequence and one word for both makes a review conversation ambiguous.';

-- -----------------------------------------------------------------------------
-- 2. The current-publication pointer — one row per study
-- -----------------------------------------------------------------------------
-- The ONLY mutable thing in this model, and it holds no history: it is one
-- answer to "what would a client be served right now". History is the event
-- log, which is append-only.
create table public.canonical_presentation_publication (
  study_id           uuid primary key references public.study (id) on delete cascade,
  tenant_id          uuid not null references public.tenant (id) on delete cascade,
  -- `on delete cascade` rather than `restrict`, deliberately. Deleting a STUDY
  -- cascades to its snapshots and to this row at the same time and PostgreSQL
  -- does not promise which it reaches first, so `restrict` would make a study
  -- undeletable at random and break every disposable fixture's cleanup. What
  -- protects a snapshot is that no role holds DELETE and the trigger below
  -- refuses one whose study still exists.
  active_revision_id uuid not null references public.canonical_presentation_revision (id) on delete cascade,
  -- The event that put it there, so a history screen can say whether the
  -- current version got there by a publication and when.
  active_event_id    uuid not null,
  updated_by         uuid references auth.users (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create index canonical_presentation_publication_tenant_idx
  on public.canonical_presentation_publication (tenant_id, updated_at desc);

comment on table public.canonical_presentation_publication is
  'Which immutable canonical snapshot each study currently serves. One row per study, moved only by publish_canonical_presentation under optimistic concurrency, and holding no history of its own.';

-- -----------------------------------------------------------------------------
-- 3. The append-only lifecycle log, and the idempotency ledger
-- -----------------------------------------------------------------------------
-- Bounded metadata: who, when, which version, what it replaced, which warnings
-- were acknowledged, and the key the attempt was sent under. Never a definition,
-- never a render model, never a respondent.
create table public.canonical_presentation_publication_event (
  id                   uuid primary key default gen_random_uuid(),
  study_id             uuid not null references public.study (id) on delete cascade,
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  actor_user_id        uuid,
  -- TWO ACTIONS, AND NO THIRD RESERVED. Migration 0023 reserved two words it
  -- did not implement and a later migration had to widen the constraint anyway,
  -- so reserving buys nothing and invites somebody to write a value nothing
  -- handles. `restored` does NOT move the pointer: it records that a snapshot
  -- was brought back into the working draft as a new draft revision.
  action               text not null check (action in ('published', 'restored')),
  version              bigint not null check (version >= 1),
  revision_id          uuid not null references public.canonical_presentation_revision (id) on delete cascade,
  -- What STOPPED being the current publication because of this event. Null for
  -- the first publication and for every restoration, which replaces nothing.
  replaced_revision_id uuid references public.canonical_presentation_revision (id) on delete cascade,
  -- The draft revision a restoration created. Null for a publication.
  draft_revision       bigint check (draft_revision is null or draft_revision >= 1),
  acknowledged_warnings text[] not null default '{}',
  idempotency_key      text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  note                 text check (note is null or char_length(note) <= 200),
  occurred_at          timestamptz not null default now()
);

-- One event per (study, key). The idempotency guarantee is a database
-- constraint rather than a read-then-write, because a read-then-write has a
-- window and two retries can land inside it.
create unique index canonical_presentation_publication_event_idempotency_idx
  on public.canonical_presentation_publication_event (study_id, idempotency_key)
  where idempotency_key is not null;

create index canonical_presentation_publication_event_study_idx
  on public.canonical_presentation_publication_event (study_id, occurred_at desc);

comment on table public.canonical_presentation_publication_event is
  'Who published or restored a canonical presentation, when, to which version, what it replaced and under which idempotency key. Append-only, and the idempotency ledger for both operations. Bounded metadata only.';

-- -----------------------------------------------------------------------------
-- 4. Immutability, including against the owner — and DELETE included
-- -----------------------------------------------------------------------------
-- The audit's finding E is the reason this is not the earlier model's trigger
-- copied over. That one refuses UPDATE and says nothing about DELETE, on the
-- reasoning that no role holds the privilege — which is true of an API caller
-- and false of every SECURITY DEFINER function, all of which run as the owner.
-- The audit deleted a published snapshot that way in one statement.
--
-- Refusing DELETE outright would make a study undeletable, which is the failure
-- the earlier migration correctly avoided: `study_id` cascades, and a study that
-- cannot be removed breaks every disposable fixture's cleanup at the worst
-- moment. So the refusal is CONDITIONAL on the study still being there. During a
-- cascade the parent row is already gone by the time this fires, so removing a
-- whole study still works and removing one snapshot out from under a published
-- report does not.
create or replace function public.refuse_canonical_publication_change()
returns trigger
language plpgsql
set search_path = ''
as $refuse$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.study where id = old.study_id) then
      raise exception using
        errcode = '2F002',
        message = 'a canonical publication record cannot be deleted while its study exists';
    end if;
    return old;
  end if;
  raise exception using
    errcode = '2F002',
    message = 'a canonical publication record is immutable';
end;
$refuse$;

drop trigger if exists refuse_change on public.canonical_presentation_revision;
create trigger refuse_change
  before update or delete on public.canonical_presentation_revision
  for each row execute function public.refuse_canonical_publication_change();

drop trigger if exists refuse_change on public.canonical_presentation_publication_event;
create trigger refuse_change
  before update or delete on public.canonical_presentation_publication_event
  for each row execute function public.refuse_canonical_publication_change();

revoke execute on function public.refuse_canonical_publication_change()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Lockdown — RLS, FORCE RLS, no browser role, READ-ONLY for service_role
-- -----------------------------------------------------------------------------
-- `grant select`, not `grant all`, exactly as the presentation draft. The only
-- legitimate writer of any of these tables is a SECURITY DEFINER function that
-- re-checks the actor's role and derives the tenant from the study row. A
-- service_role able to UPDATE the pointer directly could move what a client is
-- served with no event, no expected-version check and no lock.
do $security$
declare
  target text;
begin
  foreach target in array array[
    'canonical_presentation_revision',
    'canonical_presentation_publication',
    'canonical_presentation_publication_event'
  ] loop
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
-- 6. Publishing — one atomic act, and the order is the argument
-- -----------------------------------------------------------------------------
--   1. the actor is authorized BEFORE anything is read or locked;
--   2. the study row is read and the TENANT COMES FROM IT — a caller never names
--      a tenant, so a caller cannot name somebody else's;
--   3. everything the caller asserts about the document, the render model and
--      the identity is checked before any of it is believed;
--   4. an advisory lock on the study is taken BEFORE the first read a decision
--      depends on. It is the SAME key the draft save takes, so a publication and
--      a save of one study cannot interleave — the draft cannot move between the
--      staleness check and the snapshot;
--   5. an idempotency key already recorded for this study SHORT-CIRCUITS, and
--      the first answer is returned again with nothing written;
--   6. the DRAFT is read under that lock and must be exactly the revision, the
--      document, the digest, the binding and the registry build the caller
--      claims — six separate comparisons, so a refusal says which one moved;
--   7. the snapshot, the event and the pointer are written in ONE transaction.
--
-- 55000 rather than 40001 for every precondition failure, because PostgREST
-- retries a serialization failure and it would never reach the caller. Migration
-- 0024 learned that on the legacy path and the lesson is not relearned here.
create or replace function public.publish_canonical_presentation(
  p_study_id                 uuid,
  p_actor                    uuid,
  p_source_draft_revision    bigint,
  p_definition               jsonb,
  p_definition_sha256        text,
  p_render_model             jsonb,
  p_render_model_sha256      text,
  p_registry_version         text,
  p_binding_fingerprint      text,
  p_results_contract_version text,
  p_calculation_version      text,
  p_spec_id                  text,
  p_mapping_version          integer,
  p_package_idempotency_key  text,
  p_plan_fingerprint         text,
  p_acknowledged_warnings    text[] default '{}',
  p_blocking_codes           text[] default '{}',
  p_unacknowledged_codes     text[] default '{}',
  p_expected_active_revision_id uuid default null,
  p_idempotency_key          text default null,
  p_note                     text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $publish$
declare
  target       public.study%rowtype;
  draft        public.canonical_presentation_draft%rowtype;
  replayed     public.canonical_presentation_publication_event%rowtype;
  pointer      public.canonical_presentation_publication%rowtype;
  snapshot     public.canonical_presentation_revision%rowtype;
  previous_id  uuid;
  event_id     uuid;
  next_version bigint;
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

  -- 3. WHAT THE CALLER ASSERTS, CHECKED BEFORE IT IS BELIEVED.
  --
  -- A BLOCKER IS THE APPLICATION'S OWN VERDICT, and this function cannot
  -- recompute it: deciding whether a presentation is publishable needs the
  -- registry, the results and the authored policy, none of which exist in SQL.
  -- What it CAN do is refuse to record a publication the application itself
  -- reports as blocked, so a caller cannot skip its own preflight and still get
  -- a version.
  if p_blocking_codes is not null and array_length(p_blocking_codes, 1) is not null then
    raise exception using errcode = '55000',
      message = 'this presentation has findings that block publication';
  end if;
  -- AND A WARNING THAT NOBODY ACKNOWLEDGED IS NOT A WARNING THAT WAS WAIVED.
  -- Separate from the blockers on purpose: they are different sentences to a
  -- reviewer and folding them together would tell somebody their document is
  -- invalid when in fact they simply have not ticked a box.
  if p_unacknowledged_codes is not null and array_length(p_unacknowledged_codes, 1) is not null then
    raise exception using errcode = '55000',
      message = 'this presentation has warnings that nobody has acknowledged';
  end if;

  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'definition must be an object';
  end if;
  if octet_length(p_definition::text) > 524288 then
    raise exception using errcode = '22023', message = 'definition is too large';
  end if;
  if p_render_model is null or jsonb_typeof(p_render_model) <> 'object' then
    raise exception using errcode = '22023', message = 'the render model must be an object';
  end if;
  if octet_length(p_render_model::text) > 2097152 then
    raise exception using errcode = '22023', message = 'the render model is too large';
  end if;

  -- THE TYPE, AND THEN THE VALUE. `#>>` renders a jsonb value as text, which
  -- erases the difference between the NUMBER 4 and the STRING "4". A row whose
  -- schemaVersion is a string would store cleanly and be permanently unreadable,
  -- because every decoder requires a number.
  if jsonb_typeof(p_definition -> 'documentKind') is distinct from 'string'
     or (p_definition #>> '{documentKind}') is distinct from 'canonical_presentation' then
    raise exception using errcode = '22023',
      message = 'this path publishes canonical presentation documents only';
  end if;
  if jsonb_typeof(p_definition -> 'schemaVersion') is distinct from 'number'
     or (p_definition #>> '{schemaVersion}') is distinct from '4' then
    raise exception using errcode = '22023',
      message = 'this path publishes schema version four only';
  end if;
  if jsonb_typeof(p_definition -> 'registryVersion') is distinct from 'string'
     or (p_definition #>> '{registryVersion}') is distinct from p_registry_version then
    raise exception using errcode = '22023',
      message = 'registry version disagrees with the document';
  end if;
  if p_binding_fingerprint is null then
    raise exception using errcode = '22023', message = 'an unbound document is not published';
  end if;
  if jsonb_typeof(p_definition -> 'binding') is distinct from 'string'
     or (p_definition #>> '{binding}') is distinct from p_binding_fingerprint then
    raise exception using errcode = '22023', message = 'binding disagrees with the document';
  end if;
  if (p_definition #>> '{metadata,studyId}') is distinct from target.id::text then
    raise exception using errcode = '22023', message = 'definition names another study';
  end if;
  if (p_definition #>> '{metadata,tenantId}') is distinct from target.tenant_id::text then
    raise exception using errcode = '22023', message = 'definition names another client';
  end if;

  -- THE RENDER MODEL MUST DESCRIBE THE SAME THING THE DOCUMENT DOES. Three
  -- fields it already carries, checked against the identity being recorded, so
  -- a model resolved from another study's registry cannot be filed under this
  -- publication's identity.
  if jsonb_typeof(p_render_model -> 'schemaVersion') is distinct from 'number'
     or (p_render_model #>> '{schemaVersion}') is distinct from '4' then
    raise exception using errcode = '22023',
      message = 'the render model was not resolved from a schema version four document';
  end if;
  if (p_render_model #>> '{registryVersion}') is distinct from p_registry_version then
    raise exception using errcode = '22023',
      message = 'the render model names another registry build';
  end if;
  if (p_render_model #>> '{contractVersion}') is distinct from p_results_contract_version then
    raise exception using errcode = '22023',
      message = 'the render model names another results contract';
  end if;
  if jsonb_typeof(p_render_model -> 'pages') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'the render model has no pages';
  end if;

  if p_definition_sha256 is null or p_definition_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'the definition digest is malformed';
  end if;
  if p_render_model_sha256 is null or p_render_model_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'the render model digest is malformed';
  end if;
  if p_source_draft_revision is null or p_source_draft_revision < 1 then
    raise exception using errcode = '22023', message = 'a publication names the draft revision it came from';
  end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,120}$' then
    raise exception using errcode = '22023', message = 'the idempotency key is malformed';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception using errcode = '22023', message = 'note is too long';
  end if;

  -- 4. THE LOCK, taken before the first read a decision depends on, and keyed
  --    exactly as the draft save keys it so the two serialise against each other.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  -- 5. THE REPLAY. A key already recorded for this study answers with what it
  --    produced the first time and writes nothing at all.
  if p_idempotency_key is not null then
    select * into replayed
      from public.canonical_presentation_publication_event
     where study_id = target.id and idempotency_key = p_idempotency_key;
    if found then
      if replayed.action <> 'published' then
        raise exception using errcode = '55000',
          message = 'that idempotency key already names a different action';
      end if;
      -- WHERE THE POINTER IS NOW, beside what the key produced. A replay says
      -- "the publication under this key happened, at version N". It does NOT say
      -- the study is serving it: somebody may have published twice since. A
      -- caller reading only `version` would report its own work live while a
      -- different version was being served.
      select * into pointer
        from public.canonical_presentation_publication where study_id = target.id;
      return jsonb_build_object(
        'studyId', target.id,
        'revisionId', replayed.revision_id,
        'version', replayed.version,
        'currentRevisionId', pointer.active_revision_id,
        'replacedRevisionId', replayed.replaced_revision_id,
        'created', false,
        'replayed', true
      );
    end if;
  end if;

  -- 6. THE DRAFT, under the lock. Six comparisons, each with its own sentence.
  select * into draft
    from public.canonical_presentation_draft
   where study_id = target.id
     for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'this study has no saved canonical draft to publish';
  end if;
  if draft.revision <> p_source_draft_revision then
    raise exception using errcode = '55000',
      message = 'the draft moved on while this publication was being reviewed';
  end if;
  -- `jsonb` equality, not text equality: key order is an accident of
  -- construction and must not decide whether a review was of this document.
  if draft.definition <> p_definition then
    raise exception using errcode = '55000',
      message = 'this is not the saved draft at that revision';
  end if;
  if draft.definition_sha256 <> p_definition_sha256 then
    raise exception using errcode = '55000',
      message = 'the definition digest is not the one stored beside that draft';
  end if;
  if draft.binding_fingerprint <> p_binding_fingerprint then
    raise exception using errcode = '55000',
      message = 'the binding is not the one that draft was authored against';
  end if;
  if draft.registry_version <> p_registry_version then
    raise exception using errcode = '55000',
      message = 'the registry build is not the one that draft was authored against';
  end if;

  -- 7. THE POINTER, BEFORE ANYTHING IS WRITTEN.
  --
  -- The order matters even though the transaction would roll an early insert
  -- back anyway: a function that writes and then discovers it should not have
  -- is one refactor away from a function that writes and forgets to check. Every
  -- precondition is settled first, and only then does anything become a row.
  select * into pointer
    from public.canonical_presentation_publication
   where study_id = target.id
     for update;
  previous_id := case when found then pointer.active_revision_id end;

  -- TWO PEOPLE DECIDING AT ONCE: one wins, the other is told what happened
  -- rather than silently replacing it.
  if p_expected_active_revision_id is distinct from previous_id then
    raise exception using errcode = '55000',
      message = 'the published version changed while you were deciding; reload and look again';
  end if;

  -- 8. THE VERSION, THE SNAPSHOT, THE POINTER AND THE EVENT — one transaction.
  --
  -- The advisory lock above is what serialises two concurrent publications of
  -- one study, so this `max()` cannot be read twice with the same answer.
  select coalesce(max(version), 0) + 1 into next_version
    from public.canonical_presentation_revision
   where study_id = target.id;

  insert into public.canonical_presentation_revision (
    study_id, tenant_id, version, document_kind, schema_version, registry_version,
    binding_fingerprint, results_contract_version, calculation_version, spec_id,
    mapping_version, package_idempotency_key, plan_fingerprint, source_draft_revision,
    definition, definition_sha256, render_model, render_model_sha256,
    acknowledged_warnings, published_by, published_at, note
  ) values (
    target.id, target.tenant_id, next_version, 'canonical_presentation', 4, p_registry_version,
    p_binding_fingerprint, p_results_contract_version, p_calculation_version, p_spec_id,
    p_mapping_version, p_package_idempotency_key, p_plan_fingerprint, p_source_draft_revision,
    p_definition, p_definition_sha256, p_render_model, p_render_model_sha256,
    coalesce(p_acknowledged_warnings, '{}'), p_actor, now(), p_note
  ) returning * into snapshot;

  insert into public.canonical_presentation_publication_event (
    study_id, tenant_id, actor_user_id, action, version, revision_id,
    replaced_revision_id, acknowledged_warnings, idempotency_key, note
  ) values (
    target.id, target.tenant_id, p_actor, 'published', next_version, snapshot.id,
    previous_id, coalesce(p_acknowledged_warnings, '{}'), p_idempotency_key, p_note
  ) returning id into event_id;

  if previous_id is null then
    insert into public.canonical_presentation_publication (
      study_id, tenant_id, active_revision_id, active_event_id, updated_by, updated_at
    ) values (target.id, target.tenant_id, snapshot.id, event_id, p_actor, now());
  else
    update public.canonical_presentation_publication
       set active_revision_id = snapshot.id,
           active_event_id    = event_id,
           updated_by         = p_actor,
           updated_at         = now()
     where study_id = target.id;
  end if;

  return jsonb_build_object(
    'studyId', target.id,
    'revisionId', snapshot.id,
    'version', next_version,
    'currentRevisionId', snapshot.id,
    'replacedRevisionId', previous_id,
    'created', true,
    'replayed', false
  );
end;
$publish$;

comment on function public.publish_canonical_presentation(uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer, text, text, text[], text[], text[], uuid, text, text) is
  'The only write path for a canonical publication. Authorizes the actor before reading anything, derives the tenant from the study row, refuses a document of another family, version, registry, binding, study or client, refuses a publication the caller itself reports as blocked or unacknowledged, requires the exact canonical draft revision and its stored digest, writes an immutable snapshot carrying the resolved render model, advances the current-publication pointer under optimistic concurrency, and replays an idempotency key without writing. It cannot reach any legacy experience table: none is named in its body.';

-- -----------------------------------------------------------------------------
-- 7. Restoring — a NEW DRAFT REVISION, and never an edit to a snapshot
-- -----------------------------------------------------------------------------
-- Restoration brings an older approved document back into the WORKING DRAFT. It
-- does not move the pointer, does not mark a snapshot superseded, does not
-- unpublish anything and does not delete a row. What a client is served changes
-- only when somebody publishes again — through the whole preflight, against the
-- study's current results.
--
-- THE DRAFT IS WRITTEN THROUGH THE ONE PATH THAT ALREADY EXISTS. This function
-- calls `save_canonical_presentation_draft` rather than writing the row itself,
-- so every refusal that function makes still applies, the draft's own event log
-- records an ordinary save, and its revision moves by exactly one. Writing the
-- row here would be a second write path for a table whose whole design is that
-- it has one.
create or replace function public.restore_canonical_presentation(
  p_study_id                uuid,
  p_actor                   uuid,
  p_revision_id             uuid,
  p_expected_draft_revision bigint,
  p_idempotency_key         text,
  p_reason                  text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $restore$
declare
  target   public.study%rowtype;
  snapshot public.canonical_presentation_revision%rowtype;
  replayed public.canonical_presentation_publication_event%rowtype;
  reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  saved    jsonb;
  event_id uuid;
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  if reason is null then
    raise exception using errcode = '22023', message = 'a restoration has to say why';
  end if;
  if char_length(reason) > 200 then
    raise exception using errcode = '22023', message = 'that reason is too long';
  end if;
  -- SHORTER THAN THE COLUMN ADMITS, because the draft save's key is derived from
  -- this one by suffixing it. A key that fit here and not there would fail
  -- halfway through, which is the one outcome a restoration must not have.
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_.:-]{8,113}$' then
    raise exception using errcode = '22023',
      message = 'a restoration needs an idempotency key of its own';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  if exists (
    select 1 from public.canonical_presentation_publication_event
     where study_id = target.id and idempotency_key = p_idempotency_key
  ) then
    select * into replayed
      from public.canonical_presentation_publication_event
     where study_id = target.id and idempotency_key = p_idempotency_key;
    if replayed.action <> 'restored' then
      raise exception using errcode = '55000',
        message = 'that idempotency key already names a different action';
    end if;
    return jsonb_build_object(
      'studyId', target.id,
      'revisionId', replayed.revision_id,
      'version', replayed.version,
      'draftRevision', replayed.draft_revision,
      'replayed', true
    );
  end if;

  -- THE SNAPSHOT, AND THE TENANT IT BELONGS TO. A revision id is a well-formed
  -- uuid whatever study it came from, and a valid identifier from another client
  -- is exactly the request this refuses.
  select * into snapshot
    from public.canonical_presentation_revision where id = p_revision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'that publication does not exist';
  end if;
  if snapshot.study_id <> target.id or snapshot.tenant_id <> target.tenant_id then
    raise exception using errcode = '42501',
      message = 'that publication belongs to another study';
  end if;

  -- The one write path for the draft, called rather than reimplemented. Its own
  -- refusals — family, version, scope, expected revision — all still apply, and
  -- its idempotency key is derived from this one so a replay replays both halves.
  saved := public.save_canonical_presentation_draft(
    target.id,
    p_actor,
    snapshot.definition,
    snapshot.registry_version,
    snapshot.binding_fingerprint,
    snapshot.definition_sha256,
    p_expected_draft_revision,
    p_idempotency_key || '.draft',
    reason
  );

  insert into public.canonical_presentation_publication_event (
    study_id, tenant_id, actor_user_id, action, version, revision_id,
    replaced_revision_id, draft_revision, idempotency_key, note
  ) values (
    target.id, target.tenant_id, p_actor, 'restored', snapshot.version, snapshot.id,
    null, (saved ->> 'revision')::bigint, p_idempotency_key, reason
  ) returning id into event_id;

  return jsonb_build_object(
    'studyId', target.id,
    'revisionId', snapshot.id,
    'version', snapshot.version,
    'draftRevision', (saved ->> 'revision')::bigint,
    'eventId', event_id,
    'replayed', false
  );
end;
$restore$;

comment on function public.restore_canonical_presentation(uuid, uuid, uuid, bigint, text, text) is
  'Brings an approved canonical publication back into the working draft as a NEW draft revision, through the draft save function rather than by writing the row. It never edits, deletes, supersedes or unpublishes the snapshot it came from, and it never moves the current-publication pointer: what a client is served changes only when somebody publishes again.';

-- -----------------------------------------------------------------------------
-- 8. The client-visible read — a projection written in SQL, not in prose
-- -----------------------------------------------------------------------------
-- Everything a reader of a published study may be given, and nothing else:
-- which version, when it was published, and the finished render model. No
-- digest, no draft revision, no acknowledgement, no author, no binding, no
-- package identity, no note. Those are the audit half, they exist for internal
-- review, and a projection expressed as three keys in one statement cannot
-- gradually acquire a fourth by somebody widening a `select *`.
create or replace function public.read_canonical_publication(
  p_study_id  uuid,
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $read$
  select jsonb_build_object(
    'version', r.version,
    'publishedAt', to_char(r.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'renderModel', r.render_model
  )
  from public.canonical_presentation_publication p
  join public.canonical_presentation_revision r on r.id = p.active_revision_id
  where p.study_id = p_study_id
    and p.tenant_id = p_tenant_id;
$read$;

comment on function public.read_canonical_publication(uuid, uuid) is
  'The client-visible read of a study current publication: the version, the moment it was published, and the resolved render model. Every internal field is absent by construction rather than by filtering, and the tenant is required so a study id alone can never fetch another client work.';

-- -----------------------------------------------------------------------------
-- 9. Privileges
-- -----------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE on a new function to PUBLIC, which `anon` and
-- `authenticated` inherit. The revoke precedes the grant in the same
-- transaction, so no window exists in which the default stands.
revoke execute on function public.publish_canonical_presentation(uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer, text, text, text[], text[], text[], uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.publish_canonical_presentation(uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer, text, text, text[], text[], text[], uuid, text, text)
  to service_role;

revoke execute on function public.restore_canonical_presentation(uuid, uuid, uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.restore_canonical_presentation(uuid, uuid, uuid, bigint, text, text)
  to service_role;

revoke execute on function public.read_canonical_publication(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_canonical_publication(uuid, uuid)
  to service_role;

commit;
