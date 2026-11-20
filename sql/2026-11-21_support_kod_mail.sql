-- Support: her konuya değişmez kayıt kodu (SUP-00123); elle açılan konuda müşteriye İngilizce kayıt e-postası (ilk not dahil);
-- Kaynak listesine e-posta. Müşteri cevabı konu satırındaki [SUP-…] etiketiyle aynı konuya bağlanır (support-mail-ingest).

alter table public.support_tickets add column if not exists code text;
update public.support_tickets set code = 'SUP-' || lpad(id::text, 5, '0') where code is null;
alter table public.support_tickets alter column code set not null;
create unique index if not exists support_tickets_code_key on public.support_tickets(code);

create or replace function public.support_ticket_code_trg()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then new.code := 'SUP-' || lpad(new.id::text, 5, '0');
  elsif new.code is distinct from old.code then raise exception 'Kayıt kodu değiştirilemez'; end if;
  return new;
end $function$;
drop trigger if exists support_ticket_code on public.support_tickets;
create trigger support_ticket_code before insert or update of code on public.support_tickets
  for each row execute function public.support_ticket_code_trg();

-- müşteriye giden e-posta: hazır metin, yanıt adresi, site bağlantısı yok
alter table public.mail_outbox add column if not exists body_text text, add column if not exists reply_to text;

create or replace function public.support_ticket_ack(p_ticket bigint)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare t public.support_tickets; note text; who text; hi text; txt text;
begin
  if not public.has_role(array['support','admin']) then raise exception 'Bu işlem için Support rolü gerekli'; end if;
  select * into t from public.support_tickets where id = p_ticket;
  if not found then raise exception 'Konu bulunamadı'; end if;
  if coalesce(trim(t.contact_email), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Geçerli bir müşteri e-postası yok'; end if;
  if exists (select 1 from public.mail_outbox where subject like '[' || t.code || ']%') then raise exception 'Bu konu için kayıt e-postası zaten gönderildi'; end if;
  select body into note from public.support_messages where ticket_id = p_ticket order by sent_at, id limit 1;
  who := (select coalesce(full_name, email) from public.profiles where id = auth.uid());
  hi := 'Dear ' || coalesce(nullif(split_part(trim(coalesce(t.customer_name, '')), ' ', 1), ''), 'Customer') || ',';
  txt := hi || E'\n\n'
    || 'Thank you for contacting Acrome. We have opened a support ticket for your request.' || E'\n\n'
    || 'Ticket number: ' || t.code || E'\n'
    || 'Subject: ' || t.subject || E'\n'
    || case when coalesce(trim(note), '') <> '' then E'\nYour request:\n' || trim(note) || E'\n' else '' end
    || E'\nOur team will get back to you as soon as possible. Please keep the ticket number in the subject line when you reply to this e-mail.' || E'\n\n'
    || 'Best regards,' || E'\n' || 'Acrome Support' || E'\n' || 'support@acrome.net';
  insert into public.mail_outbox(to_email, to_name, subject, title, link, body_text, reply_to)
  values (trim(t.contact_email), t.customer_name, '[' || t.code || '] ' || t.subject, t.subject, null, txt, 'support@acrome.net');
  insert into public.support_messages(ticket_id, source, direction, body, from_name, from_email, sent_at)
  values (p_ticket, 'note', 'internal', 'Kayıt e-postası müşteriye gönderilmek üzere sıraya alındı (5 dk içinde gider): ' || trim(t.contact_email) || ' (' || t.code || ')', who,
          (select email from public.profiles where id = auth.uid()), now());
  -- gönderim: mail-kuyrugu-gonder cron'u (5 dk); aynı işlemde flush satırı henüz görmez
  return t.code;
end $function$;
revoke all on function public.support_ticket_ack(bigint) from public, anon;
grant execute on function public.support_ticket_ack(bigint) to authenticated;

-- Kaynak = E-posta (gmail) elle eklenen iç not: Support ekleyebilir; kendi eklediğini düzenler / siler (senkronla gelenlerde created_by boş, korunur)
drop policy if exists sup_m_ins on public.support_messages;
create policy sup_m_ins on public.support_messages for insert to public
  with check (has_role(array['admin']) or (has_role(array['support']) and source = any (array['note','call','meet','gmail']) and direction = 'internal'));
drop policy if exists sup_m_upd on public.support_messages;
create policy sup_m_upd on public.support_messages for update to public
  using (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet','gmail'])))
  with check (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet','gmail'])));
drop policy if exists sup_m_del on public.support_messages;
create policy sup_m_del on public.support_messages for delete to public
  using (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet','gmail'])));
