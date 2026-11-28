-- Persisted frozen reducing-balance installment schedules, installment-aware
-- payment allocation, RLS policies, and archive/purge support.
-- Preserves legacy monthly_remaining_v1 loans intact.

begin;

-- 1. Extend public.finance_loans to accept installment_reducing_v1 while preserving monthly_remaining_v1.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.finance_loans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%terms_code%'
  loop
    execute format('alter table public.finance_loans drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.finance_loans
  add column installment_months integer null;

alter table public.finance_loans
  add constraint finance_loans_terms_code_check
    check (terms_code in ('monthly_remaining_v1', 'installment_reducing_v1')),
  add constraint finance_loans_installment_terms_check
    check (
      (terms_code = 'monthly_remaining_v1' and installment_months is null)
      or (terms_code = 'installment_reducing_v1' and installment_months is not null and installment_months between 1 and 360)
    );

-- 2. Frozen reducing-balance installment schedule table.
create table public.finance_loan_installments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.finance_loans(id),
  installment_number integer not null check (installment_number >= 1),
  due_on date not null,
  principal_due numeric(18,2) not null check (principal_due > 0),
  interest_due numeric(18,2) not null check (interest_due >= 0),
  total_due numeric(18,2) not null check (total_due = principal_due + interest_due),
  remaining_principal numeric(18,2) not null check (remaining_principal >= 0),
  principal_paid numeric(18,2) not null default 0 check (principal_paid >= 0 and principal_paid <= principal_due),
  interest_paid numeric(18,2) not null default 0 check (interest_paid >= 0 and interest_paid <= interest_due),
  paid_on date null,
  created_at timestamptz not null default now(),
  unique (loan_id, installment_number),
  unique (loan_id, due_on)
);

create index finance_loan_installments_loan_due
  on public.finance_loan_installments(loan_id, due_on, installment_number);

-- 3. Tamper-evident per-installment payment allocation ledger.
create table public.finance_installment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.finance_payments(id),
  loan_id uuid not null references public.finance_loans(id),
  installment_id uuid not null references public.finance_loan_installments(id),
  installment_number integer not null check (installment_number >= 1),
  interest_paid numeric(18,2) not null check (interest_paid >= 0),
  principal_paid numeric(18,2) not null check (principal_paid >= 0),
  created_at timestamptz not null default now(),
  check (interest_paid + principal_paid > 0)
);

create index finance_installment_allocations_payment
  on public.finance_installment_allocations(payment_id);
create index finance_installment_allocations_loan
  on public.finance_installment_allocations(loan_id, installment_number);
create index finance_installment_allocations_installment
  on public.finance_installment_allocations(installment_id);

-- 4. Lock down tables with Row-Level Security and read-only authenticated grants.
alter table public.finance_loan_installments enable row level security;
revoke all on public.finance_loan_installments from public, anon, authenticated;
grant select on public.finance_loan_installments to authenticated;

create policy installment_read on public.finance_loan_installments
  for select to authenticated
  using (
    exists (
      select 1
      from public.finance_loans l
      where l.id = loan_id
        and finance_private.can_read_client(l.client_id)
    )
  );

alter table public.finance_installment_allocations enable row level security;
revoke all on public.finance_installment_allocations from public, anon, authenticated;
grant select on public.finance_installment_allocations to authenticated;

create policy installment_allocation_read on public.finance_installment_allocations
  for select to authenticated
  using (
    exists (
      select 1
      from public.finance_loans l
      where l.id = loan_id
        and finance_private.can_read_client(l.client_id)
    )
  );

