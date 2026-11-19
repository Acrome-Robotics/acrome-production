-- Yetki düzeni (19.11.2026)
-- 1) Tahsilat (deal_payments, ödemeler, tahsilat sayfaları ve raporu, ödeme alındı işareti) yalnız Satış, Muhasebe, Yönetici. Sipariş (orders) yalnız sipariş formunda ödeme planını girer / okur (deal_payment_plan, save_deal_payments).
--    Sipariş tutarının genel görünürlüğü değişmez.
-- 2) Siparişi (deals) yalnız Satış, Sipariş ve Yönetici düzenler. Üretim yalnız planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını
--    deal_production_set işleviyle (save_deal ve deal_stage_set üzerinden) yazar; sütun sınırı deals_validate tetikleyicisinde de sürer.
-- Geri alma: 2026-11-19_yetki_geri.sql. Yayın sırası: önce kod, sonra bu dosya.

-- ---------- 1) tahsilat okuma (deal_payments yazma politikası yok; yazma save_deal_payments / deal_payment_mark işlevleriyle)
drop policy if exists deal_payments_read on public.deal_payments;
create policy deal_payments_read on public.deal_payments for select to authenticated
  using ((select has_role(array['sales','muhasebe','admin'])));

create or replace function public.deal_payment_report()
 returns table(id bigint, deal_id bigint, ref_no text, customer text, description text, status text, is_internal boolean, currency text, deal_total numeric, pct numeric, amount numeric, due_date date, note text, received_at date, received_name text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not has_role(array['sales','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  return query
  select p.id, p.deal_id, coalesce(d.order_no, d.opp_no), c.name, d.description, d.status, d.is_internal,
         'USD'::text, d.amount_usd, p.pct, coalesce(p.amount, round(d.amount_usd * p.pct / 100, 2)), p.due_date, p.note, p.received_at, p.received_name
  from public.deal_payments p
  join public.deals d on d.id = p.deal_id
  join public.customers c on c.id = d.customer_id
  where d.deleted_at is null
  order by p.due_date, p.deal_id, p.seq;
end $function$;

create or replace function public.deal_payment_mark(p_id bigint, p_date date)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare d public.deals;
begin
  if not has_role(array['sales','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
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

create or replace function public.save_deal_payments(p_deal bigint, p_rows jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_ids bigint[]; v_tot numeric; v_n int; v_namt int; v_pct numeric; v_sum numeric; v_diff numeric;
begin
  if not has_role(array['sales','orders','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  select amount_usd into v_tot from public.deals where id = p_deal;
  if not found then raise exception 'Kayıt bulunamadı'; end if;
  p_rows := coalesce(p_rows, '[]'::jsonb);
  select array_agg((x->>'id')::bigint) into v_ids from jsonb_array_elements(p_rows) x where nullif(x->>'id', '') is not null;
  delete from public.deal_payments where deal_id = p_deal and received_at is null and (v_ids is null or id <> all(v_ids));
  for r in select * from jsonb_array_elements(p_rows) loop
    if nullif(r->>'id', '') is not null then
      update public.deal_payments set seq = (r->>'seq')::int, pct = nullif(r->>'pct', '')::numeric, amount = nullif(r->>'amount', '')::numeric,
        due_date = (r->>'due_date')::date, note = nullif(trim(r->>'note'), ''), updated_at = now()
      where id = (r->>'id')::bigint and deal_id = p_deal and received_at is null;
    else
      insert into public.deal_payments(deal_id, seq, pct, amount, due_date, note)
      values (p_deal, (r->>'seq')::int, nullif(r->>'pct', '')::numeric, nullif(r->>'amount', '')::numeric, (r->>'due_date')::date, nullif(trim(r->>'note'), ''));
    end if;
  end loop;
  select count(*), count(amount), coalesce(sum(pct), 0), sum(coalesce(amount, coalesce(v_tot, 0) * pct / 100))
    into v_n, v_namt, v_pct, v_sum from public.deal_payments where deal_id = p_deal;
  if v_n = 0 then return; end if;
  if coalesce(v_tot, 0) <= 0 then
    if v_namt > 0 then raise exception 'Sipariş tutarı girilmeden ödeme planına tutar yazılamaz; oran kullanın'; end if;
    if abs(v_pct - 100) > 0.01 then raise exception 'Ödeme planı oranlarının toplamı %%100 olmalı (şu an %%%)', round(v_pct, 2); end if;
    return;
  end if;
  v_diff := round(v_sum - v_tot, 2);
  if abs(v_diff) > 0.01 then
    raise exception 'Ödeme planı toplamı sipariş tutarını tutmuyor: % USD %', abs(v_diff), case when v_diff < 0 then 'eksik' else 'fazla' end;
  end if;
end $function$;

-- Sipariş rolü (orders) ödeme planını sipariş formunda girer ve okur, ama tahsilatı görmez: deal_payments okuma politikasına eklenmez (alınan tutar, kim aldı, not gibi alanlar açılırdı);
-- yalnız plan satırlarını döndüren dar bir işlev kullanır. Alınmış satır "locked" olarak gelir (tarih ve kişi verilmez), formda kilitli görünür.
create or replace function public.deal_payment_plan(p_deal bigint)
 returns table(id bigint, seq int, pct numeric, amount numeric, due_date date, note text, locked boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not has_role(array['sales','orders','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  return query select p.id, p.seq, p.pct, p.amount, p.due_date, p.note, p.received_at is not null
    from public.deal_payments p join public.deals d on d.id = p.deal_id where p.deal_id = p_deal and d.deleted_at is null order by p.seq;
end $function$;
revoke all on function public.deal_payment_plan(bigint) from public, anon;
grant execute on function public.deal_payment_plan(bigint) to authenticated;

-- ---------- 2) sipariş düzenleme: Üretim çıkar
drop policy if exists deals_upd on public.deals;
create policy deals_upd on public.deals for update to authenticated
  using ((select has_role(array['sales','orders','admin']))) with check ((select has_role(array['sales','orders','admin'])));

-- Üretimin deals'e yazdığı tek yol: izinli dört alan. Durum geçişi ve Gönderim yetkisi deals_validate'te denetlenir.
create or replace function public.deal_production_set(p_deal bigint, p_planned_ship_date date, p_ship_date date, p_status text, p_delay_reason text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not has_role(array['production']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  update public.deals set planned_ship_date = p_planned_ship_date, ship_date = p_ship_date, status = coalesce(p_status, status), delay_reason = nullif(p_delay_reason, '')
  where id = p_deal and deleted_at is null;
  if not found then raise exception 'Kayıt bulunamadı'; end if;
end $function$;
revoke all on function public.deal_production_set(bigint, date, date, text, text) from public, anon;
grant execute on function public.deal_production_set(bigint, date, date, text, text) to authenticated;

-- save_deal (invoker): üretim kolu doğrudan UPDATE yerine deal_production_set'i çağırır
create or replace function public.save_deal(p_deal jsonb, p_items jsonb, p_customer_name text default null, p_customer_country text default null)
 returns bigint language plpgsql set search_path to 'public'
as $function$
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
    perform public.deal_production_set(v_id, nullif(p_deal->>'planned_ship_date','')::date, nullif(p_deal->>'ship_date','')::date, p_deal->>'status', p_deal->>'delay_reason');
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

-- ---------- denetim kaydı: tahsilat satırları aynı rollere
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  case table_name
    when 'purchases'       then can_read_app()
    when 'stock_items'     then can_read_app()
    when 'daily_notes'     then can_attend()
    when 'expense_reports' then has_role(array['muhasebe','admin']) or exists (select 1 from public.expense_reports x where x.id = audit_log.row_id::bigint and x.user_id = (select auth.uid()))
    when 'ncr'             then q_read()
    when 'q_devices'       then q_read()
    when 'q_kpis'          then q_read()
    when 'q_kpi_values'    then q_read()
    when 'kys_records'     then q_admin()
    when 'deal_payments'   then has_role(array['sales','muhasebe','admin'])
    else has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])
  end
);
