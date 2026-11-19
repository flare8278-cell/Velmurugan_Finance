\set ON_ERROR_STOP on
begin;

-- 1. Setup owner and client
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000201','imran5426117@gmail.com'),
 ('00000000-0000-0000-0000-000000000202','clientmgmt@example.invalid');

insert into auth.sessions(id,user_id) values
 ('00000000-0000-0000-0000-000000000210','00000000-0000-0000-0000-000000000201'),
 ('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000202');

insert into public.finance_profiles values
 ('00000000-0000-0000-0000-000000000201','owner',true),
 ('00000000-0000-0000-0000-000000000202','client',true);

insert into finance_private.owner_verifications values
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000210',now()+interval '1 hour');

-- Set owner context
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000210"}',false);
set local role authenticated;

-- Create test client and loan
select public.finance_create_client('MGMT001','Original Name','9876543210','Original Address','Original Work') as c_id \gset
select public.finance_disburse('00000000-0000-0000-0000-000000000230',:'c_id',50000,4.5,(now() at time zone 'Asia/Kolkata')::date,true) as l_id \gset

select set_config('test.client', :'c_id', false);
select set_config('test.loan', :'l_id', false);

-- 2. Test finance_update_client
select public.finance_update_client(:'c_id','Updated Name','9998887776','Updated Address','Updated Work');

do $$ declare c record; begin
  select * into c from public.finance_clients where id = current_setting('test.client')::uuid;
  if c.name <> 'Updated Name' or c.phone <> '9998887776' or c.address <> 'Updated Address' or c.work <> 'Updated Work' then
    raise exception 'Client update did not persist correctly: %', c;
  end if;
end $$;

-- 3. Test finance_update_loan_rate
select public.finance_update_loan_rate(:'l_id', 3.0);

do $$ declare l record; begin
  select * into l from public.finance_loans where id = current_setting('test.loan')::uuid;
  if l.monthly_rate <> 3.0 then
    raise exception 'Loan rate update did not persist: %', l;
  end if;
end $$;

-- 4. Record a payment to have history
select public.finance_record_payment('00000000-0000-0000-0000-000000000240',:'l_id',1000,(now() at time zone 'Asia/Kolkata')::date,'cash');

-- 5. Test finance_delete_client_history
select public.finance_delete_client_history(:'c_id');

do $$ begin
  if exists(select 1 from public.finance_clients where id = current_setting('test.client')::uuid) then
    raise exception 'Client record still exists after deletion';
  end if;
  if exists(select 1 from public.finance_loans where id = current_setting('test.loan')::uuid) then
    raise exception 'Loan record still exists after deletion';
  end if;
  if exists(select 1 from public.finance_payments where loan_id = current_setting('test.loan')::uuid) then
    raise exception 'Payment record still exists after deletion';
  end if;
end $$;

-- 6. Verify non-owner cannot call these RPCs
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000202","session_id":"00000000-0000-0000-0000-000000000211"}',false);

do $$ begin
  begin
    perform public.finance_update_loan_rate(gen_random_uuid(), 2.0);
    raise exception 'Non-owner allowed to update loan rate';
  exception when insufficient_privilege then null; end;

  begin
    perform public.finance_update_client(gen_random_uuid(), 'Hacker');
    raise exception 'Non-owner allowed to update client';
  exception when insufficient_privilege then null; end;

  begin
    perform public.finance_delete_client_history(gen_random_uuid());
    raise exception 'Non-owner allowed to delete client';
  exception when insufficient_privilege then null; end;
end $$;


do $$ begin
  begin
    perform public.finance_purge_ledger('PURGE-VELMURUGAN-FINANCE');
    raise exception 'Non-owner allowed to purge';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000201","session_id":"00000000-0000-0000-0000-000000000210"}',false);
select public.finance_create_client('PURGE001','Purge Test','9876543210','','');
do $$ begin
  begin
    perform public.finance_purge_ledger('wrong');
    raise exception 'Missing confirmation accepted';
  exception when raise_exception then
    if sqlerrm <> 'Exact confirmation phrase required' then raise; end if;
  end;
  if not exists(select 1 from public.finance_clients where customer_code='PURGE001') then
    raise exception 'Wrong confirmation deleted records';
  end if;
end $$;
select public.finance_purge_ledger('PURGE-VELMURUGAN-FINANCE');
reset role;
do $$ begin
  if exists(select 1 from public.finance_clients) or exists(select 1 from public.finance_audit_events) then
    raise exception 'Ledger purge left records';
  end if;
  if not exists(select 1 from public.finance_profiles where role='owner') then
    raise exception 'Owner was deleted';
  end if;
end $$;

rollback;
