-- Run as the migration owner. Supabase supplies auth.users, auth.uid() and auth.jwt().
begin;
create schema if not exists finance_private;
revoke all on schema finance_private from public, anon, authenticated;

create table public.finance_profiles (
 user_id uuid primary key references auth.users(id),
 role text not null check(role in ('owner','client')),
 active boolean not null default true
);
create unique index one_financer on public.finance_profiles(role) where role='owner';
create table finance_private.owner_verifications (
 user_id uuid not null references auth.users(id), session_id uuid not null,
 expires_at timestamptz not null, primary key(user_id,session_id)
);
-- Only a trusted future email-verification backend may issue these grants.
-- A password login alone deliberately cannot access the finance database.
create function finance_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.finance_profiles p
 join finance_private.owner_verifications v on v.user_id=p.user_id
 where p.user_id=auth.uid() and p.role='owner' and p.active
 and v.session_id=nullif(auth.jwt()->>'session_id','')::uuid and v.expires_at>now());
$$;
create table public.finance_clients (
 id uuid primary key default gen_random_uuid(), customer_code text not null unique check(customer_code ~ '^[A-Z0-9-]{3,30}$'),
 name text not null check(length(trim(name)) between 1 and 100),
 phone text not null default '', address text not null default '', work text not null default '',
 auth_user_id uuid unique references auth.users(id), active boolean not null default true,
 created_at timestamptz not null default now()
);
create function finance_private.can_read_client(p_client uuid) returns boolean language sql stable security definer set search_path='' as $$
 select finance_private.is_owner() or exists(select 1 from public.finance_clients c
 join public.finance_profiles p on p.user_id=c.auth_user_id
 where c.id=p_client and c.auth_user_id=auth.uid() and c.active and p.active and p.role='client');
