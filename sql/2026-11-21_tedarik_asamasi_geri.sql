-- Tedarik aşamasını geri al: tedarik satırları silinir, kısıt eski 5 aşamaya döner.
-- can_stage ve deal_stage_set için önceki tanım: tedarik satırı/dalı olmadan aynı gövde (2026-11-21_tedarik_asamasi.sql'den 'tedarik' kısımları çıkarılarak uygulanır).
delete from public.deal_stage_events where stage = 'tedarik';
delete from public.deal_stages where stage = 'tedarik';
alter table public.deal_stages drop constraint deal_stages_stage_check;
alter table public.deal_stages add constraint deal_stages_stage_check
  check (stage = any (array['mekanik','elektronik','yazilim','paketleme','gonderim']));
