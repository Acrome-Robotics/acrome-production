-- Test & support mühendisinin önerileri (10 Kasım 2026)
--  A) PCB takip kayıtları: kayıt sahibi / kayıttaki kişi kendi kaydını düzeltebilir; numara sunucuda verilir; değişiklik izi.
--  B) Çalışma planı: geç gelenin geliş saati, geç çıkışla telafi, ay sonu eksik saat (kişinin kendisi, muhasebe, yönetici görür).
-- Tek işlemde çalışır ve tekrar çalıştırılabilir.
begin;

-- A) PCB takip ------------------------------------------------------------------------------------------
alter table public.pcb_log add column if not exists updated_at timestamptz;
alter table public.pcb_log add column if not exists updated_by uuid;

-- isimleri karşılaştırmak için: küçük harf, Türkçe harfler sadeleştirilmiş, boşluksuz
create or replace function public.name_key(t text) returns text language sql immutable set search_path = 'public' as $$
  select nullif(regexp_replace(lower(translate(coalesce(t, ''), 'ıİşŞğĞüÜöÖçÇ', 'iissgguuoocc')), '[^a-z0-9]', '', 'g'), '') $$;

create or replace function public.pcb_log_mine(p_created_by uuid, p_given text, p_received text) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select p_created_by = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and public.name_key(p.full_name) is not null
                 and public.name_key(p.full_name) in (public.name_key(p_given), public.name_key(p_received))) $$;
revoke all on function public.pcb_log_mine(uuid, text, text) from public, anon;
grant execute on function public.pcb_log_mine(uuid, text, text) to authenticated;

create or replace function public.pcb_log_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  new.given_by := nullif(regexp_replace(trim(new.given_by), '\s+', ' ', 'g'), '');
  new.received_by := nullif(regexp_replace(trim(new.received_by), '\s+', ' ', 'g'), '');
  if tg_op = 'INSERT' then
    if coalesce(trim(new.no), '') = '' then
      perform pg_advisory_xact_lock(hashtext('pcb_log_no'));
      new.no := lpad((coalesce((select max(no::bigint) from public.pcb_log where no ~ '^\d+$'), 0) + 1)::text, 7, '0');
    end if;
    new.created_by := coalesce(new.created_by, auth.uid());
  else
    new.no := old.no; new.created_by := old.created_by; new.created_at := old.created_at;
    new.updated_at := now(); new.updated_by := auth.uid();
  end if;
  return new;
end $$;
revoke all on function public.pcb_log_trg() from public, anon, authenticated;
drop trigger if exists pcb_log_biu on public.pcb_log;
create trigger pcb_log_biu before insert or update on public.pcb_log for each row execute function public.pcb_log_trg();

drop policy if exists pcb_log_upd on public.pcb_log;
drop policy if exists pcb_log_del on public.pcb_log;
create policy pcb_log_upd on public.pcb_log for update to authenticated
  using ((select public.can_stock()) or public.pcb_log_mine(created_by, given_by, received_by))
  with check ((select public.can_stock()) or public.pcb_log_mine(created_by, given_by, received_by));
create policy pcb_log_del on public.pcb_log for delete to authenticated
  using ((select public.can_stock()) or created_by = (select auth.uid()));

-- B) Çalışma saatleri -----------------------------------------------------------------------------------
alter table public.att_people add column if not exists work_start time not null default '09:00';
alter table public.att_people add column if not exists work_end time not null default '18:00';

create table if not exists public.att_times (
  person_id bigint not null references public.att_people(id) on delete cascade,
  day date not null,
  arrive time,
  leave time,
  note text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (person_id, day),
  check (arrive is not null or leave is not null),
  check (leave is null or arrive is null or leave > arrive)
);
alter table public.att_times enable row level security;
drop policy if exists att_times_read on public.att_times;
drop policy if exists att_times_ins on public.att_times;
drop policy if exists att_times_upd on public.att_times;
drop policy if exists att_times_del on public.att_times;
create policy att_times_read on public.att_times for select to authenticated
  using ((select public.has_role(array['admin','muhasebe'])) or person_id = (select public.att_me()));
create policy att_times_ins on public.att_times for insert to authenticated
  with check ((select public.has_role(array['admin'])) or person_id = (select public.att_me()));
