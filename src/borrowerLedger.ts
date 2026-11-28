import type {
  Client,
  InstallmentAllocation,
  InterestCharge,
  Loan,
  LoanInstallment,
  Payment
} from './types.ts';

export type ChargeAllocationStatus =
  | 'paid'
  | 'due_today'
  | 'partial_due_today'
  | 'overdue'
  | 'partial_overdue'
  | 'unpaid'
  | 'partial_upcoming';

export type AllocatedInstallmentRow = {
  installment: LoanInstallment;
  principalDuePaise: number;
  interestDuePaise: number;
  totalDuePaise: number;
  principalPaidPaise: number;
  interestPaidPaise: number;
  totalPaidPaise: number;
  unpaidPrincipalPaise: number;
  unpaidInterestPaise: number;
  unpaidTotalPaise: number;
  status: ChargeAllocationStatus;
  statusLabel: string;
  isPaid: boolean;
  isDueToday: boolean;
  isOverdue: boolean;
  isUpcoming: boolean;
};

export type LoanInstallmentLedger = {
  rows: AllocatedInstallmentRow[];
  paidCount: number;
  remainingCount: number;
  overdueCount: number;
  overduePaise: number;
  overdueInterestPaise: number;
  dueTodayCount: number;
  dueTodayPaise: number;
  dueNowPaise: number;
  dueNowInterestPaise: number;
  totalRemainingPrincipalPaise: number;
  totalRemainingInterestPaise: number;
  maxPaymentPaise: number;
  upcomingInterestEstimatePaise: number;
  nextInstallment: AllocatedInstallmentRow | null;
  currentMonthStatus: CurrentMonthInterestStatus;
};

export type InstallmentAllocationPreviewItem = {
  installmentNumber: number;
  dueOn: string;
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
};

export type InstallmentPaymentPreview = {
  interestPaise: number;
  principalPaise: number;
  totalPaise: number;
  maxPaymentPaise: number;
  allocations: InstallmentAllocationPreviewItem[];
};

export type AllocatedChargeRow = {
  charge: InterestCharge;
  amountPaise: number;
  paidPaise: number;
  unpaidPaise: number;
  status: ChargeAllocationStatus;
  statusLabel: string;
  isPaid: boolean;
  isDueToday: boolean;
  isOverdue: boolean;
};

export type CurrentMonthInterestStatus = {
  monthKey: string;
  hasPostedCharge: boolean;
  state: 'paid' | 'due_today' | 'overdue' | 'partial' | 'unpaid' | 'not_posted' | 'settled';
  label: string;
  postedPaise: number;
  paidPaise: number;
  unpaidPaise: number;
  dueOn: string | null;
  priorUnpaidPaise: number;
};

export type LoanInterestLedger = {
  rowsChronological: AllocatedChargeRow[];
  rowsNewestFirst: AllocatedChargeRow[];
  totalChargedPaise: number;
  totalInterestPaidPaise: number;
  totalUnpaidPaise: number;
  unallocatedInterestPaidPaise: number;
  upcomingInterestEstimatePaise: number;
  currentMonthStatus: CurrentMonthInterestStatus;
};

export type HomeMonthlyStatusKind =
  | 'overdue'
  | 'due_today'
  | 'unpaid'
  | 'cleared_paid'
  | 'cleared_upcoming'
  | 'cleared_mixed'
  | 'settled';

export type BorrowerHomeSummary = {
  remainingPrincipal: number;
  unpaidInterest: number;
  totalBalance: number;
  upcomingInterestEstimate: number;
  prePostingUpcomingEstimate: number;
  currentMonthPaidAmount: number;
  activeLoansCount: number;
  closedLoansCount: number;
  totalLoansCount: number;
  unpaidChargeCount: number;
  overdueChargeCount: number;
  dueTodayChargeCount: number;
  overdueInstallmentCount: number;
  dueTodayInstallmentCount: number;
  overdueCount: number;
  dueTodayCount: number;
  overdueAmount: number;
  paidCurrentMonthLoansCount: number;
  prePostingLoansCount: number;
  currentMonthKey: string;
  earliestNextDueOn: string | null;
  statusKind: HomeMonthlyStatusKind;
};

export type PersistedInstallmentSupport = {
  supported: boolean;
  termsCode: string;
};

