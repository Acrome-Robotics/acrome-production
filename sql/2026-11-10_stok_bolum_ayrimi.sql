-- Stok işlerinde mekanik / elektronik ayrımı (10 Kasım 2026)
-- Kişinin üretim bölümü (profiles.departments) mekanik ise yalnız mekanik, elektronik ise yalnız elektronik
-- sayım bildirimleri alır; ikisi de seçiliyse ya da hiçbiri seçili değilse ikisini birden alır.
begin;

create or replace function public.stock_groups_of(p_departments text[]) returns text[] language sql immutable set search_path = 'public' as $$
  select case
    when coalesce(p_departments, '{}') @> array['mekanik'] and not coalesce(p_departments, '{}') @> array['elektronik'] then array['m']
    when coalesce(p_departments, '{}') @> array['elektronik'] and not coalesce(p_departments, '{}') @> array['mekanik'] then array['e']
    else array['m','e'] end $$;

create or replace function public.stock_count_notify() returns integer language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int;
begin
  if not stock_count_day(d) then return 0; end if;
  insert into support_notifications(user_id, kind, title, link, pushed_at)
  select p.id, 'sayim',
    case g when '{m}' then 'Bugün aylık stok sayımı günü: mekanik stoğu sayıp siteye girin.'
           when '{e}' then 'Bugün aylık stok sayımı günü: elektronik stoğu sayıp siteye girin.'
           else 'Bugün aylık stok sayımı günü: mekanik ve elektronik stoğu sayıp siteye girin.' end,
    case when g = '{e}' then '#/elektronik-sayim' else '#/mekanik-sayim' end, now()
  from (select id, stock_groups_of(departments) g from profiles where roles && array['stock']::text[]) p
  where not exists (select 1 from support_notifications x where x.user_id = p.id and x.kind = 'sayim' and (x.created_at at time zone 'Europe/Istanbul')::date = d);
  get diagnostics n = row_count;
  if n > 0 then begin perform notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;

create or replace function public.stock_count_remind() returns integer language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int;
begin
  if not stock_count_day(d + 1) then return 0; end if;
  insert into support_notifications(user_id, kind, title, link, pushed_at)
  select p.id, 'sayim',
    'Yarın aylık stok sayımı günü (ayın ilk cuması). ' || case g when '{m}' then 'Mekanik' when '{e}' then 'Elektronik' else 'Mekanik ve elektronik' end || ' sayım listesi sitede hazır.',
    case when g = '{e}' then '#/elektronik-sayim' else '#/mekanik-sayim' end, now()
  from (select id, stock_groups_of(departments) g from profiles where roles && array['stock']::text[]) p
  where not exists (select 1 from support_notifications x where x.user_id = p.id and x.kind = 'sayim' and (x.created_at at time zone 'Europe/Istanbul')::date = d);
  get diagnostics n = row_count;
  if n > 0 then begin perform notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;

create or replace function public.stock_count_report() returns integer language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; m0 timestamptz; nm int; ne int; n int;
begin
  if not stock_count_day(d) then return 0; end if;
  m0 := (date_trunc('month', d)::timestamp at time zone 'Europe/Istanbul');
  select count(*) filter (where i.category in ('mekanik','diger')), count(*) filter (where i.category in ('elektronik','komponent','hazir')) into nm, ne
  from stock_items i where not exists (select 1 from stock_moves m where m.item_id = i.id and m.reason = 'sayim' and m.at >= m0);
  insert into support_notifications(user_id, kind, title, link, pushed_at)
  select p.id, 'sayim_rapor',
    case g when '{m}' then case when nm = 0 then 'Mekanik sayım tamam: bu ay tüm mekanik parçalar sayıldı.' else format('Bu ay sayılmayan mekanik parça: %s. Listeyi açıp tamamlayın.', nm) end
           when '{e}' then case when ne = 0 then 'Elektronik sayım tamam: bu ay tüm elektronik parçalar sayıldı.' else format('Bu ay sayılmayan elektronik parça: %s. Listeyi açıp tamamlayın.', ne) end
           else case when nm + ne = 0 then 'Sayım tamam: bu ay tüm parçalar sayıldı.' else format('Bu ay sayılmayan parça: %s mekanik, %s elektronik. Listeyi açıp tamamlayın.', nm, ne) end end,
    case when g = '{e}' or (g = '{m,e}' and nm = 0 and ne > 0) then '#/elektronik-sayim/eksik' else '#/mekanik-sayim/eksik' end, now()
  from (select id, stock_groups_of(departments) g from profiles where roles && array['stock']::text[]) p
  where not exists (select 1 from support_notifications x where x.user_id = p.id and x.kind = 'sayim_rapor' and (x.created_at at time zone 'Europe/Istanbul')::date = d);
  get diagnostics n = row_count;
  if n > 0 then begin perform notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;
revoke all on function public.stock_count_notify(), public.stock_count_remind(), public.stock_count_report() from public, anon, authenticated;

commit;
