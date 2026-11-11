-- Satış kaydına "Diğer" ürün grubu: listede olmayan satışlar (plaka, yedek parça, proje) adet + not ile girilir.

alter table public.products drop constraint products_category_check;
alter table public.products add constraint products_category_check check (category = any (array['sistem','kontrolcu','smd','diger']));
insert into public.products(code, name, category, active, sort) values ('OTHER', 'Diğer', 'diger', true, 40)
  on conflict (code) do nothing;

alter table public.deals add column if not exists other_note text check (length(other_note) <= 1000);

-- security_invoker açıkça verilmeli: CREATE OR REPLACE VIEW seçenekleri sıfırlar
create or replace view public.v_deals with (security_invoker = true) as
 SELECT d.id, d.order_no, d.opp_no, d.customer_id, d.country, d.description, d.stage, d.status, d.quote_no,
    d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date,
    d.details, d.delay_reason, d.payment_terms, d.notes, d.reseller, d.amount_usd, d.currency, d.amount_orig,
    d.smd_sales_usd, d.is_internal, d.source, d.created_at, d.created_by, d.updated_at, d.updated_by, d.ship_month,
    c.name AS customer_name,
    COALESCE(( SELECT jsonb_object_agg(i.product_code, i.qty) FROM deal_items i WHERE i.deal_id = d.id), '{}'::jsonb) AS items,
    d.other_note
   FROM deals d
     JOIN customers c ON c.id = d.customer_id;

CREATE OR REPLACE FUNCTION public.save_deal(p_deal jsonb, p_items jsonb, p_customer_name text DEFAULT NULL::text, p_customer_country text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
      details, delay_reason, payment_terms, notes, reseller, amount_usd, currency, amount_orig, smd_sales_usd, is_internal, other_note)
    select nullif(d.order_no,''), nullif(d.opp_no,''), v_cust, nullif(d.country,''), d.description, d.stage, d.status, nullif(d.quote_no,''),
      d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date, nullif(d.ship_month,''),
      nullif(d.details,''), nullif(d.delay_reason,''), nullif(d.payment_terms,''), nullif(d.notes,''), nullif(d.reseller,''),
      d.amount_usd, coalesce(nullif(d.currency,''),'USD'), d.amount_orig, d.smd_sales_usd, coalesce(d.is_internal,false), nullif(trim(d.other_note),'')
    from jsonb_populate_record(null::public.deals, p_deal) d
    returning id into v_id;
  elsif not has_role(array['sales','orders','admin']) then
    update public.deals t set planned_ship_date = d.planned_ship_date, ship_date = d.ship_date, status = d.status, delay_reason = nullif(d.delay_reason,'')
    from jsonb_populate_record(null::public.deals, p_deal) d where t.id = v_id;
    return v_id;
  else
    update public.deals t set order_no = nullif(d.order_no,''), opp_no = nullif(d.opp_no,''), customer_id = v_cust, country = nullif(d.country,''),
      description = d.description, stage = d.stage, status = d.status, quote_no = nullif(d.quote_no,''),
      lead_date = d.lead_date, order_date = d.order_date, expected_po_date = d.expected_po_date,
      requested_ship_date = d.requested_ship_date, planned_ship_date = d.planned_ship_date, ship_date = d.ship_date, ship_month = nullif(d.ship_month,''),
      details = nullif(d.details,''), delay_reason = nullif(d.delay_reason,''), payment_terms = nullif(d.payment_terms,''),
      notes = nullif(d.notes,''), reseller = nullif(d.reseller,''), amount_usd = d.amount_usd,
      currency = coalesce(nullif(d.currency,''),'USD'), amount_orig = d.amount_orig, smd_sales_usd = d.smd_sales_usd,
      is_internal = coalesce(d.is_internal,false), other_note = nullif(trim(d.other_note),'')
    from jsonb_populate_record(null::public.deals, p_deal) d where t.id = v_id;
    if not found then raise exception 'Kayıt bulunamadı'; end if;
  end if;

  if p_items is not null and has_role(array['sales','orders','admin']) then
    delete from public.deal_items where deal_id = v_id;
    insert into public.deal_items(deal_id, product_code, qty)
    select v_id, key, value::numeric from jsonb_each_text(p_items) where value::numeric > 0;
  end if;
  return v_id;
end $function$;
