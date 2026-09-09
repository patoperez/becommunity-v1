-- =============================================================================
-- 0032 — the journey pain review: a person's decisions, stored as presentation
--        configuration, beside a canonical source it never touches
-- =============================================================================
-- Additive only. It creates ONE table and TWO functions, alters no existing
-- table, drops nothing, rewrites no row, and changes no existing policy, grant
-- or function outside its own objects. In particular it does NOT touch
-- `public.pain_point`: no column, no constraint, no trigger, no grant, and no
-- foreign key pointing at it.
--
-- NOT APPLIED TO ANY PROJECT. Proved against a disposable PostgreSQL and
-- applied nowhere else — the hosted project does not have it, and neither does
-- it have `0031`. Until both are applied, the journey pain content cannot be
-- authored, the publication blocker cannot be cleared, and the read fails
-- closed, which is the safe direction and is true.
--
-- HUMAN-REVIEW ZONE: authorization, least privilege and storage.
-- =============================================================================
--
-- -----------------------------------------------------------------------------
-- WHY A PERSON DECIDES, AND WHY NO CODE MAY
-- -----------------------------------------------------------------------------
-- The approved dashboard draws a cloud of journey pain phrases and a badge on
-- each touchpoint that carries one. Neither is derivable, and that was measured
-- against the hosted project rather than assumed (read-only, 2026-09-09):
--
--   * of the eighteen curated journey-stage labels, ZERO match a canonical
--     `survey_item.label`, SIX match the workbook's short label row, and FIVE
--     match the bracketed text inside the prompt. Three defensible readings of
--     the same two sources produce three different answers, which is itself the
--     proof that label identity is not an authority;
--   * «Reunión semanal presencial/en línea» is ONE curated stage covering TWO
--     touchpoints, so the relation is not one-to-one and never was;
--   * «BNI Connect» is ambiguous between the web platform and the phone app,
--     while «App celular» names that same app;
--   * `journey_stage_evidence_link` holds ZERO rows, exactly as the contract's
--     `journey_stage_evidence` requirement says it will until a configuration
--     declares one;
--   * and all fifty `pain_point` rows are `review_status = 'pending'`.
--
-- The approved demo resolves all of it with a 38-entry hand-written alias table
-- and a phrase-splitting rule. Both are implementation, neither is authority,
-- and this schema stores a PERSON'S CHOICE rather than a program's guess.
--
-- -----------------------------------------------------------------------------
-- WHY THE CANONICAL SOURCE IS NOT MUTATED, AND NOT EVEN REFERENCED
-- -----------------------------------------------------------------------------
-- Moving a `pain_point` from `pending` to `confirmed` would be a Studio WRITE
-- into a canonical table and a widening of what may cross the client boundary.
-- That is a separate decision with its own authorization, and it is not made
-- here. What is made here is a PRESENTATION decision: which of the source's
-- phrases this study's dashboard publishes, in what public wording, at which
-- touchpoints.
--
-- So a row identifies its source item by an OPAQUE TOKEN — `painItemToken` in
-- `src/lib/publication/journey-pain-digest.ts`, derived from the study and the
-- row together — and NOT by a foreign key into `pain_point`. Three consequences,
-- and all three are wanted:
--
--   1. this table cannot cascade-delete, lock or otherwise reach a canonical
--      row, so a presentation decision can never be the reason canonical
--      evidence changes;
--   2. a re-import that mints different rows moves every token, every stored
--      decision stops matching an item, and the review REOPENS — visibly,
--      rather than silently re-attaching a person's approval to a phrase they
--      never read;
--   3. the configuration outlives a canonical row's identity without pretending
--      to be a fact about it.
--
-- -----------------------------------------------------------------------------
-- WHAT A ROW MAY HOLD, AND WHAT IT MAY NEVER HOLD
-- -----------------------------------------------------------------------------
-- An opaque item token, a digest of the source words the decision was made
-- about, a closed disposition, the PUBLIC phrase a reviewer approved or edited,
-- the opaque presentation handles they chose, an optional short reason, and who
-- decided and when.
--
-- Never a respondent, never a respondent identifier, never a survey comment,
-- never an adjacent free-text answer, never a name. `pain_point` carries no
-- respondent column in any shape — its provenance is a workbook cell — so there
-- is nothing of that kind on the path in the first place, and there is no
-- column here that could receive one if there were.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The decision log
-- -----------------------------------------------------------------------------
-- APPEND-ONLY, and a LOG rather than a current row per item. The same reasoning
-- 0031 records: a review is evidence of what a person decided and when, so
-- overwriting it destroys the audit it exists to be. A reviewer who approves a
-- phrase, changes the wording, and approves it again has made three decisions,
-- and the third is the one in force — which a log can say and a single row
-- cannot.
--
-- «In force» is therefore a READ, not a column: the newest row per
-- (study, item), which the index below makes a single backwards scan.
create table public.canonical_journey_pain_decision (
  id              uuid primary key default gen_random_uuid(),
  study_id        uuid not null references public.study (id) on delete cascade,
  tenant_id       uuid not null references public.tenant (id) on delete cascade,

  -- The OPAQUE source item identity. Not a canonical row id — see the header.
  -- `pp` and sixteen base32 characters; the alphabet excludes nothing and
  -- contains letters past `f`, so no token can be mistaken for a hex digest.
  item_key        text not null check (item_key ~ '^pp[a-z2-7]{16}$'),

  -- The digest of the source words this decision was made about. Computed on
  -- the server, never accepted from a browser, and compared on every read: a
  -- decision whose source has moved is STALE and reopens the review.
  source_digest   text not null check (source_digest ~ '^[0-9a-f]{64}$'),

  -- The three things a person may decide. `unreviewed` is deliberately NOT
  -- among them: it is the absence of a row, not a decision, and a value for it
  -- would let "nobody looked" and "somebody looked and could not tell" be
  -- written by the same code path.
  disposition     text not null check (disposition in ('approved', 'rejected', 'unresolved')),

  -- The PUBLIC phrase, as the client would read it. It may differ from the
  -- source's wording — editing it is one of the decisions this table exists to
  -- record — and it never travels back into `pain_point`.
  public_phrase   text check (public_phrase is null or char_length(btrim(public_phrase)) between 1 and 300),

  -- The presentation handles chosen, in the reviewer's own order.
  --
  -- ONE-TO-MANY IS THE NORMAL CASE, not an edge: «Reunión semanal
  -- presencial/en línea» is one source stage over two touchpoints, so a schema
  -- that stored a single handle would be unable to express next year's study.
  --
  -- BOUNDED BY CARDINALITY AND BY TOTAL LENGTH, NOT PER ELEMENT, and that is a
  -- limitation of CHECK rather than a choice: PostgreSQL refuses a subquery in
  -- a check constraint (0A000), so `unnest` cannot be used to bound each handle.
  -- `array_to_string` with an empty delimiter is immutable and subquery-free, so
  -- it is legal here. A handle is a short opaque string; sixteen of them inside
  -- 4 KiB is generous and still refuses a caller posting prose into the column.
  touchpoints     text[] not null default '{}'
                    check (cardinality(touchpoints) between 0 and 16)
                    check (octet_length(array_to_string(touchpoints, '')) <= 4096),

  rationale       text check (rationale is null or char_length(rationale) <= 300),

  -- A BARE UUID, not a foreign key into `auth.users`.
  --
  -- Migration 0025 made an authentication identity undeletable exactly that
  -- way: `references auth.users on delete set null` on a table whose trigger
  -- refuses every UPDATE means removing a user issues that UPDATE, the trigger
  -- raises 2F002, and the delete fails for as long as the row exists. 0030 and
  -- 0031 both learned it and this does not relearn it.
  decided_by      uuid not null,
  decided_at      timestamptz not null default now(),

  -- AN APPROVAL IS NOT AN APPROVAL WITHOUT BOTH HALVES. A phrase with no
  -- wording would publish the working material; a phrase with no touchpoint
  -- would appear in the cloud and nowhere on the journey, so a reader could not
  -- tell which part of the process it is about. Enforced here as well as in the
  -- application, because the application is one refactor from not enforcing it.
  constraint canonical_journey_pain_decision_approved_is_complete
    check (
      disposition <> 'approved'
      or (public_phrase is not null and cardinality(touchpoints) >= 1)
    ),
  -- And a decision that is NOT an approval publishes nothing, so it may not
  -- carry a public phrase or a mapping. Otherwise a later widening of the read
  -- could pick up wording nobody approved.
  constraint canonical_journey_pain_decision_refusal_is_empty
    check (
      disposition = 'approved'
      or (public_phrase is null and cardinality(touchpoints) = 0)
    )
);

