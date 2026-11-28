import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateInstallments} from '../../src/installments.ts';

test('reducing-balance installment preview settles principal and rounds the final row', () => {
  const schedule = calculateInstallments(10_000_000, 1, 12);
  assert.equal(schedule.length, 12);
  assert.equal(schedule[0].payment, 888488);
  assert.equal(schedule[0].interest, 100000);
  assert.ok(schedule[11].interest < schedule[0].interest);
  assert.equal(schedule[11].remainingPrincipal, 0);
  assert.equal(schedule.reduce((total, row) => total + row.principal, 0), 10_000_000);
  assert.deepEqual(calculateInstallments(1000, 0, 3).map(row => row.payment), [333, 333, 334]);
  assert.throws(() => calculateInstallments(1000, -1, 3), RangeError);
});
