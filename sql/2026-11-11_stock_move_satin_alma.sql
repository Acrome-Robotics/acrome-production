-- stock_move: Satın alma istisnası yalnız purchase_trg içinden ve yalnız delta ile geçerli.
-- Önceki hâlinde Satın alma rolü RPC'yi doğrudan çağırıp p_new_qty ile stoğu keyfi bir sayıya
-- getirebiliyor ya da aynı çağrıyı tekrarlayıp stoğu katlayabiliyordu.
create or replace function public.stock_move(p_item bigint, p_delta numeric default null, p_new_qty numeric default null, p_reason text default 'diger',
  p_note text default null, p_ref_type text default null, p_ref_id bigint default null) returns numeric
language plpgsql security definer set search_path to 'public' as $function$
declare cur numeric; d numeric; nq numeric;
begin
  if auth.uid() is not null and not can_stock()
     and not (pg_trigger_depth() > 0 and p_new_qty is null and p_ref_type = 'purchase' and p_reason = 'alim' and can_purchase()
              and exists (select 1 from purchases where id = p_ref_id and item_id = p_item and not received_into_stock and qty = p_delta))
     and not (pg_trigger_depth() > 0 and p_new_qty is null and p_ref_type = 'purchase' and p_reason = 'duzeltme' and can_purchase()
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
