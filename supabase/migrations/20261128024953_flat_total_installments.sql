-- Add one-time total-interest flat installment schedule support (`installment_flat_v1`)
-- for newly created installment loans while preserving existing frozen `installment_reducing_v1`
-- schedules and legacy `monthly_remaining_v1` loans intact.

begin;

-- 1. Allow installment_flat_v1 alongside monthly_remaining_v1 and existing installment_reducing_v1.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.finance_loans'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%terms_code%'
        or pg_get_constraintdef(oid) ilike '%installment_months%'
      )
  loop
    execute format('alter table public.finance_loans drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.finance_loans
  add constraint finance_loans_terms_code_check
    check (terms_code in ('monthly_remaining_v1', 'installment_reducing_v1', 'installment_flat_v1')),
  add constraint finance_loans_installment_terms_check
    check (
      (terms_code = 'monthly_remaining_v1' and installment_months is null)
      or (terms_code in ('installment_reducing_v1', 'installment_flat_v1') and installment_months is not null and installment_months between 1 and 360)
    );

-- 2. Deterministic internal helper to freeze one-time total-interest schedules in exact integer paise,
--    matching src/installments.ts calculateFlatInstallments bit-for-bit.
create or replace function finance_private.generate_flat_installment_schedule(
  p_loan uuid,
  p_amount numeric,
  p_rate numeric,
  p_disbursed_on date,
  p_months integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_principal_paise bigint;
  v_rate_scaled bigint;
  v_total_interest_paise bigint;
  v_total_repayment bigint;
  v_target_payment bigint;
  v_ideal_interest bigint;
  v_remaining_principal bigint;
  v_remaining_interest bigint;
  v_idx integer;
  v_remaining_months integer;
  v_max_principal bigint;
  v_interest_due bigint;
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
    raise exception 'Total interest rate must be between 0 and 100%%';
  end if;

  v_rate_scaled := round(p_rate * 10000)::bigint;
  -- Exact half-up division on arbitrary-precision numeric matching JS BigInt formula:
  -- (principalPaise * rateScaled * 2 + 1_000_000) / 2_000_000
  v_total_interest_paise := div(
    v_principal_paise::numeric * v_rate_scaled::numeric * 2 + 1000000,
    2000000
  )::bigint;
  v_total_repayment := v_principal_paise + v_total_interest_paise;
  v_target_payment := (2 * v_total_repayment + p_months) / (2 * p_months);
  v_ideal_interest := (2 * v_total_interest_paise + p_months) / (2 * p_months);

  v_remaining_principal := v_principal_paise;
  v_remaining_interest := v_total_interest_paise;
  v_due := finance_private.following_month_end(p_disbursed_on);

  for v_idx in 0..(p_months - 1) loop
    v_remaining_months := p_months - v_idx - 1;
    if v_remaining_months = 0 then
      v_principal_due := v_remaining_principal;
      v_interest_due := v_remaining_interest;
    else
      v_max_principal := v_remaining_principal - v_remaining_months;
      v_interest_due := greatest(0::bigint, least(v_remaining_interest, v_ideal_interest));
      v_principal_due := greatest(1::bigint, least(v_max_principal, v_target_payment - v_interest_due));
    end if;

    v_remaining_principal := v_remaining_principal - v_principal_due;
    v_remaining_interest := v_remaining_interest - v_interest_due;

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
      (v_interest_due::numeric / 100.0),
      ((v_principal_due + v_interest_due)::numeric / 100.0),
      (v_remaining_principal::numeric / 100.0)
    );

    v_due := finance_private.following_month_end(v_due);
  end loop;
end $$;

-- 3. Update balance & snapshot helpers to handle both frozen reducing schedules and flat total-interest schedules.
create or replace function finance_private.balance(p_loan uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when l.terms_code in ('installment_reducing_v1', 'installment_flat_v1') then (
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

  if l.terms_code in ('installment_reducing_v1', 'installment_flat_v1') then
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

-- 4. Update installment loan creation & idempotent disbursement RPCs to issue installment_flat_v1.
create or replace function finance_private.finance_create_flat_installment_loan(
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
    raise exception 'Explicit approval of installment_flat_v1 terms required';
  end if;
  if p_date is null or p_date > finance_private.business_date() or p_date < finance_private.business_date() - interval '50 years' then
    raise exception 'Invalid loan date';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_rate is null or p_rate <> round(p_rate, 4) then
    raise exception 'Invalid amount/rate precision';
  end if;
  if p_rate < 0 or p_rate > 100 then
    raise exception 'Total interest rate must be between 0 and 100%%';
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
    'installment_flat_v1',
    p_months,
    now(),
    auth.uid()
  )
  returning id into v_result;

  perform finance_private.generate_flat_installment_schedule(v_result, p_amount, p_rate, p_date, p_months);

  insert into public.finance_audit_events(actor, action, entity_id, details)
  values (
    auth.uid(),
    'loan.created',
    v_result,
    jsonb_build_object('terms_code', 'installment_flat_v1', 'installment_months', p_months)
  );

  return v_result;
end $$;

create or replace function finance_private.finance_disburse_installments_flat(
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
    'terms_code', 'installment_flat_v1',
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
  v_result := finance_private.finance_create_flat_installment_loan(
    p_client, p_amount, p_rate, p_date, p_months, p_terms_approved
  );
  insert into finance_private.disbursement_requests(request_id, loan_id, payload)
  values (p_request, v_result, v_payload);
  return v_result;
end $$;

-- 5. Support both installment_flat_v1 and existing installment_reducing_v1 in chronological payment allocation.
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

  if l.terms_code in ('installment_reducing_v1', 'installment_flat_v1') then
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
        'terms_code', l.terms_code,
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

revoke all on function finance_private.generate_flat_installment_schedule(uuid,numeric,numeric,date,integer) from public, anon, authenticated;
grant execute on function finance_private.generate_flat_installment_schedule(uuid,numeric,numeric,date,integer) to service_role;

create function public.finance_disburse_installments_flat(
  p_request uuid, p_client uuid, p_amount numeric, p_rate numeric,
  p_date date, p_months integer, p_terms_approved boolean
) returns uuid language sql security invoker set search_path = '' as $$
  select finance_private.finance_disburse_installments_flat($1, $2, $3, $4, $5, $6, $7);
$$;

revoke all on function finance_private.finance_create_flat_installment_loan(uuid,numeric,numeric,date,integer,boolean) from public, anon, authenticated;
revoke all on function finance_private.finance_disburse_installments_flat(uuid,uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function finance_private.finance_disburse_installments_flat(uuid,uuid,numeric,numeric,date,integer,boolean) to authenticated;
revoke all on function public.finance_disburse_installments_flat(uuid,uuid,numeric,numeric,date,integer,boolean) from public, anon;
grant execute on function public.finance_disburse_installments_flat(uuid,uuid,numeric,numeric,date,integer,boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
