\set ON_ERROR_STOP on
begin;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000301', 'inst-owner@example.invalid'),
  ('00000000-0000-0000-0000-000000000302', 'inst-c1@example.invalid'),
  ('00000000-0000-0000-0000-000000000303', 'inst-c2@example.invalid');

insert into auth.sessions(id, user_id) values
  ('00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000302'),
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000303');

insert into public.finance_profiles values
  ('00000000-0000-0000-0000-000000000301', 'owner', true),
  ('00000000-0000-0000-0000-000000000302', 'client', true),
  ('00000000-0000-0000-0000-000000000303', 'client', true);

insert into finance_private.owner_verifications values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000310', now() + interval '1 hour');

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000310"}',
  false
);
set local role authenticated;

-- 1. Create two clients + mixed monthly, new flat installment, and preserved reducing installment loans
select public.finance_create_client('INST001', 'Installment Client One') as c1 \gset
select public.finance_create_client('INST002', 'Installment Client Two') as c2 \gset
select set_config('test.inst.c1', :'c1', false);
select set_config('test.inst.c2', :'c2', false);

-- Standard one-time total interest installment loan: 20000 at 20% = 24000 split across 12 months => 2000.00/mo
select public.finance_disburse_installments_flat(
  '00000000-0000-0000-0000-000000000320',
  :'c1',
  20000,
  20,
  (now() at time zone 'Asia/Kolkata')::date,
  12,
  true
) as loan_flat \gset
select set_config('test.inst.loan_flat', :'loan_flat', false);

-- Non-divisible & fractional-rate paise parity checks:
-- 20000 at 20% = 24000 across 7 months => 3428.57 x 6 + 3428.58
select public.finance_disburse_installments_flat(
  '00000000-0000-0000-0000-000000000324',
  :'c2',
  20000,
  20,
  (now() at time zone 'Asia/Kolkata')::date,
  7,
  true
) as loan_flat7 \gset
select set_config('test.inst.loan_flat7', :'loan_flat7', false);

-- Fractional half-up rounding: 200.50 at 15.25% = 30.58 interest (3057.625 paise -> 3058)
select public.finance_disburse_installments_flat(
  '00000000-0000-0000-0000-000000000325',
  :'c2',
  200.50,
  15.25,
  (now() at time zone 'Asia/Kolkata')::date,
  3,
  true
) as loan_frac \gset
select set_config('test.inst.loan_frac', :'loan_frac', false);

-- Zero-interest 3-month rounding test (10.00 INR = 1000 paise @ 0% -> 3.33, 3.33, 3.34)
select public.finance_disburse_installments_flat(
  '00000000-0000-0000-0000-000000000321',
  :'c2',
  10.00,
  0,
  (now() at time zone 'Asia/Kolkata')::date,
  3,
  true
) as loan_zero \gset
select set_config('test.inst.loan_zero', :'loan_zero', false);

-- Legacy monthly loan on Client One preserved alongside installment loans
select public.finance_disburse(
  '00000000-0000-0000-0000-000000000322',
  :'c1',
  50000,
  2,
  (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '2 months' + interval '10 days')::date,
  true
) as loan_monthly \gset
select set_config('test.inst.loan_monthly', :'loan_monthly', false);

-- Backdated flat installment loan on Client One with at least 2 overdue installments
select public.finance_disburse_installments_flat(
  '00000000-0000-0000-0000-000000000323',
  :'c1',
  60000,
  10,
  (date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '3 months' + interval '14 days')::date,
  6,
  true
) as loan_ovd \gset
select set_config('test.inst.loan_ovd', :'loan_ovd', false);

