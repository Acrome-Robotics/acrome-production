-- Üretimdeki sipariş geri beklemeye alınabilir (satış / sipariş / yönetici; arayüzde "Beklemeye al").
-- Bu dönüş "yeni sipariş" sayılmaz: muhasebe + yöneticiye değil, üretime "Beklemeye alındı" bildirimi gider.
create or replace function public.deals_notify() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deleted_at is not null then return null; end if;
  if new.status = 'waiting' and (tg_op = 'INSERT' or old.status in ('pipeline','lost','archived')) then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Yeni sipariş (beklemede): ' || public._deal_title(new),
           case when 'admin' = any(p.roles) then '#/kayit/' || new.id else '#/tahsilat' end -- muhasebe sipariş sayfasını göremez
    from public.profiles p where p.roles && array['admin','muhasebe'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and new.status = 'waiting' and old.status in ('production','shipped') then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Beklemeye alındı: ' || public._deal_title(new), '#/kayit/' || new.id
    from public.profiles p where 'production' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and old.status = 'waiting' and new.status = 'production' then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Üretime alındı: ' || public._deal_title(new), '#/kayit/' || new.id
    from public.profiles p where 'production' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid();
  end if;
  return null;
end $$;
revoke execute on function public.deals_notify() from public, anon, authenticated;
