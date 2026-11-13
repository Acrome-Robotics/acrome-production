-- Checklist (müşteriye giden belge): ürün şablonları + sipariş başına, her ürün adedi için bir checklist.
-- Sipariş checklist'i şablonun KOPYASIDIR: şablon sonradan değişse de açılmış checklist değişmez.
-- Okuma: siparişi okuyabilen roller. Yazma: yalnız üretim + yönetici, yalnız aşağıdaki fonksiyonlarla.
-- Sıra: bu dosya → 2026-11-13b_checklist_tohum.sql (şablonlar + üretimdeki siparişlerin checklist'leri).

create or replace function public.cl_read() returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin']) $$;
create or replace function public.cl_write() returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.has_role(array['production','admin']) $$;
revoke all on function public.cl_read() from public, anon;
revoke all on function public.cl_write() from public, anon;
grant execute on function public.cl_read() to authenticated;
grant execute on function public.cl_write() to authenticated;

-- 1) Şablonlar ------------------------------------------------------------------------------------------
create table if not exists public.checklist_templates (
  id bigint generated always as identity primary key,
  product_code text references public.products(code) on update cascade on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  serial_code text check (serial_code ~ '^[0-9A-Za-z]{1,6}$'),  -- seri no eki (Excel lejantı: -01 BBT, -08 Stewart PRO…)
  is_default boolean not null default false,                      -- sipariş üretime girince bu şablondan açılır
  active boolean not null default true,
  note text check (length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create unique index if not exists checklist_templates_default_uq on public.checklist_templates(product_code) where is_default and active;

create table if not exists public.checklist_template_items (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.checklist_templates(id) on delete cascade,
  section text not null check (section in ('component','packaging','test','final')),
  grp text check (length(grp) <= 120),   -- son kontrol bölüm başlığı
  name text not null check (length(trim(name)) between 1 and 300),
  qty text check (length(qty) <= 20),    -- metin: Excel'de "1/1" (sensör/kutu) gibi adetler var
  sort int not null default 0
);
create index if not exists checklist_template_items_tpl_idx on public.checklist_template_items(template_id, section, sort);

-- 2) Sipariş checklist'leri ------------------------------------------------------------------------------
create table if not exists public.checklists (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals(id) on delete cascade,
  product_code text references public.products(code) on update cascade on delete set null,
  template_id bigint references public.checklist_templates(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 120),
  unit_no int check (unit_no between 1 and 500),   -- otomatik açılanda ürün içindeki sıra; elle eklenende boş
  serial_no text check (length(serial_no) <= 60),
  checked_by text check (length(checked_by) <= 120),
  check_date date,
  result text check (result in ('pass','fail','conditional')),
  edited_at timestamptz,                           -- ilk elle değişiklik; doluysa sipariş kalemi azalınca silinmez
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create unique index if not exists checklists_unit_uq on public.checklists(deal_id, product_code, unit_no) where unit_no is not null;
create index if not exists checklists_deal_idx on public.checklists(deal_id);
create index if not exists checklists_tpl_idx on public.checklists(template_id);

create table if not exists public.checklist_items (
  id bigint generated always as identity primary key,
  checklist_id bigint not null references public.checklists(id) on delete cascade,
  section text not null check (section in ('component','packaging','test','final')),
  grp text check (length(grp) <= 120),
  name text not null check (length(trim(name)) between 1 and 300),
  qty text check (length(qty) <= 20),
  ok boolean not null default false,   -- Acrome sütunu / test ve son kontrol durumu
  note text check (length(note) <= 500),
  sort int not null default 0
);
create index if not exists checklist_items_cl_idx on public.checklist_items(checklist_id, section, sort);

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
drop policy if exists checklist_templates_read on public.checklist_templates;
drop policy if exists checklist_template_items_read on public.checklist_template_items;
drop policy if exists checklists_read on public.checklists;
drop policy if exists checklist_items_read on public.checklist_items;
create policy checklist_templates_read on public.checklist_templates for select to authenticated using ((select public.cl_read()));
create policy checklist_template_items_read on public.checklist_template_items for select to authenticated using ((select public.cl_read()));
create policy checklists_read on public.checklists for select to authenticated using ((select public.cl_read()));
create policy checklist_items_read on public.checklist_items for select to authenticated using ((select public.cl_read()));
revoke all on public.checklist_templates, public.checklist_template_items, public.checklists, public.checklist_items from anon;
revoke insert, update, delete, truncate on public.checklist_templates, public.checklist_template_items, public.checklists, public.checklist_items from authenticated;

-- 3) Yardımcılar -----------------------------------------------------------------------------------------
-- seri no: ACRPO-544 + Pendulum (-07) → ACRPO544-07; aynı üründen birden çok adet varsa ACRPO544-07-2
create or replace function public._cl_serial(p_order text, p_deal bigint, p_code text, p_unit int, p_many boolean) returns text
language sql immutable set search_path = 'public' as $$
  select coalesce(regexp_replace(nullif(trim(p_order), ''), '^ACRPO-', 'ACRPO'), 'ACRPO#' || p_deal)
    || coalesce('-' || p_code, '') || case when p_many and p_unit is not null then '-' || p_unit else '' end $$;

create or replace function public._cl_copy(p_cl bigint, p_tpl bigint) returns void
language sql security definer set search_path = 'public' as $$
  insert into public.checklist_items(checklist_id, section, grp, name, qty, sort)
  select p_cl, section, grp, name, qty, sort from public.checklist_template_items where template_id = p_tpl order by section, sort, id $$;

-- Üretimdeki siparişin kalemlerine göre eksik checklist'leri açar; fazla ve el değmemiş olanları siler.
-- Elle değiştirilmiş (edited_at dolu) ya da elle eklenmiş (unit_no boş) checklist'e dokunmaz.
create or replace function public._checklist_sync(p_deal bigint) returns int
language plpgsql security definer set search_path = 'public' as $$
declare d public.deals; r record; k int; cid bigint; n int := 0;
begin
  select * into d from public.deals where id = p_deal for update;
  if not found or d.status <> 'production' then return 0; end if;
  delete from public.checklists c where c.deal_id = p_deal and c.unit_no is not null and c.edited_at is null
    and c.unit_no > coalesce((select floor(i.qty)::int from public.deal_items i where i.deal_id = p_deal and i.product_code = c.product_code), 0);
  for r in select i.product_code, least(floor(i.qty)::int, 500) q, t.id tid, t.name, t.serial_code
           from public.deal_items i join public.checklist_templates t on t.product_code = i.product_code and t.is_default and t.active
           where i.deal_id = p_deal and i.qty >= 1 loop
    for k in 1..r.q loop
      if not exists (select 1 from public.checklists where deal_id = p_deal and product_code = r.product_code and unit_no = k) then
        insert into public.checklists(deal_id, product_code, template_id, title, unit_no, serial_no)
        values (p_deal, r.product_code, r.tid, r.name, k, public._cl_serial(d.order_no, d.id, r.serial_code, k, r.q > 1)) returning id into cid;
        perform public._cl_copy(cid, r.tid);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public._cl_serial(text, bigint, text, int, boolean) from public, anon, authenticated;
revoke all on function public._cl_copy(bigint, bigint) from public, anon, authenticated;
revoke all on function public._checklist_sync(bigint) from public, anon, authenticated;

-- sipariş kalemi (save_deal hepsini silip yeniden yazar) ya da durum değişince: işlem sonunda bir kez bakılır
create or replace function public.checklist_sync_trg() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_table_name = 'deals' then perform public._checklist_sync(new.id);
  elsif tg_op = 'DELETE' then perform public._checklist_sync(old.deal_id);
  else perform public._checklist_sync(new.deal_id); end if;
  return null;
end $$;
revoke all on function public.checklist_sync_trg() from public, anon, authenticated;
drop trigger if exists checklist_sync_items on public.deal_items;
create constraint trigger checklist_sync_items after insert or update or delete on public.deal_items
  deferrable initially deferred for each row execute function public.checklist_sync_trg();
drop trigger if exists checklist_sync_deal on public.deals;
create constraint trigger checklist_sync_deal after update of status on public.deals
  deferrable initially deferred for each row when (new.status = 'production' and old.status is distinct from new.status)
  execute function public.checklist_sync_trg();

-- 4) Arayüz fonksiyonları ---------------------------------------------------------------------------------
create or replace function public.checklist_sync(p_deal bigint) returns int
language plpgsql security definer set search_path = 'public' as $$
begin
  if not public.cl_write() then raise exception 'Checklist''leri yalnız üretim ya da yönetici açabilir'; end if;
  return public._checklist_sync(p_deal);
