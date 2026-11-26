-- Stajyer formu: tek anahtar yerine en fazla 5 adlı link; her biri tek tek silinebilir.
-- intern_key_ok: belge yükleyen Apps Script'in anahtar denetimi (anon çağırır, yalnız doğru/yanlış döner).
drop function if exists public.intern_form_key_new();
drop table if exists public.intern_form_key;

create table if not exists public.intern_form_keys (
  id bigint generated always as identity primary key,
  k text not null unique,
  label text not null check (length(trim(label)) between 1 and 80),
  created_at timestamptz not null default now(),
  created_by_name text
);
alter table public.intern_form_keys enable row level security;
drop policy if exists intern_form_keys_read on public.intern_form_keys;
create policy intern_form_keys_read on public.intern_form_keys for select to authenticated using ((select has_role(array['muhasebe', 'admin'])));
drop policy if exists intern_form_keys_del on public.intern_form_keys;
create policy intern_form_keys_del on public.intern_form_keys for delete to authenticated using ((select has_role(array['muhasebe', 'admin'])));
revoke all on public.intern_form_keys from anon;

create or replace function public.intern_form_key_new(p_label text) returns text language plpgsql security definer set search_path to 'public' as $$
declare nk text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  if not has_role(array['muhasebe', 'admin']) then raise exception 'Bu işlem için yetkiniz yok.'; end if;
  if (select count(*) from intern_form_keys) >= 5 then raise exception 'En fazla 5 aktif link olabilir; önce birini silin.'; end if;
  insert into intern_form_keys(k, label, created_by_name) values (nk, left(coalesce(nullif(trim(p_label), ''), 'Stajyer formu'), 80), (select full_name from profiles where id = auth.uid()));
  return nk;
end $$;
revoke all on function public.intern_form_key_new(text) from public, anon;
grant execute on function public.intern_form_key_new(text) to authenticated;

create or replace function public.intern_key_ok(k text) returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from intern_form_keys where intern_form_keys.k = intern_key_ok.k) $$;
revoke all on function public.intern_key_ok(text) from public;
grant execute on function public.intern_key_ok(text) to anon, authenticated;

-- gönderim artık çoklu linklerden herhangi biriyle kabul edilir
create or replace function public.intern_submit(k text, p jsonb) returns text language plpgsql security definer set search_path to 'public' as $$
declare
  t text := nullif(regexp_replace(coalesce(p->>'tc_no', ''), '\D', '', 'g'), '');
  d jsonb := '{}'::jsonb; nd jsonb; x text; u text; old interns;
  f jsonb;
begin
  if k is null or not intern_key_ok(k) then raise exception 'Form bağlantısı geçersiz ya da süresi dolmuş.'; end if;
  if (select count(*) from interns where source = 'form' and created_at > now() - interval '1 hour') >= 30 then raise exception 'Çok fazla gönderim yapıldı, biraz sonra tekrar deneyin.'; end if;
  if t is null or t !~ '^[1-9][0-9]{10}$' then raise exception 'TC kimlik numarası 11 haneli olmalı.'; end if;
  if length(trim(coalesce(p->>'full_name', ''))) < 3 then raise exception 'Ad soyad girin.'; end if;
  foreach x in array array['kimlik', 'ogrenci', 'staj', 'sgk'] loop
    u := trim(coalesce(p->'docs'->>x, ''));
    if u <> '' then
      if u !~* '^https://' or length(u) > 500 then raise exception 'Belge bağlantısı https:// ile başlamalı.'; end if;
      d := d || jsonb_build_object(x, jsonb_build_object('url', u));
    end if;
  end loop;
  -- yalnız beklenen alanlar, metinler kırpılır
  f := jsonb_strip_nulls(jsonb_build_object(
    'full_name', left(trim(p->>'full_name'), 120), 'email', left(nullif(trim(p->>'email'), ''), 200), 'phone', left(nullif(trim(p->>'phone'), ''), 30),
    'edu_status', left(nullif(trim(p->>'edu_status'), ''), 60), 'department', left(nullif(trim(p->>'department'), ''), 120), 'school', left(nullif(trim(p->>'school'), ''), 160),
    'sgk_no', left(nullif(trim(p->>'sgk_no'), ''), 40), 'address', left(nullif(trim(p->>'address'), ''), 400), 'note', left(nullif(trim(p->>'note'), ''), 1000),
    'birth_date', nullif(p->>'birth_date', ''), 'start_date', nullif(p->>'start_date', ''), 'end_date', nullif(p->>'end_date', '')));
  select * into old from interns where tc_no = t;
  if found then nd := old.docs;
    foreach x in array array['kimlik', 'ogrenci', 'staj', 'sgk'] loop
      if d ? x and coalesce(nd->x->>'url', '') = '' then nd := nd || jsonb_build_object(x, coalesce(nd->x, '{}'::jsonb) || (d->x)); end if;
    end loop;
  else
    insert into interns(tc_no, full_name, email, phone, edu_status, department, school, sgk_no, address, note, birth_date, start_date, end_date, docs, source)
    values (t, f->>'full_name', f->>'email', f->>'phone', f->>'edu_status', f->>'department', f->>'school', f->>'sgk_no', f->>'address', f->>'note',
      (f->>'birth_date')::date, (f->>'start_date')::date, (f->>'end_date')::date, d, 'form');
    return 'yeni';
  end if;
  update interns set
    email = coalesce(email, f->>'email'), phone = coalesce(phone, f->>'phone'), edu_status = coalesce(edu_status, f->>'edu_status'),
    department = coalesce(department, f->>'department'), school = coalesce(school, f->>'school'), sgk_no = coalesce(sgk_no, f->>'sgk_no'),
    address = coalesce(address, f->>'address'), birth_date = coalesce(birth_date, (f->>'birth_date')::date),
    start_date = coalesce(start_date, (f->>'start_date')::date), end_date = coalesce(end_date, (f->>'end_date')::date),
    note = case when f ? 'note' then concat_ws(E'\n', note, 'Form (' || to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY') || '): ' || (f->>'note')) else note end,
    docs = nd
  where id = old.id;
  return 'tamamlandi';
end $$;
revoke all on function public.intern_submit(text, jsonb) from public;
grant execute on function public.intern_submit(text, jsonb) to anon, authenticated;
