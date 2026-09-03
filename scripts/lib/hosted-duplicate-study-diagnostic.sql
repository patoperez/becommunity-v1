-- =============================================================================
-- READ-ONLY diagnostic: is the real study duplicated, and what else is applied?
-- =============================================================================
-- `docs/P9_HARDENING.md` section 10 warns that "a re-import risks duplicating
-- them". A hosted census found TWO studies reading 60 / 3282 / 31 — the exact
-- signature of the real study — so this answers, with evidence, whether that is
-- a duplicate or a misread, and what the applied-migration ledger actually says.
--
-- -----------------------------------------------------------------------------
-- IT READS. IT NEVER WRITES, AND IT NEVER EMITS RESPONDENT TEXT.
-- -----------------------------------------------------------------------------
-- No INSERT, UPDATE, DELETE or DDL appears below. Every statement is a SELECT.
--
-- Section [5] has to answer "is one set of qualitative observations a COPY of
-- the other", which is a question about the text. It is answered WITHOUT the
-- text: `md5(quote)` collapses each observation to a digest, and only AGGREGATE
-- facts about those digests are emitted — how many are distinct, how many are
-- shared between the two studies. No digest and no quote is ever selected into
-- the output. A count of matching hashes proves a copy; it reveals nothing about
-- what was said.
--
-- Study names and ids ARE emitted: the owner asked which client each study
-- belongs to, and a study name is not respondent data.
--
-- Output is one JSON document per section, so the result parses without
-- depending on psql's column formatting.
-- =============================================================================

\pset tuples_only on
\pset format unaligned

-- ---- [1] Every study: identity, status, ownership -------------------------
select json_build_object('section', '1-studies', 'rows', coalesce(json_agg(x order by x->>'created_at'), '[]'::json))
from (
  select json_build_object(
    'study_id', s.id,
    'name', s.name,
    'status', s.status,
    'period', s.period,
    'created_at', s.created_at,
    'tenant_id', s.tenant_id,
    'tenant_name', t.name,
    'respondents', (select count(*) from public.respondent r where r.study_id = s.id),
    'quant', (select count(*) from public.quant_response q where q.study_id = s.id),
    'qual', (select count(*) from public.qual_observation o where o.study_id = s.id)
  ) as x
  from public.study s
  join public.tenant t on t.id = s.tenant_id
) sub;

-- ---- [2] Import lineage: which import produced which study ----------------
select json_build_object('section', '2-import-batches', 'rows', coalesce(json_agg(x order by x->>'created_at'), '[]'::json))
from (
  select json_build_object(
    'batch_id', b.id,
    'study_id', b.study_id,
    'tenant_id', b.tenant_id,
    'file_name', b.file_name,
    'status', b.status,
    'source_signature', b.source_signature,
    'source_rows', b.source_rows,
    'expected_respondents', b.expected_respondents,
    'expected_quant', b.expected_quant,
    'expected_qual', b.expected_qual,
    'has_error_message', b.error_message is not null,
    'created_at', b.created_at,
    'committed_at', b.committed_at,
    'rolled_back_at', b.rolled_back_at
  ) as x
  from public.import_batch b
) sub;

-- ---- [3] Are the counts 60/3282/31 EACH, or split across two rows? --------
select json_build_object(
  'section', '3-count-shape',
  'per_study', coalesce((
    select json_agg(json_build_object('study_id', s.id,
      'respondents', (select count(*) from public.respondent r where r.study_id = s.id),
      'quant', (select count(*) from public.quant_response q where q.study_id = s.id),
      'qual', (select count(*) from public.qual_observation o where o.study_id = s.id))
      order by (select count(*) from public.respondent r2 where r2.study_id = s.id) desc)
    from public.study s), '[]'::json),
  'table_totals', json_build_object(
    'respondent', (select count(*) from public.respondent),
    'quant_response', (select count(*) from public.quant_response),
    'qual_observation', (select count(*) from public.qual_observation),
    'study', (select count(*) from public.study),
    'tenant', (select count(*) from public.tenant),
    'study_period_snapshot', (select count(*) from public.study_period_snapshot))
);

