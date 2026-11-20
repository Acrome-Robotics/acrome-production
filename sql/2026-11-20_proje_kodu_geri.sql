-- Geri: 2–4 büyük harf (önce bu kurala uymayan proje kodu kalmadığını kontrol edin)
alter table public.kys_projects drop constraint if exists kys_projects_code_check;
alter table public.kys_projects add constraint kys_projects_code_check check (code ~ '^[A-Z]{2,4}$');
