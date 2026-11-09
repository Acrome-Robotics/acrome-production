-- Ürün dokümanları kütüphanesi (10 Kasım 2026) — canlıya "urun_dokuman_kutuphanesi" adıyla uygulandı.
-- Webflow'daki courseware / user manual / infosheet / API / troubleshoot PDF'lerinin metni sayfa sayfa saklanır;
-- support yapay zekâ özeti ve cevap taslakları ürün bazında buradan alıntı yapar (doc_search).
-- PDF'ler "docs-ingest" edge function'ı ile indirilip parçalanır (supabase/functions/docs-ingest).
-- Doküman listesi (40 kayıt: BB, BBT, COPTER1D/3D, DELTA, STEWART, PEND, ACROBOT, ARM4, SMD, MRK) canlı
-- veritabanında public.product_docs tablosundadır; yeni doküman eklemek için satır ekleyip docs-ingest'i çağırın.
begin;

create table if not exists public.product_docs (
  id bigint generated always as identity primary key,
  product_code text not null,
  variant text,
  kind text not null check (kind in ('infosheet','datasheet','courseware','user_manual','api','troubleshoot','training','workbook')),
  platform text,
  title text not null,
  url text not null unique,
  source text not null default 'webflow',
  pages int,
  chars int,
  status text not null default 'bekliyor' check (status in ('bekliyor','hazir','hata')),
  error text,
  fetched_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.product_doc_chunks (
  id bigint generated always as identity primary key,
  doc_id bigint not null references public.product_docs(id) on delete cascade,
  page int not null,
  part int not null default 1,
  content text not null,
  tsv tsvector generated always as (to_tsvector('english', content)) stored
);
create index if not exists product_doc_chunks_doc_idx on public.product_doc_chunks(doc_id, page);
create index if not exists product_doc_chunks_tsv_idx on public.product_doc_chunks using gin(tsv);
create index if not exists product_docs_product_idx on public.product_docs(product_code);
alter table public.product_docs enable row level security;
alter table public.product_doc_chunks enable row level security;
drop policy if exists product_docs_read on public.product_docs;
drop policy if exists product_doc_chunks_read on public.product_doc_chunks;
create policy product_docs_read on public.product_docs for select to authenticated using ((select public.can_read_app()));
create policy product_doc_chunks_read on public.product_doc_chunks for select to authenticated using ((select public.can_read_app()));
revoke all on public.product_docs, public.product_doc_chunks from anon;
revoke insert, update, delete, truncate on public.product_docs, public.product_doc_chunks from authenticated;

-- Arama: ürün koduna göre (boşsa tüm ürünler), İngilizce kök eşleme; "brake OR encoder" gibi yazılabilir
create or replace function public.doc_search(p_product text, p_query text, p_limit int default 8)
returns table(doc_id bigint, product_code text, variant text, kind text, platform text, title text, url text, page int, snippet text, rank real)
language sql stable security invoker set search_path = 'public' as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) tq)
  select d.id, d.product_code, d.variant, d.kind, d.platform, d.title, d.url, c.page,
         ts_headline('english', c.content, q.tq, 'MaxWords=60, MinWords=25, MaxFragments=2, FragmentDelimiter=" … "'),
         ts_rank_cd(c.tsv, q.tq)
  from public.product_doc_chunks c join public.product_docs d on d.id = c.doc_id, q
  where c.tsv @@ q.tq and (coalesce(p_product, '') = '' or d.product_code = p_product)
  order by ts_rank_cd(c.tsv, q.tq) desc, d.id, c.page
  limit least(greatest(coalesce(p_limit, 8), 1), 30) $$;
revoke all on function public.doc_search(text, text, int) from public, anon;
grant execute on function public.doc_search(text, text, int) to authenticated;

commit;
