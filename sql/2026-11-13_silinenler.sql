-- Silinenler: sipariş / fırsat önce işaretlenir (deleted_at), kalıcı silme yalnız Silinenler'den.
-- Silinenleri yalnız satış ve yönetici görür, taşır, geri alır, kalıcı siler.

alter table public.deals add column if not exists deleted_at timestamptz;
alter table public.deals add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create or replace view public.v_deals with (security_invoker = true) as
 SELECT d.id, d.order_no, d.opp_no, d.customer_id, d.country, d.description, d.stage, d.status, d.quote_no,
    d.lead_date, d.order_date, d.expected_po_date, d.requested_ship_date, d.planned_ship_date, d.ship_date,
    d.details, d.delay_reason, d.payment_terms, d.notes, d.reseller, d.amount_usd, d.currency, d.amount_orig,
    d.smd_sales_usd, d.is_internal, d.source, d.created_at, d.created_by, d.updated_at, d.updated_by, d.ship_month,
    c.name AS customer_name,
    COALESCE(( SELECT jsonb_object_agg(i.product_code, i.qty) FROM deal_items i WHERE i.deal_id = d.id), '{}'::jsonb) AS items,
    d.other_note, d.fx_rate, d.fx_date, d.fx_source,
    d.deleted_at, d.deleted_by
   FROM deals d JOIN customers c ON c.id = d.customer_id;

drop policy if exists read_all on public.deals;
create policy read_all on public.deals for select using (
  has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])
  and (deleted_at is null or has_role(array['sales','admin'])));

drop policy if exists deals_del on public.deals;
create policy deals_del on public.deals for delete using (has_role(array['sales','admin']) and deleted_at is not null);

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
    if new.status in ('production','shipped') and new.order_date is null then
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

-- SECURITY DEFINER fonksiyonlar RLS'i atlıyor: silinmişleri dışla
CREATE OR REPLACE FUNCTION public.deal_payment_report()
 RETURNS TABLE(id bigint, deal_id bigint, ref_no text, customer text, description text, status text, is_internal boolean, currency text, deal_total numeric, pct numeric, amount numeric, due_date date, note text, received_at date, received_name text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin','muhasebe']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  return query
  select p.id, p.deal_id, coalesce(d.order_no, d.opp_no), c.name, d.description, d.status, d.is_internal,
         'USD'::text, d.amount_usd, p.pct, coalesce(p.amount, round(d.amount_usd * p.pct / 100, 2)), p.due_date, p.note, p.received_at, p.received_name
  from public.deal_payments p
  join public.deals d on d.id = p.deal_id
  join public.customers c on c.id = d.customer_id
  where d.deleted_at is null
  order by p.due_date, p.deal_id, p.seq;
end $function$;

CREATE OR REPLACE FUNCTION public.purchase_deal_info(p_purchase bigint DEFAULT NULL::bigint)
 RETURNS TABLE(purchase_id bigint, deal_id bigint, note text, ref_no text, customer text, country text, description text, status text, planned_ship_date date, requested_ship_date date, ship_date date, ship_month text, items jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not public.can_read_app() then raise exception 'Bu işlem için yetkiniz yok'; end if;
  return query
  select l.purchase_id, l.deal_id, l.note, coalesce(d.order_no, d.opp_no), c.name, coalesce(k.name, d.country::text), d.description, d.status,
         d.planned_ship_date, d.requested_ship_date, d.ship_date, d.ship_month,
         coalesce((select jsonb_agg(jsonb_build_object('code', i.product_code, 'name', coalesce(pr.name, i.product_code), 'qty', i.qty) order by pr.sort, i.product_code)
                   from public.deal_items i left join public.products pr on pr.code = i.product_code where i.deal_id = d.id), '[]'::jsonb)
  from public.purchase_deals l
  join public.deals d on d.id = l.deal_id
  left join public.customers c on c.id = d.customer_id
  left join public.countries k on k.code = d.country
  where (p_purchase is null or l.purchase_id = p_purchase) and d.deleted_at is null
  order by l.purchase_id, l.created_at, l.deal_id;
end $function$;

CREATE OR REPLACE FUNCTION public.checklist_add(p_deal bigint, p_product text, p_template bigint)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare d public.deals; t public.checklist_templates; prod text; cid bigint;
begin
  if not public.cl_write() then raise exception 'Checklist''i yalnız üretim ya da yönetici açabilir'; end if;
  select * into d from public.deals where id = p_deal and deleted_at is null;
  if not found then raise exception 'Sipariş bulunamadı'; end if;
  if p_template is not null then select * into t from public.checklist_templates where id = p_template;
    if not found then raise exception 'Şablon bulunamadı'; end if; end if;
  prod := coalesce(nullif(p_product, ''), t.product_code);
  if prod is not null and not exists (select 1 from public.products where code = prod) then raise exception 'Ürün bulunamadı'; end if;
  insert into public.checklists(deal_id, product_code, template_id, title, serial_no, edited_at, updated_by_name)
  values (p_deal, prod, t.id, coalesce(t.name, (select name from public.products where code = prod), 'Checklist'),
          public._cl_serial(d.order_no, d.id, t.serial_code, null, false), now(),
          (select coalesce(full_name, email) from public.profiles where id = auth.uid()))
  returning id into cid;
  if t.id is not null then perform public._cl_copy(cid, t.id); end if;
  return cid;
end $function$;
