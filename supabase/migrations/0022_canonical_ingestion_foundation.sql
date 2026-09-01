-- =============================================================================
-- 0022 — canonical multi-file ingestion foundation
-- =============================================================================
-- Additive only. Existing study, respondent, response and import tables remain
-- unchanged. These tables establish stable identity, typed attributes,
-- instrument-aware responses, package provenance and contextual source styles.
--
-- HUMAN-REVIEW ZONE: every table is internal-only, RLS-enabled and FORCE RLS.
-- Browser roles receive neither table privileges nor permissive policies.
-- =============================================================================

begin;

-- The legacy bridge remains tenant/study safe even though respondent.id is
-- already globally unique. The index is additive and does not rewrite rows.
create unique index respondent_id_tenant_study_uidx
  on public.respondent (id, tenant_id, study_id);

create table public.source_asset (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant (id) on delete cascade,
  study_id          uuid not null,
  sha256            text not null check (sha256 ~ '^sha256:[0-9a-f]{64}$'),
  file_name         text not null check (char_length(btrim(file_name)) between 1 and 255),
  media_type        text not null check (char_length(btrim(media_type)) between 1 and 120),
  size_bytes        bigint not null check (size_bytes between 1 and 52428800),
  storage_path      text check (storage_path is null or char_length(storage_path) between 1 and 1000),
  workbook_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(workbook_metadata) = 'object'
    and octet_length(workbook_metadata::text) <= 262144
  ),
  uploaded_by       uuid references auth.users (id) on delete set null,
  uploaded_at       timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, sha256)
);

create table public.import_job (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant (id) on delete cascade,
  study_id          uuid not null,
  idempotency_key   text not null check (idempotency_key ~ '^sha256:[0-9a-f]{64}$'),
  mapping_version   integer not null check (mapping_version > 0),
  status            text not null default 'staged' check (
    status in ('staged', 'validated', 'committing', 'committed', 'failed', 'rolled_back')
  ),
  manifest          jsonb not null default '{}'::jsonb check (
    jsonb_typeof(manifest) = 'object'
    and octet_length(manifest::text) <= 524288
  ),
  expected_counts   jsonb not null default '{}'::jsonb check (jsonb_typeof(expected_counts) = 'object'),
  actual_counts     jsonb not null default '{}'::jsonb check (jsonb_typeof(actual_counts) = 'object'),
  error_report      jsonb not null default '{}'::jsonb check (
    jsonb_typeof(error_report) = 'object'
    and octet_length(error_report::text) <= 1048576
  ),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  validated_at      timestamptz,
  committed_at      timestamptz,
  rolled_back_at    timestamptz,
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, idempotency_key),
  check (validated_at is null or validated_at >= created_at),
  check (committed_at is null or committed_at >= created_at),
  check (rolled_back_at is null or rolled_back_at >= created_at)
);

