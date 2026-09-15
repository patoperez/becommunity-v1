-- Roll back 0034_canonical_category_review.sql.
--
-- That migration created only its own one table and its own three functions. It
-- altered no existing table, replaced no existing function, rewrote no row, and
-- changed no policy or grant outside its own objects. In particular it never
-- touched migration 0022's `category_decision`, `study_category_snapshot`,
-- `record_category_decision` or `capture_study_category_snapshot`, and never
-- touched `segment_dimension` or any canonical table — so there is no state
-- elsewhere to restore here, and there was never any to lose.
--
-- IT DESTROYS EVERY CANONICAL CATEGORY DECISION, said plainly rather than left
-- to be discovered. Each row is a named person deciding that two or more
-- differently written answers are one category, in the name they chose, or
-- deciding deliberately that they stay apart, or postponing with a written
-- reason. There is no other copy: raw evidence was never rewritten, so
-- `survey_response` carries none of it. After this, every study's categories
-- read exactly as the source coded them — which is what they read before the
-- migration, and what they read today on any project where it is not applied.
--
-- THE QUALITATIVE SIGN-OFF GOES STALE BY ITSELF, and that is the intended
-- consequence rather than an oversight. A sign-off is a digest of the exact
-- category set a person read; dropping the groupings changes that set, the
-- digest moves, and the publication review says so on the next load. Nothing
-- has to remember to invalidate anything.
--
-- PUBLICATIONS SURVIVE UNCHANGED. A publication stores the RESOLVED RENDER
-- MODEL, so the category labels and counts inside an already-published snapshot
-- are bytes in `canonical_presentation_revision` and are not reachable from
-- here. Dropping the authoring record does not change what any client is being
-- served, and must not.
--
-- ORDER. The trigger function is owned by the table's trigger, so the table
-- goes first. `drop … cascade` would hide a dependency rather than respect it;
-- 0030's rollback recorded learning that the hard way (2BP01).

begin;

drop table if exists public.canonical_category_decision;

drop function if exists public.refuse_canonical_category_change();

drop function if exists public.record_canonical_category_decision(
  uuid, uuid, text, text[], text[], text, text, text, text, text, integer
);

drop function if exists public.read_canonical_category_decisions(uuid, uuid);

commit;
