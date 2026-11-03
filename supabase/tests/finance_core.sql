\set ON_ERROR_STOP on
begin;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003');
insert into public.finance_profiles values
 ('00000000-0000-0000-0000-000000000001','owner',true),
 ('00000000-0000-0000-0000-000000000002','client',true),
 ('00000000-0000-0000-0000-000000000003','client',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","session_id":"00000000-0000-0000-0000-000000000010"}',false);
set local role authenticated;
do $$ begin
 begin
  perform public.finance_create_client('FAIL001','Blocked owner');
  raise exception 'TEST FAIL: owner without email grant got access';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into finance_private.owner_verifications values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010',now()+interval '1 hour');
set local role authenticated;
select public.finance_create_client('TEST001','Client One') as client_one \gset
select public.finance_create_client('TEST002','Client Two') as client_two \gset
select public.finance_create_loan(:'client_one',100000,5,(date_trunc('month',now() at time zone 'Asia/Kolkata')-interval '2 months'+interval '19 days')::date,true) as loan_one \gset
select public.finance_create_loan(:'client_two',200000,3,(now() at time zone 'Asia/Kolkata')::date,true) as loan_two \gset
select set_config('test.loan',:'loan_one',false);
select set_config('test.other_loan',:'loan_two',false);
do $$ declare b jsonb; r public.finance_payments; retry public.finance_payments; n int; begin
 b:=public.finance_loan_snapshot(current_setting('test.loan')::uuid);
 if (b->>'interest')::numeric<>5000 then raise exception 'TEST FAIL: expected one 5000 charge, got %',b; end if;
 perform public.finance_loan_snapshot(current_setting('test.loan')::uuid);
 select count(*) into n from public.finance_interest_charges where loan_id=current_setting('test.loan')::uuid;
 if n<>1 then raise exception 'TEST FAIL: duplicate interest charges'; end if;
 r:=public.finance_record_payment('00000000-0000-0000-0000-000000000020',current_setting('test.loan')::uuid,7000,(now() at time zone 'Asia/Kolkata')::date,'cash');
 if r.interest_paid<>5000 or r.principal_paid<>2000 then raise exception 'TEST FAIL: interest-first split'; end if;
 retry:=public.finance_record_payment('00000000-0000-0000-0000-000000000020',current_setting('test.loan')::uuid,7000,(now() at time zone 'Asia/Kolkata')::date,'cash');
 if retry.id<>r.id then raise exception 'TEST FAIL: duplicate retry'; end if;
 begin
  perform public.finance_record_payment('00000000-0000-0000-0000-000000000020',current_setting('test.loan')::uuid,7001,(now() at time zone 'Asia/Kolkata')::date,'cash');
  raise exception 'TEST FAIL: accepted mismatched retry';
 exception when others then if sqlerrm not like '%payload mismatch%' then raise; end if; end;
 begin
  perform public.finance_record_payment(gen_random_uuid(),current_setting('test.loan')::uuid,1000000,(now() at time zone 'Asia/Kolkata')::date,'cash');
  raise exception 'TEST FAIL: overpayment accepted';
 exception when others then if sqlerrm not like '%exceeds%' then raise; end if; end;
 b:=public.finance_loan_snapshot(current_setting('test.loan')::uuid);
 if (b->>'principal')::numeric<>98000 or (b->>'interest')::numeric<>0 then raise exception 'TEST FAIL: balance'; end if;
 if (b->>'next_interest_estimate')::numeric<>4900 then raise exception 'TEST FAIL: estimate'; end if;
 begin
  update public.finance_loans set monthly_rate=0;
  raise exception 'TEST FAIL: direct financial write';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.finance_clients set auth_user_id='00000000-0000-0000-0000-000000000002' where id=:'client_one';
update public.finance_clients set auth_user_id='00000000-0000-0000-0000-000000000003' where id=:'client_two';
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002"}',false);
set local role authenticated;
do $$ declare n int; begin
 select count(*) into n from public.finance_clients;
 if n<>1 then raise exception 'TEST FAIL: client isolation'; end if;
 select count(*) into n from public.finance_loans;
 if n<>1 then raise exception 'TEST FAIL: loan isolation'; end if;
 select count(*) into n from public.finance_audit_events;
 if n<>0 then raise exception 'TEST FAIL: audit exposure'; end if;
 begin
  perform public.finance_loan_snapshot(current_setting('test.other_loan')::uuid);
  raise exception 'TEST FAIL: other-client snapshot';
 exception when insufficient_privilege then null; end;
 begin
  perform public.finance_record_payment(gen_random_uuid(),current_setting('test.loan')::uuid,1,(now() at time zone 'Asia/Kolkata')::date,'cash');
  raise exception 'TEST FAIL: client financial write';
 exception when insufficient_privilege then null; end;
 begin
  perform finance_private.balance(current_setting('test.other_loan')::uuid);
  raise exception 'TEST FAIL: private helper exposure';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.finance_profiles set active=false where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ declare n int; begin
 select count(*) into n from public.finance_loans;
 if n<>0 then raise exception 'TEST FAIL: disabled session can read'; end if;
end $$;
reset role;
do $$ begin
 if finance_private.following_month_end('2028-01-31')<>'2028-02-29'::date then raise exception 'TEST FAIL: leap month'; end if;
 if finance_private.following_month_end('2026-12-31')<>'2027-01-31'::date then raise exception 'TEST FAIL: year rollover'; end if;
end $$;
rollback;
\echo 'PASS: core financial calculations, idempotency, grants, RLS isolation and disabled-session tests'
