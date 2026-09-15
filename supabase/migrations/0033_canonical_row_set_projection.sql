-- =============================================================================
-- 0033 — one round trip for the canonical row set
-- =============================================================================
-- Additive only. It creates ONE function. It creates no table, alters no table,
-- adds and removes no column, drops nothing, rewrites no row, changes no policy,
-- no grant and no function outside its own object, and changes no publication
-- state. It contains no business arithmetic of any kind.
--
-- HUMAN-REVIEW ZONE: least privilege, tenant scope, and the absence of
-- calculation.
--
-- -----------------------------------------------------------------------------
-- WHY THIS EXISTS: A PLATFORM CEILING, MEASURED RATHER THAN GUESSED
-- -----------------------------------------------------------------------------
-- The canonical read model is twenty-six independent families plus the
-- committed-package gate, and `src/lib/canonical-source/read.ts` reads each one
-- separately, paging by keyset so a set larger than its ceiling is refused
-- rather than truncated. That is twenty-eight HTTP requests for Cuicuilco, and
-- one more for every additional thousand `survey_response` rows.
--
-- A Cloudflare Worker on the free plan may make FIFTY outbound requests per
-- incoming HTTP request. Unit 6B.4B2K measured the internal review screen on
-- the real edge, request by request:
--
--     #1..#2    the session and the role
--     #3..#17   the Studio study workspace
--     #18..#45  the canonical row set          <- twenty-eight of them
--     #46..#48  the draft, the publication, its history
--     #49       the curated pain phrases
--     #50       their stage links
--     #51       the stages                     <- REFUSED by the runtime
--     #52..#62  every read after it            <- REFUSED, including retries
--
-- The refusal is the runtime's, not the database's. The product then reported
-- it as an unfinished editorial review on a study whose fifteen decisions were
-- all recorded and all approved. `0033` removes the cause: twenty-eight
-- requests become ONE, and the count stops growing with the data.
--
-- -----------------------------------------------------------------------------
-- WHAT IT IS NOT
-- -----------------------------------------------------------------------------
-- IT IS NOT A CALCULATION. There is no sum, no average, no ratio, no band, no
-- threshold and no business rule anywhere below. Every expression is a column
-- projection, a tenant/study filter, an ORDER BY and a LIMIT. The formulas stay
-- where they have always been — the one pure builder in `src/lib/results` — and
-- this migration does not give the database a second place to decide a number.
-- `jsonb_agg` is not arithmetic about a study; it is how rows are shaped for the
-- wire.
--
-- IT IS NOT A WIDER READ. The columns below are the columns `read.ts` already
-- selects, family by family, and no others. `pain_point.raw_text` and
-- `pain_point.normalized_text` are NOT selected here either — the canonical read
-- model excludes a consultant's prose because it is what a client is eventually
-- served from (`docs/CANONICAL_RESULTS_MODEL.md` §12), and that decision is
-- untouched. No table holding a person is named: `person`, `person_private`,
-- `respondent`, `qual_observation` and `quant_response` appear nowhere.
--
-- IT IS NOT A NEW AUTHORITY. `security invoker` — so it runs with the caller's
-- own privileges and RLS applies to the caller exactly as it does to the direct
-- reads it replaces. It is not a way for anybody to see a row they could not
-- see already. Execution is revoked from PUBLIC, `anon` and `authenticated`,
-- and granted only to `service_role`, which is the role the server already uses
-- for these reads and the only role that can reach the canonical tables at all.
--
-- IT CANNOT MUTATE. `language sql`, `stable`, and a body that is a single
-- SELECT. `stable` forbids writes at the executor level: any INSERT, UPDATE,
-- DELETE or DDL inside would raise `read-only SQL transaction`-class errors, so
-- this is enforced by PostgreSQL rather than promised by a comment.
--
-- -----------------------------------------------------------------------------
-- THE CEILINGS ARE THE SAME CEILINGS, AND A GATE PROVES IT
-- -----------------------------------------------------------------------------
-- Each family is limited to its declared ceiling PLUS ONE. The caller compares
-- the length it received against the same ceiling and REFUSES when it is
-- exceeded — so a set that outgrew its bound is still a refusal and never a
-- silently shorter answer, exactly as the paged reader made it. The numbers
-- below are duplicated from `CANONICAL_READS` in
-- `src/lib/canonical-source/read.ts`; `scripts/canonical-database-source-test.mjs`
-- parses both and fails if one moves without the other.
--
-- THE ORDER IS THE SAME ORDER. Every family is ordered by its full key,
-- ascending, which is what the caller's "strictly increasing" check verifies.
-- A wrong ORDER BY here fails there rather than silently skipping rows.
-- =============================================================================

