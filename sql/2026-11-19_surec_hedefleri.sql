-- Süreç hedefleri ve performans göstergeleri (ACR-LS-KY-02) — 19.11.2026
-- Gösterge tanımı q_kpis, dönem değerleri q_kpi_values. Gösterge metinleri ve kişi adları burada değil, veritabanında tutulur (tohum ayrı dosya).
-- Yazma: tanım ekleme / düzenleme / silme Kalite + Yönetici; değeri yalnız sorumlu kendi göstergesine (ya da Kalite + Yönetici) girer.
-- Hatırlatma: sonraki ölçüm günü sabah sorumluya; 7 gün içinde değer girilmezse sorumlu + Kalite/Yönetici'ye bir kez daha.

create table if not exists public.q_kpis (
  id bigint generated always as identity primary key,
  code text not null unique,
  process text not null,
  department text,
  indicator text not null,
  formula text,
  owner_id uuid references public.profiles(id) on delete set null,
  freq text not null check (freq in ('Aylık','Çeyreklik','Yıllık')),
  op text not null check (op in ('>=','<=','=','manual')),
  target_num numeric,
  target_text text not null,
  unit text,
  source text not null,                                   -- kaynak / yöntem (denetim izi)
  project_id bigint references public.kys_projects(id) on delete cascade,   -- boş = kurumsal
  start_date date not null,
  next_due date,
  notified_for date,
  notified_stage int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_name text,
  constraint q_kpis_target_chk check (op = 'manual' or target_num is not null)
);
create index if not exists q_kpis_owner_idx on public.q_kpis(owner_id);
create index if not exists q_kpis_project_idx on public.q_kpis(project_id);

create table if not exists public.q_kpi_values (
  id bigint generated always as identity primary key,
  kpi_id bigint not null references public.q_kpis(id) on delete cascade,
  period_end date not null,
  value_num numeric,
  value_text text,
  met boolean,
  note text,
  entered_by uuid references public.profiles(id) on delete set null,
  entered_by_name text,
  entered_at timestamptz not null default now(),
  unique (kpi_id, period_end)
);

-- ---------- işlevler
create or replace function public.q_kpi_met(p_op text, p_target numeric, p_val numeric) returns boolean
language sql immutable set search_path = 'public' as $$
  select case when p_val is null or p_target is null then null
    else case p_op when '>=' then p_val >= p_target when '<=' then p_val <= p_target when '=' then p_val = p_target end end $$;

-- son ölçüm döneminden bir sıklık sonrası; ölçüm yoksa başlangıç tarihi
create or replace function public.q_kpi_next(p_id bigint, p_freq text, p_start date) returns date
language sql stable set search_path = 'public' as $$
  select coalesce((select max(v.period_end) from public.q_kpi_values v where v.kpi_id = p_id)
                  + case p_freq when 'Aylık' then interval '1 month' when 'Çeyreklik' then interval '3 months' else interval '1 year' end,
                  p_start)::date $$;

-- RLS'te kullanılır: sorumlu Kalite rolünde olmayabilir, q_kpis'i okuyamasa da kendi göstergesini bilmeli
create or replace function public.q_kpi_owner(p_id bigint) returns boolean
language sql stable security definer set search_path = 'public' as $$
  select exists (select 1 from public.q_kpis k where k.id = p_id and k.owner_id = auth.uid()) $$;

create or replace function public.q_kpis_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare sys text[] := array['next_due','notified_for','notified_stage','updated_at','updated_by_name'];
begin
  -- hatırlatma işareti ve sonraki tarih "son değişiklik" bilgisini değiştirmez
  if tg_op = 'UPDATE' and (to_jsonb(new) - sys) = (to_jsonb(old) - sys) then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by_name := coalesce(public._q_me(), new.created_by_name);
    new.next_due := new.start_date;
  elsif new.freq is distinct from old.freq or new.start_date is distinct from old.start_date then
    new.next_due := public.q_kpi_next(new.id, new.freq, new.start_date);
    new.notified_for := null; new.notified_stage := null;
  end if;
  new.updated_at := now(); new.updated_by_name := coalesce(public._q_me(), new.updated_by_name);
  return new;
end $$;

-- hedef ya da karşılaştırma değişince eski dönemlerin tuttu/tutmadı durumu yeniden hesaplanır
create or replace function public.q_kpis_after_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.op <> 'manual' and (new.op is distinct from old.op or new.target_num is distinct from old.target_num) then
    update public.q_kpi_values set met = public.q_kpi_met(new.op, new.target_num, value_num) where kpi_id = new.id;
  end if;
  return new;
