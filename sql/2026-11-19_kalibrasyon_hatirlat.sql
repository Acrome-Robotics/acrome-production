-- Kalibrasyon hatırlatması (19.11.2026)
-- Cihaza sorumlu kişi; sonraki kalibrasyona 30 gün ve 7 gün kala ve tarih geçince birer e-posta.
-- Sorumlu yoksa Kalite + Yönetici rolündekilere gider. Her aşama, aynı sonraki tarih için bir kez gönderilir;
-- sonraki tarih değişince (yeni kalibrasyon girildi) sayaç sıfırlanır.

alter table public.q_devices add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.q_devices add column if not exists cal_notified_for date;     -- hangi sonraki tarih için
alter table public.q_devices add column if not exists cal_notified_stage int;    -- 30, 7 ya da 0 (geçti)

-- hatırlatma işareti yazılınca "son değişiklik" bilgisi değişmesin
create or replace function public.q_devices_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['cal_notified_for','cal_notified_stage','updated_at','updated_by_name'])
                        = (to_jsonb(old) - array['cal_notified_for','cal_notified_stage','updated_at','updated_by_name']) then
    return new;
  end if;
  -- sonraki tarih boşsa ya da son tarih / periyot değişip sonraki tarih elle değiştirilmediyse hesaplanır
  if new.last_cal_date is not null and new.cal_period_months is not null
     and (new.next_cal_date is null or (tg_op = 'UPDATE' and new.next_cal_date is not distinct from old.next_cal_date
          and (new.last_cal_date is distinct from old.last_cal_date or new.cal_period_months is distinct from old.cal_period_months))) then
    new.next_cal_date := (new.last_cal_date + make_interval(months => new.cal_period_months))::date;
  end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.q_devices_trg() from public, anon, authenticated;

create or replace function public.q_cal_remind() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int := 0; r record; st int; k int;
begin
  for r in select * from public.q_devices
           where cal_required and status <> 'kullanim_disi' and next_cal_date is not null and next_cal_date - d <= 30 loop
    st := case when r.next_cal_date < d then 0 when r.next_cal_date - d <= 7 then 7 else 30 end;
    -- aynı sonraki tarih için bu aşama (ya da daha yakını) gönderildiyse atla
    continue when r.cal_notified_for is not distinct from r.next_cal_date and r.cal_notified_stage <= st;
    insert into public.mail_outbox(to_email, to_name, subject, title, link)
    select p.email, p.full_name,
           'Acrome · Kalibrasyon: ' || r.name,
           coalesce(r.code || ' ', '') || r.name || ' cihazının kalibrasyonu ' || to_char(r.next_cal_date, 'DD.MM.YYYY') || ' tarihinde. '
             || case when st = 0 then (d - r.next_cal_date) || ' gün geçti.' else (r.next_cal_date - d) || ' gün kaldı.' end,
           '#/kalibrasyon/' || r.id
    from public.profiles p
    where p.email is not null
      and (case when r.owner_id is not null and exists (select 1 from public.profiles o where o.id = r.owner_id and o.email is not null)
                then p.id = r.owner_id
                else coalesce(p.roles, array[p.role]) && array['kalite','admin'] end);
    get diagnostics k = row_count; n := n + k;
    update public.q_devices set cal_notified_for = r.next_cal_date, cal_notified_stage = st where id = r.id;
  end loop;
  if n > 0 then begin perform public.notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;
revoke all on function public.q_cal_remind() from public, anon, authenticated;

select cron.unschedule('kalibrasyon-hatirlat') where exists (select 1 from cron.job where jobname = 'kalibrasyon-hatirlat');
select cron.schedule('kalibrasyon-hatirlat', '0 4 * * *', $$select public.q_cal_remind()$$); -- 07:00 TR
