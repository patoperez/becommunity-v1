-- =============================================================================
-- 0004 — Align the versioned schema with the existing qualitative-source rule.
-- =============================================================================
-- The development project already enforced this constraint, but the historical
-- 0000 migration did not contain it. Recreate it explicitly so fresh projects,
-- staging, and production accept the same controlled source vocabulary.
-- =============================================================================

begin;

alter table public.qual_observation
  drop constraint if exists qual_observation_source_check;

alter table public.qual_observation
  add constraint qual_observation_source_check
  check (
    source is null
    or source in ('encuesta', 'mystery_shopper', 'focus_group')
  );

commit;
