-- Roll back 0029_canonical_presentation_draft.sql.
--
-- Independent of the other canonical rollbacks: 0029 created only its own two
-- tables, its own trigger function and its own save function, and depends on
-- nothing 0026-0028 created. It may be run before or after them.
--
-- It altered no existing table, rewrote no row and changed no policy or grant
-- outside its own objects, so there is nothing to restore alongside these
-- drops. In particular this does NOT touch `study_experience_draft`,
-- `study_experience_revision`, `study_experience_event` or
-- `study_experience_publication`: the canonical presentation path never wrote
-- to them, and reversing it must not either.

begin;

drop function public.save_canonical_presentation_draft(
  uuid, uuid, jsonb, text, text, text, bigint, text, text
);

drop index public.canonical_presentation_draft_event_study_idx;
drop index public.canonical_presentation_draft_event_idempotency_idx;
drop index public.canonical_presentation_draft_tenant_idx;

-- The trigger goes with its table. The function it calls does not, so it is
-- dropped explicitly, and only after the trigger that references it is gone.
drop table public.canonical_presentation_draft_event;
drop function public.refuse_canonical_presentation_event_update();

drop table public.canonical_presentation_draft;

commit;
