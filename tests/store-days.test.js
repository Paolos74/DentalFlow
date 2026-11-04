// Funzioni nuove dello store: giornata, annulla, colori, calendario, note, incassi, persistenza separata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAL_KEY, CAL_CORRUPT_PREFIX, DATA_KEY, ValidationError, StorageError, MSG } from '../js/store.js';
import { memStorage, makeStore } from './helpers.js';

function setup(storage = memStorage()) {
  const store = makeStore(storage);
  const a = store.addStudio('Studio A');
  const b = store.addStudio('Studio B');
  const t1 = store.addTreatment('Igiene', [a, b]);
  const t2 = store.addTreatment('Sbiancamento', [a]);
  return { store, storage, a, b, t1, t2 };
}

test('nuovi studi: colori diversi assegnati in ordine; colore modificabile e validato', () => {
  const { store, a, b } = setup();
  const [sa, sb] = [a, b].map((id) => store.getStudios().find((s) => s.id === id));
  assert.equal(sa.color, 'c1');
  assert.equal(sb.color, 'c2');
  store.setStudioColor(a, 'c5');
  assert.equal(store.getStudios().find((s) => s.id === a).color, 'c5');
  assert.throws(() => store.setStudioColor(a, 'rosso'), ValidationError);
});

test('saveDay: aggiunge, modifica, elimina e salva la nota in un\'unica scrittura', () => {
  const { store, storage, a, t1, t2 } = setup();
  const r1 = store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ treatmentId: t1, patients: 7, amountCents: 21000 }, { treatmentId: t2, patients: 1, amountCents: 5000 }], note: 'contanti' });
  assert.equal(r1.added.length, 2);
  assert.equal(store.getNote('2026-02-13', a), 'contanti');
  const [e1, e2] = r1.added;
  const writes = storage.log.length;
  const r2 = store.saveDay({
    date: '2026-02-13', studioId: a,
    rows: [{ id: e1, treatmentId: t1, patients: 8, amountCents: 24000 }, { treatmentId: t1, patients: 1, amountCents: 3000 }],
    deleteIds: [e2], note: '',
  });
  assert.deepEqual([r2.added.length, r2.updated, r2.deleted], [1, 1, 1]);
  assert.equal(storage.log.length - writes, 2, 'una scrittura per chiave');
  const day = store.getEntries({ from: '2026-02-13', to: '2026-02-13' });
  assert.deepEqual(day.map((e) => [e.treatmentId, e.patients, e.amountCents]).sort(), [[t1, 1, 3000], [t1, 8, 24000]]);
  assert.equal(store.getNote('2026-02-13', a), null);
  // righe invariate: nessuna modifica
  const before = store.getEntries().find((e) => e.id === e1).updatedAt;
  assert.equal(store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ id: e1, treatmentId: t1, patients: 8, amountCents: 24000 }] }).updated, 0);
  assert.equal(store.getEntries().find((e) => e.id === e1).updatedAt, before);
});

test('saveDay: errori senza salvataggi parziali', () => {
  const { store, a, b, t1, t2 } = setup();
  assert.throws(() => store.saveDay({ date: '2026-02-30', studioId: a, rows: [] }), { message: MSG.date });
  assert.throws(() => store.saveDay({ date: '2026-02-13', studioId: b, rows: [{ treatmentId: t1, patients: 1, amountCents: 1 }, { treatmentId: t2, patients: 1, amountCents: 1 }] }), { message: MSG.treatmentInactive });
  assert.equal(store.getEntries().length, 0);
  const [id] = store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ treatmentId: t1, patients: 1, amountCents: 1 }] }).added;
  assert.throws(() => store.saveDay({ date: '2026-02-14', studioId: a, rows: [{ id, treatmentId: t1, patients: 2, amountCents: 1 }] }), { message: MSG.entryNotFound });
  store.archiveStudio(a);
  assert.throws(() => store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ treatmentId: t1, patients: 1, amountCents: 1 }] }), { message: MSG.studioUnavailable });
  assert.equal(store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ id, treatmentId: t1, patients: 3, amountCents: 1 }] }).updated, 1, 'le righe esistenti di uno studio archiviato restano modificabili');
});

