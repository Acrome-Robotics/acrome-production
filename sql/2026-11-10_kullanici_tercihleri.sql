-- Kullanıcıya özel arayüz tercihleri (10 Kasım 2026): ör. Bugün sayfasındaki kutuların yeri ve küçültülme durumu.
-- Her kullanıcı yalnız kendi satırlarını görür ve değiştirir; cihazlar arasında aynı kalır.
begin;
create table if not exists public.user_prefs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[a-z_]{1,40}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  check (pg_column_size(value) < 20000)
);
alter table public.user_prefs enable row level security;
drop policy if exists user_prefs_own on public.user_prefs;
create policy user_prefs_own on public.user_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.user_prefs from anon;
grant select, insert, update, delete on public.user_prefs to authenticated;
commit;
