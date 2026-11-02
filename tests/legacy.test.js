// Dati della versione pubblicata (commit 92d311d): localStorage e backup devono caricarsi identici.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA_KEY, CAL_KEY } from '../js/store.js';
import { parseBackupText, buildBackup } from '../js/backup.js';
import { summarize } from '../js/aggregate.js';
import { memStorage, makeStore } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const legacyLocal = JSON.parse(fixture('legacy-localStorage.json'));
const legacyBackupText = fixture('legacy-backup.json');

function check(store) {
  assert.equal(store.getStudios({ includeArchived: true }).length, 3);
  assert.equal(store.getStudios().length, 2);
  assert.equal(store.getTreatments().length, 5);
  const entries = store.getEntries();
  assert.equal(entries.length, 21);
  const studiosById = Object.fromEntries(store.getStudios({ includeArchived: true }).map((s) => [s.id, s]));
  const sum = summarize(entries, { studiosById, treatmentsById: Object.fromEntries(store.getTreatments().map((t) => [t.id, t])) });
  assert.equal(sum.totalCents, 401250);
  assert.equal(sum.totalPatients, 79);
  assert.deepEqual(sum.byStudio.map((r) => [r.name, r.patients, r.cents]), [
    ['Studio Rossi', 40, 173500], ['Clinica Sorriso', 28, 172500], ['Studio Bianchi & Figli', 11, 55250],
  ]);
  const oct = store.getEntries({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(oct.reduce((n, e) => n + e.amountCents, 0), 83500 + 123000 + 13000);
}

test('localStorage della versione 1: si carica senza migrazione, calendario vuoto', () => {
  const storage = memStorage(legacyLocal);
  const store = makeStore(storage);
  assert.equal(store.loadWarning, null);
  check(store);
  assert.deepEqual(store.getCalendar(), { rules: [], days: [] });
  assert.equal(storage.getItem(CAL_KEY), null, 'nessuna chiave nuova finché non si usa il calendario');
});

test('dopo una modifica "dentalflow:data" mantiene esattamente il formato della versione 1', () => {
  const storage = memStorage(legacyLocal);
  const store = makeStore(storage);
  const [rossi] = store.getStudios().filter((s) => s.name === 'Studio Rossi');
  store.addRule({ studioId: rossi.id, type: 'weekly', weekdays: [2], interval: 1, start: '2026-09-01', end: { type: 'never' } });
  store.setNote('2026-10-13', rossi.id, 'manca fattura');
  const data = JSON.parse(storage.getItem(DATA_KEY));
  assert.deepEqual(Object.keys(data).sort(), ['entries', 'schemaVersion', 'studios', 'tracking', 'treatments']);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data, JSON.parse(legacyLocal[DATA_KEY]), 'calendario e note non toccano i dati della versione 1');
  const cal = JSON.parse(storage.getItem(CAL_KEY));
  assert.equal(cal.rules.length, 1);
  assert.equal(cal.notes.length, 1);
  // ricaricando, tutto è ancora lì
  const again = makeStore(storage);
  check(again);
  assert.equal(again.getCalendar().rules.length, 1);
  assert.equal(again.getNote('2026-10-13', rossi.id), 'manca fattura');
});

test('backup della versione 1: valido, importabile, e il calendario attuale resta com\'è', () => {
  const res = parseBackupText(legacyBackupText);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.data.calendar, undefined);
  const store = makeStore();
  const s = store.addStudio('Temporaneo');
  store.addRule({ studioId: s, type: 'weekly', weekdays: [1], interval: 1, start: '2026-01-05', end: { type: 'never' } });
  store.replaceAll(res.data);
  check(store);
  assert.equal(store.getCalendar().rules.length, 1, 'backup senza calendario: calendario attuale invariato');
});

test('un backup nuovo resta leggibile dalla validazione della versione 1 (campi e sezioni in più ignorati)', () => {
  const store = makeStore(memStorage(legacyLocal));
  const [rossi] = store.getStudios();
  store.setStudioColor(rossi.id, 'c3');
  store.addRule({ studioId: rossi.id, type: 'weekly', weekdays: [2], interval: 1, start: '2026-09-01', end: { type: 'never' } });
  const backup = buildBackup(store.exportData());
  assert.equal(backup.schemaVersion, 1);
  // la versione 1 controlla solo app, schemaVersion e i tre elenchi: le chiavi in più non contano
  for (const k of ['studios', 'treatments', 'entries']) assert.ok(Array.isArray(backup[k]));
  assert.equal(backup.calendar.rules.length, 1);
  const res = parseBackupText(JSON.stringify(backup));
  assert.equal(res.ok, true, res.error);
  const fresh = makeStore();
  fresh.replaceAll(res.data);
  assert.deepEqual(fresh.exportData(), store.exportData());
});

test('studi della versione 1 senza colore: colori diversi assegnati una volta, in ordine di creazione', () => {
  const store = makeStore(memStorage(legacyLocal));
  assert.equal(store.assignMissingColors(), 3);
  const colors = store.getStudios({ includeArchived: true }).sort((a, b) => a.createdAt - b.createdAt).map((s) => s.color);
  assert.deepEqual(colors, ['c1', 'c2', 'c3']);
  assert.equal(store.assignMissingColors(), 0);
  check(store);
});