end $$;

-- elle checklist: şablondan ya da boş (şablonu olmayan ürün, ek adet…)
create or replace function public.checklist_add(p_deal bigint, p_product text, p_template bigint) returns bigint
language plpgsql security definer set search_path = 'public' as $$
declare d public.deals; t public.checklist_templates; prod text; cid bigint;
begin
  if not public.cl_write() then raise exception 'Checklist''i yalnız üretim ya da yönetici açabilir'; end if;
  select * into d from public.deals where id = p_deal;
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
end $$;

-- doldurma ekranının tamamı tek seferde: başlık alanları + maddeler (satır ekle/çıkar şablonu etkilemez)
create or replace function public.checklist_save(p_id bigint, p_head jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not public.cl_write() then raise exception 'Checklist''i yalnız üretim ya da yönetici doldurabilir'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 300 then raise exception 'Geçersiz madde listesi'; end if;
  update public.checklists set
    title = coalesce(nullif(trim(p_head->>'title'), ''), title),
    serial_no = nullif(trim(p_head->>'serial_no'), ''),
    checked_by = nullif(trim(p_head->>'checked_by'), ''),
    check_date = nullif(p_head->>'check_date', '')::date,
    result = nullif(p_head->>'result', ''),
    edited_at = coalesce(edited_at, now()), updated_at = now(),
    updated_by_name = (select coalesce(full_name, email) from public.profiles where id = auth.uid())
  where id = p_id;
  if not found then raise exception 'Checklist bulunamadı'; end if;
  delete from public.checklist_items where checklist_id = p_id;
  insert into public.checklist_items(checklist_id, section, grp, name, qty, ok, note, sort)
  select p_id, x->>'section', nullif(trim(x->>'grp'), ''), trim(x->>'name'), nullif(trim(x->>'qty'), ''),
         coalesce((x->>'ok')::boolean, false), nullif(trim(x->>'note'), ''), o::int
  from jsonb_array_elements(p_items) with ordinality e(x, o) where coalesce(trim(x->>'name'), '') <> '';
end $$;

-- henüz el değmemiş checklist'in şablonunu değiştir (ör. Delta Robot'un ikinci şablonu)
create or replace function public.checklist_retemplate(p_id bigint, p_template bigint) returns void
language plpgsql security definer set search_path = 'public' as $$
declare c public.checklists; t public.checklist_templates;
begin
  if not public.cl_write() then raise exception 'Bu işlem için yetkiniz yok'; end if;
  select * into c from public.checklists where id = p_id for update;
  if not found then raise exception 'Checklist bulunamadı'; end if;
  if c.edited_at is not null then raise exception 'Doldurulmaya başlanmış checklist''in şablonu değiştirilemez; satırları elle düzenleyin'; end if;
  select * into t from public.checklist_templates where id = p_template;
  if not found then raise exception 'Şablon bulunamadı'; end if;
  delete from public.checklist_items where checklist_id = p_id;
  update public.checklists set template_id = t.id, title = t.name, updated_at = now() where id = p_id;
  perform public._cl_copy(p_id, t.id);
