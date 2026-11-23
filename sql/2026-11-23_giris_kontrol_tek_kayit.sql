-- Giriş kontrolü tek kayıt: alımın giriş kontrolü FR-KD-01 formuyla yapılır (form data.purchase_id ile alıma bağlı).
-- Depo / Stok rolü formu açabilsin: içerik ve proje adları okunur, yalnız FR-KD-01 kayıtları okunur / yazılır.
drop policy if exists kys_content_read_stock on public.kys_content;
create policy kys_content_read_stock on public.kys_content for select to authenticated using ((select public.has_role(array['stock'])));
drop policy if exists kys_projects_read_stock on public.kys_projects;
create policy kys_projects_read_stock on public.kys_projects for select to authenticated using ((select public.has_role(array['stock'])));
drop policy if exists kys_records_kd_read on public.kys_records;
drop policy if exists kys_records_kd_ins on public.kys_records;
drop policy if exists kys_records_kd_upd on public.kys_records;
create policy kys_records_kd_read on public.kys_records for select to authenticated
  using (code = 'ACR-FR-KD-01' and kind = 'form' and (select public.has_role(array['stock'])));
create policy kys_records_kd_ins on public.kys_records for insert to authenticated
  with check (code = 'ACR-FR-KD-01' and kind = 'form' and (select public.has_role(array['stock'])));
create policy kys_records_kd_upd on public.kys_records for update to authenticated
  using (code = 'ACR-FR-KD-01' and kind = 'form' and (select public.has_role(array['stock'])))
  with check (code = 'ACR-FR-KD-01' and kind = 'form' and (select public.has_role(array['stock'])));

-- bir alımın tek giriş kontrol formu olur
create unique index if not exists kys_records_kd_purchase on public.kys_records ((data->>'purchase_id'))
  where code = 'ACR-FR-KD-01' and kind = 'form' and data ? 'purchase_id';

-- İçerik: FR-KD-01 Rev 02 (Şartlı kabul kararı, Kullanıldığı ürün / PO / seri no alanı), FR-KY-01 Rev 01 (ESA proje bağı kaldırıldı).
-- Revizyon değişince kys_content_rev tetikleyicisi eski hali kys_item_revs'e arşivler. Yedek: snap_20261120.kys_content_20261123.
create table if not exists snap_20261120.kys_content_20261123 as select * from public.kys_content;
update public.kys_content c set modules = (
  select jsonb_agg(m || jsonb_build_object('items', coalesce((
    select jsonb_agg(case
      when i->>'code' = 'ACR-FR-KY-01' then (i - 'pk') || jsonb_build_object('rev', '01', 'date', '23.11.2026',
        'history', coalesce(i->'history', '[]'::jsonb) || '[["01", "23.11.2026", "Şirket geneli forma çevrildi; ESA Pedestal proje bağı kaldırıldı"]]'::jsonb,
        -- program tablosu ve tetkik kriteri belgenin içeriğidir: proje bağı olmadan da dolu gelir
        'groups', (select jsonb_agg(g || jsonb_build_object('fields', coalesce((
          select jsonb_agg(case when f->>'l' in ('Tetkik programı', 'Tetkik kriteri') then f || '{"fixed": true}'::jsonb else f end order by o)
          from jsonb_array_elements(g->'fields') with ordinality x(f, o)), '[]'::jsonb)) order by go) from jsonb_array_elements(i->'groups') with ordinality y(g, go)))
      when i->>'code' = 'ACR-FR-KD-01' then i || jsonb_build_object('rev', '02', 'date', '23.11.2026',
        'history', coalesce(i->'history', '[]'::jsonb) || '[["02", "23.11.2026", "Alımın giriş kontrolü ile tek kayıt oldu: form alım sayfasından açılır, karar stoğa işlenir; Şartlı kabul kararı ve Kullanıldığı ürün / PO / seri no alanı eklendi"]]'::jsonb,
        'groups', (select jsonb_agg(case
          when g->>'h' = 'A. Denetim' then g || jsonb_build_object('fields', (
            select jsonb_agg(f order by o) from (
              select f, o::numeric o from jsonb_array_elements(g->'fields') with ordinality x(f, o)
              union all
              select '{"l": "Kullanıldığı ürün / PO / seri no", "t": "text", "w": 3, "hint": "Malzemenin kullanılacağı ürün; sipariş (PO) numarası ya da çok ürünlü projede ürün seri numaraları"}'::jsonb,
                     (select o + 0.5 from jsonb_array_elements(g->'fields') with ordinality y(f2, o) where f2->>'l' = 'Seri / lot no')) z))
          when g->>'h' = 'D. Karar' then g || jsonb_build_object('fields', (
            select jsonb_agg(case
              when f->>'l' = 'Sonuç' then f || '{"o": ["Kabul", "Şartlı kabul", "Red"], "hint": "Alıma bağlı formda kaydedince stok girişi yapılır; şartlı kabul Şartlı kabuller listesine düşer"}'::jsonb
              when f->>'l' = 'Notlar' then f || '{"hint": "Şartlı kabulde sorun / sapma burada yazılır (zorunlu)"}'::jsonb
              else f end order by o) from jsonb_array_elements(g->'fields') with ordinality x(f, o)))
          else g end order by go) from jsonb_array_elements(i->'groups') with ordinality y(g, go)))
      else i end order by io) from jsonb_array_elements(m->'items') with ordinality x(i, io)), '[]'::jsonb)) order by mo)
  from jsonb_array_elements(c.modules) with ordinality y(m, mo))
where id = 1;
