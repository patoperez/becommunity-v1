-- P8.4 — consultant interpretation: private draft -> review -> published reading.
begin;

create table public.study_interpretation (
  study_id uuid primary key references public.study(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  draft_content jsonb,
  review_status text not null default 'draft'
    check (review_status in ('draft', 'in_review', 'approved')),
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_content jsonb,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (draft_content is null or (jsonb_typeof(draft_content) = 'object' and octet_length(draft_content::text) <= 8192)),
  check (published_content is null or (jsonb_typeof(published_content) = 'object' and octet_length(published_content::text) <= 8192))
);

create table public.study_interpretation_event (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.study(id) on delete cascade,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  actor_user_id uuid,
  action text not null check (action in (
    'draft_saved', 'submitted', 'approved', 'changes_requested', 'published', 'unpublished'
  )),
  occurred_at timestamptz not null default now()
);

create index study_interpretation_tenant_idx on public.study_interpretation(tenant_id, updated_at desc);
create index study_interpretation_event_study_idx on public.study_interpretation_event(study_id, occurred_at desc);

alter table public.study_interpretation enable row level security;
alter table public.study_interpretation force row level security;
alter table public.study_interpretation_event enable row level security;
alter table public.study_interpretation_event force row level security;

create policy "deny_browser_roles" on public.study_interpretation
  for all to anon, authenticated using (false) with check (false);
create policy "deny_browser_roles" on public.study_interpretation_event
  for all to anon, authenticated using (false) with check (false);

revoke all on public.study_interpretation from anon, authenticated, service_role;
grant select, insert, update on public.study_interpretation to service_role;
revoke all on public.study_interpretation_event from anon, authenticated, service_role;
grant select, insert on public.study_interpretation_event to service_role;

create or replace function public.transition_study_interpretation(
  p_study_id uuid,
  p_actor uuid,
  p_action text,
  p_content jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.study%rowtype;
  current public.study_interpretation%rowtype;
begin
  if not exists (select 1 from public.profiles where user_id = p_actor and role = 'internal') then
    raise exception using errcode = '42501', message = 'internal actor required';
  end if;
  select * into target from public.study where id = p_study_id;
  if not found then raise exception using errcode = 'P0002', message = 'study not found'; end if;
  if p_action not in ('draft_saved','submitted','approved','changes_requested','published','unpublished') then
    raise exception using errcode = '22023', message = 'invalid interpretation action';
  end if;
  if p_content is not null and (jsonb_typeof(p_content) <> 'object' or octet_length(p_content::text) > 8192) then
    raise exception using errcode = '22023', message = 'invalid interpretation content';
  end if;

  insert into public.study_interpretation(study_id, tenant_id, updated_by)
  values (target.id, target.tenant_id, p_actor)
  on conflict (study_id) do nothing;
  select * into current from public.study_interpretation where study_id = target.id for update;

  if p_action = 'draft_saved' then
    if p_content is null then raise exception using errcode = '22023', message = 'content required'; end if;
    update public.study_interpretation set draft_content=p_content, review_status='draft',
      submitted_by=null, submitted_at=null, reviewed_by=null, reviewed_at=null,
      updated_by=p_actor, updated_at=now() where study_id=target.id;
  elsif p_action = 'submitted' then
    if current.draft_content is null or current.review_status <> 'draft' then
      raise exception using errcode = '55000', message = 'save a draft before review';
    end if;
    update public.study_interpretation set review_status='in_review', submitted_by=p_actor,
      submitted_at=now(), updated_by=p_actor, updated_at=now() where study_id=target.id;
  elsif p_action = 'approved' then
    if current.review_status <> 'in_review' then raise exception using errcode = '55000', message = 'review required'; end if;
    update public.study_interpretation set review_status='approved', reviewed_by=p_actor,
      reviewed_at=now(), updated_by=p_actor, updated_at=now() where study_id=target.id;
  elsif p_action = 'changes_requested' then
    if current.review_status not in ('in_review','approved') then raise exception using errcode = '55000', message = 'nothing to return'; end if;
    update public.study_interpretation set review_status='draft', reviewed_by=p_actor,
      reviewed_at=now(), updated_by=p_actor, updated_at=now() where study_id=target.id;
  elsif p_action = 'published' then
    if current.review_status <> 'approved' or current.draft_content is null then
      raise exception using errcode = '55000', message = 'approved reading required';
    end if;
    update public.study_interpretation set published_content=current.draft_content,
      published_by=p_actor, published_at=now(), updated_by=p_actor, updated_at=now()
      where study_id=target.id;
  else
    update public.study_interpretation set published_content=null, published_by=null,
      published_at=null, updated_by=p_actor, updated_at=now() where study_id=target.id;
  end if;

  insert into public.study_interpretation_event(study_id, tenant_id, actor_user_id, action)
  values(target.id, target.tenant_id, p_actor, p_action);
  return jsonb_build_object('studyId', target.id, 'action', p_action);
end;
$$;

revoke all on function public.transition_study_interpretation(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.transition_study_interpretation(uuid, uuid, text, jsonb) to service_role;

commit;
