-- Son hareketler paneli canlı güncellensin: audit_log'a eklenen satır Realtime ile tarayıcıya bildirilir
-- (Realtime RLS'e uyar: her kişi yalnız audit_read'in izin verdiği satırları alır).
alter publication supabase_realtime add table public.audit_log;

-- üretim aşaması değişiklikleri de kayda girsin (panelde "aşama bitti" anında görünsün)
drop trigger if exists audit_deal_stages on public.deal_stages;
create trigger audit_deal_stages after insert or delete or update on public.deal_stages for each row when (auth.uid() is not null) execute function audit_trg();
