-- =============================================================================
-- 0034 — canonical category review: deciding that two answers are one category,
--        recorded where the CANONICAL layer can read it and the legacy one
--        cannot.
-- =============================================================================
-- Additive only. It creates ONE table, ONE trigger function, ONE write function
-- and ONE read function. It alters no existing table, adds no column to one,
-- drops nothing, rewrites no row, and changes no existing policy, grant,
-- function or index outside its own objects. In particular it does NOT touch
-- `category_decision`, `study_category_snapshot`, `record_category_decision`,
-- `capture_study_category_snapshot` or `segment_dimension`. Those belong to the
-- pre-canonical semantic category review, they are applied history on the
-- hosted project, and they stay byte-identical.
--
-- NOT APPLIED TO THE HOSTED PROJECT. Proved against a disposable PostgreSQL and
-- applied nowhere else. Until it is applied, the canonical category review reads
-- as NOT PROVISIONED — the current categories are shown, no decision can be
-- recorded, and the resolution every calculation applies is the empty one, which
-- is exactly what a study with no decisions already has.
--
-- HUMAN-REVIEW ZONE: authorization, least privilege, concurrency and storage.
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- WHY A SECOND LEDGER, WHEN 0022 ALREADY BUILT ONE
-- -----------------------------------------------------------------------------
-- `public.category_decision` is a good table. It is append-only at the privilege
-- level, its identity is the folded member list rather than a name, and its
-- write function enforces in SQL the three rules a flat grouping needs. None of
-- that is in question, and none of it is re-litigated here.
--
-- It cannot carry a CANONICAL decision for three measured reasons, and every one
-- of them is about what the table is WIRED TO rather than what it holds:
--
--   1. `record_category_decision` — the only write path that enforces those
--      rules — ends by writing `segment_dimension.config.aliases`, INSERTING a
--      `segment_dimension` row when the dimension does not exist. A canonical
--      family key names no legacy dimension, so a canonical decision recorded
--      through it would manufacture a legacy dimension out of nothing and put a
--      grouping into the legacy calculation's read path.
--
--   2. `capture_study_category_snapshot` folds EVERY decision of a study into
--      `study_category_snapshot.resolution`, whatever its `dimension_key`, and
--      the legacy publication path applies that resolution as aliases. A
--      canonical decision would therefore change LEGACY published numbers for a
--      study, silently, from a surface that never mentions the legacy report.
--
--   3. Both of those functions are LIVE IN PRODUCTION right now, against this
--      same database, from the deployed legacy «Revisar categorías» screen.
--      Two independent projection systems folding one ledger into two different
--      read paths is not shared storage; it is two writers for one meaning.
--
-- Writing the rows directly with `service_role` — which does hold INSERT on that
-- table — would avoid (1) and (2) and lose the thing that makes the ledger worth
-- anything: the rules would live only in the application, and the version chain
-- would have no storage-level guard at all.
--
-- So the decision content is modelled on 0022's, deliberately and almost field
-- for field, and it is stored where only the canonical layer reads it.
--
-- -----------------------------------------------------------------------------
-- WHAT A ROW MAY HOLD, AND WHAT IT MAY NEVER HOLD
-- -----------------------------------------------------------------------------
-- Closed-coded CATEGORY LABELS — the study's own short emergent vocabulary,
-- already published to a client in the term cloud — their folded forms, the name
-- a person chose for a group of them, and a written reason. Never a respondent,
-- never an answer, never the free-text column that sits beside every coded
-- category column and never enters the read model, never a quotation, never a
-- name, never a credential.
--
-- -----------------------------------------------------------------------------
-- AND RAW EVIDENCE IS NEVER REWRITTEN
-- -----------------------------------------------------------------------------
-- Nothing here writes to `survey_response`, `survey_item`, `response_option` or
-- any other canonical table. Grouping happens on the way OUT, in the results
-- builder, over labels this ledger names. Reconciliation against the source
-- workbooks stays exact, the number of people who answered cannot change, and
-- revoking a decision simply makes the next build group differently.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. The decision log
-- -----------------------------------------------------------------------------
-- APPEND-ONLY, and a VERSION CHAIN rather than one current row per group. The
-- reasoning 0022, 0031 and 0032 all record: a review is evidence of what a
-- person decided and when, so overwriting it destroys the audit it exists to be.
-- Undo writes an inverse row; nothing is updated and nothing is deleted.
--
-- IDENTITY IS `member_folds`, NOT A NAME. It is the sorted, de-duplicated list
-- of the folded labels a decision is about, so the same question re-detected in
-- a different order, or after one spelling gained a respondent, is recognised as
-- the same question. The visible name may be rewritten freely; `canonical_key`
-- is allocated once and carried forward across renames, which is the journey
-- editor's lesson — an identifier regenerated from a name is not an identifier.
create table public.canonical_category_decision (
  id             uuid primary key default gen_random_uuid(),
  study_id       uuid not null references public.study (id) on delete cascade,
  tenant_id      uuid not null references public.tenant (id) on delete cascade,

  -- The qualitative family the decision is about: a key of the study's results
  -- specification, not a database identifier and not a legacy dimension.
  family_key     text not null check (family_key ~ '^[a-z0-9_]{1,64}$'),

  -- The labels in question, folded, sorted and de-duplicated, and the labels as
  -- they stood when the decision was taken. The fold is the identity; the raw
  -- spellings are kept because a reader a year later needs to see what was
  -- actually on screen.
  --
  -- BOUNDED BY CARDINALITY AND BY TOTAL LENGTH, NOT PER ELEMENT, and that is a
  -- limitation of CHECK rather than a choice: PostgreSQL refuses a subquery in a
  -- check constraint (0A000), so `unnest` cannot be used to bound each label.
  -- `array_to_string` with an empty delimiter is immutable and subquery-free.
  member_folds   text[] not null
                   check (cardinality(member_folds) between 2 and 12)
                   check (octet_length(array_to_string(member_folds, '')) <= 4096),
  member_labels  text[] not null
                   check (cardinality(member_labels) between 2 and 12)
                   check (octet_length(array_to_string(member_labels, '')) <= 8192),

  -- The digest of the family's exact option set as it stood. Computed on the
  -- server, never accepted from a browser, and compared on every read: a
  -- decision whose family has moved is STALE and says so.
  source_digest  text not null check (source_digest ~ '^[0-9a-f]{64}$'),

  -- The four things a person may decide. There is no value for «nobody looked»:
  -- that is the absence of a row, and a value for it would let «nobody looked»
  -- and «somebody looked and left them apart» be written by the same code path.
  disposition    text not null check (disposition in ('grouped', 'separate', 'postponed', 'revoked')),

  canonical_key   text check (canonical_key is null or canonical_key ~ '^[a-z0-9_]{1,64}$'),
  canonical_label text check (canonical_label is null or char_length(btrim(canonical_label)) between 1 and 200),
  canonical_fold  text check (canonical_fold is null or char_length(canonical_fold) between 1 and 200),

  rationale      text check (rationale is null or char_length(rationale) <= 400),

  version        integer not null check (version > 0),
  previous_id    uuid references public.canonical_category_decision (id),

  -- A BARE UUID, not a foreign key into `auth.users`.
  --
  -- Migration 0025 made an authentication identity undeletable exactly that
  -- way: `references auth.users on delete set null` on a table whose trigger
  -- refuses every UPDATE means removing a user issues that UPDATE, the trigger
  -- raises 2F002, and the delete fails for as long as the row exists. 0030,
  -- 0031 and 0032 all learned it and this does not relearn it.
  decided_by     uuid not null,
  decided_at     timestamptz not null default now(),

  -- A GROUPING NEEDS A NAME AND AN IDENTITY, and nothing else may carry one.
  -- Otherwise a later widening of the read could pick up a name nobody applied.
  constraint canonical_category_decision_label_shape check (
    (disposition = 'grouped'
       and canonical_label is not null and canonical_key is not null and canonical_fold is not null)
    or (disposition <> 'grouped'
       and canonical_label is null and canonical_key is null and canonical_fold is null)
  ),

  -- A DEFERRAL MUST SAY WHY. Without that it is a dismiss button, and a dismiss
  -- button is how a review boundary stops meaning anything.
  constraint canonical_category_decision_postpone_reason check (
    disposition <> 'postponed' or (rationale is not null and char_length(btrim(rationale)) >= 10)
  ),

  -- The folded list and the spellings it was taken from describe the same set.
  constraint canonical_category_decision_members_agree check (
    cardinality(member_folds) = cardinality(member_labels)
  ),

  -- The study a decision names must belong to the tenant it names, proved by a
  -- composite foreign key rather than by application code — the technique 0003
  -- and 0022 both use.
  constraint canonical_category_decision_study_tenant_fkey
    foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade
);

