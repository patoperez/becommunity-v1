-- Roll back 0023_canonical_analysis_model.sql.
-- Run before 0022_drop_canonical_ingestion_foundation.sql.

begin;

alter table public.source_lineage
  drop constraint source_lineage_target_table_check,
  add constraint source_lineage_target_table_check check (target_table in (
    'person_private', 'person_external_identifier', 'study_participant', 'membership_episode',
    'participant_attribute_value', 'response_option', 'survey_instrument', 'study_domain',
    'survey_item', 'survey_session', 'survey_response', 'visual_annotation'
  ));

drop table public.pain_point_culture_dimension;
drop table public.pain_point_performance_dimension;
drop table public.pain_point_organizational_unit;
drop table public.pain_point_journey_stage;
drop table public.pain_point;
drop table public.culture_dimension;
drop table public.organizational_unit;
drop table public.journey_stage_evidence_link;
drop table public.journey_stage;
drop table public.journey_model;
drop table public.metric_item_link;
drop table public.metric_definition;
drop table public.band_rule;
drop table public.band_scheme;
drop table public.performance_observation;
drop table public.performance_dimension;

drop index public.study_period_snapshot_series_idx;
alter table public.study_period_snapshot
  drop constraint study_period_snapshot_date_order_check,
  drop constraint study_period_snapshot_series_key_check,
  drop column period_ends_on,
  drop column period_starts_on,
  drop column series_key;

commit;
