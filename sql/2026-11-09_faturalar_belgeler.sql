-- Muhasebe yorumları (9 Kasım 2026):
--  1) Aylık alım raporu muhasebenin "Alımların Raporu" Excel'iyle aynı olsun → fatura kayıtları (purchase_invoices).
--     Rapor fatura bazında, muhasebe ayına (period) göre; iadeler düşülür. Alım talepleri faturaya bağlanabilir.
--  2) Alımlara proforma / fatura PDF'i veya görseli eklenebilsin → purchase_files + "alim" deposu.
--  3) Durum yanlışlıkla değişmesin → arayüzde seç + kaydet; her durum değişikliği kayıt altında (purchase_events);
--     "Alındı"dan sipariş öncesi bir duruma geri alınırsa stoğa girmiş adet geri düşülür.
-- Tek işlemde çalışır ve tekrar çalıştırılabilir.
begin;

-- 1) Faturalar ------------------------------------------------------------------------------------------
create table if not exists public.purchase_invoices (
  id bigint generated always as identity primary key,
  period date not null check (period = date_trunc('month', period)::date),   -- muhasebe ayı (Excel'deki sayfa)
  inv_date date,                                                               -- fatura tarihi
  supplier_id bigint references public.suppliers(id) on delete set null,
  supplier_name text,                                                          -- faturadaki unvan
  total_try numeric not null check (total_try <> 'NaN'::numeric and total_try >= 0 and total_try < 1e10), -- Genel toplam, KDV dahil, TL
  is_return boolean not null default false,                                    -- iade faturası (aylık toplamdan düşülür)
  invoice_no text,
  description text,
  note text,
  source text not null default 'site',
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supplier_name is not null or supplier_id is not null or is_return)
);
create index if not exists purchase_invoices_period_idx on public.purchase_invoices(period);
create index if not exists purchase_invoices_supplier_idx on public.purchase_invoices(supplier_id);
create index if not exists purchase_invoices_no_idx on public.purchase_invoices(invoice_no);
create index if not exists purchase_invoices_created_by_idx on public.purchase_invoices(created_by);

create or replace function public.purchase_invoice_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  new.updated_at := now();
  new.supplier_name := nullif(trim(new.supplier_name), '');
  new.invoice_no := nullif(upper(trim(new.invoice_no)), '');
  new.description := nullif(left(trim(new.description), 1000), '');
  if new.period is null then new.period := date_trunc('month', coalesce(new.inv_date, current_date))::date; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_by_name := coalesce(new.created_by_name, (select coalesce(full_name, email) from public.profiles where id = auth.uid()));
    if new.supplier_name is null and new.supplier_id is not null then new.supplier_name := (select name from public.suppliers where id = new.supplier_id); end if;
  end if;
  return new;
end $$;
drop trigger if exists purchase_invoice_biu on public.purchase_invoices;
create trigger purchase_invoice_biu before insert or update on public.purchase_invoices for each row execute function public.purchase_invoice_trg();

alter table public.purchase_invoices enable row level security;
drop policy if exists purchase_invoices_read on public.purchase_invoices;
drop policy if exists purchase_invoices_ins on public.purchase_invoices;
drop policy if exists purchase_invoices_upd on public.purchase_invoices;
drop policy if exists purchase_invoices_del on public.purchase_invoices;
create policy purchase_invoices_read on public.purchase_invoices for select to authenticated using ((select public.has_role(array['admin','muhasebe','purchasing'])));
create policy purchase_invoices_ins on public.purchase_invoices for insert to authenticated with check ((select public.has_role(array['admin','muhasebe'])));
create policy purchase_invoices_upd on public.purchase_invoices for update to authenticated using ((select public.has_role(array['admin','muhasebe']))) with check ((select public.has_role(array['admin','muhasebe'])));
create policy purchase_invoices_del on public.purchase_invoices for delete to authenticated using ((select public.has_role(array['admin','muhasebe'])));
revoke all on public.purchase_invoices from anon;

-- alım talebi ↔ fatura (bir faturada birden çok kalem olabilir)
alter table public.purchases add column if not exists invoice_id bigint references public.purchase_invoices(id) on delete set null;
create index if not exists purchases_invoice_idx on public.purchases(invoice_id);

