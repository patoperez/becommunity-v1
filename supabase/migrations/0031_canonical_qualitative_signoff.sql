-- =============================================================================
-- 0031 — a qualitative sign-off that is about WORDS, and goes stale by itself
-- =============================================================================
-- Additive only. It creates two tables and two functions, alters no existing
-- table, drops nothing, rewrites no row, and changes no existing policy, grant
-- or function outside its own objects. In particular it does NOT replace
-- `publish_canonical_presentation`: that function is applied history on the
-- hosted project and stays byte-identical.
--
-- NOT APPLIED TO THE HOSTED PROJECT. Proved against a disposable PostgreSQL and
-- applied nowhere else. Until it is applied, the review surface's qualitative
-- sign-off cannot be recorded and a publication cannot carry one.
--
-- HUMAN-REVIEW ZONE: authorization, least privilege and storage.
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- WHY THIS EXISTS AT ALL
-- -----------------------------------------------------------------------------
-- `QualitativeGroupResult.reviewStatus` was the literal `'pending'`, written by
-- the results builder on every group of every study for ever. The publication
-- preflight read it and raised «nadie del equipo las ha revisado todavía», so:
--
--   * the warning appeared on every review of every study;
--   * no amount of reviewing could ever clear it;
--   * it named two GROUP labels while THREE blocks of the approved layout draw
--     those categories — «Razones declaradas de riesgo» draws the active group
--     and was never mentioned to the person deciding.
--
-- A permanent warning is one people learn to tick, which is the opposite of
-- what a review boundary is for. The canonical layer cannot know whether a
-- person read something; that is an act, and an act is recorded here.
--
-- -----------------------------------------------------------------------------
-- WHAT A SIGN-OFF IS ABOUT, AND WHAT MAKES IT EXPIRE
-- -----------------------------------------------------------------------------
-- An exact SET OF WORDS: each bound group's label, where its categories came
-- from, and the ordered category labels — digested by
-- `qualitativeEvidenceDigest` in `src/lib/publication/qualitative-signoff.ts`.
-- A category added, removed or renamed moves the digest, and the review is
-- stale with nobody having to remember.
--
-- COUNTS ARE DELIBERATELY OUTSIDE THE DIGEST. Another person answering with a
-- category that already existed changes no word anybody read. Expiring a review
-- for it would make sign-off constant in the other direction, which is the same
-- defect wearing different clothes.
--
-- -----------------------------------------------------------------------------
-- WHAT A ROW MAY HOLD, AND WHAT IT MAY NEVER HOLD
-- -----------------------------------------------------------------------------
-- Closed-coded CATEGORY LABELS, which are the study's own short vocabulary and
-- are already published to a client in the term cloud, plus the authored TITLES
-- of the blocks that draw them. Never a respondent, never an answer, never a
-- quotation, never a name, never the free-text column that sits beside every
-- coded category column and never enters the read model in any shape.
--
-- The CHECK constraints below bound each array's cardinality AND its total
-- length, so a caller cannot post a paragraph into a column meant for a category
-- name. Per-ELEMENT bounds are not possible: PostgreSQL refuses a subquery in a
-- check constraint, and `unnest` is one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The sign-off log
-- -----------------------------------------------------------------------------
-- APPEND-ONLY, and a LOG rather than a single current row. Two reasons, and the
-- second is the one that matters: a review is evidence of what a person decided
-- and when, so overwriting it would destroy the audit it exists to be; and a
-- category set that changes and later changes back has genuinely been reviewed
-- under both digests, which a log can say and a single row cannot.
create table public.canonical_qualitative_signoff (
  id              uuid primary key default gen_random_uuid(),
  study_id        uuid not null references public.study (id) on delete cascade,
  tenant_id       uuid not null references public.tenant (id) on delete cascade,

  -- The digest of the exact category set that was read.
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),

  -- WHAT WAS READ, in the reviewer's own vocabulary, so an auditor can see the
  -- words rather than a hash of them.
  --
  -- BOUNDED BY CARDINALITY AND BY TOTAL LENGTH, NOT PER ELEMENT, and that is a
  -- limitation of CHECK rather than a choice: PostgreSQL refuses a subquery in a
  -- check constraint (0A000), so `unnest` cannot be used to bound each label. It
  -- was tried, and the disposable database said no.
  --
  -- The total is what actually protects the column. A category label is a short
  -- closed-coded word; 512 of them inside 32 KiB is generous for every real
  -- study and still refuses a caller posting a paragraph. `array_to_string`
  -- with an empty delimiter is immutable and subquery-free, so it is legal here.
  category_labels text[] not null
                    check (cardinality(category_labels) between 1 and 512)
                    check (octet_length(array_to_string(category_labels, '')) <= 32768),

  -- The authored titles of the blocks that draw them. «Página · Bloque».
  block_titles    text[] not null
                    check (cardinality(block_titles) between 0 and 256)
                    check (octet_length(array_to_string(block_titles, '')) <= 32768),

  -- A BARE UUID, not a foreign key into `auth.users`.
  --
  -- Migration 0025 made an authentication identity undeletable exactly this
  -- way: `references auth.users on delete set null` on a table whose trigger
  -- refuses every UPDATE means removing a user issues that UPDATE, the trigger
  -- raises 2F002, and the delete fails for as long as the row exists. 0030
  -- learned it and this does not relearn it.
  reviewed_by     uuid not null,
  reviewed_at     timestamptz not null default now(),
  note            text check (note is null or char_length(note) <= 300)
);