end $$;

create or replace function public.q_kpi_values_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare k public.q_kpis;
begin
  if tg_op = 'UPDATE' and new.kpi_id is distinct from old.kpi_id then raise exception 'Gösterge değiştirilemez'; end if;
  select * into k from public.q_kpis where id = new.kpi_id;
  if new.period_end > (now() at time zone 'Europe/Istanbul')::date then raise exception 'Dönem sonu bugünden ileri olamaz'; end if;
  if k.op = 'manual' then
    if new.met is null then raise exception 'Tuttu / tutmadı seçin'; end if;
  else
    if new.value_num is null and (tg_op = 'INSERT' or new.value_num is distinct from old.value_num) then raise exception 'Değer girin'; end if;
    new.met := public.q_kpi_met(k.op, k.target_num, new.value_num);
  end if;
  if tg_op = 'INSERT' or (new.period_end, new.value_num, new.value_text, new.note, new.met) is distinct from (old.period_end, old.value_num, old.value_text, old.note, old.met) then
    if auth.uid() is not null then new.entered_by := auth.uid(); new.entered_by_name := public._q_me(); end if;
    new.entered_at := now();
  end if;
  return new;
end $$;

create or replace function public.q_kpi_values_after_trg() returns trigger language plpgsql security definer set search_path = 'public' as $$
declare k public.q_kpis; n date;
begin
  select * into k from public.q_kpis where id = coalesce(new.kpi_id, old.kpi_id);
  if not found then return coalesce(new, old); end if;
  n := public.q_kpi_next(k.id, k.freq, k.start_date);
  update public.q_kpis set next_due = n, notified_for = null, notified_stage = null where id = k.id and next_due is distinct from n;
  return coalesce(new, old);
end $$;

drop trigger if exists q_kpis_bi on public.q_kpis;
create trigger q_kpis_bi before insert or update on public.q_kpis for each row execute function public.q_kpis_trg();
drop trigger if exists q_kpis_au on public.q_kpis;
create trigger q_kpis_au after update on public.q_kpis for each row execute function public.q_kpis_after_trg();
drop trigger if exists q_kpi_values_bi on public.q_kpi_values;
create trigger q_kpi_values_bi before insert or update on public.q_kpi_values for each row execute function public.q_kpi_values_trg();
drop trigger if exists q_kpi_values_ai on public.q_kpi_values;
create trigger q_kpi_values_ai after insert or update or delete on public.q_kpi_values for each row execute function public.q_kpi_values_after_trg();

revoke all on function public.q_kpis_trg(), public.q_kpis_after_trg(), public.q_kpi_values_trg(), public.q_kpi_values_after_trg() from public, anon, authenticated;
revoke all on function public.q_kpi_owner(bigint) from public, anon;
grant execute on function public.q_kpi_owner(bigint) to authenticated;
revoke all on function public.q_kpi_met(text, numeric, numeric), public.q_kpi_next(bigint, text, date) from public, anon;
grant execute on function public.q_kpi_met(text, numeric, numeric), public.q_kpi_next(bigint, text, date) to authenticated;

-- ---------- yetki
alter table public.q_kpis enable row level security;
alter table public.q_kpi_values enable row level security;
revoke all on public.q_kpis, public.q_kpi_values from anon;

drop policy if exists q_kpis_read on public.q_kpis;
create policy q_kpis_read on public.q_kpis for select to authenticated using ((select q_read()) or owner_id = (select auth.uid()));
drop policy if exists q_kpis_ins on public.q_kpis;
create policy q_kpis_ins on public.q_kpis for insert to authenticated with check ((select q_admin()));
drop policy if exists q_kpis_upd on public.q_kpis;
create policy q_kpis_upd on public.q_kpis for update to authenticated using ((select q_admin())) with check ((select q_admin()));
drop policy if exists q_kpis_del on public.q_kpis;
create policy q_kpis_del on public.q_kpis for delete to authenticated using ((select q_admin()));

