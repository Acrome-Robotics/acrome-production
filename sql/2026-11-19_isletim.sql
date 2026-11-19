-- İşletim görünürlüğü (19.11.2026): e-posta / zamanlanmış iş hataları artık ops_events'e yazılır (yutulmaz), günlük sağlık özeti Yönetici'ye e-postalanır (sorun yoksa hiçbir şey gitmez).
-- Ayrıca: eski kuyruk satırları işaretlenir, haftalık yedek geri yükleme testi zamanlanır, anon'a açık 3 tetikleyici işlevi kapatılır. Tohum / veri yok; idempotent.

-- 1) ops_events + ops_log ------------------------------------------------------------------------------
create table if not exists public.ops_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null check (length(source) <= 80),
  ok boolean not null,
  detail text check (length(detail) <= 1000)
);
create index if not exists ops_events_at_idx on public.ops_events(at desc);
alter table public.ops_events enable row level security;
drop policy if exists ops_events_read on public.ops_events;
create policy ops_events_read on public.ops_events for select to authenticated using ((select public.has_role(array['admin'])));
revoke all on public.ops_events from anon, authenticated;
grant select on public.ops_events to authenticated;

-- Aynı hata art arda (5 dk'da bir) gelirse saatte bir kez yazılır
create or replace function public.ops_log(p_source text, p_ok boolean, p_detail text) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not p_ok and exists (select 1 from ops_events where source = p_source and not ok and detail is not distinct from left(p_detail, 1000) and at > now() - interval '1 hour') then return; end if;
  insert into ops_events(source, ok, detail) values (left(p_source, 80), p_ok, left(p_detail, 1000));
end $$;
revoke all on function public.ops_log(text, boolean, text) from public, anon, authenticated;

-- 2) 2 günden eski gönderilmemiş kuyruk satırları (notify-mail zaten göndermez) açıkça işaretlenir -------------
update public.mail_outbox set error = 'süresi doldu' where sent_at is null and error is null and created_at <= now() - interval '2 days';

-- 3) notify_mail_flush: HTTP ≥300, işlev "failed > 0 / note / error" döndürürse ya da istisnada ops_events'e yazar; çağıran cron düşmez.
-- Anon JWT'si (istemcide zaten herkese açık anahtar) depoya yazılmasın diye mevcut işlevden okunur.
do $mig$
declare a text := substring(pg_get_functiondef('public.notify_mail_flush'::regproc) from 'anon constant text := ''([^'']+)''');
begin
  if a is null then raise exception 'notify_mail_flush içinde anon sabiti bulunamadı'; end if;
  execute format($f$
create or replace function public.notify_mail_flush() returns text language plpgsql security definer set search_path to 'public', 'vault', 'extensions' as $body$
declare tok text; r extensions.http_response; j jsonb; bad text;
  anon constant text := %L;
begin
  update mail_outbox set error = 'süresi doldu' where sent_at is null and error is null and created_at <= now() - interval '2 days';
  if not exists (select 1 from support_notifications where kind <> 'support' and emailed_at is null)
     and not exists (select 1 from mail_outbox where sent_at is null and created_at > now() - interval '2 days') then return 'bekleyen yok'; end if;
  begin
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
    select decrypted_secret into tok from vault.decrypted_secrets where name = 'support_push_token';
    select * into r from extensions.http(('POST', 'https://fjgeoxuyrcsiwghkehap.supabase.co/functions/v1/notify-mail',
       array[extensions.http_header('x-push-token', tok), extensions.http_header('Authorization', 'Bearer ' || anon), extensions.http_header('apikey', anon)],
       'application/json', '{}')::extensions.http_request);
    if r.status >= 300 then bad := 'HTTP ' || r.status || ' ' || left(coalesce(r.content, ''), 300);
    else
      begin j := r.content::jsonb;
        if coalesce((j->>'failed')::int, 0) > 0 or j ? 'note' or j ? 'error' then bad := left(r.content, 400); end if;
      exception when others then null; end;
    end if;
    if bad is not null then perform public.ops_log('notify_mail_flush', false, bad); end if;
    return r.status || ' ' || left(coalesce(r.content, ''), 300);
  exception when others then
    perform public.ops_log('notify_mail_flush', false, 'istisna: ' || sqlerrm);
    return 'hata: ' || sqlerrm;
  end;
end $body$
$f$, a);
end $mig$;

