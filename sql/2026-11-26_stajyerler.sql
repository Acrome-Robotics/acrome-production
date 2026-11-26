-- Stajyer kayıtları: yalnız Muhasebe + Yönetici okur/düzenler. Stajyer, gizli anahtarlı herkese açık formdan intern_submit ile gönderir.
-- docs: { kimlik|ogrenci|staj|sgk : { url, ok } }  (url = stajyerin verdiği Drive linki, ok = Muhasebe kontrol etti)
create table if not exists public.interns (
  id bigint generated always as identity primary key,
  full_name text not null check (length(trim(full_name)) between 3 and 120),
  tc_no text check (tc_no ~ '^[1-9][0-9]{10}$'),
  email text, phone text, edu_status text, department text, school text, sgk_no text,
  birth_date date, start_date date, end_date date, address text,
  doc_link text,                       -- Excel'den gelen tek Drive linki (belge türü ayrılmamış)
  docs jsonb not null default '{}'::jsonb,
  note text,
  source text not null default 'elle' check (source in ('form', 'excel', 'elle')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create unique index if not exists interns_tc_uq on public.interns (tc_no) where tc_no is not null;
alter table public.interns enable row level security;
drop policy if exists interns_all on public.interns;
create policy interns_all on public.interns for all to authenticated
  using ((select has_role(array['muhasebe', 'admin']))) with check ((select has_role(array['muhasebe', 'admin'])));
revoke all on public.interns from anon;

create or replace function public.interns_touch() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by_name := (select full_name from profiles where id = auth.uid()); end if;
  return new;
end $$;
drop trigger if exists interns_touch_trg on public.interns;
create trigger interns_touch_trg before insert or update on public.interns for each row execute function public.interns_touch();

-- form anahtarı: tek satır, Muhasebe / Yönetici yeniler (eski link geçersiz olur)
create table if not exists public.intern_form_key (id int primary key default 1 check (id = 1), k text not null, created_at timestamptz not null default now());
alter table public.intern_form_key enable row level security;
drop policy if exists intern_form_key_read on public.intern_form_key;
create policy intern_form_key_read on public.intern_form_key for select to authenticated using ((select has_role(array['muhasebe', 'admin'])));
revoke all on public.intern_form_key from anon;

create or replace function public.intern_form_key_new() returns text language plpgsql security definer set search_path to 'public' as $$
declare nk text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  if not has_role(array['muhasebe', 'admin']) then raise exception 'Bu işlem için yetkiniz yok.'; end if;
  insert into intern_form_key(id, k) values (1, nk) on conflict (id) do update set k = excluded.k, created_at = now();
  return nk;
end $$;
revoke all on function public.intern_form_key_new() from public, anon;
grant execute on function public.intern_form_key_new() to authenticated;

-- formdan gönderim: anahtar doğruysa kayıt açar; aynı TC varsa yalnız BOŞ alanları ve verilmemiş belge linklerini doldurur (dolu alan ezilmez)
create or replace function public.intern_submit(k text, p jsonb) returns text language plpgsql security definer set search_path to 'public' as $$
declare
  t text := nullif(regexp_replace(coalesce(p->>'tc_no', ''), '\D', '', 'g'), '');
  d jsonb := '{}'::jsonb; nd jsonb; x text; u text; old interns;
  f jsonb;
begin
  if k is null or not exists (select 1 from intern_form_key where intern_form_key.k = intern_submit.k) then raise exception 'Form bağlantısı geçersiz ya da süresi dolmuş.'; end if;
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
