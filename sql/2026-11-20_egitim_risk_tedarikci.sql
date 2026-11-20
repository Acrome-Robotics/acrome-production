-- 20.11.2026 · Eğitim takibi (ACR-LS-EG-01), bilgi varlığı / tedarikçi risk kaydı (ACR-LS-RK-03) aksiyon hatırlatması, tedarikçi risk alanları
-- Eğitim metinleri ve kişi adları burada değil, veritabanında tutulur (tohum ayrı, depo dışı).
-- Yetki: eğitim listesini herkes (q_read) ve kişi kendi satırını görür; ekleme / düzenleme Kalite + Yönetici;
-- herkes eğitim talebi açabilir; kişi kendi eğitimini "tamamlandı" işaretler (q_training_done).
-- Bütçe ayrı tabloda: yalnız Muhasebe, Yönetici, Satış okur ve yazar.

create table if not exists public.q_trainings (
  id bigint generated always as identity primary key,
  code text unique,
  person_id uuid references public.profiles(id) on delete set null,
  person_name text,                                  -- profilsiz kişi ya da "Tüm ekip"
  scope text not null default 'kisi' check (scope in ('kisi','sirket','proje')),
  project_id bigint references public.kys_projects(id) on delete set null,
  department text,
  topic text not null check (length(topic) between 2 and 300),
  kind text,                                         -- İç / Dış / Sertifikalı (dış)
  reason text,
  provider text,
  provider_url text,
  planned_date date,
  planned_text text,                                 -- "Yasal periyoda göre" gibi tarihsiz plan
  status text not null default 'planlandi' check (status in ('talep','planlandi','tamamlandi','iptal')),
  done_date date,
  duration_hours numeric check (duration_hours is null or duration_hours >= 0),
  certificate text,
  cert_location text,
  repeat_months int check (repeat_months is null or repeat_months between 1 and 120),
  valid_until date,
  effectiveness text,
  note text,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_name text
);
create index if not exists q_trainings_person_idx on public.q_trainings(person_id);

create table if not exists public.q_training_costs (
  training_id bigint primary key references public.q_trainings(id) on delete cascade,
  budget numeric check (budget is null or budget >= 0),
  spent numeric check (spent is null or spent >= 0),
  currency text not null default 'TRY',
  note text,
  updated_at timestamptz not null default now(),
  updated_by_name text
);

create or replace function public.q_trainings_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_name := coalesce(public._q_me(), new.created_by_name);
    if new.code is null then
      new.code := 'EG-' || lpad((coalesce((select max(substring(code from 4)::int) from public.q_trainings where code ~ '^EG-\d+$'), 0) + 1)::text, 3, '0');
    end if;
    -- rolü olmayan kişi yalnız talep açar
    if auth.uid() is not null and not public.q_admin() then new.status := 'talep'; new.requested_by := auth.uid(); end if;   -- oturumsuz (tohum / zamanlanmış iş) dokunulmaz
  end if;
  if new.status = 'tamamlandi' and new.done_date is null then new.done_date := (now() at time zone 'Europe/Istanbul')::date; end if;
  if new.status <> 'tamamlandi' then new.done_date := null; end if;
  if new.done_date is not null and new.repeat_months is not null
     and (tg_op = 'INSERT' or new.done_date is distinct from old.done_date or new.repeat_months is distinct from old.repeat_months) then
    new.valid_until := (new.done_date + make_interval(months => new.repeat_months))::date;
  end if;
  new.updated_at := now(); new.updated_by_name := coalesce(public._q_me(), new.updated_by_name);
  return new;
end $$;
drop trigger if exists q_trainings_bi on public.q_trainings;
create trigger q_trainings_bi before insert or update on public.q_trainings for each row execute function public.q_trainings_trg();

create or replace function public.q_training_costs_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin new.updated_at := now(); new.updated_by_name := public._q_me(); return new; end $$;
drop trigger if exists q_training_costs_bi on public.q_training_costs;
create trigger q_training_costs_bi before insert or update on public.q_training_costs for each row execute function public.q_training_costs_trg();

-- kişi kendi eğitimini tamamlandı işaretler (Kalite / Yönetici herkesinkini)
create or replace function public.q_training_done(p_id bigint, p_date date, p_hours numeric, p_note text) returns void
language plpgsql security definer set search_path = 'public' as $$
declare t public.q_trainings;
begin
  select * into t from public.q_trainings where id = p_id for update;
  if not found then raise exception 'Eğitim bulunamadı'; end if;
  if not (t.person_id = auth.uid() or public.q_admin()) then raise exception 'Yalnız eğitimin sahibi işaretleyebilir'; end if;
  if t.status not in ('planlandi','talep') then raise exception 'Bu eğitim planlı değil'; end if;
  if t.status = 'talep' and not public.q_admin() then raise exception 'Talep önce Kalite tarafından planlanmalı'; end if;
  if p_date is null or p_date > (now() at time zone 'Europe/Istanbul')::date then raise exception 'Tamamlanma tarihi bugünden ileri olamaz'; end if;
  update public.q_trainings set status = 'tamamlandi', done_date = p_date, duration_hours = coalesce(p_hours, duration_hours),
    note = nullif(trim(concat_ws(E'\n', note, nullif(trim(p_note), ''))), '') where id = p_id;
end $$;

revoke all on function public.q_trainings_trg(), public.q_training_costs_trg() from public, anon, authenticated;
revoke all on function public.q_training_done(bigint, date, numeric, text) from public, anon;
grant execute on function public.q_training_done(bigint, date, numeric, text) to authenticated;

