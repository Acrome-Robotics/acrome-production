-- Support kayıt kodu / müşteri e-postasını geri al (kod sütunu veride kalır, zararsız; istenirse en sonda düşürülür).
drop trigger if exists support_ticket_code on public.support_tickets;
drop function if exists public.support_ticket_ack(bigint);
drop policy if exists sup_m_ins on public.support_messages;
create policy sup_m_ins on public.support_messages for insert to public
  with check (has_role(array['admin']) or (has_role(array['support']) and source = any (array['note','call','meet']) and direction = 'internal'));
drop policy if exists sup_m_upd on public.support_messages;
create policy sup_m_upd on public.support_messages for update to public
  using (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet'])))
  with check (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet'])));
drop policy if exists sup_m_del on public.support_messages;
create policy sup_m_del on public.support_messages for delete to public
  using (has_role(array['admin']) or (has_role(array['support']) and created_by = (select auth.uid()) and source = any (array['note','call','meet'])));
-- alter table public.support_tickets drop column code;
