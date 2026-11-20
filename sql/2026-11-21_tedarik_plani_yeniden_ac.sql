-- İptal edilen tedarik planı: yönetici yeniden açar (taslağa döner) ya da kalıcı siler (yalnız iptal durumunda; satırlar cascade, alım talebinde plan bağı null).
create or replace function public.supply_plan_set_status(p_id bigint, p_status text, p_note text DEFAULT NULL::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare pl public.supply_plans; who text;
begin
  select * into pl from public.supply_plans where id = p_id for update;
  if not found then raise exception 'Plan bulunamadı'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  if p_status = 'gonderildi' then
    if not public.can_plan() then raise exception 'Bu işlem için yetkiniz yok'; end if;
    if pl.status <> 'taslak' then raise exception 'Yalnız taslak plan gönderilebilir'; end if;
    if not exists (select 1 from public.supply_plan_lines where plan_id = p_id and order_qty > 0) then raise exception 'Planda alınacak kalem yok'; end if;
    update public.supply_plans set status = 'gonderildi', sent_at = now(), review_note = null, updated_at = now() where id = p_id;
    insert into public.support_notifications(user_id, kind, title, link)
    select id, 'plan', 'Onay bekleyen tedarik planı: ' || left(pl.name, 80) || coalesce(' · ' || round(pl.total_usd)::text || ' $', '') || ' (' || coalesce(who, '') || ')', '#/tedarik/' || p_id
    from public.profiles where roles && array['admin','muhasebe'] and id is distinct from auth.uid();
  elsif p_status = 'taslak' and pl.status = 'iptal' then
    -- iptal edilen planı yönetici yeniden açar: taslağa döner, onay bilgisi temizlenir
    if not public.has_role(array['admin']) then raise exception 'İptal edilen planı yalnız yönetici yeniden açar'; end if;
    update public.supply_plans set status = 'taslak', review_note = coalesce(nullif(trim(p_note), ''), 'İptalden yeniden açıldı (' || coalesce(who, '') || ')'),
      approved_by = null, approved_by_name = null, approved_at = null, updated_at = now() where id = p_id;
  elsif p_status in ('onaylandi', 'taslak') then
    if not public.has_role(array['admin']) then raise exception 'Planı yalnız yönetici onaylar veya geri gönderir'; end if;
    if pl.status <> 'gonderildi' then raise exception 'Yalnız gönderilmiş plan onaylanır veya geri gönderilir'; end if;
    if p_status = 'taslak' and coalesce(trim(p_note), '') = '' then raise exception 'Geri gönderme nedenini yazın'; end if;
    update public.supply_plans set status = p_status, review_note = nullif(trim(p_note), ''),
      approved_by = case when p_status = 'onaylandi' then auth.uid() end, approved_by_name = case when p_status = 'onaylandi' then who end,
      approved_at = case when p_status = 'onaylandi' then now() end, updated_at = now() where id = p_id;
    insert into public.support_notifications(user_id, kind, title, link)
    select u, 'plan', 'Tedarik planı ' || case p_status when 'onaylandi' then 'onaylandı' else 'düzeltme için geri gönderildi' end || ': ' || left(pl.name, 80), '#/tedarik/' || p_id
    from (select pl.created_by u union select id from public.profiles where p_status = 'onaylandi' and 'purchasing' = any(roles)) x
    where u is not null and u is distinct from auth.uid();
  elsif p_status = 'iptal' then
    if not (public.has_role(array['admin']) or (pl.created_by = auth.uid() and pl.status = 'taslak')) then raise exception 'Bu işlem için yetkiniz yok'; end if;
    if pl.status = 'alimlar' then raise exception 'Alım talepleri oluşmuş plan iptal edilemez'; end if;
    update public.supply_plans set status = 'iptal', review_note = coalesce(nullif(trim(p_note), ''), review_note), updated_at = now() where id = p_id;
  else
    raise exception 'Geçersiz durum';
  end if;
end $function$;

create or replace function public.supply_plan_delete(p_id bigint)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare st text;
begin
  if not public.has_role(array['admin']) then raise exception 'Planı yalnız yönetici siler'; end if;
  select status into st from public.supply_plans where id = p_id for update;
  if not found then raise exception 'Plan bulunamadı'; end if;
  if st <> 'iptal' then raise exception 'Yalnız iptal edilmiş plan silinebilir'; end if;
  delete from public.supply_plans where id = p_id;
end $function$;
revoke all on function public.supply_plan_delete(bigint) from public, anon;
grant execute on function public.supply_plan_delete(bigint) to authenticated;