create table public.import_job_asset (
  import_job_id uuid not null,
  source_asset_id uuid not null,
  tenant_id uuid not null references public.tenant (id) on delete cascade,
  study_id uuid not null,
  asset_role text not null check (asset_role ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz not null default now(),
  primary key (import_job_id, source_asset_id),
  foreign key (import_job_id, tenant_id, study_id)
    references public.import_job (id, tenant_id, study_id) on delete cascade,
  foreign key (source_asset_id, tenant_id, study_id)
    references public.source_asset (id, tenant_id, study_id) on delete cascade,
  unique (import_job_id, asset_role)
);

create table public.visual_annotation (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  study_id        uuid not null,
  source_asset_id uuid not null,
  sheet_name      text not null check (char_length(btrim(sheet_name)) between 1 and 255),
  cell_or_range   text not null check (char_length(btrim(cell_or_range)) between 1 and 100),
  fill_rgb        text check (fill_rgb is null or fill_rgb ~ '^[0-9A-F]{6,8}$'),
  font_rgb        text check (font_rgb is null or font_rgb ~ '^[0-9A-F]{6,8}$'),
  source_style_id integer check (source_style_id is null or source_style_id >= 0),
  role            text not null check (role in (
    'structural_group', 'metric_band', 'curated_warning', 'process_group',
    'section_emphasis', 'curated_annotation', 'unhighlighted'
  )),
  interpretation  text not null check (char_length(btrim(interpretation)) between 1 and 2000),
  confidence      text not null default 'confirmed' check (confidence in ('observed', 'inferred', 'confirmed')),
  review_status   text not null default 'confirmed' check (review_status in ('pending', 'confirmed', 'rejected')),
  created_at      timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (source_asset_id, tenant_id, study_id)
    references public.source_asset (id, tenant_id, study_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (source_asset_id, sheet_name, cell_or_range, role)
);

create table public.person_private (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenant (id) on delete cascade,
  display_name_private    text not null check (char_length(btrim(display_name_private)) between 1 and 500),
  normalized_name_private text not null check (char_length(btrim(normalized_name_private)) between 1 and 500),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.person_external_identifier (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete cascade,
  person_id        uuid not null,
  namespace        text not null check (namespace ~ '^[a-z][a-z0-9_]{0,79}$'),
  original_value   text not null check (char_length(btrim(original_value)) between 1 and 500),
  normalized_value text not null check (char_length(btrim(normalized_value)) between 1 and 500),
  is_primary       boolean not null default false,
  created_at       timestamptz not null default now(),
  foreign key (person_id, tenant_id) references public.person_private (id, tenant_id) on delete cascade,
  unique (tenant_id, namespace, normalized_value)
);

create table public.study_participant (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenant (id) on delete cascade,
  study_id                    uuid not null,
  person_id                   uuid not null,
  cohort_key                  text not null check (cohort_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  participation_status        text not null default 'included' check (
    participation_status in ('included', 'excluded', 'withdrawn')
  ),
  survey_participation_status text not null default 'unknown' check (
    survey_participation_status in ('responded', 'not_participated', 'unknown')
  ),
  legacy_respondent_id        uuid,
  source_status               text not null default 'answered' check (
    source_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (person_id, tenant_id) references public.person_private (id, tenant_id) on delete restrict,
  foreign key (legacy_respondent_id, tenant_id, study_id)
    references public.respondent (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (study_id, person_id, cohort_key)
);

create table public.membership_episode (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id) on delete cascade,
  study_id       uuid not null,
  participant_id uuid not null,
  starts_on      date,
  ends_on        date,
  status         text not null default 'answered' check (
    status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable')
  ),
  end_reason     text check (end_reason is null or char_length(end_reason) <= 2000),
  created_at     timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (participant_id, tenant_id, study_id)
    references public.study_participant (id, tenant_id, study_id) on delete cascade,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (
    (status = 'answered' and starts_on is not null)
    or (status <> 'answered' and starts_on is null and ends_on is null)
  )
);

create table public.attribute_definition (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete cascade,
  study_id      uuid not null,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label         text not null check (char_length(btrim(label)) between 1 and 200),
  data_type     text not null check (data_type in ('text', 'category', 'number', 'date', 'boolean')),
  sensitivity   text not null default 'internal' check (sensitivity in ('private', 'internal', 'client_eligible')),
  filterable    boolean not null default true,
  display_order integer not null default 0 check (display_order between 0 and 9999),
  config        jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config) = 'object' and octet_length(config::text) <= 131072
  ),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.participant_attribute_value (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenant (id) on delete cascade,
  study_id                uuid not null,
  participant_id          uuid not null,
  attribute_definition_id uuid not null,
  status                  text not null default 'answered' check (
    status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  value_text              text,
  value_numeric           numeric,
  value_date              date,
  value_boolean           boolean,
  source_raw_value        text check (source_raw_value is null or octet_length(source_raw_value) <= 8192),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (participant_id, tenant_id, study_id)
    references public.study_participant (id, tenant_id, study_id) on delete cascade,
  foreign key (attribute_definition_id, tenant_id, study_id)
    references public.attribute_definition (id, tenant_id, study_id) on delete cascade,
  unique (participant_id, attribute_definition_id),
  check (
    (status = 'answered' and num_nonnulls(value_text, value_numeric, value_date, value_boolean) = 1)
    or (status <> 'answered' and num_nonnulls(value_text, value_numeric, value_date, value_boolean) = 0)
  )
);

create table public.response_scale (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete cascade,
  study_id   uuid not null,
  key        text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label      text not null check (char_length(btrim(label)) between 1 and 200),
  value_type text not null check (value_type in ('numeric', 'text', 'mixed')),
  config     jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.response_option (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  study_id        uuid not null,
  response_scale_id uuid not null,
  raw_value       text not null check (char_length(btrim(raw_value)) between 1 and 1000),
  numeric_value   numeric,
  derived_label   text check (derived_label is null or char_length(derived_label) <= 200),
  response_status text not null default 'answered' check (
    response_status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable')
  ),
  display_order   integer not null default 0 check (display_order between 0 and 9999),
  created_at      timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (response_scale_id, tenant_id, study_id)
    references public.response_scale (id, tenant_id, study_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (response_scale_id, raw_value)
);

create table public.survey_instrument (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  study_id        uuid not null,
  key             text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label           text not null check (char_length(btrim(label)) between 1 and 200),
  audience        text not null check (char_length(btrim(audience)) between 1 and 100),
  version         integer not null default 1 check (version > 0),
  instrument_type text not null check (instrument_type in ('profile', 'survey', 'index', 'exit', 'other')),
  config          jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at      timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key, version)
);

create table public.study_domain (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  survey_instrument_id uuid not null,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label                text not null check (char_length(btrim(label)) between 1 and 200),
  display_order        integer not null default 0 check (display_order between 0 and 9999),
  visual_annotation_id uuid,
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (survey_instrument_id, tenant_id, study_id)
    references public.survey_instrument (id, tenant_id, study_id) on delete cascade,
  foreign key (visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (survey_instrument_id, key)
);

create table public.survey_item (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  survey_instrument_id uuid not null,
  study_domain_id      uuid,
  response_scale_id    uuid,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  prompt               text not null check (char_length(btrim(prompt)) between 1 and 8000),
  label                text not null check (char_length(btrim(label)) between 1 and 500),
  item_order           integer not null default 0 check (item_order between 0 and 9999),
  config               jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (survey_instrument_id, tenant_id, study_id)
    references public.survey_instrument (id, tenant_id, study_id) on delete cascade,
  foreign key (study_domain_id, tenant_id, study_id)
    references public.study_domain (id, tenant_id, study_id) on delete restrict,
  foreign key (response_scale_id, tenant_id, study_id)
    references public.response_scale (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (survey_instrument_id, key)
);

create table public.survey_session (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  survey_instrument_id uuid not null,
  participant_id       uuid not null,
  source_asset_id      uuid,
  source_row_number    integer check (source_row_number is null or source_row_number > 0),
  occurrence_key       text not null check (char_length(btrim(occurrence_key)) between 1 and 200),
  submitted_at         timestamptz,
  status               text not null default 'answered' check (
    status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (survey_instrument_id, tenant_id, study_id)
    references public.survey_instrument (id, tenant_id, study_id) on delete cascade,
  foreign key (participant_id, tenant_id, study_id)
    references public.study_participant (id, tenant_id, study_id) on delete cascade,
  foreign key (source_asset_id, tenant_id, study_id)
    references public.source_asset (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (survey_instrument_id, participant_id, occurrence_key)
);

create table public.survey_response (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  survey_session_id    uuid not null,
  survey_item_id       uuid not null,
  response_option_id   uuid,
  status               text not null default 'answered' check (
    status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  value_numeric        numeric,
  value_text           text,
  value_date           date,
  value_boolean        boolean,
  source_raw_value     text check (source_raw_value is null or octet_length(source_raw_value) <= 32768),
  source_derived_label text check (source_derived_label is null or char_length(source_derived_label) <= 500),
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (survey_session_id, tenant_id, study_id)
    references public.survey_session (id, tenant_id, study_id) on delete cascade,
  foreign key (survey_item_id, tenant_id, study_id)
    references public.survey_item (id, tenant_id, study_id) on delete cascade,
  foreign key (response_option_id, tenant_id, study_id)
    references public.response_option (id, tenant_id, study_id) on delete restrict,
  unique (survey_session_id, survey_item_id),
  check (
    (status = 'answered' and num_nonnulls(response_option_id, value_numeric, value_text, value_date, value_boolean) = 1)
    or (status <> 'answered' and num_nonnulls(response_option_id, value_numeric, value_text, value_date, value_boolean) = 0)
  )
);

create table public.source_lineage (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant (id) on delete cascade,
  study_id           uuid not null,
  import_job_id      uuid not null,
  source_asset_id    uuid not null,
  sheet_name         text not null check (char_length(btrim(sheet_name)) between 1 and 255),
  cell_or_range      text not null check (char_length(btrim(cell_or_range)) between 1 and 100),
  source_row         integer check (source_row is null or source_row > 0),
  source_column      text check (source_column is null or source_column ~ '^[A-Z]{1,3}$'),
  target_table       text not null check (target_table in (
    'person_private', 'person_external_identifier', 'study_participant', 'membership_episode',
    'participant_attribute_value', 'response_option', 'survey_instrument', 'study_domain',
    'survey_item', 'survey_session', 'survey_response', 'visual_annotation'
  )),
  target_record_id   uuid not null,
  target_field       text not null check (target_field ~ '^[a-z][a-z0-9_]{0,79}$'),
  transformation_key text not null check (transformation_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  source_raw_value   text check (source_raw_value is null or octet_length(source_raw_value) <= 32768),
  created_at         timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (import_job_id, tenant_id, study_id)
    references public.import_job (id, tenant_id, study_id) on delete cascade,
  foreign key (source_asset_id, tenant_id, study_id)
    references public.source_asset (id, tenant_id, study_id) on delete cascade,
  unique (
    import_job_id, source_asset_id, sheet_name, cell_or_range,
    target_table, target_record_id, target_field
  )
);

create index source_asset_study_idx on public.source_asset (study_id, uploaded_at desc);
create index import_job_study_idx on public.import_job (study_id, created_at desc);
create index visual_annotation_source_idx on public.visual_annotation (source_asset_id, sheet_name);
create index person_private_tenant_name_idx on public.person_private (tenant_id, normalized_name_private);
create index person_external_identifier_person_idx on public.person_external_identifier (person_id);
create index study_participant_study_idx on public.study_participant (study_id, cohort_key);
create index participant_attribute_value_study_idx on public.participant_attribute_value (study_id, attribute_definition_id);
create index survey_item_instrument_idx on public.survey_item (survey_instrument_id, item_order);
create index survey_session_study_idx on public.survey_session (study_id, survey_instrument_id);
create index survey_response_study_item_idx on public.survey_response (study_id, survey_item_id);
create index source_lineage_target_idx on public.source_lineage (target_table, target_record_id);
create index source_lineage_source_idx on public.source_lineage (source_asset_id, sheet_name, source_row);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'source_asset', 'import_job', 'import_job_asset', 'visual_annotation',
    'person_private', 'person_external_identifier', 'study_participant',
    'membership_episode', 'attribute_definition', 'participant_attribute_value',
    'response_scale', 'response_option', 'survey_instrument', 'study_domain',
    'survey_item', 'survey_session', 'survey_response', 'source_lineage'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'create policy "deny_browser_roles" on public.%I for all to anon, authenticated using (false) with check (false)',
      table_name
    );
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end $$;

commit;
