-- =============================================================================
-- 0022 — Semantic category review: an append-only decision ledger and the
--        published projection a report is reproducible against.
-- =============================================================================
-- HUMAN-REVIEW ZONE: this migration adds two internal tables, two SECURITY
-- DEFINER write paths and no client-facing capability whatsoever. Browser roles
-- are denied outright on both tables, exactly like the internal control tables
-- created in 0003, 0015 and 0017.
--
-- WHAT PROBLEM THIS SOLVES
--
-- A first import can deliver the same answer written two ways, because two
-- questionnaires worded it differently: the real study holds
-- "No he recuperado nada" from the members who stayed and "No recuperé nada"
-- from the members who left. Those are one zero-return band asked twice, and
-- counting them apart splits nine people into a five and a four.
--
-- Deciding that two wordings are one answer is an EDITORIAL act. It changes
-- counts, percentages, filters, charts, comparisons and a PDF a client may
-- already have read. So it is recorded the way an editorial act has to be:
-- who, when, on what evidence, over which exact set of options, and what it
-- replaced.
--
-- THE FOUR PROPERTIES THIS SCHEMA EXISTS TO GUARANTEE
--
--  1. RAW DATA IS NEVER TOUCHED. Nothing here writes to `respondent`,
--     `quant_response` or `qual_observation`. Grouping happens on the way OUT
--     of the database, through the alias mechanism `src/lib/calc/segments.ts`
--     has always read. Reconciliation against the source workbooks stays exact,
--     and removing a decision simply makes the next read group differently.
--
--  2. THE LEDGER IS APPEND-ONLY AT THE PRIVILEGE LEVEL, not by convention.
--     `service_role` is granted SELECT and INSERT and nothing else, so there is
--     no UPDATE or DELETE path to the history from the application at all. Undo
--     writes an inverse row. That is the only property that makes this evidence.
--
--  3. A VALUE BELONGS TO AT MOST ONE CATEGORY. Enforced inside the write
--     function against the current state, not by a partial index, because
--     "current" is a fold over versions rather than a stored flag.
--
--  4. A PUBLISHED REPORT IS REPRODUCIBLE. `study_category_snapshot` pins the
--     exact projection a publication was calculated with. A later decision
--     changes Studio immediately and changes what the client sees only when a
--     person publishes again.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It never infers. No trigger, no default and
-- no function in this file ever creates a grouping on its own; every row is
-- written because a person pressed a button, and the actor is recorded.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- category_decision — the ledger
-- -----------------------------------------------------------------------------
-- IDENTITY IS `member_folds`, NOT A NAME. It is the sorted, de-duplicated list
-- of the folded values a decision is about, so the same question re-detected in
-- a different order, under a different rule, or after one spelling gained a
-- respondent, is recognised as the same question. The application's `groupKey`
-- is `JSON.stringify` of exactly this array; storing the array rather than the
-- string keeps the two encodings from ever disagreeing.
create table public.category_decision (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant (id) on delete cascade,

  -- Scope. A decision belongs to one study, one template, or the client as a
  -- whole. Exactly one of the two ids is set, and the check below is what makes
  -- "tenant-wide" distinguishable from "somebody forgot the study id".
  scope_kind         text not null check (scope_kind in ('study', 'template', 'tenant')),
  study_id           uuid,
  template_id        uuid,

  dimension_key      text not null check (char_length(dimension_key) between 1 and 80),

  -- The categories in question, folded, sorted and de-duplicated.
  member_folds       jsonb not null,
  -- The raw spellings as they stood when the decision was taken. Kept for the
  -- record: the fold is the identity, but a reader a year later needs to see
  -- what was actually on screen.
  member_values      jsonb not null,

  -- The question's fingerprint: characteristic, language and the WHOLE option
  -- set. An ordinal scale's meaning lives in its neighbours, so a decision made
  -- over a different option set is stale rather than simply older.
  context_signature  text not null check (char_length(context_signature) <= 8000),
  language           text check (language is null or char_length(language) <= 16),

  decision           text not null check (decision in ('grouped', 'separate', 'postponed', 'revoked')),

  -- Stable identity, assigned once and carried forward across renames. The
  -- visible label may be rewritten freely; anything pointing at the category
  -- points at the key.
  canonical_key      text check (canonical_key is null or canonical_key ~ '^[a-z0-9_]{1,64}$'),
  canonical_label    text check (canonical_label is null or char_length(canonical_label) between 1 and 200),
  -- The folded label, so the "one label, one category" rule is a comparison in
  -- SQL rather than a re-implementation of the application's fold.
  canonical_fold     text check (canonical_fold is null or char_length(canonical_fold) <= 200),

  reason             text check (reason is null or char_length(reason) <= 400),
  suggestion_source  text not null check (suggestion_source in (
                       'deterministic', 'fuzzy', 'ai', 'template_memory', 'tenant_memory', 'manual'
                     )),

  -- What a model said, IF one was consulted. Provider, model, prompt version
  -- and schema version, so a number can be explained later. Never a prompt,
  -- never a completion, never a key.
  advisor            jsonb check (
                       advisor is null
                       or (jsonb_typeof(advisor) = 'object' and octet_length(advisor::text) <= 2048)
                     ),

  version            integer not null check (version > 0),
  previous_id        uuid references public.category_decision (id),

  actor_user_id      uuid not null references auth.users (id) on delete restrict,
  decided_at         timestamptz not null default now(),

  -- Exactly one scope id, matching the declared scope kind.
  constraint category_decision_scope_shape check (
    (scope_kind = 'study'    and study_id is not null and template_id is null)
    or (scope_kind = 'template' and template_id is not null and study_id is null)
    or (scope_kind = 'tenant'   and study_id is null and template_id is null)
  ),

  -- A decision is about at least two distinct categories. A group naming one
  -- value is a question whose answer changes nothing.
  constraint category_decision_members_shape check (
    jsonb_typeof(member_folds) = 'array'
    and jsonb_array_length(member_folds) between 2 and 12
    and jsonb_typeof(member_values) = 'array'
    and octet_length(member_folds::text) <= 4000
    and octet_length(member_values::text) <= 8000
  ),

  -- Grouping needs a name and an identity; nothing else may carry one.
  constraint category_decision_label_shape check (
    (decision = 'grouped' and canonical_label is not null and canonical_key is not null and canonical_fold is not null)
    or (decision <> 'grouped' and canonical_label is null and canonical_key is null and canonical_fold is null)
  ),

  -- A deferral must say why. Without that it is a dismiss button, and a dismiss
  -- button is how the publication gate stops meaning anything.
  constraint category_decision_postpone_reason check (
    decision <> 'postponed' or (reason is not null and char_length(btrim(reason)) >= 10)
  )
);

