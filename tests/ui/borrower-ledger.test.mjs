import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLoanInstallments,
  allocateLoanInterestCharges,
  buildReceiptHtml,
  estimateMonthlyInterestPaise,
  followingMonthEndYmd,
  formatReceiptFilename,
  fromPaise,
  getLoanPayments,
  getPersistedInstallmentSupport,
  isFlatInstallmentLoan,
  isInstallmentLoan,
  partitionAndSortBorrowerLoans,
  previewInstallmentPaymentAllocation,
  summarizeBorrowerHome
} from '../../src/borrowerLedger.ts';

const baseLoan = {
  id: '11111111-1111-4111-8111-111111111111',
  client_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  original_principal: 100000,
  monthly_rate: 2,
  disbursed_on: '2026-08-15',
  first_due_on: '2026-09-30',
  next_due_on: '2026-12-31',
  terms_code: 'monthly_remaining_v1',
  balance: {
    principal: 100000,
    interest: 1200,
    total: 101200
  }
};

test('getPersistedInstallmentSupport reflects strict monthly_remaining_v1 DB model', () => {
  const support = getPersistedInstallmentSupport(baseLoan);
  assert.equal(support.supported, false);
  assert.equal(support.termsCode, 'monthly_remaining_v1');

  const fallbackSupport = getPersistedInstallmentSupport({});
  assert.equal(fallbackSupport.supported, false);
  assert.equal(fallbackSupport.termsCode, 'monthly_remaining_v1');
});

test('allocateLoanInterestCharges applies payments FIFO oldest-first and classifies due today partial', () => {
  const charges = [
    {
      id: 'chg-nov',
      loan_id: baseLoan.id,
      due_on: '2026-11-30',
      principal_basis: 100000,
      rate: 2,
      amount: 2000
    },
    {
      id: 'chg-sep',
      loan_id: baseLoan.id,
      due_on: '2026-09-30',
      principal_basis: 100000,
      rate: 2,
      amount: 2000
    },
    {
      id: 'chg-oct',
      loan_id: baseLoan.id,
      due_on: '2026-10-31',
      principal_basis: 100000,
      rate: 2,
      amount: 2000
    },
    {
      id: 'chg-other-loan',
      loan_id: '22222222-2222-4222-8222-222222222222',
      due_on: '2026-11-30',
      principal_basis: 50000,
      rate: 3,
      amount: 1500
    }
  ];

  const payments = [
    {
      id: 'pay-1',
      loan_id: baseLoan.id,
      paid_on: '2026-10-05',
      amount: 2000,
      interest_paid: 2000,
      principal_paid: 0,
      method: 'upi',
      reference: 'UPI-SEP',
      created_at: '2026-10-05T10:00:00Z'
    },
    {
      id: 'pay-2',
      loan_id: baseLoan.id,
      paid_on: '2026-11-12',
      amount: 2800,
      interest_paid: 2800,
      principal_paid: 0,
      method: 'cash',
      reference: 'CASH-OCT-PART-NOV',
      created_at: '2026-11-12T10:00:00Z'
    }
  ];

  const ledger = allocateLoanInterestCharges(baseLoan, charges, payments, '2026-11-30');
  assert.equal(ledger.rowsChronological.length, 3);
  assert.equal(ledger.totalChargedPaise, 600000);
  assert.equal(ledger.totalInterestPaidPaise, 480000);
  assert.equal(ledger.totalUnpaidPaise, 120000);

  // Sep & Oct paid FIFO, Nov partially paid on due date 2026-11-30
  assert.equal(ledger.rowsChronological[0].charge.id, 'chg-sep');
  assert.equal(ledger.rowsChronological[0].status, 'paid');
  assert.equal(ledger.rowsChronological[1].charge.id, 'chg-oct');
  assert.equal(ledger.rowsChronological[1].status, 'paid');
  assert.equal(ledger.rowsChronological[2].charge.id, 'chg-nov');
  assert.equal(ledger.rowsChronological[2].status, 'partial_due_today');
  assert.equal(fromPaise(ledger.rowsChronological[2].paidPaise), 800);
  assert.equal(fromPaise(ledger.rowsChronological[2].unpaidPaise), 1200);

  // Current month check
  assert.equal(ledger.currentMonthStatus.hasPostedCharge, true);
  assert.equal(ledger.currentMonthStatus.state, 'partial');
  assert.equal(ledger.currentMonthStatus.label, 'Partially paid · Due today');
  assert.equal(fromPaise(ledger.currentMonthStatus.postedPaise), 2000);
  assert.equal(fromPaise(ledger.currentMonthStatus.paidPaise), 800);
  assert.equal(fromPaise(ledger.currentMonthStatus.unpaidPaise), 1200);
  assert.equal(ledger.currentMonthStatus.priorUnpaidPaise, 0);
});