export function toPaise(value: number | string | null | undefined): number {
  return Math.round(Number(value || 0) * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

export function isFlatInstallmentLoan(loan: Pick<Loan, 'terms_code'>): boolean {
  return loan.terms_code === 'installment_flat_v1';
}

export function isInstallmentLoan(loan: Pick<Loan, 'terms_code'>): boolean {
  return (
    loan.terms_code === 'installment_reducing_v1' ||
    loan.terms_code === 'installment_flat_v1'
  );
}

export function followingMonthEndYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || '').slice(0, 10));
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-based month; Date.UTC(year, month + 1, 0) = last day of following month
  const d = new Date(Date.UTC(year, month + 1, 0));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function estimateMonthlyInterestPaise(
  loan: Pick<Loan, 'balance'> & {monthly_rate?: number}
): number {
  const principalPaise = Math.max(0, toPaise(loan.balance.principal));
  if (principalPaise === 0) return 0;
  return Math.round((principalPaise * Number(loan.monthly_rate || 0)) / 100);
}

export function isLoanClosed(loan: Pick<Loan, 'balance'>): boolean {
  const maxRem = loan.balance.max_payment ?? loan.balance.total;
  return toPaise(loan.balance.total) === 0 && toPaise(maxRem) === 0;
}

/**
 * Checks whether a loan uses a persisted installment schedule
 * (`installment_flat_v1` or `installment_reducing_v1` with persisted rows in
 * finance_loan_installments) vs legacy `monthly_remaining_v1`.
 */
export function getPersistedInstallmentSupport(
  loan: Pick<Loan, 'terms_code'> & {id?: string},
  installments: LoanInstallment[] = []
): PersistedInstallmentSupport {
  const termsCode = loan.terms_code || 'monthly_remaining_v1';
  const hasRows = loan.id ? installments.some(i => i.loan_id === loan.id) : false;
  return {
    supported:
      termsCode === 'installment_reducing_v1' ||
      termsCode === 'installment_flat_v1' ||
      hasRows,
    termsCode
  };
}

/**
 * Allocates actual loan interest_paid payments oldest-first (FIFO) across actual
 * persisted finance_interest_charges ordered by `due_on`, then derives the
 * current-month posted interest status against workspace `businessDate` (YYYY-MM-DD).
 */
