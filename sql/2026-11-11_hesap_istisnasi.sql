-- Hesap açma kuralı aynı kalır (yalnız @acrome.net); tek tek adres istisnası verilebilir.
-- İstisna adresleri repoda tutulmaz (repo herkese açık); veritabanına elle eklenir:
--   insert into public.signup_exceptions(email, note) values ('<adres>', '<neden>');

create table if not exists public.signup_exceptions (
  email text primary key check (email = lower(trim(email))),
  note text,
  added_at timestamptz not null default now()
);
alter table public.signup_exceptions enable row level security; -- politika yok: yalnız aşağıdaki fonksiyonlar okur

create or replace function public.email_allowed(p_email text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select lower(coalesce(p_email, '')) ~ '^[^@]+@acrome\.net$'
      or exists (select 1 from public.signup_exceptions where email = lower(trim(p_email)))
$function$;
revoke all on function public.email_allowed(text) from public, anon, authenticated;

create or replace function public.enforce_acrome_domain()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.email_allowed(new.email) then
    raise exception 'Yalnızca @acrome.net e-posta adresleriyle hesap açılabilir';
  end if;
  return new;
end $function$;

create or replace function public.app_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select role from public.profiles where id = auth.uid() and public.email_allowed(email)), 'anon');
$function$;

create or replace function public.app_roles()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select roles from profiles where id = auth.uid() and public.email_allowed(email)), '{}'::text[]) $function$;