create index canonical_qualitative_signoff_study_idx
  on public.canonical_qualitative_signoff (study_id, reviewed_at desc);

create index canonical_qualitative_signoff_digest_idx
  on public.canonical_qualitative_signoff (study_id, evidence_digest, reviewed_at desc);

comment on table public.canonical_qualitative_signoff is
  'A person recording that they read one exact set of qualitative category labels, digested. Append-only. Holds closed-coded category labels and authored block titles only — never a respondent, an answer, a quotation or a name.';

comment on column public.canonical_qualitative_signoff.evidence_digest is
  'sha256 over the bound groups: label, coding provenance, and the ordered category and excluded labels. Counts are deliberately outside it, so a review does not expire because one more person chose a category that already existed.';

-- -----------------------------------------------------------------------------
-- 2. The link from an immutable publication to the sign-off it was made under
-- -----------------------------------------------------------------------------
-- A SEPARATE TABLE, AND THAT IS WHY `publish_canonical_presentation` IS NOT
-- TOUCHED.
--
-- The obvious design is two more columns on `canonical_presentation_revision`
-- and a replaced publish function. That function is 295 lines of applied
-- history; copying it to change four of them would put a near-duplicate in the
-- repository and make every future correction a choice about which copy is the
-- real one.
--
-- ATOMICITY IS NOT TRADED FOR THAT. The wrapper below CALLS the 0030 function
-- and then writes this row in the SAME transaction — a plpgsql function calling
-- another runs inside one — so a publication without its qualitative record
-- cannot exist. The primary key is the revision id, so a publication has at
-- most one, and the cascade means deleting a study takes both.
create table public.canonical_publication_qualitative_signoff (
  revision_id     uuid primary key
                    references public.canonical_presentation_revision (id) on delete cascade,
  study_id        uuid not null references public.study (id) on delete cascade,
  tenant_id       uuid not null references public.tenant (id) on delete cascade,

  -- The state at the moment of publication, in the layer's own closed words.
  --
  -- `pending` and `stale` ARE RECORDABLE, and deliberately. Publishing with
  -- unreviewed categories is a decision a person may legitimately make — it is
  -- a warning, acknowledged in the open — and a record that could only say
  -- «reviewed» would be a record that lies by omission about every other case.
  review_state    text not null
                    check (review_state in ('not_applicable', 'pending', 'stale', 'current')),

  -- The digest of the categories AS PUBLISHED. Null only when the document
  -- binds no qualitative group at all.
  evidence_digest text check (evidence_digest is null or evidence_digest ~ '^[0-9a-f]{64}$'),

  -- The sign-off this publication rested on, when there was one.
  signoff_id      uuid references public.canonical_qualitative_signoff (id) on delete restrict,

  recorded_at     timestamptz not null default now(),

  -- «current» means somebody signed off on exactly these words, so it cannot be
  -- recorded without naming which sign-off and which words.
  constraint canonical_publication_qualitative_signoff_current_is_evidenced
    check (review_state <> 'current' or (signoff_id is not null and evidence_digest is not null)),
  -- And «not applicable» means there were no categories, so it cannot name any.
  constraint canonical_publication_qualitative_signoff_absent_is_empty
    check (review_state <> 'not_applicable' or (signoff_id is null and evidence_digest is null))
);

