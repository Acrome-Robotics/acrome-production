-- Faz 2: kopuk akışlar (19.11.2026). Faz 1 (2026-11-19_yetki.sql) uygulanmış varsayılır. Yalnız YENİ kayıtlar etkilenir; eski veri arşivdir.
-- 1) Alım giriş kontrolü: "Teslim alındı" (alindi) olan yeni alım inspection_status='bekliyor' olur ve stoğa girmez;
--    purchase_inspect() sonucu (Geçti / Kaldı / Şartlı kabul) kaydeder, Geçti ve Şartlı kabulde stoğa girişi aynı işlemde yapar.
--    Şartlı kabulde sorun / sapma açıklaması zorunlu ve kayıtlıdır (purchase_inspections). Çift giriş: stock_moves(ref_id) kısmi UNIQUE + purchase_inspections(purchase_id) UNIQUE.
-- 2) RMA: kök neden boşken "kök nedensiz ilerlet" (rma.root_cause_waived).
-- 3) Üretime alınırken planlanan sevk tarihi zorunlu (deals_validate, yalnız yeni geçişte).
-- Geri alma: 2026-11-19_akislar_geri.sql.

-- ---------- 1) alım giriş kontrolü
alter table public.purchases add column if not exists inspection_status text check (inspection_status in ('bekliyor','gecti','kaldi','sartli'));
create index if not exists purchases_inspection_idx on public.purchases(inspection_status) where inspection_status is not null;

create table if not exists public.purchase_inspections (
  id bigint generated always as identity primary key,
  purchase_id bigint not null unique references public.purchases(id) on delete cascade,
  result text not null check (result in ('gecti','kaldi','sartli')),
  note text,
  deviation_note text,
  item_id bigint references public.stock_items(id) on delete set null,
  item_name text,
  supplier_id bigint references public.suppliers(id) on delete set null,
  qty numeric,
  stocked boolean not null default false,
  stock_move_id bigint unique,
  inspected_by uuid references public.profiles(id) on delete set null,
  inspected_by_name text,
  inspected_at timestamptz not null default now(),
  constraint purchase_inspections_sartli_note check (result <> 'sartli' or length(trim(coalesce(deviation_note, ''))) >= 3)
);
create index if not exists purchase_inspections_item_idx on public.purchase_inspections(item_id) where result = 'sartli';
create index if not exists purchase_inspections_result_idx on public.purchase_inspections(result, inspected_at desc);
alter table public.purchase_inspections enable row level security;
revoke all on public.purchase_inspections from anon;
drop policy if exists purchase_inspections_read on public.purchase_inspections;
create policy purchase_inspections_read on public.purchase_inspections for select to authenticated using ((select can_read_app()));
drop trigger if exists audit_purchase_inspections on public.purchase_inspections;
create trigger audit_purchase_inspections after insert or delete or update on public.purchase_inspections for each row when (auth.uid() is not null) execute function audit_trg();

-- aynı alım iki kez stoğa "alım" girişi yapamaz (geri alınan alımın eski girişi 'purchase_geri' olarak işaretlenir)
create unique index if not exists stock_moves_purchase_alim_uq on public.stock_moves(ref_id) where ref_type = 'purchase' and reason = 'alim';