test('eliminazioni con Annulla: stesso id, stessi valori; con il tracking il tombstone torna in vita', () => {
  for (const tracking of [false, true]) {
    const { store, a, t1 } = setup();
    if (tracking) store.setTracking(true);
    const [id] = store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ treatmentId: t1, patients: 7, amountCents: 21000 }], note: 'n' }).added;
    const original = store.getEntries()[0];
    const removed = store.deleteEntry(id);
    assert.equal(store.getEntries().length, 0);
    assert.equal(store.restoreRecords(removed), 1);
    const back = store.getEntries()[0];
    assert.deepEqual({ ...back, updatedAt: 0 }, { ...original, updatedAt: 0 });
    assert.ok(back.updatedAt > original.updatedAt);
    const day = store.deleteDayEntries('2026-02-13', a);
    assert.equal(day.length, 2, 'riga e nota');
    assert.equal(store.getNote('2026-02-13', a), null);
    assert.equal(store.restoreRecords(day), 2);
    assert.equal(store.getNote('2026-02-13', a), 'n');
    assert.equal(store.restoreRecords(day), 0, 'già presenti: niente doppioni');
    if (tracking) assert.ok(store.getDirtyIds().includes(`entry_${id}`));
  }
});

test('sposta una giornata: data e studio di tutte le righe, nota inclusa; trattamento non associato rifiutato', () => {
  const { store, a, b, t1, t2 } = setup();
  store.saveDay({ date: '2026-02-13', studioId: a, rows: [{ treatmentId: t1, patients: 7, amountCents: 21000 }], note: 'x' });
  assert.equal(store.moveDayEntries({ date: '2026-02-13', studioId: a }, { date: '2026-02-12', studioId: b }), 1);
  assert.deepEqual(store.getEntries().map((e) => [e.date, e.studioId]), [['2026-02-12', b]]);
  assert.equal(store.getNote('2026-02-12', b), 'x');
  assert.equal(store.getNote('2026-02-13', a), null);
  store.saveDay({ date: '2026-02-20', studioId: a, rows: [{ treatmentId: t2, patients: 1, amountCents: 100 }] });
  assert.throws(() => store.moveDayEntries({ date: '2026-02-20', studioId: a }, { date: '2026-02-20', studioId: b }), { message: MSG.notAssociatedTarget('Sbiancamento') });
  assert.equal(store.getEntries({ studioId: a }).length, 1);
});

test('modifica giornata: nota e spostamento in un\'unica operazione', () => {
  const { store, a, b, t2 } = setup();
  store.saveDay({ date: '2026-03-02', studioId: a, rows: [{ treatmentId: t2, patients: 1, amountCents: 100 }], note: 'prima' });
  // spostamento impossibile (Sbiancamento non è offerto da B): la nota non cambia
  assert.throws(() => store.moveDayEntries({ date: '2026-03-02', studioId: a }, { date: '2026-03-02', studioId: b }, { note: 'dopo' }), { message: MSG.notAssociatedTarget('Sbiancamento') });
  assert.equal(store.getNote('2026-03-02', a), 'prima');
  // solo la nota, stessa giornata
  assert.equal(store.moveDayEntries({ date: '2026-03-02', studioId: a }, { date: '2026-03-02', studioId: a }, { note: 'dopo' }), 0);
  assert.equal(store.getNote('2026-03-02', a), 'dopo');
  // nota e data insieme: la nota nuova segue la giornata
  assert.equal(store.moveDayEntries({ date: '2026-03-02', studioId: a }, { date: '2026-03-03', studioId: a }, { note: 'spostata' }), 1);
  assert.equal(store.getNote('2026-03-03', a), 'spostata');
  assert.equal(store.getNote('2026-03-02', a), null);
  // giornata con la sola nota: tolta la nota non resta niente da spostare, nessun errore
  store.setNote('2026-03-10', b, 'solo nota');
  assert.equal(store.moveDayEntries({ date: '2026-03-10', studioId: b }, { date: '2026-03-11', studioId: b }, { note: '' }), 0);
  assert.equal(store.getNotes().filter((n) => n.studioId === b).length, 0);
});

