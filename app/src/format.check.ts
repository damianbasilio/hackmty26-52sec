// Run: node app/src/format.check.ts   (Node strips the types)
import assert from 'node:assert/strict';

import { formatCents, formatShortDate } from './format.ts';

assert.equal(formatCents(0), '$0.00');
assert.equal(formatCents(5), '$0.05');
assert.equal(formatCents(-33400), '-$334.00');
assert.equal(formatCents(1425000), '$14,250.00');
assert.equal(formatCents(123456789), '$1,234,567.89');
assert.equal(formatShortDate('2026-09-11T03:12:00Z'), '10 sep');
assert.equal(formatShortDate('2026-01-01T12:00:00Z'), '1 ene');

console.log('format ok');
