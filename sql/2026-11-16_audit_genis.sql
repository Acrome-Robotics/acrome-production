-- "Kim neyi değiştirdi" kaydı (audit_log) talepler, stok, daily, masraf ve kalite tablolarına genişletilir.
-- Yalnız oturum açmış kişinin yaptığı değişiklik yazılır (senkron / cron işleri yazılmaz).
-- Okuma: her kayıt, kaynak tablosunu okuyabilen kişiye görünür (masraf formu yalnız sahibi + muhasebe/yönetici).

-- daily_notes'ta id yok: satır anahtarı person_id:day
create or replace function public.audit_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.audit_log(table_name,row_id,action,changed_by,changed_by_email,old_data,new_data)
  values (tg_table_name,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'deal_id', to_jsonb(old)->>'deal_id',
                   coalesce(to_jsonb(new), to_jsonb(old))->>'person_id' || ':' || (coalesce(to_jsonb(new), to_jsonb(old))->>'day')),
          tg_op, auth.uid(), (select email from public.profiles where id = auth.uid()),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $function$;

drop trigger if exists audit_purchases on public.purchases;
create trigger audit_purchases after insert or delete or update on public.purchases for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_stock_items on public.stock_items;
create trigger audit_stock_items after insert or delete or update on public.stock_items for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_daily_notes on public.daily_notes;
create trigger audit_daily_notes after insert or delete or update on public.daily_notes for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_expense_reports on public.expense_reports;
create trigger audit_expense_reports after insert or delete or update on public.expense_reports for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_ncr on public.ncr;
create trigger audit_ncr after insert or delete or update on public.ncr for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_kys_records on public.kys_records;
create trigger audit_kys_records after insert or delete or update on public.kys_records for each row when (auth.uid() is not null) execute function audit_trg();
drop trigger if exists audit_q_devices on public.q_devices;
create trigger audit_q_devices after insert or delete or update on public.q_devices for each row when (auth.uid() is not null) execute function audit_trg();

-- okuma: eski tablolar (sipariş, kalem, müşteri, ödeme) eskisi gibi; yenileri kaynak tablonun okuma kuralıyla
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  case table_name
    when 'purchases'       then can_read_app()
    when 'stock_items'     then can_read_app()
    when 'daily_notes'     then can_attend()
    when 'expense_reports' then has_role(array['muhasebe','admin']) or exists (select 1 from public.expense_reports x where x.id = audit_log.row_id::bigint and x.user_id = (select auth.uid()))
    when 'ncr'             then q_read()
    when 'q_devices'       then q_read()
    when 'kys_records'     then q_admin()
    else has_role(array['viewer','sales','production','orders','support','purchasing','stock','admin'])
  end
);
