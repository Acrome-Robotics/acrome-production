-- Bekleme alanı: yeni sipariş (ya da siparişe çevrilen PROS) önce 'waiting' durumuna düşer, muhasebe + yöneticiye bildirim gider.
-- Satış / yönetici "Üretime al" deyince 'production' olur, üretime bildirim gider. Beklemedeki siparişin ödemesi gelince satış + yöneticiye haber.

alter table public.deals drop constraint deals_status_check;
alter table public.deals add constraint deals_status_check check (status = any (array['pipeline','waiting','production','shipped','lost','archived']));
alter table public.deals drop constraint stage_status_ok;
alter table public.deals add constraint stage_status_ok check (
  (status = any (array['waiting','production','shipped']) and stage = 'won')
  or (status = 'lost' and stage = 'lost')
  or (status = any (array['pipeline','archived']) and stage <> all (array['won','lost'])));

create or replace function public.deals_validate() returns trigger
language plpgsql set search_path to 'public' as $function$
declare r text := public.app_role();
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.deleted_at := null; new.deleted_by := null; end if;

  -- deals_upd orders / production'a da açık; Silinenler'e taşıma ve geri alma yalnız satış ve yönetici
  if tg_op = 'UPDATE' and new.deleted_at is distinct from old.deleted_at then
    if not has_role(array['sales','admin']) then raise exception 'Kaydı Silinenler''e taşımak / geri almak satış ya da yöneticinin işidir'; end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;

  if tg_op = 'UPDATE' and has_role(array['production']) and not has_role(array['sales','orders','admin']) then
    if (to_jsonb(new) - array['planned_ship_date','ship_date','status','delay_reason','updated_at','updated_by'])
       is distinct from (to_jsonb(old) - array['planned_ship_date','ship_date','status','delay_reason','updated_at','updated_by']) then
      raise exception 'Üretim rolü yalnızca planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını değiştirebilir';
    end if;
    if new.status is distinct from old.status and not (old.status in ('production','shipped') and new.status in ('production','shipped')) then
      raise exception 'Üretim rolü durumu yalnızca Üretimde ↔ Gönderildi arasında değiştirebilir';
    end if;
    if new.status is distinct from old.status and not public.can_stage('gonderim') then
      raise exception 'Siparişi Gönderildi yapmak Gönderim bölümünün işidir';
    end if;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status or new.stage is distinct from old.stage then
    if new.stage = 'won' and new.order_no is null and not new.is_internal then
      raise exception 'Kazanılan kayıt için sipariş numarası (ACRPO-xxx) zorunlu';
    end if;
    if new.status in ('waiting','production','shipped') and new.order_date is null then
      raise exception 'Sipariş için sipariş tarihi zorunlu';
    end if;
    if new.status = 'shipped' and new.ship_date is null and tg_op = 'UPDATE' and old.status <> 'shipped' then
      raise exception 'Gönderildi durumuna geçerken sevk tarihi zorunlu';
    end if;
    if new.status = 'pipeline' and new.opp_no is null then
      raise exception 'Fırsat için PROS numarası zorunlu';
    end if;
  end if;

  if new.ship_date is not null and new.order_date is not null and new.ship_date < new.order_date
     and (tg_op='INSERT' or new.ship_date is distinct from old.ship_date or new.order_date is distinct from old.order_date) then
    raise exception 'Sevk tarihi sipariş tarihinden önce olamaz';
  end if;
  if new.requested_ship_date is not null and new.order_date is not null and new.requested_ship_date < new.order_date
     and (tg_op='INSERT' or new.requested_ship_date is distinct from old.requested_ship_date or new.order_date is distinct from old.order_date) then
    raise exception 'İstenen sevk tarihi sipariş tarihinden önce olamaz';
  end if;
  if (tg_op='INSERT' or new.ship_date is distinct from old.ship_date) and new.ship_date > current_date + 1 then
    raise exception 'Sevk tarihi gelecekte olamaz (planlanan tarih alanını kullanın)';
  end if;
  return new;
end $function$;

-- Arayüzün kayıt yolu: yeni sipariş ve siparişe çevrilen fırsat beklemeye düşer (Excel aktarımı admin_import ayrı)
CREATE OR REPLACE FUNCTION public.save_deal(p_deal jsonb, p_items jsonb, p_customer_name text DEFAULT NULL::text, p_customer_country text DEFAULT NULL::text)
 RETURNS bigint LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_id bigint := nullif(p_deal->>'id','')::bigint;
        v_cust bigint := nullif(p_deal->>'customer_id','')::bigint;
        v_role text := public.app_role();
