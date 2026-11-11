-- Siparişte ödeme planı: satır satır oran (%) + vade tarihi; tahsilat takibi raporu.
-- Tutar saklanmaz, siparişin toplamından hesaplanır (toplam değişirse plan kendiliğinden uyar).

create table if not exists public.deal_payments (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals(id) on delete cascade,
  seq int not null default 1,
  pct numeric(6,2) not null check (pct > 0 and pct <= 100),
  due_date date not null check (due_date between '2020-01-01' and '2035-12-31'),
  note text check (length(note) <= 200),
  received_at date check (received_at between '2020-01-01' and '2035-12-31'),
  received_by uuid references auth.users(id),
  received_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deal_payments_deal_idx on public.deal_payments(deal_id);
create index if not exists deal_payments_due_idx on public.deal_payments(due_date);
alter table public.deal_payments enable row level security;
-- okuma siparişlerle aynı roller; yazma yalnız aşağıdaki fonksiyonlarla
create policy deal_payments_read on public.deal_payments for select
  using ((select has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])));
create trigger audit_deal_payments after insert or update or delete on public.deal_payments for each row execute function public.audit_trg();

-- planı kaydet: tahsil edilmiş satırlar korunur, diğerleri gelen listeyle değiştirilir; toplam %100 olmalı
create or replace function public.save_deal_payments(p_deal bigint, p_rows jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb; v_ids bigint[]; v_sum numeric;
begin
  if not has_role(array['sales','orders','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  if not exists (select 1 from public.deals where id = p_deal) then raise exception 'Kayıt bulunamadı'; end if;
  p_rows := coalesce(p_rows, '[]'::jsonb);
  select array_agg((x->>'id')::bigint) into v_ids from jsonb_array_elements(p_rows) x where nullif(x->>'id', '') is not null;
  delete from public.deal_payments where deal_id = p_deal and received_at is null and (v_ids is null or id <> all(v_ids));
  for r in select * from jsonb_array_elements(p_rows) loop
    if nullif(r->>'id', '') is not null then
      update public.deal_payments set seq = (r->>'seq')::int, pct = (r->>'pct')::numeric, due_date = (r->>'due_date')::date,
        note = nullif(trim(r->>'note'), ''), updated_at = now()
      where id = (r->>'id')::bigint and deal_id = p_deal and received_at is null;
    else
      insert into public.deal_payments(deal_id, seq, pct, due_date, note)
      values (p_deal, (r->>'seq')::int, (r->>'pct')::numeric, (r->>'due_date')::date, nullif(trim(r->>'note'), ''));
    end if;
  end loop;
  select sum(pct) into v_sum from public.deal_payments where deal_id = p_deal;
  if v_sum is not null and abs(v_sum - 100) > 0.01 then
    raise exception 'Ödeme planı oranlarının toplamı %%100 olmalı (şu an %%%)', round(v_sum, 2);
  end if;
end $function$;

-- tahsil edildi / geri al (p_date null)
create or replace function public.deal_payment_mark(p_id bigint, p_date date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not has_role(array['sales','orders','muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  update public.deal_payments set received_at = p_date,
    received_by = case when p_date is null then null else auth.uid() end,
    received_name = case when p_date is null then null else (select coalesce(full_name, email) from public.profiles where id = auth.uid()) end,
    updated_at = now()
  where id = p_id;
  if not found then raise exception 'Ödeme satırı bulunamadı'; end if;
end $function$;

-- rapor: muhasebe siparişleri okuyamaz; yalnız tahsilat için gereken alanlar buradan gelir
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
         d.currency::text, t.total, p.pct, round(t.total * p.pct / 100, 2), p.due_date, p.note, p.received_at, p.received_name
  from public.deal_payments p
  join public.deals d on d.id = p.deal_id
  join public.customers c on c.id = d.customer_id
  cross join lateral (select case when d.currency = 'USD' then d.amount_usd else d.amount_orig end as total) t
  order by p.due_date, p.deal_id, p.seq;
end $function$;

revoke all on function public.save_deal_payments(bigint, jsonb) from public, anon;
revoke all on function public.deal_payment_mark(bigint, date) from public, anon;
revoke all on function public.deal_payment_report() from public, anon;
grant execute on function public.save_deal_payments(bigint, jsonb) to authenticated;
grant execute on function public.deal_payment_mark(bigint, date) to authenticated;
grant execute on function public.deal_payment_report() to authenticated;
