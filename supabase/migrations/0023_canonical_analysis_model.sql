-- =============================================================================
-- 0023 — canonical metrics, journeys and curated findings
-- =============================================================================
-- Depends on 0022. Additive only: no legacy data is rewritten and no existing
-- dashboard or journey configuration is removed.
--
-- HUMAN-REVIEW ZONE: all new tables are internal-only with RLS + FORCE RLS.
-- Client publication continues through existing authorized aggregate surfaces.
-- =============================================================================

begin;

alter table public.study_period_snapshot
  add column series_key text not null default 'membership_retention',
  add column period_starts_on date,
  add column period_ends_on date;

alter table public.study_period_snapshot
  add constraint study_period_snapshot_series_key_check
    check (series_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  add constraint study_period_snapshot_date_order_check
    check (period_ends_on is null or period_starts_on is null or period_ends_on >= period_starts_on);

create index study_period_snapshot_series_idx
  on public.study_period_snapshot (study_id, series_key, period_order);

create table public.performance_dimension (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete cascade,
  study_id      uuid not null,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label         text not null check (char_length(btrim(label)) between 1 and 200),
  display_order integer not null default 0 check (display_order between 0 and 9999),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at    timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.performance_observation (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenant (id) on delete cascade,
  study_id                 uuid not null,
  participant_id           uuid not null,
  performance_dimension_id uuid not null,
  period_start             date not null,
  period_label             text not null check (char_length(btrim(period_label)) between 1 and 100),
  status                   text not null default 'answered' check (
    status in ('answered', 'missing', 'unknown', 'not_applicable', 'source_unavailable', 'not_participated')
  ),
  value                    numeric,
  source_band_label        text check (source_band_label is null or char_length(source_band_label) <= 100),
  visual_annotation_id     uuid,
  created_at               timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (participant_id, tenant_id, study_id)
    references public.study_participant (id, tenant_id, study_id) on delete cascade,
  foreign key (performance_dimension_id, tenant_id, study_id)
    references public.performance_dimension (id, tenant_id, study_id) on delete cascade,
  foreign key (visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (participant_id, performance_dimension_id, period_start),
  check (
    (status = 'answered' and value is not null)
    or (status <> 'answered' and value is null)
  )
);

create table public.band_scheme (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id) on delete cascade,
  study_id    uuid not null,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label       text not null check (char_length(btrim(label)) between 1 and 200),
  unit        text not null check (unit in ('score', 'percent', 'count', 'currency', 'ratio', 'years')),
  description text not null default '' check (char_length(description) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.band_rule (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  study_id        uuid not null,
  band_scheme_id  uuid not null,
  lower_bound     numeric,
  upper_bound     numeric,
  lower_inclusive boolean not null default true,
  upper_inclusive boolean not null default true,
  label           text not null check (char_length(btrim(label)) between 1 and 100),
  semantic_color  text not null check (semantic_color in ('gray', 'red', 'yellow', 'green', 'safe', 'alert', 'danger', 'neutral')),
  display_order   integer not null check (display_order between 0 and 9999),
  created_at      timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (band_scheme_id, tenant_id, study_id)
    references public.band_scheme (id, tenant_id, study_id) on delete cascade,
  unique (band_scheme_id, display_order),
  check (num_nonnulls(lower_bound, upper_bound) >= 1),
  check (lower_bound is null or upper_bound is null or lower_bound <= upper_bound)
);

create table public.metric_definition (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant (id) on delete cascade,
  study_id            uuid not null,
  key                 text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label               text not null check (char_length(btrim(label)) between 1 and 200),
  family              text not null check (family in ('nps', 'csat', 'tdp', 'cri', 'retention', 'churn', 'mean', 'count')),
  unit                text not null check (unit in ('score', 'percent', 'count', 'currency', 'ratio', 'years')),
  precision           integer not null default 1 check (precision between 0 and 6),
  calculation_version text not null check (calculation_version ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  band_scheme_id      uuid,
  config              jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config) = 'object' and octet_length(config::text) <= 131072
  ),
  is_publishable      boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (band_scheme_id, tenant_id, study_id)
    references public.band_scheme (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.metric_item_link (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenant (id) on delete cascade,
  study_id                 uuid not null,
  metric_definition_id     uuid not null,
  survey_item_id           uuid,
  study_domain_id          uuid,
  performance_dimension_id uuid,
  role                     text not null check (role ~ '^[a-z][a-z0-9_]{0,79}$'),
  display_order            integer not null default 0 check (display_order between 0 and 9999),
  config                   jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at               timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (metric_definition_id, tenant_id, study_id)
    references public.metric_definition (id, tenant_id, study_id) on delete cascade,
  foreign key (survey_item_id, tenant_id, study_id)
    references public.survey_item (id, tenant_id, study_id) on delete restrict,
  foreign key (study_domain_id, tenant_id, study_id)
    references public.study_domain (id, tenant_id, study_id) on delete restrict,
  foreign key (performance_dimension_id, tenant_id, study_id)
    references public.performance_dimension (id, tenant_id, study_id) on delete restrict,
  check (num_nonnulls(survey_item_id, study_domain_id, performance_dimension_id) = 1)
);

create unique index metric_item_link_item_uidx
  on public.metric_item_link (metric_definition_id, survey_item_id, role)
  where survey_item_id is not null;
create unique index metric_item_link_domain_uidx
  on public.metric_item_link (metric_definition_id, study_domain_id, role)
  where study_domain_id is not null;
create unique index metric_item_link_performance_uidx
  on public.metric_item_link (metric_definition_id, performance_dimension_id, role)
  where performance_dimension_id is not null;

create table public.journey_model (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id) on delete cascade,
  study_id      uuid not null,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label         text not null check (char_length(btrim(label)) between 1 and 200),
  audience      text not null check (char_length(btrim(audience)) between 1 and 100),
  description   text not null default '' check (char_length(description) <= 4000),
  display_order integer not null default 0 check (display_order between 0 and 9999),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.journey_stage (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  journey_model_id     uuid not null,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label                text not null check (char_length(btrim(label)) between 1 and 200),
  stage_order          integer not null check (stage_order between 0 and 9999),
  description          text not null default '' check (char_length(description) <= 4000),
  visual_annotation_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (journey_model_id, tenant_id, study_id)
    references public.journey_model (id, tenant_id, study_id) on delete cascade,
  foreign key (visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (journey_model_id, key),
  unique (journey_model_id, stage_order)
);

create table public.journey_stage_evidence_link (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenant (id) on delete cascade,
  study_id                 uuid not null,
  journey_stage_id         uuid not null,
  metric_definition_id     uuid,
  survey_item_id           uuid,
  performance_dimension_id uuid,
  role                     text not null check (role in ('primary', 'supporting', 'context')),
  display_order            integer not null default 0 check (display_order between 0 and 9999),
  created_at               timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (journey_stage_id, tenant_id, study_id)
    references public.journey_stage (id, tenant_id, study_id) on delete cascade,
  foreign key (metric_definition_id, tenant_id, study_id)
    references public.metric_definition (id, tenant_id, study_id) on delete restrict,
  foreign key (survey_item_id, tenant_id, study_id)
    references public.survey_item (id, tenant_id, study_id) on delete restrict,
  foreign key (performance_dimension_id, tenant_id, study_id)
    references public.performance_dimension (id, tenant_id, study_id) on delete restrict,
  check (num_nonnulls(metric_definition_id, survey_item_id, performance_dimension_id) = 1)
);

create unique index journey_stage_evidence_metric_uidx
  on public.journey_stage_evidence_link (journey_stage_id, metric_definition_id, role)
  where metric_definition_id is not null;
create unique index journey_stage_evidence_item_uidx
  on public.journey_stage_evidence_link (journey_stage_id, survey_item_id, role)
  where survey_item_id is not null;
create unique index journey_stage_evidence_performance_uidx
  on public.journey_stage_evidence_link (journey_stage_id, performance_dimension_id, role)
  where performance_dimension_id is not null;

create table public.organizational_unit (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label                text not null check (char_length(btrim(label)) between 1 and 200),
  display_order        integer not null default 0 check (display_order between 0 and 9999),
  visual_annotation_id uuid,
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (study_id, key)
);

create table public.culture_dimension (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label                text not null check (char_length(btrim(label)) between 1 and 200),
  audience             text not null check (audience in ('edl', 'members')),
  display_order        integer not null default 0 check (display_order between 0 and 9999),
  visual_annotation_id uuid,
  created_at           timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  unique (study_id, audience, key)
);

create table public.pain_point (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenant (id) on delete cascade,
  study_id                    uuid not null,
  raw_text                    text not null check (char_length(btrim(raw_text)) between 1 and 16000),
  normalized_text             text not null check (char_length(btrim(normalized_text)) between 1 and 16000),
  review_status               text not null default 'pending' check (review_status in ('pending', 'confirmed', 'rejected', 'merged')),
  source_visual_annotation_id uuid,
  superseded_by_id            uuid,
  created_by                  uuid references auth.users (id) on delete set null,
  reviewed_by                 uuid references auth.users (id) on delete set null,
  created_at                  timestamptz not null default now(),
  reviewed_at                 timestamptz,
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  foreign key (source_visual_annotation_id, tenant_id, study_id)
    references public.visual_annotation (id, tenant_id, study_id) on delete restrict,
  unique (id, tenant_id, study_id),
  check (
    (review_status = 'pending' and reviewed_by is null and reviewed_at is null and superseded_by_id is null)
    or (review_status in ('confirmed', 'rejected') and reviewed_by is not null and reviewed_at is not null and superseded_by_id is null)
    or (review_status = 'merged' and reviewed_by is not null and reviewed_at is not null and superseded_by_id is not null)
  ),
  check (superseded_by_id is null or superseded_by_id <> id)
);

alter table public.pain_point
  add constraint pain_point_superseded_by_fkey
  foreign key (superseded_by_id, tenant_id, study_id)
  references public.pain_point (id, tenant_id, study_id) on delete restrict;

create table public.pain_point_journey_stage (
  pain_point_id   uuid not null,
  journey_stage_id uuid not null,
  tenant_id       uuid not null references public.tenant (id) on delete cascade,
  study_id        uuid not null,
  display_order   integer not null default 0 check (display_order between 0 and 9999),
  created_at      timestamptz not null default now(),
  primary key (pain_point_id, journey_stage_id),
  foreign key (pain_point_id, tenant_id, study_id)
    references public.pain_point (id, tenant_id, study_id) on delete cascade,
  foreign key (journey_stage_id, tenant_id, study_id)
    references public.journey_stage (id, tenant_id, study_id) on delete cascade
);

create table public.pain_point_organizational_unit (
  pain_point_id        uuid not null,
  organizational_unit_id uuid not null,
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  display_order        integer not null default 0 check (display_order between 0 and 9999),
  created_at           timestamptz not null default now(),
  primary key (pain_point_id, organizational_unit_id),
  foreign key (pain_point_id, tenant_id, study_id)
    references public.pain_point (id, tenant_id, study_id) on delete cascade,
  foreign key (organizational_unit_id, tenant_id, study_id)
    references public.organizational_unit (id, tenant_id, study_id) on delete cascade
);

create table public.pain_point_performance_dimension (
  pain_point_id           uuid not null,
  performance_dimension_id uuid not null,
  tenant_id               uuid not null references public.tenant (id) on delete cascade,
  study_id                uuid not null,
  display_order           integer not null default 0 check (display_order between 0 and 9999),
  created_at              timestamptz not null default now(),
  primary key (pain_point_id, performance_dimension_id),
  foreign key (pain_point_id, tenant_id, study_id)
    references public.pain_point (id, tenant_id, study_id) on delete cascade,
  foreign key (performance_dimension_id, tenant_id, study_id)
    references public.performance_dimension (id, tenant_id, study_id) on delete cascade
);

create table public.pain_point_culture_dimension (
  pain_point_id       uuid not null,
  culture_dimension_id uuid not null,
  tenant_id           uuid not null references public.tenant (id) on delete cascade,
  study_id            uuid not null,
  display_order       integer not null default 0 check (display_order between 0 and 9999),
  created_at          timestamptz not null default now(),
  primary key (pain_point_id, culture_dimension_id),
  foreign key (pain_point_id, tenant_id, study_id)
    references public.pain_point (id, tenant_id, study_id) on delete cascade,
  foreign key (culture_dimension_id, tenant_id, study_id)
    references public.culture_dimension (id, tenant_id, study_id) on delete cascade
);

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

create index performance_observation_study_period_idx
  on public.performance_observation (study_id, performance_dimension_id, period_start);
create index band_rule_scheme_idx on public.band_rule (band_scheme_id, display_order);
create index metric_definition_study_idx on public.metric_definition (study_id, family);
create index journey_model_study_idx on public.journey_model (study_id, display_order);
create index journey_stage_model_idx on public.journey_stage (journey_model_id, stage_order);
create index pain_point_study_review_idx on public.pain_point (study_id, review_status, created_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'performance_dimension', 'performance_observation', 'band_scheme', 'band_rule',
    'metric_definition', 'metric_item_link', 'journey_model', 'journey_stage',
    'journey_stage_evidence_link', 'organizational_unit', 'culture_dimension',
    'pain_point', 'pain_point_journey_stage', 'pain_point_organizational_unit',
    'pain_point_performance_dimension', 'pain_point_culture_dimension'
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
