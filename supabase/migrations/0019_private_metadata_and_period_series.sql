-- =============================================================================
-- 0019 — private respondent metadata + aggregate retention/churn series
-- =============================================================================
-- HUMAN-REVIEW ZONE: raw identifiers and aggregate source data remain strictly
-- server-side. Browser roles receive neither table privileges nor RPC access.
-- =============================================================================

begin;

alter table public.respondent
  add column if not exists private_metadata jsonb not null default '{}'::jsonb;

alter table public.respondent
  drop constraint if exists respondent_private_metadata_shape_check,
  add constraint respondent_private_metadata_shape_check check (
    jsonb_typeof(private_metadata) = 'object'
    and octet_length(private_metadata::text) <= 32768
  );

-- Wrap the established atomic import instead of duplicating it. PostgreSQL
-- functions share the caller's transaction, so a metadata validation/update
-- failure also rolls back every row inserted by commit_import_batch.
create or replace function public.commit_import_batch_with_private(
  p_import_batch_id uuid,
  p_respondents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if jsonb_typeof(p_respondents) <> 'array' then
    raise exception using errcode = '22023', message = 'respondents must be a JSON array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    where respondent ? 'privateMetadata'
      and jsonb_typeof(respondent -> 'privateMetadata') is distinct from 'object'
  ) then
    raise exception using errcode = '22023', message = 'private metadata must be an object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    cross join lateral jsonb_each(coalesce(respondent -> 'privateMetadata', '{}'::jsonb)) as field(key, value)
    where key !~ '^[a-z][a-z0-9_]{0,63}$'
       or jsonb_typeof(value) is distinct from 'string'
       or octet_length(value #>> '{}') > 2000
  ) then
    raise exception using errcode = '22023', message = 'invalid private metadata field';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    where jsonb_object_length(coalesce(respondent -> 'privateMetadata', '{}'::jsonb)) > 100
       or octet_length(coalesce(respondent -> 'privateMetadata', '{}'::jsonb)::text) > 32768
  ) then
    raise exception using errcode = '54000', message = 'private metadata limit exceeded';
  end if;

  result := public.commit_import_batch(p_import_batch_id, p_respondents);

  update public.respondent as stored
  set private_metadata = coalesce(item.respondent -> 'privateMetadata', '{}'::jsonb)
  from jsonb_array_elements(p_respondents) as item(respondent)
  where stored.id = (item.respondent ->> 'id')::uuid
    and stored.import_batch_id = p_import_batch_id;

  return result;
end;
$$;

revoke all on function public.commit_import_batch_with_private(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_import_batch_with_private(uuid, jsonb) to service_role;

create table public.period_series_import (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant (id) on delete cascade,
  study_id          uuid not null,
  source_signature  text not null check (source_signature ~ '^sha256:[0-9a-f]{64}$'),
  file_name         text not null check (char_length(btrim(file_name)) between 1 and 255),
  expected_periods  integer not null check (expected_periods between 1 and 240),
  status            text not null default 'staged' check (status in ('staged', 'committed', 'failed', 'rolled_back')),
  error_message     text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  committed_at      timestamptz,
  rolled_back_at    timestamptz,
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade
);

create table public.study_period_snapshot (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant (id) on delete cascade,
  study_id          uuid not null,
  import_id         uuid not null references public.period_series_import (id) on delete cascade,
  period_label      text not null check (char_length(btrim(period_label)) between 1 and 100),
  period_order      integer not null check (period_order between 0 and 9999),
  starting_members  integer not null check (starting_members > 0),
  new_members       integer not null check (new_members >= 0),
  ending_members    integer not null check (ending_members >= 0),
  lost_members      integer not null check (lost_members >= 0),
  retention_rate    numeric(7,2) not null check (retention_rate between 0 and 100),
  churn_rate        numeric(7,2) not null check (churn_rate between 0 and 100),
  created_at        timestamptz not null default now(),
  foreign key (study_id, tenant_id) references public.study (id, tenant_id) on delete cascade,
  unique (import_id, period_order),
  check (ending_members = starting_members - lost_members + new_members),
  check (new_members <= ending_members),
  check (lost_members <= starting_members)
);

create index period_series_import_study_idx
  on public.period_series_import (study_id, committed_at desc);
create index study_period_snapshot_study_idx
  on public.study_period_snapshot (study_id, period_order);

alter table public.period_series_import enable row level security;
alter table public.period_series_import force row level security;
alter table public.study_period_snapshot enable row level security;
alter table public.study_period_snapshot force row level security;
create policy "deny_browser_roles" on public.period_series_import
  for all to anon, authenticated using (false) with check (false);
create policy "deny_browser_roles" on public.study_period_snapshot
  for all to anon, authenticated using (false) with check (false);
revoke all privileges on table public.period_series_import, public.study_period_snapshot from anon, authenticated;
grant all privileges on table public.period_series_import, public.study_period_snapshot to service_role;

create or replace function public.commit_period_series_import(
  p_import_id uuid,
  p_periods jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.period_series_import%rowtype;
  period_count integer;
begin
  if jsonb_typeof(p_periods) <> 'array' or jsonb_array_length(p_periods) = 0 then
    raise exception using errcode = '22023', message = 'periods must be a non-empty JSON array';
  end if;
  if jsonb_array_length(p_periods) > 240 then
    raise exception using errcode = '54000', message = 'period limit exceeded';
  end if;

  select * into batch from public.period_series_import where id = p_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'period import not found'; end if;
  if batch.status <> 'staged' then raise exception using errcode = '55000', message = 'period import is not staged'; end if;
  period_count := jsonb_array_length(p_periods);
  if period_count <> batch.expected_periods then
    raise exception using errcode = '22023', message = 'period payload count does not match preview';
  end if;

  insert into public.study_period_snapshot (
    tenant_id, study_id, import_id, period_label, period_order,
    starting_members, new_members, ending_members, lost_members,
    retention_rate, churn_rate
  )
  select batch.tenant_id, batch.study_id, batch.id,
         x."periodLabel", x."periodOrder", x."startingMembers", x."newMembers",
         x."endingMembers", x."lostMembers",
         round(((x."endingMembers" - x."newMembers")::numeric / x."startingMembers") * 100, 2),
         round((x."lostMembers"::numeric / x."startingMembers") * 100, 2)
  from jsonb_to_recordset(p_periods) as x(
    "periodLabel" text,
    "periodOrder" integer,
    "startingMembers" integer,
    "newMembers" integer,
    "endingMembers" integer,
    "lostMembers" integer
  );

  update public.period_series_import
  set status = 'committed', committed_at = now(), error_message = null
  where id = batch.id;

  return jsonb_build_object('import_id', batch.id, 'periods', period_count);
end;
$$;

create or replace function public.rollback_period_series_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.period_series_import%rowtype;
begin
  select * into batch from public.period_series_import where id = p_import_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'period import not found'; end if;
  if batch.status <> 'committed' then raise exception using errcode = '55000', message = 'only committed period imports can be rolled back'; end if;
  delete from public.study_period_snapshot where import_id = batch.id;
  update public.period_series_import set status = 'rolled_back', rolled_back_at = now() where id = batch.id;
  return jsonb_build_object('import_id', batch.id, 'status', 'rolled_back');
end;
$$;

revoke all on function public.commit_period_series_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rollback_period_series_import(uuid) from public, anon, authenticated;
grant execute on function public.commit_period_series_import(uuid, jsonb) to service_role;
grant execute on function public.rollback_period_series_import(uuid) to service_role;

commit;