-- OPTIMISTIC CONCURRENCY, ENFORCED BY THE STORAGE.
--
-- The write function takes an advisory lock on the study before it reads the
-- chain head, which is what actually serialises two reviewers. This unique index
-- is the guard that does not depend on anybody remembering to take it: two rows
-- claiming to be version 3 of one group cannot both exist, whatever path wrote
-- them.
create unique index canonical_category_decision_chain_idx
  on public.canonical_category_decision (study_id, family_key, member_folds, version);

create index canonical_category_decision_study_idx
  on public.canonical_category_decision (study_id, decided_at desc);

-- The tenant-wide recall in the read function below scans this.
create index canonical_category_decision_memory_idx
  on public.canonical_category_decision (tenant_id, family_key, member_folds, version desc);

comment on table public.canonical_category_decision is
  'A person deciding that two or more differently written closed-coded answers are one category, for one canonical qualitative family of one study. Append-only; the highest version per (family, member set) is the decision in force. Holds closed-coded category labels and a written reason only — never a respondent, an answer, a quotation, a name or a free-text column.';

comment on column public.canonical_category_decision.member_folds is
  'The sorted, de-duplicated folded labels the decision is about. This IS the group''s identity: the same question re-detected in a different order is recognised as the same question.';

comment on column public.canonical_category_decision.source_digest is
  'sha256 over the family: its key, its coding provenance and its ordered label and excluded-label vocabulary. Counts are deliberately outside it, so a decision does not go stale because one more person chose a label that already existed.';

