-- =============================================================================
-- 0015 — Client organisation lifecycle + administrative lifecycle audit (P8.2)
-- =============================================================================
-- HUMAN-REVIEW ZONE: this migration is additive only. It creates no function,
-- changes no existing policy and rewrites no existing row: two nullable columns
-- and one new internal table. The only privileges it revokes are the DEFAULT
-- ones migration 0001 would otherwise hand its own new table, and it revokes
-- them so it can grant back strictly less (see the grant block below).
--
-- WHY THESE TWO THINGS AND NOTHING ELSE
--
-- 1. ARCHIVE A CLIENT ORGANISATION. Archiving is the ordinary, reversible
--    action Studio offers instead of destroying a client. An archived client
--    accepts no new study, no new invitation and no new publication; it stays
--    fully visible to internal staff and can be restored. It does NOT revoke
--    anybody's existing access — that is per-person suspension, which is
--    enforced at the authentication boundary (Supabase Auth `banned_until`) so
--    the product can never show "active" for an identity Auth is refusing.
--    Because archiving changes no client-facing authorization, no RLS policy
--    changes here.
--
-- 2. AUDIT THE LIFECYCLE MUTATIONS. Suspending, restoring and permanently
--    deleting a person or a client are the administrative actions whose
--    evidence must outlive their subject. `admin_lifecycle_event` therefore
--    carries NO foreign key to `tenant`, `profiles` or `auth.users`: a cascade
--    from the very object being deleted would erase the record of the
--    deletion. Ids and a short label are snapshotted instead.
--
-- The audit table holds administrative metadata only: who acted, on what kind
-- of object, which id, a bounded display label and bounded counts. It never
-- holds a password, a token, a key, a respondent row, an answer or a quote.
--
-- GOLDEN RULE (architecture §6.2): RLS is enabled AND forced on the new table
-- in this same migration, with browser roles denied outright, exactly like the
-- other internal control tables created in 0003 and 0006.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- tenant — archive state
-- -----------------------------------------------------------------------------
alter table public.tenant
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users (id) on delete set null;

-- Partial: archived clients are the rare case, and the index only has to answer
-- "which clients are archived".
create index if not exists tenant_archived_idx
  on public.tenant (archived_at)
  where archived_at is not null;

comment on column public.tenant.archived_at is
  'When set, the client is archived: Studio refuses a new study, a new invitation and a new publication for it. Existing client access is unchanged; revoking one person is per-user suspension at the authentication boundary.';

comment on column public.tenant.archived_by is
  'The internal account that archived the client. Set null if that account is later removed; the audit event keeps the actor id.';

-- -----------------------------------------------------------------------------
-- admin_lifecycle_event — administrative evidence that outlives its subject
-- -----------------------------------------------------------------------------
create table if not exists public.admin_lifecycle_event (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  -- No FK, on purpose: deleting the actor's account must not delete the record
  -- of what that account did.
  actor_user_id uuid,
  action        text not null check (action in (
                  'client_user_suspended',
                  'client_user_restored',
                  -- Written BEFORE the irreversible account deletion, so the
                  -- intent is durable before anything is destroyed. A row with
                  -- `client_user_delete_started` and no matching
                  -- `client_user_deleted` means the outcome is unknown, which is
                  -- the honest thing for that state to look like.
                  'client_user_delete_started',
                  'client_user_deleted',
                  'tenant_archived',
                  'tenant_restored',
                  -- Reserved. Permanent client deletion is DISABLED in the
                  -- application and no code path writes this value today; the
                  -- vocabulary is kept so a future, recoverable cross-system
                  -- deletion workflow does not have to migrate the constraint.
                  'tenant_deleted'
                )),
  subject_kind  text not null check (subject_kind in ('client_user', 'tenant')),
  -- No FK, on purpose: this is the id of an object that may no longer exist.
  subject_id    uuid not null,
  tenant_id     uuid,
  subject_label text check (subject_label is null or char_length(subject_label) <= 200),
  -- Bounded three ways: it must be an object, it must be small, and the
  -- application sanitiser (`boundedDetails`) keeps to HALF this ceiling so it
  -- can never build a record the database would reject. The two bounds are
  -- measured on slightly different encodings — canonical `jsonb::text` here,
  -- `JSON.stringify` there — and the margin removes that question entirely.
  -- `jsonb_out` and `textin` are both immutable, so the cast is legal in a
  -- CHECK constraint.
  details       jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(details) = 'object')
                  check (octet_length(details::text) <= 4096)
);

create index if not exists admin_lifecycle_event_occurred_idx
  on public.admin_lifecycle_event (occurred_at desc);
create index if not exists admin_lifecycle_event_subject_idx
  on public.admin_lifecycle_event (subject_kind, subject_id, occurred_at desc);
create index if not exists admin_lifecycle_event_tenant_idx
  on public.admin_lifecycle_event (tenant_id, occurred_at desc);

comment on table public.admin_lifecycle_event is
  'Administrative lifecycle evidence. Bounded metadata only: never a secret, never a respondent row, never an answer, never a quote. Deliberately free of foreign keys so a record survives the deletion it records.';

alter table public.admin_lifecycle_event enable row level security;
alter table public.admin_lifecycle_event force row level security;

drop policy if exists "deny_browser_roles" on public.admin_lifecycle_event;
create policy "deny_browser_roles" on public.admin_lifecycle_event
  for all to anon, authenticated using (false) with check (false);

-- LEAST PRIVILEGE, EXPLICITLY.
--
-- Migration 0001 set default privileges that grant every new public table ALL
-- to `service_role` and SELECT/INSERT/UPDATE/DELETE to `authenticated`. Both
-- are revoked here and only what the application actually performs is granted
-- back: it INSERTs administrative records and SELECTs them for one client's
-- history. It never updates or deletes one, so the table is append-only at the
-- privilege level and not merely by convention — which is the only property
-- that makes it evidence.
revoke all privileges on table public.admin_lifecycle_event from anon, authenticated;
revoke all privileges on table public.admin_lifecycle_event from service_role;
grant select, insert on table public.admin_lifecycle_event to service_role;

commit;
