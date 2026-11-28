export type Installment = {
  number: number;
  principal: number;
  interest: number;
  payment: number;
  remainingPrincipal: number;
};

/** Amounts are integer paise. Legacy reducing-balance monthly EMI calculator preserved for existing schedules. */
export function calculateInstallments(
  principalPaise: number,
  monthlyRatePercent: number,
  months: number
): Installment[] {
  if (!Number.isSafeInteger(principalPaise) || principalPaise < months || principalPaise > 100_000_000_000) {
    throw new RangeError('Enter a valid loan principal.');
  }
  if (!Number.isInteger(months) || months < 1 || months > 360) {
    throw new RangeError('Enter a repayment term between 1 and 360 months.');
  }
  if (!Number.isFinite(monthlyRatePercent) || monthlyRatePercent < 0 || monthlyRatePercent > 100) {
    throw new RangeError('Enter a monthly interest rate between 0 and 100%.');
  }
  const rate = monthlyRatePercent / 100;
  const monthlyPayment = Math.round(rate === 0
    ? principalPaise / months
    : principalPaise * rate / -Math.expm1(-months * Math.log1p(rate)));
  let balance = principalPaise;
  return Array.from({length: months}, (_, index) => {
    const remainingMonths = months - index - 1;
    const interest = Math.round(balance * rate);
    const principal = remainingMonths === 0
      ? balance
      : Math.min(balance - remainingMonths, Math.max(1, monthlyPayment - interest));
    balance -= principal;
    return {number: index + 1, principal, interest, payment: principal + interest, remainingPrincipal: balance};
  });
}

/**
 * Amounts are integer paise. Applies a one-time total interest percentage
 * to original principal (e.g. 20000 at 20% = 24000) and splits across `months`,
 * matching PostgreSQL `finance_private.generate_flat_installment_schedule` to the paise.
 */
export function calculateFlatInstallments(
  principalPaise: number,
  totalRatePercent: number,
  months: number
): Installment[] {
  if (!Number.isInteger(months) || months < 1 || months > 360) {
    throw new RangeError('Enter a repayment term between 1 and 360 months.');
  }
  if (!Number.isSafeInteger(principalPaise) || principalPaise < months || principalPaise > 10_000_000_000) {
    throw new RangeError('Enter a valid loan principal.');
  }
  if (!Number.isFinite(totalRatePercent) || totalRatePercent < 0 || totalRatePercent > 100) {
    throw new RangeError('Enter a total interest rate between 0 and 100%.');
  }

  const rateScaled = Math.round(totalRatePercent * 10000);
  const totalInterestPaise = Number(
    (BigInt(principalPaise) * BigInt(rateScaled) * 2n + 1_000_000n) / 2_000_000n
  );
  const totalRepaymentPaise = principalPaise + totalInterestPaise;
  const targetPayment = Math.floor((2 * totalRepaymentPaise + months) / (2 * months));
  const idealInterest = Math.floor((2 * totalInterestPaise + months) / (2 * months));

  let remainingPrincipal = principalPaise;
  let remainingInterest = totalInterestPaise;

  return Array.from({length: months}, (_, index) => {
    const remainingMonths = months - index - 1;
    let principal: number;
    let interest: number;
    if (remainingMonths === 0) {
      principal = remainingPrincipal;
      interest = remainingInterest;
    } else {
      const maxPrincipal = remainingPrincipal - remainingMonths;
      interest = Math.max(0, Math.min(remainingInterest, idealInterest));
      const rawPrincipal = targetPayment - interest;
      principal = Math.max(1, Math.min(maxPrincipal, rawPrincipal));
    }
    remainingPrincipal -= principal;
    remainingInterest -= interest;
    return {
      number: index + 1,
      principal,
      interest,
      payment: principal + interest,
      remainingPrincipal
    };
  });
}
