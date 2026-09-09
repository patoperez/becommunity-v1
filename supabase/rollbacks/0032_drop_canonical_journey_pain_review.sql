-- Roll back 0032_canonical_journey_pain_review.sql.
--
-- That migration created only its own one table and its own three functions. It
-- altered no existing table, replaced no existing function, rewrote no row, and
-- changed no policy or grant outside its own objects. In particular it never
-- touched `public.pain_point` — no column, no constraint, no trigger, no grant
-- and no foreign key — so there is no canonical source state to restore here,
-- and there was never any to lose.
--
-- IT DESTROYS EVERY JOURNEY PAIN DECISION, said plainly rather than left to be
-- discovered. Each row is a named person approving, excluding or deliberately
-- leaving unresolved one curated phrase, in the public wording they chose, at
-- the touchpoints they chose. There is no other copy: the source `pain_point`
-- rows were never modified, and they carry none of it. After this, every
-- study's journey pain review reopens from nothing and
-- «Puntos de dolor del recorrido» is an unfilled required slot again — which
-- will be true again.
--
-- PUBLICATIONS SURVIVE, AND THEY KEEP THEIR PHRASES. A publication stores the
-- RESOLVED RENDER MODEL, so the approved phrases and the badges inside an
-- already-published snapshot are bytes in `canonical_presentation_revision` and
-- are not reachable from here. Dropping the authoring record does not change
-- what any client is being served, and must not.
--
-- ORDER. The trigger function is owned by the table's trigger, so the table
-- goes first. `drop … cascade` would hide a dependency rather than respect it;
-- 0030's rollback recorded learning that the hard way (2BP01).

begin;

drop function public.read_canonical_journey_pain_decisions(uuid, uuid);
drop function public.record_canonical_journey_pain_decision(
  uuid, uuid, text, text, text, text, text[], text
);

drop table public.canonical_journey_pain_decision;

drop function public.refuse_canonical_journey_pain_change();

commit;