-- The study/template a decision names must belong to the same client. The
-- composite foreign key proves it in the schema rather than trusting the
-- application to have checked — the same technique migration 0003 uses.
alter table public.category_decision
  add constraint category_decision_study_tenant_fkey
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade;

-- "The latest version of this group" is the query every read makes.
create index category_decision_group_idx
  on public.category_decision (
    tenant_id, scope_kind,
    coalesce(study_id, template_id, '00000000-0000-0000-0000-000000000000'::uuid),
    dimension_key, member_folds, version desc
  );
create index category_decision_tenant_idx on public.category_decision (tenant_id, decided_at desc);
create index category_decision_study_idx on public.category_decision (study_id, decided_at desc);

comment on table public.category_decision is
  'Append-only ledger of editorial decisions about whether differently written answers are one category. Never contains a respondent, a quote, an answer value or a credential. Undo is an inverse row; nothing is updated or deleted.';

-- -----------------------------------------------------------------------------
-- study_category_snapshot — what a published report was calculated with
-- -----------------------------------------------------------------------------
-- One row per study, rewritten at each publication. This one IS updated: it is
-- not evidence, it is a pin. The evidence is the ledger, and `decision_ids`
-- points into it, so the exact versions behind any published report can always
-- be listed.
create table public.study_category_snapshot (
  study_id      uuid primary key,
  tenant_id     uuid not null references public.tenant (id) on delete cascade,
  -- { "<dimension>": { "<label>": ["<fold>", ...] } } — the projection the read
  -- path applies, in the shape `parseSegmentAliases` already understands.
  resolution    jsonb not null check (jsonb_typeof(resolution) = 'object' and octet_length(resolution::text) <= 65536),
  decision_ids  jsonb not null check (jsonb_typeof(decision_ids) = 'array' and jsonb_array_length(decision_ids) <= 2000),
  captured_by   uuid references auth.users (id) on delete set null,
  captured_at   timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade
);

