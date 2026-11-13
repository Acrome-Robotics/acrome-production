-- Ödeme planında oran YA DA tutar (İş 3). Satırda yalnız kullanıcının yazdığı alan saklanır.
-- Kontrol: satırların toplam tutarı (yazılan tutar, yoksa toplam × oran) sipariş tutarına eşit, 0,01 pay.
-- Sipariş tutarı sonradan değişirse plan kendiliğinden düzeltilmez; arayüz farkı gösterir, plan kaydında bu kontrol çalışır.

alter table public.deal_payments add column if not exists amount numeric(12,2);
alter table public.deal_payments alter column pct drop not null;
alter table public.deal_payments drop constraint if exists deal_payments_pct_check;
alter table public.deal_payments add constraint deal_payments_pct_check check (pct is null or (pct > 0 and pct <= 100));
alter table public.deal_payments add constraint deal_payments_amount_check check (amount is null or (amount > 0 and amount < 10000000));
alter table public.deal_payments add constraint deal_payments_pct_or_amount check ((pct is null) <> (amount is null));

create or replace function public.save_deal_payments(p_deal bigint, p_rows jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb; v_ids bigint[]; v_tot numeric; v_n int; v_namt int; v_pct numeric; v_sum numeric; v_diff numeric;
begin
  if not has_role(array['sales','orders','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  select case when currency = 'USD' then amount_usd else amount_orig end into v_tot from public.deals where id = p_deal;
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
    -- tutar yokken tutarla satır doğrulanamaz; yalnız oran
    if v_namt > 0 then raise exception 'Sipariş tutarı girilmeden ödeme planına tutar yazılamaz; oran kullanın'; end if;
    if abs(v_pct - 100) > 0.01 then raise exception 'Ödeme planı oranlarının toplamı %%100 olmalı (şu an %%%)', round(v_pct, 2); end if;
    return;
  end if;
  v_diff := round(v_sum - v_tot, 2);
  if abs(v_diff) > 0.01 then
    raise exception 'Ödeme planı toplamı sipariş tutarını tutmuyor: % %', abs(v_diff), case when v_diff < 0 then 'eksik' else 'fazla' end;
  end if;
end $function$;

-- tutar: yazılan tutar, yoksa toplam × oran (imza değişmedi; pct artık boş olabilir)
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
         d.currency::text, t.total, p.pct, coalesce(p.amount, round(t.total * p.pct / 100, 2)), p.due_date, p.note, p.received_at, p.received_name
  from public.deal_payments p
  join public.deals d on d.id = p.deal_id
  join public.customers c on c.id = d.customer_id
  cross join lateral (select case when d.currency = 'USD' then d.amount_usd else d.amount_orig end as total) t
  order by p.due_date, p.deal_id, p.seq;
end $function$;
