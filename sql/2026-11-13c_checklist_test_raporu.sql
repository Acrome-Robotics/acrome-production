-- Checklist (seri no) başına uzun test notu + test raporu dosyaları (PDF / foto). Önce 2026-11-13_checklist.sql.
-- Dosyalar ayrı 'uretim' deposunda; yol düzeni c/<checklist id>/<rastgele>-dosya. Okuma: siparişi okuyabilen; yükleme: üretim + yönetici.

alter table public.checklists add column if not exists test_note text check (length(test_note) <= 5000);

-- checklist_save artık test notunu da yazar
create or replace function public.checklist_save(p_id bigint, p_head jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = 'public' as $$
begin
  if not public.cl_write() then raise exception 'Checklist''i yalnız üretim ya da yönetici doldurabilir'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 300 then raise exception 'Geçersiz madde listesi'; end if;
  update public.checklists set
    title = coalesce(nullif(trim(p_head->>'title'), ''), title),
    serial_no = nullif(trim(p_head->>'serial_no'), ''),
    checked_by = nullif(trim(p_head->>'checked_by'), ''),
    check_date = nullif(p_head->>'check_date', '')::date,
    result = nullif(p_head->>'result', ''),
    test_note = nullif(trim(p_head->>'test_note'), ''),
    edited_at = coalesce(edited_at, now()), updated_at = now(),
    updated_by_name = (select coalesce(full_name, email) from public.profiles where id = auth.uid())
  where id = p_id;
  if not found then raise exception 'Checklist bulunamadı'; end if;
  delete from public.checklist_items where checklist_id = p_id;
  insert into public.checklist_items(checklist_id, section, grp, name, qty, ok, note, sort)
  select p_id, x->>'section', nullif(trim(x->>'grp'), ''), trim(x->>'name'), nullif(trim(x->>'qty'), ''),
         coalesce((x->>'ok')::boolean, false), nullif(trim(x->>'note'), ''), o::int
  from jsonb_array_elements(p_items) with ordinality e(x, o) where coalesce(trim(x->>'name'), '') <> '';
end $$;

-- depo (Supabase'de depo storage.buckets satırıdır; 'alim' de böyle açıldı)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uretim', 'uretim', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

create table if not exists public.checklist_files (
  id bigint generated always as identity primary key,
  checklist_id bigint not null references public.checklists(id) on delete cascade,
  kind text not null default 'rapor' check (kind in ('rapor','foto','diger')),
  path text not null unique,
  name text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists checklist_files_cl_idx on public.checklist_files(checklist_id);
create index if not exists checklist_files_uploader_idx on public.checklist_files(uploaded_by);

create or replace function public.uretim_file_ok(p_path text, p_write boolean) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select split_part(p_path, '/', 1) = 'c'
     and exists (select 1 from public.checklists x where x.id::text = split_part(p_path, '/', 2))
     and case when p_write then public.cl_write() else public.cl_read() end $$;
revoke all on function public.uretim_file_ok(text, boolean) from public, anon;
grant execute on function public.uretim_file_ok(text, boolean) to authenticated;

create or replace function public.checklist_file_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  new.uploaded_by := auth.uid();
  new.uploaded_by_name := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  new.name := left(coalesce(nullif(trim(new.name), ''), split_part(new.path, '/', 3)), 200);
  if new.path !~ ('^c/' || new.checklist_id || '/[^/]+$') then raise exception 'Geçersiz dosya yolu'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'uretim' and o.name = new.path) then raise exception 'Dosya bulunamadı, tekrar yükleyin'; end if;
  -- dosyası olan checklist sipariş adedi azalınca silinmesin
  update public.checklists set edited_at = coalesce(edited_at, now()) where id = new.checklist_id;
  return new;
end $$;
revoke all on function public.checklist_file_trg() from public, anon, authenticated;
drop trigger if exists checklist_file_bi on public.checklist_files;
create trigger checklist_file_bi before insert on public.checklist_files for each row execute function public.checklist_file_trg();

alter table public.checklist_files enable row level security;
drop policy if exists checklist_files_read on public.checklist_files;
drop policy if exists checklist_files_ins on public.checklist_files;
drop policy if exists checklist_files_del on public.checklist_files;
create policy checklist_files_read on public.checklist_files for select to authenticated using ((select public.uretim_file_ok(path, false)));
create policy checklist_files_ins on public.checklist_files for insert to authenticated with check ((select public.uretim_file_ok(path, true)));
create policy checklist_files_del on public.checklist_files for delete to authenticated
  using ((select public.cl_write()) and (uploaded_by = (select auth.uid()) or (select public.has_role(array['admin']))));
revoke all on public.checklist_files from anon;
revoke update on public.checklist_files from authenticated;

drop policy if exists uretim_read on storage.objects;
drop policy if exists uretim_upload on storage.objects;
drop policy if exists uretim_delete on storage.objects;
create policy uretim_read on storage.objects for select to authenticated using (bucket_id = 'uretim' and (select public.uretim_file_ok(name, false)));
create policy uretim_upload on storage.objects for insert to authenticated with check (bucket_id = 'uretim' and (select public.uretim_file_ok(name, true)));
create policy uretim_delete on storage.objects for delete to authenticated
  using (bucket_id = 'uretim' and (owner_id = (select auth.uid())::text or (select public.has_role(array['admin']))));
