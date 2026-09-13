// Run: node app/src/format.check.ts   (Node strips the types)
import assert from 'node:assert/strict';

import { CHUNK_SIZE, joinChunks, splitIntoChunks } from './chunk.ts';
import { sharesFor } from './data/shares.ts';
import { moneyInputToCents, normalizeMoneyInput, withCents } from './moneyInput.ts';
import { bytesToHex, secondsLeft, sha1, totp } from './totp.ts';
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
// Teclado decimal en otra región: la coma sola con centavos es el decimal.
assert.equal(normalizeMoneyInput('150,5'), '150.5');
assert.equal(normalizeMoneyInput('150,'), '150.');
assert.equal(normalizeMoneyInput('14,250'), '14250');
assert.equal(withCents('150'), '150.00');
assert.equal(withCents('1.5'), '1.50');
assert.equal(withCents('12.'), '12.00');
assert.equal(withCents(''), '');

assert.equal(moneyInputToCents(''), 0);
assert.equal(moneyInputToCents('0'), 0);
assert.equal(moneyInputToCents('0.05'), 5);
assert.equal(moneyInputToCents('1.5'), 150);
assert.equal(moneyInputToCents('12.'), 1200);
assert.equal(moneyInputToCents('14250.00'), 1425000);
assert.ok(Number.isInteger(moneyInputToCents('0.1')));
assert.equal(formatCents(moneyInputToCents(normalizeMoneyInput('14,250.005'))), '$14,250.00');

// La sesion de Supabase se guarda partida en secure-store. Si partir y volver a
// juntar no es exacto, el usuario pierde la sesion sin que nada truene.
const session = 'a'.repeat(CHUNK_SIZE * 2 + 137);
assert.equal(splitIntoChunks(session).length, 3);
assert.equal(joinChunks(splitIntoChunks(session)), session);
assert.equal(splitIntoChunks('').length, 1);
assert.equal(joinChunks(splitIntoChunks('')), '');
assert.equal(splitIntoChunks('x'.repeat(CHUNK_SIZE)).length, 1);
assert.equal(splitIntoChunks('x'.repeat(CHUNK_SIZE + 1)).length, 2);
// Un pedazo perdido no debe devolver una sesion a medias.
assert.equal(joinChunks(['abc', null, 'def']), null);
assert.equal(joinChunks([]), null);
// Repartir una cuenta no puede perder ni inventar centavos, y el orden importa:
// el sobrante va a quien entro primero, igual que rebalance_split() en la base.
assert.deepEqual(sharesFor(1000, 3), [334, 333, 333]);
assert.deepEqual(sharesFor(1001, 2), [501, 500]);
assert.deepEqual(sharesFor(5, 5), [1, 1, 1, 1, 1]);
assert.deepEqual(sharesFor(0, 3), [0, 0, 0]);
assert.deepEqual(sharesFor(100, 0), []);
for (const total of [1, 7, 99, 1425000, 123456789]) {
  for (const people of [1, 2, 3, 4, 7, 11]) {
    const parts = sharesFor(total, people);
    assert.equal(parts.length, people);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), total);
    assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
    assert.ok(parts.every(Number.isInteger));
  }
}

// Clave dinámica: vectores de RFC 3174 y RFC 6238. Si SHA-1 falla por un bit,
// la clave cambia sin avisar.
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
assert.equal(bytesToHex(sha1(ascii('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
assert.equal(bytesToHex(sha1(ascii(''))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
const rfcSecret = ascii('12345678901234567890');
assert.equal(totp(rfcSecret, 59_000, 30, 8), '94287082');
assert.equal(totp(rfcSecret, 1111111109_000, 30, 8), '07081804');
assert.equal(totp(rfcSecret, 20000000000_000, 30, 8), '65353130');
assert.equal(secondsLeft(59_000), 1);
assert.equal(secondsLeft(60_000), 30);

console.log('format ok');
