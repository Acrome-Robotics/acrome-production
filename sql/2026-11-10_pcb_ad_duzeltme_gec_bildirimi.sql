-- 10 Kasım 2026
--  A) PCB takip kayıtlarında aynı kişinin / yerin farklı yazımlarını tek ada çevirir (düzeltme izi bırakmadan).
--  B) Ay sonu geç kalma bildirimi: her ayın 1'inde 09:30'da geçen ayın net eksiği olan kişiye kendi özeti,
--     yöneticilere ve muhasebeye tek özet bildirimi (yalnız sitede; e-posta ve telefon bildirimi yok).
begin;

-- A) PCB adları
alter table public.pcb_log disable trigger pcb_log_biu;
with m(eski, yeni) as (values
  ('MertKaya','Mert Kaya'), ('CanErcan','Can Ercan'), ('AtaVarolKocman','Ata Varol Kocman'), ('FurkanKirlangic','Furkan Kirlangic'),
  ('YusufEmreCicekyurt','Yusuf Emre Cicekyurt'), ('Parsa Payedeh','Parsa Payandeh'),
  ('Stok(Q.C)','Stok (Q.C)'), ('Stok(Ariza)','Stok (Arıza)'), ('Stok(Test Edilecekler)','Stok (Test edilecek)'), ('Urun','Ürün'))
update public.pcb_log l set given_by = m.yeni from m where l.given_by = m.eski;
with m(eski, yeni) as (values
  ('MertKaya','Mert Kaya'), ('CanErcan','Can Ercan'), ('AtaVarolKocman','Ata Varol Kocman'), ('FurkanKirlangic','Furkan Kirlangic'),
  ('YusufEmreCicekyurt','Yusuf Emre Cicekyurt'), ('Parsa Payedeh','Parsa Payandeh'),
  ('Stok(Q.C)','Stok (Q.C)'), ('Stok(Ariza)','Stok (Arıza)'), ('Stok(Test Edilecekler)','Stok (Test edilecek)'), ('Urun','Ürün'))
update public.pcb_log l set received_by = m.yeni from m where l.received_by = m.eski;
alter table public.pcb_log enable trigger pcb_log_biu;

-- B) ay özeti: yetki süzgeci olmayan iç hesap + yetkili sarmalayıcı
create or replace function public.att_month_all(p_month date)
returns table(person_id bigint, name text, active boolean, work_start time, work_end time,
              late_days int, late_min int, comp_min int, net_min int, late_no_time int, days jsonb)
language sql stable security definer set search_path = 'public' as $$
  with m as (select date_trunc('month', p_month)::date a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date b),
  days as (select person_id, day from public.att_days union select person_id, day from public.att_times),
  dd as (
    select p.id pid, x.day, ad.code, t.arrive, t.leave, t.note, p.work_start ws, p.work_end we,
           (extract(isodow from x.day) between 1 and 5 and coalesce(ad.code, '') <> 'T') as workday
    from public.att_people p join days x on x.person_id = p.id cross join m
    left join public.att_days ad on ad.person_id = p.id and ad.day = x.day
    left join public.att_times t on t.person_id = p.id and t.day = x.day
    where x.day between m.a and m.b),
  calc as (
    select pid, day, code, arrive, leave, note, workday,
      case when workday and coalesce(code, 'x') in ('x', 'G') and arrive is not null and arrive > ws then (extract(epoch from (arrive - ws)) / 60)::int else 0 end lmin,
      case when not workday and arrive is not null and leave is not null then (extract(epoch from (leave - arrive)) / 60)::int
           when workday and leave is not null and leave > we then (extract(epoch from (leave - we)) / 60)::int else 0 end cmin
    from dd)
  select p.id, p.name, p.active, p.work_start, p.work_end,
    coalesce(count(c.day) filter (where c.code = 'G' or c.lmin > 0), 0)::int,
    coalesce(sum(c.lmin), 0)::int, coalesce(sum(c.cmin), 0)::int,
    greatest(coalesce(sum(c.lmin), 0) - coalesce(sum(c.cmin), 0), 0)::int,
    coalesce(count(c.day) filter (where c.code = 'G' and c.arrive is null), 0)::int,
    coalesce(jsonb_agg(jsonb_build_object('day', c.day, 'code', c.code, 'arrive', to_char(c.arrive, 'HH24:MI'), 'leave', to_char(c.leave, 'HH24:MI'),
             'late', c.lmin, 'comp', c.cmin, 'note', c.note) order by c.day) filter (where c.lmin > 0 or c.cmin > 0 or c.arrive is not null or c.leave is not null or c.code = 'G'), '[]'::jsonb)
  from public.att_people p left join calc c on c.pid = p.id
  group by p.id, p.name, p.active, p.work_start, p.work_end, p.sort
  having p.active or count(c.day) filter (where c.lmin > 0 or c.cmin > 0) > 0
  order by p.sort, p.name $$;
