-- Üretim tedarik planı (7 Kasım 2026 gece hazırlığı; Serhan onaylayınca Supabase'e uygulanacak)
-- Akış: ürün adetleri (üretimdeki siparişlerden) → BOM × adet = ihtiyaç → stok düşülür = net eksik
--       → sipariş katı / minimum sipariş ile yuvarlanır → tedarikçiye göre "alım paketleri" → USD toplam
--       → yöneticiye + muhasebeye gönder → yönetici onaylar → alım talepleri (paket adıyla) oluşur.

-- 1) Parça kartına toplu alım bilgileri
alter table public.stock_items add column if not exists order_multiple numeric check (order_multiple is null or order_multiple > 0);
alter table public.stock_items add column if not exists min_order numeric check (min_order is null or min_order >= 0);
alter table public.stock_items add column if not exists lead_days int check (lead_days is null or lead_days >= 0);
comment on column public.stock_items.order_multiple is 'Sipariş katı: alım bu sayının katına yuvarlanır (ör. 20''li paket)';
comment on column public.stock_items.min_order is 'Tedarikçinin minimum sipariş adedi';
comment on column public.stock_items.lead_days is 'Teslim süresi (gün), ör. Çin 35';

-- 2) Planlar ve satırları
create table if not exists public.supply_plans (
  id bigint generated always as identity primary key,
  name text not null,
  status text not null default 'taslak' check (status in ('taslak','gonderildi','onaylandi','alimlar','iptal')),
  products jsonb not null default '{}',      -- {"STEWART": 8, ...} plandaki ürün adetleri
  alt_pick jsonb not null default '{}',      -- {"<bom_id>|<alternatif grup>": item_id}
  fill_min boolean not null default false,   -- minimum stok seviyesini de tamamla
  fx_usd numeric,                            -- 1 USD = ? TL
  fx_eur numeric,                            -- 1 EUR = ? TL
  total_usd numeric,
  note text,
  review_note text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_by_name text,
  approved_at timestamptz
);
create table if not exists public.supply_plan_lines (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.supply_plans(id) on delete cascade,
  k text not null,                           -- i<stok id> / p<pcb id> / n<ad>
  item_id bigint references public.stock_items(id) on delete set null,
  pcb_board_id bigint,
  name text not null,
  section text,
  products text,
  alt_group text,
  need numeric not null default 0,
  stock numeric not null default 0,
  net numeric not null default 0,
  order_qty numeric not null default 0,
  unit_price numeric,
  currency text,
  supplier_id bigint references public.suppliers(id) on delete set null,
  supplier_text text,
  package text not null default 'Tedarikçi belirsiz',
  lead_days int,
  note text,
  purchase_id bigint,
  unique (plan_id, k)
);
create index if not exists supply_plan_lines_plan_idx on public.supply_plan_lines(plan_id);
create index if not exists supply_plan_lines_item_idx on public.supply_plan_lines(item_id);
create index if not exists supply_plan_lines_supplier_idx on public.supply_plan_lines(supplier_id);
create index if not exists supply_plans_created_by_idx on public.supply_plans(created_by);
create index if not exists supply_plans_approved_by_idx on public.supply_plans(approved_by);

alter table public.purchases add column if not exists plan_id bigint references public.supply_plans(id) on delete set null;
alter table public.purchases add column if not exists package text;
create index if not exists purchases_plan_idx on public.purchases(plan_id);
alter table public.supply_plan_lines add constraint supply_plan_lines_purchase_fk foreign key (purchase_id) references public.purchases(id) on delete set null;

alter table public.supply_plans enable row level security;
alter table public.supply_plan_lines enable row level security;
create policy supply_plans_read on public.supply_plans for select to authenticated
  using ((select public.has_role(array['admin','muhasebe','purchasing','production','stock','orders'])));
create policy supply_plan_lines_read on public.supply_plan_lines for select to authenticated
  using ((select public.has_role(array['admin','muhasebe','purchasing','production','stock','orders'])));
revoke all on public.supply_plans, public.supply_plan_lines from anon;
revoke insert, update, delete, truncate on public.supply_plans, public.supply_plan_lines from authenticated;

-- planı hazırlayabilenler
create or replace function public.can_plan() returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.has_role(array['admin','production','purchasing','stock','orders']) $$;