export function allocateLoanInterestCharges(
  loan: Pick<Loan, 'id' | 'next_due_on' | 'balance'> & {monthly_rate?: number},
  charges: InterestCharge[],
  payments: Payment[],
  businessDate: string
): LoanInterestLedger {
  const loanCharges = charges
    .filter(c => c.loan_id === loan.id)
    .slice()
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id));

  const loanPayments = payments.filter(p => p.loan_id === loan.id);
  const totalInterestPaidPaise = loanPayments.reduce(
    (sum, p) => sum + toPaise(p.interest_paid),
    0
  );

  let remainingPaidPaise = totalInterestPaidPaise;
  let totalChargedPaise = 0;

  const rowsChronological: AllocatedChargeRow[] = loanCharges.map(charge => {
    const amountPaise = Math.max(0, toPaise(charge.amount));
    const paidPaise = Math.min(remainingPaidPaise, amountPaise);
    const unpaidPaise = amountPaise - paidPaise;
    remainingPaidPaise -= paidPaise;
    totalChargedPaise += amountPaise;

    let status: ChargeAllocationStatus;
    let statusLabel: string;
    const isPaid = unpaidPaise === 0;
    const isDueToday = !isPaid && charge.due_on === businessDate;
    const isOverdue = !isPaid && charge.due_on < businessDate;

    if (isPaid) {
      status = 'paid';
      statusLabel = 'Paid';
    } else if (isDueToday) {
      status = paidPaise > 0 ? 'partial_due_today' : 'due_today';
      statusLabel = paidPaise > 0 ? 'Partially paid · Due today' : 'Due today';
    } else if (isOverdue) {
      status = paidPaise > 0 ? 'partial_overdue' : 'overdue';
      statusLabel = paidPaise > 0 ? 'Partially paid · Overdue' : 'Overdue';
    } else {
      status = paidPaise > 0 ? 'partial_upcoming' : 'unpaid';
      statusLabel = paidPaise > 0 ? 'Partially paid' : 'Unpaid';
    }

    return {
      charge,
      amountPaise,
      paidPaise,
      unpaidPaise,
      status,
      statusLabel,
      isPaid,
      isDueToday,
      isOverdue
    };
  });

  const rowsNewestFirst = rowsChronological.slice().reverse();
  const totalUnpaidPaise = rowsChronological.reduce((sum, r) => sum + r.unpaidPaise, 0);

  const monthKey = businessDate.slice(0, 7);
  const currentMonthRows = rowsChronological.filter(
    r => r.charge.due_on.slice(0, 7) === monthKey
  );
  const priorUnpaidPaise = rowsChronological
    .filter(r => r.charge.due_on.slice(0, 7) < monthKey)
    .reduce((sum, r) => sum + r.unpaidPaise, 0);

  let currentMonthStatus: CurrentMonthInterestStatus;

  if (currentMonthRows.length > 0) {
    const postedPaise = currentMonthRows.reduce((s, r) => s + r.amountPaise, 0);
    const paidPaise = currentMonthRows.reduce((s, r) => s + r.paidPaise, 0);
    const unpaidPaise = currentMonthRows.reduce((s, r) => s + r.unpaidPaise, 0);
    const dueOn = currentMonthRows[currentMonthRows.length - 1].charge.due_on;

    let state: CurrentMonthInterestStatus['state'];
    let label: string;
    if (unpaidPaise === 0) {
      state = 'paid';
      label = 'Paid';
    } else if (currentMonthRows.some(r => r.isDueToday)) {
      state = paidPaise > 0 ? 'partial' : 'due_today';
      label = paidPaise > 0 ? 'Partially paid · Due today' : 'Due today';
    } else if (currentMonthRows.some(r => r.isOverdue)) {
      state = paidPaise > 0 ? 'partial' : 'overdue';
      label = paidPaise > 0 ? 'Partially paid · Overdue' : 'Overdue';
    } else {
      state = paidPaise > 0 ? 'partial' : 'unpaid';
      label = paidPaise > 0 ? 'Partially paid' : 'Unpaid';
    }

    currentMonthStatus = {
      monthKey,
      hasPostedCharge: true,
      state,
      label,
      postedPaise,
      paidPaise,
      unpaidPaise,
      dueOn,
      priorUnpaidPaise
    };
  } else if (toPaise(loan.balance.principal) === 0 && toPaise(loan.balance.interest) === 0) {
    currentMonthStatus = {
      monthKey,
      hasPostedCharge: false,
      state: 'settled',
      label: 'Settled',
      postedPaise: 0,
      paidPaise: 0,
      unpaidPaise: 0,
      dueOn: null,
      priorUnpaidPaise
    };
  } else {
    currentMonthStatus = {
      monthKey,
      hasPostedCharge: false,
      state: 'not_posted',
      label: 'Not yet posted',
      postedPaise: 0,
      paidPaise: 0,
      unpaidPaise: 0,
      dueOn: loan.next_due_on || null,
      priorUnpaidPaise
    };
  }

  const upcomingInterestEstimatePaise = estimateMonthlyInterestPaise(loan);

  return {
    rowsChronological,
    rowsNewestFirst,
    totalChargedPaise,
    totalInterestPaidPaise,
    totalUnpaidPaise,
    unallocatedInterestPaidPaise: remainingPaidPaise,
    upcomingInterestEstimatePaise,
    currentMonthStatus
  };
}

