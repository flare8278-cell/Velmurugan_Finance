create index finance_audit_actor on public.finance_audit_events(actor);
create index finance_loans_approver on public.finance_loans(terms_approved_by);
create index finance_payments_actor on public.finance_payments(actor);
create index finance_messages_author on public.finance_query_messages(author);
alter policy profile_read on public.finance_profiles using (user_id=(select auth.uid()) or (select finance_private.is_owner()));
