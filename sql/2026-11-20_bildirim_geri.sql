-- 2026-11-20_bildirim.sql geri alma: 19.11 haline döner.
drop trigger if exists purchase_notify_ai on public.purchases;
drop function if exists public.purchase_notify_trg();
drop trigger if exists rma_notify_aiu on public.rma;
drop function if exists public.rma_notify_trg();

create or replace function public.notif_no_email_trg() returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.kind in ('masraf','asama','alim','plan','ncr') then new.emailed_at := coalesce(new.emailed_at, now()); new.pushed_at := coalesce(new.pushed_at, now()); end if;
  -- sipariş bildirimi: e-posta yok (kullanıcı kararı 19.11), telefon bildirimi eskisi gibi
  if new.kind = 'siparis' then new.emailed_at := coalesce(new.emailed_at, now()); end if;
  return new;
end $$;

create or replace function public.deals_notify()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
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
end $function$;