create index study_category_snapshot_tenant_idx on public.study_category_snapshot (tenant_id);

comment on table public.study_category_snapshot is
  'The category grouping a study was published with, so an already-delivered report stays reproducible when a later decision changes the working state.';

-- -----------------------------------------------------------------------------
-- RLS and least privilege
-- -----------------------------------------------------------------------------
-- Both tables are internal. Browser roles get an explicit deny policy so the
-- intent stays auditable even if a future migration grants SELECT by accident,
-- and the default privileges migration 0001 hands every new table are revoked
-- so strictly less can be granted back.
alter table public.category_decision enable row level security;
alter table public.category_decision force row level security;
alter table public.study_category_snapshot enable row level security;
alter table public.study_category_snapshot force row level security;

create policy "deny_browser_roles" on public.category_decision
  for all to anon, authenticated using (false) with check (false);
create policy "deny_browser_roles" on public.study_category_snapshot
  for all to anon, authenticated using (false) with check (false);

revoke all privileges on table public.category_decision from anon, authenticated, service_role;
-- SELECT and INSERT only. There is deliberately no UPDATE and no DELETE: the
-- ledger is append-only at the privilege level, which is the only version of
-- that claim an auditor can verify.
grant select, insert on table public.category_decision to service_role;

revoke all privileges on table public.study_category_snapshot from anon, authenticated, service_role;
grant select, insert, update on table public.study_category_snapshot to service_role;