-- Seed a preserved pre-existing frozen reducing-balance loan (`installment_reducing_v1`) as owner/superuser
reset role;
insert into public.finance_loans(
  id, client_id, original_principal, monthly_rate, disbursed_on, first_due_on, next_due_on,
  terms_code, installment_months, terms_approved_at, terms_approved_by
)
values (
  '00000000-0000-0000-0000-000000000399',
  current_setting('test.inst.c1')::uuid,
  100000,
  1,
  (now() at time zone 'Asia/Kolkata')::date,
  finance_private.following_month_end((now() at time zone 'Asia/Kolkata')::date),
  finance_private.following_month_end((now() at time zone 'Asia/Kolkata')::date),
  'installment_reducing_v1',
  12,
  now(),
  '00000000-0000-0000-0000-000000000301'
);
select finance_private.generate_installment_schedule(
  '00000000-0000-0000-0000-000000000399',
  100000,
  1,
  (now() at time zone 'Asia/Kolkata')::date,
  12
);
set local role authenticated;

do $$
declare
  v_dup uuid;
  v_row1 public.finance_loan_installments;
  v_row12 public.finance_loan_installments;
  v_sum_p numeric;
  v_sum_i numeric;
  v_sum_t numeric;
  v_terms text;
  v_snap jsonb;
  v_pay1 public.finance_payments;
  v_pay2 public.finance_payments;
  v_alloc_count int;
  v_ws jsonb;
  v_inst1_total numeric;
  v_pay_amt numeric;
  v_pay_i numeric;
  v_max_pay numeric;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_leg_id uuid := '00000000-0000-0000-0000-000000000399';
