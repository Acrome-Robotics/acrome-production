-- Geri: tetikleyiciler ve arşiv tablosu kaldırılır (arşivlenmiş revizyonlar silinir)
drop trigger if exists kys_content_rev on public.kys_content;
drop trigger if exists kys_doc_rev on public.kys_records;
drop function if exists public.kys_content_rev_trg();
drop function if exists public.kys_doc_rev_trg();
drop function if exists public._kys_rev_date(jsonb, text);
drop table if exists public.kys_item_revs;