export function allocateLoanInstallments(
  loan: Pick<Loan, 'id' | 'next_due_on' | 'balance'>,
  installments: LoanInstallment[],
  businessDate: string
): LoanInstallmentLedger {
  const loanRows = installments
    .filter(i => i.loan_id === loan.id)
    .slice()
    .sort((a, b) => a.installment_number - b.installment_number || a.due_on.localeCompare(b.due_on));

  let paidCount = 0;
  let remainingCount = 0;
  let overdueCount = 0;
  let overduePaise = 0;
  let overdueInterestPaise = 0;
  let dueTodayCount = 0;
  let dueTodayPaise = 0;
  let dueNowPaise = 0;
  let dueNowInterestPaise = 0;
  let totalRemainingPrincipalPaise = 0;
  let totalRemainingInterestPaise = 0;
  let maxPaymentPaise = 0;

  const rows: AllocatedInstallmentRow[] = loanRows.map(inst => {
    const principalDuePaise = Math.max(0, toPaise(inst.principal_due));
    const interestDuePaise = Math.max(0, toPaise(inst.interest_due));
    const totalDuePaise = principalDuePaise + interestDuePaise;
    const principalPaidPaise = Math.min(principalDuePaise, Math.max(0, toPaise(inst.principal_paid)));
    const interestPaidPaise = Math.min(interestDuePaise, Math.max(0, toPaise(inst.interest_paid)));
    const totalPaidPaise = principalPaidPaise + interestPaidPaise;
    const unpaidPrincipalPaise = principalDuePaise - principalPaidPaise;
    const unpaidInterestPaise = interestDuePaise - interestPaidPaise;
    const unpaidTotalPaise = unpaidPrincipalPaise + unpaidInterestPaise;

    const isPaid = unpaidTotalPaise === 0;
    const isDueToday = !isPaid && inst.due_on === businessDate;
    const isOverdue = !isPaid && inst.due_on < businessDate;
    const isUpcoming = !isPaid && inst.due_on > businessDate;

    let status: ChargeAllocationStatus;
    let statusLabel: string;
    if (isPaid) {
      status = 'paid';
      statusLabel = 'Paid';
      paidCount++;
    } else if (isDueToday) {
      status = totalPaidPaise > 0 ? 'partial_due_today' : 'due_today';
      statusLabel = totalPaidPaise > 0 ? 'Partially paid · Due today' : 'Due today';
      remainingCount++;
      dueTodayCount++;
      dueTodayPaise += unpaidTotalPaise;
      dueNowPaise += unpaidTotalPaise;
      dueNowInterestPaise += unpaidInterestPaise;
    } else if (isOverdue) {
      status = totalPaidPaise > 0 ? 'partial_overdue' : 'overdue';
      statusLabel = totalPaidPaise > 0 ? 'Partially paid · Overdue' : 'Overdue';
      remainingCount++;
      overdueCount++;
      overduePaise += unpaidTotalPaise;
      overdueInterestPaise += unpaidInterestPaise;
      dueNowPaise += unpaidTotalPaise;
      dueNowInterestPaise += unpaidInterestPaise;
    } else {
      status = totalPaidPaise > 0 ? 'partial_upcoming' : 'unpaid';
      statusLabel = totalPaidPaise > 0 ? 'Partially paid' : 'Scheduled';
      remainingCount++;
    }

    totalRemainingPrincipalPaise += unpaidPrincipalPaise;
    totalRemainingInterestPaise += unpaidInterestPaise;
    maxPaymentPaise += unpaidTotalPaise;

    return {
      installment: inst,
      principalDuePaise,
      interestDuePaise,
      totalDuePaise,
      principalPaidPaise,
      interestPaidPaise,
      totalPaidPaise,
      unpaidPrincipalPaise,
      unpaidInterestPaise,
      unpaidTotalPaise,
      status,
      statusLabel,
      isPaid,
      isDueToday,
      isOverdue,
      isUpcoming
    };
  });

  const nextInstallment = rows.find(r => !r.isPaid) || null;
  const nextFutureInstallment = rows.find(r => r.isUpcoming && r.unpaidTotalPaise > 0) || null;
  const upcomingInterestEstimatePaise = nextFutureInstallment ? nextFutureInstallment.unpaidInterestPaise : 0;

  const monthKey = businessDate.slice(0, 7);
  const currentMonthRows = rows.filter(r => r.installment.due_on.slice(0, 7) === monthKey);
  const priorUnpaidPaise = rows
    .filter(r => r.installment.due_on.slice(0, 7) < monthKey)
    .reduce((sum, r) => sum + r.unpaidTotalPaise, 0);

  let currentMonthStatus: CurrentMonthInterestStatus;
  if (currentMonthRows.length > 0) {
    const scheduledTotalPaise = currentMonthRows.reduce((s, r) => s + r.totalDuePaise, 0);
    const paidTotalPaise = currentMonthRows.reduce((s, r) => s + r.totalPaidPaise, 0);
    const unpaidTotalPaise = currentMonthRows.reduce((s, r) => s + r.unpaidTotalPaise, 0);
    const dueOn = currentMonthRows[currentMonthRows.length - 1].installment.due_on;

    if (unpaidTotalPaise === 0) {
      currentMonthStatus = {
        monthKey,
        hasPostedCharge: true,
        state: 'paid',
        label: 'Paid',
        postedPaise: scheduledTotalPaise,
        paidPaise: paidTotalPaise,
        unpaidPaise: 0,
        dueOn,
        priorUnpaidPaise
      };
    } else if (currentMonthRows.some(r => r.isDueToday)) {
      currentMonthStatus = {
        monthKey,
        hasPostedCharge: true,
        state: paidTotalPaise > 0 ? 'partial' : 'due_today',
        label: paidTotalPaise > 0 ? 'Partially paid · Due today' : 'Due today',
        postedPaise: scheduledTotalPaise,
        paidPaise: paidTotalPaise,
        unpaidPaise: unpaidTotalPaise,
        dueOn,
        priorUnpaidPaise
      };
    } else if (currentMonthRows.some(r => r.isOverdue)) {
      currentMonthStatus = {
        monthKey,
        hasPostedCharge: true,
        state: paidTotalPaise > 0 ? 'partial' : 'overdue',
        label: paidTotalPaise > 0 ? 'Partially paid · Overdue' : 'Overdue',
        postedPaise: scheduledTotalPaise,
        paidPaise: paidTotalPaise,
        unpaidPaise: unpaidTotalPaise,
        dueOn,
        priorUnpaidPaise
      };
    } else {
      currentMonthStatus = {
        monthKey,
        hasPostedCharge: false,
        state: 'not_posted',
        label: paidTotalPaise > 0 ? 'Partially paid · Scheduled' : 'Scheduled',
        postedPaise: scheduledTotalPaise,
        paidPaise: paidTotalPaise,
        unpaidPaise: unpaidTotalPaise,
        dueOn,
        priorUnpaidPaise
      };
    }
  } else if (maxPaymentPaise === 0 && toPaise(loan.balance.total) === 0) {
    currentMonthStatus = {
      monthKey,
      hasPostedCharge: false,
      state: 'settled',
      label: 'Settled',
      postedPaise: 0,
      paidPaise: 0,
      unpaidPaise: 0,
      dueOn: null,
      priorUnpaidPaise
    };
  } else {
    currentMonthStatus = {
      monthKey,
      hasPostedCharge: false,
      state: 'not_posted',
      label: 'Scheduled',
      postedPaise: 0,
      paidPaise: 0,
      unpaidPaise: 0,
      dueOn: nextInstallment ? nextInstallment.installment.due_on : loan.next_due_on || null,
      priorUnpaidPaise
    };
  }

  return {
    rows,
    paidCount,
    remainingCount,
    overdueCount,
    overduePaise,
    overdueInterestPaise,
    dueTodayCount,
    dueTodayPaise,
    dueNowPaise,
    dueNowInterestPaise,
    totalRemainingPrincipalPaise,
    totalRemainingInterestPaise,
    maxPaymentPaise,
    upcomingInterestEstimatePaise,
    nextInstallment,
    currentMonthStatus
  };
}

