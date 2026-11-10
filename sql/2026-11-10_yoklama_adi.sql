-- "Haftalık çalışma planı" adı yeniden "Haftalık yoklama" (10 Kasım 2026): 16:00 hatırlatma e-postasının metni
create or replace function public.att_remind() returns integer language plpgsql security definer set search_path to 'public' as $function$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int;
begin
  if extract(isodow from d) > 5 then return 0; end if;
  if exists (select 1 from att_people where active) and not exists (
       select 1 from att_people a where a.active and not exists (select 1 from att_days x where x.person_id = a.id and x.day = d and x.code = 'T')) then return 0; end if;
  insert into mail_outbox(to_email, to_name, subject, title, link)
  select a.email, a.name, 'Acrome · Haftalık yoklama', 'Bugünkü (' || to_char(d, 'DD.MM.YYYY') || ') yoklama hücreniz boş. Lütfen haftalık yoklamayı doldurun.', '#/calisma-plani'
  from att_people a
  where a.active and a.email is not null
    and not exists (select 1 from att_days x where x.person_id = a.id and x.day = d)
    and not exists (select 1 from mail_outbox o where lower(o.to_email) = lower(a.email) and o.subject like 'Acrome · Haftalık%' and (o.created_at at time zone 'Europe/Istanbul')::date = d);
  get diagnostics n = row_count;
  if n > 0 then begin perform notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $function$;
