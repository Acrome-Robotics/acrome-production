-- Alım talebinde dekont: muhasebe dekontu yükler ve onaylar, talebi açana bildirim gider.

alter table public.purchase_files drop constraint purchase_files_kind_check;
alter table public.purchase_files add constraint purchase_files_kind_check check (kind = any (array['proforma','fatura','irsaliye','diger','dekont']));

-- dekontu yalnız muhasebe ve yönetici yükler
drop policy purchase_files_ins on public.purchase_files;
create policy purchase_files_ins on public.purchase_files for insert with check (
  (select purchase_file_ok(purchase_files.path, true)) and (kind <> 'dekont' or (select has_role(array['muhasebe','admin']))));

alter table public.purchases add column if not exists receipt_approved_at timestamptz,
  add column if not exists receipt_approved_by uuid references auth.users(id),
  add column if not exists receipt_approved_name text;

create or replace function public.purchase_receipt_approve(p_purchase bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare pr public.purchases; who text;
begin
  if not has_role(array['muhasebe','admin']) then raise exception 'Dekontu yalnız muhasebe ya da yönetici onaylayabilir'; end if;
  select * into pr from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Alım bulunamadı'; end if;
  if pr.receipt_approved_at is not null then raise exception 'Dekont zaten onaylanmış'; end if;
  if not exists (select 1 from public.purchase_files where purchase_id = p_purchase and kind = 'dekont') then raise exception 'Önce dekontu yükleyin'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  update public.purchases set receipt_approved_at = now(), receipt_approved_by = auth.uid(), receipt_approved_name = who where id = p_purchase;
  insert into public.purchase_events(purchase_id, actor, actor_name, old_status, new_status, note)
  values (p_purchase, auth.uid(), who, pr.status, pr.status, 'Dekont onaylandı');
  insert into public.support_notifications(user_id, kind, title, link)
  select distinct u, 'alim', 'Dekont onaylandı · ' || left(pr.item_name, 80), '#/alimlar/' || p_purchase
  from (select pr.requester u union select pr.created_by) x
  where u is not null and u is distinct from auth.uid();
end $function$;

revoke all on function public.purchase_receipt_approve(bigint) from public, anon;
grant execute on function public.purchase_receipt_approve(bigint) to authenticated;
