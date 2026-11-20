-- Geri: hatırlatma yalnız ACR-LS-RK-03 (2026-11-20_egitim_risk_tedarikci.sql tanımı). Satırlar RK-04'te kaldıysa önce kodu geri alın.
create or replace function public.q_rk3_remind() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int := 0; r record; k int; due date;
begin
  for r in select id, data from public.kys_records
           where code = 'ACR-LS-RK-03' and kind = 'row' and project_id is null
             and coalesce(data->>'st', 'Açık') in ('Açık','İzlemede') and (data->>'due') ~ '^\d{4}-\d\d-\d\d$' loop
    due := (r.data->>'due')::date;
    continue when due > d or (r.data->>'notified_for') = (r.data->>'due');
    insert into public.mail_outbox(to_email, to_name, subject, title, link)
    select p.email, p.full_name, 'Acrome · Risk aksiyonu: ' || coalesce(r.data->'row'->>0, ''),
           coalesce(r.data->'row'->>0, '') || ' · ' || left(coalesce(r.data->'row'->>2, ''), 120) || ' — aksiyon tarihi ' || to_char(due, 'DD.MM.YYYY')
             || case when due < d then ', ' || (d - due) || ' gün geçti.' else ', bugün.' end || ' Aksiyon: ' || left(coalesce(r.data->'row'->>9, ''), 200),
           '#/kalite/i/ACR-LS-RK-03'
    from public.profiles p
    where p.email is not null
      and (case when (r.data->>'owner_id') is not null and exists (select 1 from public.profiles o where o.id::text = r.data->>'owner_id' and o.email is not null)
                then p.id::text = r.data->>'owner_id' else coalesce(p.roles, array[p.role]) && array['kalite','admin'] end);
    get diagnostics k = row_count; n := n + k;
    update public.kys_records set data = data || jsonb_build_object('notified_for', r.data->>'due') where id = r.id;
  end loop;
  if n > 0 then begin perform public.notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;
revoke all on function public.q_rk3_remind() from public, anon, authenticated;

