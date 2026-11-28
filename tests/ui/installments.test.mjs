import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateInstallments, calculateFlatInstallments} from '../../src/installments.ts';

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

test('one-time total interest installment schedule splits principal + total interest accurately to the paise', () => {
  // 20000 at 20% = 24000 split across 12 months => 2000.00/mo
  const flat12 = calculateFlatInstallments(2_000_000, 20, 12);
  assert.equal(flat12.length, 12);
  assert.equal(flat12.reduce((s, r) => s + r.principal, 0), 2_000_000);
  assert.equal(flat12.reduce((s, r) => s + r.interest, 0), 400_000);
  assert.equal(flat12.reduce((s, r) => s + r.payment, 0), 2_400_000);
  assert.ok(flat12.every(r => r.payment === 200_000 && r.principal > 0 && r.interest > 0));
  assert.equal(flat12[11].remainingPrincipal, 0);

  // 20000 at 20% = 24000 split across 10 months => exact 2400.00/mo every month
  const flat10 = calculateFlatInstallments(2_000_000, 20, 10);
  assert.ok(flat10.every(r => r.principal === 200_000 && r.interest === 40_000 && r.payment === 240_000));
  assert.equal(flat10[9].remainingPrincipal, 0);

  // Non-divisible 7 months and 0% rounding + extreme tiny principal guards
  const flat7 = calculateFlatInstallments(2_000_000, 20, 7);
  assert.equal(flat7.reduce((s, r) => s + r.principal, 0), 2_000_000);
  assert.equal(flat7.reduce((s, r) => s + r.interest, 0), 400_000);
  assert.equal(flat7.reduce((s, r) => s + r.payment, 0), 2_400_000);
  assert.equal(flat7[6].remainingPrincipal, 0);

  assert.deepEqual(calculateFlatInstallments(1000, 0, 3).map(r => r.payment), [333, 333, 334]);

  const tiny = calculateFlatInstallments(13, 85, 12);
  assert.equal(tiny.reduce((s, r) => s + r.principal, 0), 13);
  assert.equal(tiny.reduce((s, r) => s + r.interest, 0), 11);
  assert.ok(tiny.every(r => r.principal >= 1 && r.interest >= 0));
  assert.equal(tiny[11].remainingPrincipal, 0);

  assert.throws(() => calculateFlatInstallments(1000, -1, 3), RangeError);
  assert.throws(() => calculateFlatInstallments(1000, 101, 3), RangeError);
});