-- 5. Deterministic internal helper to freeze reducing-balance schedule in integer paise.
create or replace function finance_private.generate_installment_schedule(
  p_loan uuid,
  p_amount numeric,
  p_rate numeric,
  p_disbursed_on date,
  p_months integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_principal_paise bigint;
  v_rate_num numeric;
  v_rate_flt double precision;
  v_monthly_payment bigint;
  v_balance bigint;
  v_idx integer;
  v_remaining_months integer;
  v_interest_paise bigint;
  v_principal_due bigint;
  v_due date;
begin
  if p_months is null or p_months < 1 or p_months > 360 then
    raise exception 'Enter a repayment term between 1 and 360 months.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 100000000 then
    raise exception 'Invalid loan principal.';
  end if;
  v_principal_paise := round(p_amount * 100)::bigint;
  if v_principal_paise < p_months then
    raise exception 'Loan principal must be at least 0.01 per installment.';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 or p_rate <> round(p_rate, 4) then
    raise exception 'Monthly interest rate must be between 0 and 100%%';
  end if;

  v_rate_num := p_rate / 100.0;
  v_rate_flt := p_rate::double precision / 100.0;

  if p_rate = 0 then
    v_monthly_payment := floor((v_principal_paise::double precision / p_months::double precision) + 0.5)::bigint;
  else
    v_monthly_payment := floor(
      (
        (v_principal_paise::double precision * v_rate_flt)
        / (1.0 - exp(-(p_months::double precision) * ln(1.0 + v_rate_flt)))
      ) + 0.5
    )::bigint;
  end if;

  v_balance := v_principal_paise;
  v_due := finance_private.following_month_end(p_disbursed_on);

  for v_idx in 0..(p_months - 1) loop
    v_remaining_months := p_months - v_idx - 1;
    v_interest_paise := floor((v_balance::numeric * v_rate_num) + 0.5)::bigint;
    if v_remaining_months = 0 then
      v_principal_due := v_balance;
    else
      v_principal_due := least(
        v_balance - v_remaining_months,
        greatest(1::bigint, v_monthly_payment - v_interest_paise)
      );
    end if;
    v_balance := v_balance - v_principal_due;

    insert into public.finance_loan_installments(
      loan_id,
      installment_number,
      due_on,
      principal_due,
      interest_due,
      total_due,
      remaining_principal
    )
    values (
      p_loan,
      v_idx + 1,
      v_due,
      (v_principal_due::numeric / 100.0),
      (v_interest_paise::numeric / 100.0),
      ((v_principal_due + v_interest_paise)::numeric / 100.0),
      (v_balance::numeric / 100.0)
    );

    v_due := finance_private.following_month_end(v_due);
  end loop;
end $$;

-- 6. Preserve legacy monthly_remaining_v1 posting while skipping installment loans.
create or replace function finance_private.post_due(p_loan uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.finance_loans;
  b jsonb;
  principal numeric;
  charge numeric;
  count_periods int := 0;
begin
  select * into strict l from public.finance_loans where id = p_loan for update;
  if l.terms_code <> 'monthly_remaining_v1' then
    return;
  end if;
  while l.next_due_on <= finance_private.business_date() loop
    count_periods := count_periods + 1;
    if count_periods > 1200 then
      raise exception 'Loan requires reviewed historical import';
    end if;
    b := finance_private.balance(l.id);
    principal := (b->>'principal')::numeric;
    charge := round(principal * l.monthly_rate / 100, 2);
    insert into public.finance_interest_charges(loan_id, due_on, principal_basis, rate, amount)
    values (l.id, l.next_due_on, principal, l.monthly_rate, charge);
    l.next_due_on := finance_private.following_month_end(l.next_due_on);
  end loop;
  update public.finance_loans set next_due_on = l.next_due_on where id = l.id;
end $$;

-- 7. Unified balance helper preserving exact monthly_remaining_v1 keys and adding installment metrics.
create or replace function finance_private.balance(p_loan uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when l.terms_code = 'installment_reducing_v1' then (
      select jsonb_build_object(
        'principal', coalesce(sum(i.principal_due - i.principal_paid), 0),
        'interest', coalesce(sum(case when i.due_on <= finance_private.business_date() then i.interest_due - i.interest_paid else 0 end), 0),
        'total', coalesce(sum(i.principal_due - i.principal_paid), 0)
          + coalesce(sum(case when i.due_on <= finance_private.business_date() then i.interest_due - i.interest_paid else 0 end), 0),
        'scheduled_interest', coalesce(sum(i.interest_due - i.interest_paid), 0),
        'max_payment', coalesce(sum((i.principal_due - i.principal_paid) + (i.interest_due - i.interest_paid)), 0),
        'due_principal', coalesce(sum(case when i.due_on <= finance_private.business_date() then i.principal_due - i.principal_paid else 0 end), 0),
        'due_total', coalesce(sum(case when i.due_on <= finance_private.business_date() then (i.principal_due - i.principal_paid) + (i.interest_due - i.interest_paid) else 0 end), 0),
        'overdue_count', coalesce(count(*) filter (where i.due_on < finance_private.business_date() and (i.principal_paid < i.principal_due or i.interest_paid < i.interest_due)), 0),
        'due_today_count', coalesce(count(*) filter (where i.due_on = finance_private.business_date() and (i.principal_paid < i.principal_due or i.interest_paid < i.interest_due)), 0)
      )
      from public.finance_loan_installments i
      where i.loan_id = l.id
    )
    else (
      select jsonb_build_object(
        'principal', l.original_principal - coalesce(p.capital, 0),
        'interest', coalesce(c.charges, 0) - coalesce(p.interest, 0),
        'total', l.original_principal - coalesce(p.capital, 0) + coalesce(c.charges, 0) - coalesce(p.interest, 0),
        'scheduled_interest', coalesce(c.charges, 0) - coalesce(p.interest, 0),
        'max_payment', l.original_principal - coalesce(p.capital, 0) + coalesce(c.charges, 0) - coalesce(p.interest, 0)
      )
      from (
        select sum(principal_paid) capital, sum(interest_paid) interest
        from public.finance_payments
        where loan_id = l.id
      ) p
      cross join (
        select sum(amount) charges
        from public.finance_interest_charges
        where loan_id = l.id
      ) c
    )
  end
  from public.finance_loans l
  where l.id = p_loan;
$$;

-- 8. Installment loan creation (core + idempotent disbursement RPCs).
create function finance_private.finance_create_installment_loan(
  p_client uuid,
  p_amount numeric,
  p_rate numeric,
  p_date date,
  p_months integer,
  p_terms_approved boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_result uuid;
  v_due date;
begin
  perform finance_private.assert_owner();
  if p_terms_approved is distinct from true then
    raise exception 'Explicit approval of installment_reducing_v1 terms required';
  end if;
  if p_date is null or p_date > finance_private.business_date() or p_date < finance_private.business_date() - interval '50 years' then
    raise exception 'Invalid loan date';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_rate is null or p_rate <> round(p_rate, 4) then
    raise exception 'Invalid amount/rate precision';
  end if;
  if p_rate < 0 or p_rate > 100 then
    raise exception 'Monthly interest rate must be between 0 and 100%%';
  end if;
  if p_months is null or p_months < 1 or p_months > 360 then
    raise exception 'Enter a repayment term between 1 and 360 months.';
  end if;
  if round(p_amount * 100)::bigint < p_months then
    raise exception 'Loan principal must be at least 0.01 per installment.';
  end if;
  if not exists (select 1 from public.finance_clients where id = p_client and active) then
    raise exception 'Active client required';
  end if;

  v_due := finance_private.following_month_end(p_date);
  insert into public.finance_loans(
    client_id,
    original_principal,
    monthly_rate,
    disbursed_on,
    first_due_on,
    next_due_on,
    terms_code,
    installment_months,
    terms_approved_at,
    terms_approved_by
  )
  values (
    p_client,
    p_amount,
    p_rate,
    p_date,
    v_due,
    v_due,
    'installment_reducing_v1',
    p_months,
    now(),
    auth.uid()
  )
  returning id into v_result;

  perform finance_private.generate_installment_schedule(v_result, p_amount, p_rate, p_date, p_months);

  insert into public.finance_audit_events(actor, action, entity_id, details)
  values (
    auth.uid(),
    'loan.created',
    v_result,
    jsonb_build_object('terms_code', 'installment_reducing_v1', 'installment_months', p_months)
  );

  return v_result;
end $$;

create function public.finance_create_installment_loan(
  p_client uuid,
  p_amount numeric,
  p_rate numeric,
  p_date date,
  p_months integer,
  p_terms_approved boolean
) returns uuid language sql security invoker set search_path = '' as $$
  select finance_private.finance_create_installment_loan($1, $2, $3, $4, $5, $6);
$$;

create function finance_private.finance_disburse_installments(
  p_request uuid,
  p_client uuid,
  p_amount numeric,
  p_rate numeric,
  p_date date,
  p_months integer,
  p_terms_approved boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_payload jsonb;
  v_old finance_private.disbursement_requests;
  v_result uuid;
begin
  perform finance_private.assert_owner();
  if p_request is null then
    raise exception 'Request ID required';
  end if;
  v_payload := jsonb_build_object(
    'client', p_client,
    'amount', p_amount,
    'rate', p_rate,
    'date', p_date,
    'months', p_months,
    'terms_code', 'installment_reducing_v1',
    'approved', p_terms_approved
  );
  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 3));
  select * into v_old from finance_private.disbursement_requests where request_id = p_request;
  if found then
    if v_old.payload <> v_payload then
      raise exception 'Request ID payload mismatch';
    end if;
    return v_old.loan_id;
  end if;
  if p_amount > 100000000 then
    raise exception 'Maximum loan amount is 100000000';
  end if;
  v_result := finance_private.finance_create_installment_loan(
    p_client, p_amount, p_rate, p_date, p_months, p_terms_approved
  );
  insert into finance_private.disbursement_requests(request_id, loan_id, payload)
  values (p_request, v_result, v_payload);
  return v_result;
end $$;

create function public.finance_disburse_installments(
  p_request uuid,
  p_client uuid,
  p_amount numeric,
  p_rate numeric,
  p_date date,
  p_months integer,
  p_terms_approved boolean
) returns uuid language sql security invoker set search_path = '' as $$
  select finance_private.finance_disburse_installments($1, $2, $3, $4, $5, $6, $7);
$$;

-- 9. Update loan snapshot to handle both monthly and frozen installment loans accurately.
create or replace function finance_private.finance_loan_snapshot(p_loan uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.finance_loans;
  b jsonb;
  v_next_est numeric;
begin
  select * into l from public.finance_loans where id = p_loan;
  if not found or not finance_private.can_read_client(l.client_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  perform finance_private.post_due(p_loan);
  select * into l from public.finance_loans where id = p_loan;
  b := finance_private.balance(p_loan);

  if l.terms_code = 'installment_reducing_v1' then
    select coalesce(
      (
        select i.interest_due - i.interest_paid
        from public.finance_loan_installments i
        where i.loan_id = l.id
          and i.due_on > finance_private.business_date()
          and (i.principal_paid < i.principal_due or i.interest_paid < i.interest_due)
        order by i.installment_number asc
        limit 1
      ),
      0
    ) into v_next_est;
  else
    v_next_est := round((b->>'principal')::numeric * l.monthly_rate / 100, 2);
  end if;

  return b || jsonb_build_object(
    'loan_id', l.id,
    'terms_code', l.terms_code,
    'installment_months', l.installment_months,
    'monthly_rate', l.monthly_rate,
    'next_due_on', l.next_due_on,
    'next_interest_estimate', v_next_est,
    'as_of', finance_private.business_date(),
    'refreshed_at', now()
  );
end $$;

-- 10. Installment-aware payment recording: chronological installment waterfall (interest before principal)
--     while preserving legacy monthly_remaining_v1 payments unchanged.
create or replace function finance_private.finance_record_payment(
  p_request uuid,
  p_loan uuid,
  p_amount numeric,
  p_date date,
  p_method text,
  p_reference text default ''
) returns public.finance_payments language plpgsql security definer set search_path = '' as $$
declare
  previous public.finance_payments;
  result public.finance_payments;
  l public.finance_loans;
  b jsonb;
  i numeric := 0;
  capital numeric := 0;
  v_rem numeric;
  v_max numeric;
  v_inst public.finance_loan_installments;
  v_row_i numeric;
  v_row_p numeric;
  v_alloc_rows jsonb := '[]'::jsonb;
  v_alloc_item jsonb;
  v_next_due date;
begin
  perform finance_private.assert_owner();
  if p_request is null then
    raise exception 'Request ID required';
  end if;
  -- Serialize retries even if two requests erroneously target different loans.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select * into previous from public.finance_payments where request_id = p_request;
  if found then
    if previous.loan_id is distinct from p_loan
      or previous.amount is distinct from p_amount
      or previous.paid_on is distinct from p_date
      or previous.method is distinct from p_method
      or previous.reference is distinct from p_reference then
      raise exception 'Request ID payload mismatch';
    end if;
    return previous;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Positive amount with at most two decimals required';
  end if;
  if p_date is distinct from finance_private.business_date() then
    raise exception 'Only current business-date payments supported';
  end if;

  select * into l from public.finance_loans where id = p_loan for update;
  if not found then
    raise exception 'Loan not found';
  end if;

  if l.terms_code = 'installment_reducing_v1' then
    b := finance_private.balance(p_loan);
    v_max := (b->>'max_payment')::numeric;
    if p_amount > v_max then
      raise exception 'Payment exceeds outstanding balance';
    end if;

    v_rem := p_amount;
    for v_inst in
      select *
      from public.finance_loan_installments
      where loan_id = p_loan
        and (principal_paid < principal_due or interest_paid < interest_due)
      order by installment_number asc
      for update
    loop
      exit when v_rem <= 0;
      v_row_i := least(v_rem, v_inst.interest_due - v_inst.interest_paid);
      v_rem := v_rem - v_row_i;
      v_row_p := least(v_rem, v_inst.principal_due - v_inst.principal_paid);
      v_rem := v_rem - v_row_p;

      if v_row_i > 0 or v_row_p > 0 then
        update public.finance_loan_installments
        set
          interest_paid = interest_paid + v_row_i,
          principal_paid = principal_paid + v_row_p,
          paid_on = case
            when (interest_paid + v_row_i) = interest_due
              and (principal_paid + v_row_p) = principal_due
            then p_date
            else paid_on
          end
        where id = v_inst.id;

        i := i + v_row_i;
        capital := capital + v_row_p;
        v_alloc_rows := v_alloc_rows || jsonb_build_array(
          jsonb_build_object(
            'installment_id', v_inst.id,
            'installment_number', v_inst.installment_number,
            'interest_paid', v_row_i,
            'principal_paid', v_row_p
          )
        );
      end if;
    end loop;

    if v_rem <> 0 then
      raise exception 'Payment allocation mismatch';
    end if;

    select coalesce(
      (
        select min(due_on)
        from public.finance_loan_installments
        where loan_id = p_loan
          and (principal_paid < principal_due or interest_paid < interest_due)
      ),
      (
        select max(due_on)
        from public.finance_loan_installments
        where loan_id = p_loan
      ),
      l.next_due_on
    ) into v_next_due;

    update public.finance_loans
    set next_due_on = v_next_due
    where id = p_loan;

    insert into public.finance_payments(request_id, loan_id, amount, interest_paid, principal_paid, paid_on, method, reference, actor)
    values (p_request, p_loan, p_amount, i, capital, p_date, p_method, coalesce(p_reference, ''), auth.uid())
    returning * into result;

    for v_alloc_item in select * from jsonb_array_elements(v_alloc_rows) loop
      insert into public.finance_installment_allocations(
        payment_id,
        loan_id,
        installment_id,
        installment_number,
        interest_paid,
        principal_paid
      )
      values (
        result.id,
        p_loan,
        (v_alloc_item->>'installment_id')::uuid,
        (v_alloc_item->>'installment_number')::integer,
        (v_alloc_item->>'interest_paid')::numeric,
        (v_alloc_item->>'principal_paid')::numeric
      );
    end loop;

    insert into public.finance_audit_events(actor, action, entity_id, details)
    values (
      auth.uid(),
      'payment.recorded',
      result.id,
      jsonb_build_object(
        'request_id', p_request,
        'loan_id', p_loan,
        'terms_code', 'installment_reducing_v1',
        'allocations', v_alloc_rows
      )
    );
    return result;
  else
    perform finance_private.post_due(p_loan);
    b := finance_private.balance(p_loan);
    if p_amount > (b->>'total')::numeric then
      raise exception 'Payment exceeds outstanding balance';
    end if;
    i := least(p_amount, (b->>'interest')::numeric);
    capital := p_amount - i;
    insert into public.finance_payments(request_id, loan_id, amount, interest_paid, principal_paid, paid_on, method, reference, actor)
    values (p_request, p_loan, p_amount, i, capital, p_date, p_method, coalesce(p_reference, ''), auth.uid())
    returning * into result;
    insert into public.finance_audit_events(actor, action, entity_id, details)
    values (auth.uid(), 'payment.recorded', result.id, jsonb_build_object('request_id', p_request, 'loan_id', p_loan));
    return result;
  end if;
end $$;

-- 11. Workspace payload returns persisted installments & allocations alongside existing entities.
create or replace function finance_private.finance_get_workspace() returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  posting_loan record;
  client_ids uuid[];
begin
  perform public.finance_session_info();
  select array_agg(id) into client_ids from public.finance_clients where finance_private.can_read_client(id);
  if cardinality(client_ids) > 1000 then
    raise exception 'Pagination required for this account size';
  end if;
  for posting_loan in
    select id
    from public.finance_loans
    where client_id = any(client_ids)
      and terms_code = 'monthly_remaining_v1'
    order by id
  loop
    perform finance_private.post_due(posting_loan.id);
  end loop;
  select jsonb_build_object(
    'clients', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from public.finance_clients c where c.id = any(client_ids)), '[]'::jsonb),
    'loans', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('balance', finance_private.balance(x.id)) order by x.created_at desc) from public.finance_loans x where x.client_id = any(client_ids)), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.finance_payments x join public.finance_loans l on l.id = x.loan_id where l.client_id = any(client_ids)), '[]'::jsonb),
    'charges', coalesce((select jsonb_agg(to_jsonb(x) order by x.due_on desc) from public.finance_interest_charges x join public.finance_loans l on l.id = x.loan_id where l.client_id = any(client_ids)), '[]'::jsonb),
    'installments', coalesce((select jsonb_agg(to_jsonb(x) order by x.loan_id, x.installment_number) from public.finance_loan_installments x join public.finance_loans l on l.id = x.loan_id where l.client_id = any(client_ids)), '[]'::jsonb),
    'installment_allocations', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.installment_number asc) from public.finance_installment_allocations x join public.finance_loans l on l.id = x.loan_id where l.client_id = any(client_ids)), '[]'::jsonb),
    'queries', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.finance_queries x where x.client_id = any(client_ids)), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.finance_query_messages x join public.finance_queries q on q.id = x.query_id where q.client_id = any(client_ids)), '[]'::jsonb),
    'refreshed_at', now(),
    'business_date', finance_private.business_date()
  ) into result;
  return result;