end $$;

-- elle eklenen ya da sipariş adedini aşan checklist silinebilir; adetten gelen checklist'i yalnız yönetici siler
create or replace function public.checklist_delete(p_id bigint) returns void
language plpgsql security definer set search_path = 'public' as $$
declare c public.checklists; q int;
begin
  if not public.cl_write() then raise exception 'Bu işlem için yetkiniz yok'; end if;
  select * into c from public.checklists where id = p_id;
  if not found then raise exception 'Checklist bulunamadı'; end if;
  q := coalesce((select floor(qty)::int from public.deal_items where deal_id = c.deal_id and product_code = c.product_code), 0);
  if not public.has_role(array['admin']) and c.unit_no is not null and c.unit_no <= q then
    raise exception 'Bu checklist sipariş adedinden geliyor; silmek için önce sipariş kalemini azaltın'; end if;
  delete from public.checklists where id = p_id;
end $$;

create or replace function public.checklist_template_save(p_id bigint, p_tpl jsonb, p_items jsonb) returns bigint
language plpgsql security definer set search_path = 'public' as $$
declare v bigint := p_id; prod text := nullif(p_tpl->>'product_code', '');
  dflt boolean := coalesce((p_tpl->>'is_default')::boolean, false); act boolean := coalesce((p_tpl->>'active')::boolean, true);
  who text := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