test('giorno singolo modificabile: studio, data e orario', () => {
  const { store, a, b } = setup();
  const [id] = store.addWorkDays(a, ['2026-09-05'], { from: '09:00', to: '13:00' });
  store.updateWorkDay(id, { studioId: b, date: '2026-09-06', time: null });
  assert.deepEqual(store.getCalendar().days.map((d) => [d.studioId, d.date, d.time]), [[b, '2026-09-06', null]]);
  assert.throws(() => store.updateWorkDay(id, { date: '2026-02-30' }), ValidationError);
});

test('giorno singolo: niente spostamenti su studio archiviato né doppioni', () => {
  const { store, a, b } = setup();
  const [d1, d2] = store.addWorkDays(a, ['2026-09-05', '2026-09-06']);
  // doppione: stesso studio e stessa data di un altro giorno singolo
  assert.throws(() => store.updateWorkDay(d2, { date: '2026-09-05' }), (e) => e instanceof ValidationError && e.message === MSG.dayDuplicate);
  assert.equal(store.getCalendar().days.filter((d) => d.date === '2026-09-05').length, 1);
  // stesso studio, altra data libera: va bene; solo l'orario: va bene
  store.updateWorkDay(d2, { date: '2026-09-07' });
  store.updateWorkDay(d1, { time: { from: '09:00', to: '13:00' } });
  // studio archiviato come destinazione: rifiutato
  store.archiveStudio(b);
  assert.throws(() => store.updateWorkDay(d1, { studioId: b }), (e) => e instanceof ValidationError && e.message === MSG.studioUnavailable);
  // giorno di uno studio archiviato: si cambia l'orario, non la data
  store.archiveStudio(a);
  store.updateWorkDay(d1, { time: null });
  assert.throws(() => store.updateWorkDay(d1, { date: '2026-09-20' }), (e) => e instanceof ValidationError && e.message === MSG.studioUnavailable);
  assert.deepEqual(store.getCalendar().days.map((d) => [d.studioId, d.date, d.time]), [[a, '2026-09-05', null], [a, '2026-09-07', null]]);
});

test('calendario: regole, giorni singoli, giorno tolto; salvato in una chiave separata', () => {
  const { store, storage, a, b } = setup();
  const rid = store.addRule({ studioId: a, type: 'weekly', weekdays: [2], interval: 1, start: '2026-09-01', end: { type: 'never' }, time: { from: '09:00', to: '13:00' } });
  assert.throws(() => store.addRule({ studioId: a, type: 'weekly', weekdays: [], interval: 1, start: '2026-09-01', end: { type: 'never' } }), ValidationError);
  const ids = store.addWorkDays(b, ['2026-09-05', '2026-09-05', '2026-09-12']);
  assert.equal(ids.length, 2);
  assert.equal(store.addWorkDays(b, ['2026-09-05']).length, 0, 'già presente');
  assert.equal(store.unscheduleDay('2026-09-08', a), 1);
  assert.equal(store.unscheduleDay('2026-09-12', b), 1);
  const cal = store.getCalendar();
  assert.deepEqual(cal.rules[0].exdates, ['2026-09-08']);
  assert.deepEqual(cal.days.map((d) => d.date), ['2026-09-05']);
  store.updateRule(rid, { type: 'monthly-date', monthDay: 15 });
  const r = store.getCalendar().rules[0];
  assert.equal(r.type, 'monthly-date');
  assert.equal(r.weekdays, undefined, 'i campi del tipo precedente spariscono');
  assert.deepEqual(r.time, { from: '09:00', to: '13:00' });
  const stored = JSON.parse(storage.getItem(CAL_KEY));
  assert.equal(stored.version, 1);
  assert.equal(stored.rules.length, 1);
  assert.ok(!('rules' in JSON.parse(storage.getItem(DATA_KEY))));
  // regole di uno studio archiviato conservate; studio eliminato: regole, giorni e note eliminati
  store.archiveStudio(a);
  assert.equal(store.getCalendar().rules.length, 1);
  assert.throws(() => store.addRule({ studioId: a, type: 'weekly', weekdays: [1], interval: 1, start: '2026-09-01', end: { type: 'never' } }), { message: MSG.studioUnavailable });
  store.setNote('2026-09-05', b, 'nota');
  store.deleteStudio(b);
  assert.equal(store.getCalendar().days.length, 0);
  assert.equal(store.getNotes().length, 0);
  store.deleteRule(rid);
  assert.equal(store.getCalendar().rules.length, 0);
});