begin
  -- Verify newly disbursed loan uses installment_flat_v1
  select terms_code into v_terms from public.finance_loans
    where id = current_setting('test.inst.loan_flat')::uuid;
  if v_terms <> 'installment_flat_v1' then
    raise exception 'TEST FAIL: expected terms_code installment_flat_v1, got %', v_terms;
  end if;

  -- Idempotent retry succeeds, mismatched payload rejects
  v_dup := public.finance_disburse_installments_flat(
    '00000000-0000-0000-0000-000000000320',
    current_setting('test.inst.c1')::uuid,
    20000, 20, v_today, 12, true
  );
  if v_dup <> current_setting('test.inst.loan_flat')::uuid then
    raise exception 'TEST FAIL: installment disbursement retry created duplicate';
  end if;
  begin
    perform public.finance_disburse_installments_flat(
      '00000000-0000-0000-0000-000000000320',
      current_setting('test.inst.c1')::uuid,
      20000, 20, v_today, 6, true
    );
    raise exception 'TEST FAIL: mismatched installment months accepted';
  exception when others then
    if sqlerrm not like '%payload mismatch%' then raise; end if;
  end;

  -- Check 20000 at 20% = 24000 across 12 months => exact 2000.00/mo, sum principal 20000, sum interest 4000
  select * into strict v_row1 from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_flat')::uuid and installment_number = 1;
  select * into strict v_row12 from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_flat')::uuid and installment_number = 12;
  if v_row1.principal_due <> 1666.67 or v_row1.interest_due <> 333.33 or v_row1.total_due <> 2000.00 then
    raise exception 'TEST FAIL: unexpected flat installment 1 values: %', v_row1;
  end if;
  if v_row12.principal_due <> 1666.63 or v_row12.interest_due <> 333.37 or v_row12.total_due <> 2000.00 or v_row12.remaining_principal <> 0 then
    raise exception 'TEST FAIL: unexpected flat installment 12 values: %', v_row12;
  end if;
  select sum(principal_due), sum(interest_due), sum(total_due)
    into v_sum_p, v_sum_i, v_sum_t
    from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_flat')::uuid;
  if v_sum_p <> 20000.00 or v_sum_i <> 4000.00 or v_sum_t <> 24000.00 then
    raise exception 'TEST FAIL: flat installment sum mismatch: p=%, i=%, t=%', v_sum_p, v_sum_i, v_sum_t;
  end if;

  -- Check 7-month non-divisible split (3428.57 x 6 + 3428.58 = 24000.00)
  select sum(principal_due), sum(interest_due), sum(total_due)
    into v_sum_p, v_sum_i, v_sum_t
    from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_flat7')::uuid;
  if v_sum_p <> 20000.00 or v_sum_i <> 4000.00 or v_sum_t <> 24000.00 then
    raise exception 'TEST FAIL: flat 7m sum mismatch: p=%, i=%, t=%', v_sum_p, v_sum_i, v_sum_t;
  end if;
  if (select string_agg(total_due::text, ',' order by installment_number)
      from public.finance_loan_installments where loan_id = current_setting('test.inst.loan_flat7')::uuid)
     <> '3428.57,3428.57,3428.57,3428.57,3428.57,3428.57,3428.58' then
    raise exception 'TEST FAIL: flat 7m installment row parity mismatch';
  end if;

  -- Check fractional half-up rounding parity (200.50 @ 15.25% over 3m -> 30.58 interest, 231.08 total)
  select sum(principal_due), sum(interest_due), sum(total_due)
    into v_sum_p, v_sum_i, v_sum_t
    from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_frac')::uuid;
  if v_sum_p <> 200.50 or v_sum_i <> 30.58 or v_sum_t <> 231.08 then
    raise exception 'TEST FAIL: fractional flat rounding mismatch: p=%, i=%, t=%', v_sum_p, v_sum_i, v_sum_t;
  end if;

  -- Check 0% rounding ([3.33, 3.33, 3.34])
  if (select string_agg(total_due::text, ',' order by installment_number)
      from public.finance_loan_installments where loan_id = current_setting('test.inst.loan_zero')::uuid) <> '3.33,3.33,3.34' then
    raise exception 'TEST FAIL: 0%% installment rounding mismatch';
  end if;

  -- Confirm preserved existing installment_reducing_v1 frozen schedule works end-to-end (balance, snapshot, payment, rate lock)
  select * into strict v_row1 from public.finance_loan_installments
    where loan_id = v_leg_id and installment_number = 1;
  if v_row1.principal_due <> 7884.88 or v_row1.interest_due <> 1000.00 or v_row1.total_due <> 8884.88 then
    raise exception 'TEST FAIL: preserved reducing installment 1 mismatch: %', v_row1;
  end if;
  v_snap := public.finance_loan_snapshot(v_leg_id);
  if (v_snap->>'principal')::numeric <> 100000.00 or (v_snap->>'max_payment')::numeric <> 106618.53 then
    raise exception 'TEST FAIL: preserved reducing loan snapshot mismatch: %', v_snap;
  end if;
  v_pay1 := public.finance_record_payment(
    '00000000-0000-0000-0000-000000000398',
    v_leg_id,
    8884.88,
    v_today,
    'bank',
    'LEGACY-RED-1'
  );
  if v_pay1.interest_paid <> 1000.00 or v_pay1.principal_paid <> 7884.88 then
    raise exception 'TEST FAIL: preserved reducing loan payment failed: %', v_pay1;
  end if;
  begin
    perform public.finance_update_loan_rate(v_leg_id, 2.0);
    raise exception 'TEST FAIL: rate edit allowed on preserved reducing installment loan';
  exception when others then
    if sqlerrm not like '%frozen installment%' then raise; end if;
  end;

  -- Confirm installment loans do NOT create rows in finance_interest_charges, while legacy monthly loan still posts
  v_ws := public.finance_get_workspace();
  if exists (
    select 1 from public.finance_interest_charges
    where loan_id in (current_setting('test.inst.loan_flat')::uuid, current_setting('test.inst.loan_ovd')::uuid, v_leg_id)
  ) then
    raise exception 'TEST FAIL: installment loan generated monthly interest charges';
  end if;
  if not exists (
    select 1 from public.finance_interest_charges where loan_id = current_setting('test.inst.loan_monthly')::uuid
  ) then
    raise exception 'TEST FAIL: legacy monthly loan did not post charges';
  end if;

  -- Check overdue count and chronological payment allocation on backdated flat installment loan
  v_snap := public.finance_loan_snapshot(current_setting('test.inst.loan_ovd')::uuid);
  if (v_snap->>'overdue_count')::int < 2 then
    raise exception 'TEST FAIL: expected >= 2 overdue installments, got %', v_snap;
  end if;

  select * into strict v_row1 from public.finance_loan_installments
    where loan_id = current_setting('test.inst.loan_ovd')::uuid and installment_number = 1;
  v_inst1_total := v_row1.total_due;
  v_pay_amt := v_inst1_total + 100.00;
  v_pay1 := public.finance_record_payment(
    '00000000-0000-0000-0000-000000000330',
    current_setting('test.inst.loan_ovd')::uuid,
    v_pay_amt,
    v_today,
    'upi',
    'INST1-PLUS-PART2'
  );
  v_pay_i := v_row1.interest_due + 100.00;
  if v_pay1.interest_paid <> v_pay_i or v_pay1.principal_paid <> v_row1.principal_due then
    raise exception 'TEST FAIL: installment payment split mismatch: got %, expected int %', v_pay1, v_pay_i;
  end if;

  select count(*) into v_alloc_count from public.finance_installment_allocations where payment_id = v_pay1.id;
  if v_alloc_count <> 2 then
    raise exception 'TEST FAIL: expected 2 installment allocation rows, got %', v_alloc_count;
  end if;

  -- Idempotent payment retry returns exact previous receipt without re-allocating
  v_pay2 := public.finance_record_payment(
    '00000000-0000-0000-0000-000000000330',
    current_setting('test.inst.loan_ovd')::uuid,
    v_pay_amt,
    v_today,
    'upi',
    'INST1-PLUS-PART2'
  );
  if v_pay2.id <> v_pay1.id then
    raise exception 'TEST FAIL: duplicate payment retry produced second receipt';
  end if;

  -- Reject rate edits on frozen flat installment loan, while allowing on legacy monthly loan
  begin
    perform public.finance_update_loan_rate(current_setting('test.inst.loan_ovd')::uuid, 1.5);
    raise exception 'TEST FAIL: rate change allowed on frozen flat installment loan';
  exception when others then
    if sqlerrm not like '%frozen installment%' then raise; end if;
  end;
  perform public.finance_update_loan_rate(current_setting('test.inst.loan_monthly')::uuid, 2.5);

  -- Full payoff across remaining installments of loan_zero and reject overpayment
  v_max_pay := (public.finance_loan_snapshot(current_setting('test.inst.loan_zero')::uuid)->>'max_payment')::numeric;
  begin
    perform public.finance_record_payment(
      gen_random_uuid(),
      current_setting('test.inst.loan_zero')::uuid,
      v_max_pay + 0.01,
      v_today,
      'cash'
    );
    raise exception 'TEST FAIL: installment overpayment accepted';
  exception when others then
    if sqlerrm not like '%exceeds%' then raise; end if;
  end;

  v_pay2 := public.finance_record_payment(
    '00000000-0000-0000-0000-000000000331',
    current_setting('test.inst.loan_zero')::uuid,
    v_max_pay,
    v_today,
    'cash'
  );
  v_snap := public.finance_loan_snapshot(current_setting('test.inst.loan_zero')::uuid);
  if (v_snap->>'principal')::numeric <> 0 or (v_snap->>'max_payment')::numeric <> 0 then
    raise exception 'TEST FAIL: full payoff left nonzero balance: %', v_snap;
  end if;
