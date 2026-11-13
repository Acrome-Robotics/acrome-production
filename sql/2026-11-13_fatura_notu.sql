-- Satın alma rolü faturanın yalnız Açıklama ve Not alanını yazabilsin; tablo politikaları (yalnız admin/muhasebe) değişmez.
create or replace function public.purchase_invoice_note_set(p_id bigint, p_description text, p_note text) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_role(array['admin','muhasebe','purchasing']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  update public.purchase_invoices set description = nullif(left(trim(p_description), 1000), ''), note = nullif(left(trim(p_note), 1000), ''), updated_at = now() where id = p_id;
  if not found then raise exception 'Fatura bulunamadı'; end if;
end $$;
revoke all on function public.purchase_invoice_note_set(bigint, text, text) from public, anon;
grant execute on function public.purchase_invoice_note_set(bigint, text, text) to authenticated;
