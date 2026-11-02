import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PeriodError, periodRange, trendRange, bucketKey, bucketRange, bucketLabel, formatIT, isValidISODate,
  lastDayOfMonth, addDays, todayISO,
} from '../js/dates.js';

test('periodRange: preset', () => {
  assert.deepEqual(periodRange('questo-mese', '2026-02-13'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodRange('mese-scorso', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(periodRange('quest-anno', '2026-01-15'), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodRange('mese-scorso', '2024-03-10'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(periodRange('tutto', '2026-01-15'), { from: null, to: null });
});

test('periodRange: personalizzato', () => {
  const today = '2026-02-13';
  assert.throws(() => periodRange('personalizzato', today, { from: '2026-03-01', to: '2026-02-01' }),
    (e) => e instanceof PeriodError && e.message === 'La data iniziale è successiva alla finale');
  assert.throws(() => periodRange('personalizzato', today, { from: '', to: '2026-01-31' }),
    (e) => e instanceof PeriodError && e.message === 'Seleziona la data iniziale e finale');
  assert.throws(() => periodRange('personalizzato', today, { from: '2026-02-30', to: '2026-03-01' }),
    (e) => e instanceof PeriodError && e.message === 'Seleziona la data iniziale e finale');
  assert.deepEqual(periodRange('personalizzato', today, { from: '2026-02-01', to: '2026-02-28' }),
    { from: '2026-02-01', to: '2026-02-28' });
});

test('trendRange', () => {
  const p = { from: '2026-01-01', to: '2026-12-31', today: '2026-03-10' };
  assert.deepEqual(trendRange({ ...p, entryDates: ['2026-01-05', '2026-02-20'] }), { from: '2026-01-01', to: '2026-03-10' });
  assert.deepEqual(trendRange({ ...p, entryDates: ['2026-01-05', '2026-05-02'] }), { from: '2026-01-01', to: '2026-05-02' });
  assert.deepEqual(trendRange({ from: null, to: null, today: '2026-03-10', entryDates: ['2025-04-02', '2024-01-09', '2025-12-01'] }),
    { from: '2024-01-09', to: '2025-12-01' });
  assert.equal(trendRange({ ...p, entryDates: [] }), null);
});

test('bucketKey: settimane ISO', () => {
  assert.equal(bucketKey('2026-01-01', 'settimana'), '2026-W01');
  assert.equal(bucketKey('2027-01-01', 'settimana'), '2026-W53');
  assert.equal(bucketKey('2024-12-30', 'settimana'), '2025-W01');
  assert.equal(bucketKey('2026-02-13', 'mese'), '2026-02');
  assert.equal(bucketKey('2026-02-13', 'anno'), '2026');
  assert.equal(bucketKey('2026-02-13', 'giorno'), '2026-02-13');
});

test('bucketRange e bucketLabel', () => {
  assert.deepEqual(bucketRange('2025-11-15', '2026-02-03', 'mese'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(bucketRange('2026-02-27', '2026-03-02', 'giorno'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.deepEqual(bucketRange('2026-12-30', '2027-01-12', 'settimana'), ['2026-W53', '2027-W01', '2027-W02']);
  assert.deepEqual(bucketRange('2024-05-01', '2026-01-01', 'anno'), ['2024', '2025', '2026']);
  assert.equal(bucketLabel('2026-02-13', 'giorno'), '13/02');
  assert.equal(bucketLabel('2026-W07', 'settimana'), 'Sett. 7 2026');
  assert.equal(bucketLabel('2026-02', 'mese'), 'feb 2026');
  assert.equal(bucketLabel('2026', 'anno'), '2026');
});

test('helper di data', () => {
  assert.equal(formatIT('2026-02-13'), '13/02/2026');
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2024-02-29'), true);
  assert.equal(isValidISODate('2026-13-01'), false);
  assert.equal(isValidISODate('26-01-01'), false);
  assert.equal(lastDayOfMonth(2024, 2), 29);
  assert.equal(lastDayOfMonth(2025, 2), 28);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(todayISO(new Date(2026, 1, 13, 23, 59).getTime()), '2026-02-13');
});
