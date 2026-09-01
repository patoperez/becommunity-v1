-- =============================================================================
-- 0024 — canonical package commit, ownership ledger and rollback
-- =============================================================================
-- Depends on 0022 and 0023. Additive only: it creates two tables, adds columns
-- to `import_job` and to the four pain-point link tables, widens the
-- `source_lineage` vocabulary, and creates the server-only transactional
-- functions that write and reverse a validated canonical package.
--
-- It rewrites no existing row, changes no existing policy or grant outside its
-- own objects, and touches neither the legacy `import_batch` path nor the
-- aggregate `study_period_snapshot` surface the current application reads.
--
-- HUMAN-REVIEW ZONE. Everything below is authorization- and integrity-bearing:
--   * every function is SECURITY DEFINER with an EMPTY search_path;
--   * every function is revoked from public, anon and authenticated and granted
--     only to service_role;
--   * tenant and study scope is derived from a LOCKED `import_job` row and is
--     never taken from the JSON payload — the payload's own claim is compared
--     against the locked row and a mismatch is refused;
--   * actual counts are measured from the database's own ROW_COUNT, never read
--     from the caller;
--   * no error path returns a database message, because a constraint violation
--     message quotes the failing key values, which here are respondent data.
--
-- OWNERSHIP AND ROLLBACK. `import_job_record` is the ledger that says which
-- canonical rows this package CREATED and which pre-existing rows it REUSED.
-- Rollback deletes the created rows in reverse dependency order and leaves the
-- reused ones alone, so a person shared with another study survives. Source
-- assets and their job links are provenance, not canonical data: they are
-- deliberately absent from the ledger vocabulary and therefore survive a
-- rollback, which is what keeps the package's idempotency key meaningful.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Bind an import job to exactly one validated plan
-- -----------------------------------------------------------------------------
-- `plan_fingerprint` is computed by the server from the projected commit plan
-- and staged BEFORE the commit. `payload_digest` is computed by PostgreSQL from
-- the payload it actually received, and is stored on success so a replay must
-- present the identical payload rather than merely the identical fingerprint.
alter table public.import_job
  add column plan_fingerprint text,
  add column payload_digest   text,
  add column commit_attempts  integer not null default 0,
  add column rollback_count   integer not null default 0,
  add column last_error_code  text;

alter table public.import_job
  add constraint import_job_plan_fingerprint_check
    check (plan_fingerprint is null or plan_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  add constraint import_job_payload_digest_check
    check (payload_digest is null or payload_digest ~ '^[0-9a-f]{64}$'),
  add constraint import_job_commit_attempts_check
    check (commit_attempts between 0 and 1000),
  add constraint import_job_rollback_count_check
    check (rollback_count between 0 and 1000),
  -- A SAFE code the product chose, never a database message: a constraint
  -- violation message quotes the failing key values, which are respondent data.
  add constraint import_job_last_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,59}$');

-- -----------------------------------------------------------------------------
-- 2. A surrogate key for the four pain-point link tables
-- -----------------------------------------------------------------------------
-- The ledger addresses every owned row by one uuid. These four tables were
-- created with composite primary keys only, so they gain a stable surrogate id.
-- The composite primary key stays: it is what keeps a relationship unique.
alter table public.pain_point_journey_stage
  add column id uuid not null default gen_random_uuid(),
  add constraint pain_point_journey_stage_id_key unique (id);
alter table public.pain_point_organizational_unit
  add column id uuid not null default gen_random_uuid(),
  add constraint pain_point_organizational_unit_id_key unique (id);
alter table public.pain_point_performance_dimension
  add column id uuid not null default gen_random_uuid(),
  add constraint pain_point_performance_dimension_id_key unique (id);
alter table public.pain_point_culture_dimension
  add column id uuid not null default gen_random_uuid(),
  add constraint pain_point_culture_dimension_id_key unique (id);

