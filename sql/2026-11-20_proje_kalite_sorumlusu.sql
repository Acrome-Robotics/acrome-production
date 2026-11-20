-- Projeye özel kalite sorumlusu: formlarda kalite imzasına ve {{kalite}} yer tutucusuna yazılır.
alter table public.kys_projects add column if not exists quality_lead text check (quality_lead is null or length(quality_lead) <= 120);
