drop function if exists public.kpi_auto(text, date, date);
alter table public.q_kpis drop column if exists auto_metric;