test('incassi per mese e studio', () => {
  const { store, a } = setup();
  store.setPaid([{ month: '2026-10', studioId: a, paid: true }]);
  assert.deepEqual(store.getPayments().map((p) => [p.month, p.paid]), [['2026-10', true]]);
  store.setPaid([{ month: '2026-10', studioId: a, paid: false }, { month: '2026-11', studioId: a, paid: true }]);
  assert.deepEqual(store.getPayments().map((p) => [p.month, p.paid]).sort(), [['2026-10', false], ['2026-11', true]]);
  assert.throws(() => store.setPaid([{ month: '2026-13', studioId: a, paid: true }]), { message: MSG.month });
});

test('note: testo ripulito, lunghezza massima, vuoto = elimina', () => {
  const { store, a } = setup();
  store.setNote('2026-02-13', a, '  ciao  ');
  assert.equal(store.getNote('2026-02-13', a), 'ciao');
  assert.throws(() => store.setNote('2026-02-13', a, 'x'.repeat(1001)), ValidationError);
  store.setNote('2026-02-13', a, '   ');
  assert.equal(store.getNote('2026-02-13', a), null);
});

test('calendario illeggibile: copia salvata, avviso, dati principali intatti', () => {
  const { storage } = setup();
  storage.setItem(CAL_KEY, '{rotto');
  const store = makeStore(storage);
  assert.equal(store.loadWarning, MSG.calCorrupt);
  assert.equal(store.getStudios().length, 2);
  assert.equal([...storage.map.keys()].filter((k) => k.startsWith(CAL_CORRUPT_PREFIX)).length, 1);
  store.addRule({ studioId: store.getStudios()[0].id, type: 'weekly', weekdays: [1], interval: 1, start: '2026-01-05', end: { type: 'never' } });
  assert.equal(JSON.parse(storage.getItem(CAL_KEY)).rules.length, 1);
});

test('spazio esaurito sul secondo salvataggio: calendario riportato com\'era', () => {
  let failData = false;
  const storage = memStorage({}, { failSet: (k) => failData && k === DATA_KEY });
  const { store, a } = setup(storage);
  failData = true;
  assert.throws(() => store.addRule({ studioId: a, type: 'weekly', weekdays: [1], interval: 1, start: '2026-01-05', end: { type: 'never' } }), StorageError);
  assert.equal(storage.getItem(CAL_KEY), null);
  assert.equal(store.getCalendar().rules.length, 0);
});

test('sincronizzazione: i record nuovi viaggiano con i loro tipi', () => {
  const { store, a } = setup();
  store.setTracking(true);
  store.markAllDirty();
  store.addRule({ studioId: a, type: 'weekly', weekdays: [1], interval: 1, start: '2026-01-05', end: { type: 'never' } });
  store.setNote('2026-01-05', a, 'x');
  const kinds = new Set(store.getRecordsByKeys(store.getDirtyIds()).map((r) => r.kind));
  assert.ok(kinds.has('rule') && kinds.has('note'));
  const other = makeStore();
  other.applyRemote(store.getAllRecordsIncludingDeleted());
  assert.equal(other.getCalendar().rules.length, 1);
  assert.equal(other.getNote('2026-01-05', a), 'x');
  // un record di calendario non valido arrivato dalla rete viene ignorato
  assert.equal(other.applyRemote([{ kind: 'rule', data: { id: 'bad', studioId: a, type: 'weekly', weekdays: [], interval: 1, start: '2026-01-05', end: { type: 'never' }, createdAt: 1 }, updatedAt: 5, deleted: false }]), 0);
});