-- ---- [4] Publication state, and respondent overlap between studies -------
-- `respondent` has no external key; its identity is the `segments` jsonb. Two
-- studies imported from the same file carry the same segment sets, so the
-- overlap is measured over md5(segments) — a digest, never the segment values,
-- which can name a person. Only the SIZE of the overlap is emitted.
select json_build_object(
  'section', '4-publication-and-overlap',
  'by_status', coalesce((
    select json_agg(json_build_object('status', st, 'studies', n))
    from (select status as st, count(*) as n from public.study group by status) g), '[]'::json),
  'respondent_key_overlap', coalesce((
    select json_agg(json_build_object(
      'study_a', a.study_id, 'study_b', b.study_id,
      'distinct_segment_digests_a', a.n, 'distinct_segment_digests_b', b.n,
      'shared_segment_digests', (
        select count(*) from (
          select md5(segments::text) from public.respondent where study_id = a.study_id
          intersect
          select md5(segments::text) from public.respondent where study_id = b.study_id) i)))
    from (select study_id, count(distinct md5(segments::text)) as n from public.respondent group by study_id) a
    join (select study_id, count(distinct md5(segments::text)) as n from public.respondent group by study_id) b
      on a.study_id < b.study_id), '[]'::json)
);

-- ---- [5] Qualitative observations: 31 or 62, and copies or not? -----------
-- The quotes themselves are NEVER selected. `md5(quote)` is compared set to set
-- and only the SIZES of those sets are emitted.
select json_build_object(
  'section', '5-qualitative',
  'total', (select count(*) from public.qual_observation),
  'per_study', coalesce((
    select json_agg(json_build_object(
      'study_id', study_id,
      'observations', n,
      'distinct_quote_digests', d,
      'pending', p, 'confirmed_theme_set', c)
      order by n desc)
    from (
      select study_id,
             count(*) as n,
             count(distinct md5(coalesce(quote, ''))) as d,
             count(*) filter (where confirmed_theme is null) as p,
             count(*) filter (where confirmed_theme is not null) as c
      from public.qual_observation group by study_id) q), '[]'::json),
  'digest_overlap', coalesce((
    select json_agg(json_build_object(
      'study_a', a.study_id, 'study_b', b.study_id, 'shared_digests', (
        select count(*) from (
          select md5(coalesce(quote, '')) from public.qual_observation where study_id = a.study_id
          intersect
          select md5(coalesce(quote, '')) from public.qual_observation where study_id = b.study_id) i)))
    from (select distinct study_id from public.qual_observation) a
    join (select distinct study_id from public.qual_observation) b on a.study_id < b.study_id), '[]'::json)
);

-- ---- [6] The applied-migration ledger, verbatim ---------------------------
select json_build_object(
  'section', '6-schema-migrations',
  'rows', coalesce((
    select json_agg(json_build_object('version', version, 'name', name) order by version)
    from supabase_migrations.schema_migrations), '[]'::json)
);

-- ---- [7] Objects the FOREIGN 0022 creates: present, and holding rows? -----
select json_build_object(
  'section', '7-foreign-0022',
  'tables', coalesce((
    select json_agg(json_build_object('name', c.relname, 'exists', true,
      'rows', (select n_live_tup from pg_catalog.pg_stat_user_tables s where s.relid = c.oid)))
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('category_decision', 'study_category_snapshot')), '[]'::json),
  'functions', coalesce((
    select json_agg(json_build_object('name', p.proname, 'exists', true))
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_category_decision', 'capture_study_category_snapshot')), '[]'::json),
  'exact_rows', json_build_object(
    'category_decision', (select count(*) from public.category_decision),
    'study_category_snapshot', (select count(*) from public.study_category_snapshot))
);

-- ---- [8] Server facts the REST transport cannot see -----------------------
select json_build_object(
  'section', '8-server',
  'version', (select version()),
  'statement_timeout_current', (select current_setting('statement_timeout', true)),
  'role_settings', coalesce((
    select json_agg(json_build_object('role', r.rolname, 'settings', d.setconfig))
    from pg_catalog.pg_db_role_setting d
    join pg_catalog.pg_roles r on r.oid = d.setrole
    where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres')), '[]'::json)
);