-- -----------------------------------------------------------------------------
-- 2. Immutability
-- -----------------------------------------------------------------------------
-- The same shape 0030, 0031 and 0032 use, and for the same reason: an audit
-- record that can be edited is not one. Changing a decision means RECORDING A
-- NEW VERSION. DELETE is refused only while the study still exists, so a study
-- can be deleted whole and the cascade still works.
create or replace function public.refuse_canonical_category_change()
returns trigger
language plpgsql
set search_path = ''
as $refuse_c$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '2F002',
      message = 'a category decision is immutable; record a new version instead';
  end if;
  if exists (select 1 from public.study where id = old.study_id) then
    raise exception using
      errcode = '2F002',
      message = 'a category decision cannot be deleted while its study exists';
  end if;
  return old;
end;
$refuse_c$;

revoke execute on function public.refuse_canonical_category_change()
  from public, anon, authenticated;

drop trigger if exists refuse_change on public.canonical_category_decision;
create trigger refuse_change
  before update or delete on public.canonical_category_decision
  for each row execute function public.refuse_canonical_category_change();

-- -----------------------------------------------------------------------------
-- 3. Lockdown — RLS, FORCE RLS, no browser role, READ-ONLY for service_role
-- -----------------------------------------------------------------------------
-- `grant select`, not `grant all`, exactly as 0029, 0030, 0031 and 0032 do it.
-- The only legitimate writer is the SECURITY DEFINER function below, which
-- re-checks the actor's role and derives the tenant from the study row. A
-- service_role that could INSERT here directly could manufacture a grouping
-- nobody decided, which is the one thing this table exists to make hard.
alter table public.canonical_category_decision enable row level security;
alter table public.canonical_category_decision force row level security;
create policy "deny_browser_roles" on public.canonical_category_decision
  for all to anon, authenticated using (false) with check (false);
revoke all privileges on table public.canonical_category_decision from anon, authenticated;
revoke all privileges on table public.canonical_category_decision from service_role;
grant select on table public.canonical_category_decision to service_role;