export function previewInstallmentPaymentAllocation(
  installments: LoanInstallment[],
  amountRupees: number | string
): InstallmentPaymentPreview {
  const maxPaymentPaise = installments.reduce(
    (s, inst) =>
      s +
      Math.max(0, toPaise(inst.interest_due) - toPaise(inst.interest_paid)) +
      Math.max(0, toPaise(inst.principal_due) - toPaise(inst.principal_paid)),
    0
  );
  let remainingPaise = Math.min(maxPaymentPaise, Math.max(0, toPaise(amountRupees)));
  let interestPaise = 0;
  let principalPaise = 0;
  const allocations: InstallmentAllocationPreviewItem[] = [];

  const sorted = installments
    .slice()
    .sort((a, b) => a.installment_number - b.installment_number);

  for (const inst of sorted) {
    if (remainingPaise <= 0) break;
    const remI = Math.max(0, toPaise(inst.interest_due) - toPaise(inst.interest_paid));
    const remP = Math.max(0, toPaise(inst.principal_due) - toPaise(inst.principal_paid));
    if (remI === 0 && remP === 0) continue;

    const payI = Math.min(remainingPaise, remI);
    remainingPaise -= payI;
    const payP = Math.min(remainingPaise, remP);
    remainingPaise -= payP;

    if (payI > 0 || payP > 0) {
      interestPaise += payI;
      principalPaise += payP;
      allocations.push({
        installmentNumber: inst.installment_number,
        dueOn: inst.due_on,
        interestPaise: payI,
        principalPaise: payP,
        totalPaise: payI + payP
      });
    }
  }

  return {
    interestPaise,
    principalPaise,
    totalPaise: interestPaise + principalPaise,
    maxPaymentPaise,
    allocations
  };
}

