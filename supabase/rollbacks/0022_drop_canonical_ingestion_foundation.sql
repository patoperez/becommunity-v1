-- Roll back 0022_canonical_ingestion_foundation.sql.
-- If 0023 was applied, roll back 0023 first.

begin;

drop table public.source_lineage;
drop table public.survey_response;
drop table public.survey_session;
drop table public.survey_item;
drop table public.study_domain;
drop table public.survey_instrument;
drop table public.response_option;
drop table public.response_scale;
drop table public.participant_attribute_value;
drop table public.attribute_definition;
drop table public.membership_episode;
drop table public.study_participant;
drop table public.person_external_identifier;
drop table public.person_private;
drop table public.visual_annotation;
drop table public.import_job_asset;
drop table public.import_job;
drop table public.source_asset;

drop index public.respondent_id_tenant_study_uidx;

commit;
