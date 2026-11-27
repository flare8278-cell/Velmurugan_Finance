import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLoanInterestCharges,
  buildReceiptHtml,
  formatReceiptFilename,
  fromPaise,
  getLoanPayments,
  getPersistedInstallmentSupport,
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
  assert.equal(summary.activeLoansCount, 2);
  assert.equal(summary.totalLoansCount, 3);
  assert.equal(summary.unpaidChargeCount, 2);
  assert.equal(summary.overdueChargeCount, 1);
  assert.equal(summary.dueTodayChargeCount, 1);
  assert.equal(summary.earliestNextDueOn, '2026-12-15');
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
