-- Her aktif ürünün (boş da olsa) bir aktif ürün BOM'u olsun: tedarik planı yalnız ürün BOM'u olanları hesaba katıyor.
-- İki kez çalıştırmak zararsız: fonksiyon create or replace, tetikleyici düşürülüp yeniden kurulur, toplu açma "yoksa" ekler.
-- short_code boş bırakılır: kısıt/kural yok, kodda okunmuyor; parça kodu grupları (CODE_GRP) app.js'de sabit.

-- 1) Ürün eklenince ya da pasiften aktife geçince aktif ürün BOM'u yoksa boş BOM aç.
-- security invoker: ürünü yalnız yönetici ekler/günceller (products RLS), yönetici boms_ins (can_stock) iznine de sahip.
create or replace function public.products_ensure_bom() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.active is not false and (tg_op = 'INSERT' or old.active is false) then
    insert into public.boms(kind, product_code, name, status, source)
    select 'product', new.code, new.name, 'aktif', 'Otomatik / ürün kaydı'
    where not exists (select 1 from public.boms b where b.kind = 'product' and b.product_code = new.code and b.status = 'aktif');
  end if;
  return null;
end $$;

drop trigger if exists products_ensure_bom on public.products;
create trigger products_ensure_bom after insert or update of active on public.products
  for each row execute function public.products_ensure_bom();

-- 2) Mevcut aktif ürünlerden aktif ürün BOM'u olmayanlara boş BOM aç.
insert into public.boms(kind, product_code, name, status, source)
select 'product', p.code, p.name, 'aktif', 'Otomatik / ürün kaydı'
from public.products p
where p.active is not false
  and not exists (select 1 from public.boms b where b.kind = 'product' and b.product_code = p.code and b.status = 'aktif');