drop policy if exists q_kpi_values_read on public.q_kpi_values;
create policy q_kpi_values_read on public.q_kpi_values for select to authenticated using ((select q_read()) or q_kpi_owner(kpi_id));
drop policy if exists q_kpi_values_ins on public.q_kpi_values;
create policy q_kpi_values_ins on public.q_kpi_values for insert to authenticated with check ((select q_admin()) or q_kpi_owner(kpi_id));
drop policy if exists q_kpi_values_upd on public.q_kpi_values;
create policy q_kpi_values_upd on public.q_kpi_values for update to authenticated using ((select q_admin()) or q_kpi_owner(kpi_id)) with check ((select q_admin()) or q_kpi_owner(kpi_id));
drop policy if exists q_kpi_values_del on public.q_kpi_values;
create policy q_kpi_values_del on public.q_kpi_values for delete to authenticated using ((select q_admin()));

-- ---------- denetim izi (yalnız oturum açmış kişinin değişikliği; hatırlatma / sonraki tarih güncellemesi yazılmaz)
drop trigger if exists audit_q_kpis_id on public.q_kpis;
create trigger audit_q_kpis_id after insert or delete on public.q_kpis for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_q_kpis_u on public.q_kpis;
create trigger audit_q_kpis_u after update on public.q_kpis for each row
  when (auth.uid() is not null and (to_jsonb(new) - array['next_due','notified_for','notified_stage','updated_at','updated_by_name']) is distinct from (to_jsonb(old) - array['next_due','notified_for','notified_stage','updated_at','updated_by_name']))
  execute function audit_trg();
drop trigger if exists audit_q_kpi_values on public.q_kpi_values;
create trigger audit_q_kpi_values after insert or delete or update on public.q_kpi_values for each row when (auth.uid() is not null) execute function audit_trg();

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  case table_name
    when 'purchases'       then can_read_app()
    when 'stock_items'     then can_read_app()
    when 'daily_notes'     then can_attend()
    when 'expense_reports' then has_role(array['muhasebe','admin']) or exists (select 1 from public.expense_reports x where x.id = audit_log.row_id::bigint and x.user_id = (select auth.uid()))
    when 'ncr'             then q_read()
    when 'q_devices'       then q_read()
    when 'q_kpis'          then q_read()
    when 'q_kpi_values'    then q_read()
    when 'kys_records'     then q_admin()
    else has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])
  end
);

-- ---------- hatırlatma
-- Sonraki ölçüm günü: sorumluya (e-postası yoksa Kalite + Yönetici'ye). 7 gün geçince girilmemişse sorumlu + Kalite/Yönetici'ye bir kez daha.
-- Aynı sonraki tarih için her aşama bir kez; değer girilince sonraki tarih ilerler ve sayaç sıfırlanır.
create or replace function public.q_kpi_remind() returns integer
language plpgsql security definer set search_path = 'public' as $$
declare d date := (now() at time zone 'Europe/Istanbul')::date; n int := 0; r record; st int; k int;
begin
  for r in select * from public.q_kpis where active and next_due is not null and next_due <= d loop
    st := case when d - r.next_due >= 7 then 2 else 1 end;
    continue when r.notified_for is not distinct from r.next_due and r.notified_stage >= st;
    insert into public.mail_outbox(to_email, to_name, subject, title, link)
    select p.email, p.full_name,
           'Acrome · Ölçüm zamanı: ' || r.indicator,
           r.code || ' · ' || r.indicator || ' göstergesinin ölçüm dönemi ' || to_char(r.next_due, 'DD.MM.YYYY') || ' tarihinde doldu. '
             || case when st = 1 then 'Değeri girin.' else 'Değer ' || (d - r.next_due) || ' gündür girilmedi.' end,
           '#/kalite/hedefler'
    from public.profiles p
    where p.email is not null
      and (case when st = 2 then p.id = r.owner_id or coalesce(p.roles, array[p.role]) && array['kalite','admin']
                when r.owner_id is not null and exists (select 1 from public.profiles o where o.id = r.owner_id and o.email is not null) then p.id = r.owner_id
                else coalesce(p.roles, array[p.role]) && array['kalite','admin'] end);
    get diagnostics k = row_count; n := n + k;
    update public.q_kpis set notified_for = r.next_due, notified_stage = st where id = r.id;
  end loop;
  if n > 0 then begin perform public.notify_mail_flush(); exception when others then null; end; end if;
  return n;
end $$;
revoke all on function public.q_kpi_remind() from public, anon, authenticated;

select cron.unschedule('surec-hedefi-hatirlat') where exists (select 1 from cron.job where jobname = 'surec-hedefi-hatirlat');
select cron.schedule('surec-hedefi-hatirlat', '0 4 * * *', $$select public.q_kpi_remind()$$); -- 07:00 TR