-- -----------------------------------------------------------------------------
-- 4. Recording one decision
-- -----------------------------------------------------------------------------
-- ORDER MATTERS, and it is the order 0029 established and 0031 and 0032 repeat:
--
--   1. the actor is authorized BEFORE anything is read;
--   2. the study row is read and the TENANT COMES FROM IT — a caller never
--      names a tenant, so a caller cannot name somebody else's;
--   3. an advisory lock on the study, so two reviewers deciding at once cannot
--      both read the same chain head and both claim the next version;
--   4. the version the caller was SHOWN is checked against the chain head, so a
--      decision taken on a screen somebody else has already moved is refused
--      rather than silently applied on top;
--   5. a decision IDENTICAL to the one in force is returned rather than
--      duplicated. Pressing «guardar» twice is not two decisions, and a retry
--      after a lost response must not look like one. This is the defect the
--      legacy ledger has: the hosted project carries the same `separate`
--      decision as version 1 AND version 2.
--
-- THE THREE RULES A FLAT GROUPING NEEDS are checked here and not only in the
-- interface, because the interface is not a security boundary:
--
--   a. a label belongs to at most one category;
--   b. two categories in one family may not share a visible name;
--   c. a category's name may never be a member of another group — the only
--      shape in which this flat mapping could form a chain, so refusing it
--      makes cycles structurally impossible.
--
-- IT NEVER INFERS. No trigger, no default and no branch in this file creates a
-- grouping on its own; every row exists because a person pressed a button, and
-- the actor is recorded.
create or replace function public.record_canonical_category_decision(
  p_study_id         uuid,
  p_actor            uuid,
  p_family_key       text,
  p_member_folds     text[],
  p_member_labels    text[],
  p_source_digest    text,
  p_disposition      text,
  p_canonical_label  text default null,
  p_canonical_fold   text default null,
  p_rationale        text default null,
  p_expected_version integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $record_c$
declare
  target    public.study%rowtype;
  head      public.canonical_category_decision%rowtype;
  conflict  public.canonical_category_decision%rowtype;
  created   public.canonical_category_decision%rowtype;
  sorted    text[];
  reason    text;
  label     text;
  fold      text;
  new_key   text;
  head_ver  integer;
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

  if p_family_key is null or p_family_key !~ '^[a-z0-9_]{1,64}$' then
    raise exception using errcode = '22023', message = 'a family key is required';
  end if;
  if p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'a source digest is required';
  end if;
  if p_disposition is null or p_disposition not in ('grouped', 'separate', 'postponed', 'revoked') then
    raise exception using errcode = '22023', message = 'a disposition is required';
  end if;
  if p_member_folds is null or cardinality(p_member_folds) < 2 then
    raise exception using errcode = '22023', message = 'a decision needs at least two categories';
  end if;
  if p_member_labels is null or cardinality(p_member_labels) <> cardinality(p_member_folds) then
    raise exception using errcode = '22023', message = 'the folded list and the spellings disagree';
  end if;

  -- THE MEMBER LIST MUST ARRIVE SORTED AND UNIQUE, because it IS the identity:
  -- an unsorted copy of the same members would start a second, parallel version
  -- chain for one question. Checked rather than repaired, so a caller that got
  -- it wrong learns instead of silently getting a different group.
  select coalesce(array_agg(value order by value), '{}') into sorted
    from (select distinct unnest(p_member_folds) as value) as d;
  if p_member_folds <> sorted then
    raise exception using errcode = '22023', message = 'member folds must be sorted and unique';
  end if;

  reason := nullif(btrim(coalesce(p_rationale, '')), '');
  if p_disposition = 'postponed' and (reason is null or char_length(reason) < 10) then
    raise exception using errcode = '22023',
      message = 'postponing must say why, in at least ten characters';
  end if;

  if p_disposition = 'grouped' then
    label := nullif(btrim(coalesce(p_canonical_label, '')), '');
    fold  := nullif(btrim(coalesce(p_canonical_fold, '')), '');
    if label is null or fold is null then
      raise exception using errcode = '22023', message = 'a grouping needs a final name';
    end if;
  else
    label := null;
    fold  := null;
  end if;

  -- 3. THE LOCK, before the first read a decision depends on.
  --
  -- ONE bigint, and `pg_catalog`-qualified. There is no
  -- `pg_advisory_xact_lock(bigint, bigint)` — the two-argument form takes two
  -- INTEGERS — and under `search_path = ''` an unqualified name resolves to
  -- nothing. 0029, 0031 and 0032 take the lock exactly this way, for exactly
  -- this reason. Transaction-scoped, so COMMIT or ROLLBACK releases it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  select * into head
    from public.canonical_category_decision
   where study_id = target.id
     and family_key = p_family_key
     and member_folds = p_member_folds
   order by version desc
   limit 1;
  head_ver := coalesce(head.version, 0);

  -- 4. THE VERSION THE CALLER WAS SHOWN. Optional only for a caller that has
  -- read nothing; supplied by every interface, and refused when it has moved.
  if p_expected_version is not null and p_expected_version <> head_ver then
    raise exception using errcode = '55000',
      message = 'this group was decided again while the screen was open';
  end if;

  if p_disposition = 'revoked' and head.id is null then
    raise exception using errcode = '55000', message = 'nothing to undo for this group';
  end if;

  -- 5. THE SAME DECISION, ALREADY IN FORCE. Returned, never duplicated.
  --
  -- «The same» means every field a person chose AND the source it was chosen
  -- about: a decision recorded against a family that has since moved is not the
  -- same decision, and must be written again so the store carries the digest of
  -- what is actually there.
  if head.id is not null
     and head.source_digest = p_source_digest
     and head.disposition = p_disposition
     and head.canonical_label is not distinct from label
     and head.canonical_fold is not distinct from fold
     and head.rationale is not distinct from reason
  then
    return jsonb_build_object(
      'decisionId', head.id,
      'version', head.version,
      'created', false
    );
  end if;

  -- 6. THE THREE RULES, against the decisions in force in this family.
  if p_disposition = 'grouped' then
    for conflict in
      select distinct on (d.member_folds) d.*
        from public.canonical_category_decision d
       where d.study_id = target.id
         and d.family_key = p_family_key
         and d.member_folds <> p_member_folds
       order by d.member_folds, d.version desc
    loop
      if conflict.disposition <> 'grouped' then continue; end if;

      -- (a) one label, one category
      if exists (
        select 1 from unnest(p_member_folds) as mine(value)
        join unnest(conflict.member_folds) as theirs(value) on mine.value = theirs.value
      ) then
        raise exception using errcode = '23505',
          message = 'one of these answers already belongs to ' || coalesce(conflict.canonical_label, '?');
      end if;

      -- (b) two categories may not share a visible name
      if conflict.canonical_fold = fold then
        raise exception using errcode = '23505',
          message = 'a category named ' || coalesce(conflict.canonical_label, '?') || ' already exists here';
      end if;

      -- (c) a name is never a member of another group
      if exists (
        select 1 from unnest(conflict.member_folds) as theirs(value) where theirs.value = fold
      ) then
        raise exception using errcode = '23505',
          message = 'that name is already grouped inside ' || coalesce(conflict.canonical_label, '?');
      end if;
    end loop;

    -- STABLE IDENTITY: reuse the chain's key so a rename never detaches
    -- anything, and allocate one only for a genuinely new category.
    new_key := coalesce(
      head.canonical_key,
      nullif(regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g'), '')
    );
    new_key := left(regexp_replace(coalesce(new_key, ''), '^_+|_+$', '', 'g'), 64);
    if new_key = '' then new_key := 'categoria'; end if;
    if exists (
      select 1 from public.canonical_category_decision
       where study_id = target.id and family_key = p_family_key
         and canonical_key = new_key and member_folds <> p_member_folds
    ) then
      new_key := left(new_key, 55) || '_' || substr(md5(array_to_string(p_member_folds, '|')), 1, 8);
    end if;
  else
    new_key := null;
  end if;

  insert into public.canonical_category_decision (
    study_id, tenant_id, family_key, member_folds, member_labels, source_digest,
    disposition, canonical_key, canonical_label, canonical_fold, rationale,
    version, previous_id, decided_by
  ) values (
    target.id, target.tenant_id, p_family_key, p_member_folds, p_member_labels, p_source_digest,
    p_disposition, new_key, label, fold, reason,
    head_ver + 1, head.id, p_actor
  ) returning * into created;

  return jsonb_build_object(
    'decisionId', created.id,
    'version', created.version,
    'created', true
  );
end;
$record_c$;

revoke execute on function public.record_canonical_category_decision(
  uuid, uuid, text, text[], text[], text, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.record_canonical_category_decision(
  uuid, uuid, text, text[], text[], text, text, text, text, text, integer
) to service_role;

comment on function public.record_canonical_category_decision(
  uuid, uuid, text, text[], text[], text, text, text, text, text, integer
) is
  'The only write path for a canonical category decision. Authorizes the actor before reading anything, derives the tenant from the study row, locks the study before reading the chain head, refuses a decision taken against a version that has moved, returns the record already in force rather than writing a second one, and enforces in SQL that a label belongs to at most one category, that two categories do not share a name, and that a name is never a member of another group. It writes nothing outside its own table.';

-- -----------------------------------------------------------------------------
-- 5. Reading the decisions in force, and what another study of the same client
--    decided about the same question
-- -----------------------------------------------------------------------------
-- ONE call, because the review surface needs both and the Cloudflare edge counts
-- outgoing requests rather than rows. Read-only, and it exists so a reader does
-- not have to express «highest version per group» in a client query — one place
-- to get that wrong is better than several.
--
-- IT RETURNS THE DECISIONS AND NEVER THE ACTOR: who decided is about a person,
-- and this surface is held to «no PII». The column keeps it for an audit with a
-- different reader.
--
-- THE MEMORY HALF IS BOUNDED BY THE STUDY ROW, NOT BY THE CALLER. The tenant it
-- recalls within is read from the study, so a caller passing another client's id
-- selects nothing rather than widening the scope. It is evidence about a
-- previous question, offered as a suggestion; nothing in this file or above it
-- applies one.
create or replace function public.read_canonical_category_decisions(
  p_study_id  uuid,
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $read_c$
  with scope as (
    select id, tenant_id from public.study
     where id = p_study_id and tenant_id = p_tenant_id
  ),
  in_force as (
    select distinct on (d.family_key, d.member_folds) d.*
      from public.canonical_category_decision d
      join scope on scope.id = d.study_id and scope.tenant_id = d.tenant_id
     order by d.family_key, d.member_folds, d.version desc
  ),
  elsewhere as (
    select distinct on (d.family_key, d.member_folds, d.study_id) d.*
      from public.canonical_category_decision d
      join scope on scope.tenant_id = d.tenant_id
     where d.study_id <> scope.id
     order by d.family_key, d.member_folds, d.study_id, d.version desc
  )
  select jsonb_build_object(
    'decisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'decisionId', f.id,
          'familyKey', f.family_key,
          'memberFolds', to_jsonb(f.member_folds),
          'memberLabels', to_jsonb(f.member_labels),
          'sourceDigest', f.source_digest,
          'disposition', f.disposition,
          'canonicalKey', f.canonical_key,
          'canonicalLabel', f.canonical_label,
          'rationale', f.rationale,
          'version', f.version,
          'decidedAt', f.decided_at
        )
        order by f.family_key, f.member_folds
      ) from in_force f
    ), '[]'::jsonb),
    'memory', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'familyKey', e.family_key,
          'memberFolds', to_jsonb(e.member_folds),
          'disposition', e.disposition,
          'canonicalLabel', e.canonical_label,
          'decidedAt', e.decided_at
        )
        order by e.family_key, e.member_folds, e.decided_at desc
      ) from elsewhere e
    ), '[]'::jsonb)
  );
$read_c$;

revoke execute on function public.read_canonical_category_decisions(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_canonical_category_decisions(uuid, uuid)
  to service_role;

comment on function public.read_canonical_category_decisions(uuid, uuid) is
  'One study''s canonical category decisions in force — the highest version per (family, member set) — with the source digest each was made about, and what another study of the SAME client decided about the same question, as a suggestion. Never the actor.';

commit;
