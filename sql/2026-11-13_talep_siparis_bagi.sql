-- Alım talebi ↔ sipariş bağı (çoka çok). Adet siparişlere bölünmez; yalnız "ilgili siparişler" listesi.
-- Tek doğruluk kaynağı purchase_deals. purchases.deal_id eski giriş olarak kalır: eski istemci ya da BOM eksiği
-- akışı yazarsa tetikleyici bağ olarak ekler; bağ silinince eşleşen deal_id boşaltılır (deal_id hep bağlardan biri).

create table if not exists public.purchase_deals (
  purchase_id bigint not null references public.purchases(id) on delete cascade,
  deal_id bigint not null references public.deals(id) on delete cascade,
  note text check (length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (purchase_id, deal_id)
);
-- siparişten taleplere hızlı erişim (ileride üretim için gereken alımlar hesabı)
create index if not exists purchase_deals_deal_idx on public.purchase_deals(deal_id, purchase_id);
comment on column public.purchases.deal_id is 'Eski tekli bağ; yazılırsa purchase_deals''e eklenir. Okuma purchase_deals''ten.';

-- bağları talebi düzenleyebilen yazar (purchases_upd ile aynı kural)
create or replace function public.purchase_can_edit(p_purchase bigint)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.purchases p where p.id = p_purchase
    and (public.can_purchase() or (p.created_by = auth.uid() and p.status = 'talep'))) $function$;

alter table public.purchase_deals enable row level security;
drop policy if exists purchase_deals_read on public.purchase_deals;
drop policy if exists purchase_deals_ins on public.purchase_deals;
drop policy if exists purchase_deals_upd on public.purchase_deals;
drop policy if exists purchase_deals_del on public.purchase_deals;
create policy purchase_deals_read on public.purchase_deals for select using ((select public.can_read_app()));
create policy purchase_deals_ins on public.purchase_deals for insert with check (public.purchase_can_edit(purchase_id) and (select public.has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin']))); -- yeni bağ: siparişleri okuyabilen (muhasebe bağ kurup purchase_deal_info ile sipariş okuyamasın)
create policy purchase_deals_upd on public.purchase_deals for update using (public.purchase_can_edit(purchase_id)) with check (public.purchase_can_edit(purchase_id));
create policy purchase_deals_del on public.purchase_deals for delete using (public.purchase_can_edit(purchase_id));

insert into public.purchase_deals(purchase_id, deal_id, created_by, created_at)
select id, deal_id, created_by, created_at from public.purchases where deal_id is not null
on conflict do nothing;

-- satır purchases RLS'sinden geçtikten sonra çalışır; definer yalnız bağ eklemek için
create or replace function public.purchase_deal_legacy_trg()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.deal_id is not null and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id) and public.has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin']) then
    insert into public.purchase_deals(purchase_id, deal_id) values (new.id, new.deal_id) on conflict do nothing;
  end if;
  return null;
end $function$;
drop trigger if exists purchase_deal_legacy_aiu on public.purchases;
create trigger purchase_deal_legacy_aiu after insert or update of deal_id on public.purchases
  for each row execute function public.purchase_deal_legacy_trg();

create or replace function public.purchase_deal_unlink_trg()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  update public.purchases set deal_id = null where id = old.purchase_id and deal_id = old.deal_id;
  return null;
end $function$;
drop trigger if exists purchase_deal_unlink_ad on public.purchase_deals;
create trigger purchase_deal_unlink_ad after delete on public.purchase_deals
  for each row execute function public.purchase_deal_unlink_trg();

-- formdan tüm listeyi bir kerede yaz: listede olmayan bağ silinir, gelenler eklenir / not güncellenir
create or replace function public.purchase_deals_set(p_purchase bigint, p_rows jsonb)
 returns void language plpgsql set search_path to 'public' as $function$
declare v_ids bigint[];
begin
  if not public.purchase_can_edit(p_purchase) then raise exception 'Bu talebin bağlı siparişlerini değiştirme yetkiniz yok'; end if;
  p_rows := coalesce(p_rows, '[]'::jsonb);
  select array_agg((x->>'deal_id')::bigint) into v_ids from jsonb_array_elements(p_rows) x where nullif(x->>'deal_id', '') is not null;
  if v_ids is not null and cardinality(v_ids) <> (select count(distinct u) from unnest(v_ids) u) then raise exception 'Aynı sipariş iki kez seçilmiş'; end if;
  delete from public.purchase_deals where purchase_id = p_purchase and (v_ids is null or deal_id <> all(v_ids));
  -- mevcut bağın notu update ile (ekleme kuralı sipariş okuma rolü ister; muhasebe var olan bağın notunu yazabilsin)
  update public.purchase_deals l set note = v.note
  from (select (x->>'deal_id')::bigint as deal_id, left(nullif(trim(x->>'note'), ''), 200) as note from jsonb_array_elements(p_rows) x where nullif(x->>'deal_id', '') is not null) v
  where l.purchase_id = p_purchase and l.deal_id = v.deal_id and l.note is distinct from v.note;
  insert into public.purchase_deals(purchase_id, deal_id, note)
  select p_purchase, (x->>'deal_id')::bigint, left(nullif(trim(x->>'note'), ''), 200) from jsonb_array_elements(p_rows) x
  where nullif(x->>'deal_id', '') is not null and not exists (select 1 from public.purchase_deals l where l.purchase_id = p_purchase and l.deal_id = (x->>'deal_id')::bigint);
end $function$;

-- bağlı siparişlerin ayrıntısı; muhasebe siparişleri okuyamaz, bu yüzden tutar içermeyen alanlar buradan gelir.
-- p_purchase boşsa tüm bağlar (talep listesi için)
create or replace function public.purchase_deal_info(p_purchase bigint default null)
 returns table(purchase_id bigint, deal_id bigint, note text, ref_no text, customer text, country text, description text, status text,
               planned_ship_date date, requested_ship_date date, ship_date date, ship_month text, items jsonb)
 language plpgsql stable security definer set search_path to 'public' as $function$
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
  where p_purchase is null or l.purchase_id = p_purchase
  order by l.purchase_id, l.created_at, l.deal_id;
end $function$;

revoke all on function public.purchase_can_edit(bigint) from public, anon;
revoke all on function public.purchase_deals_set(bigint, jsonb) from public, anon;
revoke all on function public.purchase_deal_info(bigint) from public, anon;
grant execute on function public.purchase_can_edit(bigint) to authenticated;
grant execute on function public.purchase_deals_set(bigint, jsonb) to authenticated;
grant execute on function public.purchase_deal_info(bigint) to authenticated;
