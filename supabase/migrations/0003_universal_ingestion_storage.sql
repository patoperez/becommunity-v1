-- =============================================================================
-- 0003 — P2B universal-ingestion storage + atomic commit/rollback
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization, RLS, SECURITY DEFINER, and client grants.
--
-- Internal operators use the server-only secret/service role after application
-- authorization. Client/anon roles receive no privileges on these tables or
-- functions. A whole canonical import is committed by one PostgreSQL function,
-- so any invalid row rolls back every response written by that call.
-- =============================================================================

begin;

-- Composite keys let child/control rows prove tenant ownership without trusting
-- an application-supplied tenant_id.
create unique index if not exists study_id_tenant_uidx
  on public.study (id, tenant_id);

create table public.import_mapping (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant (id) on delete cascade,
  source_signature text not null check (source_signature ~ '^sha256:[0-9a-f]{64}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  version          integer not null check (version > 0),
  configuration    jsonb not null check (jsonb_typeof(configuration) = 'object'),
  is_active        boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, source_signature, version)
);

create table public.recoding_table (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant (id) on delete cascade,
  study_id   uuid,
  key        text not null check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  version    integer not null check (version > 0),
  values     jsonb not null check (jsonb_typeof(values) = 'object' and values <> '{}'::jsonb),
  is_active  boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (study_id, tenant_id)
    references public.study (id, tenant_id) on delete cascade
);

create unique index recoding_table_scope_version_uidx
  on public.recoding_table (
    tenant_id,
    coalesce(study_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key,
    version
  );

create unique index import_mapping_id_tenant_uidx
  on public.import_mapping (id, tenant_id);

create table public.import_batch (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id) on delete cascade,
  study_id             uuid not null,
  mapping_id           uuid,
  source_signature     text not null check (source_signature ~ '^sha256:[0-9a-f]{64}$'),
  file_name            text not null check (char_length(btrim(file_name)) between 1 and 255),
  status               text not null default 'staged'
                         check (status in ('staged', 'committed', 'failed', 'rolled_back')),
  source_rows          integer not null check (source_rows >= 0),
  expected_respondents integer not null check (expected_respondents > 0),
  expected_quant       integer not null check (expected_quant >= 0),
  expected_qual        integer not null check (expected_qual >= 0),
  error_message        text,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  committed_at         timestamptz,
  rolled_back_at       timestamptz,
  foreign key (study_id, tenant_id)
    references public.study (id, tenant_id) on delete cascade,
  foreign key (mapping_id, tenant_id)
    references public.import_mapping (id, tenant_id)
);

alter table public.respondent
  add column import_batch_id uuid references public.import_batch (id) on delete set null;
alter table public.quant_response
  add column import_batch_id uuid references public.import_batch (id) on delete set null;
alter table public.qual_observation
  add column import_batch_id uuid references public.import_batch (id) on delete set null;

create index import_mapping_tenant_signature_idx
  on public.import_mapping (tenant_id, source_signature, is_active, version desc);
create index recoding_table_tenant_study_idx
  on public.recoding_table (tenant_id, study_id, key, is_active, version desc);
create index import_batch_tenant_study_idx
  on public.import_batch (tenant_id, study_id, created_at desc);
create index respondent_import_batch_idx on public.respondent (import_batch_id);
create index quant_response_import_batch_idx on public.quant_response (import_batch_id);
create index qual_observation_import_batch_idx on public.qual_observation (import_batch_id);

