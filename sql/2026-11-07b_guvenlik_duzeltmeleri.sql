-- Gece kod incelemesinde bulunan açıkların düzeltmeleri (7 Kasım 2026). Serhan onaylayınca uygulanacak.
-- Hepsi tek işlemde; yarıda kalırsa hiçbiri uygulanmaz.
begin;

-- 1) Para birimi alanlarına izinli değer kısıtı (arayüzdeki HTML enjeksiyonunun veritabanı tarafı).
--    Canlıda yalnız TRY / USD var (kontrol edildi), mevcut satırlar bozulmaz.
alter table public.purchases drop constraint if exists purchases_currency_ok;
alter table public.purchases add constraint purchases_currency_ok check (currency is null or currency in ('TRY','USD','EUR','GBP'));
alter table public.stock_items drop constraint if exists stock_items_currency_ok;
alter table public.stock_items add constraint stock_items_currency_ok check (currency is null or currency in ('TRY','USD','EUR','GBP'));

-- 2) Masraf tutarı: NaN / sonsuz / aşırı büyük değer olmasın
alter table public.expense_items drop constraint if exists expense_items_amount_sane;
alter table public.expense_items add constraint expense_items_amount_sane check (amount <> 'NaN'::numeric and amount < 1e9);

-- 3) Bir fiş dosyası yalnız bir masraf kalemine bağlanabilir (aynı fişin iki kez ödenmesini önler)
create unique index if not exists expense_items_receipt_uq on public.expense_items(receipt_path) where receipt_path is not null;

-- 4) Fiş dosyası, bağlı olduğu form incelendikten sonra (onay/ret/ödeme) silinemez
drop policy if exists masraf_owner_delete on storage.objects;
create policy masraf_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'masraf' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.expense_items i join public.expense_reports r on r.id = i.report_id
                         where i.receipt_path = storage.objects.name and r.status <> 'gonderildi'));

-- 5) Masraf gönderimi: fiş dosyası gerçekten var ve gönderene ait olmalı; tutar makul olmalı
create or replace function public.expense_submit(p jsonb) returns bigint
language plpgsql security definer set search_path = 'public' as $$
declare rid bigint; it jsonb; uid uuid := auth.uid(); who text; amt numeric;
begin
  if uid is null or cardinality(public.app_roles()) = 0 then raise exception 'Giriş yapın'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Form başlığı girin'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then raise exception 'En az bir masraf kalemi girin'; end if;
  if jsonb_array_length(p->'items') > 100 then raise exception 'Bir formda en fazla 100 kalem olabilir'; end if;
  who := (select coalesce(full_name, email) from public.profiles where id = uid);
  insert into public.expense_reports(user_id, user_name, title, note) values (uid, who, left(trim(p->>'title'), 200), nullif(left(trim(p->>'note'), 2000), '')) returning id into rid;
  for it in select value from jsonb_array_elements(p->'items') loop
    if (it->>'receipt_path') is not null then
      if split_part(it->>'receipt_path', '/', 1) <> uid::text then raise exception 'Geçersiz dosya yolu'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'masraf' and o.name = it->>'receipt_path') then raise exception 'Fiş dosyası bulunamadı, tekrar yükleyin'; end if;
    end if;
    if (it->>'day')::date > (now() at time zone 'Europe/Istanbul')::date then raise exception 'Masraf tarihi gelecekte olamaz'; end if;
    amt := (it->>'amount')::numeric;
    if amt is null or amt = 'NaN'::numeric or amt <= 0 or amt >= 1e9 then raise exception 'Geçersiz tutar'; end if;
    insert into public.expense_items(report_id, day, category, description, amount, currency, project, receipt_path, receipt_name)
    values (rid, (it->>'day')::date, left(it->>'category', 60), left(trim(it->>'description'), 500), amt, coalesce(it->>'currency', 'TRY'),
            nullif(left(trim(it->>'project'), 120), ''), it->>'receipt_path', left(it->>'receipt_name', 200));
  end loop;
  insert into public.support_notifications(user_id, kind, title, link, pushed_at)
  select p2.id, 'masraf', 'Yeni masraf formu: ' || coalesce(who, '') || ' · ' || left(trim(p->>'title'), 80), '#/masraf/' || rid, now()
  from public.profiles p2 where 'muhasebe' = any(p2.roles) and p2.id <> uid;
  return rid;
end $$;

