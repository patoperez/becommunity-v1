-- Roll back 0033_canonical_row_set_projection.sql.
--
-- That migration created exactly ONE function and nothing else. It created no
-- table, altered none, added and removed no column, rewrote no row, and changed
-- no policy, grant or function outside its own object. So there is no state to
-- restore here and there was never any to lose.
--
-- NOTHING IS DESTROYED. The function held no data: it read the canonical tables
-- and shaped rows for the wire. Every row it ever returned is still in the table
-- it came from.
--
-- WHAT STOPS WORKING, SAID PLAINLY. After this, a canonical read falls back to
-- the paged reader — twenty-eight HTTP requests for a Cuicuilco-sized study,
-- and one more per additional thousand `survey_response` rows. On a Cloudflare
-- Worker with a fifty-subrequest ceiling that is over budget for the internal
-- review screens, and the failure is reported as `SUBREQUEST_BUDGET_EXHAUSTED`
-- — a named refusal, not an empty review. Nothing is silently wrong; the
-- screens that need more than fifty requests stop working and say so.

drop function if exists public.read_canonical_row_set(uuid, uuid, text);