export function summarizeBorrowerHome(
  loans: Loan[],
  charges: InterestCharge[],
  payments: Payment[],
  businessDate: string,
  installments: LoanInstallment[] = []
): BorrowerHomeSummary {
  let remainingPrincipalPaise = 0;
  let unpaidInterestPaise = 0;
  let totalBalancePaise = 0;
  let upcomingInterestEstimatePaise = 0;
  let prePostingUpcomingEstimatePaise = 0;
  let currentMonthPaidPaise = 0;
  let activeLoansCount = 0;
  let closedLoansCount = 0;
  let unpaidChargeCount = 0;
  let overdueChargeCount = 0;
  let dueTodayChargeCount = 0;
  let overdueInstallmentCount = 0;
  let dueTodayInstallmentCount = 0;
  let overdueAmountPaise = 0;
  let paidCurrentMonthLoansCount = 0;
  let prePostingLoansCount = 0;
  let earliestNextDueOn: string | null = null;
  const currentMonthKey = businessDate.slice(0, 7);

  for (const loan of loans) {
    const p = toPaise(loan.balance.principal);
    const i = toPaise(loan.balance.interest);
    const t = toPaise(loan.balance.total);
    remainingPrincipalPaise += p;
    unpaidInterestPaise += i;
    totalBalancePaise += t;

    const closed = isLoanClosed(loan);
    if (!closed) {
      activeLoansCount++;
    } else {
      closedLoansCount++;
    }

    if (isInstallmentLoan(loan)) {
      const instLedger = allocateLoanInstallments(loan, installments, businessDate);
      const loanUpcomingPaise = instLedger.upcomingInterestEstimatePaise;
      upcomingInterestEstimatePaise += loanUpcomingPaise;

      overdueInstallmentCount += instLedger.overdueCount;
      dueTodayInstallmentCount += instLedger.dueTodayCount;
      overdueAmountPaise += instLedger.overduePaise;

      if (!closed) {
        const nextDue = instLedger.nextInstallment?.installment.due_on || loan.next_due_on;
        if (nextDue && (!earliestNextDueOn || nextDue < earliestNextDueOn)) {
          earliestNextDueOn = nextDue;
        }
        if (instLedger.currentMonthStatus.hasPostedCharge && instLedger.currentMonthStatus.state === 'paid') {
          paidCurrentMonthLoansCount++;
          currentMonthPaidPaise += instLedger.currentMonthStatus.paidPaise;
        } else if (instLedger.overdueCount === 0 && instLedger.dueTodayCount === 0) {
          prePostingLoansCount++;
          prePostingUpcomingEstimatePaise += loanUpcomingPaise;
        }
      }
    } else {
      const loanUpcomingPaise = estimateMonthlyInterestPaise(loan);
      upcomingInterestEstimatePaise += loanUpcomingPaise;

      if (p > 0 && loan.next_due_on) {
        if (!earliestNextDueOn || loan.next_due_on < earliestNextDueOn) {
          earliestNextDueOn = loan.next_due_on;
        }
      }

      const ledger = allocateLoanInterestCharges(loan, charges, payments, businessDate);
      for (const row of ledger.rowsChronological) {
        if (!row.isPaid) unpaidChargeCount++;
        if (row.isOverdue) {
          overdueChargeCount++;
          overdueAmountPaise += row.unpaidPaise;
        }
        if (row.isDueToday) dueTodayChargeCount++;
      }

      if (!closed) {
        if (ledger.currentMonthStatus.hasPostedCharge && ledger.currentMonthStatus.state === 'paid') {
          paidCurrentMonthLoansCount++;
          currentMonthPaidPaise += ledger.currentMonthStatus.paidPaise;
        } else if (ledger.currentMonthStatus.state === 'not_posted') {
          prePostingLoansCount++;
          prePostingUpcomingEstimatePaise += loanUpcomingPaise;
        }
      }
    }
  }

  const overdueCount = overdueChargeCount + overdueInstallmentCount;
  const dueTodayCount = dueTodayChargeCount + dueTodayInstallmentCount;

  let statusKind: HomeMonthlyStatusKind;
  if (overdueCount > 0) {
    statusKind = 'overdue';
  } else if (dueTodayCount > 0) {
    statusKind = 'due_today';
  } else if (unpaidInterestPaise > 0) {
    statusKind = 'unpaid';
  } else if (activeLoansCount === 0) {
    statusKind = 'settled';
  } else if (paidCurrentMonthLoansCount > 0 && prePostingLoansCount > 0) {
    statusKind = 'cleared_mixed';
  } else if (paidCurrentMonthLoansCount > 0) {
    statusKind = 'cleared_paid';
  } else {
    statusKind = 'cleared_upcoming';
  }

  return {
    remainingPrincipal: fromPaise(remainingPrincipalPaise),
    unpaidInterest: fromPaise(unpaidInterestPaise),
    totalBalance: fromPaise(totalBalancePaise),
    upcomingInterestEstimate: fromPaise(upcomingInterestEstimatePaise),
    prePostingUpcomingEstimate: fromPaise(prePostingUpcomingEstimatePaise),
    currentMonthPaidAmount: fromPaise(currentMonthPaidPaise),
    activeLoansCount,
    closedLoansCount,
    totalLoansCount: loans.length,
    unpaidChargeCount,
    overdueChargeCount,
    dueTodayChargeCount,
    overdueInstallmentCount,
    dueTodayInstallmentCount,
    overdueCount,
    dueTodayCount,
    overdueAmount: fromPaise(overdueAmountPaise),
    paidCurrentMonthLoansCount,
    prePostingLoansCount,
    currentMonthKey,
    earliestNextDueOn,
    statusKind
  };
}

