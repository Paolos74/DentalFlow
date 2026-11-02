import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, validateBackup, parseBackupText } from '../js/backup.js';
import { makeStore } from './helpers.js';

function sample() {
  const store = makeStore();
  const a = store.addStudio('Studio A');
  const b = store.addStudio('Studio B');
  store.archiveStudio(b);
  const t = store.addTreatment('Igiene', [a, b]);
  store.archiveTreatmentInStudios(t, [b]);
  store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 }]);
  return store;
}

test('esporta → leggi → replaceAll: stato identico', () => {
  const store = sample();
  const text = JSON.stringify(buildBackup(store.exportData()));
  const res = parseBackupText(text);
  assert.equal(res.ok, true, res.error);
  const fresh = makeStore();
  fresh.replaceAll(res.data);
  assert.deepEqual(fresh.exportData(), store.exportData());
});

test('anomalie da sincronizzazione: il backup resta valido e importabile', () => {
  const store = makeStore();
  const rec = (o) => ({ createdAt: 1, updatedAt: 2, deleted: false, ...o });
  store.applyRemote([
    { kind: 'studio', data: rec({ id: 's1', name: 'Studio', archived: false }), updatedAt: 2, deleted: false },
    { kind: 'treatment', data: rec({ id: 't1', name: 'Igiene', studios: { s1: 'active', ghost: 'active' } }), updatedAt: 2, deleted: false },
    { kind: 'treatment', data: rec({ id: 't2', name: 'igiene', studios: { s1: 'active' } }), updatedAt: 2, deleted: false },
    { kind: 'entry', data: rec({ id: 'e1', date: '2026-01-01', studioId: 'missing', treatmentId: 't1', patients: 1, amountCents: 100 }), updatedAt: 2, deleted: false },
  ]);
  assert.equal(store.getEntries().length, 1);
  const res = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(res.ok, true, res.error);
  const fresh = makeStore();
  fresh.replaceAll(res.data);
  assert.deepEqual(fresh.exportData(), store.exportData());
});

test('backup rifiutati', () => {
  const good = buildBackup(sample().exportData());
  const clone = () => structuredClone(good);
  let b = clone(); b.app = 'Altro';
  assert.equal(validateBackup(b).ok, false);
  b = clone(); b.entries[0].date = '2026-02-30';
  assert.equal(validateBackup(b).error, 'Backup non valido: data non valida in un inserimento');
  b = clone(); b.studios.push(structuredClone(b.studios[0]));
  assert.match(validateBackup(b).error, /duplicato/);
  b = clone(); b.entries[0].amountCents = 10.5;
  assert.match(validateBackup(b).error, /importo non valido/);
  b = clone(); b.treatments[0].deleted = true;
  assert.match(validateBackup(b).error, /eliminato/);
  b = clone(); delete b.entries;
  assert.equal(validateBackup(b).ok, false);
  b = clone(); b.treatments[0].studios = { x: 'boh' };
  assert.equal(validateBackup(b).ok, false);
});

test('parseBackupText su JSON non valido', () => {
  assert.deepEqual(parseBackupText('{'), { ok: false, error: 'File di backup non valido' });
});

test('backup con calendario, note e incassi: esporta → leggi → importa identico', () => {
  const store = sample();
  const [a] = store.getStudios();
  store.addRule({ studioId: a.id, type: 'monthly-pos', nth: -1, weekday: 5, start: '2026-01-01', end: { type: 'count', count: 6 }, time: { from: '09:00', to: '13:00' } });
  store.addWorkDays(a.id, ['2026-03-14']);
  store.setNote('2026-02-13', a.id, 'manca fattura');
  store.setPaid([{ month: '2026-02', studioId: a.id, paid: true }]);
  const backup = buildBackup(store.exportData());
  assert.equal(backup.calendar.rules.length, 1);
  assert.equal(backup.calendar.days.length, 1);
  assert.equal(backup.notes.length, 1);
  assert.equal(backup.payments.length, 1);
  const res = parseBackupText(JSON.stringify(backup));
  assert.equal(res.ok, true, res.error);
  const fresh = makeStore();
  fresh.replaceAll(res.data);
  assert.deepEqual(fresh.exportData(), store.exportData());
});

test('sezioni facoltative non valide: backup rifiutato con messaggio chiaro', () => {
  const store = sample();
  const [a] = store.getStudios();
  store.addRule({ studioId: a.id, type: 'weekly', weekdays: [2], interval: 1, start: '2026-01-01', end: { type: 'never' } });
  const good = buildBackup(store.exportData());
  let b = structuredClone(good); b.calendar = [];
  assert.match(validateBackup(b).error, /calendario/);
  b = structuredClone(good); b.calendar.rules[0].weekdays = [];
  assert.match(validateBackup(b).error, /regola del calendario/);
  b = structuredClone(good); b.notes = [{ id: 'n', date: '2026-02-13', studioId: a.id, text: '', createdAt: 1, updatedAt: 1 }];
  assert.match(validateBackup(b).error, /nota/);
  b = structuredClone(good); delete b.calendar;
  const res = validateBackup(b);
  assert.equal(res.ok, true);
  assert.equal(res.data.calendar, undefined);
});
