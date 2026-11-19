-- Live session checks, verified-owner email challenges, private wallet and queries.
create table finance_private.app_config (
 singleton boolean primary key default true check(singleton),
 owner_email text not null,
 bootstrap_hash text,
 bootstrap_expires_at timestamptz
);
insert into finance_private.app_config(singleton,owner_email) values(true,'imran5426117@gmail.com');
create table finance_private.login_limits (
 key text primary key check(length(key)=64), window_start timestamptz not null, count integer not null check(count>=0)
);
create table finance_private.email_challenges (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null, code_hash text not null check(length(code_hash)=64),
 created_at timestamptz not null default now(), expires_at timestamptz not null,
 attempts integer not null default 0, consumed boolean not null default false
);
create index finance_email_challenge_session on finance_private.email_challenges(user_id,session_id,created_at);
create table finance_private.credential_resets (
 client_id uuid primary key references public.finance_clients(id), envelope jsonb not null,
 was_active boolean not null, started_at timestamptz not null default now()
);
create table finance_private.disbursement_requests (
 request_id uuid primary key, loan_id uuid not null references public.finance_loans(id), payload jsonb not null
);
create table public.finance_vault_metadata (
 owner_id uuid primary key references auth.users(id), envelope jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.finance_vault_items (
 client_id uuid primary key references public.finance_clients(id), envelope jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.finance_vault_metadata enable row level security;
alter table public.finance_vault_items enable row level security;
revoke all on public.finance_vault_metadata,public.finance_vault_items from public,anon,authenticated;
grant select on public.finance_vault_metadata,public.finance_vault_items to authenticated;
create policy vault_meta_read on public.finance_vault_metadata for select to authenticated using(finance_private.is_owner() and owner_id=(select auth.uid()));
create policy vault_item_read on public.finance_vault_items for select to authenticated using(finance_private.is_owner());

create function finance_private.live_session(p_user uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now()));
$$;
create or replace function finance_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_profiles p join finance_private.owner_verifications v on v.user_id=p.user_id
 where p.user_id=auth.uid() and p.role='owner' and p.active
 and v.session_id=nullif(auth.jwt()->>'session_id','')::uuid and v.expires_at>now()
 and finance_private.live_session(p.user_id,v.session_id));