test('ripetizione con più giorni e orari diversi: salvata pulita, modificabile, sopravvive al ricaricamento e al backup', async () => {
  const { buildBackup, parseBackupText } = await import('../js/backup.js');
  const { store, storage, a } = setup();
  const id = store.addRule({
    studioId: a, type: 'weekly', weekdays: [1, 3], interval: 1, start: '2026-11-02', end: { type: 'never' }, time: null,
    dayTimes: { 1: { from: '09:00', to: '13:00' }, 3: { from: '14:00', to: '19:00' }, 5: { from: '08:00', to: '12:00' }, 2: { from: '', to: '' } },
  });
  let r = store.getCalendar().rules.find((x) => x.id === id);
  assert.deepEqual(r.dayTimes, { 1: { from: '09:00', to: '13:00' }, 3: { from: '14:00', to: '19:00' } }, 'solo i giorni scelti, senza righe vuote');
  // orario a metà: errore, niente salvato
  assert.throws(() => store.updateRule(id, { dayTimes: { 1: { from: '09:00', to: '' } } }), ValidationError);
  // togliere il mercoledì toglie anche il suo orario
  store.updateRule(id, { weekdays: [1] });
  r = store.getCalendar().rules.find((x) => x.id === id);
  assert.deepEqual(r.dayTimes, { 1: { from: '09:00', to: '13:00' } });
  // dayTimes vuoto = nessun orario per giorno
  store.updateRule(id, { weekdays: [1, 3], dayTimes: { 3: { from: '14:00', to: '19:00' } } });
  const reloaded = makeStore(storage);
  r = reloaded.getCalendar().rules.find((x) => x.id === id);
  assert.deepEqual(r.dayTimes, { 3: { from: '14:00', to: '19:00' } });
  // un singolo giorno si toglie senza toccare gli altri
  store.unscheduleDay('2026-11-04', a);
  assert.deepEqual(store.getCalendar().rules.find((x) => x.id === id).exdates, ['2026-11-04']);
  // il backup conserva gli orari per giorno
  const parsed = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.data.calendar.rules.find((x) => x.id === id).dayTimes, { 3: { from: '14:00', to: '19:00' } });
});

test('incassi con marca da bollo: salvata solo se il mese è pagato, nel backup, valore errato rifiutato', async () => {
  const { buildBackup, parseBackupText } = await import('../js/backup.js');
  const { validateRecord } = await import('../js/store.js');
  const { store, a } = setup();
  store.setPaid([{ month: '2026-01', studioId: a, paid: true, bollo: true }, { month: '2026-02', studioId: a, paid: false, bollo: true }]);
  const byMonth = Object.fromEntries(store.getPayments().map((p) => [p.month, p]));
  assert.equal(byMonth['2026-01'].bollo, true);
  assert.equal(byMonth['2026-02'].bollo, false, 'non pagato: niente bollo');
  store.setPaid([{ month: '2026-01', studioId: a, paid: false, bollo: true }]);
  assert.equal(store.getPayments().find((p) => p.month === '2026-01').bollo, false, 'tornato da incassare: bollo tolto');
  store.setPaid([{ month: '2026-01', studioId: a, paid: true, bollo: true }]);
  const parsed = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.payments.find((p) => p.month === '2026-01').bollo, true);
  const rec = { ...store.getPayments()[0], bollo: 'si' };
  assert.equal(validateRecord('payment', rec), 'Marca da bollo non valida');
  const old = { ...store.getPayments()[0] };
  delete old.bollo;
  assert.equal(validateRecord('payment', old), null, 'i record della versione precedente restano validi');
});

