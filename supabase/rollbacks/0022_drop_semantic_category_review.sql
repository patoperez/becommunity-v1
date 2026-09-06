-- =============================================================================
-- Rollback for 0022 — semantic category review.
-- =============================================================================
-- WHAT THIS DESTROYS. Every recorded editorial decision about categories, and
-- every published-projection pin. That is a deliberate, human decision: the
-- ledger is the only record of who decided that two wordings were one answer,
-- and dropping it cannot be undone by re-applying 0022.
--
-- WHAT IT DOES NOT TOUCH. Any respondent, answer, observation or import.
-- Migration 0022 never wrote to them, so there is nothing to restore.
--
-- WHAT IT LEAVES BEHIND ON PURPOSE. `segment_dimension.config.aliases`. That
-- column predates this feature (it is written by
-- `scripts/segment-alias-configure.mjs` and read by `parseSegmentAliases`), and
-- clearing it here would silently change every count, filter and chart in every
-- study that had grouped anything — which is exactly the kind of unannounced
-- number change this feature exists to prevent. After this rollback the studies
-- keep the grouping they had; only the ability to review and revise it through
-- the product goes away.
--
-- Before running this, export the ledger if the decisions matter:
--   select * from public.category_decision order by decided_at;
-- =============================================================================

begin;

drop function if exists public.capture_study_category_snapshot(uuid, uuid);
drop function if exists public.record_category_decision(
  uuid, text, jsonb, jsonb, text, text, text, text, text, text, text, jsonb, uuid
);

drop table if exists public.study_category_snapshot;
drop table if exists public.category_decision;

commit;