export function partitionAndSortBorrowerLoans(
  loans: Loan[],
  charges: InterestCharge[],
  payments: Payment[],
  businessDate: string,
  installments: LoanInstallment[] = []
): {
  activeLoans: Loan[];
  closedLoans: Loan[];
  sortedAllLoans: Loan[];
} {
  const priorityScore = (loan: Loan): number => {
    if (isInstallmentLoan(loan)) {
      const ledger = allocateLoanInstallments(loan, installments, businessDate);
      if (ledger.overdueCount > 0) return 0;
      if (ledger.dueTodayCount > 0) return 1;
      if (toPaise(loan.balance.interest) > 0) return 2;
      return 3;
    }
    const ledger = allocateLoanInterestCharges(loan, charges, payments, businessDate);
    if (ledger.rowsChronological.some(r => r.isOverdue)) return 0;
    if (ledger.rowsChronological.some(r => r.isDueToday)) return 1;
    if (ledger.totalUnpaidPaise > 0 || toPaise(loan.balance.interest) > 0) return 2;
    return 3;
  };

  const activeLoans = loans
    .filter(l => !isLoanClosed(l))
    .slice()
    .sort((a, b) => {
      const pa = priorityScore(a);
      const pb = priorityScore(b);
      if (pa !== pb) return pa - pb;
      if (a.next_due_on !== b.next_due_on) {
        return a.next_due_on.localeCompare(b.next_due_on);
      }
      if (a.disbursed_on !== b.disbursed_on) {
        return b.disbursed_on.localeCompare(a.disbursed_on);
      }
      return a.id.localeCompare(b.id);
    });

  const closedLoans = loans
    .filter(l => isLoanClosed(l))
    .slice()
    .sort(
      (a, b) =>
        b.disbursed_on.localeCompare(a.disbursed_on) || a.id.localeCompare(b.id)
    );

  return {
    activeLoans,
    closedLoans,
    sortedAllLoans: [...activeLoans, ...closedLoans]
  };
}

