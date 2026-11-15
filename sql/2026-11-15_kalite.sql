-- Kalite bölümü (15 Kasım 2026)
-- Yeni rol: kalite. Kalite menüsünü yalnız Kalite ve Yönetici görür.
-- KYS belge içeriği depoda DURMAZ: yönetici / kalite #/kalite/yukle sayfasından JSON olarak yükler (kys_content).
-- Hiçbir tabloya kayıt tohumlanmaz; uygunsuzluk, cihaz ve form kayıtları boş başlar.

-- 1) Rol -------------------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_roles_check;
alter table public.profiles add constraint profiles_roles_check
  check (roles <@ array['viewer','sales','production','orders','support','purchasing','stock','muhasebe','kalite','admin','personel']);

create or replace function public.primary_role(r text[]) returns text language sql immutable set search_path = 'public' as $$
  select case when 'admin' = any(r) then 'admin' when r && array['orders','support'] then 'support' when 'production' = any(r) then 'production'
    when 'sales' = any(r) then 'sales' when r && array['viewer','purchasing','stock','muhasebe','kalite'] then 'viewer' when 'personel' = any(r) then 'personel' else 'pending' end $$;

-- q_admin: kalite kayıtlarını yönetir. q_read: uygunsuzluk ve cihaz kayıtlarını görür, uygunsuzluk açar (Personel hariç herkes).
create or replace function public.q_admin() returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.has_role(array['kalite','admin']) $$;
create or replace function public.q_read() returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.has_role(array['viewer','sales','production','orders','support','purchasing','stock','muhasebe','kalite','admin']) $$;
revoke all on function public.q_admin(), public.q_read() from public, anon;
grant execute on function public.q_admin(), public.q_read() to authenticated;

create or replace function public._q_me() returns text language sql stable security definer set search_path = 'public' as $$
  select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid() $$;
revoke all on function public._q_me() from public, anon, authenticated;

-- 2) KYS belge içeriği (tek satır) ------------------------------------------------------------------------
create table if not exists public.kys_content (
  id smallint primary key default 1 check (id = 1),
  meta jsonb not null,
  modules jsonb not null,
  extra jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by_name text
);
alter table public.kys_content enable row level security;
drop policy if exists kys_content_read on public.kys_content;
create policy kys_content_read on public.kys_content for select to authenticated using ((select public.q_admin()));
revoke all on public.kys_content from anon;
revoke insert, update, delete, truncate on public.kys_content from authenticated;

create or replace function public.kys_import(p jsonb) returns int language plpgsql security definer set search_path = 'public' as $$
declare n int;
begin
  if not public.q_admin() then raise exception 'Bu işlem için yetkiniz yok.'; end if;
  if jsonb_typeof(p->'meta') <> 'object' or jsonb_typeof(p->'modules') <> 'array' or jsonb_array_length(p->'modules') = 0 then
    raise exception 'Dosya biçimi tanınmadı (meta ve modules bekleniyor).'; end if;
  if pg_column_size(p) > 4000000 then raise exception 'Dosya çok büyük.'; end if;
  insert into public.kys_content(id, meta, modules, extra, updated_at, updated_by_name)
  values (1, p->'meta', p->'modules', coalesce(p->'extra', '[]'::jsonb), now(), public._q_me())
  on conflict (id) do update set meta = excluded.meta, modules = excluded.modules, extra = excluded.extra, updated_at = now(), updated_by_name = excluded.updated_by_name;
  select coalesce(sum(jsonb_array_length(m->'items')), 0) + jsonb_array_length(coalesce(p->'extra', '[]'::jsonb)) into n from jsonb_array_elements(p->'modules') m;
  return n;
end $$;
revoke all on function public.kys_import(jsonb) from public, anon;
grant execute on function public.kys_import(jsonb) to authenticated;

