import test from 'node:test';
import assert from 'node:assert/strict';
import {businessDate, money, date} from '../../src/api.ts';

test('Financial formatting and date helpers', () => {
  // Business date format YYYY-MM-DD
  const bd = businessDate();
  assert.match(bd, /^\d{4}-\d{2}-\d{2}$/);

  // Currency INR formatting
  const formatted = money(100000);
  assert.ok(formatted.includes('1,00,000') || formatted.includes('100,000'));
  assert.ok(formatted.includes('₹'));

  // Date formatting
  const d = date('2026-11-06');
  assert.ok(d.includes('2026'));
  assert.ok(d.includes('Nov'));

  // Empty date
  assert.equal(date(''), '—');
});
