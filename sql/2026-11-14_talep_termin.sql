-- Talepler (14.11): Genel kullanım (G1); "Sipariş verildi" için zorunlu tahmini termin; termin günü talebi açana "geldi mi?";
-- talebi açan "Teslim alındı" (alindi) ya da "Henüz gelmedi" diyebilir. Uygulamadan önce purchase_trg'nin canlı tanımı
-- 2026-11-13_proforma_sarti.sql ile aynı mı kontrol edilir (pg_get_functiondef).

alter table public.purchases add column if not exists general_use boolean not null default false,
  add column if not exists expected_at date check (expected_at between '2020-01-01' and '2035-12-31'),
  add column if not exists ordered_at date,
  add column if not exists eta_notified_on date;

create or replace function public.purchase_trg() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.total is null and new.qty is not null and new.unit_price is not null then new.total := round(new.qty * new.unit_price, 2); end if;
  if tg_op = 'UPDATE' and new.status = 'proforma' and old.status is distinct from 'proforma'
     and not exists (select 1 from purchase_files where purchase_id = new.id and kind = 'proforma') then
    raise exception 'Önce proforma belgesini yükleyin';
  end if;
  -- Sipariş verildi = sipariş verildi, ödendi, yolda: tahmini termin zorunlu (yalnız yeni geçişte; eski kayıtlar etkilenmez)
  if tg_op = 'UPDATE' and new.status = 'siparis_verildi' and old.status is distinct from 'siparis_verildi' then
    if new.expected_at is null then raise exception 'Sipariş verildi için tahmini termin zorunlu'; end if;
    new.ordered_at := coalesce(new.ordered_at, current_date);
  end if;
  if tg_op = 'UPDATE' and new.expected_at is distinct from old.expected_at then new.eta_notified_on := null; end if; -- yeni terminde tekrar sorulur
  if tg_op = 'UPDATE' and new.status = 'alindi' and old.status is distinct from 'alindi' and new.purchased_at is null then new.purchased_at := current_date; end if;
  if tg_op = 'UPDATE' and old.status = 'alindi' and new.status in ('talep','onaylandi','proforma','siparis_verildi','eft_bekliyor','reddedildi')
     and old.received_into_stock and old.item_id is not null and coalesce(old.qty, 0) > 0 then
    perform stock_move(old.item_id, -old.qty, null, 'duzeltme', 'Alım #' || new.id || ' geri alındı: ' || new.item_name, 'purchase', new.id);
    new.received_into_stock := false;
  end if;
  if new.status = 'alindi' and new.item_id is not null and not new.received_into_stock and coalesce(new.qty, 0) > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'alindi') then
    perform stock_move(new.item_id, new.qty, null, 'alim', 'Alım #' || new.id || ': ' || new.item_name, 'purchase', new.id);
    new.received_into_stock := true;
  end if;
  return new;
end $function$;

-- Talebi açan (satın alma yetkisi olmasa da) ya da satın alma: yoldaki malzeme elimize ulaştı → Teslim alındı
create or replace function public.purchase_arrived(p_purchase bigint) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare pr public.purchases; who text;
begin
  select * into pr from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if not (public.can_purchase() or auth.uid() in (pr.requester, pr.created_by)) then raise exception 'Bu talebi yalnız açan kişi ya da satın alma kapatabilir'; end if;
  if pr.status <> 'siparis_verildi' then raise exception 'Yalnız "Sipariş verildi" durumundaki talep teslim alındı yapılabilir'; end if;
  update public.purchases set status = 'alindi' where id = p_purchase; -- stok girişi ve teslim tarihi purchase_trg'de
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  insert into public.support_notifications(user_id, kind, title, link)
  select distinct u, 'alim', 'Teslim alındı · ' || left(pr.item_name, 80) || coalesce(' (' || who || ')', ''), '#/alimlar/' || p_purchase
  from (select pr.requester u union select pr.created_by union select id from public.profiles where 'purchasing' = any(roles) and role <> 'pending') x
  where u is not null and u is distinct from auth.uid();
end $function$;

-- Termin geçti ama gelmedi: satın almaya haber; yeni termin girilince o gün tekrar sorulur
create or replace function public.purchase_not_arrived(p_purchase bigint, p_note text default null) returns void
language plpgsql security definer set search_path to 'public' as $function$
declare pr public.purchases; who text;
begin
  select * into pr from public.purchases where id = p_purchase;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if not (public.can_purchase() or auth.uid() in (pr.requester, pr.created_by)) then raise exception 'Bu talep için yetkiniz yok'; end if;
  if pr.status <> 'siparis_verildi' then raise exception 'Talep "Sipariş verildi" durumunda değil'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  insert into public.purchase_events(purchase_id, actor, actor_name, old_status, new_status, note)
  values (p_purchase, auth.uid(), who, pr.status, pr.status, 'Henüz gelmedi' || coalesce(': ' || left(nullif(trim(p_note), ''), 300), ''));
  insert into public.support_notifications(user_id, kind, title, link)
  select id, 'alim', 'Termin geçti, henüz gelmedi · ' || left(pr.item_name, 80) || coalesce(' (' || who || ')', ''), '#/alimlar/' || p_purchase
  from public.profiles where 'purchasing' = any(roles) and role <> 'pending' and id is distinct from auth.uid();
end $function$;

revoke all on function public.purchase_arrived(bigint), public.purchase_not_arrived(bigint, text) from public, anon;
grant execute on function public.purchase_arrived(bigint), public.purchase_not_arrived(bigint, text) to authenticated;

-- Her sabah: termini gelmiş, henüz teslim alınmamış talepler için talebi açana "geldi mi?" (her termin için bir kez)
create or replace function public.purchase_eta_remind() returns integer
language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  with due as (
    update public.purchases set eta_notified_on = expected_at
    where status = 'siparis_verildi' and kind <> 'kontrol' and expected_at <= current_date and eta_notified_on is distinct from expected_at
    returning id, item_name, requester, created_by)
  insert into public.support_notifications(user_id, kind, title, link)
  select distinct u, 'alim', 'Malzeme bekleniyordu, geldi mi? · ' || left(d.item_name, 80), '#/alimlar/' || d.id
  from due d cross join lateral (select d.requester u union select d.created_by) x where u is not null;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.purchase_eta_remind() from public, anon, authenticated;

select cron.unschedule('alim-termin-hatirlat') where exists (select 1 from cron.job where jobname = 'alim-termin-hatirlat');
select cron.schedule('alim-termin-hatirlat', '0 4 * * *', $$select public.purchase_eta_remind()$$); -- 07:00 TR
