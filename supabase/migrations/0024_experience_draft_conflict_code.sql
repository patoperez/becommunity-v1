-- =============================================================================
-- 0024 — the revision conflict has to be a code the Data API will deliver
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization. This migration replaces ONE function body
-- and changes nothing else: no table, no column, no policy, no grant, no row.
-- The function keeps its exact signature, its `security definer` marking, its
-- pinned empty `search_path` and its privilege model, so the revoke/grant pair
-- 0023 established still stands unchanged.
--
-- WHAT WENT WRONG, MEASURED RATHER THAN REASONED ABOUT
--
-- 0023 raised SQLSTATE `40001` (serialization_failure) for a lost update,
-- because that is what the condition IS. Against the Data API it is unusable:
-- PostgREST treats a serialization failure as a transient error and retries the
-- request, so a deliberate refusal never reaches the caller. Measured on the
-- linked project immediately after 0023 was applied:
--
--   a save with a stale revision      504 after 125 098 ms   (retried until the
--                                                             gateway gave up)
--   a save with a bad schema version  400 after 580 ms, code 22023
--
-- Both come out of the same function, one statement apart. The difference is
-- the SQLSTATE, and nothing else.
--
-- WHAT IT RAISES NOW
--
-- `55000` — object_not_in_prerequisite_state — which is exactly the situation:
-- the stored draft is not in the state this write requires. It is the same code
-- `transition_study_interpretation` (0017) already uses for a precondition
-- failure, so the project has one answer to "the thing you are writing to has
-- moved on" rather than two. PostgREST does not retry it, and delivers it with
-- its message intact.
--
-- WITHIN THIS FUNCTION, `55000` MEANS EXACTLY ONE THING: the revision the
-- caller believed it was editing is not the revision that is stored. Every
-- other refusal keeps its own distinct code — `42501` for a non-internal actor,
-- `P0002` for a missing study, `22023` for a document this study cannot store —
-- so `src/lib/experience/storage.ts` can map one code to one message without
-- guessing.
-- =============================================================================

begin;

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
        errcode = '55000',
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
        errcode = '55000',
        message = 'this study already has a draft; reload before saving';
    end if;
    if p_expected_revision <> current.revision then
      raise exception using
        errcode = '55000',
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
  'The only write path for a composed-experience draft. Re-checks the internal role, derives the tenant from the study row, refuses a document that names another study or client, and refuses a write whose expected revision is not the stored one (SQLSTATE 55000 — 40001 is retried by the Data API and never reaches the caller).';

-- `create or replace` preserves the existing privileges, but the revoke is
-- repeated so this file states the privilege model rather than depending on the
-- reader knowing that it does.
revoke execute on function public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text)
  from public, anon, authenticated;
grant execute on function public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text)
  to service_role;

commit;
