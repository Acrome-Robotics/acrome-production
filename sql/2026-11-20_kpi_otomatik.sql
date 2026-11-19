-- Süreç hedefleri: veriden otomatik ölçüt. Değer kaydı (q_kpi_values) yine elle kaydedilir; otomatik değer forma önerilir, kaydedilince o dönem donar.
-- Formüller ilk taslak, Kalite onaylayınca değişebilir.
alter table public.q_kpis add column if not exists auto_metric text
  check (auto_metric in ('zamaninda_sevk', 'rma_kapanis', 'support_ilk_cevap', 'giris_red', 'tedarikci_zamaninda'));

create or replace function public.kpi_auto(p_metric text, p_from date, p_to date)
returns table(value numeric, n int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ((select q_read()) or exists (select 1 from q_kpis where owner_id = auth.uid() and auto_metric = p_metric)) then
    raise exception 'yetki yok';
  end if;
  if p_metric = 'zamaninda_sevk' then  -- %: sevk ≤ planlanan sevk; iç siparişler ve silinenler hariç
    return query select round(100.0 * count(*) filter (where d.ship_date <= d.planned_ship_date) / nullif(count(*), 0), 1), count(*)::int
      from deals d where d.ship_date between p_from and p_to and d.planned_ship_date is not null and not coalesce(d.is_internal, false) and d.deleted_at is null;
  elsif p_metric = 'rma_kapanis' then  -- gün: talep → müşteriye teslim (yoksa geri gönderim)
    return query select round(avg(coalesce(r.delivered_at, r.shipped_back_at)::date - r.requested_at::date), 1), count(*)::int
      from rma r where r.status = 'closed' and coalesce(r.delivered_at, r.shipped_back_at)::date between p_from and p_to and not coalesce(r.is_draft, false);
  elsif p_metric = 'support_ilk_cevap' then  -- saat: konu açılışı → ilk giden mesaj
    return query select round(avg(extract(epoch from (f.first_out - t.opened_at)) / 3600)::numeric, 1), count(*)::int
      from support_tickets t cross join lateral (select min(m.sent_at) first_out from support_messages m where m.ticket_id = t.id and m.direction = 'out') f
      where t.opened_at::date between p_from and p_to and f.first_out is not null and t.category is distinct from 'other';
  elsif p_metric = 'giris_red' then  -- %: kalan giriş kontrolü / tüm giriş kontrolleri
    return query select round(100.0 * count(*) filter (where i.result = 'kaldi') / nullif(count(*), 0), 1), count(*)::int
      from purchase_inspections i where i.voided_at is null and i.inspected_at::date between p_from and p_to;
  elsif p_metric = 'tedarikci_zamaninda' then  -- %: teslim ≤ termin (termin girilmiş teslimler)
    return query select round(100.0 * count(*) filter (where p.purchased_at <= p.expected_at) / nullif(count(*), 0), 1), count(*)::int
      from purchases p where p.status = 'alindi' and p.expected_at is not null and p.purchased_at between p_from and p_to;
  else
    raise exception 'bilinmeyen ölçüt %', p_metric;
  end if;
end $$;
revoke all on function public.kpi_auto(text, date, date) from public, anon;
grant execute on function public.kpi_auto(text, date, date) to authenticated;
