begin;
drop function if exists public.transition_study_interpretation(uuid, uuid, text, jsonb);
drop table if exists public.study_interpretation_event;
drop table if exists public.study_interpretation;
commit;