-- 6) Masraf incelemesi: izinli geçişler; ödenmiş form geri alınamaz; kişi kendi formunu inceleyemez (yönetici hariç)
create or replace function public.expense_review(p_id bigint, p_status text, p_note text default null, p_paid date default null) returns void
language plpgsql security definer set search_path = 'public' as $$
declare r public.expense_reports;
begin
  if not public.has_role(array['muhasebe','admin']) then raise exception 'Bu işlem için yetkiniz yok'; end if;
  if p_status = 'reddedildi' and coalesce(trim(p_note), '') = '' then raise exception 'Reddetme nedenini yazın'; end if;
  select * into r from public.expense_reports where id = p_id for update;
  if not found then raise exception 'Form bulunamadı'; end if;
  if r.user_id = auth.uid() and not public.has_role(array['admin']) then raise exception 'Kendi masraf formunu inceleyemezsin'; end if;
  if not ((r.status = 'gonderildi' and p_status in ('onaylandi','reddedildi'))
       or (r.status = 'onaylandi' and p_status in ('odendi','gonderildi'))
       or (r.status = 'reddedildi' and p_status = 'gonderildi')) then
    raise exception 'Bu durum değişikliğine izin yok (% → %)', r.status, p_status;
  end if;
  if p_status = 'odendi' and p_paid is not null and (p_paid > (now() at time zone 'Europe/Istanbul')::date or p_paid < r.created_at::date) then
    raise exception 'Ödeme tarihi geçersiz';
  end if;
  update public.expense_reports set status = p_status,
    review_note = coalesce(nullif(trim(p_note), ''), case when p_status = 'gonderildi' then null else review_note end),
    paid_at = case when p_status = 'odendi' then coalesce(p_paid, (now() at time zone 'Europe/Istanbul')::date) else null end,
    reviewed_by = case when p_status = 'gonderildi' then null else auth.uid() end,
    reviewed_by_name = case when p_status = 'gonderildi' then null else (select coalesce(full_name, email) from public.profiles where id = auth.uid()) end,
    reviewed_at = case when p_status = 'gonderildi' then null else now() end
  where id = p_id;
  if p_status <> 'gonderildi' then
    insert into public.support_notifications(user_id, kind, title, link, pushed_at)
    values (r.user_id, 'masraf', 'Masraf formun: ' || case p_status when 'onaylandi' then 'onaylandı' when 'reddedildi' then 'reddedildi' else 'ödendi' end || ' · ' || left(r.title, 80), '#/masraf/' || p_id, now());
  end if;
end $$;

-- 7) Bölüm kısıtı doğrudan tablo güncellemesiyle aşılmasın: Gönderim bölümü olmayan Üretim kullanıcısı siparişi "Gönderildi" yapamaz
create or replace function public.deals_validate() returns trigger
language plpgsql set search_path to 'public' as $function$
declare r text := public.app_role();
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;

  -- Üretim rolü sadece üretim alanlarını değiştirebilir
  if tg_op = 'UPDATE' and has_role(array['production']) and not has_role(array['sales','orders','admin']) then
    if (to_jsonb(new) - array['planned_ship_date','ship_date','status','delay_reason','updated_at','updated_by'])
       is distinct from (to_jsonb(old) - array['planned_ship_date','ship_date','status','delay_reason','updated_at','updated_by']) then
      raise exception 'Üretim rolü yalnızca planlanan sevk, sevk tarihi, durum ve gecikme açıklamasını değiştirebilir';
    end if;
    if new.status is distinct from old.status and not (old.status in ('production','shipped') and new.status in ('production','shipped')) then
      raise exception 'Üretim rolü durumu yalnızca Üretimde ↔ Gönderildi arasında değiştirebilir';
    end if;
    if new.status is distinct from old.status and not public.can_stage('gonderim') then
      raise exception 'Siparişi Gönderildi yapmak Gönderim bölümünün işidir';
    end if;
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status or new.stage is distinct from old.stage then
    if new.stage = 'won' and new.order_no is null and not new.is_internal then
      raise exception 'Kazanılan kayıt için sipariş numarası (ACRPO-xxx) zorunlu';
    end if;
    if new.status in ('production','shipped') and new.order_date is null then
      raise exception 'Sipariş için sipariş tarihi zorunlu';
    end if;
    if new.status = 'shipped' and new.ship_date is null and tg_op = 'UPDATE' and old.status <> 'shipped' then
      raise exception 'Gönderildi durumuna geçerken sevk tarihi zorunlu';
    end if;
    if new.status = 'pipeline' and new.opp_no is null then
      raise exception 'Fırsat için PROS numarası zorunlu';
    end if;
  end if;

  if new.ship_date is not null and new.order_date is not null and new.ship_date < new.order_date
     and (tg_op='INSERT' or new.ship_date is distinct from old.ship_date or new.order_date is distinct from old.order_date) then
    raise exception 'Sevk tarihi sipariş tarihinden önce olamaz';
  end if;
  if new.requested_ship_date is not null and new.order_date is not null and new.requested_ship_date < new.order_date
     and (tg_op='INSERT' or new.requested_ship_date is distinct from old.requested_ship_date or new.order_date is distinct from old.order_date) then
    raise exception 'İstenen sevk tarihi sipariş tarihinden önce olamaz';
  end if;
  if (tg_op='INSERT' or new.ship_date is distinct from old.ship_date) and new.ship_date > current_date + 1 then
    raise exception 'Sevk tarihi gelecekte olamaz (planlanan tarih alanını kullanın)';
  end if;
  return new;
end $function$;

-- 8) Gönderim aşaması "Gerekmiyor" olamaz (sipariş sonsuza dek üretimde kalırdı)
create or replace function public.deal_stages_guard_trg() returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.stage = 'gonderim' and new.status = 'gerekmiyor' then raise exception 'Gönderim aşaması atlanamaz; sevk tarihiyle "Gönderildi" yapın'; end if;
  return new;
end $$;
drop trigger if exists deal_stages_guard on public.deal_stages;
create trigger deal_stages_guard before insert or update on public.deal_stages for each row execute function public.deal_stages_guard_trg();

commit;