-- 3) Hesap: ürün adetlerinden malzeme ihtiyacı (salt okuma; plan kaydetmez)
--    Alternatif grupta (ör. aktüatör boyları) tek satır seçilir: p_alt'taki seçim, yoksa listedeki ilk satır.
create or replace function public.supply_plan_calc(p_products jsonb, p_alt jsonb default '{}', p_fillmin boolean default false)
returns jsonb language sql stable security invoker set search_path = 'public' as $$
with prod as (select key code, value::numeric units from jsonb_each_text(coalesce(p_products, '{}')) where value ~ '^[0-9]+(\.[0-9]+)?$' and value::numeric > 0),
pb as (select b.id bom_id, p.code, p.units from prod p join boms b on b.kind = 'product' and b.product_code = p.code and coalesce(b.status, 'aktif') = 'aktif'),
ln as (select l.*, pb.units, pb.code from bom_lines l join pb using (bom_id)),
alt as (select ln.id, ln.bom_id, ln.alt_group, row_number() over (partition by ln.bom_id, ln.alt_group order by
          (ln.item_id is not distinct from nullif(coalesce(p_alt, '{}') ->> (ln.bom_id || '|' || ln.alt_group), '')::bigint) desc, ln.sort nulls last, ln.id) rn
        from ln where ln.alt_group is not null),
chosen as (select * from ln where alt_group is null or id in (select id from alt where rn = 1)),
nd as (select coalesce('i' || item_id, 'p' || pcb_board_id, 'n' || lower(trim(item_name))) k, item_id, pcb_board_id,
          max(item_name) item_name, sum(qty_per * units) need, max(section) section, max(unit_price) bom_price,
          string_agg(distinct code, ',' order by code) products, max(alt_group) alt_group, max(bom_id) bom_id, count(*) nlines
        from chosen group by 1, 2, 3),
res as (
  select nd.*, s.min_qty, s.order_multiple, s.min_order, s.lead_days, s.supplier_id,
    coalesce(s.name, case when pc.id is not null then pc.pcb || coalesce(' ' || pc.version, '') end, nd.item_name, '(adsız)') name,
    coalesce(s.qty, pc.working, 0) stock,
    coalesce(nullif(s.unit_price, 0), pc.cost_usd, nd.bom_price) price,
    case when nullif(s.unit_price, 0) is not null then coalesce(s.currency, 'TRY') when pc.cost_usd is not null then 'USD' when nd.bom_price is not null then 'TRY' end cur,
    case when pc.id is not null then 'PCB dizgi' else coalesce(su.name, nullif(trim(s.supplier_text), ''), 'Tedarikçi belirsiz') end package,
    coalesce(su.name, s.supplier_text) supplier_text
  from nd left join stock_items s on s.id = nd.item_id left join pcb_boards pc on pc.id = nd.pcb_board_id left join suppliers su on su.id = s.supplier_id),
fin as (
  select res.*, greatest(need + case when p_fillmin then coalesce(min_qty, 0) else 0 end - stock, 0) net from res)
select coalesce(jsonb_agg(jsonb_build_object(
    'k', k, 'item_id', item_id, 'pcb_board_id', pcb_board_id, 'name', name, 'section', section, 'products', products,
    'alt_group', alt_group, 'bom_id', bom_id, 'nlines', nlines, 'need', need, 'stock', stock, 'min_qty', min_qty, 'net', net,
    'order_qty', case when net <= 0 then 0 else
        ceil(greatest(net, coalesce(min_order, 0)) / coalesce(nullif(order_multiple, 0), 1)) * coalesce(nullif(order_multiple, 0), 1) end,
    'order_multiple', order_multiple, 'min_order', min_order, 'lead_days', lead_days,
    'unit_price', price, 'currency', cur, 'supplier_id', supplier_id, 'supplier_text', supplier_text, 'package', package,
    'alts', case when alt_group is not null then (select jsonb_agg(jsonb_build_object('item_id', l2.item_id, 'name', s2.name, 'stock', s2.qty) order by l2.sort nulls last, l2.id)
                 from bom_lines l2 join stock_items s2 on s2.id = l2.item_id where l2.bom_id = fin.bom_id and l2.alt_group = fin.alt_group) end
  ) order by package, section, name), '[]'::jsonb)
from fin $$;

