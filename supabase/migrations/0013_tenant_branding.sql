-- =============================================================================
-- 0013 — Tenant branding and public logo assets
-- =============================================================================

begin;

alter table public.tenant
  add column if not exists brand_config jsonb not null default '{}'::jsonb;

alter table public.tenant
  drop constraint if exists tenant_brand_config_object_check,
  add constraint tenant_brand_config_object_check
    check (jsonb_typeof(brand_config) = 'object');

comment on column public.tenant.brand_config is
  'Versioned portal/report presentation settings. Contains no client response data.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-branding',
  'tenant-branding',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
