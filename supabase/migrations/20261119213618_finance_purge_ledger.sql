create function finance_private.purge_ledger(p_confirmation text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  client_users uuid[];
begin
  perform finance_private.assert_owner();
  if p_confirmation is distinct from 'PURGE-VELMURUGAN-FINANCE' then
    raise exception 'Exact confirmation phrase required';
  end if;

  lock table public.finance_profiles, public.finance_clients,
    public.finance_loans, public.finance_payments, public.finance_interest_charges,
    public.finance_queries, public.finance_query_messages, public.finance_vault_items,
    public.finance_audit_events, finance_private.credential_resets,
    finance_private.disbursement_requests in share row exclusive mode;

  select array_agg(user_id) into client_users
  from public.finance_profiles where role = 'client';

  delete from public.finance_query_messages;
  delete from public.finance_queries;
  delete from public.finance_vault_items;
  delete from finance_private.credential_resets;
  delete from finance_private.disbursement_requests;
  delete from public.finance_payments;
  delete from public.finance_interest_charges;
  delete from public.finance_loans;
  delete from public.finance_audit_events;
  delete from public.finance_clients;
  delete from public.finance_profiles where role = 'client';
  delete from auth.users where id = any(client_users);
end;
$$;

create function public.finance_purge_ledger(p_confirmation text)
returns void language sql security invoker set search_path = '' as $$
  select finance_private.purge_ledger(p_confirmation);
$$;

revoke all on function finance_private.purge_ledger(text) from public, anon;
revoke all on function public.finance_purge_ledger(text) from public, anon;
grant execute on function finance_private.purge_ledger(text) to authenticated;
grant execute on function public.finance_purge_ledger(text) to authenticated;
