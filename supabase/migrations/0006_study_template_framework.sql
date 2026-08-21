-- =============================================================================
-- 0006 — P3 versioned study-template framework with copy semantics
-- =============================================================================
-- Templates are internal configuration. Browser roles have no table/RPC access.
-- A study receives a JSON snapshot at creation; no runtime lookup can make a
-- later template edit mutate an existing study.
-- =============================================================================

begin;

create table public.study_template (
  id           uuid primary key default gen_random_uuid(),
  owner_scope  text not null default 'internal' check (owner_scope = 'internal'),
  created_by   uuid not null references auth.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  description  text not null default '' check (char_length(description) <= 1000),
  preview      jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object'),
  version      integer not null default 1 check (version > 0),
  created_from uuid references public.study (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.study
  add column template_snapshot jsonb not null default '{"version":1,"metricSet":[],"segmentationDimensions":[],"recodingTables":[],"columnMappings":[],"journeyDefinition":{},"dashboardConfig":{},"qualitativeCategories":[]}'::jsonb,
  add column template_origin_id uuid references public.study_template (id) on delete set null,
  add column template_origin_version integer;

alter table public.study_template enable row level security;
alter table public.study_template force row level security;
create policy "deny_browser_roles" on public.study_template
  for all to anon, authenticated using (false) with check (false);
revoke all privileges on table public.study_template from anon, authenticated;
grant all privileges on table public.study_template to service_role;

create index study_template_owner_updated_idx
  on public.study_template (created_by, updated_at desc);

create or replace function public.save_study_template(
  p_template_id uuid,
  p_created_by uuid,
  p_name text,
  p_description text,
  p_preview jsonb,
  p_payload jsonb,
  p_created_from uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.study_template%rowtype;
begin
  if p_created_by is null or not exists (
    select 1 from public.profiles where user_id = p_created_by and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal template owner not found';
  end if;
  if char_length(btrim(p_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invalid template name';
  end if;
  if char_length(coalesce(p_description, '')) > 1000
     or jsonb_typeof(p_preview) is distinct from 'object'
     or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'invalid template configuration';
  end if;

  if p_template_id is null then
    insert into public.study_template (
      created_by, name, description, preview, payload, created_from
    ) values (
      p_created_by, btrim(p_name), coalesce(p_description, ''), p_preview, p_payload, p_created_from
    ) returning * into saved;
  else
    update public.study_template
    set name = btrim(p_name),
        description = coalesce(p_description, ''),
        preview = p_preview,
        payload = p_payload,
        created_from = coalesce(p_created_from, created_from),
        version = version + 1,
        updated_at = now()
    where id = p_template_id and created_by = p_created_by
    returning * into saved;
    if not found then
      raise exception using errcode = 'P0002', message = 'owned template not found';
    end if;
  end if;

  return jsonb_build_object('id', saved.id, 'version', saved.version);
end;
$$;

create or replace function public.instantiate_study_template(
  p_template_id uuid,
  p_created_by uuid,
  p_tenant_id uuid,
  p_name text,
  p_period text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.study_template%rowtype;
  created public.study%rowtype;
  dimension jsonb;
  recoding jsonb;
  parent_dimension_id uuid;
begin
  if not exists (
    select 1 from public.profiles where user_id = p_created_by and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'internal template owner not found';
  end if;
  select * into source from public.study_template
  where id = p_template_id and created_by = p_created_by;
  if not found then
    raise exception using errcode = 'P0002', message = 'owned template not found';
  end if;
  if not exists (select 1 from public.tenant where id = p_tenant_id) then
    raise exception using errcode = '23503', message = 'tenant not found';
  end if;
  if char_length(btrim(p_name)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid study name';
  end if;

  insert into public.study (
    tenant_id, name, period, status, dashboard_config, journey_definition,
    template_snapshot, template_origin_id, template_origin_version
  ) values (
    p_tenant_id, btrim(p_name), nullif(btrim(coalesce(p_period, '')), ''), 'draft',
    coalesce(source.payload -> 'dashboardConfig', '{}'::jsonb),
    coalesce(source.payload -> 'journeyDefinition', '{}'::jsonb),
    source.payload, source.id, source.version
  ) returning * into created;

  for dimension in select value from jsonb_array_elements(coalesce(source.payload -> 'segmentationDimensions', '[]'::jsonb)) loop
    parent_dimension_id := null;
    if nullif(dimension ->> 'parentKey', '') is not null then
      select id into parent_dimension_id from public.segment_dimension
      where study_id = created.id and key = dimension ->> 'parentKey' limit 1;
    end if;
    insert into public.segment_dimension (tenant_id, study_id, key, label, parent_id, config)
    values (created.tenant_id, created.id, dimension ->> 'key', dimension ->> 'label', parent_dimension_id,
            coalesce(dimension -> 'config', '{}'::jsonb));
  end loop;

  for recoding in select value from jsonb_array_elements(coalesce(source.payload -> 'recodingTables', '[]'::jsonb)) loop
    insert into public.recoding_table (tenant_id, study_id, key, name, version, values, created_by)
    values (created.tenant_id, created.id, recoding ->> 'key', recoding ->> 'name',
            (recoding ->> 'version')::integer, recoding -> 'values', p_created_by);
  end loop;

  return jsonb_build_object('id', created.id, 'template_version', source.version);
end;
$$;

revoke all on function public.save_study_template(uuid, uuid, text, text, jsonb, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.instantiate_study_template(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.save_study_template(uuid, uuid, text, text, jsonb, jsonb, uuid)
  to service_role;
grant execute on function public.instantiate_study_template(uuid, uuid, uuid, text, text)
  to service_role;

commit;
