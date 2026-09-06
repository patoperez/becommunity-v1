-- =============================================================================
-- Delete ONE study, inside a transaction that refuses to commit a surprise
-- =============================================================================
--   psql -v ON_ERROR_STOP=1 -v study=<uuid> -v keep=<uuid> -f this-file
--   (bare uuids: `:'study'` adds the quoting, so pre-quoting them double-quotes)
--
-- This is a destructive statement against a database holding real client data,
-- so the transaction is built to fail closed. It commits only if EVERY one of
-- these holds:
--
--   1. the study exists, and is NOT the study named in :keep;
--   2. it has EXACTLY 0 confirmed and 31 pending qualitative observations. That
--      asymmetry is the only thing distinguishing the copy from the original —
--      the original carries 23 confirmed themes that exist nowhere else and
--      cannot be regenerated from the source workbooks. If it does not hold, the
--      row is the wrong one;
--   3. the study to keep still has its 23 confirmed themes BEFORE the delete;
--   4. the per-table row deltas match the predicted blast radius EXACTLY — in
--      both directions. A table that loses rows nobody predicted aborts the
--      transaction, and so does a predicted table that loses the wrong number.
--
-- The census is taken over every ordinary table in `public`, built dynamically
-- from the catalog, so a table nobody thought of is still watched.
--
-- The delete addresses the study BY UUID and by nothing else. Two studies have
-- nearly the same name, and a name is not an identity.
-- =============================================================================

\pset tuples_only on
\pset format unaligned

begin;

-- psql does NOT substitute :variables inside a dollar-quoted body, so the two
-- uuids are handed to the block as transaction-local settings instead. The
-- earlier form failed loudly rather than running with an unbound value, which is
-- the behaviour to keep.
select set_config('unit4.study', :'study', true);
select set_config('unit4.keep',  :'keep',  true);

do $guard$
declare
  v_study      uuid := current_setting('unit4.study')::uuid;
  v_keep       uuid := current_setting('unit4.keep')::uuid;
  v_conf       integer;
  v_pend       integer;
  v_keep_conf  integer;
  v_before     jsonb;
  v_after      jsonb;
  v_expected   jsonb := jsonb_build_object(
                  'study', 1,
                  'respondent', 60,
                  'quant_response', 3282,
                  'qual_observation', 31,
                  'study_period_snapshot', 6,
                  'import_batch', 2,
                  'period_series_import', 1);
  v_problems   text := '';
  r            record;
begin
  -- (1) identity
  if v_study = v_keep then
    raise exception 'REFUSED: the study to delete is the study to keep';
  end if;
  if not exists (select 1 from public.study where id = v_study) then
    raise exception 'REFUSED: study % does not exist', v_study;
  end if;

  -- (2) the asymmetry that identifies the copy
  select count(*) filter (where confirmed_theme is not null),
         count(*) filter (where confirmed_theme is null)
    into v_conf, v_pend
    from public.qual_observation where study_id = v_study;
  if v_conf <> 0 or v_pend <> 31 then
    raise exception
      'REFUSED: expected 0 confirmed / 31 pending on the copy, found % / %. This is not the row.',
      v_conf, v_pend;
  end if;

  -- (3) the original still holds the editorial work, BEFORE anything happens
  select count(*) into v_keep_conf
    from public.qual_observation where study_id = v_keep and confirmed_theme is not null;
  if v_keep_conf <> 23 then
    raise exception
      'REFUSED: the study to keep should carry 23 confirmed themes, it carries %. Stopping before any delete.',
      v_keep_conf;
  end if;

  -- census before
  select jsonb_object_agg(relname, cnt) into v_before from (
    select c.relname, (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int as cnt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r') t;

  -- THE DELETE. By uuid, and by nothing else.
  delete from public.study where id = v_study;

  -- census after
  select jsonb_object_agg(relname, cnt) into v_after from (
    select c.relname, (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int as cnt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r') t;

  -- (4) every movement must be one we predicted, and exactly the size predicted
  for r in
    select key as tbl,
           (v_before ->> key)::int as before_n,
           (v_after  ->> key)::int as after_n,
           (v_before ->> key)::int - (v_after ->> key)::int as removed,
           coalesce((v_expected ->> key)::int, 0) as predicted
    from jsonb_object_keys(v_before) as key
  loop
    if r.removed <> r.predicted then
      v_problems := v_problems || format('%s: removed %s, predicted %s; ', r.tbl, r.removed, r.predicted);
    end if;
  end loop;

  if v_problems <> '' then
    raise exception 'REFUSED, ROLLING BACK — the blast radius did not match the prediction: %', v_problems;
  end if;

  raise notice 'DELETE VERIFIED: every per-table delta matched the prediction exactly.';
end
$guard$;

commit;