-- 3) Form ve liste kayıtları (KYS formlarının doldurulmuş hali; listelere eklenen satırlar) -----------------
create table if not exists public.kys_records (
  id bigint generated always as identity primary key,
  code text not null check (code ~ '^ACR-[A-Z]{2}-[A-Z]{2}-[0-9]{2}$'),
  kind text not null check (kind in ('form','row')),
  record_no text,                                   -- form kaydında otomatik: FR-UY-02-2026-001
  label text check (length(label) <= 200),
  status text check (status in ('Açık','İncelemede','Kapandı')),
  data jsonb not null check (pg_column_size(data) < 200000),
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create unique index if not exists kys_records_no_uq on public.kys_records(record_no) where record_no is not null;
create index if not exists kys_records_code_idx on public.kys_records(code, id);

create or replace function public.kys_records_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare y text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY'); pre text; k int;
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid(); new.created_by_name := public._q_me(); new.created_at := now();
    if new.kind = 'form' then
      pre := substr(new.code, 5) || '-' || y || '-';
      perform pg_advisory_xact_lock(hashtext('kys_records_no'));
      select coalesce(max(substr(record_no, length(pre) + 1)::int), 0) + 1 into k from public.kys_records where record_no like pre || '%';
      new.record_no := pre || lpad(k::text, 3, '0');
    else new.record_no := null; end if;
  else
    new.code := old.code; new.kind := old.kind; new.record_no := old.record_no;
    new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.kys_records_trg() from public, anon, authenticated;
drop trigger if exists kys_records_biu on public.kys_records;
create trigger kys_records_biu before insert or update on public.kys_records for each row execute function public.kys_records_trg();

alter table public.kys_records enable row level security;
drop policy if exists kys_records_read on public.kys_records;
drop policy if exists kys_records_ins on public.kys_records;
drop policy if exists kys_records_upd on public.kys_records;
drop policy if exists kys_records_del on public.kys_records;
create policy kys_records_read on public.kys_records for select to authenticated using ((select public.q_admin()));
create policy kys_records_ins on public.kys_records for insert to authenticated with check ((select public.q_admin()));
create policy kys_records_upd on public.kys_records for update to authenticated using ((select public.q_admin())) with check ((select public.q_admin()));
create policy kys_records_del on public.kys_records for delete to authenticated using ((select public.q_admin()));
revoke all on public.kys_records from anon;

-- 4) Uygunsuzluk kayıtları (NCR) ---------------------------------------------------------------------------
-- Tekil numara NCR-YYYY-NNN. Kaynak: RMA, motor testi, PCB takip kaydı, alım talebi ya da elle.
-- Kapatma kuralı: doğrulama yapılmış ve "etkin" bulunmuş olmalı.
create table if not exists public.ncr (
  id bigint generated always as identity primary key,
  no text not null unique,
  opened_at date not null default current_date,
  status text not null default 'acik' check (status in ('acik','inceleme','aksiyon','dogrulama','kapali','iptal')),
  source_kind text not null default 'diger' check (source_kind in ('rma','motor_test','pcb_log','purchase','giris_kontrol','uretim','ic_tetkik','musteri','tedarikci','diger')),
  source_id bigint,
  source_ref text check (length(source_ref) <= 120),
  title text not null check (length(trim(title)) between 3 and 200),
  description text check (length(description) <= 4000),
  product text check (length(product) <= 120),
  item_ident text check (length(item_ident) <= 200),      -- parça / kart / seri / lot: uygunsuz ürünün kimliği
  qty numeric check (qty >= 0),
  hold_location text check (length(hold_location) <= 200), -- ayrıştırma: nerede bekletiliyor, etiket
  supplier_id bigint references public.suppliers(id) on delete set null,
  control_method text check (length(control_method) <= 80),
  detected_by text check (length(detected_by) <= 120),
  unit text check (length(unit) <= 60),
  severity text check (severity in ('kritik','major','minor')),
  requirement text check (length(requirement) <= 2000),   -- karşılanmayan şart: şartname, çizim, kabul kriteri
  label_no text check (length(label_no) <= 60),
  quarantined boolean,
  other_lots text check (length(other_lots) <= 2000),
  mrb_date date,
  mrb_members text check (length(mrb_members) <= 300),
  mrb_decision text check (length(mrb_decision) <= 4000),
  customer_approval boolean,                              -- müşteri yazılı onayı gerekli mi
  customer_approval_ref text check (length(customer_approval_ref) <= 200),
  customer_report boolean,                                -- müşteriye rapor gerekli mi
  responsible text check (length(responsible) <= 120),
  containment text check (length(containment) <= 2000),   -- hemen alınan önlem
  rca_method text check (rca_method in ('5 Neden','Balık kılçığı','8D','Diğer')),
  rca_text text check (length(rca_text) <= 6000),
  root_cause text check (length(root_cause) <= 2000),
  corrective_action text check (length(corrective_action) <= 4000),
  action_owner text check (length(action_owner) <= 120),
  action_due date,
  action_done_at date,
  verify_method text check (length(verify_method) <= 1000),
  verify_result text check (verify_result in ('etkin','etkin_degil')),
  verified_by text check (length(verified_by) <= 120),
  verified_at date,
  closed_at date,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create index if not exists ncr_source_idx on public.ncr(source_kind, source_id);
create index if not exists ncr_supplier_idx on public.ncr(supplier_id);
create index if not exists ncr_status_idx on public.ncr(status);

create or replace function public.ncr_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare y text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY'); k int;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ncr_no'));
    select coalesce(max(substr(no, 10)::int), 0) + 1 into k from public.ncr where no like 'NCR-' || y || '-%';
    new.no := 'NCR-' || y || '-' || lpad(k::text, 3, '0');
    new.created_by := auth.uid(); new.created_by_name := public._q_me(); new.created_at := now();
    if not public.q_admin() then  -- kalite dışındaki roller yalnız açar; inceleme alanlarını kalite doldurur
      new.status := 'acik'; new.closed_at := null; new.verify_result := null; new.verified_by := null; new.verified_at := null;
    end if;
  else
    new.no := old.no; new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  end if;
  if new.status = 'kapali' then
    if new.verify_result is distinct from 'etkin' or new.verified_at is null or nullif(trim(new.verified_by), '') is null then
      raise exception 'Kapatmak için doğrulama gerekli: doğrulayan, tarih ve "etkin" sonucu girilmeli.'; end if;
    new.closed_at := coalesce(new.closed_at, current_date);
  else new.closed_at := null; end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.ncr_trg() from public, anon, authenticated;