$$;
create table public.finance_loans (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.finance_clients(id),
 original_principal numeric(18,2) not null check(original_principal>0 and original_principal<10000000000000000),
 monthly_rate numeric(7,4) not null check(monthly_rate between 0 and 100),
 disbursed_on date not null, first_due_on date not null, next_due_on date not null,
 terms_code text not null check(terms_code='monthly_remaining_v1'),
 terms_approved_at timestamptz not null, terms_approved_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index finance_loans_client on public.finance_loans(client_id);
create table public.finance_interest_charges (
 id uuid primary key default gen_random_uuid(), loan_id uuid not null references public.finance_loans(id),
 due_on date not null, principal_basis numeric(18,2) not null check(principal_basis>=0),
 rate numeric(7,4) not null, amount numeric(18,2) not null check(amount>=0),
 unique(loan_id,due_on)
);
create table public.finance_payments (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 loan_id uuid not null references public.finance_loans(id), amount numeric(18,2) not null check(amount>0 and amount<10000000000000000),
 interest_paid numeric(18,2) not null check(interest_paid>=0),
 principal_paid numeric(18,2) not null check(principal_paid>=0),
 paid_on date not null, method text not null check(method in ('cash','bank','upi','other')),
 reference text not null default '' check(length(reference)<=200),
 actor uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(amount=interest_paid+principal_paid)
);
create index finance_payments_loan_date on public.finance_payments(loan_id,paid_on);
create table public.finance_audit_events (
 id bigint generated always as identity primary key, actor uuid references auth.users(id),
 action text not null, entity_id uuid not null, recorded_at timestamptz not null default now(),
 details jsonb not null default '{}'
);
create table public.finance_queries (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.finance_clients(id),
 subject text not null check(length(trim(subject)) between 1 and 150),
 status text not null default 'open' check(status in ('open','resolved')), created_at timestamptz not null default now()
);
create table public.finance_query_messages (
 id uuid primary key default gen_random_uuid(), query_id uuid not null references public.finance_queries(id),
 author uuid not null references auth.users(id),
 body text not null check(length(trim(body)) between 1 and 4000), created_at timestamptz not null default now()
);
create index finance_queries_client on public.finance_queries(client_id);
create index finance_messages_thread on public.finance_query_messages(query_id,created_at);

create function finance_private.business_date() returns date language sql stable set search_path='' as $$
 select (now() at time zone 'Asia/Kolkata')::date;
$$;
create function finance_private.following_month_end(d date) returns date language sql immutable set search_path='' as $$
 select (date_trunc('month',d::timestamp)+interval '2 months - 1 day')::date;
$$;
create function finance_private.assert_owner() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not finance_private.is_owner() then raise exception 'Verified owner session required' using errcode='42501'; end if;
end $$;

-- Shared internal balance method; never grant it directly to browser roles.
create function finance_private.balance(p_loan uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('principal',l.original_principal-coalesce(p.capital,0),
 'interest',coalesce(c.charges,0)-coalesce(p.interest,0),
 'total',l.original_principal-coalesce(p.capital,0)+coalesce(c.charges,0)-coalesce(p.interest,0))
 from public.finance_loans l
 cross join lateral(select sum(principal_paid) capital,sum(interest_paid) interest from public.finance_payments where loan_id=l.id) p
 cross join lateral(select sum(amount) charges from public.finance_interest_charges where loan_id=l.id) c where l.id=p_loan;
$$;
create function finance_private.post_due(p_loan uuid) returns void language plpgsql security definer set search_path='' as $$
declare l public.finance_loans; b jsonb; principal numeric; charge numeric; count_periods int:=0;
begin
 select * into strict l from public.finance_loans where id=p_loan for update;
 while l.next_due_on<=finance_private.business_date() loop
  count_periods:=count_periods+1;
  if count_periods>1200 then raise exception 'Loan requires reviewed historical import'; end if;
  b:=finance_private.balance(l.id); principal:=(b->>'principal')::numeric;
  charge:=round(principal*l.monthly_rate/100,2);
  insert into public.finance_interest_charges(loan_id,due_on,principal_basis,rate,amount)
  values(l.id,l.next_due_on,principal,l.monthly_rate,charge);
  l.next_due_on:=finance_private.following_month_end(l.next_due_on);
 end loop;
 update public.finance_loans set next_due_on=l.next_due_on where id=l.id;
end $$;

create function public.finance_create_client(p_code text,p_name text,p_phone text default '',p_address text default '',p_work text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform finance_private.assert_owner();
 insert into public.finance_clients(customer_code,name,phone,address,work)
 values(upper(trim(p_code)),trim(p_name),p_phone,p_address,p_work) returning id into result;
 insert into public.finance_audit_events(actor,action,entity_id) values(auth.uid(),'client.created',result);
 return result;
end $$;
create function public.finance_create_loan(p_client uuid,p_amount numeric,p_rate numeric,p_date date,p_terms_approved boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; due date;
begin
 perform finance_private.assert_owner();
 if p_terms_approved is distinct from true then raise exception 'Explicit approval of monthly_remaining_v1 terms required'; end if;
 if p_date is null or p_date>finance_private.business_date() or p_date<finance_private.business_date()-interval '50 years' then raise exception 'Invalid loan date'; end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_rate is null or p_rate<>round(p_rate,4) then raise exception 'Invalid amount/rate precision'; end if;
 if not exists(select 1 from public.finance_clients where id=p_client and active) then raise exception 'Active client required'; end if;
 due:=finance_private.following_month_end(p_date);
 insert into public.finance_loans(client_id,original_principal,monthly_rate,disbursed_on,first_due_on,next_due_on,terms_code,terms_approved_at,terms_approved_by)
 values(p_client,p_amount,p_rate,p_date,due,due,'monthly_remaining_v1',now(),auth.uid()) returning id into result;
 insert into public.finance_audit_events(actor,action,entity_id) values(auth.uid(),'loan.created',result);
 perform finance_private.post_due(result);
 return result;
end $$;
create function public.finance_loan_snapshot(p_loan uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.finance_loans; b jsonb;
begin
 select * into l from public.finance_loans where id=p_loan;
 if not found or not finance_private.can_read_client(l.client_id) then raise exception 'Access denied' using errcode='42501'; end if;
 perform finance_private.post_due(p_loan);
 select * into l from public.finance_loans where id=p_loan;
 b:=finance_private.balance(p_loan);
 return b||jsonb_build_object('loan_id',l.id,'monthly_rate',l.monthly_rate,'next_due_on',l.next_due_on,
 'next_interest_estimate',round((b->>'principal')::numeric*l.monthly_rate/100,2),'as_of',finance_private.business_date(),'refreshed_at',now());
end $$;
create function public.finance_record_payment(p_request uuid,p_loan uuid,p_amount numeric,p_date date,p_method text,p_reference text default '')
returns public.finance_payments language plpgsql security definer set search_path='' as $$
declare previous public.finance_payments; result public.finance_payments; b jsonb; i numeric; capital numeric;
begin
 perform finance_private.assert_owner();
 if p_request is null then raise exception 'Request ID required'; end if;
 -- Serialize retries even if two requests erroneously target different loans.
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into previous from public.finance_payments where request_id=p_request;
 if found then
  if previous.loan_id is distinct from p_loan or previous.amount is distinct from p_amount
   or previous.paid_on is distinct from p_date or previous.method is distinct from p_method
   or previous.reference is distinct from p_reference then raise exception 'Request ID payload mismatch'; end if;
  return previous;
 end if;
 if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Positive amount with at most two decimals required'; end if;
 -- Backdated receipts need a future controlled reconstruction workflow.
 if p_date is distinct from finance_private.business_date() then raise exception 'Only current business-date payments supported'; end if;
 perform 1 from public.finance_loans where id=p_loan for update;
 if not found then raise exception 'Loan not found'; end if;
 perform finance_private.post_due(p_loan); b:=finance_private.balance(p_loan);
 if p_amount>(b->>'total')::numeric then raise exception 'Payment exceeds outstanding balance'; end if;
 i:=least(p_amount,(b->>'interest')::numeric); capital:=p_amount-i;
 insert into public.finance_payments(request_id,loan_id,amount,interest_paid,principal_paid,paid_on,method,reference,actor)
 values(p_request,p_loan,p_amount,i,capital,p_date,p_method,p_reference,auth.uid()) returning * into result;
 insert into public.finance_audit_events(actor,action,entity_id,details)
 values(auth.uid(),'payment.recorded',result.id,jsonb_build_object('request_id',p_request,'loan_id',p_loan));
 return result;
end $$;

-- All financial writes use checked operations; clients only get read grants.
do $$ declare t text; begin
 foreach t in array array['finance_profiles','finance_clients','finance_loans','finance_interest_charges','finance_payments','finance_audit_events','finance_queries','finance_query_messages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy profile_read on public.finance_profiles for select to authenticated using(user_id=auth.uid() or finance_private.is_owner());
create policy client_read on public.finance_clients for select to authenticated using(finance_private.can_read_client(id));
create policy loan_read on public.finance_loans for select to authenticated using(finance_private.can_read_client(client_id));
create policy interest_read on public.finance_interest_charges for select to authenticated using(exists(select 1 from public.finance_loans l where l.id=loan_id and finance_private.can_read_client(l.client_id)));
create policy payment_read on public.finance_payments for select to authenticated using(exists(select 1 from public.finance_loans l where l.id=loan_id and finance_private.can_read_client(l.client_id)));
create policy audit_owner on public.finance_audit_events for select to authenticated using(finance_private.is_owner());
create policy query_read on public.finance_queries for select to authenticated using(finance_private.can_read_client(client_id));
create policy message_read on public.finance_query_messages for select to authenticated using(exists(select 1 from public.finance_queries q where q.id=query_id and finance_private.can_read_client(q.client_id)));

-- Explicit function grants; do not inherit PUBLIC execution for privileged helpers.
revoke all on all functions in schema finance_private from public,anon,authenticated;
grant usage on schema finance_private to authenticated;
grant execute on function finance_private.is_owner(),finance_private.can_read_client(uuid) to authenticated;
revoke all on function public.finance_create_client(text,text,text,text,text),public.finance_create_loan(uuid,numeric,numeric,date,boolean),public.finance_loan_snapshot(uuid),public.finance_record_payment(uuid,uuid,numeric,date,text,text) from public,anon;
grant execute on function public.finance_create_client(text,text,text,text,text),public.finance_create_loan(uuid,numeric,numeric,date,boolean),public.finance_loan_snapshot(uuid),public.finance_record_payment(uuid,uuid,numeric,date,text,text) to authenticated;
commit;
