-- Support raporu (11 Kasım 2026): konu başına açılış, kapanış, ilk müşteri mesajı ve ilk Acrome cevabı.
-- security invoker: support okuma yetkisi olan herkes (RLS) görür.
-- Not: 3–5 Kasım 2026'daki toplu aktarımda geçmiş konuların closed_at alanı aktarım günü olarak yazıldı;
-- bu konularda kapanış, son mesaj tarihi (last_activity_at) olarak tahmin edilir (closed_est = true).
begin;
create or replace function public.support_report_rows()
returns table(id bigint, subject text, category text, status text, product text, org text, assignee_name text, source text,
              opened_at timestamptz, closed_at timestamptz, closed_est boolean, first_in timestamptz, first_out timestamptz, n_in int, n_out int)
language sql stable security invoker set search_path = 'public' as $$
  select t.id, t.subject, t.category, t.status, t.product, coalesce(t.organization, t.customer_name), p.full_name,
    case when t.gmail_thread_ids <> '{}' and t.basecamp_urls <> '{}' then 'gmail+basecamp' when t.gmail_thread_ids <> '{}' then 'gmail'
         when t.basecamp_urls <> '{}' then 'basecamp' else 'diğer' end,
    t.opened_at,
    case when t.status <> 'closed' then null
         when t.closed_at < '2026-11-06' and t.last_activity_at is not null and t.last_activity_at < t.closed_at then greatest(t.last_activity_at, t.opened_at)
         else t.closed_at end,
    (t.status = 'closed' and t.closed_at < '2026-11-06' and t.last_activity_at is not null and t.last_activity_at < t.closed_at),
    m.fi, m.fo, coalesce(m.ni, 0)::int, coalesce(m.no, 0)::int
  from support_tickets t
  left join profiles p on p.id = t.assignee
  left join lateral (
    select min(sent_at) filter (where direction = 'in') fi,
           min(sent_at) filter (where direction = 'out' and sent_at >= coalesce((select min(x.sent_at) from support_messages x where x.ticket_id = t.id and x.direction = 'in'), t.opened_at)) fo,
           count(*) filter (where direction = 'in') ni, count(*) filter (where direction = 'out') no
    from support_messages where ticket_id = t.id) m on true $$;
revoke all on function public.support_report_rows() from public, anon;
grant execute on function public.support_report_rows() to authenticated;
commit;
