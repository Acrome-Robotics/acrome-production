-- Support "Şimdi güncelle" (10 Kasım 2026): siteden mail (Apps Script) + Basecamp senkronunu elle başlatma.
-- 10 dakikada bir; yalnız Yönetici ve Sipariş + Support rolü. Çağrıyı support-refresh edge function'ı yapar.
begin;

-- slot ayır: 0 = başlatılabilir (ayrıldı), >0 = kaç saniye sonra basılabilir. Yalnız servis rolü çağırır.
create or replace function public.support_refresh_claim(p_user uuid) returns integer language plpgsql security definer set search_path = 'public' as $$
declare v_last timestamptz; v_wait int;
begin
  if not exists (select 1 from profiles where id = p_user and roles && array['admin','support']::text[]) then raise exception 'Bu işlem için yetkin yok'; end if;
  perform pg_advisory_xact_lock(hashtext('support_refresh'));
  select updated_at into v_last from support_sync_state where key = 'manual';
  v_wait := greatest(0, ceil(extract(epoch from (v_last + interval '10 minutes' - now()))))::int;
  if v_last is not null and v_wait > 0 then return v_wait; end if;
  insert into support_sync_state(key, value, updated_at)
  values ('manual', jsonb_build_object('by', p_user, 'name', (select full_name from profiles where id = p_user), 'last', now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return 0;
end $$;
revoke all on function public.support_refresh_claim(uuid) from public, anon, authenticated;

commit;