-- The read that decides «what is in force»: newest first, per study and item.
create index canonical_journey_pain_decision_current_idx
  on public.canonical_journey_pain_decision (study_id, item_key, decided_at desc);

create index canonical_journey_pain_decision_study_idx
  on public.canonical_journey_pain_decision (study_id, decided_at desc);

comment on table public.canonical_journey_pain_decision is
  'A person deciding which curated journey pain phrases this study publishes, in what public wording, at which canonical touchpoints. Append-only; the newest row per item is the decision in force. Presentation configuration: it holds no canonical row identifier, no foreign key into pain_point, and never a respondent, an answer, a quotation or a name.';

comment on column public.canonical_journey_pain_decision.item_key is
  'An opaque identity for one source pain item, derived from the study and the row together. Not a canonical row id. A re-import that mints different rows moves every token, so every decision stops matching an item and the review reopens rather than silently re-attaching.';

comment on column public.canonical_journey_pain_decision.source_digest is
  'sha256 over the item token, the curated phrase, the source stage wording and the source review status. The occurrence count is deliberately outside it: another workbook cell repeating a phrase somebody already approved adds no word to read.';

-- -----------------------------------------------------------------------------
-- 2. Immutability
-- -----------------------------------------------------------------------------
-- The same shape 0030 and 0031 use, and for the same reason: an audit record
-- that can be edited is not one. Changing a decision means RECORDING A NEW ONE,
-- which is what makes the history readable. DELETE is refused only while the
-- study still exists, so a study can be deleted whole and a cascade still works.
create or replace function public.refuse_canonical_journey_pain_change()
returns trigger
language plpgsql
set search_path = ''
as $refuse$
begin
  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '2F002',
      message = 'a journey pain decision is immutable; record a new one instead';
  end if;
  if exists (select 1 from public.study where id = old.study_id) then
    raise exception using
      errcode = '2F002',
      message = 'a journey pain decision cannot be deleted while its study exists';
  end if;
  return old;