begin
  if not has_role(array['sales','orders','admin','production']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  if v_cust is null and p_customer_name is not null then
    select id into v_cust from public.customers where lower(trim(name)) = lower(trim(p_customer_name));
    if v_cust is null then
      if p_customer_country is null then raise exception 'Yeni müşteri için ülke seçin'; end if;
      insert into public.customers(name, country) values (trim(p_customer_name), p_customer_country) returning id into v_cust;
    end if;
  end if;
  if v_cust is null then raise exception 'Müşteri seçin'; end if;

  if v_id is null then
    insert into public.deals (order_no, opp_no, customer_id, country, description, stage, status, quote_no,
      lead_date, order_date, expected_po_date, requested_ship_date, planned_ship_date, ship_date, ship_month,
      details, delay_reason, payment_terms, notes, reseller, amount_usd, currency, amount_orig, smd_sales_usd, is_internal, other_note,
      fx_rate, fx_date, fx_source)
    select nullif(d.order_no,''), nullif(d.opp_no,''), v_cust, nullif(d.country,''), d.description, d.stage,
      case when d.status in ('production','shipped') then 'waiting' else d.status end, nullif(d.quote_no,''),
      d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date, nullif(d.ship_month,''),
      nullif(d.details,''), nullif(d.delay_reason,''), nullif(d.payment_terms,''), nullif(d.notes,''), nullif(d.reseller,''),
      case when x.fx then round(d.amount_orig * d.fx_rate, 2) else d.amount_usd end,
      x.cur, d.amount_orig, d.smd_sales_usd, coalesce(d.is_internal,false), nullif(trim(d.other_note),''),
      case when x.cur <> 'USD' then d.fx_rate end, case when x.cur <> 'USD' then d.fx_date end, case when x.cur <> 'USD' then d.fx_source end
    from jsonb_populate_record(null::public.deals, p_deal) d
    cross join lateral (select coalesce(nullif(d.currency,''),'USD') as cur,
      coalesce(nullif(d.currency,''),'USD') <> 'USD' and d.fx_rate is not null and d.amount_orig is not null as fx) x
    returning id into v_id;
  elsif not has_role(array['sales','orders','admin']) then
    update public.deals t set planned_ship_date = d.planned_ship_date, ship_date = d.ship_date, status = d.status, delay_reason = nullif(d.delay_reason,'')
    from jsonb_populate_record(null::public.deals, p_deal) d where t.id = v_id;
    return v_id;
  else
    update public.deals t set order_no = nullif(d.order_no,''), opp_no = nullif(d.opp_no,''), customer_id = v_cust, country = nullif(d.country,''),
      description = d.description, stage = d.stage,
      status = case when d.status in ('production','shipped') and t.status in ('pipeline','lost','archived') then 'waiting' else d.status end,
      quote_no = nullif(d.quote_no,''),
      lead_date = d.lead_date, order_date = d.order_date, expected_po_date = d.expected_po_date,
      requested_ship_date = d.requested_ship_date, planned_ship_date = d.planned_ship_date, ship_date = d.ship_date, ship_month = nullif(d.ship_month,''),
      details = nullif(d.details,''), delay_reason = nullif(d.delay_reason,''), payment_terms = nullif(d.payment_terms,''),
      notes = nullif(d.notes,''), reseller = nullif(d.reseller,''),
      amount_usd = case when x.fx then round(d.amount_orig * d.fx_rate, 2) else d.amount_usd end,
      currency = x.cur, amount_orig = d.amount_orig, smd_sales_usd = d.smd_sales_usd,
      is_internal = coalesce(d.is_internal,false), other_note = nullif(trim(d.other_note),''),
      fx_rate = case when x.cur <> 'USD' then d.fx_rate end, fx_date = case when x.cur <> 'USD' then d.fx_date end, fx_source = case when x.cur <> 'USD' then d.fx_source end
    from jsonb_populate_record(null::public.deals, p_deal) d
    cross join lateral (select coalesce(nullif(d.currency,''),'USD') as cur,
      coalesce(nullif(d.currency,''),'USD') <> 'USD' and d.fx_rate is not null and d.amount_orig is not null as fx) x
    where t.id = v_id;
    if not found then raise exception 'Kayıt bulunamadı'; end if;
  end if;

  if p_items is not null and has_role(array['sales','orders','admin']) then
    delete from public.deal_items where deal_id = v_id;
    insert into public.deal_items(deal_id, product_code, qty)
    select v_id, key, value::numeric from jsonb_each_text(p_items) where value::numeric > 0;
  end if;
  return v_id;
end $function$;

create or replace function public._deal_title(d public.deals) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(d.order_no, d.opp_no, '#' || d.id) || ' · ' || coalesce((select name from public.customers where id = d.customer_id), '')
         || coalesce(' · ' || replace(to_char(round(d.amount_usd), 'FM999,999,999'), ',', '.') || ' $', '')
$$;
revoke execute on function public._deal_title(public.deals) from public, anon, authenticated;

create or replace function public.deals_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deleted_at is not null then return null; end if;
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Yeni sipariş (beklemede): ' || public._deal_title(new),
           case when 'admin' = any(p.roles) then '#/kayit/' || new.id else '#/tahsilat' end -- muhasebe sipariş sayfasını göremez
    from public.profiles p where p.roles && array['admin','muhasebe'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and old.status = 'waiting' and new.status = 'production' then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Üretime alındı: ' || public._deal_title(new), '#/kayit/' || new.id
    from public.profiles p where 'production' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid();
  end if;
  return null;
end $$;
revoke execute on function public.deals_notify() from public, anon, authenticated;
drop trigger if exists deals_notify_trg on public.deals;
create trigger deals_notify_trg after insert or update of status on public.deals for each row execute function public.deals_notify();

CREATE OR REPLACE FUNCTION public.deal_payment_mark(p_id bigint, p_date date)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare d public.deals;
begin
  if not has_role(array['sales','orders','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  update public.deal_payments set received_at = p_date,
    received_by = case when p_date is null then null else auth.uid() end,
    received_name = case when p_date is null then null else (select coalesce(full_name, email) from public.profiles where id = auth.uid()) end,
    updated_at = now()
  where id = p_id;
  if not found then raise exception 'Ödeme satırı bulunamadı'; end if;
  if p_date is not null then
    select k.* into d from public.deals k join public.deal_payments p on p.deal_id = k.id where p.id = p_id;
    if d.status = 'waiting' and d.deleted_at is null then
      insert into public.support_notifications(user_id, kind, title, link)
      select pr.id, 'siparis', 'Ödeme geldi, üretime alınabilir: ' || public._deal_title(d), '#/kayit/' || d.id
      from public.profiles pr where pr.roles && array['sales','admin'] and pr.role <> 'pending' and pr.id is distinct from auth.uid();
    end if;
  end if;
end $function$;
