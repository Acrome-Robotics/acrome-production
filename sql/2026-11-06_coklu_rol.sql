-- Çoklu rol: Sipariş / Support ayrımı, Satın alma, Depo / Stok
-- Onay bekliyor (yönetici onayıyla uygulanacak). Uygulanınca mevcut "Sipariş + Support" kullanıcıları Sipariş + Support rollerini birlikte alır.
begin;
alter table profiles add column if not exists roles text[] not null default '{}';
alter table profiles add constraint profiles_roles_check check (roles <@ array['viewer','sales','production','orders','support','purchasing','stock','admin']);
update profiles set roles = case role when 'pending' then '{}'::text[] when 'support' then array['orders','support'] else array[role] end;
create or replace function public.primary_role(r text[]) returns text language sql immutable as $$
  select case when 'admin' = any(r) then 'admin' when r && array['orders','support'] then 'support' when 'production' = any(r) then 'production'
    when 'sales' = any(r) then 'sales' when cardinality(r) > 0 then 'viewer' else 'pending' end $$;
create or replace function public.profiles_roles_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.roles is distinct from old.roles then
    new.roles := array(select distinct x from unnest(new.roles) x order by 1);
    if tg_op = 'INSERT' and cardinality(new.roles) = 0 and new.role is distinct from 'pending' then
      new.roles := case new.role when 'support' then array['orders','support'] else array[new.role] end;
    end if;
    new.role := primary_role(new.roles);
  elsif new.role is distinct from old.role then
    new.roles := case new.role when 'pending' then '{}'::text[] when 'support' then array['orders','support'] else array[new.role] end;
  end if;
  return new;
end $$;
create trigger profiles_roles_sync before insert or update on profiles for each row execute function profiles_roles_sync();
create or replace function public.app_roles() returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce((select roles from profiles where id = auth.uid() and lower(email) like '%@acrome.net'), '{}'::text[]) $$;
create or replace function public.has_role(r text[]) returns boolean language sql stable security definer set search_path to 'public' as $$
  select app_roles() && r $$;
create or replace function public.can_read_app() returns boolean language sql stable security definer set search_path to 'public' as $$
  select cardinality(app_roles()) > 0 $$;
create or replace function public.can_stock() returns boolean language sql stable security definer set search_path to 'public' as $$
  select has_role(array['production','stock','orders','admin']) $$;
create or replace function public.can_purchase() returns boolean language sql stable security definer set search_path to 'public' as $$
  select has_role(array['production','stock','purchasing','orders','admin']) $$;
grant execute on function public.app_roles(), public.has_role(text[]), public.can_read_app(), public.can_stock(), public.can_purchase() to authenticated;
-- app_role() kullanan tüm politikalar has_role() ile yeniden yazılır; okuma listelerine yeni roller eklenir;
-- sipariş tablolarında (customers, deals, deal_items, import_issues) 'support' yerine 'orders' gelir.
do $$ declare p record; q text; c text;
  readlist constant text := 'ARRAY[''viewer''::text, ''sales''::text, ''production''::text, ''orders''::text, ''support''::text, ''purchasing''::text, ''stock''::text, ''admin''::text]';
begin
  for p in select * from pg_policies where schemaname = 'public' and (qual ilike '%app_role()%' or with_check ilike '%app_role()%') loop
    q := p.qual; c := p.with_check;
    if q is not null then
      q := regexp_replace(q, 'ARRAY\[[^\]]*''viewer''[^\]]*\]', readlist, 'g');
      if p.tablename in ('customers','deals','deal_items','import_issues') then q := replace(q, '''support''::text', '''orders''::text'); end if;
      q := regexp_replace(q, 'app_role\(\) = ANY \((ARRAY\[[^\]]*\])\)', 'has_role(\1)', 'g');
      q := regexp_replace(q, 'app_role\(\) = (''[a-z]+''::text)', 'has_role(ARRAY[\1])', 'g');
      q := replace(replace(q, 'app_role() <> ''pending''::text', 'can_read_app()'), 'app_role() <> ''anon''::text', 'can_read_app()');
    end if;
    if c is not null then
      c := regexp_replace(c, 'ARRAY\[[^\]]*''viewer''[^\]]*\]', readlist, 'g');
      if p.tablename in ('customers','deals','deal_items','import_issues') then c := replace(c, '''support''::text', '''orders''::text'); end if;
      c := regexp_replace(c, 'app_role\(\) = ANY \((ARRAY\[[^\]]*\])\)', 'has_role(\1)', 'g');
      c := regexp_replace(c, 'app_role\(\) = (''[a-z]+''::text)', 'has_role(ARRAY[\1])', 'g');
      c := replace(replace(c, 'app_role() <> ''pending''::text', 'can_read_app()'), 'app_role() <> ''anon''::text', 'can_read_app()');
    end if;
    if q is not null and c is not null then execute format('alter policy %I on %I using (%s) with check (%s)', p.policyname, p.tablename, q, c);
    elsif q is not null then execute format('alter policy %I on %I using (%s)', p.policyname, p.tablename, q);
    else execute format('alter policy %I on %I with check (%s)', p.policyname, p.tablename, c); end if;
  end loop;
end $$;
alter policy purchases_ins on purchases with check (can_read_app() and (can_purchase() or status = 'talep'));
alter policy purchases_upd on purchases using (can_purchase() or (created_by = auth.uid() and status = 'talep')) with check (can_purchase() or (created_by = auth.uid() and status = 'talep'));
alter policy suppliers_ins on suppliers with check (can_purchase());
alter policy suppliers_upd on suppliers using (can_purchase()) with check (can_purchase());
alter policy suppliers_del on suppliers using (can_purchase());
-- fonksiyonlardaki rol kontrolleri
create or replace function public.support_people() returns table(id uuid, name text, email text) language sql stable security definer set search_path to 'public' as $$
  select p.id, coalesce(p.full_name, p.email), p.email from profiles p where can_read_app() and cardinality(p.roles) > 0 order by 2 $$;
commit;
-- Not: deals_validate / save_deal / support_merge / support_push_test / admin_import / stock_admin_import gövdeleri
-- has_role() kullanacak şekilde ayrıca güncellenecek (uygulama sırasında Claude yapar).
