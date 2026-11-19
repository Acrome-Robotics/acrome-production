-- Sipariş ↔ kalite projesi bağı (20.11.2026). Bağ isteğe bağlıdır: çoğu standart satışta boş kalır.
-- deals.kys_project_id (kys_projects, silinirse boşalır); sipariş formunda "Kalite projesi" seçimi save_deal ile kaydedilir (üretim kolu dokunmaz).
-- Bağlı siparişte Riskler panelinde projenin risk satırları (ACR-LS-RK-02, kys_records 'row', project_id) da seçilir; bağ yine kys_row_deals'tedir.
-- Satış / Sipariş rolü, yalnız bir siparişe bağlanmış kalite projesinin risk satırlarını okuyabilsin diye ACR-LS-RK-01 okuma kuralının proje karşılığı eklenir (bağsız projelerin riskleri açılmaz; yazma yetkisi aynı kalır).
-- Yayın sırası: önce bu SQL, sonra kod. Geri alma: 2026-11-20_proje_bag_geri.sql.

alter table public.deals add column if not exists kys_project_id bigint references public.kys_projects(id) on delete set null;
create index if not exists deals_kys_project_idx on public.deals(kys_project_id) where kys_project_id is not null;

drop policy if exists kys_records_read_rk2 on public.kys_records;
create policy kys_records_read_rk2 on public.kys_records for select to authenticated using (
  code = 'ACR-LS-RK-02' and kind = 'row' and project_id is not null and (select has_role(array['kalite','admin','sales','orders']))
  and exists (select 1 from public.deals d where d.kys_project_id = kys_records.project_id));

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
      fx_rate, fx_date, fx_source, kys_project_id)
    select nullif(d.order_no,''), nullif(d.opp_no,''), v_cust, nullif(d.country,''), d.description, d.stage,
      case when d.status in ('production','shipped') then 'waiting' else d.status end, nullif(d.quote_no,''),
      d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date, nullif(d.ship_month,''),
      nullif(d.details,''), nullif(d.delay_reason,''), nullif(d.payment_terms,''), nullif(d.notes,''), nullif(d.reseller,''),
      case when x.fx then round(d.amount_orig * d.fx_rate, 2) else d.amount_usd end,
      x.cur, d.amount_orig, d.smd_sales_usd, coalesce(d.is_internal,false), nullif(trim(d.other_note),''),
      case when x.cur <> 'USD' then d.fx_rate end, case when x.cur <> 'USD' then d.fx_date end, case when x.cur <> 'USD' then d.fx_source end, d.kys_project_id
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
      fx_rate = case when x.cur <> 'USD' then d.fx_rate end, fx_date = case when x.cur <> 'USD' then d.fx_date end, fx_source = case when x.cur <> 'USD' then d.fx_source end, kys_project_id = d.kys_project_id
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
