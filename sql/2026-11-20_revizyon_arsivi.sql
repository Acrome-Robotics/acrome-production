-- Revizyon arşivi: belge yeni revizyona geçince eski yayındaki hali saklanır, geçmiş tablosundan açılır.
-- KYS belgeleri (kys_content öğeleri, project_id boş) ve proje belgeleri (kys_records 'doc', project_id dolu).
-- Yalnız tetikleyiciler yazar; istemci yazamaz. Var olan arşiv kaydının üstüne yazılmaz.
create table if not exists public.kys_item_revs (
  id bigserial primary key,
  code text not null,
  project_id bigint references public.kys_projects(id) on delete cascade,
  rev text not null,
  rev_date text,
  item jsonb not null,
  source text not null,
  archived_at timestamptz not null default now(),
  archived_by_name text
);
create unique index if not exists kys_item_revs_u on public.kys_item_revs (code, coalesce(project_id, 0), rev);
alter table public.kys_item_revs enable row level security;
drop policy if exists kys_item_revs_read on public.kys_item_revs;
create policy kys_item_revs_read on public.kys_item_revs for select using ((select public.q_admin()));
revoke insert, update, delete on public.kys_item_revs from anon, authenticated;

-- revizyonun tarihi: öğenin geçmişindeki satırdan, yoksa öğenin tarihi
create or replace function public._kys_rev_date(i jsonb, r text) returns text language sql immutable as $$
  select coalesce((select h->>1 from jsonb_array_elements(coalesce(i->'history', '[]'::jsonb)) h where h->>0 = r limit 1), i->>'date');
$$;

-- KYS içeriği değişince: revizyonu değişen ya da kaldırılan öğenin eski hali
create or replace function public.kys_content_rev_trg() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  with o as (select i from jsonb_array_elements(coalesce(old.modules, '[]'::jsonb)) m, jsonb_array_elements(m->'items') i
             union all select x->'item' from jsonb_array_elements(coalesce(old.extra, '[]'::jsonb)) x),
       n as (select i from jsonb_array_elements(coalesce(new.modules, '[]'::jsonb)) m, jsonb_array_elements(m->'items') i
             union all select x->'item' from jsonb_array_elements(coalesce(new.extra, '[]'::jsonb)) x)
  insert into public.kys_item_revs (code, project_id, rev, rev_date, item, source, archived_by_name)
  select o.i->>'code', null, coalesce(o.i->>'rev', '00'), public._kys_rev_date(o.i, coalesce(o.i->>'rev', '00')), o.i, 'otomatik', public._q_me()
  from o left join n on n.i->>'code' = o.i->>'code'
  where o.i->>'code' is not null and (n.i is null or coalesce(n.i->>'rev', '00') <> coalesce(o.i->>'rev', '00'))
  on conflict (code, coalesce(project_id, 0), rev) do nothing;
  return null;
end $$;
drop trigger if exists kys_content_rev on public.kys_content;
create trigger kys_content_rev after update on public.kys_content for each row execute function public.kys_content_rev_trg();

-- proje belgesi yürürlükteyken yeni revizyon açılınca: yürürlükteki hali (bölümler + o anki tablo satırları)
create or replace function public.kys_doc_rev_trg() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  if old.kind = 'doc' and old.data->>'state' = 'yururlukte' and new.data->>'state' = 'taslak' then
    insert into public.kys_item_revs (code, project_id, rev, rev_date, item, source, archived_by_name)
    values (old.code, old.project_id, coalesce(old.data->>'rev', '00'), old.data->>'date',
            old.data || jsonb_build_object('rows', coalesce((select jsonb_agg(r.data->'row' order by r.id) from public.kys_records r
                                                             where r.code = old.code and r.project_id = old.project_id and r.kind = 'row'), '[]'::jsonb)),
            'otomatik', public._q_me())
    on conflict (code, coalesce(project_id, 0), rev) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists kys_doc_rev on public.kys_records;
create trigger kys_doc_rev after update on public.kys_records for each row execute function public.kys_doc_rev_trg();
revoke all on function public.kys_content_rev_trg(), public.kys_doc_rev_trg() from public, anon, authenticated;
alter function public._kys_rev_date(jsonb, text) set search_path = '';
