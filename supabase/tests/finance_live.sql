\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000101','imran5426117@gmail.com'),
 ('00000000-0000-0000-0000-000000000102','client1@example.invalid'),
 ('00000000-0000-0000-0000-000000000103','client2@example.invalid');
insert into auth.sessions(id,user_id) values
 ('00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000101'),
 ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000102'),
 ('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000103');
insert into public.finance_profiles values
 ('00000000-0000-0000-0000-000000000101','owner',true),
 ('00000000-0000-0000-0000-000000000102','client',true),
 ('00000000-0000-0000-0000-000000000103','client',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000101","session_id":"00000000-0000-0000-0000-000000000110"}',false);
set local role service_role;
select public.finance_service_issue_code('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000120',repeat('a',64));
do $$ begin
 if public.finance_service_verify_trusted_code('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000120',repeat('b',64)) then raise exception 'Wrong code accepted'; end if;
 if not public.finance_service_verify_trusted_code('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000120',repeat('a',64)) then raise exception 'Correct code rejected'; end if;
 if public.finance_service_verify_trusted_code('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110','00000000-0000-0000-0000-000000000120',repeat('a',64)) then raise exception 'Consumed code reused'; end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from finance_private.owner_verifications
   where session_id='00000000-0000-0000-0000-000000000110'
     and expires_at=now()+interval '30 days') then
   raise exception 'Trusted verification was not set for 30 days';
 end if;
end $$;
set local role authenticated;
select public.finance_create_client('LIVE001','Client One') as c1 \gset
select public.finance_create_client('LIVE002','Client Two') as c2 \gset
select public.finance_disburse('00000000-0000-0000-0000-000000000130',:'c1',100000,5,(now() at time zone 'Asia/Kolkata')::date,true) as loan1 \gset
select set_config('test.live.loan',:'loan1',false);
select set_config('test.live.client',:'c1',false);
select set_config('test.live.other',:'c2',false);
do $$ declare duplicate uuid; begin
 duplicate:=public.finance_disburse('00000000-0000-0000-0000-000000000130',current_setting('test.live.client')::uuid,100000,5,(now() at time zone 'Asia/Kolkata')::date,true);
 if duplicate<>current_setting('test.live.loan')::uuid then raise exception 'Disbursement retry duplicated'; end if;
 begin perform public.finance_service_verify_trusted_code('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110',gen_random_uuid(),repeat('a',64)); raise exception 'Service-only RPC exposed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.finance_clients set auth_user_id='00000000-0000-0000-0000-000000000102' where id=:'c1';
update public.finance_clients set auth_user_id='00000000-0000-0000-0000-000000000103' where id=:'c2';
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000102","session_id":"00000000-0000-0000-0000-000000000111"}',false);
set local role authenticated;
select public.finance_update_own_phones('+91 98765-43210','0123456789');
do $$ begin
 if not exists(select 1 from public.finance_clients where id=current_setting('test.live.client')::uuid and phone='+919876543210' and alternate_phone='0123456789') then
   raise exception 'Client contact numbers were not saved';
 end if;
end $$;
select public.finance_ask_question(:'c1','A payment question','Please check my payment.') as query1 \gset
select set_config('test.live.query',:'query1',false);
do $$ declare data jsonb; begin
 data:=public.finance_get_workspace();
 if jsonb_array_length(data->'clients')<>1 or jsonb_array_length(data->'loans')<>1 then raise exception 'Workspace leaked another client'; end if;
 perform public.finance_reply_question(current_setting('test.live.query')::uuid,'My follow-up');
 begin perform public.finance_ask_question(current_setting('test.live.other')::uuid,'Wrong','Wrong');raise exception 'Cross-client question allowed'; exception when insufficient_privilege then null; end;
 begin perform public.finance_save_vault_metadata('{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000}');raise exception 'Client wrote wallet'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from auth.sessions where id='00000000-0000-0000-0000-000000000111';
set local role authenticated;
do $$ begin
 begin perform public.finance_update_own_phones('1234567890',''); raise exception 'Revoked client changed phone'; exception when insufficient_privilege then null; end;
 begin perform public.finance_get_workspace();raise exception 'Revoked client session accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000101","session_id":"00000000-0000-0000-0000-000000000110"}',false);
set local role authenticated;
select public.finance_save_vault_metadata('{"v":1,"kdf":"PBKDF2-SHA256","iterations":600000,"salt":"test-only"}');
select public.finance_create_client('LIVE003','Client With Notes') as c3 \gset
select public.finance_save_vault_item(:'c3',jsonb_build_object('v',1,'iv',repeat('a',16),'ciphertext',repeat('a',32)));
reset role;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-000000000104','fixture-link@example.invalid');
set local role service_role;
select public.finance_service_link_client('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000110',:'c3','00000000-0000-0000-0000-000000000104',jsonb_build_object('v',1,'iv',repeat('b',16),'ciphertext',repeat('b',32)));
set local role authenticated;
do $$ begin
 if not exists(select 1 from public.finance_clients c join public.finance_vault_items v on v.client_id=c.id
   where c.customer_code='LIVE003' and c.auth_user_id='00000000-0000-0000-0000-000000000104'
   and v.envelope->>'ciphertext'=repeat('b',32)) then raise exception 'Client login failed to reuse existing vault row'; end if;
end $$;
do $$ begin
 begin perform public.finance_save_vault_item(current_setting('test.live.client')::uuid,'{}');raise exception 'Empty vault envelope accepted'; exception when others then if sqlerrm not like '%Invalid encrypted%' then raise; end if; end;
 perform public.finance_resolve_question(current_setting('test.live.query')::uuid,true);
 begin perform public.finance_reply_question(current_setting('test.live.query')::uuid,'After closed');raise exception 'Reply to closed query'; exception when others then if sqlerrm not like '%resolved%' then raise; end if; end;
 perform public.finance_lock_session();
 begin perform public.finance_create_client('DENIED','Locked owner');raise exception 'Locked owner accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS: OTP wrong/correct/one-use, service grants, disbursement retry, private questions, wallet permissions, revoked sessions and owner lock'