$$;
create or replace function finance_private.can_read_client(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select finance_private.is_owner() or exists(select 1 from public.finance_clients c
 join public.finance_profiles p on p.user_id=c.auth_user_id
 where c.id=p_client and c.auth_user_id=auth.uid() and c.active and p.active and p.role='client'
 and finance_private.live_session(p.user_id,nullif(auth.jwt()->>'session_id','')::uuid));
$$;
create function finance_private.verified_owner(p_user uuid,p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_profiles p join finance_private.owner_verifications v on v.user_id=p.user_id
 where p.user_id=p_user and p.role='owner' and p.active and v.session_id=p_session and v.expires_at>now()
 and finance_private.live_session(p_user,p_session));
$$;
create function public.finance_service_context(p_user uuid,p_session uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',p.role,'active',p.active,'email',u.email,
 'verified',finance_private.verified_owner(p_user,p_session),'session_live',finance_private.live_session(p_user,p_session),
 'client_id',c.id,'client_active',c.active)
 from public.finance_profiles p join auth.users u on u.id=p.user_id
 left join public.finance_clients c on c.auth_user_id=p.user_id where p.user_id=p_user;
$$;
create function public.finance_session_info() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 result:=public.finance_service_context(auth.uid(),nullif(auth.jwt()->>'session_id','')::uuid);
 if result is null or not (result->>'active')::boolean or not (result->>'session_live')::boolean then raise exception 'Account access is disabled or not configured' using errcode='42501'; end if;
 if result->>'role'='client' and (result->>'client_active')::boolean is distinct from true then raise exception 'Client access disabled' using errcode='42501'; end if;
 return result;
end $$;

create function public.finance_service_rate_limit(p_key text,p_limit int,p_window_seconds int) returns boolean language plpgsql security definer set search_path='' as $$
declare hits int;
begin
 if p_limit<1 or p_limit>1000 or p_window_seconds<1 then raise exception 'Invalid limit'; end if;
 insert into finance_private.login_limits as l(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set count=case when l.window_start<now()-make_interval(secs=>p_window_seconds) then 1 else l.count+1 end,
 window_start=case when l.window_start<now()-make_interval(secs=>p_window_seconds) then now() else l.window_start end returning count into hits;
 return hits<=p_limit;
end $$;
create function public.finance_service_bootstrap_check(p_token_hash text) returns text language plpgsql security definer set search_path='' as $$
declare email text;
begin
 select owner_email into email from finance_private.app_config where singleton and bootstrap_hash=p_token_hash and bootstrap_expires_at>now() for update;
 if email is null or exists(select 1 from public.finance_profiles where role='owner') then raise exception 'Setup unavailable' using errcode='42501'; end if;
 update finance_private.app_config set bootstrap_hash=null,bootstrap_expires_at=null where singleton;
 return email;
end $$;
create function public.finance_service_finish_bootstrap(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users u join finance_private.app_config c on lower(u.email)=lower(c.owner_email) where u.id=p_user) then raise exception 'Owner identity mismatch'; end if;
 insert into public.finance_profiles(user_id,role) values(p_user,'owner');
 insert into public.finance_audit_events(actor,action,entity_id) values(p_user,'owner.provisioned',p_user);
end $$;

create function public.finance_service_issue_code(p_user uuid,p_session uuid,p_id uuid,p_hash text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.finance_profiles where user_id=p_user and role='owner' and active for update;
 if not found or not finance_private.live_session(p_user,p_session) then raise exception 'Owner session required' using errcode='42501'; end if;
 if exists(select 1 from finance_private.email_challenges where user_id=p_user and created_at>now()-interval '60 seconds') then raise exception 'Wait a minute before requesting another code'; end if;
 update finance_private.email_challenges set consumed=true where user_id=p_user and not consumed;
 insert into finance_private.email_challenges(id,user_id,session_id,code_hash,expires_at) values(p_id,p_user,p_session,p_hash,now()+interval '10 minutes');
end $$;
create function public.finance_service_verify_code(p_user uuid,p_session uuid,p_id uuid,p_hash text) returns boolean language plpgsql security definer set search_path='' as $$
declare c finance_private.email_challenges;
begin
 select * into c from finance_private.email_challenges where id=p_id and user_id=p_user and session_id=p_session for update;
 if not found or c.consumed or c.expires_at<=now() or c.attempts>=6 or not finance_private.live_session(p_user,p_session) then return false; end if;
 update finance_private.email_challenges set attempts=attempts+1 where id=c.id;
 if c.code_hash<>p_hash then return false; end if;
 if not exists(select 1 from public.finance_profiles where user_id=p_user and role='owner' and active) then return false; end if;
 update finance_private.email_challenges set consumed=true where id=c.id;
 insert into finance_private.owner_verifications(user_id,session_id,expires_at) values(p_user,p_session,now()+interval '8 hours')
 on conflict(user_id,session_id) do update set expires_at=excluded.expires_at;
 insert into public.finance_audit_events(actor,action,entity_id) values(p_user,'owner.email_verified',p_user);
 return true;
end $$;

create function public.finance_service_client_identity(p_code text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',u.id,'email',u.email) from public.finance_clients c
 join public.finance_profiles p on p.user_id=c.auth_user_id join auth.users u on u.id=p.user_id
 where c.customer_code=upper(trim(p_code)) and c.active and p.active and p.role='client';
$$;
create function public.finance_service_link_client(p_owner uuid,p_session uuid,p_client uuid,p_user uuid,p_envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not finance_private.verified_owner(p_owner,p_session) then raise exception 'Verified owner required' using errcode='42501'; end if;
 if p_envelope->>'v' is distinct from '1' or coalesce(length(p_envelope->>'ciphertext'),0) not between 20 and 150000 or coalesce(length(p_envelope->>'iv'),0)<>16 then raise exception 'Encrypted wallet record required'; end if;
 perform 1 from public.finance_clients where id=p_client and auth_user_id is null for update;
 if not found then raise exception 'Client already linked or missing'; end if;
 if not exists(select 1 from public.finance_vault_metadata where owner_id=p_owner) then raise exception 'Set up secret wallet first'; end if;
 insert into public.finance_profiles(user_id,role) values(p_user,'client');
 update public.finance_clients set auth_user_id=p_user where id=p_client;
 insert into public.finance_vault_items(client_id,envelope) values(p_client,p_envelope);
 insert into public.finance_audit_events(actor,action,entity_id) values(p_owner,'client.access_created',p_client);
end $$;
create function public.finance_set_client_active(p_client uuid,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 perform finance_private.assert_owner();
 if p_active is null then raise exception 'Active state required'; end if;
 if p_active and exists(select 1 from finance_private.credential_resets where client_id=p_client) then raise exception 'Complete the pending password reset before enabling access'; end if;
 update public.finance_clients set active=p_active where id=p_client returning auth_user_id into u;
 if not found then raise exception 'Client not found'; end if;
 update public.finance_profiles set active=p_active where user_id=u;
 if not p_active then delete from auth.sessions where user_id=u; end if;
 insert into public.finance_audit_events(actor,action,entity_id,details) values(auth.uid(),'client.access_changed',p_client,jsonb_build_object('active',p_active));
end $$;
create function public.finance_service_reset_client(p_owner uuid,p_session uuid,p_client uuid,p_envelope jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid; was_active boolean;
begin
 if not finance_private.verified_owner(p_owner,p_session) then raise exception 'Verified owner required' using errcode='42501'; end if;
 if p_envelope->>'v' is distinct from '1' or coalesce(length(p_envelope->>'ciphertext'),0) not between 20 and 150000 or coalesce(length(p_envelope->>'iv'),0)<>16 then raise exception 'Encrypted wallet record required'; end if;
 select auth_user_id,active into u,was_active from public.finance_clients where id=p_client for update;
 if u is null then raise exception 'Client has no login'; end if;
 insert into finance_private.credential_resets(client_id,envelope,was_active) values(p_client,p_envelope,was_active)
 on conflict(client_id) do update set envelope=excluded.envelope,started_at=now();
 update public.finance_clients set active=false where id=p_client;
 update public.finance_profiles set active=false where user_id=u;
 delete from auth.sessions where user_id=u;
 return u;
end $$;
create function public.finance_service_finish_client_reset(p_owner uuid,p_session uuid,p_client uuid) returns void language plpgsql security definer set search_path='' as $$
declare reset finance_private.credential_resets; u uuid;
begin
 if not finance_private.verified_owner(p_owner,p_session) then raise exception 'Verified owner required' using errcode='42501'; end if;
 select * into strict reset from finance_private.credential_resets where client_id=p_client for update;
 update public.finance_vault_items set envelope=reset.envelope,updated_at=now() where client_id=p_client;
 if not found then raise exception 'Encrypted wallet item missing'; end if;
 update public.finance_clients set active=reset.was_active where id=p_client returning auth_user_id into u;
 update public.finance_profiles set active=reset.was_active where user_id=u;
 delete from finance_private.credential_resets where client_id=p_client;
 insert into public.finance_audit_events(actor,action,entity_id) values(p_owner,'client.password_reset',p_client);
end $$;

create function public.finance_disburse(p_request uuid,p_client uuid,p_amount numeric,p_rate numeric,p_date date,p_terms_approved boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare payload jsonb; old finance_private.disbursement_requests; result uuid;
begin
 perform finance_private.assert_owner(); if p_request is null then raise exception 'Request ID required'; end if;
 payload:=jsonb_build_object('client',p_client,'amount',p_amount,'rate',p_rate,'date',p_date,'approved',p_terms_approved);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,3));
 select * into old from finance_private.disbursement_requests where request_id=p_request;
 if found then if old.payload<>payload then raise exception 'Request ID payload mismatch'; end if; return old.loan_id; end if;
 if p_amount>100000000 then raise exception 'Maximum loan amount is 100000000'; end if;
 result:=public.finance_create_loan(p_client,p_amount,p_rate,p_date,p_terms_approved);
 insert into finance_private.disbursement_requests(request_id,loan_id,payload) values(p_request,result,payload);
 return result;
end $$;

create function public.finance_get_workspace() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; posting_loan record; client_ids uuid[];
begin
 perform public.finance_session_info();
 select array_agg(id) into client_ids from public.finance_clients where finance_private.can_read_client(id);
 if cardinality(client_ids)>1000 then raise exception 'Pagination required for this account size'; end if;
 for posting_loan in select id from public.finance_loans where client_id=any(client_ids) order by id loop perform finance_private.post_due(posting_loan.id); end loop;
 select jsonb_build_object(
 'clients',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.finance_clients c where c.id=any(client_ids)),'[]'::jsonb),
 'loans',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('balance',finance_private.balance(x.id)) order by x.created_at desc) from public.finance_loans x where x.client_id=any(client_ids)),'[]'::jsonb),
 'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.finance_payments x join public.finance_loans l on l.id=x.loan_id where l.client_id=any(client_ids)),'[]'::jsonb),
 'charges',coalesce((select jsonb_agg(to_jsonb(x) order by x.due_on desc) from public.finance_interest_charges x join public.finance_loans l on l.id=x.loan_id where l.client_id=any(client_ids)),'[]'::jsonb),
 'queries',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.finance_queries x where x.client_id=any(client_ids)),'[]'::jsonb),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.finance_query_messages x join public.finance_queries q on q.id=x.query_id where q.client_id=any(client_ids)),'[]'::jsonb),
 'refreshed_at',now(),'business_date',finance_private.business_date()) into result;
 return result;