-- Internal control tables are invisible to browser roles. Explicit deny
-- policies keep the intent auditable even if a future migration grants SELECT.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['import_mapping', 'recoding_table', 'import_batch'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('create policy "deny_browser_roles" on public.%I for all to anon, authenticated using (false) with check (false)', table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.commit_import_batch(
  p_import_batch_id uuid,
  p_respondents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batch%rowtype;
  respondent_count integer;
  quant_count integer;
  qual_count integer;
begin
  if jsonb_typeof(p_respondents) <> 'array' or jsonb_array_length(p_respondents) = 0 then
    raise exception using errcode = '22023', message = 'respondents must be a non-empty JSON array';
  end if;
  if jsonb_array_length(p_respondents) > 10000 then
    raise exception using errcode = '54000', message = 'respondent limit exceeded';
  end if;

  select * into batch
  from public.import_batch
  where id = p_import_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'import batch not found';
  end if;
  if batch.status <> 'staged' then
    raise exception using errcode = '55000', message = 'import batch is not staged';
  end if;
  if not exists (
    select 1 from public.study
    where id = batch.study_id and tenant_id = batch.tenant_id
  ) then
    raise exception using errcode = '23503', message = 'study does not belong to import tenant';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    where jsonb_typeof(respondent) <> 'object'
       or not (respondent ? 'id')
       or jsonb_typeof(respondent -> 'segments') is distinct from 'object'
       or jsonb_typeof(respondent -> 'quant') is distinct from 'array'
       or jsonb_typeof(respondent -> 'qual') is distinct from 'array'
  ) then
    raise exception using errcode = '22023', message = 'invalid canonical respondent shape';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    cross join lateral jsonb_each(respondent -> 'segments') as segment(key, value)
    where jsonb_typeof(value) is distinct from 'string'
  ) then
    raise exception using errcode = '22023', message = 'segment values must be strings';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    cross join lateral jsonb_array_elements(respondent -> 'quant') as quant(value)
    where jsonb_typeof(value) is distinct from 'object'
       or nullif(btrim(value ->> 'metric_key'), '') is null
       or jsonb_typeof(value -> 'value') is distinct from 'number'
  ) then
    raise exception using errcode = '22023', message = 'invalid canonical quantitative response';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    cross join lateral jsonb_array_elements(respondent -> 'qual') as observation(value)
    where jsonb_typeof(value) is distinct from 'object'
       or nullif(btrim(value ->> 'source'), '') is null
       or nullif(btrim(value ->> 'theme'), '') is null
       or nullif(btrim(value ->> 'quote'), '') is null
       or (
         value ? 'category'
         and jsonb_typeof(value -> 'category') not in ('string', 'null')
       )
  ) then
    raise exception using errcode = '22023', message = 'invalid canonical qualitative observation';
  end if;

  respondent_count := jsonb_array_length(p_respondents);
  select coalesce(sum(jsonb_array_length(respondent -> 'quant')), 0)::integer,
         coalesce(sum(jsonb_array_length(respondent -> 'qual')), 0)::integer
  into quant_count, qual_count
  from jsonb_array_elements(p_respondents) as item(respondent);

  if respondent_count <> batch.expected_respondents
     or quant_count <> batch.expected_quant
     or qual_count <> batch.expected_qual then
    raise exception using errcode = '22023', message = 'canonical payload counts do not match staged preview';
  end if;

  insert into public.respondent (id, tenant_id, study_id, import_batch_id, segments)
  select (respondent ->> 'id')::uuid,
         batch.tenant_id,
         batch.study_id,
         batch.id,
         respondent -> 'segments'
  from jsonb_array_elements(p_respondents) as item(respondent);

  insert into public.quant_response (
    tenant_id, study_id, respondent_id, import_batch_id, metric_key, value
  )
  select batch.tenant_id,
         batch.study_id,
         (respondent ->> 'id')::uuid,
         batch.id,
         quant.value ->> 'metric_key',
         (quant.value ->> 'value')::numeric
  from jsonb_array_elements(p_respondents) as item(respondent)
  cross join lateral jsonb_array_elements(respondent -> 'quant') as quant(value);

  insert into public.qual_observation (
    tenant_id, study_id, respondent_id, import_batch_id, source, category, theme, quote
  )
  select batch.tenant_id,
         batch.study_id,
         (respondent ->> 'id')::uuid,
         batch.id,
         observation.value ->> 'source',
         case
           when observation.value -> 'category' is null
             or observation.value -> 'category' = 'null'::jsonb then null
           else observation.value ->> 'category'
         end,
         observation.value ->> 'theme',
         observation.value ->> 'quote'
  from jsonb_array_elements(p_respondents) as item(respondent)
  cross join lateral jsonb_array_elements(respondent -> 'qual') as observation(value);

  update public.import_batch
  set status = 'committed',
      committed_at = now(),
      error_message = null
  where id = batch.id;

  return jsonb_build_object(
    'import_batch_id', batch.id,
    'respondents', respondent_count,
    'quant', quant_count,
    'qual', qual_count
  );
end;
$$;

create or replace function public.rollback_import_batch(p_import_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batch%rowtype;
begin
  select * into batch
  from public.import_batch
  where id = p_import_batch_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'import batch not found';
  end if;
  if batch.status <> 'committed' then
    raise exception using errcode = '55000', message = 'only committed imports can be rolled back';
  end if;

  delete from public.qual_observation where import_batch_id = batch.id;
  delete from public.quant_response where import_batch_id = batch.id;
  delete from public.respondent where import_batch_id = batch.id;

  update public.import_batch
  set status = 'rolled_back', rolled_back_at = now()
  where id = batch.id;

  return jsonb_build_object('import_batch_id', batch.id, 'status', 'rolled_back');
end;
$$;

revoke all on function public.commit_import_batch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rollback_import_batch(uuid) from public, anon, authenticated;
grant execute on function public.commit_import_batch(uuid, jsonb) to service_role;
grant execute on function public.rollback_import_batch(uuid) to service_role;

commit;