end $$;

-- 2. Verify RLS isolation and write blocks for clients
reset role;
update public.finance_clients set auth_user_id = '00000000-0000-0000-0000-000000000302' where id = :'c1';
update public.finance_clients set auth_user_id = '00000000-0000-0000-0000-000000000303' where id = :'c2';

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000302","session_id":"00000000-0000-0000-0000-000000000311"}',
  false
);
set local role authenticated;

do $$
declare
  v_ws jsonb;
  v_n int;
begin
  -- Client 1 sees only Client 1's 30 installments (12 flat + 6 flat_ovd + 12 legacy reducing), not Client 2's 13
  select count(*) into v_n from public.finance_loan_installments;
  if v_n <> 30 then
    raise exception 'TEST FAIL: installment RLS leak (expected 30, got %)', v_n;
  end if;
  select count(*) into v_n from public.finance_installment_allocations;
  if v_n <> 3 then
    raise exception 'TEST FAIL: allocation RLS count mismatch (expected 3, got %)', v_n;
  end if;

  v_ws := public.finance_get_workspace();
  if jsonb_array_length(v_ws->'installments') <> 30 or jsonb_array_length(v_ws->'installment_allocations') <> 3 then
    raise exception 'TEST FAIL: workspace installment isolation mismatch';
  end if;

  -- Direct writes blocked
  begin
    update public.finance_loan_installments set principal_paid = 0;
    raise exception 'TEST FAIL: client updated installment table directly';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.finance_installment_allocations;
    raise exception 'TEST FAIL: client deleted allocations directly';
  exception when insufficient_privilege then null; end;

  -- Private & owner RPCs blocked
  begin
    perform public.finance_disburse_installments_flat(gen_random_uuid(), current_setting('test.inst.c1')::uuid, 1000, 1, (now() at time zone 'Asia/Kolkata')::date, 3, true);
    raise exception 'TEST FAIL: client created installment loan';
  exception when insufficient_privilege then null; end;

  begin
    perform finance_private.generate_flat_installment_schedule(gen_random_uuid(), 1000, 1, (now() at time zone 'Asia/Kolkata')::date, 3);
    raise exception 'TEST FAIL: client invoked private flat schedule helper';
  exception when insufficient_privilege then null; end;
