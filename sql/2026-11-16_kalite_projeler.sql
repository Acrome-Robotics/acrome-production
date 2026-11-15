-- Kalite: çoklu proje (16 Kasım 2026)
-- Her proje kendi kalite dosyasını taşır: proje kartı + projeye özel belgeler (plan, risk kaydı, konfigürasyon planı…).
-- Projeye özel belgenin numarası: şablon kodu + proje kodu (ACR-PL-PY-01-XYZ); revizyon ve yayın tarihi belgenin kendisinde.
-- Proje adları ve içerikleri depoda DURMAZ; kayıtlar sitedeki formdan açılır.

-- 1) Projeler ---------------------------------------------------------------------------------------------
create table if not exists public.kys_projects (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z]{2,4}$'),          -- belge numarasına eklenir, sonradan değişmez
  name text not null check (length(trim(name)) between 3 and 200),
  tag text check (length(tag) <= 40),                                 -- kısa ad
  kind text not null default 'musteri' check (kind in ('musteri','arge','ic')),
  customer text check (length(customer) <= 200),                      -- müşteri ya da destekleyen kurum
  short text check (length(short) <= 300),
  summary text check (length(summary) <= 4000),
  status text not null default 'aktif' check (status in ('aktif','tamamlandi','askida','iptal')),
  start_date date,
  end_date date check (end_date is null or start_date is null or end_date >= start_date),
  manager text check (length(manager) <= 120),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array' and pg_column_size(facts) < 50000),
  tests jsonb not null default '[]'::jsonb check (jsonb_typeof(tests) = 'array' and pg_column_size(tests) < 50000),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create or replace function public.kys_projects_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'INSERT' then new.created_by_name := public._q_me(); new.created_at := now();
  else
    if new.code is distinct from old.code then raise exception 'Proje kodu belge numaralarında kullanıldığı için değiştirilemez.'; end if;
    new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.kys_projects_trg() from public, anon, authenticated;
drop trigger if exists kys_projects_biu on public.kys_projects;
create trigger kys_projects_biu before insert or update on public.kys_projects for each row execute function public.kys_projects_trg();

alter table public.kys_projects enable row level security;
drop policy if exists kys_projects_read on public.kys_projects;
drop policy if exists kys_projects_ins on public.kys_projects;
drop policy if exists kys_projects_upd on public.kys_projects;
drop policy if exists kys_projects_del on public.kys_projects;
create policy kys_projects_read on public.kys_projects for select to authenticated using ((select public.q_admin()));
create policy kys_projects_ins on public.kys_projects for insert to authenticated with check ((select public.q_admin()));
create policy kys_projects_upd on public.kys_projects for update to authenticated using ((select public.q_admin())) with check ((select public.q_admin()));
create policy kys_projects_del on public.kys_projects for delete to authenticated using ((select public.has_role(array['admin'])));
revoke all on public.kys_projects from anon;
grant select, insert, update, delete on public.kys_projects to authenticated;

-- Uygunsuzluk formu her role açık; proje kartının ayrıntısı değil, yalnız seçim listesi verilir.
create or replace function public.kys_project_names() returns table(id bigint, code text, tag text, status text)
language sql stable security definer set search_path = 'public' as $$
  select p.id, p.code, coalesce(nullif(p.tag, ''), p.name), p.status from public.kys_projects p where public.q_read() order by p.status <> 'aktif', p.code $$;
revoke all on function public.kys_project_names() from public, anon;
grant execute on function public.kys_project_names() to authenticated;

-- 2) Kayıtların projeye bağlanması ve projeye özel belgeler (kind = 'doc') ----------------------------------
-- doc: projenin kendi belgesi. data = { state: 'taslak' | 'yururlukte', rev, date, history: [[rev, tarih, açıklama]], sections: [{h, p}], rev_note }
alter table public.kys_records add column if not exists project_id bigint references public.kys_projects(id) on delete restrict;
alter table public.kys_records drop constraint if exists kys_records_kind_check;
alter table public.kys_records add constraint kys_records_kind_check check (kind in ('form','row','doc'));
alter table public.kys_records drop constraint if exists kys_records_doc_project;
alter table public.kys_records add constraint kys_records_doc_project check (kind <> 'doc' or project_id is not null);
create unique index if not exists kys_records_doc_uq on public.kys_records(project_id, code) where kind = 'doc';
create index if not exists kys_records_project_idx on public.kys_records(project_id, code);