-- -----------------------------------------------------------------------------
-- 3. Canonical retention periods, with their SOURCE counts and their states
-- -----------------------------------------------------------------------------
-- Historical retention is deliberately NOT written into the legacy aggregate
-- `study_period_snapshot`: that table requires four non-null counts and a
-- positive starting membership, so it cannot represent a period whose source
-- count is blank, unknown or unavailable, and it is the surface the current
-- application already reads. This table keeps every count WITH the state the
-- source gave it, and records whether the four counts satisfied
-- `final = inicial - perdidos + nuevos` instead of assuming they did.
create table public.retention_period (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete cascade,
  study_id         uuid not null,
  import_job_id    uuid not null,
  series_key       text not null check (series_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  period_order     integer not null check (period_order between 0 and 9999),
  period_label     text not null check (char_length(btrim(period_label)) between 1 and 100),
  period_starts_on date,
  period_ends_on   date,
  starting_status  text not null default 'answered' check (
    starting_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  starting_count   integer check (starting_count is null or starting_count >= 0),
  new_status       text not null default 'answered' check (
    new_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  new_count        integer check (new_count is null or new_count >= 0),
  ending_status    text not null default 'answered' check (
    ending_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  ending_count     integer check (ending_count is null or ending_count >= 0),
  lost_status      text not null default 'answered' check (
    lost_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  lost_count       integer check (lost_count is null or lost_count >= 0),
  identity_verified boolean not null,
  created_at       timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (import_job_id, tenant_id, study_id)
    references public.import_job (id, tenant_id, study_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, series_key, period_order),
  check (period_ends_on is null or period_starts_on is null or period_ends_on >= period_starts_on),
  -- A count exists exactly when the source answered. Absence never becomes 0.
  check ((starting_status = 'answered') = (starting_count is not null)),
  check ((new_status = 'answered') = (new_count is not null)),
  check ((ending_status = 'answered') = (ending_count is not null)),
  check ((lost_status = 'answered') = (lost_count is not null)),
  -- The identity may only be claimed when all four counts are present AND hold.
  check (
    identity_verified = false
    or (
      starting_count is not null and new_count is not null
      and ending_count is not null and lost_count is not null
      and ending_count = starting_count - lost_count + new_count
    )
  )
);

-- -----------------------------------------------------------------------------
-- 4. The package ownership ledger
-- -----------------------------------------------------------------------------
-- One row per canonical record this package touched. `created` rows are the
-- package's own and are removed by its rollback; `reused` rows existed before
-- and are left exactly as they were. `source_asset` and `import_job_asset` are
-- intentionally NOT in this vocabulary: they are provenance and must survive a
-- rollback, and leaving them out makes that a structural fact rather than a
-- convention a later edit could forget.
create table public.import_job_record (
  import_job_id    uuid not null,
  tenant_id        uuid not null references public.tenant (id) on delete cascade,
  study_id         uuid not null,
  target_table     text not null check (target_table in (
    'person_private', 'person_external_identifier', 'study_participant', 'membership_episode',
    'attribute_definition', 'participant_attribute_value', 'response_scale', 'response_option',
    'survey_instrument', 'study_domain', 'survey_item', 'survey_session', 'survey_response',
    'visual_annotation', 'performance_dimension', 'performance_observation',
    'band_scheme', 'band_rule', 'retention_period', 'metric_definition', 'metric_item_link',
    'journey_model', 'journey_stage', 'journey_stage_evidence_link',
    'organizational_unit', 'culture_dimension', 'pain_point',
    'pain_point_journey_stage', 'pain_point_organizational_unit',
    'pain_point_performance_dimension', 'pain_point_culture_dimension'
  )),
  target_record_id uuid not null,
  ownership        text not null check (ownership in ('created', 'reused')),
  created_at       timestamptz not null default now(),
  primary key (import_job_id, target_table, target_record_id),
  foreign key (import_job_id, tenant_id, study_id)
    references public.import_job (id, tenant_id, study_id) on delete cascade,
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade
);

create index import_job_record_target_idx
  on public.import_job_record (target_table, target_record_id);
create index import_job_record_owned_idx
  on public.import_job_record (import_job_id, ownership);
create index retention_period_job_idx
  on public.retention_period (import_job_id, period_order);

-- -----------------------------------------------------------------------------
-- 5. Lineage must be able to name every target Unit 3 writes
-- -----------------------------------------------------------------------------
alter table public.source_lineage
  drop constraint source_lineage_target_table_check,
  add constraint source_lineage_target_table_check check (target_table in (
    'person_private', 'person_external_identifier', 'study_participant', 'membership_episode',
    'attribute_definition', 'participant_attribute_value', 'response_scale', 'response_option',
    'survey_instrument', 'study_domain', 'survey_item', 'survey_session', 'survey_response',
    'visual_annotation', 'performance_dimension', 'performance_observation',
    'study_period_snapshot', 'retention_period',
    'band_scheme', 'band_rule', 'metric_definition', 'metric_item_link',
    'journey_model', 'journey_stage', 'journey_stage_evidence_link',
    'organizational_unit', 'culture_dimension', 'pain_point',
    'pain_point_journey_stage', 'pain_point_organizational_unit',
    'pain_point_performance_dimension', 'pain_point_culture_dimension'
  ));

-- -----------------------------------------------------------------------------
-- 6. Security for the two new tables — identical to 0022/0023
-- -----------------------------------------------------------------------------
do $security$
declare
  target text;
begin
  foreach target in array array['retention_period', 'import_job_record'] loop
    execute format('alter table public.%I enable row level security', target);
    execute format('alter table public.%I force row level security', target);
    execute format(
      'create policy "deny_browser_roles" on public.%I for all to anon, authenticated using (false) with check (false)',
      target
    );
    execute format('revoke all privileges on table public.%I from anon, authenticated', target);
    execute format('grant all privileges on table public.%I to service_role', target);
  end loop;
end $security$;

-- -----------------------------------------------------------------------------
-- 7. Ledger helper
-- -----------------------------------------------------------------------------
-- Called ~30 times by the commit function. Keeping it here rather than inline
-- is what makes the commit readable enough to review: every family becomes one
-- insert plus one ledger call, and the ledger vocabulary is enforced once.
create or replace function public.record_canonical_rows(
  p_import_job_id uuid,
  p_tenant_id     uuid,
  p_study_id      uuid,
  p_target_table  text,
  p_ids           uuid[],
  p_ownership     text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  written integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;
  insert into public.import_job_record (
    import_job_id, tenant_id, study_id, target_table, target_record_id, ownership
  )
  select p_import_job_id, p_tenant_id, p_study_id, p_target_table, candidate, p_ownership
  from unnest(p_ids) as candidate;
  get diagnostics written = row_count;
  return written;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 8. Staging: bind a package, its assets and its plan fingerprint to one job
-- -----------------------------------------------------------------------------
-- Tenant and study arrive as explicit arguments and are VERIFIED against
-- `public.study` before anything is written; the commit itself never reads them
-- from a payload. Staging is idempotent on `(study_id, idempotency_key)`, which
-- is what makes a reordered or repeated upload the same package.
create or replace function public.stage_canonical_package(
  p_tenant_id uuid,
  p_study_id  uuid,
  p_request   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job              public.import_job%rowtype;
  requested_roles  text[];
  linked_roles     text[];
  asset_count      integer;
  owned_rows       integer;
  incoming_key     text;
  incoming_print   text;
  incoming_version integer;
begin
  if jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_NOT_OBJECT';
  end if;

  incoming_key     := p_request ->> 'idempotencyKey';
  incoming_print   := p_request ->> 'planFingerprint';
  incoming_version := (p_request ->> 'mappingVersion')::integer;

  if incoming_key is null or incoming_key !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_INVALID';
  end if;
  if incoming_print is null or incoming_print !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'PLAN_FINGERPRINT_INVALID';
  end if;
  if incoming_version is null or incoming_version <= 0 then
    raise exception using errcode = '22023', message = 'MAPPING_VERSION_INVALID';
  end if;
  if jsonb_typeof(p_request -> 'assets') <> 'array'
     or jsonb_array_length(p_request -> 'assets') = 0
     or jsonb_array_length(p_request -> 'assets') > 16 then
    raise exception using errcode = '22023', message = 'ASSET_SET_INVALID';
  end if;

  -- The study must exist AND belong to the tenant the caller named. Every later
  -- scope decision derives from the job row this creates, not from an argument.
  if not exists (
    select 1 from public.study where id = p_study_id and tenant_id = p_tenant_id
  ) then
    raise exception using errcode = '42501', message = 'STUDY_TENANT_MISMATCH';
  end if;

  -- Assets are identified by content. The same bytes uploaded again are the
  -- same asset row, whatever the operator called the file this time.
  insert into public.source_asset (
    tenant_id, study_id, sha256, file_name, media_type, size_bytes, workbook_metadata, uploaded_by
  )
  select p_tenant_id,
         p_study_id,
         asset ->> 'sha256',
         asset ->> 'fileName',
         asset ->> 'mediaType',
         (asset ->> 'sizeBytes')::bigint,
         coalesce(asset -> 'workbookMetadata', '{}'::jsonb),
         nullif(p_request ->> 'createdBy', '')::uuid
  from jsonb_array_elements(p_request -> 'assets') as element(asset)
  on conflict (study_id, sha256) do update
    set file_name         = excluded.file_name,
        media_type        = excluded.media_type,
        size_bytes        = excluded.size_bytes,
        workbook_metadata = excluded.workbook_metadata;

  insert into public.import_job (
    tenant_id, study_id, idempotency_key, mapping_version, status, manifest,
    expected_counts, plan_fingerprint, created_by
  )
  values (
    p_tenant_id, p_study_id, incoming_key, incoming_version, 'validated',
    coalesce(p_request -> 'manifest', '{}'::jsonb),
    coalesce(p_request -> 'expectedCounts', '{}'::jsonb),
    incoming_print,
    nullif(p_request ->> 'createdBy', '')::uuid
  )
  on conflict (study_id, idempotency_key) do nothing;

  select * into job
  from public.import_job
  where study_id = p_study_id and idempotency_key = incoming_key
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'JOB_NOT_FOUND';
  end if;
  if job.tenant_id <> p_tenant_id then
    raise exception using errcode = '42501', message = 'TENANT_SCOPE_MISMATCH';
  end if;

  select count(*) into owned_rows
  from public.import_job_record where import_job_id = job.id;

  -- A committed or in-flight package is frozen. A job that owns no canonical
  -- rows may be re-staged, which is what lets a corrected plan be committed
  -- after a failure or a rollback.
  if job.status in ('committed', 'committing') then
    if job.plan_fingerprint is distinct from incoming_print then
      raise exception using errcode = '55000', message = 'PLAN_FINGERPRINT_FROZEN';
    end if;
  elsif owned_rows > 0 then
    raise exception using errcode = '55000', message = 'PACKAGE_ROWS_PRESENT';
  else
    update public.import_job
    set mapping_version  = incoming_version,
        plan_fingerprint = incoming_print,
        manifest         = coalesce(p_request -> 'manifest', '{}'::jsonb),
        expected_counts  = coalesce(p_request -> 'expectedCounts', '{}'::jsonb),
        status           = case when status = 'staged' then 'validated' else status end,
        validated_at     = coalesce(validated_at, now())
    where id = job.id;
  end if;

  insert into public.import_job_asset (
    import_job_id, source_asset_id, tenant_id, study_id, asset_role
  )
  select job.id, stored.id, job.tenant_id, job.study_id, asset ->> 'role'
  from jsonb_array_elements(p_request -> 'assets') as element(asset)
  join public.source_asset stored
    on stored.study_id = job.study_id and stored.sha256 = asset ->> 'sha256'
  on conflict (import_job_id, source_asset_id) do nothing;

  -- The job's asset set must be EXACTLY the requested one. Anything else means
  -- the job already carries a different package and must not be reused.
  select array_agg(distinct asset ->> 'role' order by asset ->> 'role')
  into requested_roles
  from jsonb_array_elements(p_request -> 'assets') as element(asset);

  select array_agg(distinct asset_role order by asset_role), count(*)
  into linked_roles, asset_count
  from public.import_job_asset where import_job_id = job.id;

  if linked_roles is distinct from requested_roles
     or asset_count <> jsonb_array_length(p_request -> 'assets') then
    raise exception using errcode = '55000', message = 'ASSET_SET_MISMATCH';
  end if;

  select * into job from public.import_job where id = job.id;

  return jsonb_build_object(
    'importJobId', job.id,
    'status', job.status,
    'assets', asset_count,
    'planFingerprint', job.plan_fingerprint,
    'commitAttempts', job.commit_attempts,
    'rollbackCount', job.rollback_count
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- 9. The transactional commit
-- -----------------------------------------------------------------------------
-- The whole package is written inside ONE PL/pgSQL block guarded by an
-- exception handler. That block is a subtransaction: when it raises, every row
-- it inserted is discarded and the outer transaction stays alive, so the job
-- can be marked `failed` with certainty that nothing survived the attempt.
--
-- What the payload may NOT decide:
--   * tenant and study — derived from the locked job, and the payload's own
--     claim is compared against it and refused on a mismatch;
--   * which source asset a row came from — the payload names a ROLE, and the
--     role is resolved through this job's own `import_job_asset` links;
--   * how many rows were written — every count comes from ROW_COUNT.
create or replace function public.commit_canonical_package(
  p_import_job_id uuid,
  p_plan          jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job            public.import_job%rowtype;
  asset_map      jsonb;
  person_map     jsonb;
  actual         jsonb := '{}'::jsonb;
  expected       jsonb;
  digest         text;
  owned_rows     integer;
  n              integer;
  created_people integer := 0;
  reused_people  integer := 0;
  created_ids    integer := 0;
  reused_ids     integer := 0;
  new_person_ids uuid[] := '{}'::uuid[];
  new_id_rows    uuid[] := '{}'::uuid[];
  ledger_rows    integer := 0;
  failure_code   text;
  failure_state  text;
  failure_hint   text;
  family_name    text;
begin
  if jsonb_typeof(p_plan) <> 'object' then
    raise exception using errcode = '22023', message = 'PLAN_NOT_OBJECT';
  end if;
  if octet_length(p_plan::text) > 33554432 then
    raise exception using errcode = '54000', message = 'PLAN_TOO_LARGE';
  end if;

  select * into job from public.import_job where id = p_import_job_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'JOB_NOT_FOUND';
  end if;
  if job.plan_fingerprint is null then
    raise exception using errcode = '55000', message = 'JOB_HAS_NO_STAGED_PLAN';
  end if;
  if p_plan ->> 'planFingerprint' is distinct from job.plan_fingerprint then
    raise exception using errcode = '22023', message = 'PLAN_FINGERPRINT_MISMATCH';
  end if;

  -- The payload states its scope so the database can REFUSE it, not so the
  -- database can adopt it. Authority is the locked row, in both directions.
  if (p_plan ->> 'tenantId')::uuid is distinct from job.tenant_id then
    raise exception using errcode = '42501', message = 'TENANT_SCOPE_MISMATCH';
  end if;
  if (p_plan ->> 'studyId')::uuid is distinct from job.study_id then
    raise exception using errcode = '42501', message = 'STUDY_SCOPE_MISMATCH';
  end if;
  if not exists (
    select 1 from public.study where id = job.study_id and tenant_id = job.tenant_id
  ) then
    raise exception using errcode = '42501', message = 'STUDY_TENANT_MISMATCH';
  end if;

  -- An independent, database-side digest of the payload minus its declared
  -- fingerprint. jsonb normalises key order, so a re-serialised identical plan
  -- digests identically and a changed value never does.
  digest := encode(
    pg_catalog.sha256(pg_catalog.convert_to((p_plan - 'planFingerprint')::text, 'UTF8')),
    'hex'
  );

  if job.status = 'committed' then
    if job.payload_digest is distinct from digest then
      raise exception using errcode = '55000', message = 'COMMITTED_PAYLOAD_DIFFERS';
    end if;
    return jsonb_build_object(
      'importJobId', job.id,
      'status', 'committed',
      'replayed', true,
      'counts', job.actual_counts,
      'planFingerprint', job.plan_fingerprint,
      'commitAttempts', job.commit_attempts,
      'rollbackCount', job.rollback_count
    );
  end if;

  if job.status not in ('staged', 'validated', 'failed', 'rolled_back', 'committing') then
    raise exception using errcode = '55000', message = 'ILLEGAL_STATE_TRANSITION';
  end if;

  -- A retry may only proceed over an empty ledger. `committing` is reachable
  -- only from an attempt whose transaction never committed, so its rows are
  -- already gone; if any survive, something outside this function wrote them
  -- and the package must not be committed on top of them.
  select count(*) into owned_rows
  from public.import_job_record where import_job_id = job.id;
  if owned_rows > 0 then
    raise exception using errcode = '55000', message = 'PACKAGE_ROWS_PRESENT';
  end if;

  update public.import_job
  set status          = 'committing',
      commit_attempts = commit_attempts + 1,
      last_error_code = null
  where id = job.id;

  begin
    -- Every source asset this package may cite, by the ROLE the job links it
    -- under. A role the job does not carry cannot be named by the payload.
    select coalesce(jsonb_object_agg(asset_role, source_asset_id), '{}'::jsonb)
    into asset_map
    from public.import_job_asset where import_job_id = job.id;

    if exists (
      select 1
      from (
        select distinct value ->> 'sourceAssetRole' as role
        from jsonb_array_elements(coalesce(p_plan -> 'sourceLineage', '[]'::jsonb))
        union
        select distinct value ->> 'sourceAssetRole'
        from jsonb_array_elements(coalesce(p_plan -> 'surveySessions', '[]'::jsonb))
        union
        select distinct value ->> 'sourceAssetRole'
        from jsonb_array_elements(coalesce(p_plan -> 'visualAnnotations', '[]'::jsonb))
      ) as cited
      where cited.role is not null and not (asset_map ? cited.role)
    ) then
      raise exception using errcode = '23503', message = 'ASSET_ROLE_UNKNOWN';
    end if;

    -- Every declared family must be a JSON array. A misspelled family would
    -- otherwise be silently imported as nothing at all.
    foreach family_name in array array[
      'persons', 'personIdentifiers', 'participants', 'membershipEpisodes',
      'attributeDefinitions', 'participantAttributeValues', 'responseScales',
      'responseOptions', 'surveyInstruments', 'studyDomains', 'surveyItems',
      'surveySessions', 'surveyResponses', 'visualAnnotations',
      'performanceDimensions', 'performanceObservations', 'bandSchemes', 'bandRules',
      'retentionPeriods', 'metricDefinitions', 'metricItemLinks', 'journeyModels',
      'journeyStages', 'journeyStageEvidenceLinks', 'organizationalUnits',
      'cultureDimensions', 'painPoints', 'painPointJourneyStages',
      'painPointOrganizationalUnits', 'painPointPerformanceDimensions',
      'painPointCultureDimensions', 'sourceLineage'
    ] loop
      if p_plan ? family_name and jsonb_typeof(p_plan -> family_name) <> 'array' then
        raise exception using errcode = '22023', message = 'PLAN_FAMILY_NOT_ARRAY';
      end if;
    end loop;

    -- ---- identity: reuse a person who already exists in this tenant --------
    if (
      select count(distinct person.value ->> 'key') <> count(*)
      from jsonb_array_elements(coalesce(p_plan -> 'persons', '[]'::jsonb)) as person
    ) then
      raise exception using errcode = '22023', message = 'DUPLICATE_PERSON_KEY';
    end if;

    select coalesce(
      jsonb_object_agg(
        person.value ->> 'key',
        coalesce(existing.person_id, (person.value ->> 'id')::uuid)
      ),
      '{}'::jsonb
    )
    into person_map
    from jsonb_array_elements(coalesce(p_plan -> 'persons', '[]'::jsonb)) as person
    left join public.person_external_identifier existing
      on existing.tenant_id = job.tenant_id
     and existing.namespace = person.value ->> 'identityNamespace'
     and existing.normalized_value = person.value ->> 'identityNormalizedValue';

    -- RETURNING is what makes ownership exact: the ledger records the rows this
    -- statement really inserted, not the rows the payload hoped it would.
    with inserted as (
      insert into public.person_private (
        id, tenant_id, display_name_private, normalized_name_private
      )
      select (person.value ->> 'id')::uuid,
             job.tenant_id,
             person.value ->> 'displayName',
             person.value ->> 'normalizedName'
      from jsonb_array_elements(coalesce(p_plan -> 'persons', '[]'::jsonb)) as person
      where (person_map ->> (person.value ->> 'key'))::uuid = (person.value ->> 'id')::uuid
      returning id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into new_person_ids from inserted;
    created_people := coalesce(array_length(new_person_ids, 1), 0);

    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'person_private', new_person_ids, 'created'
    );
    select count(*) into reused_people
    from jsonb_array_elements(coalesce(p_plan -> 'persons', '[]'::jsonb)) as person
    where (person_map ->> (person.value ->> 'key'))::uuid <> (person.value ->> 'id')::uuid;
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'person_private',
      array(
        select distinct (person_map ->> (person.value ->> 'key'))::uuid
        from jsonb_array_elements(coalesce(p_plan -> 'persons', '[]'::jsonb)) as person
        where (person_map ->> (person.value ->> 'key'))::uuid <> (person.value ->> 'id')::uuid
      ),
      'reused'
    );

    with inserted as (
      insert into public.person_external_identifier (
        id, tenant_id, person_id, namespace, original_value, normalized_value, is_primary
      )
      select t."id",
             job.tenant_id,
             (person_map ->> t."personKey")::uuid,
             t."namespace",
             t."originalValue",
             t."normalizedValue",
             t."isPrimary"
      from jsonb_to_recordset(coalesce(p_plan -> 'personIdentifiers', '[]'::jsonb)) as t(
        "id" uuid, "personKey" text, "namespace" text,
        "originalValue" text, "normalizedValue" text, "isPrimary" boolean
      )
      where not exists (
        select 1 from public.person_external_identifier existing
        where existing.tenant_id = job.tenant_id
          and existing.namespace = t."namespace"
          and existing.normalized_value = t."normalizedValue"
      )
      returning id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into new_id_rows from inserted;
    created_ids := coalesce(array_length(new_id_rows, 1), 0);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'person_external_identifier',
      new_id_rows, 'created'
    );
    select count(*) into reused_ids
    from jsonb_to_recordset(coalesce(p_plan -> 'personIdentifiers', '[]'::jsonb)) as t(
      "id" uuid, "namespace" text, "normalizedValue" text
    )
    where not (t."id" = any (new_id_rows));
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'person_external_identifier',
      array(
        select distinct stored.id
        from jsonb_to_recordset(coalesce(p_plan -> 'personIdentifiers', '[]'::jsonb)) as t(
          "id" uuid, "namespace" text, "normalizedValue" text
        )
        join public.person_external_identifier stored
          on stored.tenant_id = job.tenant_id
         and stored.namespace = t."namespace"
         and stored.normalized_value = t."normalizedValue"
        where stored.id <> t."id"
      ),
      'reused'
    );

    -- ---- participation -----------------------------------------------------
    insert into public.study_participant (
      id, tenant_id, study_id, person_id, cohort_key,
      participation_status, survey_participation_status, source_status
    )
    select t."id", job.tenant_id, job.study_id,
           (person_map ->> t."personKey")::uuid, t."cohortKey",
           t."participationStatus", t."surveyParticipationStatus", t."sourceStatus"
    from jsonb_to_recordset(coalesce(p_plan -> 'participants', '[]'::jsonb)) as t(
      "id" uuid, "personKey" text, "cohortKey" text,
      "participationStatus" text, "surveyParticipationStatus" text, "sourceStatus" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('participants', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'study_participant',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'participants', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.membership_episode (
      id, tenant_id, study_id, participant_id, starts_on, ends_on, status, end_reason
    )
    select t."id", job.tenant_id, job.study_id, t."participantId",
           t."startsOn", t."endsOn", t."status", t."endReason"
    from jsonb_to_recordset(coalesce(p_plan -> 'membershipEpisodes', '[]'::jsonb)) as t(
      "id" uuid, "participantId" uuid, "startsOn" date, "endsOn" date,
      "status" text, "endReason" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('membershipEpisodes', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'membership_episode',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'membershipEpisodes', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- typed attributes --------------------------------------------------
    insert into public.attribute_definition (
      id, tenant_id, study_id, key, label, data_type, sensitivity, filterable, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label",
           t."dataType", t."sensitivity", t."filterable", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'attributeDefinitions', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "dataType" text,
      "sensitivity" text, "filterable" boolean, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('attributeDefinitions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'attribute_definition',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'attributeDefinitions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.participant_attribute_value (
      id, tenant_id, study_id, participant_id, attribute_definition_id, status,
      value_text, value_numeric, value_date, value_boolean, source_raw_value
    )
    select t."id", job.tenant_id, job.study_id, t."participantId", t."attributeDefinitionId",
           t."status", t."valueText", t."valueNumeric", t."valueDate", t."valueBoolean",
           t."sourceRawValue"
    from jsonb_to_recordset(coalesce(p_plan -> 'participantAttributeValues', '[]'::jsonb)) as t(
      "id" uuid, "participantId" uuid, "attributeDefinitionId" uuid, "status" text,
      "valueText" text, "valueNumeric" numeric, "valueDate" date, "valueBoolean" boolean,
      "sourceRawValue" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('participantAttributeValues', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'participant_attribute_value',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'participantAttributeValues', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- instruments -------------------------------------------------------
    insert into public.response_scale (id, tenant_id, study_id, key, label, value_type)
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."valueType"
    from jsonb_to_recordset(coalesce(p_plan -> 'responseScales', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "valueType" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('responseScales', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'response_scale',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'responseScales', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.response_option (
      id, tenant_id, study_id, response_scale_id, raw_value, numeric_value,
      derived_label, response_status, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."responseScaleId", t."rawValue",
           t."numericValue", t."derivedLabel", t."responseStatus", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'responseOptions', '[]'::jsonb)) as t(
      "id" uuid, "responseScaleId" uuid, "rawValue" text, "numericValue" numeric,
      "derivedLabel" text, "responseStatus" text, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('responseOptions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'response_option',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'responseOptions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- Visual annotations precede everything that points at one.
    insert into public.visual_annotation (
      id, tenant_id, study_id, source_asset_id, sheet_name, cell_or_range,
      fill_rgb, font_rgb, source_style_id, role, interpretation, confidence, review_status
    )
    select t."id", job.tenant_id, job.study_id,
           (asset_map ->> t."sourceAssetRole")::uuid,
           t."sheetName", t."cellOrRange", t."fillRgb", t."fontRgb", t."sourceStyleId",
           t."role", t."interpretation", t."confidence", t."reviewStatus"
    from jsonb_to_recordset(coalesce(p_plan -> 'visualAnnotations', '[]'::jsonb)) as t(
      "id" uuid, "sourceAssetRole" text, "sheetName" text, "cellOrRange" text,
      "fillRgb" text, "fontRgb" text, "sourceStyleId" integer, "role" text,
      "interpretation" text, "confidence" text, "reviewStatus" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('visualAnnotations', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'visual_annotation',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'visualAnnotations', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.survey_instrument (
      id, tenant_id, study_id, key, label, audience, version, instrument_type
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."audience",
           t."version", t."instrumentType"
    from jsonb_to_recordset(coalesce(p_plan -> 'surveyInstruments', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "audience" text,
      "version" integer, "instrumentType" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('surveyInstruments', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'survey_instrument',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'surveyInstruments', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.study_domain (
      id, tenant_id, study_id, survey_instrument_id, key, label, display_order, visual_annotation_id
    )
    select t."id", job.tenant_id, job.study_id, t."surveyInstrumentId", t."key",
           t."label", t."displayOrder", t."visualAnnotationId"
    from jsonb_to_recordset(coalesce(p_plan -> 'studyDomains', '[]'::jsonb)) as t(
      "id" uuid, "surveyInstrumentId" uuid, "key" text, "label" text,
      "displayOrder" integer, "visualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('studyDomains', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'study_domain',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'studyDomains', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.survey_item (
      id, tenant_id, study_id, survey_instrument_id, study_domain_id, response_scale_id,
      key, prompt, label, item_order
    )
    select t."id", job.tenant_id, job.study_id, t."surveyInstrumentId", t."studyDomainId",
           t."responseScaleId", t."key", t."prompt", t."label", t."itemOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'surveyItems', '[]'::jsonb)) as t(
      "id" uuid, "surveyInstrumentId" uuid, "studyDomainId" uuid, "responseScaleId" uuid,
      "key" text, "prompt" text, "label" text, "itemOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('surveyItems', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'survey_item',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'surveyItems', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.survey_session (
      id, tenant_id, study_id, survey_instrument_id, participant_id, source_asset_id,
      source_row_number, occurrence_key, submitted_at, status
    )
    select t."id", job.tenant_id, job.study_id, t."surveyInstrumentId", t."participantId",
           (asset_map ->> t."sourceAssetRole")::uuid,
           t."sourceRowNumber", t."occurrenceKey", t."submittedAt", t."status"
    from jsonb_to_recordset(coalesce(p_plan -> 'surveySessions', '[]'::jsonb)) as t(
      "id" uuid, "surveyInstrumentId" uuid, "participantId" uuid, "sourceAssetRole" text,
      "sourceRowNumber" integer, "occurrenceKey" text, "submittedAt" timestamptz, "status" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('surveySessions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'survey_session',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'surveySessions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.survey_response (
      id, tenant_id, study_id, survey_session_id, survey_item_id, response_option_id,
      status, value_numeric, value_text, value_date, value_boolean,
      source_raw_value, source_derived_label
    )
    select t."id", job.tenant_id, job.study_id, t."surveySessionId", t."surveyItemId",
           t."responseOptionId", t."status", t."valueNumeric", t."valueText",
           t."valueDate", t."valueBoolean", t."sourceRawValue", t."sourceDerivedLabel"
    from jsonb_to_recordset(coalesce(p_plan -> 'surveyResponses', '[]'::jsonb)) as t(
      "id" uuid, "surveySessionId" uuid, "surveyItemId" uuid, "responseOptionId" uuid,
      "status" text, "valueNumeric" numeric, "valueText" text, "valueDate" date,
      "valueBoolean" boolean, "sourceRawValue" text, "sourceDerivedLabel" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('surveyResponses', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'survey_response',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'surveyResponses', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- performance, bands and retention ----------------------------------
    insert into public.performance_dimension (
      id, tenant_id, study_id, key, label, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'performanceDimensions', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('performanceDimensions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'performance_dimension',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'performanceDimensions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.performance_observation (
      id, tenant_id, study_id, participant_id, performance_dimension_id, period_start,
      period_label, status, value, source_band_label, visual_annotation_id
    )
    select t."id", job.tenant_id, job.study_id, t."participantId", t."performanceDimensionId",
           t."periodStart", t."periodLabel", t."status", t."value", t."sourceBandLabel",
           t."visualAnnotationId"
    from jsonb_to_recordset(coalesce(p_plan -> 'performanceObservations', '[]'::jsonb)) as t(
      "id" uuid, "participantId" uuid, "performanceDimensionId" uuid, "periodStart" date,
      "periodLabel" text, "status" text, "value" numeric, "sourceBandLabel" text,
      "visualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('performanceObservations', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'performance_observation',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'performanceObservations', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.band_scheme (id, tenant_id, study_id, key, label, unit, description)
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."unit",
           coalesce(t."description", '')
    from jsonb_to_recordset(coalesce(p_plan -> 'bandSchemes', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "unit" text, "description" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('bandSchemes', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'band_scheme',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'bandSchemes', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.band_rule (
      id, tenant_id, study_id, band_scheme_id, lower_bound, upper_bound,
      lower_inclusive, upper_inclusive, label, semantic_color, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."bandSchemeId", t."lowerBound",
           t."upperBound", t."lowerInclusive", t."upperInclusive", t."label",
           t."semanticColor", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'bandRules', '[]'::jsonb)) as t(
      "id" uuid, "bandSchemeId" uuid, "lowerBound" numeric, "upperBound" numeric,
      "lowerInclusive" boolean, "upperInclusive" boolean, "label" text,
      "semanticColor" text, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('bandRules', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'band_rule',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'bandRules', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.retention_period (
      id, tenant_id, study_id, import_job_id, series_key, period_order, period_label,
      period_starts_on, period_ends_on,
      starting_status, starting_count, new_status, new_count,
      ending_status, ending_count, lost_status, lost_count, identity_verified
    )
    select t."id", job.tenant_id, job.study_id, job.id, t."seriesKey", t."periodOrder",
           t."periodLabel", t."periodStartsOn", t."periodEndsOn",
           t."startingStatus", t."startingCount", t."newStatus", t."newCount",
           t."endingStatus", t."endingCount", t."lostStatus", t."lostCount",
           t."identityVerified"
    from jsonb_to_recordset(coalesce(p_plan -> 'retentionPeriods', '[]'::jsonb)) as t(
      "id" uuid, "seriesKey" text, "periodOrder" integer, "periodLabel" text,
      "periodStartsOn" date, "periodEndsOn" date,
      "startingStatus" text, "startingCount" integer, "newStatus" text, "newCount" integer,
      "endingStatus" text, "endingCount" integer, "lostStatus" text, "lostCount" integer,
      "identityVerified" boolean
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('retentionPeriods', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'retention_period',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'retentionPeriods', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- metrics -----------------------------------------------------------
    insert into public.metric_definition (
      id, tenant_id, study_id, key, label, family, unit, precision,
      calculation_version, band_scheme_id, is_publishable
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."family", t."unit",
           t."precision", t."calculationVersion", t."bandSchemeId", t."isPublishable"
    from jsonb_to_recordset(coalesce(p_plan -> 'metricDefinitions', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "family" text, "unit" text, "precision" integer,
      "calculationVersion" text, "bandSchemeId" uuid, "isPublishable" boolean
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('metricDefinitions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'metric_definition',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'metricDefinitions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.metric_item_link (
      id, tenant_id, study_id, metric_definition_id, survey_item_id, study_domain_id,
      performance_dimension_id, role, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."metricDefinitionId", t."surveyItemId",
           t."studyDomainId", t."performanceDimensionId", t."role", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'metricItemLinks', '[]'::jsonb)) as t(
      "id" uuid, "metricDefinitionId" uuid, "surveyItemId" uuid, "studyDomainId" uuid,
      "performanceDimensionId" uuid, "role" text, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('metricItemLinks', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'metric_item_link',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'metricItemLinks', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- journeys ----------------------------------------------------------
    insert into public.journey_model (
      id, tenant_id, study_id, key, label, audience, description, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."audience",
           coalesce(t."description", ''), t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'journeyModels', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "audience" text, "description" text,
      "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('journeyModels', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'journey_model',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'journeyModels', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.journey_stage (
      id, tenant_id, study_id, journey_model_id, key, label, stage_order,
      description, visual_annotation_id
    )
    select t."id", job.tenant_id, job.study_id, t."journeyModelId", t."key", t."label",
           t."stageOrder", coalesce(t."description", ''), t."visualAnnotationId"
    from jsonb_to_recordset(coalesce(p_plan -> 'journeyStages', '[]'::jsonb)) as t(
      "id" uuid, "journeyModelId" uuid, "key" text, "label" text, "stageOrder" integer,
      "description" text, "visualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('journeyStages', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'journey_stage',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'journeyStages', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.journey_stage_evidence_link (
      id, tenant_id, study_id, journey_stage_id, metric_definition_id, survey_item_id,
      performance_dimension_id, role, display_order
    )
    select t."id", job.tenant_id, job.study_id, t."journeyStageId", t."metricDefinitionId",
           t."surveyItemId", t."performanceDimensionId", t."role", t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'journeyStageEvidenceLinks', '[]'::jsonb)) as t(
      "id" uuid, "journeyStageId" uuid, "metricDefinitionId" uuid, "surveyItemId" uuid,
      "performanceDimensionId" uuid, "role" text, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('journeyStageEvidenceLinks', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'journey_stage_evidence_link',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'journeyStageEvidenceLinks', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- organisation and culture ------------------------------------------
    insert into public.organizational_unit (
      id, tenant_id, study_id, key, label, display_order, visual_annotation_id
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."displayOrder",
           t."visualAnnotationId"
    from jsonb_to_recordset(coalesce(p_plan -> 'organizationalUnits', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "displayOrder" integer, "visualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('organizationalUnits', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'organizational_unit',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'organizationalUnits', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.culture_dimension (
      id, tenant_id, study_id, key, label, audience, display_order, visual_annotation_id
    )
    select t."id", job.tenant_id, job.study_id, t."key", t."label", t."audience",
           t."displayOrder", t."visualAnnotationId"
    from jsonb_to_recordset(coalesce(p_plan -> 'cultureDimensions', '[]'::jsonb)) as t(
      "id" uuid, "key" text, "label" text, "audience" text, "displayOrder" integer,
      "visualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('cultureDimensions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'culture_dimension',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'cultureDimensions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- curated findings and their real relationships ---------------------
    insert into public.pain_point (
      id, tenant_id, study_id, raw_text, normalized_text, review_status,
      source_visual_annotation_id, created_by
    )
    select t."id", job.tenant_id, job.study_id, t."rawText", t."normalizedText",
           t."reviewStatus", t."sourceVisualAnnotationId", job.created_by
    from jsonb_to_recordset(coalesce(p_plan -> 'painPoints', '[]'::jsonb)) as t(
      "id" uuid, "rawText" text, "normalizedText" text, "reviewStatus" text,
      "sourceVisualAnnotationId" uuid
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('painPoints', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'pain_point',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'painPoints', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.pain_point_journey_stage (
      id, pain_point_id, journey_stage_id, tenant_id, study_id, display_order
    )
    select t."id", t."painPointId", t."journeyStageId", job.tenant_id, job.study_id, t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'painPointJourneyStages', '[]'::jsonb)) as t(
      "id" uuid, "painPointId" uuid, "journeyStageId" uuid, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('painPointJourneyStages', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'pain_point_journey_stage',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'painPointJourneyStages', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.pain_point_organizational_unit (
      id, pain_point_id, organizational_unit_id, tenant_id, study_id, display_order
    )
    select t."id", t."painPointId", t."organizationalUnitId", job.tenant_id, job.study_id, t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'painPointOrganizationalUnits', '[]'::jsonb)) as t(
      "id" uuid, "painPointId" uuid, "organizationalUnitId" uuid, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('painPointOrganizationalUnits', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'pain_point_organizational_unit',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'painPointOrganizationalUnits', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.pain_point_performance_dimension (
      id, pain_point_id, performance_dimension_id, tenant_id, study_id, display_order
    )
    select t."id", t."painPointId", t."performanceDimensionId", job.tenant_id, job.study_id, t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'painPointPerformanceDimensions', '[]'::jsonb)) as t(
      "id" uuid, "painPointId" uuid, "performanceDimensionId" uuid, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('painPointPerformanceDimensions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'pain_point_performance_dimension',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'painPointPerformanceDimensions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    insert into public.pain_point_culture_dimension (
      id, pain_point_id, culture_dimension_id, tenant_id, study_id, display_order
    )
    select t."id", t."painPointId", t."cultureDimensionId", job.tenant_id, job.study_id, t."displayOrder"
    from jsonb_to_recordset(coalesce(p_plan -> 'painPointCultureDimensions', '[]'::jsonb)) as t(
      "id" uuid, "painPointId" uuid, "cultureDimensionId" uuid, "displayOrder" integer
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('painPointCultureDimensions', n);
    ledger_rows := ledger_rows + public.record_canonical_rows(
      job.id, job.tenant_id, job.study_id, 'pain_point_culture_dimension',
      array(select t."id" from jsonb_to_recordset(coalesce(p_plan -> 'painPointCultureDimensions', '[]'::jsonb)) as t("id" uuid)),
      'created'
    );

    -- ---- provenance --------------------------------------------------------
    insert into public.source_lineage (
      tenant_id, study_id, import_job_id, source_asset_id, sheet_name, cell_or_range,
      source_row, source_column, target_table, target_record_id, target_field,
      transformation_key, source_raw_value
    )
    select job.tenant_id, job.study_id, job.id,
           (asset_map ->> t."sourceAssetRole")::uuid,
           t."sheetName", t."cellOrRange", t."sourceRow", t."sourceColumn",
           t."targetTable", t."targetRecordId", t."targetField", t."transformationKey",
           t."sourceRawValue"
    from jsonb_to_recordset(coalesce(p_plan -> 'sourceLineage', '[]'::jsonb)) as t(
      "sourceAssetRole" text, "sheetName" text, "cellOrRange" text, "sourceRow" integer,
      "sourceColumn" text, "targetTable" text, "targetRecordId" uuid, "targetField" text,
      "transformationKey" text, "sourceRawValue" text
    );
    get diagnostics n = row_count;
    actual := actual || jsonb_build_object('sourceLineage', n);

    -- ---- reconciliation ----------------------------------------------------
    -- Person families reconcile as created + reused, because a person shared
    -- with another study is legitimately not inserted here.
    actual := actual || jsonb_build_object(
      'persons', created_people + reused_people,
      'personIdentifiers', created_ids + reused_ids
    );

    expected := coalesce(p_plan -> 'expectedCounts', '{}'::jsonb);
    if jsonb_typeof(expected) <> 'object' or expected = '{}'::jsonb then
      raise exception using errcode = '22023', message = 'EXPECTED_COUNTS_MISSING';
    end if;
    if exists (
      select 1 from jsonb_each_text(expected) as e(family_key, family_count)
      where (actual ->> e.family_key) is distinct from e.family_count
    ) then
      raise exception using errcode = '22023', message = 'COUNT_MISMATCH';
    end if;
    if exists (
      select 1 from jsonb_object_keys(actual) as measured(family_key)
      where not (expected ? measured.family_key)
    ) then
      raise exception using errcode = '22023', message = 'COUNT_FAMILY_UNDECLARED';
    end if;

    -- The ledger must account for every canonical row this package created,
    -- because rollback can only remove what the ledger names.
    if ledger_rows <> (
      select count(*) from public.import_job_record where import_job_id = job.id
    ) then
      raise exception using errcode = '22023', message = 'LEDGER_INCONSISTENT';
    end if;

    update public.import_job
    set status          = 'committed',
        committed_at    = now(),
        rolled_back_at  = null,
        actual_counts   = actual || jsonb_build_object(
          '_personsCreated', created_people,
          '_personsReused', reused_people,
          '_identifiersCreated', created_ids,
          '_identifiersReused', reused_ids,
          '_ledgerRows', ledger_rows
        ),
        payload_digest  = digest,
        error_report    = '{}'::jsonb,
        last_error_code = null
    where id = job.id;

  exception
    when others then
      -- The block above was a subtransaction; raising rolled every row it
      -- inserted back. Only the outer transaction survives, so the failure can
      -- be recorded with certainty that the package left nothing behind.
      get stacked diagnostics
        failure_state = returned_sqlstate,
        failure_code  = message_text,
        failure_hint  = constraint_name;
      -- A PostgreSQL message quotes the failing key values, which here are
      -- respondent data. Only a code this migration itself raised is kept.
      if failure_code is null or failure_code !~ '^[A-Z][A-Z0-9_]{1,59}$' then
        failure_code := 'DATABASE_CONSTRAINT';
      end if;
      if failure_hint is null or failure_hint !~ '^[a-z][a-z0-9_]{0,62}$' then
        failure_hint := null;
      end if;
      update public.import_job
      set status          = 'failed',
          actual_counts   = '{}'::jsonb,
          committed_at    = null,
          payload_digest  = null,
          last_error_code = failure_code,
          error_report    = jsonb_build_object(
            'code', failure_code,
            'sqlstate', failure_state,
            'constraint', failure_hint
          )
      where id = job.id;

      return jsonb_build_object(
        'importJobId', job.id,
        'status', 'failed',
        'replayed', false,
        'code', failure_code,
        'sqlstate', failure_state,
        'constraint', failure_hint,
        'counts', '{}'::jsonb
      );
  end;

  select * into job from public.import_job where id = job.id;
  return jsonb_build_object(
    'importJobId', job.id,
    'status', job.status,
    'replayed', false,
    'counts', job.actual_counts,
    'planFingerprint', job.plan_fingerprint,
    'commitAttempts', job.commit_attempts,
    'rollbackCount', job.rollback_count
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- 10. The explicit rollback
-- -----------------------------------------------------------------------------
-- Removes exactly the rows the ledger says this package CREATED, in reverse
-- dependency order, and leaves every reused row alone. A stable person is
-- deleted only when nothing else references it any more; otherwise it is
-- retained and counted, because a shared identity is not this package's to
-- destroy. Source assets and job asset links deliberately survive.
create or replace function public.rollback_canonical_package(
  p_import_job_id uuid,
  p_actor         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  job          public.import_job%rowtype;
  target       text;
  removed      jsonb := '{}'::jsonb;
  n            integer;
  retained     integer := 0;
  ledger_left  integer;
  -- Reverse dependency order. Every `on delete restrict` reference is removed
  -- before the row it points at. `person_private` is handled separately and
  -- last, because it can be shared with a study this package never touched.
  ordered_tables text[] := array[
    'pain_point_culture_dimension', 'pain_point_performance_dimension',
    'pain_point_organizational_unit', 'pain_point_journey_stage', 'pain_point',
    'journey_stage_evidence_link', 'journey_stage', 'journey_model',
    'metric_item_link', 'metric_definition', 'band_rule', 'band_scheme',
    'retention_period', 'performance_observation', 'performance_dimension',
    'survey_response', 'survey_session', 'survey_item', 'study_domain',
    'survey_instrument', 'response_option', 'response_scale',
    'participant_attribute_value', 'attribute_definition',
    'membership_episode', 'study_participant',
    'culture_dimension', 'organizational_unit', 'visual_annotation',
    'person_external_identifier'
  ];
begin
  select * into job from public.import_job where id = p_import_job_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'JOB_NOT_FOUND';
  end if;

  -- Repeating a rollback is a no-op that answers the same way, so a retrying
  -- caller cannot be told the package is still committed.
  if job.status = 'rolled_back' then
    select count(*) into ledger_left
    from public.import_job_record where import_job_id = job.id;
    if ledger_left > 0 then
      raise exception using errcode = '55000', message = 'ROLLED_BACK_LEDGER_NOT_EMPTY';
    end if;
    return jsonb_build_object(
      'importJobId', job.id,
      'status', 'rolled_back',
      'replayed', true,
      'counts', job.actual_counts,
      'rollbackCount', job.rollback_count
    );
  end if;

  if job.status <> 'committed' then
    raise exception using errcode = '55000', message = 'ONLY_COMMITTED_CAN_ROLL_BACK';
  end if;

  delete from public.source_lineage where import_job_id = job.id;
  get diagnostics n = row_count;
  removed := removed || jsonb_build_object('sourceLineage', n);

  foreach target in array ordered_tables loop
    execute format(
      'delete from public.%I where id in ('
      || 'select target_record_id from public.import_job_record '
      || 'where import_job_id = $1 and target_table = $2 and ownership = ''created'')',
      target
    ) using job.id, target;
    get diagnostics n = row_count;
    removed := removed || jsonb_build_object(target, n);
  end loop;

  -- A person this package created may since have been given a participation in
  -- another study, or another identifier. Deleting it would destroy a record
  -- that is no longer only ours, so it is kept and reported.
  delete from public.person_private stored
  where stored.id in (
    select target_record_id from public.import_job_record
    where import_job_id = job.id and target_table = 'person_private' and ownership = 'created'
  )
  and not exists (select 1 from public.study_participant sp where sp.person_id = stored.id)
  and not exists (select 1 from public.person_external_identifier px where px.person_id = stored.id);
  get diagnostics n = row_count;
  removed := removed || jsonb_build_object('person_private', n);

  select count(*) into retained
  from public.import_job_record
  where import_job_id = job.id
    and target_table = 'person_private'
    and ownership = 'created'
    and exists (select 1 from public.person_private p where p.id = target_record_id);

  delete from public.import_job_record where import_job_id = job.id;

  update public.import_job
  set status          = 'rolled_back',
      rolled_back_at  = now(),
      committed_at    = null,
      payload_digest  = null,
      rollback_count  = rollback_count + 1,
      last_error_code = null,
      actual_counts   = jsonb_build_object(
        '_removed', removed,
        '_retainedSharedIdentities', retained,
        '_rolledBackBy', p_actor
      )
  where id = job.id;

  select * into job from public.import_job where id = job.id;
  return jsonb_build_object(
    'importJobId', job.id,
    'status', job.status,
    'replayed', false,
    'counts', job.actual_counts,
    'rollbackCount', job.rollback_count
  );
end;
$function$;

revoke all on function public.record_canonical_rows(uuid, uuid, uuid, text, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.stage_canonical_package(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.commit_canonical_package(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.rollback_canonical_package(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.record_canonical_rows(uuid, uuid, uuid, text, uuid[], text)
  to service_role;
grant execute on function public.stage_canonical_package(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.commit_canonical_package(uuid, jsonb)
  to service_role;
grant execute on function public.rollback_canonical_package(uuid, uuid)
  to service_role;

commit;