test('allocateLoanInterestCharges tracks prior-month unpaid balance, overdue, not_posted, and settled', () => {
  const charges = [
    {
      id: 'chg-oct',
      loan_id: baseLoan.id,
      due_on: '2026-10-31',
      principal_basis: 100000,
      rate: 2,
      amount: 2000
    },
    {
      id: 'chg-nov',
      loan_id: baseLoan.id,
      due_on: '2026-11-30',
      principal_basis: 100000,
      rate: 2,
      amount: 2000
    }
  ];

  // Unpaid Oct + Unpaid Nov evaluated in December -> Nov is overdue & Oct is priorUnpaid
  const overdueLedger = allocateLoanInterestCharges(baseLoan, charges, [], '2026-12-05');
  assert.equal(overdueLedger.currentMonthStatus.hasPostedCharge, false);
  assert.equal(overdueLedger.currentMonthStatus.state, 'not_posted');
  assert.equal(overdueLedger.currentMonthStatus.label, 'Not yet posted');
  assert.equal(fromPaise(overdueLedger.currentMonthStatus.priorUnpaidPaise), 4000);
  assert.equal(overdueLedger.rowsNewestFirst[0].status, 'overdue');

  // On Nov 20 (before Nov 30 due_on) with Oct unpaid
  const midMonthCharges = [charges[0]];
  const notPostedLedger = allocateLoanInterestCharges(
    {...baseLoan, next_due_on: '2026-11-30'},
    midMonthCharges,
    [],
    '2026-11-20'
  );
  assert.equal(notPostedLedger.currentMonthStatus.state, 'not_posted');
  assert.equal(notPostedLedger.currentMonthStatus.dueOn, '2026-11-30');
  assert.equal(fromPaise(notPostedLedger.currentMonthStatus.priorUnpaidPaise), 2000);

  // Settled loan with zero balance and no current-month charge
  const settledLedger = allocateLoanInterestCharges(
    {
      id: 'settled-loan',
      next_due_on: '2026-12-31',
      balance: {principal: 0, interest: 0, total: 0}
    },
    [],
    [],
    '2026-11-20'
  );
  assert.equal(settledLedger.currentMonthStatus.state, 'settled');
  assert.equal(settledLedger.currentMonthStatus.label, 'Settled');
});

test('summarizeBorrowerHome aggregates exact 4 Home metrics from real loans and charges', () => {
  const loanA = baseLoan;
  const loanB = {
    ...baseLoan,
    id: '22222222-2222-4222-8222-222222222222',
    monthly_rate: 3,
    next_due_on: '2026-12-15',
    balance: {principal: 50000, interest: 1500, total: 51500}
  };
  const settledLoan = {
    ...baseLoan,
    id: '33333333-3333-4333-8333-333333333333',
    next_due_on: '2026-12-01',
    balance: {principal: 0, interest: 0, total: 0}
  };

  const charges = [
    {id: 'c1', loan_id: loanA.id, due_on: '2026-11-30', principal_basis: 100000, rate: 2, amount: 2000},
    {id: 'c2', loan_id: loanB.id, due_on: '2026-10-31', principal_basis: 50000, rate: 3, amount: 1500}
  ];
  const payments = [
    {
      id: 'p1',
      loan_id: loanA.id,
      paid_on: '2026-11-29',
      amount: 800,
      interest_paid: 800,
      principal_paid: 0,
      method: 'upi',
      reference: 'REF-1',
      created_at: '2026-11-29T09:00:00Z'
    }
  ];

  const summary = summarizeBorrowerHome([loanA, loanB, settledLoan], charges, payments, '2026-11-30');
  assert.equal(summary.remainingPrincipal, 150000);
  assert.equal(summary.unpaidInterest, 2700);
  assert.equal(summary.totalBalance, 152700);
  assert.equal(summary.upcomingInterestEstimate, 3500);
  assert.equal(summary.activeLoansCount, 2);
  assert.equal(summary.closedLoansCount, 1);
  assert.equal(summary.totalLoansCount, 3);
  assert.equal(summary.unpaidChargeCount, 2);
  assert.equal(summary.overdueChargeCount, 1);
  assert.equal(summary.dueTodayChargeCount, 1);
  assert.equal(summary.earliestNextDueOn, '2026-12-15');
  assert.equal(summary.statusKind, 'overdue');
});

