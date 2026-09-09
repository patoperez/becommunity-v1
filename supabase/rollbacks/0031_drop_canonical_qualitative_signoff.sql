-- Roll back 0031_canonical_qualitative_signoff.sql.
--
-- That migration created only its own two tables and its own four functions. It
-- altered no existing table, replaced no existing function — in particular
-- `publish_canonical_presentation` is untouched applied history and stays so —
-- rewrote no row, and changed no policy or grant outside its own objects. There
-- is therefore nothing to restore alongside these drops.
--
-- IT DESTROYS EVERY RECORDED QUALITATIVE SIGN-OFF, said plainly rather than left
-- to be discovered. A sign-off is evidence that a named person read one exact
-- set of category labels; there is no other copy of it, and after this the
-- publication review will report every study's categories as reviewed by
-- nobody — which will be true again.
--
-- PUBLICATIONS SURVIVE. The link table goes and the snapshots do not: dropping
-- the record of what the qualitative state was at publication time does not
-- unpublish anything, and must not.
--
-- ORDER. The link table references both the sign-off log and the publication
-- snapshot, so it goes first; the shared trigger function is owned by both
-- tables and may only be dropped once both are gone. 0030's rollback recorded
-- learning that the hard way (2BP01), and `drop … cascade` would hide it rather
-- than respect it.

begin;

drop function public.read_canonical_qualitative_signoffs(uuid, uuid, integer);
drop function public.publish_canonical_presentation_with_qualitative(
  uuid, uuid, bigint, jsonb, text, jsonb, text, text, text, text, text, text, integer,
  text, text, text, text, uuid, text[], text[], text[], uuid, text, text
);
drop function public.record_canonical_qualitative_signoff(uuid, uuid, text, text[], text[], text);

drop index public.canonical_publication_qualitative_signoff_study_idx;
drop index public.canonical_qualitative_signoff_digest_idx;
drop index public.canonical_qualitative_signoff_study_idx;

drop table public.canonical_publication_qualitative_signoff;
drop table public.canonical_qualitative_signoff;

drop function public.refuse_canonical_qualitative_signoff_change();

commit;