end $$;

-- 12. Protect frozen installment schedules against retroactive rate mutation.
create or replace function public.finance_update_loan_rate(
  p_loan uuid,
  p_rate numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_terms text;
begin
  perform finance_private.assert_owner();
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'Monthly interest rate must be between 0 and 100%%';
  end if;
  select terms_code into v_terms from public.finance_loans where id = p_loan for update;
  if not found then
    raise exception 'Loan not found';
  end if;
  if v_terms <> 'monthly_remaining_v1' then
    raise exception 'Cannot change interest rate on a frozen installment schedule loan';
  end if;
  update public.finance_loans
  set monthly_rate = p_rate
  where id = p_loan;
  insert into public.finance_audit_events(actor, action, entity_id)
  values (auth.uid(), 'loan.rate_updated', p_loan);
end $$;

-- 13. Cleanly cascade single-client history deletion and full ledger purge across installment tables.
create or replace function public.finance_delete_client_history(
  p_client uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_loan_ids uuid[];
  v_query_ids uuid[];
begin
  perform finance_private.assert_owner();

  select coalesce(array_agg(id), '{}') into v_loan_ids
  from public.finance_loans where client_id = p_client;

  select coalesce(array_agg(id), '{}') into v_query_ids
  from public.finance_queries where client_id = p_client;

  delete from public.finance_installment_allocations where loan_id = any(v_loan_ids);
  delete from public.finance_payments where loan_id = any(v_loan_ids);
  delete from public.finance_loan_installments where loan_id = any(v_loan_ids);
  delete from public.finance_interest_charges where loan_id = any(v_loan_ids);
  delete from finance_private.disbursement_requests where loan_id = any(v_loan_ids);
  delete from public.finance_loans where id = any(v_loan_ids);

  delete from public.finance_query_messages where query_id = any(v_query_ids);
  delete from public.finance_queries where id = any(v_query_ids);

  delete from finance_private.credential_resets where client_id = p_client;
  delete from public.finance_vault_items where client_id = p_client;

  delete from public.finance_clients where id = p_client;
  if not found then
    raise exception 'Client not found';
  end if;

  insert into public.finance_audit_events(actor, action, entity_id)
  values (auth.uid(), 'client.deleted', p_client);
end $$;

create or replace function finance_private.purge_ledger(p_confirmation text)
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
    public.finance_loan_installments, public.finance_installment_allocations,
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
  delete from public.finance_installment_allocations;
  delete from public.finance_payments;
  delete from public.finance_loan_installments;
  delete from public.finance_interest_charges;
  delete from public.finance_loans;
  delete from public.finance_audit_events;
  delete from public.finance_clients;
  delete from public.finance_profiles where role = 'client';
  delete from auth.users where id = any(client_users);
end $$;

-- 14. Explicit function grants matching existing security boundaries.
revoke all on function finance_private.generate_installment_schedule(uuid,numeric,numeric,date,integer) from public, anon, authenticated;
grant execute on function finance_private.generate_installment_schedule(uuid,numeric,numeric,date,integer) to service_role;

revoke all on function finance_private.finance_create_installment_loan(uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function finance_private.finance_create_installment_loan(uuid,numeric,numeric,date,integer,boolean) to authenticated;

revoke all on function public.finance_create_installment_loan(uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function public.finance_create_installment_loan(uuid,numeric,numeric,date,integer,boolean) to authenticated;

revoke all on function finance_private.finance_disburse_installments(uuid,uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function finance_private.finance_disburse_installments(uuid,uuid,numeric,numeric,date,integer,boolean) to authenticated;

revoke all on function public.finance_disburse_installments(uuid,uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function public.finance_disburse_installments(uuid,uuid,numeric,numeric,date,integer,boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
