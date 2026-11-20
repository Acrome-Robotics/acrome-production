-- Üretim aşamalarına ilk aşama olarak Tedarik eklenir (malzeme alımı). Güncelleyen: Satın alma, yönetici, Üretim (bölümü boş ya da tedarik).
-- Aşama eklenmeden önce daha sonraki bir aşamaya geçmiş siparişlerde Tedarik "bitti" sayılır (yoksa hepsi Tedarik'e geri düşerdi).

alter table public.deal_stages drop constraint deal_stages_stage_check;
alter table public.deal_stages add constraint deal_stages_stage_check
  check (stage = any (array['tedarik','mekanik','elektronik','yazilim','paketleme','gonderim']));

create or replace function public.can_stage(p_stage text)
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare deps text[];
begin
  if public.has_role(array['admin']) then return true; end if;
  if p_stage = 'gonderim' and public.has_role(array['orders']) then return true; end if;
  if p_stage = 'tedarik' and public.has_role(array['purchasing']) then return true; end if;
  if not public.has_role(array['production']) then return false; end if;
  select departments into deps from public.profiles where id = auth.uid();
  return coalesce(cardinality(deps), 0) = 0 or p_stage = any(deps);
end $function$;

create or replace function public.deal_stage_set(p_deal bigint, p_stage text, p_status text, p_note text DEFAULT NULL::text, p_ship_date date DEFAULT NULL::date)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d public.deals; old public.deal_stages; who text; r public.deal_stages;
  ord constant text[] := array['tedarik','mekanik','elektronik','yazilim','paketleme','gonderim'];
  nm constant jsonb := '{"tedarik":"Tedarik","mekanik":"Mekanik montaj","elektronik":"Elektronik","yazilim":"Yazılım / test","paketleme":"Paketleme","gonderim":"Gönderim"}';
  nxt text; ref text;
begin
  if p_stage <> all(ord) then raise exception 'Geçersiz aşama'; end if;
  if p_status not in ('bekliyor','devam','bitti','gerekmiyor') then raise exception 'Geçersiz durum'; end if;
  if not public.can_stage(p_stage) then raise exception 'Bu aşamayı güncelleme yetkiniz yok'; end if;
  select * into d from public.deals where id = p_deal;
  if not found then raise exception 'Sipariş bulunamadı'; end if;
  if d.status <> 'production' then raise exception 'Yalnız üretimdeki siparişlerin aşaması güncellenebilir'; end if;
  if p_stage = 'gonderim' and p_status = 'bitti' then
    if p_ship_date is null then raise exception 'Gönderim için sevk tarihi girin'; end if;
    if p_ship_date > (now() at time zone 'Europe/Istanbul')::date then raise exception 'Sevk tarihi gelecekte olamaz'; end if;
    if d.order_date is not null and p_ship_date < d.order_date then raise exception 'Sevk tarihi sipariş tarihinden önce olamaz'; end if;
  end if;
  who := coalesce((select coalesce(full_name, email) from public.profiles where id = auth.uid()), 'Sistem');
  select * into old from public.deal_stages where deal_id = p_deal and stage = p_stage;

  insert into public.deal_stages as s (deal_id, stage, status, note, started_at, done_at, updated_by, updated_by_name, updated_at)
  values (p_deal, p_stage, p_status, nullif(trim(p_note), ''),
          case when p_status in ('devam','bitti') then now() end,
          case when p_status in ('bitti','gerekmiyor') then now() end, auth.uid(), who, now())
  on conflict (deal_id, stage) do update set
    status = excluded.status,
    note = case when p_note is null then s.note else nullif(trim(p_note), '') end,
    started_at = case when excluded.status = 'bekliyor' then null when excluded.status in ('devam','bitti') then coalesce(s.started_at, now()) else s.started_at end,
    done_at = case when excluded.status in ('bitti','gerekmiyor') then coalesce(case when s.status = excluded.status then s.done_at end, now()) else null end,
    updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now()
  returning * into r;

  if old.status is distinct from p_status or (p_note is not null and old.note is distinct from nullif(trim(p_note), '')) then
    insert into public.deal_stage_events(deal_id, stage, old_status, new_status, note, actor, actor_name)
    values (p_deal, p_stage, coalesce(old.status, 'bekliyor'), p_status, nullif(trim(p_note), ''), auth.uid(), who);
  end if;

  if p_stage = 'gonderim' and p_status = 'bitti' then
    update public.deals set ship_date = p_ship_date, status = 'shipped', updated_at = now(), updated_by = auth.uid() where id = p_deal;
  elsif p_status in ('bitti','gerekmiyor') and coalesce(old.status, 'bekliyor') not in ('bitti','gerekmiyor') then
    -- sıradaki (bitmemiş) aşamanın bölümüne site içi bildirim
    select x into nxt from unnest(ord) with ordinality u(x, i)
      where i > array_position(ord, p_stage)
        and coalesce((select status from public.deal_stages where deal_id = p_deal and stage = x), 'bekliyor') not in ('bitti','gerekmiyor')
      order by i limit 1;
    if nxt is not null then
      ref := coalesce(d.order_no, d.opp_no, '#' || d.id) || ' ' || coalesce((select name from public.customers where id = d.customer_id), '');
      insert into public.support_notifications(user_id, kind, title, link)
      select p.id, 'asama', ref || ' · ' || (nm->>p_stage) || ' ' || case p_status when 'bitti' then 'bitti' else 'gerekmiyor' end || ' → sıra sizde: ' || (nm->>nxt), '#/kayit/' || p_deal
      from public.profiles p
      where p.id is distinct from auth.uid()
        and (nxt = any(p.departments) and p.roles && array['production','admin']
             or (nxt = 'gonderim' and not exists (select 1 from public.profiles z where 'gonderim' = any(z.departments)) and 'orders' = any(p.roles)));
    end if;
  end if;
  return to_jsonb(r);
end $function$;

-- daha sonraki bir aşaması başlamış / bitmiş siparişlerde Tedarik tamamlanmış sayılır; zaman = o siparişteki en eski aşama zamanı
-- (yoksa sipariş tarihi), böylece "bu aşamada kaç gündür" sayacı ve sipariş zaman çizelgesi bugüne kaymaz
insert into public.deal_stages (deal_id, stage, status, note, started_at, done_at, updated_by_name, updated_at)
select d.id, 'tedarik', 'bitti', 'Tedarik aşaması eklenmeden önce sonraki aşamaya geçmişti', t0, t0, 'Sistem', t0
from (select d.id, coalesce((select min(least(coalesce(s.started_at, s.done_at), coalesce(s.done_at, s.started_at))) from public.deal_stages s where s.deal_id = d.id),
                            d.order_date::timestamptz, now()) t0
      from public.deals d
      where exists (select 1 from public.deal_stages s where s.deal_id = d.id and s.status <> 'bekliyor')) d
on conflict (deal_id, stage) do nothing;