create index canonical_publication_qualitative_signoff_study_idx
  on public.canonical_publication_qualitative_signoff (study_id, recorded_at desc);

comment on table public.canonical_publication_qualitative_signoff is
  'What the qualitative review state was at the moment one publication was made, and which sign-off it rested on. Written in the same transaction as the publication, immutable afterwards, and removable only with the publication it belongs to.';

-- -----------------------------------------------------------------------------
-- 3. Immutability
-- -----------------------------------------------------------------------------
-- The same shape 0030 uses, and for the same reason: an audit record that can be
-- edited is not one. DELETE is refused only while the parent still exists, so a
-- study can still be deleted whole and a cascade still works.
create or replace function public.refuse_canonical_qualitative_signoff_change()
returns trigger
language plpgsql
set search_path = ''
as $refuse$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '2F002',
      message = 'a canonical qualitative sign-off is immutable';
  end if;
  -- DELETE. Allowed only when the study it belongs to is already gone, which is
  -- what a cascade looks like from inside the trigger.
  if exists (select 1 from public.study where id = old.study_id) then
    raise exception using
      errcode = '2F002',
      message = 'a canonical qualitative sign-off cannot be deleted while its study exists';
  end if;
  return old;
end;
$refuse$;

revoke execute on function public.refuse_canonical_qualitative_signoff_change()
  from public, anon, authenticated;

drop trigger if exists refuse_change on public.canonical_qualitative_signoff;
create trigger refuse_change
  before update or delete on public.canonical_qualitative_signoff
  for each row execute function public.refuse_canonical_qualitative_signoff_change();

drop trigger if exists refuse_change on public.canonical_publication_qualitative_signoff;
create trigger refuse_change
  before update or delete on public.canonical_publication_qualitative_signoff
  for each row execute function public.refuse_canonical_qualitative_signoff_change();

-- -----------------------------------------------------------------------------
-- 4. Lockdown — RLS, FORCE RLS, no browser role, READ-ONLY for service_role
-- -----------------------------------------------------------------------------
-- `grant select`, not `grant all`, exactly as 0029 and 0030 do it. The only
-- legitimate writers are the two SECURITY DEFINER functions below, which
-- re-check the actor's role and derive the tenant from the study row. A
-- service_role that could INSERT here directly could manufacture a review
-- nobody performed, which is the one thing this table exists to make hard.
do $security$
declare
  target text;
