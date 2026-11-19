-- Kurumsal Risk ve Fırsat Kaydı (ACR-LS-RK-01) canlı kayıt olur: satırlar kys_records 'row' (code ACR-LS-RK-01) olarak tutulur; veri tohumu bu dosyada YOK.
-- Risk satırları ile siparişler çoka-çok bağlanır (kys_row_deals). Risk satırlarını Kalite, Yönetici, Satış ve Sipariş okur (sipariş sayfası paneli için); yazmayı yine yalnız Kalite/Yönetici yapar.

create table if not exists public.kys_row_deals (
  row_id bigint not null references public.kys_records(id) on delete cascade,
  deal_id bigint not null references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  primary key (row_id, deal_id)
);
create index if not exists kys_row_deals_deal_idx on public.kys_row_deals(deal_id);

alter table public.kys_row_deals enable row level security;
drop policy if exists kys_row_deals_read on public.kys_row_deals;
drop policy if exists kys_row_deals_ins on public.kys_row_deals;
drop policy if exists kys_row_deals_del on public.kys_row_deals;
create policy kys_row_deals_read on public.kys_row_deals for select to authenticated using ((select public.has_role(array['kalite','admin','sales','orders'])));
create policy kys_row_deals_ins on public.kys_row_deals for insert to authenticated with check ((select public.has_role(array['kalite','admin','sales','orders'])));
create policy kys_row_deals_del on public.kys_row_deals for delete to authenticated using ((select public.has_role(array['kalite','admin','sales','orders'])));
revoke all on public.kys_row_deals from anon;
grant select, insert, delete on public.kys_row_deals to authenticated;

-- Satış / sipariş rolleri risk No ve tanımını görebilsin (kys_records'ta okuma q_admin idi); yalnız bu kaydın satırları
drop policy if exists kys_records_read_rk on public.kys_records;
create policy kys_records_read_rk on public.kys_records for select to authenticated
  using (code = 'ACR-LS-RK-01' and kind = 'row' and project_id is null and (select public.has_role(array['kalite','admin','sales','orders'])));