test('impostazioni dell\'account: parametri delle tasse salvati, ricaricati, nel backup e sincronizzabili', async () => {
  const { buildBackup, parseBackupText } = await import('../js/backup.js');
  const { store, storage } = setup();
  assert.equal(store.getSetting('tax'), null);
  store.setSetting('tax', { coeff: 7800, inps: 2400, rate: 500, bollo: 200 });
  assert.deepEqual(makeStore(storage).getSetting('tax'), { coeff: 7800, inps: 2400, rate: 500, bollo: 200 });
  assert.throws(() => store.setSetting('colore', {}), ValidationError);
  assert.throws(() => store.setSetting('tax', 5), ValidationError);
  const parsed = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(parsed.ok, true, parsed.error);
  assert.deepEqual(parsed.data.settings.map((x) => [x.id, x.value.inps]), [['tax', 2400]]);
  // dopo un'importazione il valore del backup sostituisce quello attuale
  store.setSetting('tax', { coeff: 7800, inps: 2607, rate: 1500, bollo: 200 });
  store.replaceAll(parsed.data);
  assert.equal(store.getSetting('tax').inps, 2400);
  // record sincronizzabile come gli altri (chiave setting_tax)
  store.setTracking?.(true);
  const recs = store.getRecordsByKeys(['setting_tax']);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].kind, 'setting');
});

test('incassi: parte del mese esclusa dalle tasse, modificabile, conservata se non indicata, nel backup', async () => {
  const { buildBackup, parseBackupText } = await import('../js/backup.js');
  const { validateRecord } = await import('../js/store.js');
  const { store, a } = setup();
  store.setPaid([{ month: '2026-10', studioId: a, paid: false, excludedCents: 20000 }]);
  const get = () => store.getPayments().find((p) => p.month === '2026-10');
  assert.equal(get().excludedCents, 20000);
  store.setPaid([{ month: '2026-10', studioId: a, paid: true }]);
  assert.equal(get().excludedCents, 20000, 'segnare pagato non la cancella');
  store.setPaid([{ month: '2026-10', studioId: a, paid: true, excludedCents: 15000 }]);
  assert.equal(get().excludedCents, 15000);
  store.setPaid([{ month: '2026-10', studioId: a, paid: true, excludedCents: 0 }]);
  assert.equal(get().excludedCents, 0);
  assert.throws(() => store.setPaid([{ month: '2026-10', studioId: a, paid: true, excludedCents: 1.5 }]), ValidationError);
  store.setPaid([{ month: '2026-10', studioId: a, paid: true, excludedCents: 3000 }]);
  const parsed = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.payments.find((p) => p.month === '2026-10').excludedCents, 3000);
  assert.notEqual(validateRecord('payment', { ...get(), excludedCents: -1 }), null);
});

test('note da ricordare: aggiungi, modifica, ordine per ultima modifica, elimina con annulla, backup e ricaricamento', async () => {
  const { buildBackup, parseBackupText } = await import('../js/backup.js');
  let t = 1000;
  const storage = memStorage();
  const store = makeStore(storage, { now: () => (t += 10) });
  const a = store.addMemo('  Ordinare guanti\nmisura S  ');
  const b = store.addMemo('Corso aggiornamento');
  assert.deepEqual(store.getMemos().map((m) => m.text), ['Corso aggiornamento', 'Ordinare guanti\nmisura S']);
  store.updateMemo(a, 'Ordinare guanti e mascherine');
  assert.equal(store.getMemos()[0].id, a, 'la nota modificata va in cima');
  assert.throws(() => store.addMemo('   '), ValidationError);
  assert.throws(() => store.updateMemo('x', 'testo'), ValidationError);
  assert.equal(makeStore(storage).getMemos().length, 2);
  const parsed = parseBackupText(JSON.stringify(buildBackup(store.exportData())));
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.memos.length, 2);
  const removed = store.deleteMemo(b);
  assert.equal(store.getMemos().length, 1);
  assert.equal(store.restoreRecords(removed), 1);
  assert.equal(store.getMemos().length, 2);
  assert.equal(store.getRecordsByKeys([`memo_${a}`])[0].kind, 'memo');
});