begin
  foreach target in array array[
    'canonical_qualitative_signoff',
    'canonical_publication_qualitative_signoff'
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
-- 5. Recording a sign-off
-- -----------------------------------------------------------------------------
-- ORDER MATTERS, and it is the order 0029 established:
--
--   1. the actor is authorized BEFORE anything is read;
--   2. the study row is read and the TENANT COMES FROM IT — a caller never
--      names a tenant, so a caller cannot name somebody else's;
--   3. an advisory lock on the study, so two people signing off at once cannot
--      both read "no review exists" and both insert;
--   4. a sign-off already recorded for this study under this exact digest is
--      returned rather than duplicated. Reviewing the same words twice is not
--      two decisions, and a retry after a lost response must not look like one.
create or replace function public.record_canonical_qualitative_signoff(
  p_study_id        uuid,
  p_actor           uuid,
  p_evidence_digest text,
  p_category_labels text[],
  p_block_titles    text[] default '{}',
  p_note            text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $record$
declare
  target   public.study%rowtype;
  existing public.canonical_qualitative_signoff%rowtype;
  created  public.canonical_qualitative_signoff%rowtype;
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

  if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'an evidence digest is required';
  end if;
  if p_category_labels is null or cardinality(p_category_labels) = 0 then
    raise exception using errcode = '22023',
      message = 'a sign-off must name the categories it is about';
  end if;

  -- 3. THE LOCK, before the first read a decision depends on. `for update`
  --    locks nothing when no row exists yet, which is the hole 0029 recorded in
  --    the legacy draft function; an advisory lock on the study does not have it.
  --
  -- ONE bigint, and `pg_catalog`-qualified. There is no
  -- `pg_advisory_xact_lock(bigint, bigint)` — the two-argument form takes two
  -- INTEGERS — and under `search_path = ''` an unqualified name resolves to
  -- nothing. The first draft of this line had both faults and the disposable
  -- database refused every sign-off it was asked to write. 0029 takes the lock
  -- exactly this way, for exactly this reason.
  --
  -- Transaction-scoped, so COMMIT or ROLLBACK releases it and nothing has to
  -- release it by hand. A hash collision between two studies costs a little
  -- waiting and can never cost correctness.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  -- 4. THE SAME WORDS, ALREADY SIGNED OFF. Returned, never duplicated.
  select * into existing
    from public.canonical_qualitative_signoff
   where study_id = target.id
     and evidence_digest = p_evidence_digest
   order by reviewed_at desc
   limit 1;
  if found then
    return jsonb_build_object(
      'signoffId', existing.id,
      'evidenceDigest', existing.evidence_digest,
      'reviewedAt', existing.reviewed_at,
      'created', false
    );
  end if;

  insert into public.canonical_qualitative_signoff (
    study_id, tenant_id, evidence_digest, category_labels, block_titles, reviewed_by, note
  ) values (
    target.id, target.tenant_id, p_evidence_digest,
    p_category_labels, coalesce(p_block_titles, '{}'), p_actor, p_note
  ) returning * into created;

  return jsonb_build_object(
    'signoffId', created.id,
    'evidenceDigest', created.evidence_digest,
    'reviewedAt', created.reviewed_at,
    'created', true
  );
end;
$record$;

revoke execute on function public.record_canonical_qualitative_signoff(uuid, uuid, text, text[], text[], text)
  from public, anon, authenticated;
grant execute on function public.record_canonical_qualitative_signoff(uuid, uuid, text, text[], text[], text)
  to service_role;

comment on function public.record_canonical_qualitative_signoff(uuid, uuid, text, text[], text[], text) is
  'The only write path for a qualitative sign-off. Authorizes the actor before reading anything, derives the tenant from the study row, locks the study before deciding, and returns the existing record when the same words have already been signed off rather than writing a second decision.';

-- -----------------------------------------------------------------------------
-- 6. Publishing, with the qualitative decision recorded in the same transaction
-- -----------------------------------------------------------------------------
-- IT CALLS 0030's FUNCTION RATHER THAN REPLACING IT. `publish_canonical_presentation`
-- is applied history on the hosted project; a near-duplicate of its 295 lines in
-- this file would make every future correction a choice about which copy is the
-- real one. Everything it refuses — the family, the version, the registry, the
-- binding, the study, the exact draft revision and digest, a caller reporting
-- its own blockers, a moved pointer, a replayed key — it still refuses here,
-- because it is still the thing doing the publishing.
--
-- THE TRANSACTION IS ONE. A plpgsql function calling another runs inside the
-- caller's transaction, so the snapshot and its qualitative record are written
-- together or not at all. There is no window in which a publication exists
-- without one.
--
-- A REPLAY WRITES NOTHING, which is what a replay means. The inner function
-- reports `created`, and the row for that revision already exists from the
-- attempt that made it.
create or replace function public.publish_canonical_presentation_with_qualitative(
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
  p_qualitative_review_state text,
  p_qualitative_digest       text default null,
  p_qualitative_signoff_id   uuid default null,
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
as $publish_q$
declare
  target   public.study%rowtype;
  answer   jsonb;
  revision uuid;
  signoff  public.canonical_qualitative_signoff%rowtype;
begin
  -- 1. AUTHORIZATION, before anything else happens. The inner function checks
  --    it again; this one does not rely on that, because a wrapper that trusted
  --    its callee for authorization would be one refactor from not having any.
  if p_actor is null or not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  if p_qualitative_review_state is null or p_qualitative_review_state not in
     ('not_applicable', 'pending', 'stale', 'current') then
    raise exception using errcode = '22023',
      message = 'a qualitative review state is required to publish';
  end if;

  -- 2. «current» IS A CLAIM ABOUT A ROW, AND THE ROW IS CHECKED.
  --
  -- A caller saying «somebody signed off on exactly these words» must name the
  -- sign-off, and it must belong to this study and carry this digest. Otherwise
  -- the strongest state a publication can record would be the easiest one to
  -- assert.
  if p_qualitative_review_state = 'current' then
    if p_qualitative_signoff_id is null or p_qualitative_digest is null then
      raise exception using errcode = '22023',
        message = 'a current qualitative review must name its sign-off and its digest';
    end if;
    select * into signoff
      from public.canonical_qualitative_signoff
     where id = p_qualitative_signoff_id
       and study_id = target.id;
    if not found then
      raise exception using errcode = '22023',
        message = 'that qualitative sign-off does not belong to this study';
    end if;
    if signoff.evidence_digest <> p_qualitative_digest then
      raise exception using errcode = '55000',
        message = 'the qualitative categories changed since that sign-off; review them again';
    end if;
  end if;

  -- 3. THE PUBLICATION ITSELF, through the one function that performs one.
  answer := public.publish_canonical_presentation(
    p_study_id, p_actor, p_source_draft_revision, p_definition, p_definition_sha256,
    p_render_model, p_render_model_sha256, p_registry_version, p_binding_fingerprint,
    p_results_contract_version, p_calculation_version, p_spec_id, p_mapping_version,
    p_package_idempotency_key, p_plan_fingerprint, p_acknowledged_warnings,
    p_blocking_codes, p_unacknowledged_codes, p_expected_active_revision_id,
    p_idempotency_key, p_note
  );

  -- 4. AND ITS QUALITATIVE RECORD, in this same transaction.
  if (answer ->> 'created')::boolean then
    revision := (answer ->> 'revisionId')::uuid;
    insert into public.canonical_publication_qualitative_signoff (
      revision_id, study_id, tenant_id, review_state, evidence_digest, signoff_id
    ) values (
      revision, target.id, target.tenant_id, p_qualitative_review_state,
      case when p_qualitative_review_state = 'not_applicable' then null else p_qualitative_digest end,
      case when p_qualitative_review_state = 'current' then p_qualitative_signoff_id else null end
    );
  end if;

  return answer || jsonb_build_object('qualitativeReviewState', p_qualitative_review_state);
end;
$publish_q$;

revoke execute on function public.publish_canonical_presentation_with_qualitative(
  uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer,
  text, text, text, text, uuid, text[], text[], text[], uuid, text, text
) from public, anon, authenticated;
grant execute on function public.publish_canonical_presentation_with_qualitative(
  uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer,
  text, text, text, text, uuid, text[], text[], text[], uuid, text, text
) to service_role;

comment on function public.publish_canonical_presentation_with_qualitative(
  uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer,
  text, text, text, text, uuid, text[], text[], text[], uuid, text, text
) is
  'Publish a canonical presentation AND record the qualitative review state it was published under, in one transaction. It does not reimplement publication: it calls publish_canonical_presentation, so every refusal that function makes still applies. A claim that the categories were signed off is checked against the sign-off row and its digest before anything is written.';

-- -----------------------------------------------------------------------------
-- 7. Reading a study's qualitative sign-off history
-- -----------------------------------------------------------------------------
-- Read-only, and it exists so a reader does not need SELECT on the table shape
-- itself. It returns the WORDS and the times, never the actor: who pressed the
-- button is about a person, and the review surface is held to «no PII». The
-- column keeps it for an audit with a different reader.
create or replace function public.read_canonical_qualitative_signoffs(
  p_study_id uuid,
  p_tenant_id uuid,
  p_limit integer default 20
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $read_q$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'signoffId', row.id,
        'evidenceDigest', row.evidence_digest,
        'reviewedAt', row.reviewed_at,
        'categoryCount', cardinality(row.category_labels),
        'blockTitles', to_jsonb(row.block_titles)
      )
      order by row.reviewed_at desc
    ),
    '[]'::jsonb
  )
  from (
    select *
      from public.canonical_qualitative_signoff
     where study_id = p_study_id
       and tenant_id = p_tenant_id
     order by reviewed_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) as row;
$read_q$;

revoke execute on function public.read_canonical_qualitative_signoffs(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.read_canonical_qualitative_signoffs(uuid, uuid, integer)
  to service_role;

comment on function public.read_canonical_qualitative_signoffs(uuid, uuid, integer) is
  'One study''s qualitative sign-offs, newest first: the digest, the time, how many categories were read and which blocks drew them. Never the actor.';
