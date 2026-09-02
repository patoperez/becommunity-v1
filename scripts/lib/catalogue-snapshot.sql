-- =============================================================================
-- A normalized catalogue snapshot of the public schema
-- =============================================================================
-- Returns ONE json document describing everything migration 0024 could possibly
-- change, in a deterministic order, so two snapshots can be compared literally:
-- apply 0024, reverse it, and the result must equal the state 0023 left behind.
--
-- Every part is read from the catalogue rather than from the migration text, so
-- the comparison cannot be satisfied by a script that merely LOOKS symmetrical.
--
-- Definitions come from pg_get_constraintdef / pg_get_indexdef / pg_get_expr,
-- which print the parsed form. A constraint restored with the same expression
-- in the same order therefore compares equal even if its SQL was retyped.
-- Function bodies are compared by digest so a 1 400-line function does not
-- dominate the document.
-- =============================================================================

select json_build_object(
  'tables', (
    select coalesce(json_agg(t order by t->>'name'), '[]'::json)
    from (
      select json_build_object(
        'name', c.relname,
        'rls', c.relrowsecurity,
        'force_rls', c.relforcerowsecurity,
        'columns', (
          select coalesce(json_agg(json_build_object(
            'name', a.attname,
            'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'notnull', a.attnotnull,
            'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
          ) order by a.attname), '[]'::json)
          from pg_catalog.pg_attribute a
          left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        ),
        'constraints', (
          select coalesce(json_agg(json_build_object(
            'name', con.conname,
            'definition', pg_catalog.pg_get_constraintdef(con.oid)
          ) order by con.conname), '[]'::json)
          from pg_catalog.pg_constraint con
          where con.conrelid = c.oid
        ),
        'indexes', (
          select coalesce(json_agg(json_build_object(
            'name', i.indexname,
            'definition', i.indexdef
          ) order by i.indexname), '[]'::json)
          from pg_catalog.pg_indexes i
          where i.schemaname = 'public' and i.tablename = c.relname
        ),
        'policies', (
          select coalesce(json_agg(json_build_object(
            'name', p.polname,
            'command', p.polcmd,
            'permissive', p.polpermissive,
            'roles', (
              select coalesce(json_agg(r.rolname order by r.rolname), '[]'::json)
              from pg_catalog.pg_roles r where r.oid = any (p.polroles)
            ),
            'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
            'check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
          ) order by p.polname), '[]'::json)
          from pg_catalog.pg_policy p
          where p.polrelid = c.oid
        ),
        'grants', (
          select coalesce(json_agg(json_build_object(
            'grantee', g.grantee,
            'privilege', g.privilege_type
          ) order by g.grantee, g.privilege_type), '[]'::json)
          from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.table_name = c.relname
            and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
        )
      ) as t
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    ) as tables
  ),
  'functions', (
    select coalesce(json_agg(f order by f->>'signature'), '[]'::json)
    from (
      select json_build_object(
        'signature', p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
        'security_definer', p.prosecdef,
        'config', coalesce(array_to_json(p.proconfig), '[]'::json),
        'volatility', p.provolatile,
        'body_digest', encode(pg_catalog.sha256(convert_to(p.prosrc, 'UTF8')), 'hex'),
        'grants', (
          select coalesce(json_agg(json_build_object(
            'grantee', g.grantee,
            'privilege', g.privilege_type
          ) order by g.grantee, g.privilege_type), '[]'::json)
          from information_schema.role_routine_grants g
          where g.specific_schema = 'public'
            and g.routine_name = p.proname
            and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
        )
      ) as f
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ) as functions
  ),
  'views', (
    select coalesce(json_agg(json_build_object(
      'name', c.relname,
      'definition', pg_catalog.pg_get_viewdef(c.oid, true)
    ) order by c.relname), '[]'::json)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  ),
  'sequences', (
    select coalesce(json_agg(c.relname order by c.relname), '[]'::json)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  ),
  'default_privileges', (
    select coalesce(json_agg(json_build_object(
      'object_type', d.defaclobjtype,
      'acl', array_to_string(d.defaclacl::text[], ',')
    ) order by d.defaclobjtype, array_to_string(d.defaclacl::text[], ',')), '[]'::json)
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public'
  )
)::text;