begin
  if not public.cl_write() then raise exception 'Şablonu yalnız üretim ya da yönetici değiştirebilir'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 300 then raise exception 'Geçersiz madde listesi'; end if;
  if prod is not null and not exists (select 1 from public.products where code = prod) then raise exception 'Ürün bulunamadı'; end if;
  if dflt and act and prod is not null then
    update public.checklist_templates set is_default = false where product_code = prod and is_default and id is distinct from v; end if;
  if v is null then
    insert into public.checklist_templates(product_code, name, serial_code, is_default, active, note, updated_by_name)
    values (prod, trim(p_tpl->>'name'), nullif(trim(p_tpl->>'serial_code'), ''), dflt, act, nullif(trim(p_tpl->>'note'), ''), who) returning id into v;
  else
    update public.checklist_templates set product_code = prod, name = trim(p_tpl->>'name'), serial_code = nullif(trim(p_tpl->>'serial_code'), ''),
      is_default = dflt, active = act, note = nullif(trim(p_tpl->>'note'), ''), updated_at = now(), updated_by_name = who where id = v;
    if not found then raise exception 'Şablon bulunamadı'; end if;
  end if;
  delete from public.checklist_template_items where template_id = v;
  insert into public.checklist_template_items(template_id, section, grp, name, qty, sort)
  select v, x->>'section', nullif(trim(x->>'grp'), ''), trim(x->>'name'), nullif(trim(x->>'qty'), ''), o::int
  from jsonb_array_elements(p_items) with ordinality e(x, o) where coalesce(trim(x->>'name'), '') <> '';
  return v;
end $$;

create or replace function public.checklist_template_delete(p_id bigint) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not public.cl_write() then raise exception 'Şablonu yalnız üretim ya da yönetici silebilir'; end if;
  delete from public.checklist_templates where id = p_id;  -- açılmış checklist'ler kopya olduğu için kalır
  if not found then raise exception 'Şablon bulunamadı'; end if;
end $$;

revoke all on function public.checklist_sync(bigint) from public, anon;
revoke all on function public.checklist_add(bigint, text, bigint) from public, anon;
revoke all on function public.checklist_save(bigint, jsonb, jsonb) from public, anon;
revoke all on function public.checklist_retemplate(bigint, bigint) from public, anon;
revoke all on function public.checklist_delete(bigint) from public, anon;
revoke all on function public.checklist_template_save(bigint, jsonb, jsonb) from public, anon;
revoke all on function public.checklist_template_delete(bigint) from public, anon;
grant execute on function public.checklist_sync(bigint) to authenticated;
grant execute on function public.checklist_add(bigint, text, bigint) to authenticated;
grant execute on function public.checklist_save(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.checklist_retemplate(bigint, bigint) to authenticated;
grant execute on function public.checklist_delete(bigint) to authenticated;
grant execute on function public.checklist_template_save(bigint, jsonb, jsonb) to authenticated;
grant execute on function public.checklist_template_delete(bigint) to authenticated;