-- 4) Kaydet (yalnız taslak). p = {id?, name, products, alt_pick, fill_min, fx_usd, fx_eur, total_usd, note, lines:[...]}
create or replace function public.supply_plan_save(p jsonb) returns bigint
language plpgsql security definer set search_path = 'public' as $$
declare pid bigint := nullif(p->>'id', '')::bigint; st text; who text; l jsonb;
begin
  if not public.can_plan() then raise exception 'Bu işlem için yetkiniz yok'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Plan adı girin'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  if pid is null then
    insert into public.supply_plans(name, products, alt_pick, fill_min, fx_usd, fx_eur, total_usd, note, created_by_name)
    values (left(trim(p->>'name'), 200), coalesce(p->'products', '{}'), coalesce(p->'alt_pick', '{}'), coalesce((p->>'fill_min')::boolean, false),
            nullif(p->>'fx_usd', '')::numeric, nullif(p->>'fx_eur', '')::numeric, nullif(p->>'total_usd', '')::numeric, nullif(trim(p->>'note'), ''), who)
    returning id into pid;
  else
    select status into st from public.supply_plans where id = pid for update;
    if st is null then raise exception 'Plan bulunamadı'; end if;
    if st <> 'taslak' then raise exception 'Yalnız taslak plan değiştirilebilir'; end if;
    update public.supply_plans set name = left(trim(p->>'name'), 200), products = coalesce(p->'products', '{}'), alt_pick = coalesce(p->'alt_pick', '{}'),
      fill_min = coalesce((p->>'fill_min')::boolean, false), fx_usd = nullif(p->>'fx_usd', '')::numeric, fx_eur = nullif(p->>'fx_eur', '')::numeric,
      total_usd = nullif(p->>'total_usd', '')::numeric, note = nullif(trim(p->>'note'), ''), updated_at = now()
    where id = pid;
    delete from public.supply_plan_lines where plan_id = pid;
  end if;
  for l in select value from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    insert into public.supply_plan_lines(plan_id, k, item_id, pcb_board_id, name, section, products, alt_group, need, stock, net, order_qty,
      unit_price, currency, supplier_id, supplier_text, package, lead_days, note)
    values (pid, l->>'k', nullif(l->>'item_id', '')::bigint, nullif(l->>'pcb_board_id', '')::bigint, left(coalesce(l->>'name', '(adsız)'), 200), l->>'section', l->>'products', l->>'alt_group',
      coalesce(nullif(l->>'need', '')::numeric, 0), coalesce(nullif(l->>'stock', '')::numeric, 0), coalesce(nullif(l->>'net', '')::numeric, 0),
      greatest(coalesce(nullif(l->>'order_qty', '')::numeric, 0), 0), nullif(l->>'unit_price', '')::numeric, nullif(l->>'currency', ''),
      nullif(l->>'supplier_id', '')::bigint, l->>'supplier_text', left(coalesce(nullif(trim(l->>'package'), ''), 'Tedarikçi belirsiz'), 120),
      nullif(l->>'lead_days', '')::int, nullif(trim(l->>'note'), ''));
  end loop;
  return pid;
end $$;