revoke all on function public.att_month_all(date) from public, anon, authenticated;

create or replace function public.att_month(p_month date)
returns table(person_id bigint, name text, active boolean, work_start time, work_end time,
              late_days int, late_min int, comp_min int, net_min int, late_no_time int, days jsonb)
language sql stable security definer set search_path = 'public' as $$
  select * from public.att_month_all(p_month) a
  where public.has_role(array['admin','muhasebe']) or a.person_id = public.att_me() $$;
revoke all on function public.att_month(date) from public, anon;
grant execute on function public.att_month(date) to authenticated;

create or replace function public.min_txt(m int) returns text language sql immutable set search_path = 'public' as $$
  select case when coalesce(m, 0) <= 0 then '0 dk' when m >= 60 then (m / 60) || ' sa' || case when m % 60 > 0 then ' ' || (m % 60) || ' dk' else '' end else m || ' dk' end $$;

-- geçen ayın özeti; bildirimler yalnız sitede görünür (emailed_at / pushed_at dolu = e-posta ve telefon bildirimi gitmez)
create or replace function public.att_month_notify(p_month date default null) returns integer language plpgsql security definer set search_path = 'public' as $$
declare mo date := coalesce(date_trunc('month', p_month)::date, (date_trunc('month', (now() at time zone 'Europe/Istanbul')::date) - interval '1 month')::date);
  v_ay text; v_link text; n int := 0; k int; ozet text;
begin
  v_ay := (array['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'])[extract(month from mo)::int] || ' ' || extract(year from mo)::int;
  v_link := '#/gec-kalma/' || to_char(mo, 'YYYY-MM');
  drop table if exists _am;
  create temp table _am on commit drop as select * from public.att_month_all(mo) where net_min > 0 or late_no_time > 0;
  -- kişiye kendi özeti
  insert into support_notifications(user_id, kind, title, link, pushed_at, emailed_at)
  select pr.id, 'mesai',
    v_ay || ': ' || case when a.net_min > 0 then format('net eksik süren %s (geç %s, telafi %s)', min_txt(a.net_min), min_txt(a.late_min), min_txt(a.comp_min)) else 'net eksik yok' end
      || case when a.late_no_time > 0 then format('; %s geç günün geliş saati girilmemiş, Geç kalma / telafi sayfasından gir', a.late_no_time) else '' end || '.',
    v_link, now(), now()
  from _am a join att_people ap on ap.id = a.person_id join profiles pr on lower(pr.email) = lower(ap.email)
  where not exists (select 1 from support_notifications x where x.user_id = pr.id and x.kind = 'mesai' and x.link = v_link and x.title like v_ay || ': %');
  get diagnostics k = row_count; n := n + k;
  -- yöneticiler ve muhasebe: tek özet
  select string_agg(format('%s %s', a.name, min_txt(a.net_min)), ', ' order by a.net_min desc) into ozet from _am a where a.net_min > 0;
  if ozet is not null or exists (select 1 from _am) then
    insert into support_notifications(user_id, kind, title, link, pushed_at, emailed_at)
    select pr.id, 'mesai', format('%s geç kalma özeti: %s', v_ay, coalesce('net eksik: ' || ozet, 'net eksik yok')) ||
      coalesce('; saati girilmemiş geç gün: ' || nullif((select sum(late_no_time) from _am), 0), '') || '.', v_link, now(), now()
    from profiles pr where pr.roles && array['admin','muhasebe']::text[]
      and not exists (select 1 from support_notifications x where x.user_id = pr.id and x.kind = 'mesai' and x.link = v_link and x.title like v_ay || ' geç kalma özeti%');
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;
revoke all on function public.att_month_notify(date) from public, anon, authenticated;

select cron.unschedule('gec-kalma-ay-sonu') where exists (select 1 from cron.job where jobname = 'gec-kalma-ay-sonu');
select cron.schedule('gec-kalma-ay-sonu', '30 6 1 * *', 'select public.att_month_notify()');

commit;