end $$;

-- Disabled client session cannot read installment schedules or allocations via RLS
reset role;
update public.finance_clients set active = false where id = :'c1';
set local role authenticated;
do $$
declare
  v_n int;
begin
  select count(*) into v_n from public.finance_loan_installments;
  if v_n <> 0 then
    raise exception 'TEST FAIL: disabled client still read % installment rows', v_n;
  end if;
  select count(*) into v_n from public.finance_installment_allocations;
  if v_n <> 0 then
    raise exception 'TEST FAIL: disabled client still read % allocation rows', v_n;
  end if;
end $$;
reset role;
update public.finance_clients set active = true where id = :'c1';

-- 3. Verify client history deletion and full ledger purge cascade cleanly
reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000301","session_id":"00000000-0000-0000-0000-000000000310"}',
  false
);
set local role authenticated;

select public.finance_delete_client_history(:'c1');
do $$ begin
  if exists (select 1 from public.finance_loan_installments where loan_id = current_setting('test.inst.loan_ovd')::uuid) then
    raise exception 'TEST FAIL: client history delete left installments';
  end if;
  if exists (select 1 from public.finance_installment_allocations where loan_id = current_setting('test.inst.loan_ovd')::uuid) then
    raise exception 'TEST FAIL: client history delete left allocations';
  end if;
end $$;

select public.finance_purge_ledger('PURGE-VELMURUGAN-FINANCE');
reset role;
do $$ begin
  if exists (select 1 from public.finance_loan_installments)
     or exists (select 1 from public.finance_installment_allocations)
     or exists (select 1 from public.finance_loans)
     or exists (select 1 from public.finance_clients) then
    raise exception 'TEST FAIL: purge_ledger left installment records behind';
  end if;
  if not exists (select 1 from public.finance_profiles where role = 'owner') then
    raise exception 'TEST FAIL: purge_ledger removed owner';
  end if;
end $$;

rollback;
\echo 'PASS: flat total-interest & preserved reducing-balance schedules, allocation, overdue counts, RLS, delete-history and purge'