create or replace function public.purchase_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.total is null and new.qty is not null and new.unit_price is not null then new.total := round(new.qty * new.unit_price, 2); end if;
  if tg_op = 'UPDATE' and new.status = 'proforma' and old.status is distinct from 'proforma'
     and not exists (select 1 from purchase_files where purchase_id = new.id and kind = 'proforma') then
    raise exception 'Önce proforma belgesini yükleyin';
  end if;
  -- Sipariş verildi = sipariş verildi, ödendi, yolda: tahmini termin zorunlu (yalnız yeni geçişte; eski kayıtlar etkilenmez)
  if tg_op = 'UPDATE' and new.status = 'siparis_verildi' and old.status is distinct from 'siparis_verildi' then
    if new.expected_at is null then raise exception 'Sipariş verildi için tahmini termin zorunlu'; end if;
    new.ordered_at := coalesce(new.ordered_at, current_date);
  end if;
  if tg_op = 'UPDATE' and new.expected_at is distinct from old.expected_at then new.eta_notified_on := null; end if; -- yeni terminde tekrar sorulur
  if tg_op = 'UPDATE' and new.status = 'alindi' and old.status is distinct from 'alindi' and new.purchased_at is null then new.purchased_at := current_date; end if;
  if tg_op = 'UPDATE' and old.status = 'alindi' and new.status in ('talep','onaylandi','proforma','siparis_verildi','eft_bekliyor','reddedildi') then
    if old.received_into_stock and old.item_id is not null and coalesce(old.qty, 0) > 0 then
      perform stock_move(old.item_id, -old.qty, null, 'duzeltme', 'Alım #' || new.id || ' geri alındı: ' || new.item_name, 'purchase', new.id);
      new.received_into_stock := false;
      update stock_moves set ref_type = 'purchase_geri' where ref_type = 'purchase' and ref_id = new.id and reason = 'alim';
    end if;
    if old.inspection_status is not null then
      new.inspection_status := null;
      delete from purchase_inspections where purchase_id = new.id;
    end if;
  end if;
  if new.status = 'alindi' and (tg_op = 'INSERT' or old.status is distinct from 'alindi') then
    if tg_op = 'UPDATE' and new.kind = 'alim' then
      new.inspection_status := 'bekliyor';        -- giriş kontrolü sonucuna kadar stoğa girmez (purchase_inspect)
    elsif new.item_id is not null and not new.received_into_stock and coalesce(new.qty, 0) > 0 then
      perform stock_move(new.item_id, new.qty, null, 'alim', 'Alım #' || new.id || ': ' || new.item_name, 'purchase', new.id);
      new.received_into_stock := true;
    end if;
  end if;
  return new;
end $function$;

create or replace function public.purchase_inspect(p_purchase bigint, p_result text, p_note text default null, p_deviation text default null, p_item bigint default null, p_no_stock boolean default false)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare pr public.purchases; who text; v_item bigint; cur numeric; nq numeric; mv bigint; st boolean := false; lbl text;
begin
  if not has_role(array['kalite','stock','admin']) then raise exception 'Giriş kontrolünü yalnız Kalite, Depo / Stok ya da Yönetici girebilir'; end if;
  if p_result not in ('gecti','kaldi','sartli') then raise exception 'Geçersiz sonuç'; end if;
  select * into pr from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Alım bulunamadı'; end if;
  if pr.status <> 'alindi' or pr.inspection_status is distinct from 'bekliyor' then raise exception 'Bu alım giriş kontrolü beklemiyor'; end if;
  if p_result = 'sartli' and length(trim(coalesce(p_deviation, ''))) < 3 then raise exception 'Şartlı kabulde sorun / sapma açıklaması zorunlu'; end if;
  who := coalesce((select coalesce(full_name, email) from public.profiles where id = auth.uid()), 'Sistem');
  v_item := coalesce(pr.item_id, p_item);
  if p_result in ('gecti', 'sartli') then
    if v_item is null and not coalesce(p_no_stock, false) then raise exception 'Stok kalemini seçin ya da "stoksuz kalem" olarak geçin'; end if;
    if v_item is not null and coalesce(pr.qty, 0) > 0 then
      select qty into cur from public.stock_items where id = v_item for update;
      if not found then raise exception 'Stok kalemi bulunamadı'; end if;
      nq := coalesce(cur, 0) + pr.qty;
      update public.stock_items set qty = nq, updated_by = auth.uid() where id = v_item;
      insert into public.stock_moves(item_id, delta, qty_after, reason, note, ref_type, ref_id, actor_name)
      values (v_item, pr.qty, nq, 'alim', 'Alım #' || pr.id || ' giriş kontrolü' || case when p_result = 'sartli' then ' (şartlı kabul)' else '' end || ': ' || pr.item_name, 'purchase', pr.id, who)
      returning id into mv;
      st := true;
    end if;
  end if;
  update public.purchases set inspection_status = p_result, received_into_stock = st,
    item_id = case when p_result <> 'kaldi' then v_item else item_id end where id = p_purchase;
  insert into public.purchase_inspections(purchase_id, result, note, deviation_note, item_id, item_name, supplier_id, qty, stocked, stock_move_id, inspected_by, inspected_by_name)
  values (p_purchase, p_result, nullif(trim(p_note), ''), nullif(trim(p_deviation), ''), case when p_result <> 'kaldi' then v_item else pr.item_id end, pr.item_name, pr.supplier_id, pr.qty, st, mv, auth.uid(), who);
  lbl := case p_result when 'gecti' then 'Geçti' when 'kaldi' then 'Kaldı' else 'Şartlı kabul' end;
  insert into public.purchase_events(purchase_id, actor, actor_name, old_status, new_status, note)
  values (p_purchase, auth.uid(), who, pr.status, pr.status, 'Giriş kontrolü: ' || lbl || coalesce(' · ' || left(nullif(trim(p_deviation), ''), 200), ''));
  insert into public.support_notifications(user_id, kind, title, link)
  select distinct u, 'alim', 'Giriş kontrolü: ' || lbl || ' · ' || left(pr.item_name, 80), '#/alimlar/' || p_purchase
  from (select pr.requester u union select pr.created_by
        union select id from public.profiles where p_result <> 'gecti' and (roles && array['purchasing','kalite']) and role <> 'pending') x
  where u is not null and u is distinct from auth.uid();
