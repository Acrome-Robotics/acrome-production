-- Resmi kurla USD'ye çevirme (İş 5). Önce 2026-11-13_odeme_tutar.sql.
-- Kur: TCMB döviz satış (ForexSelling), Edge Function fx-rate çeker ve fx_rates'e önbellekler.
-- Kur günü: D tarihli sipariş için D'den önceki son TCMB bülteni (15:30 kuru ertesi iş günü geçerli).
-- Siparişte kullanılan kur kayıtta: fx_rate (1 birim = ? USD), fx_date (bülten günü), fx_source (TCMB / elle).
-- Ödeme planı, tahsilat ve rapor artık amount_usd üzerinden. Eski kayıtların tutarlarına dokunulmaz.

-- USD dışı siparişte tutarla girilmiş ödeme satırı varsa o tutar sipariş para birimindedir; USD'ye geçmeden önce elle bakılmalı
do $$ begin
  if exists (select 1 from public.deal_payments p join public.deals d on d.id = p.deal_id where d.currency <> 'USD' and p.amount is not null) then
    raise exception 'USD dışı siparişte tutarla girilmiş ödeme satırı var; önce bu satırları kontrol edin';
  end if;
end $$;

-- day = sipariş tarihi (önbellek anahtarı), rate_day = kullanılan bülten günü
create table if not exists public.fx_rates (
  day date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  try_rate numeric(14,6) not null check (try_rate > 0),
  rate_day date not null,
  source text not null default 'TCMB ForexSelling',
  fetched_at timestamptz not null default now(),
  primary key (day, currency)
);
alter table public.fx_rates enable row level security;
-- yazma yalnız fx-rate fonksiyonu (service role)
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select to authenticated using (true);

alter table public.deals add column if not exists fx_rate numeric(14,8) check (fx_rate > 0);
alter table public.deals add column if not exists fx_date date;
alter table public.deals add column if not exists fx_source text check (fx_source in ('TCMB', 'elle'));

create or replace view public.v_deals with (security_invoker = true) as
 SELECT d.id, d.order_no, d.opp_no, d.customer_id, d.country, d.description, d.stage, d.status, d.quote_no,
    d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date,
    d.details, d.delay_reason, d.payment_terms, d.notes, d.reseller, d.amount_usd, d.currency, d.amount_orig,
    d.smd_sales_usd, d.is_internal, d.source, d.created_at, d.created_by, d.updated_at, d.updated_by, d.ship_month,
    c.name AS customer_name,
    COALESCE(( SELECT jsonb_object_agg(i.product_code, i.qty) AS jsonb_object_agg FROM deal_items i WHERE (i.deal_id = d.id)), '{}'::jsonb) AS items,
    d.other_note, d.fx_rate, d.fx_date, d.fx_source
   FROM (deals d JOIN customers c ON ((c.id = d.customer_id)));

-- kur verildiyse USD tutarı sunucuda da orijinal × kur; USD siparişte kur alanları boş
create or replace function public.save_deal(p_deal jsonb, p_items jsonb, p_customer_name text DEFAULT NULL::text, p_customer_country text DEFAULT NULL::text)
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
      details, delay_reason, payment_terms, notes, reseller, amount_usd, currency, amount_orig, smd_sales_usd, is_internal, other_note,
      fx_rate, fx_date, fx_source)
    select nullif(d.order_no,''), nullif(d.opp_no,''), v_cust, nullif(d.country,''), d.description, d.stage, d.status, nullif(d.quote_no,''),
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
      description = d.description, stage = d.stage, status = d.status, quote_no = nullif(d.quote_no,''),
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

-- ödeme planı toplamı artık her siparişte USD tutar
create or replace function public.save_deal_payments(p_deal bigint, p_rows jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb; v_ids bigint[]; v_tot numeric; v_n int; v_namt int; v_pct numeric; v_sum numeric; v_diff numeric;
begin
  if not has_role(array['sales','orders','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
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

create or replace function public.deal_payment_report()
 returns table(id bigint, deal_id bigint, ref_no text, customer text, description text, status text, is_internal boolean,
               currency text, deal_total numeric, pct numeric, amount numeric, due_date date, note text,
               received_at date, received_name text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin','muhasebe']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  return query
  select p.id, p.deal_id, coalesce(d.order_no, d.opp_no), c.name, d.description, d.status, d.is_internal,
         'USD'::text, d.amount_usd, p.pct, coalesce(p.amount, round(d.amount_usd * p.pct / 100, 2)), p.due_date, p.note, p.received_at, p.received_name
  from public.deal_payments p
  join public.deals d on d.id = p.deal_id
  join public.customers c on c.id = d.customer_id
  order by p.due_date, p.deal_id, p.seq;
end $function$;
