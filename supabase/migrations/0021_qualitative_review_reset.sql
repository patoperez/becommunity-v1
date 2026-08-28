-- =============================================================================
-- 0021 — return an automated qualitative confirmation to human review
-- =============================================================================
-- HUMAN-REVIEW ZONE: this adds a SECURITY DEFINER write path over
-- qual_observation and widens the administrative audit vocabulary.
--
-- WHY THIS EXISTS. `public.review_qual_observations` records a confirmation as
-- a human editorial decision: it stamps `reviewed_by` and `reviewed_at` and
-- makes the observation client-eligible. An automated run that calls it
-- produces rows that are indistinguishable from a consultant's judgement —
-- the database says a person confirmed 25 comments at one identical
-- microsecond, and nothing in the product can tell the difference afterwards.
--
-- Be Community's editorial boundary is the whole product: a theme is a finding
-- the firm stands behind, and a quote is a participant's words the firm chose
-- to publish. Neither may be created by inference. This migration provides the
-- only supported way to undo an automated confirmation:
--
--   - it RESETS the review decision (`pending`, no confirmed theme, no stage,
--     no approved quote, no reviewer, no review time) so nothing is
--     client-eligible and the work reappears in the Studio review queue;
--   - it PRESERVES the evidence — `quote`, `theme` and `suggested_theme` are
--     untouched, so the participant's words and the generated suggestion are
--     still there for the human who will actually decide;
--   - it RECORDS itself in `admin_lifecycle_event` in the SAME transaction, so
--     the reset cannot succeed unrecorded (the standing rule that governs every
--     other administrative action here).
--
-- It takes an explicit id list, exactly like the review function it undoes, so
-- it can only ever touch observations the caller named and proved belong to one
-- study. It is not a "reset this study" button.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Audit vocabulary: one new action, and a study as a subject.
-- -----------------------------------------------------------------------------
-- Widening only. Every value 0015 allowed is still allowed, so no existing row
-- can be invalidated by this change.
alter table public.admin_lifecycle_event
  drop constraint if exists admin_lifecycle_event_action_check;
alter table public.admin_lifecycle_event
  add constraint admin_lifecycle_event_action_check check (action in (
    'client_user_suspended',
    'client_user_restored',
    'client_user_delete_started',
    'client_user_deleted',
    'tenant_archived',
    'tenant_restored',
    'tenant_deleted',
    -- An automated confirmation returned to the human review queue. The record
    -- names the study and how many observations moved; never a quote, never a
    -- respondent, never a theme.
    'qualitative_review_reset'
  ));

alter table public.admin_lifecycle_event
  drop constraint if exists admin_lifecycle_event_subject_kind_check;
alter table public.admin_lifecycle_event
  add constraint admin_lifecycle_event_subject_kind_check
  check (subject_kind in ('client_user', 'tenant', 'study'));

-- -----------------------------------------------------------------------------
-- reset_qual_observation_review
-- -----------------------------------------------------------------------------
create or replace function public.reset_qual_observation_review(
  p_ids uuid[],
  p_study_id uuid,
  p_actor uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested integer;
  affected integer;
  study_tenant uuid;
  study_name text;
  reason text;
begin
  requested := coalesce(array_length(p_ids, 1), 0);
  if requested < 1 or requested > 500 then
    raise exception using errcode = '22023', message = 'select between 1 and 500 observations';
  end if;

  reason := nullif(btrim(p_reason), '');
  if reason is null or char_length(reason) > 400 then
    raise exception using errcode = '22023', message = 'a reason of 1 to 400 characters is required';
  end if;

  -- Same authorization shape as review_qual_observations: only an internal
  -- account may move a review decision, in either direction.
  if not exists (
    select 1 from public.profiles
    where user_id = p_actor and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'actor is not internal';
  end if;

  select s.tenant_id, s.name into study_tenant, study_name
  from public.study as s where s.id = p_study_id;
  if study_tenant is null then
    raise exception using errcode = '22023', message = 'study not found';
  end if;

  -- Every named observation must belong to this study, or nothing happens.
  if (
    select count(*) from public.qual_observation
    where id = any(p_ids) and study_id = p_study_id
  ) <> requested then
    raise exception using errcode = '22023', message = 'observation selection does not belong to study';
  end if;

  update public.qual_observation
  set
    review_status = 'pending',
    confirmed_theme = null,
    confirmed_stage_key = null,
    quote_approved = false,
    reviewed_by = null,
    reviewed_at = null
  where id = any(p_ids)
    and study_id = p_study_id
    -- Idempotent: a second run finds nothing left to move and says so.
    and review_status = 'confirmed';

  get diagnostics affected = row_count;

  -- A run that moved nothing is not an administrative action and does not need
  -- a record. A run that moved something cannot succeed without one: the insert
  -- shares this transaction, so a failure to record undoes the reset.
  if affected > 0 then
    insert into public.admin_lifecycle_event (
      actor_user_id, action, subject_kind, subject_id, tenant_id, subject_label, details
    ) values (
      p_actor,
      'qualitative_review_reset',
      'study',
      p_study_id,
      study_tenant,
      left(study_name, 200),
      jsonb_build_object('observations_reset', affected, 'reason', reason)
    );
  end if;

  return affected;
end;
$$;

revoke all on function public.reset_qual_observation_review(uuid[], uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reset_qual_observation_review(uuid[], uuid, uuid, text)
  to service_role;

commit;