create policy att_times_upd on public.att_times for update to authenticated
  using ((select public.has_role(array['admin'])) or person_id = (select public.att_me()))
  with check ((select public.has_role(array['admin'])) or person_id = (select public.att_me()));
create policy att_times_del on public.att_times for delete to authenticated
  using ((select public.has_role(array['admin'])) or person_id = (select public.att_me()));
revoke all on public.att_times from anon;

create or replace function public.att_times_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.day > (now() at time zone 'Europe/Istanbul')::date then raise exception 'Gelecek gün için saat girilemez'; end if;
  new.note := nullif(left(trim(new.note), 300), '');
  new.updated_by := auth.uid(); new.updated_at := now();
  return new;
end $$;
revoke all on function public.att_times_trg() from public, anon, authenticated;
drop trigger if exists att_times_biu on public.att_times;
create trigger att_times_biu before insert or update on public.att_times for each row execute function public.att_times_trg();

-- Ay özeti (dakika): geç = iş günü geliş saati − mesai başlangıcı; telafi = mesai bitişinden sonraki çıkış,
-- tatil / hafta sonu kayıtlarında çıkış − geliş. Net eksik = geç − telafi (en az 0).
-- Yönetici ve muhasebe herkesi, diğerleri yalnız kendini görür.
create or replace function public.att_month(p_month date)
returns table(person_id bigint, name text, active boolean, work_start time, work_end time,
              late_days int, late_min int, comp_min int, net_min int, late_no_time int, days jsonb)
language sql stable security definer set search_path = 'public' as $$
  with m as (select date_trunc('month', p_month)::date a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date b),
  ppl as (select p.* from public.att_people p
          where public.has_role(array['admin','muhasebe']) or p.id = public.att_me()),
  days as (select person_id, day from public.att_days union select person_id, day from public.att_times),
  dd as (
    select p.id pid, x.day, ad.code, t.arrive, t.leave, t.note, p.work_start ws, p.work_end we,
           (extract(isodow from x.day) between 1 and 5 and coalesce(ad.code, '') <> 'T') as workday
    from ppl p join days x on x.person_id = p.id cross join m
    left join public.att_days ad on ad.person_id = p.id and ad.day = x.day
    left join public.att_times t on t.person_id = p.id and t.day = x.day
    where x.day between m.a and m.b),
  calc as (
    select pid, day, code, arrive, leave, note, workday,
      case when workday and coalesce(code, 'x') in ('x', 'G') and arrive is not null and arrive > ws then (extract(epoch from (arrive - ws)) / 60)::int else 0 end lmin,
      case when not workday and arrive is not null and leave is not null then (extract(epoch from (leave - arrive)) / 60)::int
           when workday and leave is not null and leave > we then (extract(epoch from (leave - we)) / 60)::int else 0 end cmin
    from dd)
  select p.id, p.name, p.active, p.work_start, p.work_end,
    coalesce(count(c.day) filter (where c.code = 'G' or c.lmin > 0), 0)::int,
    coalesce(sum(c.lmin), 0)::int, coalesce(sum(c.cmin), 0)::int,
    greatest(coalesce(sum(c.lmin), 0) - coalesce(sum(c.cmin), 0), 0)::int,
    coalesce(count(c.day) filter (where c.code = 'G' and c.arrive is null), 0)::int,
    coalesce(jsonb_agg(jsonb_build_object('day', c.day, 'code', c.code, 'arrive', to_char(c.arrive, 'HH24:MI'), 'leave', to_char(c.leave, 'HH24:MI'),
             'late', c.lmin, 'comp', c.cmin, 'note', c.note) order by c.day) filter (where c.lmin > 0 or c.cmin > 0 or c.arrive is not null or c.leave is not null or c.code = 'G'), '[]'::jsonb)
  from ppl p left join calc c on c.pid = p.id
  group by p.id, p.name, p.active, p.work_start, p.work_end, p.sort
  having p.active or count(c.day) filter (where c.lmin > 0 or c.cmin > 0) > 0
  order by p.sort, p.name $$;
revoke all on function public.att_month(date) from public, anon;
grant execute on function public.att_month(date) to authenticated;

commit;
