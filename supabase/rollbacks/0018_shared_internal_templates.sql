-- Restores the original functions by re-running migration 0006 after this file.
begin;
drop function if exists public.save_study_template(uuid, uuid, text, text, jsonb, jsonb, uuid);
drop function if exists public.instantiate_study_template(uuid, uuid, uuid, text, text);
commit;