end;
$refuse$;

revoke execute on function public.refuse_canonical_journey_pain_change()
  from public, anon, authenticated;

drop trigger if exists refuse_change on public.canonical_journey_pain_decision;
create trigger refuse_change
  before update or delete on public.canonical_journey_pain_decision
  for each row execute function public.refuse_canonical_journey_pain_change();

-- -----------------------------------------------------------------------------
-- 3. Lockdown — RLS, FORCE RLS, no browser role, READ-ONLY for service_role
-- -----------------------------------------------------------------------------
-- `grant select`, not `grant all`, exactly as 0029, 0030 and 0031 do it. The
-- only legitimate writer is the SECURITY DEFINER function below, which
-- re-checks the actor's role and derives the tenant from the study row. A
-- service_role that could INSERT here directly could manufacture an approval
-- nobody gave, which is the one thing this table exists to make hard.
alter table public.canonical_journey_pain_decision enable row level security;
alter table public.canonical_journey_pain_decision force row level security;
create policy "deny_browser_roles" on public.canonical_journey_pain_decision
  for all to anon, authenticated using (false) with check (false);
revoke all privileges on table public.canonical_journey_pain_decision from anon, authenticated;
revoke all privileges on table public.canonical_journey_pain_decision from service_role;
grant select on table public.canonical_journey_pain_decision to service_role;