test('summarizeBorrowerHome distinguishes cleared paid, cleared upcoming (pre-posting), mixed, and settled statuses', () => {
  const paidNovLoan = {
    ...baseLoan,
    id: 'aaaa-paid',
    next_due_on: '2026-12-31',
    balance: {principal: 100000, interest: 0, total: 100000}
  };
  const prePostingLoan = {
    ...baseLoan,
    id: 'bbbb-upcoming',
    monthly_rate: 3,
    next_due_on: '2026-12-05',
    balance: {principal: 50000, interest: 0, total: 50000}
  };
  const closedLoan = {
    ...baseLoan,
    id: 'cccc-settled',
    balance: {principal: 0, interest: 0, total: 0}
  };

  assert.equal(estimateMonthlyInterestPaise(paidNovLoan), 200000);
  assert.equal(estimateMonthlyInterestPaise(closedLoan), 0);

  const novCharges = [
    {id: 'c-nov', loan_id: paidNovLoan.id, due_on: '2026-11-30', principal_basis: 100000, rate: 2, amount: 2000}
  ];
  const novPayments = [
    {
      id: 'p-nov',
      loan_id: paidNovLoan.id,
      paid_on: '2026-11-30',
      amount: 2000,
      interest_paid: 2000,
      principal_paid: 0,
      method: 'upi',
      reference: 'PAID-NOV',
      created_at: '2026-11-30T09:00:00Z'
    }
  ];

  // 1. Current month posted AND paid -> cleared_paid
  const paidSummary = summarizeBorrowerHome([paidNovLoan, closedLoan], novCharges, novPayments, '2026-11-30');
  assert.equal(paidSummary.statusKind, 'cleared_paid');
  assert.equal(paidSummary.unpaidInterest, 0);
  assert.equal(paidSummary.currentMonthPaidAmount, 2000);
  assert.equal(paidSummary.upcomingInterestEstimate, 2000);

  // 2. No posted unpaid interest, mid-month pre-posting -> cleared_upcoming (not claimed paid)
  const upcomingSummary = summarizeBorrowerHome(
    [{...prePostingLoan, next_due_on: '2026-11-30'}],
    [],
    [],
    '2026-11-27'
  );
  assert.equal(upcomingSummary.statusKind, 'cleared_upcoming');
  assert.equal(upcomingSummary.unpaidInterest, 0);
  assert.equal(upcomingSummary.upcomingInterestEstimate, 1500);
  assert.equal(upcomingSummary.prePostingUpcomingEstimate, 1500);

  // 3. One paid + one pre-posting -> cleared_mixed
  const mixedSummary = summarizeBorrowerHome(
    [paidNovLoan, prePostingLoan],
    novCharges,
    novPayments,
    '2026-11-30'
  );
  assert.equal(mixedSummary.statusKind, 'cleared_mixed');
  assert.equal(mixedSummary.paidCurrentMonthLoansCount, 1);
  assert.equal(mixedSummary.prePostingLoansCount, 1);
  assert.equal(mixedSummary.upcomingInterestEstimate, 3500);

  // 4. Only closed loans -> settled
  const settledSummary = summarizeBorrowerHome([closedLoan], [], [], '2026-11-30');
  assert.equal(settledSummary.statusKind, 'settled');
  assert.equal(settledSummary.activeLoansCount, 0);
  assert.equal(settledSummary.closedLoansCount, 1);
  assert.equal(settledSummary.upcomingInterestEstimate, 0);
});

