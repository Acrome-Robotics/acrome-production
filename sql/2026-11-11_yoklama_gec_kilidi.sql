-- Yöneticinin "G" (geç geldi) işaretlediği hücreyi kişi değiştiremez / silemez; yalnız saatini girer (att_times ayrı, etkilenmez).
-- Yönetici dışındakilerin yazdığı hücreler eskisi gibi serbest.

alter table public.att_days add column if not exists admin_lock boolean not null default false;

create or replace function public.att_days_lock_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare adm boolean := public.has_role(array['admin']);
begin
  if tg_op in ('UPDATE', 'DELETE') and old.admin_lock and not adm then
    raise exception 'Bu günü yönetici geç olarak işaretledi; yalnız geliş / çıkış saatini girebilirsin';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.admin_lock := adm and new.code = 'G';
  return new;
end $function$;

drop trigger if exists att_days_lock on public.att_days;
create trigger att_days_lock before insert or update or delete on public.att_days
  for each row execute function public.att_days_lock_trg();
