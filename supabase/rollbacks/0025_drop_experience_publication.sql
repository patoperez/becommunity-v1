-- =============================================================================
-- Rollback for 0025 — composed-experience publication, history and rollback.
-- =============================================================================
-- WHAT THIS DESTROYS. Every prepared and published revision of a composed
-- experience, every publication and restoration event, and the record of which
-- revision each study was serving. A revision is a delivered client experience
-- and its history is the evidence of what was delivered when — dropping it
-- cannot be undone by re-applying 0025.
--
-- A STUDY'S CLIENT-FACING BEHAVIOUR AFTER THIS ROLLBACK. Every study whose
-- composed experience was published returns to the LEGACY dashboard, because
-- the renderer selects the composed path only when an active revision exists
-- and after this there are none. Nothing errors, nothing 404s, and no client
-- loses access — they see what they saw before the composed experience was
-- ever published. That is the whole point of the compatibility boundary.
--
-- WHAT IT DOES NOT TOUCH. Any respondent, answer, observation, import, user,
-- study, legacy publication state, journey definition, dashboard
-- configuration, interpretation, category decision — or the composed DRAFT of
-- any study. 0025 never wrote to `study_experience_draft` and this file never
-- reads it. The draft, including the real Cuicuilco study's, is untouched by
-- applying 0025 and untouched by reversing it.
--
-- Before running this, export anything worth keeping:
--   select r.study_id, r.revision, r.definition_sha256, r.prepared_at,
--          r.source_draft_revision, r.schema_version, r.definition
--     from public.study_experience_revision r
--    order by r.study_id, r.revision;
--   select * from public.study_experience_event
--    where action in ('revision_prepared', 'published', 'restored', 'unpublished')
--    order by occurred_at;
--   select * from public.study_experience_publication;
-- =============================================================================

begin;

-- 1. The entry points first, so nothing can call into a half-reversed model.
drop function if exists public.publish_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text);
drop function if exists public.restore_study_experience_revision(uuid, uuid, uuid, uuid, text, text);
drop function if exists public.select_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text, text);
drop function if exists public.prepare_study_experience_revision(uuid, uuid, jsonb, integer, bigint, text, text, text[], text[], text, text);
drop function if exists public.assert_experience_publisher(uuid);

-- 2. The pointer table. It is the only object 0025 created outright.
drop table if exists public.study_experience_publication;

-- 3. The audit trail returns to the 0023/0024 shape.
--
-- The rows themselves are preserved wherever they still satisfy the narrower
-- constraint. Rows recording a preparation, a publication or a restoration
-- cannot: their `action` is not in the vocabulary 0023 declared, and there is
-- no honest way to relabel them as something they were not. They are DELETED
-- here, which is the one place in this file where evidence is lost, and it is
-- called out rather than buried — export it first if it matters.
drop trigger if exists refuse_update on public.study_experience_event;
drop function if exists public.refuse_experience_event_update();

drop index if exists public.study_experience_event_idempotency_idx;
drop index if exists public.study_experience_event_revision_idx;

delete from public.study_experience_event
 where action in ('revision_prepared', 'published', 'restored');

alter table public.study_experience_event
  drop column if exists revision_id,
  drop column if exists replaced_revision_id,
  drop column if exists acknowledged_warnings,
  drop column if exists idempotency_key;

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'study_experience_event'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%draft_created%';
  if constraint_name is not null then
    execute format('alter table public.study_experience_event drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.study_experience_event
  add constraint study_experience_event_action_check
  check (action in ('draft_created', 'draft_saved', 'published', 'unpublished'));

-- 4. The revision table returns to the 0023 shape.
--
-- `prepared_at` is renamed back to `published_at` and regains its NOT NULL and
-- its default. That restoration can only succeed on rows where the value is
-- present, and every row 0025 wrote has one, so the order below is: drop the
-- columns 0025 added, then rename, then restore the constraint.
alter table public.study_experience_revision
  drop constraint if exists study_experience_revision_ack_bounded;

alter table public.study_experience_revision
  drop column if exists definition_sha256,
  drop column if exists source_draft_revision,
  drop column if exists study_fingerprint,
  drop column if exists acknowledged_warnings,
  drop column if exists acknowledged_by,
  drop column if exists acknowledged_at,
  drop column if exists prepared_note;

alter table public.study_experience_revision
  rename column prepared_by to published_by;
alter table public.study_experience_revision
  rename column prepared_at to published_at;

alter table public.study_experience_revision
  alter column published_at set default now();
alter table public.study_experience_revision
  alter column published_at set not null;

commit;
