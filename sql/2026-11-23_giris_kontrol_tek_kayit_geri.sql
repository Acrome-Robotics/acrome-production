-- 2026-11-23_giris_kontrol_tek_kayit.sql geri alma
drop policy if exists kys_content_read_stock on public.kys_content;
drop policy if exists kys_projects_read_stock on public.kys_projects;
drop policy if exists kys_records_kd_read on public.kys_records;
drop policy if exists kys_records_kd_ins on public.kys_records;
drop policy if exists kys_records_kd_upd on public.kys_records;
drop index if exists public.kys_records_kd_purchase;
-- içerik: yedekten (FR-KD-01 Rev 01, FR-KY-01 Rev 00)
update public.kys_content c set modules = s.modules, extra = s.extra, meta = s.meta from snap_20261120.kys_content_20261123 s where s.id = c.id;
