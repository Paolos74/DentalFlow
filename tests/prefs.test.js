import test from 'node:test';
import assert from 'node:assert/strict';
import { readPrefs, writePrefs, backupReminder, readBeforeImport, writeBeforeImport, clearBeforeImport, PREFS_KEY } from '../js/prefs.js';
import { memStorage } from './helpers.js';

const DAY = 86400000;

test('preferenze: valori predefiniti, valori non validi ignorati', () => {
  const st = memStorage();
  assert.deepEqual(readPrefs(st), { theme: 'light', csvFormat: 'virgola', lastBackupAt: null, tax: null });
  writePrefs(st, { theme: 'dark' });
  assert.equal(readPrefs(st).theme, 'dark');
  st.setItem(PREFS_KEY, JSON.stringify({ theme: 'viola', lastBackupAt: -1, csvFormat: 'excel' }));
  assert.deepEqual(readPrefs(st), { theme: 'light', csvFormat: 'excel', lastBackupAt: null, tax: null });
  st.setItem(PREFS_KEY, '{rotto');
  assert.equal(readPrefs(st).theme, 'light');
  assert.equal(writePrefs(memStorage({}, { failSet: () => true }), { theme: 'auto' }), false);
});

test('promemoria backup dopo 14 giorni e solo se i dati sono cambiati', () => {
  const now = 100 * DAY;
  assert.deepEqual(backupReminder({ lastBackupAt: null, lastChangeAt: 5, hasData: false, now }), { due: false, days: null });
  assert.deepEqual(backupReminder({ lastBackupAt: null, lastChangeAt: 5, hasData: true, now }), { due: true, days: null });
  assert.equal(backupReminder({ lastBackupAt: now - 13 * DAY, lastChangeAt: now, hasData: true, now }).due, false);
  assert.equal(backupReminder({ lastBackupAt: now - 14 * DAY, lastChangeAt: now, hasData: true, now }).due, true);
  assert.equal(backupReminder({ lastBackupAt: now - 20 * DAY, lastChangeAt: now - 30 * DAY, hasData: true, now }).due, false);
});

test('copia di sicurezza prima dell\'importazione', () => {
  const st = memStorage();
  assert.equal(readBeforeImport(st), null);
  assert.equal(writeBeforeImport(st, { app: 'DentalFlow' }, 123), true);
  assert.deepEqual(readBeforeImport(st), { savedAt: 123, backup: { app: 'DentalFlow' } });
  assert.equal(clearBeforeImport(st), true);
  assert.equal(readBeforeImport(st), null);
});

test('parametri delle tasse nelle preferenze: salvati, valori errati corretti', () => {
  const st = memStorage();
  writePrefs(st, { tax: { coeff: 7800, inps: 2400, rate: 500, bollo: 200 } });
  assert.deepEqual(readPrefs(st).tax, { coeff: 7800, inps: 2400, rate: 500, bollo: 200, openDate: null, excluded: [], fixedPct: null, declared: {} });
  st.setItem(PREFS_KEY, JSON.stringify({ tax: { coeff: 'x', inps: 2400 } }));
  assert.deepEqual(readPrefs(st).tax, { coeff: 7800, inps: 2400, rate: 500, bollo: 200, openDate: null, excluded: [], fixedPct: null, declared: {} });
  st.setItem(PREFS_KEY, JSON.stringify({ tax: [1] }));
  assert.equal(readPrefs(st).tax, null);
});
