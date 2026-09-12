// Run: node app/src/format.check.ts   (Node strips the types)
import assert from 'node:assert/strict';

import { moneyInputToCents, normalizeMoneyInput } from './moneyInput.ts';
import {
  daysFromToday,
  formatCents,
  formatLongDay,
  formatMonthName,
  formatShortDate,
} from './format.ts';

assert.equal(formatCents(0), '$0.00');
assert.equal(formatCents(5), '$0.05');
assert.equal(formatCents(-33400), '-$334.00');
assert.equal(formatCents(1425000), '$14,250.00');
assert.equal(formatCents(123456789), '$1,234,567.89');
assert.equal(formatShortDate('2026-09-11T03:12:00Z'), '10 sep');
assert.equal(formatShortDate('2026-01-01T12:00:00Z'), '1 ene');
assert.equal(formatLongDay('2026-10-05'), '5 de octubre');
assert.equal(formatLongDay('2026-06-14', true), '14 de junio de 2026');
assert.equal(daysFromToday('2026-10-05', new Date('2026-09-12T15:00:00Z')), 23);
assert.equal(daysFromToday('2026-09-12', new Date('2026-09-12T05:00:00Z')), 1);
assert.equal(daysFromToday('2026-09-01', new Date('2026-09-12T15:00:00Z')), -11);
assert.equal(formatMonthName('2026-09'), 'septiembre');
assert.equal(formatMonthName('2026-01-31'), 'enero');

// El teclado deja escribir cualquier cosa: normalizeMoneyInput es lo unico
// entre el usuario y un monto, y moneyInputToCents nunca debe pasar por float.
assert.equal(normalizeMoneyInput('14,250.00'), '14250.00');
assert.equal(normalizeMoneyInput('$1 425.99 MXN'), '1425.99');
assert.equal(normalizeMoneyInput('abc'), '');
assert.equal(normalizeMoneyInput('00012'), '12');
assert.equal(normalizeMoneyInput('1.2345'), '1.23');
assert.equal(normalizeMoneyInput('.5'), '0.5');
assert.equal(normalizeMoneyInput('12.'), '12.');

assert.equal(moneyInputToCents(''), 0);
assert.equal(moneyInputToCents('0'), 0);
assert.equal(moneyInputToCents('0.05'), 5);
assert.equal(moneyInputToCents('1.5'), 150);
assert.equal(moneyInputToCents('12.'), 1200);
assert.equal(moneyInputToCents('14250.00'), 1425000);
assert.ok(Number.isInteger(moneyInputToCents('0.1')));
assert.equal(formatCents(moneyInputToCents(normalizeMoneyInput('14,250.005'))), '$14,250.00');

console.log('format ok');