test('partitionAndSortBorrowerLoans puts overdue/due-today active loans first and isolates closed loans', () => {
  const closed = {
    ...baseLoan,
    id: 'loan-closed',
    disbursed_on: '2026-06-01',
    balance: {principal: 0, interest: 0, total: 0}
  };
  const prePosting = {
    ...baseLoan,
    id: 'loan-preposting',
    next_due_on: '2026-12-05',
    balance: {principal: 50000, interest: 0, total: 50000}
  };
  const dueToday = {
    ...baseLoan,
    id: 'loan-due-today',
    next_due_on: '2026-12-31',
    balance: {principal: 100000, interest: 2000, total: 102000}
  };
  const overdue = {
    ...baseLoan,
    id: 'loan-overdue',
    next_due_on: '2026-12-15',
    balance: {principal: 40000, interest: 1000, total: 41000}
  };

  const charges = [
    {id: 'c-due', loan_id: 'loan-due-today', due_on: '2026-11-30', principal_basis: 100000, rate: 2, amount: 2000},
    {id: 'c-ovd', loan_id: 'loan-overdue', due_on: '2026-10-31', principal_basis: 40000, rate: 2.5, amount: 1000}
  ];

  const {activeLoans, closedLoans, sortedAllLoans} = partitionAndSortBorrowerLoans(
    [closed, prePosting, dueToday, overdue],
    charges,
    [],
    '2026-11-30'
  );

  assert.deepEqual(
    activeLoans.map(l => l.id),
    ['loan-overdue', 'loan-due-today', 'loan-preposting']
  );
  assert.deepEqual(closedLoans.map(l => l.id), ['loan-closed']);
  assert.deepEqual(
    sortedAllLoans.map(l => l.id),
    ['loan-overdue', 'loan-due-today', 'loan-preposting', 'loan-closed']
  );
});

test('getLoanPayments filters/sorts payments and buildReceiptHtml safely escapes XSS', () => {
  const payments = [
    {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      loan_id: baseLoan.id,
      paid_on: '2026-10-05',
      amount: 2000,
      interest_paid: 2000,
      principal_paid: 0,
      method: 'upi',
      reference: 'OLD-REF',
      created_at: '2026-10-05T10:00:00Z'
    },
    {
      id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      loan_id: 'other-loan',
      paid_on: '2026-11-28',
      amount: 500,
      interest_paid: 500,
      principal_paid: 0,
      method: 'cash',
      reference: 'OTHER',
      created_at: '2026-11-28T10:00:00Z'
    },
    {
      id: 'cccccccc-dddd-eeee-ffff-000000000000',
      loan_id: baseLoan.id,
      paid_on: '2026-11-15',
      amount: 1500,
      interest_paid: 1500,
      principal_paid: 0,
      method: 'bank',
      reference: '<script>alert(1)</script>',
      created_at: '2026-11-15T12:00:00Z'
    }
  ];

  const sorted = getLoanPayments(baseLoan.id, payments);
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].id, 'cccccccc-dddd-eeee-ffff-000000000000');
  assert.equal(sorted[1].id, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

  assert.equal(
    formatReceiptFilename(sorted[0]),
    'velmurugan-receipt-cccccccc-2026-11-15.html'
  );

  const html = buildReceiptHtml(sorted[0], baseLoan, {
    id: baseLoan.client_id,
    customer_code: '26VMC001',
    name: 'Arun <Owner>',
    phone: '9876543210',
    alternate_phone: null,
    address: '',
    notes: '',
    active: true,
    created_at: '2026-08-15T00:00:00Z'
  });

  assert.ok(!html.includes('<script>alert(1)</script>'), 'Must escape script tags in reference');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Must render escaped reference');
  assert.ok(html.includes('Arun &lt;Owner&gt;'), 'Must escape client name');
  assert.ok(html.includes('monthly_remaining_v1'), 'Must state persisted loan terms code');
});

test('followingMonthEndYmd handles month-end transitions and leap years', () => {
  assert.equal(followingMonthEndYmd('2026-08-15'), '2026-09-30');
  assert.equal(followingMonthEndYmd('2026-12-31'), '2027-01-31');
  assert.equal(followingMonthEndYmd('2028-01-31'), '2028-02-29');
  assert.equal(followingMonthEndYmd('2026-01-31'), '2026-02-28');
});

