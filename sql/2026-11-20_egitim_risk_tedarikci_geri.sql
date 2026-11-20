select cron.unschedule('risk-aksiyon-hatirlat') where exists (select 1 from cron.job where jobname = 'risk-aksiyon-hatirlat');
drop function if exists public.q_rk3_remind();
alter table public.suppliers drop column if exists risk_level, drop column if exists single_source, drop column if exists risk_note;
drop table if exists public.q_training_costs;
drop table if exists public.q_trainings;
drop function if exists public.q_training_done(bigint, date, numeric, text);
drop function if exists public.q_trainings_trg();
drop function if exists public.q_training_costs_trg();
-- audit_read politikası: 2026-11-20 öncesi hâline dönmek için q_trainings / q_training_costs satırları çıkarılarak yeniden oluşturulur