-- 4) Flush'ı çağıran işlevlerdeki "exception when others then null" artık ops_events'e yazar (gövde mevcut tanımdan türetilir)
do $mig$
declare f text; d text;
begin
  foreach f in array array['att_remind', 'q_cal_remind', 'q_kpi_remind', 'stock_count_notify', 'stock_count_remind', 'stock_count_report'] loop
    d := pg_get_functiondef(('public.' || f)::regproc);
    d := regexp_replace(d, 'exception\s+when others\s+then\s+null', 'exception when others then perform public.ops_log(''' || f || ''', false, sqlerrm)', 'gi');
    execute d;
  end loop;
end $mig$;

-- 5) Günlük sağlık kontrolü: sorun varsa 1 satır döner, yoksa 0 satır ------------------------------------------------
create or replace function public.ops_health() returns table(ozet text)
language plpgsql security definer set search_path = 'public' as $$
declare l text[] := '{}'; n int; s text; t timestamptz;
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
  if cardinality(l) > 0 then return query select array_to_string(l, ' · '); end if;
end $$;
revoke all on function public.ops_health() from public, anon, authenticated;

-- Sorun varsa Yönetici rolündekilere TEK özet e-posta (kuyruk 5 dakikada bir gider)
create or replace function public.ops_health_run() returns int
language plpgsql security definer set search_path = 'public' as $$
declare n int := 0;
begin
  insert into mail_outbox(to_email, to_name, subject, title, link)
  select p.email, p.full_name, 'Acrome · Sistem sağlık özeti', 'Sistem sağlık kontrolü sorun buldu: ' || h.ozet, '#/bugun'
  from profiles p cross join ops_health() h where 'admin' = any(p.roles) and p.email is not null;
  get diagnostics n = row_count;
  if n > 0 then perform ops_log('ops_health', false, 'özet e-postası: ' || n || ' alıcı'); end if;
  delete from ops_events where at < now() - interval '90 days';
  return n;
end $$;
revoke all on function public.ops_health_run() from public, anon, authenticated;

-- 6) Haftalık yedek geri yükleme testi: Drive'a dokunmaz; backup-restore-test ?kaynak=canli yedeği kendisi üretip ayrı restore_test şemasına yükler,
-- canlıyla karşılaştırır, şemayı siler, sonucu backup_checks'e yazar. Canlı tablolara yazmaz. Kimlik: mevcut backup_get_token() (token yapısı değişmedi).
create or replace function public.backup_restore_test_run() returns text
language plpgsql security definer set search_path = '' as $$
declare r extensions.http_response; bad text; j jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '150000');
  select * into r from extensions.http(('POST', 'https://fjgeoxuyrcsiwghkehap.supabase.co/functions/v1/backup-restore-test?kaynak=canli',
    array[extensions.http_header('x-backup-token', public.backup_get_token())], 'application/json', '{}')::extensions.http_request);
  if r.status >= 300 then bad := 'HTTP ' || r.status || ' ' || left(coalesce(r.content, ''), 300);
  else begin j := r.content::jsonb; if not coalesce((j->>'ok')::boolean, false) then bad := left(r.content, 400); end if; exception when others then bad := 'yanıt okunamadı'; end;
  end if;
  if bad is not null then perform public.ops_log('backup_restore_test', false, bad); end if;
  return r.status || ' ' || left(coalesce(r.content, ''), 300);
exception when others then
  perform public.ops_log('backup_restore_test', false, 'istisna: ' || sqlerrm);
  return 'hata: ' || sqlerrm;
end $$;
revoke all on function public.backup_restore_test_run() from public, anon, authenticated;

-- 7) Zamanlama: sağlık 07:30 (TR, UTC 04:30) her gün; yedek testi Pazartesi 04:00 (TR) — pazar 03:00 Drive yedeğinden sonra
select cron.unschedule(jobname) from cron.job where jobname in ('ops-saglik-kontrol', 'yedek-geri-yukleme-testi');
select cron.schedule('ops-saglik-kontrol', '30 4 * * *', 'select public.ops_health_run()');
select cron.schedule('yedek-geri-yukleme-testi', '0 1 * * 1', 'select public.backup_restore_test_run()');

-- 8) Anon / giriş yapmış kullanıcı tetikleyici işlevleri RPC olarak çağıramasın (tetikleyiciler çalışmaya devam eder)
revoke execute on function public.att_days_lock_trg(), public.purchase_deal_legacy_trg(), public.purchase_deal_unlink_trg() from public, anon, authenticated;