drop trigger if exists ncr_biu on public.ncr;
create trigger ncr_biu before insert or update on public.ncr for each row execute function public.ncr_trg();

alter table public.ncr enable row level security;
drop policy if exists ncr_read on public.ncr;
drop policy if exists ncr_ins on public.ncr;
drop policy if exists ncr_upd on public.ncr;
drop policy if exists ncr_del on public.ncr;
create policy ncr_read on public.ncr for select to authenticated using ((select public.q_read()));
create policy ncr_ins on public.ncr for insert to authenticated with check ((select public.q_read()));
create policy ncr_upd on public.ncr for update to authenticated using ((select public.q_admin())) with check ((select public.q_admin()));
create policy ncr_del on public.ncr for delete to authenticated using ((select public.has_role(array['admin'])));
revoke all on public.ncr from anon;

-- 5) Ölçü aleti envanteri ve kalibrasyon ------------------------------------------------------------------
create table if not exists public.q_devices (
  id bigint generated always as identity primary key,
  code text unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(trim(name)) between 2 and 160),
  brand text check (length(brand) <= 80),
  model text check (length(model) <= 80),
  serial_no text check (length(serial_no) <= 80),
  location text check (length(location) <= 120),
  used_in text check (length(used_in) <= 200),            -- tasarım / üretim / kabul muayene
  cal_required boolean not null default true,
  cal_period_months int check (cal_period_months between 1 and 120),
  last_cal_date date,
  next_cal_date date,
  cal_provider text check (length(cal_provider) <= 160),
  accredited boolean,                                      -- hizmet akredite laboratuvar / üretici üzerinden mi
  cert_no text check (length(cert_no) <= 80),
  cert_link text check (length(cert_link) <= 500),
  status text not null default 'kullanimda' check (status in ('kullanimda','kalibrasyonda','kullanim_disi')),
  notes text check (length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create or replace function public.q_devices_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  -- sonraki tarih boşsa ya da son tarih / periyot değişip sonraki tarih elle değiştirilmediyse hesaplanır
  if new.last_cal_date is not null and new.cal_period_months is not null
     and (new.next_cal_date is null or (tg_op = 'UPDATE' and new.next_cal_date is not distinct from old.next_cal_date
          and (new.last_cal_date is distinct from old.last_cal_date or new.cal_period_months is distinct from old.cal_period_months))) then
    new.next_cal_date := (new.last_cal_date + make_interval(months => new.cal_period_months))::date;
  end if;
  new.updated_at := now(); new.updated_by_name := public._q_me();
  return new;
end $$;
revoke all on function public.q_devices_trg() from public, anon, authenticated;
drop trigger if exists q_devices_biu on public.q_devices;
create trigger q_devices_biu before insert or update on public.q_devices for each row execute function public.q_devices_trg();

alter table public.q_devices enable row level security;
drop policy if exists q_devices_read on public.q_devices;
drop policy if exists q_devices_ins on public.q_devices;
drop policy if exists q_devices_upd on public.q_devices;
drop policy if exists q_devices_del on public.q_devices;
create policy q_devices_read on public.q_devices for select to authenticated using ((select public.q_read()));
create policy q_devices_ins on public.q_devices for insert to authenticated with check ((select public.q_admin()));
create policy q_devices_upd on public.q_devices for update to authenticated using ((select public.q_admin())) with check ((select public.q_admin()));
create policy q_devices_del on public.q_devices for delete to authenticated using ((select public.q_admin()));
revoke all on public.q_devices from anon;

-- 6) Tedarikçi onay durumu ve puanı -----------------------------------------------------------------------
alter table public.suppliers
  add column if not exists approval text check (approval in ('onayli','sartli','aday','onaysiz')),
  add column if not exists approval_date date,
  add column if not exists approval_note text check (length(approval_note) <= 1000),
  add column if not exists score numeric(5,1) check (score between 0 and 100),
  add column if not exists score_date date,
  add column if not exists certs text check (length(certs) <= 500);   -- ISO 9001, akreditasyon no vb.
drop policy if exists suppliers_upd_kalite on public.suppliers;
create policy suppliers_upd_kalite on public.suppliers for update to authenticated using ((select public.q_admin())) with check ((select public.q_admin()));

-- 7) PCB takip kaydında ortam koşulu; BOM satırında güvenilirlik verisi ------------------------------------
alter table public.pcb_log
  add column if not exists temp_c numeric(4,1) check (temp_c between -20 and 80),
  add column if not exists rh_pct numeric(4,1) check (rh_pct between 0 and 100);
alter table public.bom_lines
  add column if not exists mtbf_hours numeric check (mtbf_hours > 0),
  add column if not exists mtbf_source text check (length(mtbf_source) <= 200);
