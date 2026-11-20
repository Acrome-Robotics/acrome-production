-- Alım talebi "Sipariş verildi"ye geçince talebi açana ve isteyene zil bildirimi (termin tarihiyle).
-- kind 'alim': notif_no_email_trg e-posta ve push'u kapatır, yalnız uygulama içi.
create or replace function public.purchase_ordered_notify_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'siparis_verildi' and old.status is distinct from 'siparis_verildi' and new.kind <> 'kontrol' then
    insert into public.support_notifications(user_id, kind, title, link)
    select distinct u, 'alim', 'Sipariş verildi · termin ' || to_char(new.expected_at, 'DD.MM.YYYY') || ' · ' || left(coalesce(new.item_name, ''), 80), '#/alimlar/' || new.id
    from (select new.requester u union select new.created_by) x
    where u is not null and u is distinct from auth.uid();
  end if;
  return null;
end $$;
revoke all on function public.purchase_ordered_notify_trg() from public, anon, authenticated;

drop trigger if exists purchase_ordered_notify_au on public.purchases;
create trigger purchase_ordered_notify_au after update of status on public.purchases
  for each row execute function public.purchase_ordered_notify_trg();
