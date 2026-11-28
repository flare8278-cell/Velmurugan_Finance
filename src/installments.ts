export type Installment = {
  number: number;
  principal: number;
  interest: number;
  payment: number;
  remainingPrincipal: number;
};

/** Amounts are integer paise. The final payment settles any rounding remainder. */
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