end $$;
create function public.finance_ask_question(p_client uuid,p_subject text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not finance_private.can_read_client(p_client) then raise exception 'Access denied' using errcode='42501'; end if;
 insert into public.finance_queries(client_id,subject) values(p_client,trim(p_subject)) returning id into result;
 insert into public.finance_query_messages(query_id,author,body) values(result,auth.uid(),trim(p_body)); return result;
end $$;
create function public.finance_reply_question(p_query uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare c uuid; status text; result uuid;
begin
 select client_id,q.status into c,status from public.finance_queries q where id=p_query for update;
 if c is null or not finance_private.can_read_client(c) then raise exception 'Access denied' using errcode='42501'; end if;
 if status='resolved' then raise exception 'This question has been resolved'; end if;
 insert into public.finance_query_messages(query_id,author,body) values(p_query,auth.uid(),trim(p_body)) returning id into result; return result;
end $$;
create function public.finance_resolve_question(p_query uuid,p_resolved boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.assert_owner(); if p_resolved is null then raise exception 'Resolution state required'; end if;
 update public.finance_queries set status=case when p_resolved then 'resolved' else 'open' end where id=p_query;
 if not found then raise exception 'Question not found'; end if;
end $$;
create function public.finance_save_vault_metadata(p_envelope jsonb,p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.finance_vault_metadata;
begin
 perform finance_private.assert_owner();
 if p_envelope->>'v' is distinct from '1' or p_envelope->>'kdf' is distinct from 'PBKDF2-SHA256' or coalesce((p_envelope->>'iterations')::int,0)<600000 or length(p_envelope::text)>10000 then raise exception 'Invalid encrypted wallet metadata'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if exists(select 1 from public.finance_vault_metadata where owner_id=auth.uid()) then
  update public.finance_vault_metadata set envelope=p_envelope,updated_at=clock_timestamp() where owner_id=auth.uid() and updated_at=p_expected_updated_at returning * into result;
  if not found then raise exception 'Wallet metadata changed; reload before continuing'; end if;
 else
  insert into public.finance_vault_metadata(owner_id,envelope) values(auth.uid(),p_envelope) returning * into result;
 end if;
 insert into public.finance_audit_events(actor,action,entity_id) values(auth.uid(),'vault.metadata_saved',auth.uid()); return to_jsonb(result);
end $$;
create function public.finance_save_vault_item(p_client uuid,p_envelope jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform finance_private.assert_owner();
 if p_envelope->>'v' is distinct from '1' or coalesce(length(p_envelope->>'ciphertext'),0) not between 20 and 150000 or coalesce(length(p_envelope->>'iv'),0)<>16 then raise exception 'Invalid encrypted record'; end if;
 insert into public.finance_vault_items(client_id,envelope) values(p_client,p_envelope) on conflict(client_id) do update set envelope=excluded.envelope,updated_at=now();
 insert into public.finance_audit_events(actor,action,entity_id) values(auth.uid(),'vault.item_saved',p_client);
end $$;
create function public.finance_lock_session() returns void language plpgsql security definer set search_path='' as $$
begin delete from finance_private.owner_verifications where user_id=auth.uid() and session_id=nullif(auth.jwt()->>'session_id','')::uuid; end $$;

-- Optional scheduler calls the same idempotent posting path; reads/writes catch up too.
create function finance_private.post_all_due() returns void language plpgsql security definer set search_path='' as $$
declare l record;
begin
 for l in select id from public.finance_loans where next_due_on<=finance_private.business_date() order by id limit 500 loop perform finance_private.post_due(l.id); end loop;
 delete from finance_private.login_limits where window_start<now()-interval '2 days';
 delete from finance_private.email_challenges where expires_at<now()-interval '1 day';
end $$;

-- Protect all private tables and helper functions, including against future API exposure.
alter table finance_private.app_config enable row level security;
alter table finance_private.credential_resets enable row level security;
alter table finance_private.disbursement_requests enable row level security;
alter table finance_private.login_limits enable row level security;
alter table finance_private.email_challenges enable row level security;
alter table finance_private.owner_verifications enable row level security;
revoke all on all tables in schema finance_private from public,anon,authenticated;
revoke all on all functions in schema finance_private from public,anon,authenticated;
grant execute on function finance_private.is_owner(),finance_private.can_read_client(uuid) to authenticated;
grant select on public.finance_clients to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'finance_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname like 'finance_service_%' then execute format('grant execute on function %s to service_role',f.signature);
  else execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
-- Keep privileged bodies outside the exposed schema. Public RPC wrappers run as
-- the caller and grant only the intended role access to their private bodies.
do $$ declare f record; call_args text; wrapper text; begin
 for f in select p.oid,p.proname,p.pronargs,pg_get_function_arguments(p.oid) arguments,
 pg_get_function_identity_arguments(p.oid) identity_arguments,
 case when p.prorettype='public.finance_payments'::regtype then 'public.finance_payments' else pg_get_function_result(p.oid) end result
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'finance_%' and p.prosecdef loop
  select coalesce(string_agg('$'||i,','),'') into call_args from generate_series(1,f.pronargs) as i;
  execute format('alter function public.%I(%s) set schema finance_private',f.proname,f.identity_arguments);
  wrapper:=format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',f.proname,f.arguments,f.result,format('select finance_private.%I(%s)',f.proname,call_args));
  execute wrapper;
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.proname,f.identity_arguments);
  if f.proname like 'finance_service_%' then
   execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.identity_arguments);
  else
   execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_arguments);
  end if;
 end loop;
end $$;
grant usage on schema finance_private to service_role;
-- Scheduling is optional on local Windows Postgres; enabled when available on Supabase.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('finance-interest-catchup','40 18 * * *','select finance_private.post_all_due();');
 end if;
end $$;
notify pgrst,'reload schema';
