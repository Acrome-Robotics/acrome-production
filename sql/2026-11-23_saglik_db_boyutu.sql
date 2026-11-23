-- Sabah sağlık özeti: veritabanı ücretsiz plan sınırının (500 MB) %70'ini (350 MB) aşınca uyarı.
create or replace function public.ops_health()
 returns table(ozet text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare l text[] := '{}'; n int; s text; t timestamptz; sz bigint;
begin
  select count(*), string_agg(distinct j.jobname, ', ') into n, s from cron.job_run_details d join cron.job j on j.jobid = d.jobid
    where d.start_time > now() - interval '24 hours' and d.status = 'failed';
  if n > 0 then l := l || format('Başarısız zamanlanmış iş: %s çalışma (%s)', n, s); end if;
  select count(*), string_agg(distinct source, ', ') into n, s from ops_events where not ok and at > now() - interval '24 hours' and source <> 'ops_health';
  if n > 0 then l := l || format('İşletim hatası kaydı: %s (%s)', n, s); end if;
  select (select count(*) from mail_outbox where sent_at is null and error is null and created_at < now() - interval '1 hour')
       + (select count(*) from support_notifications where kind <> 'support' and emailed_at is null and created_at < now() - interval '1 hour') into n;
  if n > 0 then l := l || format('1 saatten uzun bekleyen e-posta / bildirim: %s', n); end if;
  select max(checked_at) into t from backup_checks where ok;
  if t is null or t < now() - interval '8 days' then l := l || ('Son başarılı yedek geri yükleme testi: ' || coalesce(to_char(t at time zone 'Europe/Istanbul', 'DD.MM.YYYY'), 'hiç yok') || ' (8 günden eski)'); end if;
  sz := pg_database_size(current_database());
  if sz > 350 * 1024 * 1024 then l := l || format('Veritabanı boyutu %s MB / 500 MB (%%70 sınırı aşıldı)', sz / 1024 / 1024); end if;
  if cardinality(l) > 0 then return query select array_to_string(l, ' · '); end if;
end $function$;