-- -----------------------------------------------------------------------------
-- 4. Recording one decision
-- -----------------------------------------------------------------------------
-- ORDER MATTERS, and it is the order 0029 established and 0031 repeats:
--
--   1. the actor is authorized BEFORE anything is read;
--   2. the study row is read and the TENANT COMES FROM IT — a caller never
--      names a tenant, so a caller cannot name somebody else's;
--   3. an advisory lock on the study, so two reviewers deciding at once cannot
--      both read "nothing in force" and both insert a first decision;
--   4. a decision IDENTICAL to the one already in force is returned rather than
--      duplicated. Pressing «guardar» twice is not two decisions, and a retry
--      after a lost response must not look like one.
--
-- IT DOES NOT VALIDATE THE MAPPING AGAINST THE PRESENTATION, and cannot: the
-- touchpoint handles are a presentation-layer vocabulary derived from the
-- study's canonical results by code, and this database has no way to compute
-- one. The application checks every handle against the offer IT built before
-- calling, and the publication preflight checks the whole set again against the
-- resolved document — so a handle that stops existing is reported as
-- `unknown_touchpoint` and blocks publication rather than being stored wrong.
create or replace function public.record_canonical_journey_pain_decision(
  p_study_id      uuid,
  p_actor         uuid,
  p_item_key      text,
  p_source_digest text,
  p_disposition   text,
  p_public_phrase text default null,
  p_touchpoints   text[] default '{}',
  p_rationale     text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $record$
declare
  target   public.study%rowtype;
  existing public.canonical_journey_pain_decision%rowtype;
  created  public.canonical_journey_pain_decision%rowtype;
  phrase   text;
  points   text[];
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

  if p_item_key is null or p_item_key !~ '^pp[a-z2-7]{16}$' then
    raise exception using errcode = '22023', message = 'an opaque item key is required';
  end if;
  if p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'a source digest is required';
  end if;
  if p_disposition is null or p_disposition not in ('approved', 'rejected', 'unresolved') then
    raise exception using errcode = '22023', message = 'a disposition is required';
  end if;

  -- THE TWO HALVES OF AN APPROVAL, normalised before the constraint sees them,
  -- so a phrase of spaces is refused as a missing phrase rather than stored as
  -- one. A non-approval carries neither: see the refusal constraint above.
  if p_disposition = 'approved' then
    phrase := nullif(btrim(coalesce(p_public_phrase, '')), '');
    points := coalesce(p_touchpoints, '{}');
    if phrase is null then
      raise exception using errcode = '22023',
        message = 'an approved phrase must say what the client reads';
    end if;
    if cardinality(points) = 0 then
      raise exception using errcode = '22023',
        message = 'an approved phrase must be mapped to at least one touchpoint';
    end if;
  else
    phrase := null;
    points := '{}';
  end if;

  -- 3. THE LOCK, before the first read a decision depends on.
  --
  -- ONE bigint, and `pg_catalog`-qualified. There is no
  -- `pg_advisory_xact_lock(bigint, bigint)` — the two-argument form takes two
  -- INTEGERS — and under `search_path = ''` an unqualified name resolves to
  -- nothing. 0029 and 0031 take the lock exactly this way, for exactly this
  -- reason. Transaction-scoped, so COMMIT or ROLLBACK releases it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.id::text, 0)
  );

  -- 4. THE SAME DECISION, ALREADY IN FORCE. Returned, never duplicated.
  --
  -- «The same» means every field a person chose AND the source it was chosen
  -- about: a decision recorded against words that have since moved is not the
  -- same decision, and must be written again so the store carries the digest of
  -- what is actually there.
  select * into existing
    from public.canonical_journey_pain_decision
   where study_id = target.id
     and item_key = p_item_key
   order by decided_at desc
   limit 1;
  if found
     and existing.source_digest = p_source_digest
     and existing.disposition = p_disposition
     and existing.public_phrase is not distinct from phrase
     and existing.touchpoints = points
     and existing.rationale is not distinct from nullif(btrim(coalesce(p_rationale, '')), '')
  then
    return jsonb_build_object(
      'decisionId', existing.id,
      'decidedAt', existing.decided_at,
      'created', false
    );
  end if;

  insert into public.canonical_journey_pain_decision (
    study_id, tenant_id, item_key, source_digest, disposition,
    public_phrase, touchpoints, rationale, decided_by
  ) values (
    target.id, target.tenant_id, p_item_key, p_source_digest, p_disposition,
    phrase, points, nullif(btrim(coalesce(p_rationale, '')), ''), p_actor
  ) returning * into created;

  return jsonb_build_object(
    'decisionId', created.id,
    'decidedAt', created.decided_at,
    'created', true
  );
end;
$record$;

revoke execute on function public.record_canonical_journey_pain_decision(
  uuid, uuid, text, text, text, text, text[], text
) from public, anon, authenticated;
grant execute on function public.record_canonical_journey_pain_decision(
  uuid, uuid, text, text, text, text, text[], text
) to service_role;

comment on function public.record_canonical_journey_pain_decision(
  uuid, uuid, text, text, text, text, text[], text
) is
  'The only write path for a journey pain decision. Authorizes the actor before reading anything, derives the tenant from the study row, locks the study before deciding, refuses an approval missing its public phrase or its mapping, and returns the existing record when the identical decision about the identical source is already in force rather than writing a second one.';

-- -----------------------------------------------------------------------------
-- 5. Reading the decisions in force
-- -----------------------------------------------------------------------------
-- Read-only, and it exists so a reader does not have to express «newest per
-- item» in a client query — one place to get that wrong is better than several.
-- It returns the DECISIONS and never the actor: who decided is about a person,
-- and the review surface is held to «no PII». The column keeps it for an audit
-- with a different reader.
create or replace function public.read_canonical_journey_pain_decisions(
  p_study_id  uuid,
  p_tenant_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $read_p$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'itemKey', current.item_key,
        'sourceDigest', current.source_digest,
        'disposition', current.disposition,
        'publicPhrase', current.public_phrase,
        'touchpoints', to_jsonb(current.touchpoints),
        'rationale', current.rationale,
        'decidedAt', current.decided_at
      )
      order by current.item_key
    ),
    '[]'::jsonb
  )
  from (
    select distinct on (d.item_key) d.*
      from public.canonical_journey_pain_decision d
     where d.study_id = p_study_id
       and d.tenant_id = p_tenant_id
     order by d.item_key, d.decided_at desc, d.id desc
  ) as current;
$read_p$;

revoke execute on function public.read_canonical_journey_pain_decisions(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_canonical_journey_pain_decisions(uuid, uuid)
  to service_role;

comment on function public.read_canonical_journey_pain_decisions(uuid, uuid) is
  'One study''s journey pain decisions in force — the newest per item — with the source digest each was made about, so a caller can tell a decision from a stale one. Never the actor.';