-- 5) Durum: gönder (taslak → gönderildi), onayla / geri gönder (yönetici), iptal
create or replace function public.supply_plan_set_status(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = 'public' as $$
declare pl public.supply_plans; who text;
begin
  select * into pl from public.supply_plans where id = p_id for update;
  if not found then raise exception 'Plan bulunamadı'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  if p_status = 'gonderildi' then
    if not public.can_plan() then raise exception 'Bu işlem için yetkiniz yok'; end if;
    if pl.status <> 'taslak' then raise exception 'Yalnız taslak plan gönderilebilir'; end if;
    if not exists (select 1 from public.supply_plan_lines where plan_id = p_id and order_qty > 0) then raise exception 'Planda alınacak kalem yok'; end if;
    update public.supply_plans set status = 'gonderildi', sent_at = now(), review_note = null, updated_at = now() where id = p_id;
    insert into public.support_notifications(user_id, kind, title, link)
    select id, 'plan', 'Onay bekleyen tedarik planı: ' || left(pl.name, 80) || coalesce(' · ' || round(pl.total_usd)::text || ' $', '') || ' (' || coalesce(who, '') || ')', '#/tedarik/' || p_id
    from public.profiles where roles && array['admin','muhasebe'] and id is distinct from auth.uid();
  elsif p_status in ('onaylandi', 'taslak') then
    if not public.has_role(array['admin']) then raise exception 'Planı yalnız yönetici onaylar veya geri gönderir'; end if;
    if pl.status <> 'gonderildi' then raise exception 'Yalnız gönderilmiş plan onaylanır veya geri gönderilir'; end if;
    if p_status = 'taslak' and coalesce(trim(p_note), '') = '' then raise exception 'Geri gönderme nedenini yazın'; end if;
    update public.supply_plans set status = p_status, review_note = nullif(trim(p_note), ''),
      approved_by = case when p_status = 'onaylandi' then auth.uid() end, approved_by_name = case when p_status = 'onaylandi' then who end,
      approved_at = case when p_status = 'onaylandi' then now() end, updated_at = now() where id = p_id;
    insert into public.support_notifications(user_id, kind, title, link)
    select u, 'plan', 'Tedarik planı ' || case p_status when 'onaylandi' then 'onaylandı' else 'düzeltme için geri gönderildi' end || ': ' || left(pl.name, 80), '#/tedarik/' || p_id
    from (select pl.created_by u union select id from public.profiles where p_status = 'onaylandi' and 'purchasing' = any(roles)) x
    where u is not null and u is distinct from auth.uid();
  elsif p_status = 'iptal' then
    if not (public.has_role(array['admin']) or (pl.created_by = auth.uid() and pl.status = 'taslak')) then raise exception 'Bu işlem için yetkiniz yok'; end if;
    if pl.status = 'alimlar' then raise exception 'Alım talepleri oluşmuş plan iptal edilemez'; end if;
    update public.supply_plans set status = 'iptal', review_note = coalesce(nullif(trim(p_note), ''), review_note), updated_at = now() where id = p_id;
  else
    raise exception 'Geçersiz durum';
  end if;
end $$;

-- 6) Onaylı plandan alım talepleri: her kalem için bir talep; paket adı ve plan bağlantısıyla
create or replace function public.supply_plan_create_purchases(p_id bigint) returns int
language plpgsql security definer set search_path = 'public' as $$
declare pl public.supply_plans; who text; n int := 0; l public.supply_plan_lines; pid bigint;
begin
  if not public.has_role(array['admin','purchasing']) then raise exception 'Alım taleplerini Satın alma veya yönetici oluşturur'; end if;
  select * into pl from public.supply_plans where id = p_id for update;
  if not found then raise exception 'Plan bulunamadı'; end if;
  if pl.status <> 'onaylandi' then raise exception 'Önce plan onaylanmalı'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  for l in select * from public.supply_plan_lines where plan_id = p_id and order_qty > 0 and purchase_id is null order by package, name loop
    insert into public.purchases(kind, unit, area, requested_at, requester_name, requester, urgency, status, project, item_name, item_id, qty, unit_price, total,
      currency, supplier_id, supplier_text, source, plan_id, package, note)
    values ('alim', case when l.section = 'mekanik' then 'Mekanik' else 'Elektronik' end, 'Üretim', (now() at time zone 'Europe/Istanbul')::date, who, auth.uid(), 'normal', 'talep',
      left(pl.name, 120), l.name, l.item_id, l.order_qty, l.unit_price, case when l.unit_price is not null then round(l.order_qty * l.unit_price, 2) end,
      coalesce(l.currency, 'TRY'), l.supplier_id, l.supplier_text, 'Tedarik planı #' || p_id, p_id, l.package,
      'İhtiyaç ' || l.need || ', stok ' || l.stock || coalesce(', ürünler: ' || l.products, '') || coalesce(' · ' || l.note, ''))
    returning id into pid;
    update public.supply_plan_lines set purchase_id = pid where id = l.id;
    n := n + 1;
  end loop;
  update public.supply_plans set status = 'alimlar', updated_at = now() where id = p_id;
  insert into public.support_notifications(user_id, kind, title, link)
  select id, 'plan', n || ' alım talebi oluştu: ' || left(pl.name, 80), '#/alimlar?plan=' || p_id
  from public.profiles where 'purchasing' = any(roles) and id is distinct from auth.uid();
  return n;
end $$;

revoke all on function public.can_plan(), public.supply_plan_calc(jsonb, jsonb, boolean), public.supply_plan_save(jsonb),
  public.supply_plan_set_status(bigint, text, text), public.supply_plan_create_purchases(bigint) from public, anon;
grant execute on function public.can_plan(), public.supply_plan_calc(jsonb, jsonb, boolean), public.supply_plan_save(jsonb),
  public.supply_plan_set_status(bigint, text, text), public.supply_plan_create_purchases(bigint) to authenticated;

-- 7) Plan bildirimleri e-posta kuyruğuna girmesin (yalnız site içi)
create or replace function public.notif_no_email_trg() returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.kind in ('masraf','asama','alim','plan') then new.emailed_at := coalesce(new.emailed_at, now()); new.pushed_at := coalesce(new.pushed_at, now()); end if;
  return new;
end $$;
