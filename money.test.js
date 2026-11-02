import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEuroInput, formatEuro, formatEuroCsv, sumCents, formatPct, parsePatients } from '../js/money.js';

test('parseEuroInput: valori validi', () => {
  const cases = {
    '210': 21000, '210,5': 21050, '1.234,56': 123456, '1.234,5': 123450, '1.234.567,8': 123456780,
    '12.50': 1250, '12.5': 1250, '1.250': 125000, '0': 0, '€ 30,00': 3000, '30\u00A0€': 3000, '1\u202F234,00': 123400,
  };
  for (const [input, cents] of Object.entries(cases)) assert.equal(parseEuroInput(input), cents, input);
});

test('parseEuroInput: valori non validi', () => {
  for (const input of ['', '  ', 'abc', '-5', '1,234', '1,2,3', '1.2.3', '1.234.56', '12,5,0', ',5', null, undefined]) {
    assert.equal(parseEuroInput(input), null, String(input));
  }
});

test('formatEuroCsv', () => {
  assert.equal(formatEuroCsv(123450), '1234,50');
  assert.equal(formatEuroCsv(5), '0,05');
  assert.equal(formatEuroCsv(0), '0,00');
});

test('sumCents è esatto', () => {
  assert.equal(sumCents(Array(10).fill(10)), 100);
  assert.equal(sumCents([1, 2]), 3);
  assert.equal(sumCents([]), 0);
  assert.throws(() => sumCents([0.1]));
});

test('formatEuro', () => {
  const s = formatEuro(21000);
  assert.ok(s.includes('210,00'), s);
  assert.ok(s.includes('€'), s);
});

test('formatPct', () => {
  assert.equal(formatPct(425), '42,5 %');
  assert.equal(formatPct(0), '0,0 %');
  assert.equal(formatPct(1000), '100,0 %');
});

test('parsePatients', () => {
  assert.equal(parsePatients('', { min: 0 }), 0);
  assert.equal(parsePatients(' 7 ', { min: 0 }), 7);
  for (const v of ['2.5', '1000', '-1', 'abc', '1e3']) assert.equal(parsePatients(v, { min: 0 }), null, v);
  assert.equal(parsePatients('999', { min: 0 }), 999);
  assert.equal(parsePatients('', { min: 1 }), null);
  assert.equal(parsePatients('0', { min: 1 }), null);
  assert.equal(parsePatients('1', { min: 1 }), 1);
});