end $function$;
revoke all on function public.purchase_inspect(bigint, text, text, text, bigint, boolean) from public, anon;
grant execute on function public.purchase_inspect(bigint, text, text, text, bigint, boolean) to authenticated;

-- ---------- 2) RMA: kök nedensiz ilerletme
alter table public.rma add column if not exists root_cause_waived boolean not null default false;

create or replace function public.rma_trg()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare ono text; who text := coalesce((select coalesce(full_name,email) from profiles where id = auth.uid()), 'Sistem');
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id or new.code is null then
    select order_no into ono from deals where id = new.deal_id;
    if ono is not null then
      if tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id or new.seq is null then
        select coalesce(max(seq),0) + 1 into new.seq from rma where deal_id = new.deal_id and id is distinct from new.id;
      end if;
      new.code := ono || '-RMA#' || new.seq;
    else
      new.seq := null; new.code := 'RMA#' || new.id;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into rma_events(rma_id, actor_name, kind, old_value, new_value) values (new.id, who, 'status', old.status, new.status);
    case new.status
      when 'approved' then new.approved_at := coalesce(new.approved_at, current_date);
      when 'in_transit' then new.customer_shipped_at := coalesce(new.customer_shipped_at, current_date);
      when 'received' then new.received_at := coalesce(new.received_at, current_date);
      when 'diagnosis' then new.diagnosed_at := coalesce(new.diagnosed_at, current_date);
      when 'test' then new.repaired_at := coalesce(new.repaired_at, current_date);
      when 'shipped_back' then new.shipped_back_at := coalesce(new.shipped_back_at, current_date);
      when 'closed' then new.delivered_at := coalesce(new.delivered_at, new.shipped_back_at, current_date);
      else null;
    end case;
  end if;
  -- sorunu neyin çıkardığı kayda geçmeden tamir sonrası aşamalara geçilmez (taslaklar hariç); kök neden "kök nedensiz" işaretiyle atlanabilir, arızalı parça yine istenir
  if not new.is_draft and new.status in ('test','shipped_back','closed')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and ((coalesce(trim(new.root_cause),'') = '' and not new.root_cause_waived) or coalesce(trim(new.failed_component),'') = '') then
    raise exception 'Bu aşamaya geçmeden önce "Arızalı parça / bileşen" ve "Sorunu ne çıkardı (kök neden)" alanlarını doldurun';
  end if;
  if new.received_at is not null and new.estimated_repair_days is not null then
    new.estimated_ready_at := new.received_at + new.estimated_repair_days;
  end if;
  return new;
end $function$;

-- ---------- 3) üretime alırken planlanan sevk tarihi zorunlu (yalnız yeni geçişte; dahili siparişler hariç)
create or replace function public.deals_validate()
 returns trigger language plpgsql set search_path to 'public'
as $function$
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
    if new.status in ('waiting','production','shipped') and new.order_date is null then
      raise exception 'Sipariş için sipariş tarihi zorunlu';
    end if;
    if new.status = 'shipped' and new.ship_date is null and tg_op = 'UPDATE' and old.status <> 'shipped' then
      raise exception 'Gönderildi durumuna geçerken sevk tarihi zorunlu';
    end if;
    if new.status = 'production' and tg_op = 'UPDATE' and old.status is distinct from 'production' and new.planned_ship_date is null and not coalesce(new.is_internal, false) then
      raise exception 'Üretime alırken planlanan sevk tarihi zorunlu';
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
