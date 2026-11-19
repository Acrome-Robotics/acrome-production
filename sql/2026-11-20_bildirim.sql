-- Bildirim dağılımı (20.11.2026, kullanıcı onayı). Yalnız uygulama içi zil; e-posta yok. İşlemi yapan kişiye gitmez, aynı kişiye tek bildirim.
-- Yeni sipariş (Beklemede): Yönetici + Muhasebe + Satış + Sipariş. Üretime alındı: Üretim + Satın alma + Depo. Gönderildi: Satış + Muhasebe.
-- Yeni alım talebi: Satın alma. Yeni RMA: Support + Kalite. RMA kapandı: Satış.
-- Geri alma: 2026-11-20_bildirim_geri.sql.

-- e-postasız türler: 'rma' eklendi (siparis gibi: e-posta yok, telefon bildirimi gider)
create or replace function public.notif_no_email_trg() returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.kind in ('masraf','asama','alim','plan','ncr') then new.emailed_at := coalesce(new.emailed_at, now()); new.pushed_at := coalesce(new.pushed_at, now()); end if;
  -- sipariş ve RMA bildirimi: e-posta yok, telefon bildirimi eskisi gibi
  if new.kind in ('siparis','rma') then new.emailed_at := coalesce(new.emailed_at, now()); end if;
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
           case when p.roles && array['admin','sales','orders'] then '#/kayit/' || new.id else '#/tahsilat' end -- muhasebe sipariş sayfasını göremez
    from public.profiles p where p.roles && array['admin','muhasebe','sales','orders'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and new.status = 'waiting' and old.status in ('production','shipped') then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Beklemeye alındı: ' || public._deal_title(new), '#/kayit/' || new.id
    from public.profiles p where 'production' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and old.status = 'waiting' and new.status = 'production' then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Üretime alındı: ' || public._deal_title(new), '#/kayit/' || new.id
    from public.profiles p where p.roles && array['production','purchasing','stock'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and new.status = 'shipped' and old.status is distinct from 'shipped' then
    insert into public.support_notifications(user_id, kind, title, link)
    select p.id, 'siparis', 'Gönderildi: ' || public._deal_title(new),
           case when p.roles && array['admin','sales','orders'] then '#/kayit/' || new.id else '#/tahsilat' end
    from public.profiles p where p.roles && array['sales','muhasebe'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  end if;
  return null;
end $function$;

-- yeni alım talebi → Satın alma. Aynı işlemde (BOM'dan toplu açılış, tedarik planından oluşturma) birden çok talep açılırsa
-- her kişiye TEK özet bildirim: now() işlem başlangıcıdır, aynı işlemin bildirimi bulunup güncellenir
create or replace function public.purchase_notify_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare n int; t text; l text;
begin
  if new.kind = 'alim' and new.status = 'talep' then
    select count(*) into n from purchases where kind = 'alim' and status = 'talep' and created_at = now();
    t := case when n > 1 then n || ' yeni alım talebi (toplu)' else 'Yeni alım talebi: ' || left(coalesce(new.item_name, ''), 80) end;
    l := case when n > 1 then '#/alimlar' else '#/alimlar/' || new.id end;
    update support_notifications s set title = t, link = l
     where s.kind = 'alim' and s.created_at = now() and s.title like any(array['Yeni alım talebi:%', '% yeni alım talebi (toplu)'])
       and s.user_id in (select p.id from profiles p where 'purchasing' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid());
    insert into support_notifications(user_id, kind, title, link)
    select p.id, 'alim', t, l from profiles p
    where 'purchasing' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid()
      and not exists (select 1 from support_notifications s where s.user_id = p.id and s.kind = 'alim' and s.created_at = now()
                      and s.title like any(array['Yeni alım talebi:%', '% yeni alım talebi (toplu)']));
  end if;
  return null;
end $$;
revoke all on function public.purchase_notify_trg() from public, anon, authenticated;
drop trigger if exists purchase_notify_ai on public.purchases;
create trigger purchase_notify_ai after insert on public.purchases for each row execute function public.purchase_notify_trg();

-- yeni RMA → Support + Kalite; RMA kapandı → Satış (taslaklar bildirim üretmez; taslaktan çıkınca "yeni" sayılır)
create or replace function public.rma_notify_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare t text := coalesce(new.code, 'RMA#' || new.id) || coalesce(' · ' || nullif(new.customer_name, ''), '');
begin
  if not new.is_draft and (tg_op = 'INSERT' or old.is_draft) then
    insert into support_notifications(user_id, kind, title, link)
    select p.id, 'rma', 'Yeni RMA: ' || t, '#/rma/' || new.id
    from profiles p where p.roles && array['support','kalite'] and p.role <> 'pending' and p.id is distinct from auth.uid();
  elsif tg_op = 'UPDATE' and not new.is_draft and new.status = 'closed' and old.status is distinct from 'closed' then
    insert into support_notifications(user_id, kind, title, link)
    select p.id, 'rma', 'RMA kapandı: ' || t, '#/rma/' || new.id
    from profiles p where 'sales' = any(p.roles) and p.role <> 'pending' and p.id is distinct from auth.uid();
  end if;
  return null;
end $$;
revoke all on function public.rma_notify_trg() from public, anon, authenticated;
drop trigger if exists rma_notify_aiu on public.rma;
create trigger rma_notify_aiu after insert or update of status, is_draft on public.rma for each row execute function public.rma_notify_trg();
