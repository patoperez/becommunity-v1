-- Roll back 0024_canonical_commit_and_rollback.sql.
--
-- Run BEFORE 0023_drop_canonical_analysis_model.sql and
-- 0022_drop_canonical_ingestion_foundation.sql.
--
-- This removes every object 0024 created and restores the exact
-- `source_lineage` vocabulary migration 0023 left behind. It does not touch
-- `source_asset`, `import_job_asset` or any row written by an earlier
-- migration.

begin;

-- -----------------------------------------------------------------------------
-- 0. Refuse to run while a committed package still owns canonical rows
-- -----------------------------------------------------------------------------
-- The ledger is the ONLY record of which canonical rows belong to which
-- package. Dropping it while rows are owned would leave that data in place with
-- nothing able to identify, reverse or audit it — silent orphans that a later
-- import would then trip over. So this script refuses, and names the way out:
-- reverse each committed package through `rollback_canonical_package` first.
--
-- The guard is deliberately not `if exists (…) then return`: a no-op would let
-- an operator believe the migration had been reversed when it had not.
do $guard$
declare
  owned integer;
  packages integer;
begin
  select count(*), count(distinct import_job_id)
  into owned, packages
  from public.import_job_record;

  if owned > 0 then
    raise exception using
      errcode = '55000',
      message = 'CANONICAL_PACKAGES_STILL_OWNED',
      detail  = format(
        '%s canonical row(s) across %s import job(s) are still owned by a committed package.',
        owned, packages
      ),
      hint = 'Run public.rollback_canonical_package(import_job_id) for each committed package, then re-run this script.';
  end if;
end $guard$;

drop function public.rollback_canonical_package(uuid, uuid);
drop function public.commit_canonical_package(uuid, jsonb);
drop function public.stage_canonical_package(uuid, uuid, jsonb);
drop function public.record_canonical_rows(uuid, uuid, uuid, text, uuid[], text);

alter table public.source_lineage
  drop constraint source_lineage_target_table_check,
  add constraint source_lineage_target_table_check check (target_table in (
    'person_private', 'person_external_identifier', 'study_participant', 'membership_episode',
    'participant_attribute_value', 'response_option', 'survey_instrument', 'study_domain',
    'survey_item', 'survey_session', 'survey_response', 'visual_annotation',
    'performance_dimension', 'performance_observation', 'study_period_snapshot',
    'band_scheme', 'band_rule', 'metric_definition', 'metric_item_link',
    'journey_model', 'journey_stage', 'journey_stage_evidence_link',
    'organizational_unit', 'culture_dimension', 'pain_point'
  ));

drop index public.retention_period_job_idx;
drop index public.import_job_record_owned_idx;
drop index public.import_job_record_target_idx;

drop table public.import_job_record;
drop table public.retention_period;

alter table public.pain_point_culture_dimension
  drop constraint pain_point_culture_dimension_id_key,
  drop column id;
alter table public.pain_point_performance_dimension
  drop constraint pain_point_performance_dimension_id_key,
  drop column id;
alter table public.pain_point_organizational_unit
  drop constraint pain_point_organizational_unit_id_key,
  drop column id;
alter table public.pain_point_journey_stage
  drop constraint pain_point_journey_stage_id_key,
  drop column id;

alter table public.import_job
  drop constraint import_job_last_error_code_check,
  drop constraint import_job_rollback_count_check,
  drop constraint import_job_commit_attempts_check,
  drop constraint import_job_payload_digest_check,
  drop constraint import_job_plan_fingerprint_check;

alter table public.import_job
  drop column last_error_code,
  drop column rollback_count,
  drop column commit_attempts,
  drop column payload_digest,
  drop column plan_fingerprint;

commit;
