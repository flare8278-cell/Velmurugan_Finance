-- Migration: 202611190001_client_management.sql
-- Description: Client update, loan rate update, and client history deletion RPCs

begin;

create or replace function public.finance_update_client(
  p_client uuid,
  p_name text,
  p_phone text default '',
  p_address text default '',
  p_work text default ''
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform finance_private.assert_owner();
  if p_name is null or length(trim(p_name)) < 1 or length(trim(p_name)) > 100 then
    raise exception 'Client name must be 1 to 100 characters';
  end if;
  update public.finance_clients
  set name = trim(p_name),
      phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''),
      work = coalesce(p_work, '')
  where id = p_client;
  if not found then
    raise exception 'Client not found';
  end if;
  insert into public.finance_audit_events(actor, action, entity_id)
  values(auth.uid(), 'client.updated', p_client);
end $$;

create or replace function public.finance_update_loan_rate(
  p_loan uuid,
  p_rate numeric
) returns void language plpgsql security definer set search_path='' as $$
begin
  perform finance_private.assert_owner();
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'Monthly interest rate must be between 0 and 100%%';
  end if;
  update public.finance_loans
  set monthly_rate = p_rate
  where id = p_loan;
  if not found then
    raise exception 'Loan not found';
  end if;
  insert into public.finance_audit_events(actor, action, entity_id)
  values(auth.uid(), 'loan.rate_updated', p_loan);
end $$;

create or replace function public.finance_delete_client_history(
  p_client uuid
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_loan_ids uuid[];
  v_query_ids uuid[];
begin
  perform finance_private.assert_owner();

  select coalesce(array_agg(id), '{}') into v_loan_ids
  from public.finance_loans where client_id = p_client;

  select coalesce(array_agg(id), '{}') into v_query_ids
  from public.finance_queries where client_id = p_client;

  -- Delete payments
  delete from public.finance_payments where loan_id = any(v_loan_ids);

  -- Delete interest charges
  delete from public.finance_interest_charges where loan_id = any(v_loan_ids);

  -- Delete disbursement requests
  delete from finance_private.disbursement_requests where loan_id = any(v_loan_ids);

  -- Delete loans
  delete from public.finance_loans where id = any(v_loan_ids);

  -- Delete query messages
  delete from public.finance_query_messages where query_id = any(v_query_ids);

  -- Delete queries
  delete from public.finance_queries where id = any(v_query_ids);

  -- Delete credential resets and vault items
  delete from finance_private.credential_resets where client_id = p_client;
  delete from public.finance_vault_items where client_id = p_client;

  -- Delete client record
  delete from public.finance_clients where id = p_client;
  if not found then
    raise exception 'Client not found';
  end if;

  insert into public.finance_audit_events(actor, action, entity_id)
  values(auth.uid(), 'client.deleted', p_client);
end $$;

revoke all on function public.finance_update_client(uuid,text,text,text,text) from public,anon;
grant execute on function public.finance_update_client(uuid,text,text,text,text) to authenticated;

revoke all on function public.finance_update_loan_rate(uuid,numeric) from public,anon;
grant execute on function public.finance_update_loan_rate(uuid,numeric) to authenticated;

revoke all on function public.finance_delete_client_history(uuid) from public,anon;
grant execute on function public.finance_delete_client_history(uuid) to authenticated;

commit;
