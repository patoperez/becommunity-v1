-- =============================================================================
-- 0020 — repair the private metadata field-count guard
-- =============================================================================
-- HUMAN-REVIEW ZONE: this replaces a SECURITY DEFINER ingestion boundary.
--
-- Migration 0019 counted private metadata keys with `jsonb_object_length`,
-- which does not exist in PostgreSQL (`jsonb_array_length` does, for arrays).
-- PL/pgSQL prepares each SQL statement on first execution, so the missing
-- function was never reported at deploy time: it surfaced only when an operator
-- confirmed an import, aborting the commit with
--   `function jsonb_object_length(jsonb) does not exist` (SQLSTATE 42883).
-- The abort happened before `public.commit_import_batch`, so no respondents,
-- responses or observations were ever partially written.
--
-- 0019 is already recorded as applied and is deliberately left untouched. This
-- migration replaces the whole function definition, changing only the key count
-- to a valid construct — a count over `jsonb_object_keys`. Every other
-- guarantee (array shape, object shape, key pattern, string-only values, the
-- 2 000-byte per-value cap, the 32 768-byte total cap, the 100-key cap, the
-- delegation to `public.commit_import_batch`, atomicity and the service_role
-- only privilege model) is reproduced verbatim.
-- =============================================================================

begin;

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

  -- PostgreSQL has no `jsonb_object_length`. `jsonb_object_keys` is a
  -- set-returning function, so the key count is a scalar aggregate over it.
  -- 100 keys are accepted; 101 are refused.
  if exists (
    select 1
    from jsonb_array_elements(p_respondents) as item(respondent)
    where (
           select count(*)
           from jsonb_object_keys(coalesce(item.respondent -> 'privateMetadata', '{}'::jsonb)) as field_key
         ) > 100
       or octet_length(coalesce(item.respondent -> 'privateMetadata', '{}'::jsonb)::text) > 32768
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

-- `create or replace function` preserves existing privileges; these statements
-- are restated so the privilege model is readable in one place and so a fresh
-- database rebuilt from migrations lands on exactly the same grants.
revoke all on function public.commit_import_batch_with_private(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_import_batch_with_private(uuid, jsonb) to service_role;

commit;
