-- Kullanıcı kararı (14.11): "SMD RED Base Kit" aslında Motion Kit; ürün kodu (SMD_BASE) aynı kalır.
-- Ürüne bağlı olmayan "Smart Motion Devices (SMD)" BOM'u kitlerin ortak parçaları olarak kalır.
update public.products set name = 'SMD RED Motion Kit' where code = 'SMD_BASE' and name = 'SMD RED Base Kit';
update public.boms set name = 'SMD RED Motion Kit' where id = 52 and name = 'SMD RED Base Kit';
update public.boms set name = 'SMD ortak parçalar' where id = 18 and name = 'Smart Motion Devices (SMD)';