create or replace function public.read_canonical_row_set(
  p_tenant_id   uuid,
  p_study_id    uuid,
  p_package_key text default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $row_set$
  select jsonb_build_object(
    -- THE COMMITTED-PACKAGE GATE. Every candidate is returned, not the newest:
    -- a study with two committed packages must be REFUSED by the caller, and a
    -- function that picked one here would hide the ambiguity it was asked about.
    'importJob', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select j.id,
                 j.idempotency_key,
                 j.mapping_version,
                 j.status,
                 j.committed_at,
                 j.manifest -> 'plan' as plan
            from public.import_job j
           where j.tenant_id = p_tenant_id
             and j.study_id  = p_study_id
             and j.status    = 'committed'
             and (p_package_key is null or j.idempotency_key = p_package_key)
           order by j.id
           limit 201
        ) t
    ), '[]'::jsonb),

    'participants', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.cohort_key, r.participation_status,
                 r.survey_participation_status, r.source_status
            from public.study_participant r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 20001
        ) t
    ), '[]'::jsonb),

    'attributeDefinitions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.data_type, r.sensitivity, r.filterable, r.display_order
            from public.attribute_definition r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'attributeValues', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.participant_id, r.attribute_definition_id, r.status,
                 r.value_text, r.value_numeric
            from public.participant_attribute_value r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 400001
        ) t
    ), '[]'::jsonb),

    'responseScales', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key
            from public.response_scale r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'responseOptions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.response_scale_id, r.raw_value, r.numeric_value,
                 r.derived_label, r.display_order
            from public.response_option r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 20001
        ) t
    ), '[]'::jsonb),

    'instruments', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.audience, r.instrument_type
            from public.survey_instrument r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'domains', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.survey_instrument_id, r.key, r.label, r.display_order,
                 r.visual_annotation_id
            from public.study_domain r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 5001
        ) t
    ), '[]'::jsonb),

    'items', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.survey_instrument_id, r.study_domain_id, r.response_scale_id,
                 r.key, r.label, r.item_order
            from public.survey_item r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 20001
        ) t
    ), '[]'::jsonb),

    'sessions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.survey_instrument_id, r.participant_id, r.status
            from public.survey_session r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 100001
        ) t
    ), '[]'::jsonb),

    'responses', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.survey_session_id, r.survey_item_id, r.response_option_id,
                 r.status, r.value_numeric, r.value_text, r.source_derived_label
            from public.survey_response r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2000001
        ) t
    ), '[]'::jsonb),

    'retentionPeriods', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.series_key, r.period_order, r.period_label,
                 r.period_starts_on, r.period_ends_on,
                 r.starting_status, r.starting_count, r.new_status, r.new_count,
                 r.ending_status, r.ending_count, r.lost_status, r.lost_count,
                 r.identity_verified
            from public.retention_period r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 5001
        ) t
    ), '[]'::jsonb),

    'performanceDimensions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.display_order
            from public.performance_dimension r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'performanceObservations', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.participant_id, r.performance_dimension_id, r.period_start,
                 r.period_label, r.status, r.value
            from public.performance_observation r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 500001
        ) t
    ), '[]'::jsonb),

    'bandSchemes', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.unit, r.description
            from public.band_scheme r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'bandRules', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.band_scheme_id, r.lower_bound, r.upper_bound,
                 r.lower_inclusive, r.upper_inclusive, r.label, r.semantic_color,
                 r.display_order
            from public.band_rule r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 10001
        ) t
    ), '[]'::jsonb),

    'metricDefinitions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.family, r.unit, r.precision,
                 r.calculation_version, r.band_scheme_id
            from public.metric_definition r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 10001
        ) t
    ), '[]'::jsonb),

    'journeyModels', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.audience, r.display_order
            from public.journey_model r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'journeyStages', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.journey_model_id, r.key, r.label, r.stage_order
            from public.journey_stage r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 5001
        ) t
    ), '[]'::jsonb),

    'journeyStageEvidenceLinks', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.journey_stage_id, r.metric_definition_id, r.survey_item_id,
                 r.performance_dimension_id, r.role, r.display_order
            from public.journey_stage_evidence_link r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 20001
        ) t
    ), '[]'::jsonb),

    'organizationalUnits', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.display_order
            from public.organizational_unit r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    'cultureDimensions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.key, r.label, r.audience, r.display_order
            from public.culture_dimension r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 2001
        ) t
    ), '[]'::jsonb),

    -- `raw_text` and `normalized_text` are deliberately NOT selected, exactly as
    -- they are not selected by the paged reader this replaces.
    'painPoints', coalesce((
      select jsonb_agg(row_to_json(t) order by t.id)
        from (
          select r.id, r.review_status, r.created_at
            from public.pain_point r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.id limit 50001
        ) t
    ), '[]'::jsonb),

    -- The four link families have a COMPOSITE key and no `id`, so they are
    -- ordered by the full key — the same tuple the caller checks is increasing.
    'painPointJourneyStages', coalesce((
      select jsonb_agg(row_to_json(t) order by t.pain_point_id, t.journey_stage_id)
        from (
          select r.pain_point_id, r.journey_stage_id, r.display_order
            from public.pain_point_journey_stage r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.pain_point_id, r.journey_stage_id limit 200001
        ) t
    ), '[]'::jsonb),

    'painPointOrganizationalUnits', coalesce((
      select jsonb_agg(row_to_json(t) order by t.pain_point_id, t.organizational_unit_id)
        from (
          select r.pain_point_id, r.organizational_unit_id, r.display_order
            from public.pain_point_organizational_unit r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.pain_point_id, r.organizational_unit_id limit 200001
        ) t
    ), '[]'::jsonb),

    'painPointPerformanceDimensions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.pain_point_id, t.performance_dimension_id)
        from (
          select r.pain_point_id, r.performance_dimension_id, r.display_order
            from public.pain_point_performance_dimension r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.pain_point_id, r.performance_dimension_id limit 200001
        ) t
    ), '[]'::jsonb),

    'painPointCultureDimensions', coalesce((
      select jsonb_agg(row_to_json(t) order by t.pain_point_id, t.culture_dimension_id)
        from (
          select r.pain_point_id, r.culture_dimension_id, r.display_order
            from public.pain_point_culture_dimension r
           where r.tenant_id = p_tenant_id and r.study_id = p_study_id
           order by r.pain_point_id, r.culture_dimension_id limit 200001
        ) t
    ), '[]'::jsonb)
  );
$row_set$;

revoke execute on function public.read_canonical_row_set(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.read_canonical_row_set(uuid, uuid, text) to service_role;

comment on function public.read_canonical_row_set(uuid, uuid, text) is
  'One study''s canonical read model, projected in a single round trip: the same columns, the same order and the same ceilings as the paged reader in src/lib/canonical-source/read.ts, scoped by tenant AND study. Read-only, security invoker, service_role only. It computes no business value and selects no free text.';