-- -----------------------------------------------------------------------------
-- record_category_decision — the only way a decision is written
-- -----------------------------------------------------------------------------
-- It re-enforces, server-side, every rule the review screen explains before the
-- click. The screen exists so a considered judgement does not become a red
-- banner; this exists because the screen is not a security boundary.
create or replace function public.record_category_decision(
  p_study_id uuid,
  p_dimension_key text,
  p_member_folds jsonb,
  p_member_values jsonb,
  p_context_signature text,
  p_decision text,
  p_canonical_label text,
  p_canonical_fold text,
  p_reason text,
  p_suggestion_source text,
  p_language text,
  p_advisor jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target        public.study%rowtype;
  previous      public.category_decision%rowtype;
  next_version  integer;
  new_key       text;
  new_id        uuid;
  conflict      record;
  projection    jsonb;
  dimension_row public.segment_dimension%rowtype;
begin
  -- ---- authorization -------------------------------------------------------
  -- Only an internal account may take an editorial decision. Same shape as
  -- review_qual_observations and transition_study_interpretation.
  if not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  -- ---- shape ---------------------------------------------------------------
  if p_decision not in ('grouped', 'separate', 'postponed', 'revoked') then
    raise exception using errcode = '22023', message = 'invalid decision';
  end if;
  if jsonb_typeof(p_member_folds) <> 'array' or jsonb_array_length(p_member_folds) < 2 then
    raise exception using errcode = '22023', message = 'a decision needs at least two categories';
  end if;

  -- The member list must be sorted and de-duplicated, because it IS the
  -- identity: an unsorted copy of the same members would start a second,
  -- parallel version chain for one question.
  if p_member_folds <> (
    select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
    from (select distinct value from jsonb_array_elements_text(p_member_folds) as t(value)) as d
  ) then
    raise exception using errcode = '22023', message = 'member folds must be sorted and unique';
  end if;

  -- ---- version chain -------------------------------------------------------
  select * into previous
  from public.category_decision
  where tenant_id = target.tenant_id
    and scope_kind = 'study'
    and study_id = p_study_id
    and dimension_key = p_dimension_key
    and member_folds = p_member_folds
  order by version desc
  limit 1;

  next_version := coalesce(previous.version, 0) + 1;

  if p_decision = 'revoked' and previous.id is null then
    raise exception using errcode = '55000', message = 'nothing to undo for this group';
  end if;

  -- ---- conflicts (only a new grouping can create one) ----------------------
  if p_decision = 'grouped' then
    if p_canonical_label is null or btrim(p_canonical_label) = '' or p_canonical_fold is null then
      raise exception using errcode = '22023', message = 'a grouping needs a final name';
    end if;

    -- Latest version of every OTHER group in this characteristic.
    for conflict in
      select distinct on (d.member_folds) d.member_folds, d.decision, d.canonical_label, d.canonical_fold
      from public.category_decision as d
      where d.tenant_id = target.tenant_id
        and d.scope_kind = 'study'
        and d.study_id = p_study_id
        and d.dimension_key = p_dimension_key
        and d.member_folds <> p_member_folds
      order by d.member_folds, d.version desc
    loop
      if conflict.decision <> 'grouped' then continue; end if;

      -- (1) one value, one category
      if exists (
        select 1
        from jsonb_array_elements_text(p_member_folds) as mine(value)
        join jsonb_array_elements_text(conflict.member_folds) as theirs(value)
          on mine.value = theirs.value
      ) then
        raise exception using errcode = '23505',
          message = 'a value already belongs to the category ' || coalesce(conflict.canonical_label, '?');
      end if;

      -- (2) one label, one category
      if conflict.canonical_fold = p_canonical_fold then
        raise exception using errcode = '23505',
          message = 'a category named ' || coalesce(conflict.canonical_label, '?') || ' already exists here';
      end if;

      -- (3) a label is never a member of another group: the only shape in which
      -- this flat mapping could form a chain.
      if exists (
        select 1 from jsonb_array_elements_text(conflict.member_folds) as theirs(value)
        where theirs.value = p_canonical_fold
      ) then
        raise exception using errcode = '23505',
          message = 'that name is already grouped inside ' || coalesce(conflict.canonical_label, '?');
      end if;
    end loop;

    -- Stable identity: reuse the chain's key so a rename never detaches
    -- anything, and allocate one only for a genuinely new category.
    new_key := coalesce(
      previous.canonical_key,
      (select nullif(regexp_replace(lower(btrim(p_canonical_label)), '[^a-z0-9]+', '_', 'g'), '')),
      'categoria'
    );
    new_key := left(regexp_replace(new_key, '^_+|_+$', '', 'g'), 64);
    if new_key = '' then new_key := 'categoria'; end if;
    if exists (
      select 1 from public.category_decision
      where tenant_id = target.tenant_id and study_id = p_study_id
        and dimension_key = p_dimension_key and canonical_key = new_key
        and member_folds <> p_member_folds
    ) then
      new_key := left(new_key, 55) || '_' || substr(md5(p_member_folds::text), 1, 8);
    end if;
  end if;

  -- ---- append --------------------------------------------------------------
  insert into public.category_decision (
    tenant_id, scope_kind, study_id, template_id, dimension_key,
    member_folds, member_values, context_signature, language,
    decision, canonical_key, canonical_label, canonical_fold,
    reason, suggestion_source, advisor, version, previous_id, actor_user_id
  ) values (
    target.tenant_id, 'study', p_study_id, null, p_dimension_key,
    p_member_folds, p_member_values, p_context_signature, p_language,
    p_decision,
    case when p_decision = 'grouped' then new_key end,
    case when p_decision = 'grouped' then btrim(p_canonical_label) end,
    case when p_decision = 'grouped' then p_canonical_fold end,
    nullif(btrim(coalesce(p_reason, '')), ''), p_suggestion_source, p_advisor,
    next_version, previous.id, p_actor
  )
  returning id into new_id;

  -- ---- project -------------------------------------------------------------
  -- The ledger is the record; `segment_dimension.config.aliases` is its
  -- projection, and it is the ONLY thing that changes a number. Rebuilt whole
  -- from the current state so it can never drift from the decisions that
  -- justify it, and written in the same transaction so a decision cannot be
  -- recorded without taking effect, or take effect without being recorded.
  select coalesce(jsonb_object_agg(current.canonical_label, current.members), '{}'::jsonb)
  into projection
  from (
    select distinct on (d.member_folds)
           d.canonical_label,
           (select jsonb_agg(value order by value) from jsonb_array_elements_text(d.member_folds) as t(value)) as members,
           d.decision
    from public.category_decision as d
    where d.tenant_id = target.tenant_id
      and d.scope_kind = 'study'
      and d.study_id = p_study_id
      and d.dimension_key = p_dimension_key
    order by d.member_folds, d.version desc
  ) as current
  where current.decision = 'grouped';

  select * into dimension_row
  from public.segment_dimension
  where study_id = p_study_id and key = p_dimension_key
  limit 1;

  if found then
    update public.segment_dimension
    set config = jsonb_set(
          case when jsonb_typeof(config) = 'object' then config else '{}'::jsonb end,
          '{aliases}', projection, true)
    where id = dimension_row.id;
  else
    insert into public.segment_dimension (tenant_id, study_id, key, label, config)
    values (target.tenant_id, p_study_id, p_dimension_key, null,
            jsonb_build_object('aliases', projection));
  end if;

  return jsonb_build_object(
    'id', new_id,
    'version', next_version,
    'decision', p_decision,
    'groups', (select count(*) from jsonb_object_keys(projection))
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- capture_study_category_snapshot — pin what a publication was calculated with
-- -----------------------------------------------------------------------------
create or replace function public.capture_study_category_snapshot(
  p_study_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target     public.study%rowtype;
  resolution jsonb;
  ids        jsonb;
begin
  if not exists (
    select 1 from public.profiles where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;

  select * into target from public.study where id = p_study_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'study not found';
  end if;

  with current as (
    select distinct on (d.dimension_key, d.member_folds)
           d.id, d.dimension_key, d.canonical_label, d.decision,
           (select jsonb_agg(value order by value)
              from jsonb_array_elements_text(d.member_folds) as t(value)) as members
    from public.category_decision as d
    where d.tenant_id = target.tenant_id
      and d.scope_kind = 'study'
      and d.study_id = p_study_id
    order by d.dimension_key, d.member_folds, d.version desc
  ), grouped as (
    select * from current where decision = 'grouped'
  )
  select
    coalesce((
      select jsonb_object_agg(dimension_key, labels)
      from (
        select dimension_key, jsonb_object_agg(canonical_label, members) as labels
        from grouped group by dimension_key
      ) as byDimension
    ), '{}'::jsonb),
    coalesce((select jsonb_agg(id order by id) from grouped), '[]'::jsonb)
  into resolution, ids;

  insert into public.study_category_snapshot (study_id, tenant_id, resolution, decision_ids, captured_by, captured_at)
  values (p_study_id, target.tenant_id, resolution, ids, p_actor, now())
  on conflict (study_id) do update
    set resolution = excluded.resolution,
        decision_ids = excluded.decision_ids,
        captured_by = excluded.captured_by,
        captured_at = excluded.captured_at;

  return jsonb_build_object(
    'studyId', p_study_id,
    'dimensions', (select count(*) from jsonb_object_keys(resolution)),
    'decisions', jsonb_array_length(ids)
  );
end;
$$;

revoke all on function public.record_category_decision(uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_category_decision(uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, jsonb, uuid)
  to service_role;

revoke all on function public.capture_study_category_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.capture_study_category_snapshot(uuid, uuid) to service_role;

commit;
