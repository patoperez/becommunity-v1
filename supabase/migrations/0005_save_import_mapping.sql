-- =============================================================================
-- 0005 — Atomically version reusable import mappings (P2C)
-- =============================================================================
-- A mapping is internal configuration. Browser roles cannot execute this RPC;
-- the server calls it only after re-checking the operator's internal role.
-- =============================================================================

begin;

create or replace function public.save_import_mapping(
  p_tenant_id uuid,
  p_source_signature text,
  p_name text,
  p_configuration jsonb,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_mapping public.import_mapping%rowtype;
  saved_mapping public.import_mapping%rowtype;
  next_version integer;
begin
  if p_source_signature !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid source signature';
  end if;
  if char_length(btrim(p_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'invalid mapping name';
  end if;
  if jsonb_typeof(p_configuration) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'mapping configuration must be an object';
  end if;
  if not exists (select 1 from public.tenant where id = p_tenant_id) then
    raise exception using errcode = '23503', message = 'tenant not found';
  end if;

  -- Serialize versions for one tenant/instrument, including the first insert.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_source_signature, 0)
  );

  select * into current_mapping
  from public.import_mapping
  where tenant_id = p_tenant_id
    and source_signature = p_source_signature
    and is_active
  order by version desc
  limit 1
  for update;

  if found and current_mapping.configuration = p_configuration then
    return jsonb_build_object(
      'id', current_mapping.id,
      'version', current_mapping.version,
      'reused', true
    );
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.import_mapping
  where tenant_id = p_tenant_id and source_signature = p_source_signature;

  update public.import_mapping
  set is_active = false
  where tenant_id = p_tenant_id
    and source_signature = p_source_signature
    and is_active;

  insert into public.import_mapping (
    tenant_id, source_signature, name, version, configuration, is_active, created_by
  ) values (
    p_tenant_id, p_source_signature, btrim(p_name), next_version,
    p_configuration, true, p_created_by
  )
  returning * into saved_mapping;

  return jsonb_build_object(
    'id', saved_mapping.id,
    'version', saved_mapping.version,
    'reused', false
  );
end;
$$;

revoke all on function public.save_import_mapping(uuid, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_import_mapping(uuid, text, text, jsonb, uuid)
  to service_role;

commit;
