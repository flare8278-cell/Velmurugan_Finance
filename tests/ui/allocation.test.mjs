import test from 'node:test';
import assert from 'node:assert/strict';

function calculateAllocation(unpaidInterest, principalRemaining, paymentAmount) {
  const i = Math.min(Number(unpaidInterest), Number(paymentAmount));
  const p = Math.min(Number(principalRemaining), Math.max(0, Number(paymentAmount) - i));
  return {
    interestPaid: i,
    principalPaid: p,
    totalAllocated: i + p,
    newInterest: Math.round((Number(unpaidInterest) - i) * 100) / 100,
    newPrincipal: Math.round((Number(principalRemaining) - p) * 100) / 100
  };
}

test('Interest-first allocation policy conforms to monthly_remaining_v1', () => {
  // Scenario 1: ₹100,000 principal, ₹5,000 unpaid interest, ₹7,000 payment
  const res1 = calculateAllocation(5000, 100000, 7000);
  assert.equal(res1.interestPaid, 5000);
  assert.equal(res1.principalPaid, 2000);
  assert.equal(res1.newInterest, 0);
  assert.equal(res1.newPrincipal, 98000);

  // Scenario 2: Payment less than unpaid interest (e.g. ₹3,000 against ₹5,000 interest)
  const res2 = calculateAllocation(5000, 100000, 3000);
  assert.equal(res2.interestPaid, 3000);
  assert.equal(res2.principalPaid, 0);
  assert.equal(res2.newInterest, 2000);
  assert.equal(res2.newPrincipal, 100000);

  // Scenario 3: Full payoff of interest and capital
  const res3 = calculateAllocation(5000, 98000, 103000);
  assert.equal(res3.interestPaid, 5000);
  assert.equal(res3.principalPaid, 98000);
  assert.equal(res3.newInterest, 0);
  assert.equal(res3.newPrincipal, 0);
});
