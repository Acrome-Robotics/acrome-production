-- Uygunsuzluk (NCR) sorumlusuna bildirim ve e-posta (19.11.2026)
-- Sorumlu ve faaliyet sorumlusu artık kişiye bağlanabilir (responsible_id / action_owner_id); eski metin sütunları korunur ve seçilen kişinin adıyla birlikte yazılır.
-- Yeni atanan kişiye (atamayı yapan kendisi değilse): uygulama içi bildirim (kind 'ncr') + mail_outbox satırı.
-- E-posta tetikleyicide gönderilmez; kuyruğu aşağıdaki zamanlayıcı 5 dakikada bir boşaltır (notify_mail_flush, bekleyen yoksa hemen döner).
-- 'ncr' bildirimi notif_no_email'e eklenir: aksi halde flush bildirimi de ayrıca e-postalar (çift e-posta).

alter table public.ncr add column if not exists responsible_id uuid references public.profiles(id) on delete set null;
alter table public.ncr add column if not exists action_owner_id uuid references public.profiles(id) on delete set null;

create or replace function public.notif_no_email_trg() returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.kind in ('masraf','asama','alim','plan','ncr') then new.emailed_at := coalesce(new.emailed_at, now()); new.pushed_at := coalesce(new.pushed_at, now()); end if;
  -- sipariş bildirimi: e-posta yok (kullanıcı kararı 19.11), telefon bildirimi eskisi gibi
  if new.kind = 'siparis' then new.emailed_at := coalesce(new.emailed_at, now()); end if;
  return new;
end $$;

create or replace function public.ncr_notify_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare me uuid := auth.uid(); rn boolean := false;
begin
  if new.responsible_id is not null and new.responsible_id is distinct from me and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform public.ncr_notify(new.id, new.no, new.title, new.responsible_id, 'Uygunsuzluk sorumlusu oldunuz');
    rn := true;
  end if;
  if new.action_owner_id is not null and new.action_owner_id is distinct from me and (tg_op = 'INSERT' or new.action_owner_id is distinct from old.action_owner_id)
     and not (rn and new.action_owner_id = new.responsible_id) then
    perform public.ncr_notify(new.id, new.no, new.title, new.action_owner_id, 'Uygunsuzluk faaliyet sorumlusu oldunuz');
  end if;
  return null;
end $$;

create or replace function public.ncr_notify(p_id bigint, p_no text, p_title text, p_user uuid, p_head text) returns void
language plpgsql security definer set search_path = 'public' as $$
declare t text := p_head || ' · ' || coalesce(p_no, '') || ' · ' || coalesce(p_title, '');
begin
  insert into public.support_notifications(user_id, kind, title, link) values (p_user, 'ncr', t, '#/uygunsuzluk/' || p_id);
  insert into public.mail_outbox(to_email, to_name, subject, title, link)
  select p.email, p.full_name, 'Acrome · Uygunsuzluk: ' || coalesce(p_no, ''), t, '#/uygunsuzluk/' || p_id from public.profiles p where p.id = p_user and p.email is not null;
end $$;
revoke all on function public.ncr_notify_trg(), public.ncr_notify(bigint, text, text, uuid, text) from public, anon, authenticated;

drop trigger if exists ncr_notify on public.ncr;
create trigger ncr_notify after insert or update of responsible_id, action_owner_id on public.ncr for each row execute function public.ncr_notify_trg();

select cron.unschedule('mail-kuyrugu-gonder') where exists (select 1 from cron.job where jobname = 'mail-kuyrugu-gonder');
select cron.schedule('mail-kuyrugu-gonder', '*/5 * * * *', $$select public.notify_mail_flush()$$);