export function getLoanPayments(loanId: string, payments: Payment[]): Payment[] {
  return payments
    .filter(p => p.loan_id === loanId)
    .slice()
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.created_at.localeCompare(a.created_at));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInr(value: number | string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDisplayDate(value: string): string {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? value + 'T12:00:00' : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

export function formatReceiptFilename(payment: Pick<Payment, 'id' | 'paid_on'>): string {
  const shortId = (payment.id || 'receipt').slice(0, 8).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const cleanDate = (payment.paid_on || 'date').replace(/[^0-9-]/g, '');
  return `velmurugan-receipt-${shortId}-${cleanDate}.html`;
}

export function buildReceiptHtml(
  payment: Payment,
  loan?: Loan,
  client?: Client,
  allocations: InstallmentAllocation[] = []
): string {
  const receiptCode = payment.id.slice(0, 8).toUpperCase();
  const loanCode = payment.loan_id.slice(0, 8).toUpperCase();
  const termsCode = loan?.terms_code || 'monthly_remaining_v1';
  const paymentAllocs = allocations
    .filter(a => a.payment_id === payment.id)
    .slice()
    .sort((a, b) => a.installment_number - b.installment_number);

  const allocSection = paymentAllocs.length
    ? `<section style="margin:0 0 18px;">
      <p style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px;">Installment Allocation</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid #cbd5e1;color:#64748b;text-align:left;">
            <th style="padding:6px 4px;">Installment</th>
            <th style="padding:6px 4px;text-align:right;">Interest</th>
            <th style="padding:6px 4px;text-align:right;">Capital</th>
          </tr>
        </thead>
        <tbody>
          ${paymentAllocs
            .map(
              a => `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:6px 4px;font-weight:600;">#${escapeHtml(String(a.installment_number))}</td>
            <td style="padding:6px 4px;text-align:right;">${escapeHtml(formatInr(a.interest_paid))}</td>
            <td style="padding:6px 4px;text-align:right;">${escapeHtml(formatInr(a.principal_paid))}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </section>`
    : '';

  const policyFoot =
    termsCode === 'installment_reducing_v1' || termsCode === 'installment_flat_v1'
      ? `Recorded under ${escapeHtml(termsCode)} (installments allocated chronologically, interest cleared prior to principal per installment). Salem · Clear accounts.`
      : `Recorded under ${escapeHtml(termsCode)} (unpaid posted interest cleared prior to capital reduction). Salem · Clear accounts.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Receipt #${escapeHtml(receiptCode)} — Velmurugan Finance</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px 16px; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 28px; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06); }
    .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #0284c7; font-weight: 700; margin: 0 0 6px; }
    h1 { margin: 0 0 4px; font-size: 28px; font-variant-numeric: tabular-nums; }
    .sub { margin: 0 0 22px; color: #475569; font-size: 14px; }
    dl { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 18px 0; margin: 0 0 18px; font-size: 14px; }
    dt { color: #64748b; font-weight: 500; }
    dd { margin: 0; font-weight: 600; word-break: break-word; font-variant-numeric: tabular-nums; }
    .foot { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">VELMURUGAN FINANCE · PAYMENT RECEIPT</p>
    <h1>${escapeHtml(formatInr(payment.amount))}</h1>
    <p class="sub">Received on ${escapeHtml(formatDisplayDate(payment.paid_on))}</p>
    <dl>
      <dt>Receipt ID</dt><dd>${escapeHtml(payment.id)}</dd>
      <dt>Client</dt><dd>${escapeHtml(client?.name || 'Borrower')}</dd>
      <dt>Customer ID</dt><dd>${escapeHtml(client?.customer_code || '—')}</dd>
      <dt>Loan Reference</dt><dd>#${escapeHtml(loanCode)} (${escapeHtml(payment.loan_id)})</dd>
      <dt>Terms</dt><dd>${escapeHtml(termsCode)}</dd>
      <dt>Interest Paid</dt><dd>${escapeHtml(formatInr(payment.interest_paid))}</dd>
      <dt>Capital Paid</dt><dd>${escapeHtml(formatInr(payment.principal_paid))}</dd>
      <dt>Method</dt><dd>${escapeHtml(payment.method.toUpperCase())}</dd>
      <dt>Reference</dt><dd>${escapeHtml(payment.reference || '—')}</dd>
    </dl>
    ${allocSection}
    <p class="foot">${escapeHtml(policyFoot)}</p>
  </main>
</body>
</html>
`;
}