test('allocateLoanInstallments, previewInstallmentPaymentAllocation and borrower overdue count handle persisted schedules and mixed portfolios', () => {
  const instLoan = {
    ...baseLoan,
    id: '44444444-4444-4444-8444-444444444444',
    terms_code: 'installment_reducing_v1',
    installment_months: 3,
    monthly_rate: 2,
    first_due_on: '2026-09-30',
    next_due_on: '2026-10-31',
    balance: {
      principal: 40000,
      interest: 400,
      total: 40400,
      scheduled_interest: 800,
      max_payment: 40800
    }
  };
  const monthlyLoan = {
    ...baseLoan,
    id: '55555555-5555-4555-8555-555555555555',
    terms_code: 'monthly_remaining_v1',
    next_due_on: '2026-12-31',
    balance: {principal: 100000, interest: 2000, total: 102000}
  };
  const zeroRateOverdueInstLoan = {
    ...baseLoan,
    id: '66666666-6666-4666-8666-666666666666',
    terms_code: 'installment_reducing_v1',
    installment_months: 2,
    monthly_rate: 0,
    first_due_on: '2026-10-31',
    next_due_on: '2026-10-31',
    balance: {principal: 1000, interest: 0, total: 1000, max_payment: 1000}
  };

  assert.equal(isInstallmentLoan(instLoan), true);
  assert.equal(getPersistedInstallmentSupport(instLoan).supported, true);

  const installments = [
    {
      id: 'i-1',
      loan_id: instLoan.id,
      installment_number: 1,
      due_on: '2026-09-30',
      principal_due: 20000,
      interest_due: 800,
      total_due: 20800,
      remaining_principal: 40000,
      principal_paid: 20000,
      interest_paid: 800,
      paid_on: '2026-09-30'
    },
    {
      id: 'i-2',
      loan_id: instLoan.id,
      installment_number: 2,
      due_on: '2026-10-31',
      principal_due: 20000,
      interest_due: 600,
      total_due: 20600,
      remaining_principal: 20000,
      principal_paid: 0,
      interest_paid: 200,
      paid_on: null
    },
    {
      id: 'i-3',
      loan_id: instLoan.id,
      installment_number: 3,
      due_on: '2026-12-31',
      principal_due: 20000,
      interest_due: 400,
      total_due: 20400,
      remaining_principal: 0,
      principal_paid: 0,
      interest_paid: 0,
      paid_on: null
    },
    {
      id: 'z-1',
      loan_id: zeroRateOverdueInstLoan.id,
      installment_number: 1,
      due_on: '2026-10-31',
      principal_due: 500,
      interest_due: 0,
      total_due: 500,
      remaining_principal: 500,
      principal_paid: 0,
      interest_paid: 0,
      paid_on: null
    },
    {
      id: 'z-2',
      loan_id: zeroRateOverdueInstLoan.id,
      installment_number: 2,
      due_on: '2026-11-30',
      principal_due: 500,
      interest_due: 0,
      total_due: 500,
      remaining_principal: 0,
      principal_paid: 0,
      interest_paid: 0,
      paid_on: null
    }
  ];

  const ledger = allocateLoanInstallments(instLoan, installments, '2026-11-30');
  assert.equal(ledger.paidCount, 1);
  assert.equal(ledger.remainingCount, 2);
  assert.equal(ledger.overdueCount, 1);
  assert.equal(fromPaise(ledger.overduePaise), 20400);
  assert.equal(fromPaise(ledger.overdueInterestPaise), 400);
  assert.equal(fromPaise(ledger.upcomingInterestEstimatePaise), 400);
  assert.equal(fromPaise(ledger.maxPaymentPaise), 40800);
  assert.equal(ledger.rows[1].status, 'partial_overdue');
  assert.equal(ledger.rows[1].statusLabel, 'Partially paid · Overdue');

  // Preview chronological interest-first installment allocation across #2 and #3
  const preview = previewInstallmentPaymentAllocation(
    installments.filter(i => i.loan_id === instLoan.id),
    21000
  );
  assert.equal(fromPaise(preview.interestPaise), 800); // #2 remaining interest (400) + #3 interest (400)
  assert.equal(fromPaise(preview.principalPaise), 20200); // #2 principal (20000) + #3 partial principal (200)
  assert.equal(preview.allocations.length, 2);

  // Mixed portfolio Home summary tracks combined borrower overdue count across monthly charges & installments
  const charges = [
    {id: 'mc-1', loan_id: monthlyLoan.id, due_on: '2026-10-31', principal_basis: 100000, rate: 2, amount: 2000}
  ];
  const summary = summarizeBorrowerHome(
    [monthlyLoan, instLoan],
    charges,
    [],
    '2026-11-30',
    installments
  );
  assert.equal(summary.overdueChargeCount, 1);
  assert.equal(summary.overdueInstallmentCount, 1);
  assert.equal(summary.overdueCount, 2);
  assert.equal(summary.overdueAmount, 22400);
  assert.equal(summary.statusKind, 'overdue');

  // 0% interest overdue installment triggers overdue status even when unpaidInterest === 0
  const zeroSummary = summarizeBorrowerHome(
    [zeroRateOverdueInstLoan],
    [],
    [],
    '2026-11-30',
    installments
  );
  assert.equal(zeroSummary.overdueInstallmentCount, 1);
  assert.equal(zeroSummary.dueTodayCount, 1);
  assert.equal(zeroSummary.statusKind, 'overdue');

  // Sorting places overdue installment loans ahead of healthy monthly loans
  const healthyMonthly = {
    ...monthlyLoan,
    id: '77777777-7777-4777-8777-777777777777',
    balance: {principal: 100000, interest: 0, total: 100000}
  };
  const sorted = partitionAndSortBorrowerLoans(
    [healthyMonthly, instLoan],
    [],
    [],
    '2026-11-30',
    installments
  );
  assert.deepEqual(
    sorted.activeLoans.map(l => l.id),
    [instLoan.id, healthyMonthly.id]
  );

  // Receipt HTML includes itemized installment allocations
  const allocReceiptHtml = buildReceiptHtml(
    {
      id: 'pay-inst-1',
      loan_id: instLoan.id,
      amount: 21000,
      interest_paid: 800,
      principal_paid: 20200,
      paid_on: '2026-11-30',
      method: 'upi',
      reference: 'EMI-2-3',
      created_at: '2026-11-30T10:00:00Z'
    },
    instLoan,
    {
      id: instLoan.client_id,
      customer_code: '26VMC002',
      name: 'Ravi Kumar',
      phone: '9876543210',
      alternate_phone: '',
      address: '',
      work: '',
      auth_user_id: null,
      active: true,
      created_at: '2026-08-15T00:00:00Z'
    },
    [
      {
        id: 'a1',
        payment_id: 'pay-inst-1',
        loan_id: instLoan.id,
        installment_id: 'i-2',
        installment_number: 2,
        interest_paid: 400,
        principal_paid: 20000,
        created_at: '2026-11-30T10:00:00Z'
      }
    ]
  );
  assert.ok(allocReceiptHtml.includes('Installment Allocation'));
  assert.ok(allocReceiptHtml.includes('installment_reducing_v1'));

  // One-time total interest flat installment loan (installment_flat_v1) preserves schedule, labels & receipts
  const flatInstLoan = {
    ...baseLoan,
    id: '88888888-8888-4888-8888-888888888888',
    original_principal: 20000,
    terms_code: 'installment_flat_v1',
    installment_months: 12,
    monthly_rate: 20,
    first_due_on: '2026-09-30',
    next_due_on: '2026-10-31',
    balance: {
      principal: 18333.33,
      interest: 333.33,
      total: 18666.66,
      scheduled_interest: 3666.67,
      max_payment: 22000
    }
  };
  assert.equal(isFlatInstallmentLoan(flatInstLoan), true);
  assert.equal(isFlatInstallmentLoan(instLoan), false);
  assert.equal(isInstallmentLoan(flatInstLoan), true);
  assert.equal(getPersistedInstallmentSupport(flatInstLoan).supported, true);
  assert.equal(getPersistedInstallmentSupport(flatInstLoan).termsCode, 'installment_flat_v1');

  const flatReceiptHtml = buildReceiptHtml(
    {
      id: 'pay-flat-1',
      loan_id: flatInstLoan.id,
      amount: 2000,
      interest_paid: 333.33,
      principal_paid: 1666.67,
      paid_on: '2026-09-30',
      method: 'upi',
      reference: 'FLAT-1',
      created_at: '2026-09-30T10:00:00Z'
    },
    flatInstLoan,
    undefined,
    [
      {
        id: 'af-1',
        payment_id: 'pay-flat-1',
        loan_id: flatInstLoan.id,
        installment_id: 'fi-1',
        installment_number: 1,
        interest_paid: 333.33,
        principal_paid: 1666.67,
        created_at: '2026-09-30T10:00:00Z'
      }
    ]
  );
  assert.ok(flatReceiptHtml.includes('Installment Allocation'));
  assert.ok(flatReceiptHtml.includes('installment_flat_v1'));
});
