-- =============================================================================
-- Rollback for 0023 — persistent composed-experience definitions.
-- =============================================================================
-- WHAT THIS DESTROYS. Every saved draft of a composed experience, every
-- published revision of one, and the record of who saved what and when. A draft
-- is authored work — somebody's arrangement of a client's study — and dropping
-- it cannot be undone by re-applying 0023.
--
-- WHAT IT DOES NOT TOUCH, BECAUSE 0023 NEVER WROTE TO IT. Any respondent,
-- answer, observation, import, user, study, publication state, journey
-- definition, dashboard configuration, interpretation or category decision.
-- 0023 is additive: it created three tables and two functions and altered
-- nothing that existed before it. After this rollback the database is in its
-- 0022 state and every client-facing surface behaves exactly as it did.
--
-- Before running this, export anything worth keeping:
--   select study_id, revision, schema_version, definition
--     from public.study_experience_draft;
--   select study_id, revision, published_at, definition
--     from public.study_experience_revision order by study_id, revision;
--   select * from public.study_experience_event order by occurred_at;
-- =============================================================================

begin;

drop function if exists public.save_study_experience_draft(uuid, uuid, jsonb, integer, bigint, text);

-- The trigger goes with its table; the function it calls does not, so it is
-- dropped by name after the table it protected is gone.
drop table if exists public.study_experience_event;
drop table if exists public.study_experience_revision;
drop table if exists public.study_experience_draft;

drop function if exists public.refuse_experience_revision_update();

commit;
