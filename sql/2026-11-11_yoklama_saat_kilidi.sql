-- Yoklama saatleri: hafta bitince (Pazartesi 00:00, İstanbul) o haftanın saatleri kilitlenir.
-- Kilitli günü yalnız yönetici ekler, değiştirir ya da siler. Oturumsuz (cron, SQL Editor) çağrılar etkilenmez.
create or replace function public.att_times_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare td date := (now() at time zone 'Europe/Istanbul')::date; wk date := date_trunc('week', td)::date;
begin
  if auth.uid() is not null and not has_role(array['admin'])
     and ((tg_op <> 'INSERT' and old.day < wk) or (tg_op <> 'DELETE' and new.day < wk)) then
    raise exception 'Geçmiş haftaların saatleri kilitli. Değişiklik için yöneticiye sor.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.day > td then raise exception 'Gelecek gün için saat girilemez'; end if;
  new.note := nullif(left(trim(new.note), 300), '');
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $function$;
drop trigger if exists att_times_biu on public.att_times;
create trigger att_times_biu before insert or update or delete on public.att_times for each row execute function public.att_times_trg();
