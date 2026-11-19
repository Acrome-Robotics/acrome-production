-- Faz 2 geri alma (19.11.2026): 2026-11-19_akislar.sql öncesindeki işlevleri birebir geri kurar.
-- Yeni sütun ve tablolar (purchases.inspection_status, purchase_inspections, rma.root_cause_waived) VERİ KAYBI olmasın diye silinmez;
-- giriş kontrolü bekleyen alımlar varsa önce sonuçlandırın. İstenirse en alttaki yorumlu komutlarla da kaldırılır.

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
  -- sorunu neyin çıkardığı kayda geçmeden tamir sonrası aşamalara geçilmez (taslaklar hariç)
  if not new.is_draft and new.status in ('test','shipped_back','closed')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and (coalesce(trim(new.root_cause),'') = '' or coalesce(trim(new.failed_component),'') = '') then
    raise exception 'Bu aşamaya geçmeden önce "Arızalı parça / bileşen" ve "Sorunu ne çıkardı (kök neden)" alanlarını doldurun';
  end if;
  if new.received_at is not null and new.estimated_repair_days is not null then
    new.estimated_ready_at := new.received_at + new.estimated_repair_days;
  end if;
  return new;
end $function$;

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

drop function if exists public.purchase_inspect(bigint, text, text, text, bigint, boolean);
drop index if exists public.stock_moves_purchase_alim_uq;
-- veri kaybı onayıyla:
-- drop table public.purchase_inspections;
-- alter table public.purchases drop column inspection_status;
-- alter table public.rma drop column root_cause_waived;
