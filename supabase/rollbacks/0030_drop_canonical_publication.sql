-- Roll back 0030_canonical_publication.sql.
--
-- Independent of every other canonical rollback: that migration created only
-- its own three tables, its own trigger function and its own three callable
-- functions. It depends on the canonical presentation draft existing, but it
-- ALTERED nothing there, so this may be run before or after any of the others.
--
-- It altered no existing table, rewrote no row and changed no policy or grant
-- outside its own objects, so there is nothing to restore alongside these
-- drops. In particular this does NOT touch `study_experience_draft`,
-- `study_experience_revision`, `study_experience_event`,
-- `study_experience_publication` or `canonical_presentation_draft`: the
-- canonical publication path never wrote to any of them, and reversing it must
-- not either.
--
-- IT DESTROYS EVERY CANONICAL PUBLICATION, and that is said plainly rather than
-- left to be discovered: a snapshot is the only copy of what somebody approved.
-- The working draft is untouched, because restoring is not the reverse of
-- publishing. Run this to undo the migration, never to undo a publication.

begin;

drop function public.read_canonical_publication(uuid, uuid);
drop function public.restore_canonical_presentation(uuid, uuid, uuid, bigint, text, text);
drop function public.publish_canonical_presentation(
  uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text,
  integer, text, text, text[], text[], text[], uuid, text, text
);

drop index public.canonical_presentation_publication_event_study_idx;
drop index public.canonical_presentation_publication_event_idempotency_idx;
drop index public.canonical_presentation_publication_tenant_idx;
drop index public.canonical_presentation_revision_study_idx;

-- The pointer and the event log both reference the snapshot table, so they go
-- first. Each trigger goes with the table that owns it; the function they share
-- does not, so it is dropped explicitly and only after both are gone.
drop table public.canonical_presentation_publication;
drop table public.canonical_presentation_publication_event;
drop function public.refuse_canonical_publication_change();

drop table public.canonical_presentation_revision;

commit;