-- Muhasebe purchases tablosunu güncelleyemez; bağlama yalnız bu fonksiyonla ve yalnız invoice_id alanında
create or replace function public.purchase_invoice_link(p_invoice bigint, p_add bigint[] default '{}', p_remove bigint[] default '{}') returns int
language plpgsql security definer set search_path = 'public' as $$
declare n int := 0; k int;
begin
  if not public.has_role(array['admin','muhasebe','purchasing']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  if not exists (select 1 from public.purchase_invoices where id = p_invoice) then raise exception 'Fatura bulunamadı'; end if;
  if cardinality(coalesce(p_add, '{}')) + cardinality(coalesce(p_remove, '{}')) > 200 then raise exception 'Tek seferde en fazla 200 kalem'; end if;
  update public.purchases set invoice_id = null where id = any(coalesce(p_remove, '{}')) and invoice_id = p_invoice;
  get diagnostics k = row_count; n := n + k;
  update public.purchases set invoice_id = p_invoice where id = any(coalesce(p_add, '{}')) and kind <> 'kontrol';
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke all on function public.purchase_invoice_link(bigint, bigint[], bigint[]) from public, anon;
grant execute on function public.purchase_invoice_link(bigint, bigint[], bigint[]) to authenticated;

-- 2) Belgeler (proforma, fatura, irsaliye…) -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('alim', 'alim', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

create table if not exists public.purchase_files (
  id bigint generated always as identity primary key,
  purchase_id bigint references public.purchases(id) on delete cascade,
  invoice_id bigint references public.purchase_invoices(id) on delete cascade,
  kind text not null default 'proforma' check (kind in ('proforma','fatura','irsaliye','diger')),
  path text not null unique,
  name text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  check ((purchase_id is not null) <> (invoice_id is not null))
);
create index if not exists purchase_files_purchase_idx on public.purchase_files(purchase_id);
create index if not exists purchase_files_invoice_idx on public.purchase_files(invoice_id);
create index if not exists purchase_files_uploader_idx on public.purchase_files(uploaded_by);

-- yol düzeni: p/<alım id>/<rastgele>-dosya  ·  f/<fatura id>/<rastgele>-dosya
create or replace function public.purchase_file_ok(p_path text, p_write boolean) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select case split_part(p_path, '/', 1)
    when 'p' then exists (select 1 from public.purchases x where x.id::text = split_part(p_path, '/', 2)
                  and (case when p_write then public.can_purchase() or public.has_role(array['muhasebe']) or x.created_by = auth.uid()
                            else public.can_read_app() end))
    when 'f' then exists (select 1 from public.purchase_invoices x where x.id::text = split_part(p_path, '/', 2))
                  and public.has_role(case when p_write then array['admin','muhasebe'] else array['admin','muhasebe','purchasing'] end)
    else false end $$;
revoke all on function public.purchase_file_ok(text, boolean) from public, anon;
grant execute on function public.purchase_file_ok(text, boolean) to authenticated;

create or replace function public.purchase_file_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_by_name := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  new.name := left(coalesce(nullif(trim(new.name), ''), split_part(new.path, '/', 3)), 200);
  if new.path !~ ('^' || case when new.purchase_id is not null then 'p/' || new.purchase_id else 'f/' || new.invoice_id end || '/[^/]+$') then
    raise exception 'Geçersiz dosya yolu';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'alim' and o.name = new.path) then raise exception 'Dosya bulunamadı, tekrar yükleyin'; end if;
  return new;
end $$;
drop trigger if exists purchase_file_bi on public.purchase_files;
create trigger purchase_file_bi before insert on public.purchase_files for each row execute function public.purchase_file_trg();

alter table public.purchase_files enable row level security;
drop policy if exists purchase_files_read on public.purchase_files;
drop policy if exists purchase_files_ins on public.purchase_files;
drop policy if exists purchase_files_del on public.purchase_files;
create policy purchase_files_read on public.purchase_files for select to authenticated using ((select public.purchase_file_ok(path, false)));
create policy purchase_files_ins on public.purchase_files for insert to authenticated with check ((select public.purchase_file_ok(path, true)));
create policy purchase_files_del on public.purchase_files for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.has_role(array['admin'])) or (invoice_id is not null and (select public.has_role(array['muhasebe']))));
revoke all on public.purchase_files from anon;
revoke update on public.purchase_files from authenticated;

drop policy if exists alim_read on storage.objects;
drop policy if exists alim_upload on storage.objects;
drop policy if exists alim_delete on storage.objects;
create policy alim_read on storage.objects for select to authenticated using (bucket_id = 'alim' and (select public.purchase_file_ok(name, false)));
create policy alim_upload on storage.objects for insert to authenticated with check (bucket_id = 'alim' and (select public.purchase_file_ok(name, true)));
create policy alim_delete on storage.objects for delete to authenticated
  using (bucket_id = 'alim' and (owner_id = (select auth.uid())::text or (select public.has_role(array['admin']))));

