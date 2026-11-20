-- Proje kodu 2–10 karakter: harfle başlar, harf ve rakam (belge numarasının sonuna eklenir; var olan kodlar değişmez)
alter table public.kys_projects drop constraint if exists kys_projects_code_check;
alter table public.kys_projects add constraint kys_projects_code_check check (code ~ '^[A-Z][A-Z0-9]{1,9}$');
