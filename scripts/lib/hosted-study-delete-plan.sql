-- =============================================================================
-- READ-ONLY: what would a delete of one study actually remove?
-- =============================================================================
-- Run with:  psql -v study="'<uuid>'" -f this-file
--
-- This predicts the blast radius BEFORE anything is deleted, and it discovers it
-- from the database's own catalog rather than from a hand-written list. A list
-- written by hand covers the tables its author remembered, and the tables that
-- matter here include four the canonical branch's documentation does not
-- describe at all — they arrived with migrations from other branches.
--
-- WHAT IT DOES
--   [A] every foreign key that points at public.study, with its delete action.
--       A constraint that is NOT `c` (cascade) will BLOCK the delete instead of
--       following it, so the action is reported, never assumed.
--   [B] a row count per referencing table, scoped to the study, built
--       dynamically with query_to_xml so no table name is hard-coded.
--   [C] the same for tables that reference `respondent` — rows that cascade at
--       one remove.
--   [D] the study-scoped tables from the four foreign migrations, counted
--       explicitly whether or not they declare a foreign key.
--
-- Every statement is a SELECT. It changes nothing.
-- =============================================================================

\pset tuples_only on
\pset format unaligned

-- ---- [A] Foreign keys pointing at public.study ----------------------------
select json_build_object('section', 'A-fk-graph', 'rows', coalesce(json_agg(x order by x->>'table'), '[]'::json))
from (
  select json_build_object(
    'table', src.relname,
    'column', srcatt.attname,
    'on_delete', case con.confdeltype
      when 'c' then 'CASCADE' when 'r' then 'RESTRICT' when 'a' then 'NO ACTION'
      when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' else con.confdeltype::text end,
    'constraint', con.conname
  ) as x
  from pg_constraint con
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
  join pg_class src on src.oid = con.conrelid
  join pg_attribute srcatt on srcatt.attrelid = con.conrelid and srcatt.attnum = con.conkey[1]
  where con.contype = 'f' and tgtns.nspname = 'public' and tgt.relname = 'study'
) s;

-- ---- [B] Rows per referencing table, scoped to this study -----------------
select json_build_object('section', 'B-direct-rows', 'rows', coalesce(json_agg(x order by (x->>'rows')::int desc), '[]'::json))
from (
  select json_build_object('table', t.relname, 'column', att.attname, 'rows', (
    xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I where %I = %L', t.relname, att.attname, :study),
      false, true, '')))[1]::text::int
  ) as x
  from pg_constraint con
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
  join pg_class t on t.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f' and tgtns.nspname = 'public' and tgt.relname = 'study' and t.relkind = 'r'
) s;

-- ---- [C] One remove further: tables keyed to this study's respondents -----
select json_build_object('section', 'C-via-respondent', 'rows', coalesce(json_agg(x order by x->>'table'), '[]'::json))
from (
  select json_build_object('table', t.relname, 'column', att.attname,
    'on_delete', case con.confdeltype when 'c' then 'CASCADE' when 'r' then 'RESTRICT'
      when 'n' then 'SET NULL' else con.confdeltype::text end,
    'rows', (
    xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I x where x.%I in (select id from public.respondent where study_id = %L)',
             t.relname, att.attname, :study),
      false, true, '')))[1]::text::int
  ) as x
  from pg_constraint con
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace tgtns on tgtns.oid = tgt.relnamespace
  join pg_class t on t.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
  where con.contype = 'f' and tgtns.nspname = 'public' and tgt.relname = 'respondent' and t.relkind = 'r'
) s;

-- ---- [D] The foreign migrations' study-scoped tables, counted explicitly --
-- These arrived with 0022-0025 from other branches. The canonical branch's
-- documentation does not describe them, so they are counted rather than assumed
-- empty. A table that does not exist reports null instead of failing.
select json_build_object('section', 'D-foreign-migration-tables', 'rows', coalesce(json_agg(x order by x->>'table'), '[]'::json))
from (
  select json_build_object('table', t.relname, 'column', col, 'rows', (
    xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I where %I = %L', t.relname, col, :study), false, true, '')))[1]::text::int
  ) as x
  from (values
    ('study_category_snapshot', 'study_id'),
    ('study_experience_draft', 'study_id'),
    ('study_experience_revision', 'study_id'),
    ('study_experience_publication', 'study_id'),
    ('study_experience_event', 'study_id'),
    ('category_decision', 'study_id')
  ) as v(tname, col)
  join pg_class t on t.relname = v.tname and t.relkind = 'r'
  join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = t.oid and a.attname = v.col and a.attnum > 0 and not a.attisdropped
) s;

-- ---- [E] The guard: the asymmetry that identifies the copy ----------------
select json_build_object(
  'section', 'E-guard',
  'study', :study,
  'exists', (select count(*) from public.study where id = :study),
  'name', (select name from public.study where id = :study),
  'tenant_id', (select tenant_id from public.study where id = :study),
  'status', (select status from public.study where id = :study),
  'respondents', (select count(*) from public.respondent where study_id = :study),
  'quant', (select count(*) from public.quant_response where study_id = :study),
  'qual', (select count(*) from public.qual_observation where study_id = :study),
  'qual_confirmed', (select count(*) from public.qual_observation where study_id = :study and confirmed_theme is not null),
  'qual_pending', (select count(*) from public.qual_observation where study_id = :study and confirmed_theme is null)
);