-- 3) Durum geçmişi + "Alındı"dan geri alınca stok düzeltmesi ---------------------------------------------
create table if not exists public.purchase_events (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references public.purchases(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  actor_name text,
  old_status text,
  new_status text,
  note text
);
create index if not exists purchase_events_purchase_idx on public.purchase_events(purchase_id, at);
alter table public.purchase_events enable row level security;
drop policy if exists purchase_events_read on public.purchase_events;
create policy purchase_events_read on public.purchase_events for select to authenticated using ((select public.can_read_app()));
revoke all on public.purchase_events from anon;
revoke insert, update, delete, truncate on public.purchase_events from authenticated;

create or replace function public.purchase_event_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.purchase_events(purchase_id, actor, actor_name, old_status, new_status, note)
    values (new.id, auth.uid(), coalesce((select coalesce(full_name, email) from public.profiles where id = auth.uid()), 'Sistem'),
            case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' and old.status = 'alindi' and old.received_into_stock and not new.received_into_stock then 'Stoğa girilen ' || old.qty || ' adet geri düşüldü' end);
  end if;
  return null;
end $$;
drop trigger if exists purchase_event_aiu on public.purchases;
create trigger purchase_event_aiu after insert or update of status on public.purchases for each row execute function public.purchase_event_trg();

-- stock_move: alım geri alındığında Satın alma rolü de stoğa girmiş adedi geri düşebilsin (yalnız o kalem, aynı adet)
create or replace function public.stock_move(p_item bigint, p_delta numeric default null, p_new_qty numeric default null, p_reason text default 'diger',
  p_note text default null, p_ref_type text default null, p_ref_id bigint default null) returns numeric
language plpgsql security definer set search_path to 'public' as $function$
declare cur numeric; d numeric; nq numeric;
begin
  if auth.uid() is not null and not can_stock()
     and not (p_ref_type = 'purchase' and p_reason = 'alim' and can_purchase()
              and exists (select 1 from purchases where id = p_ref_id and item_id = p_item and not received_into_stock and qty = p_delta))
     and not (p_ref_type = 'purchase' and p_reason = 'duzeltme' and can_purchase()
              and exists (select 1 from purchases where id = p_ref_id and item_id = p_item and received_into_stock and status = 'alindi' and qty = -p_delta)) then
    raise exception 'Stok değiştirme yetkiniz yok';
  end if;
  select qty into cur from stock_items where id = p_item for update;
  if not found then raise exception 'Stok kalemi bulunamadı'; end if;
  if p_new_qty is not null then d := p_new_qty - coalesce(cur, 0); nq := p_new_qty;
  else d := coalesce(p_delta, 0); nq := coalesce(cur, 0) + d; end if;
  update stock_items set qty = nq, updated_by = auth.uid() where id = p_item;
  insert into stock_moves(item_id, delta, qty_after, reason, note, ref_type, ref_id, actor_name)
  values (p_item, d, nq, p_reason, p_note, p_ref_type, p_ref_id, coalesce((select coalesce(full_name, email) from profiles where id = auth.uid()), 'Sistem'));
  return nq;
end $function$;

create or replace function public.purchase_trg() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.total is null and new.qty is not null and new.unit_price is not null then new.total := round(new.qty * new.unit_price, 2); end if;
  if tg_op = 'UPDATE' and new.status = 'alindi' and old.status is distinct from 'alindi' and new.purchased_at is null then new.purchased_at := current_date; end if;
  -- yanlışlıkla "Alındı" yapılıp sipariş öncesi bir duruma geri alınırsa stoğa giren adet geri düşülür ("Eski / kapandı"da düşülmez)
  if tg_op = 'UPDATE' and old.status = 'alindi' and new.status in ('talep','onaylandi','proforma','siparis_verildi','eft_bekliyor','reddedildi')
     and old.received_into_stock and old.item_id is not null and coalesce(old.qty, 0) > 0 then
    perform stock_move(old.item_id, -old.qty, null, 'duzeltme', 'Alım #' || new.id || ' geri alındı: ' || new.item_name, 'purchase', new.id);
    new.received_into_stock := false;
  end if;
  if new.status = 'alindi' and new.item_id is not null and not new.received_into_stock and coalesce(new.qty, 0) > 0
     and (tg_op = 'INSERT' or old.status is distinct from 'alindi') then
    perform stock_move(new.item_id, new.qty, null, 'alim', 'Alım #' || new.id || ': ' || new.item_name, 'purchase', new.id);
    new.received_into_stock := true;
  end if;
  return new;
end $function$;

commit;
