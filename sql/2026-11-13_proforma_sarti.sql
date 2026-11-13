-- "Proforma alındı"ya geçiş için proforma belgesi şart. Yalnız UPDATE ile yeni geçişte denetlenir;
-- INSERT ve zaten 'proforma' olan kayıtlar etkilenmez. Gövde canlıdaki tanımdan alındı; tek ekleme: proforma denetimi.
create or replace function public.purchase_trg() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.total is null and new.qty is not null and new.unit_price is not null then new.total := round(new.qty * new.unit_price, 2); end if;
  if tg_op = 'UPDATE' and new.status = 'proforma' and old.status is distinct from 'proforma'
     and not exists (select 1 from purchase_files where purchase_id = new.id and kind = 'proforma') then
    raise exception 'Önce proforma belgesini yükleyin';
  end if;
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