alter table public.q_trainings enable row level security;
alter table public.q_training_costs enable row level security;
revoke all on public.q_trainings, public.q_training_costs from anon;
grant select, insert, update, delete on public.q_trainings, public.q_training_costs to authenticated;

drop policy if exists q_trainings_read on public.q_trainings;
create policy q_trainings_read on public.q_trainings for select to authenticated
  using ((select q_read()) or person_id = (select auth.uid()) or requested_by = (select auth.uid()));
drop policy if exists q_trainings_ins on public.q_trainings;
create policy q_trainings_ins on public.q_trainings for insert to authenticated
  with check ((select q_admin()) or (status = 'talep' and coalesce(requested_by, (select auth.uid())) = (select auth.uid())));
drop policy if exists q_trainings_upd on public.q_trainings;
create policy q_trainings_upd on public.q_trainings for update to authenticated using ((select q_admin())) with check ((select q_admin()));
drop policy if exists q_trainings_del on public.q_trainings;
create policy q_trainings_del on public.q_trainings for delete to authenticated
  using ((select q_admin()) or (status = 'talep' and requested_by = (select auth.uid())));

drop policy if exists q_training_costs_all on public.q_training_costs;
create policy q_training_costs_all on public.q_training_costs for all to authenticated
  using ((select has_role(array['muhasebe','admin','sales']))) with check ((select has_role(array['muhasebe','admin','sales'])));

drop trigger if exists audit_q_trainings on public.q_trainings;
create trigger audit_q_trainings after insert or delete or update on public.q_trainings for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_q_training_costs on public.q_training_costs;
create trigger audit_q_training_costs after insert or delete or update on public.q_training_costs for each row when (auth.uid() is not null) execute function audit_trg();

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  case table_name
    when 'purchases'        then can_read_app()
    when 'stock_items'      then can_read_app()
    when 'daily_notes'      then can_attend()
    when 'expense_reports'  then has_role(array['muhasebe','admin']) or exists (select 1 from public.expense_reports x where x.id = audit_log.row_id::bigint and x.user_id = (select auth.uid()))
    when 'ncr'              then q_read()
    when 'q_devices'        then q_read()
    when 'q_kpis'           then q_read()
    when 'q_kpi_values'     then q_read()
    when 'q_trainings'      then q_read()
    when 'q_training_costs' then has_role(array['muhasebe','admin','sales'])
    when 'kys_records'      then q_admin()
    when 'deal_payments'    then has_role(array['sales','muhasebe','admin'])
    else has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])
  end
);

-- ---------- tedarikçi: risk seviyesi ve tek kaynak
alter table public.suppliers add column if not exists risk_level text check (risk_level is null or risk_level in ('Düşük','Orta','Yüksek','Kritik'));
alter table public.suppliers add column if not exists single_source boolean not null default false;
alter table public.suppliers add column if not exists risk_note text;

-- ---------- ACR-LS-RK-03 aksiyon tarihi hatırlatması
-- Satır: kys_records kind 'row' code ACR-LS-RK-03, data = { row:[12 sütun], st, due, owner_id, opened, closed, notified_for }.
-- Aksiyon tarihi gelince ve geçmiş açık satırlarda sorumluya (yoksa Kalite + Yönetici'ye) aynı tarih için bir kez e-posta.
create or replace function public.q_rk3_remind() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int := 0; r record; k int; due date;
begin
  for r in select id, data from public.kys_records
           where code = 'ACR-LS-RK-03' and kind = 'row' and project_id is null
             and coalesce(data->>'st', 'Açık') in ('Açık','İzlemede') and (data->>'due') ~ '^\d{4}-\d\d-\d\d$' loop
    due := (r.data->>'due')::date;
    continue when due > d or (r.data->>'notified_for') = (r.data->>'due');
    insert into public.mail_outbox(to_email, to_name, subject, title, link)
    select p.email, p.full_name, 'Acrome · Risk aksiyonu: ' || coalesce(r.data->'row'->>0, ''),
           coalesce(r.data->'row'->>0, '') || ' · ' || left(coalesce(r.data->'row'->>2, ''), 120) || ' — aksiyon tarihi ' || to_char(due, 'DD.MM.YYYY')
             || case when due < d then ', ' || (d - due) || ' gün geçti.' else ', bugün.' end || ' Aksiyon: ' || left(coalesce(r.data->'row'->>9, ''), 200),
           '#/kalite/i/ACR-LS-RK-03'
    from public.profiles p
    where p.email is not null
      and (case when (r.data->>'owner_id') is not null and exists (select 1 from public.profiles o where o.id::text = r.data->>'owner_id' and o.email is not null)
                then p.id::text = r.data->>'owner_id' else coalesce(p.roles, array[p.role]) && array['kalite','admin'] end);
    get diagnostics k = row_count; n := n + k;
    update public.kys_records set data = data || jsonb_build_object('notified_for', r.data->>'due') where id = r.id;
  end loop;
  if n > 0 then begin perform public.notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;
revoke all on function public.q_rk3_remind() from public, anon, authenticated;

select cron.unschedule('risk-aksiyon-hatirlat') where exists (select 1 from cron.job where jobname = 'risk-aksiyon-hatirlat');
select cron.schedule('risk-aksiyon-hatirlat', '5 4 * * *', $$select public.q_rk3_remind()$$); -- 07:05 TR
