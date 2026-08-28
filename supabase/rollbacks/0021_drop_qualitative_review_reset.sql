-- Reverses 0021. The observations it moved are NOT restored to `confirmed`:
-- they are pending human review, which is the state this migration exists to
-- reach. Re-run 0015's constraint definition afterwards only if the narrower
-- audit vocabulary is genuinely wanted back.
begin;
drop function if exists public.reset_qual_observation_review(uuid[], uuid, uuid, text);
alter table public.admin_lifecycle_event
  drop constraint if exists admin_lifecycle_event_subject_kind_check;
alter table public.admin_lifecycle_event
  add constraint admin_lifecycle_event_subject_kind_check
  check (subject_kind in ('client_user', 'tenant'));
commit;