create or replace function public.kys_records_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare y text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY'); d text := to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY');
  pre text; k int; os text; ns text;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public._q_me(); new.created_at := now();
    if new.kind = 'form' then
      pre := substr(new.code, 5) || '-' || y || '-';
      perform pg_advisory_xact_lock(hashtext('kys_records_no'));
      select coalesce(max(substr(record_no, length(pre) + 1)::int), 0) + 1 into k from public.kys_records where record_no like pre || '%';
      new.record_no := pre || lpad(k::text, 3, '0');
    elsif new.kind = 'doc' then
      new.record_no := new.code || '-' || (select code from public.kys_projects where id = new.project_id);
      new.data := jsonb_build_object('state', 'taslak', 'rev', '00', 'date', null, 'history', '[]'::jsonb, 'sections', coalesce(new.data->'sections', '[]'::jsonb));
      new.status := null;
    else new.record_no := null; end if;
  else
    new.code := old.code; new.kind := old.kind; new.record_no := old.record_no;
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
    if old.kind = 'doc' then
      new.project_id := old.project_id; new.status := null;
      os := old.data->>'state'; ns := coalesce(new.data->>'state', os);
      if os = 'yururlukte' and ns = 'yururlukte' then
        raise exception 'Yürürlükteki belge değiştirilemez; önce yeni revizyon açın.';
      elsif os = 'yururlukte' and ns = 'taslak' then      -- yeni revizyon: numara bir artar, tarih yayında verilir
        if nullif(trim(new.data->>'rev_note'), '') is null then raise exception 'Revizyon nedeni yazılmalı.'; end if;
        new.data := (old.data || jsonb_build_object('sections', new.data->'sections', 'rev_note', left(trim(new.data->>'rev_note'), 300)))
          || jsonb_build_object('state', 'taslak', 'rev', lpad(((old.data->>'rev')::int + 1)::text, 2, '0'));
      elsif os = 'taslak' and ns = 'yururlukte' then      -- yürürlüğe alma: yayın tarihi bugündür, geçmişe tarih yazılmaz
        new.data := (old.data || jsonb_build_object('sections', new.data->'sections', 'state', 'yururlukte', 'date', d,
          'history', coalesce(old.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_array(old.data->>'rev', d, coalesce(nullif(old.data->>'rev_note', ''), 'İlk yayın')))))
          - 'rev_note';
      else                                                 -- taslak üzerinde çalışma: yalnız bölüm metinleri değişir
        new.data := old.data || jsonb_build_object('sections', new.data->'sections');
      end if;
    end if;
  end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.kys_records_trg() from public, anon, authenticated;

-- Proje açılışı: proje kartı ve kalite dosyasındaki belgeler (taslak, Rev 00) tek işlemde
create or replace function public.kys_project_open(p jsonb, docs jsonb) returns bigint language plpgsql security definer set search_path = 'public' as $$
declare pid bigint; x jsonb;
begin
  if not public.q_admin() then raise exception 'Bu işlem için yetkiniz yok.'; end if;
  if jsonb_typeof(docs) <> 'array' or jsonb_array_length(docs) > 40 then raise exception 'Belge listesi tanınmadı.'; end if;
  insert into public.kys_projects(code, name, tag, kind, customer, short, summary, status, start_date, end_date, manager, facts, tests)
  values (upper(trim(p->>'code')), trim(p->>'name'), nullif(trim(p->>'tag'), ''), coalesce(nullif(p->>'kind', ''), 'musteri'), nullif(trim(p->>'customer'), ''),
    nullif(trim(p->>'short'), ''), nullif(trim(p->>'summary'), ''), coalesce(nullif(p->>'status', ''), 'aktif'), nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date,
    nullif(trim(p->>'manager'), ''), coalesce(p->'facts', '[]'::jsonb), coalesce(p->'tests', '[]'::jsonb))
  returning id into pid;
  for x in select * from jsonb_array_elements(docs) loop
    insert into public.kys_records(code, kind, project_id, label, data)
    values (x->>'code', 'doc', pid, left(x->>'label', 200), jsonb_build_object('sections', coalesce(x->'sections', '[]'::jsonb)));
  end loop;
  return pid;
end $$;
revoke all on function public.kys_project_open(jsonb, jsonb) from public, anon;
grant execute on function public.kys_project_open(jsonb, jsonb) to authenticated;

-- 3) Uygunsuzluk kaydında proje ----------------------------------------------------------------------------
alter table public.ncr add column if not exists project_id bigint references public.kys_projects(id) on delete restrict;
create index if not exists ncr_project_idx on public.ncr(project_id);
