import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError, StorageError, validateRecord, DATA_KEY, CORRUPT_PREFIX, MSG } from '../js/store.js';
import { memStorage, makeStore, counterClock, counterUuid } from './helpers.js';

const corruptKeys = (st) => [...st.map.keys()].filter((k) => k.startsWith(CORRUPT_PREFIX));
const throwsMsg = (fn, msg, cls = ValidationError) => assert.throws(fn, (e) => e instanceof cls && e.message === msg);

function setup() {
  const storage = memStorage();
  const store = makeStore(storage);
  const a = store.addStudio('Studio A');
  const b = store.addStudio('Studio B');
  const c = store.addStudio('Studio C');
  return { storage, store, a, b, c };
}

test('setItem che fallisce: StorageError, stato invariato, nessun evento', () => {
  let fail = false;
  const storage = memStorage({}, { failSet: () => fail });
  const store = makeStore(storage);
  store.addStudio('Uno');
  let calls = 0;
  store.subscribe(() => calls++);
  fail = true;
  assert.throws(() => store.addStudio('Due'), (e) => e instanceof StorageError && e.message === MSG.quota);
  assert.deepEqual(store.getStudios().map((s) => s.name), ['Uno']);
  assert.equal(calls, 0);
});

test('dati corrotti: stato vuoto, avviso, copia conservata una sola volta', () => {
  const storage = memStorage({ [DATA_KEY]: '{not json' });
  const s1 = makeStore(storage);
  assert.equal(s1.getStudios().length, 0);
  assert.equal(s1.loadWarning, MSG.corrupt);
  assert.equal(corruptKeys(storage).length, 1);
  assert.equal(storage.getItem(corruptKeys(storage)[0]), '{not json');
  makeStore(storage);
  assert.equal(corruptKeys(storage).length, 1);
  assert.equal(s1.isReadOnly(), false);

  const st2 = memStorage({ [DATA_KEY]: JSON.stringify({ schemaVersion: 2, studios: [], treatments: [], entries: [] }) });
  const s2 = makeStore(st2);
  assert.equal(s2.loadWarning, MSG.corrupt);
  assert.equal(corruptKeys(st2).length, 1);
});

test('copia impossibile: modalità sola lettura fino a replaceAll', () => {
  const storage = memStorage({ [DATA_KEY]: '{' }, { failSet: (k) => k.startsWith(CORRUPT_PREFIX) });
  const store = makeStore(storage);
  assert.equal(store.loadWarning, MSG.readOnly);
  assert.equal(store.isReadOnly(), true);
  throwsMsg(() => store.addStudio('X'), MSG.readOnly, StorageError);
  assert.equal(storage.getItem(DATA_KEY), '{');
  store.setTracking(false); // no-op, non lancia
  store.replaceAll({ studios: [{ id: 's1', name: 'Studio', archived: false, createdAt: 1, updatedAt: 1, deleted: false }], treatments: [], entries: [] });
  assert.equal(store.loadWarning, null);
  assert.equal(store.isReadOnly(), false);
  assert.equal(store.getStudios()[0].name, 'Studio');
  assert.equal(makeStore().isReadOnly(), false);
});

test('updateEntry/deleteEntry su id sconosciuto o eliminato', () => {
  const { store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  const [id] = store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 1, amountCents: 100 }]);
  throwsMsg(() => store.updateEntry('nope', { patients: 2 }), MSG.entryNotFound);
  throwsMsg(() => store.deleteEntry('nope'), MSG.entryNotFound);
  store.deleteEntry(id);
  throwsMsg(() => store.updateEntry(id, { patients: 2 }), MSG.entryNotFound);
  throwsMsg(() => store.deleteEntry(id), MSG.entryNotFound);
});

test('validateRecord e applyRemote che scarta record non validi', () => {
  const studio = { id: 's', name: 'A', archived: false, createdAt: 1, updatedAt: 1, deleted: false };
  const tr = { id: 't', name: 'T', studios: { s: 'active' }, createdAt: 1, updatedAt: 1, deleted: false };
  const en = { id: 'e', date: '2026-01-01', studioId: 's', treatmentId: 't', patients: 1, amountCents: 0, createdAt: 1, updatedAt: 1, deleted: false };
  assert.equal(validateRecord('studio', studio), null);
  assert.equal(validateRecord('treatment', tr), null);
  assert.equal(validateRecord('entry', en), null);
  assert.equal(validateRecord('entry', { ...en, amountCents: 1.5 }), MSG.amount);
  assert.equal(validateRecord('entry', { ...en, patients: 0 }), MSG.patients);
  assert.equal(validateRecord('studio', { ...studio, name: '  ' }), MSG.name);
  const store = makeStore();
  let calls = 0;
  store.subscribe(() => calls++);
  store.applyRemote([{ kind: 'entry', data: { ...en, patients: 0 }, updatedAt: 5, deleted: false }]);
  assert.equal(store.getEntries().length, 0);
  assert.equal(calls, 0);
});

test('ordinamento per nome con localeCompare it', () => {
  const store = makeStore();
  for (const n of ['Zeta', 'ápice', 'Beta']) store.addStudio(n);
  assert.deepEqual(store.getStudios().map((s) => s.name), ['ápice', 'Beta', 'Zeta']);
});

test('dipendenze usate come funzioni libere (niente this)', () => {
  const storage = memStorage();
  let n = 0;
  const deps = {
    storage,
    now: function () { if (this && this.storage) throw new TypeError('Illegal invocation'); return 1000 + n; },
    uuid: function () { if (this && this.storage) throw new TypeError('Illegal invocation'); return `u${++n}`; },
  };
  const store = createStore(deps);
  store.addStudio('Ok');
  assert.equal(store.getStudios().length, 1);
});

test('tracking della sincronizzazione', () => {
  const { storage, store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  const [e1] = store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 1, amountCents: 100 }]);
  assert.deepEqual(store.getDirtyIds(), []);
  store.deleteEntry(e1);
  assert.equal(store.getAllRecordsIncludingDeleted().filter((r) => r.deleted).length, 0);

  store.setTracking(true);
  store.markAllDirty();
  assert.equal(store.getDirtyIds().length, store.getAllRecordsIncludingDeleted().length);
  store.clearDirty(store.getRecordsByKeys(store.getDirtyIds()).map((r) => ({ key: r.key, updatedAt: r.updatedAt })));
  assert.deepEqual(store.getDirtyIds(), []);

  const [e2] = store.addEntries([{ date: '2026-02-14', studioId: a, treatmentId: t, patients: 2, amountCents: 200 }]);
  store.deleteEntry(e2);
  const tomb = store.getAllRecordsIncludingDeleted().find((r) => r.data.id === e2);
  assert.equal(tomb.deleted, true);
  assert.ok(store.getDirtyIds().includes(`entry_${e2}`));
  store.clearDirty([{ key: `entry_${e2}`, updatedAt: tomb.updatedAt - 1 }]); // stale
  assert.ok(store.getDirtyIds().includes(`entry_${e2}`));

  store.compactTombstones({ olderThanMs: 0 });
  assert.ok(store.getAllRecordsIncludingDeleted().some((r) => r.data.id === e2), 'tombstone dirty mantenuto');
  store.clearDirty([{ key: `entry_${e2}`, updatedAt: tomb.updatedAt }]);
  store.compactTombstones({ olderThanMs: 1e12 });
  assert.ok(store.getAllRecordsIncludingDeleted().some((r) => r.data.id === e2), 'tombstone recente mantenuto');
  store.compactTombstones({ olderThanMs: 0 });
  assert.ok(!store.getAllRecordsIncludingDeleted().some((r) => r.data.id === e2), 'tombstone vecchio rimosso');

  const [e3] = store.addEntries([{ date: '2026-02-15', studioId: a, treatmentId: t, patients: 2, amountCents: 200 }]);
  store.deleteEntry(e3);
  const saved = JSON.parse(storage.getItem(DATA_KEY));
  assert.equal(saved.tracking.enabled, true);
  assert.ok(saved.tracking.dirty.includes(`entry_${e3}`));
  store.setTracking(false);
  assert.deepEqual(store.getDirtyIds(), []);
  assert.equal(store.getAllRecordsIncludingDeleted().filter((r) => r.deleted).length, 0);
  assert.equal(JSON.parse(storage.getItem(DATA_KEY)).tracking.enabled, false);
});

test('subscribe: sorgente local/remote; applyRemote senza record presi non emette', () => {
  const store = makeStore();
  const events = [];
  store.subscribe((e) => events.push(e.source));
  store.addStudio('A');
  assert.deepEqual(events, ['local']);
  const rec = { id: 'r1', name: 'Remoto', archived: false, createdAt: 1, updatedAt: 10, deleted: false };
  store.applyRemote([{ kind: 'studio', data: rec, updatedAt: 10, deleted: false }]);
  assert.deepEqual(events, ['local', 'remote']);
  store.applyRemote([{ kind: 'studio', data: rec, updatedAt: 10, deleted: false }]);
  assert.deepEqual(events, ['local', 'remote']);
});

test('applyTreatmentRemoval: archivia e rimuove in una sola mutazione', () => {
  const { store, a, b } = setup();
  const t = store.addTreatment('Igiene', [a, b]);
  store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 1, amountCents: 100 }]);
  let calls = 0;
  store.subscribe(() => calls++);
  store.applyTreatmentRemoval(t, { archiveIds: [a], removeIds: [b] });
  assert.equal(calls, 1);
  assert.deepEqual(store.getTreatments()[0].studios, { [a]: 'archived' });
  assert.equal(store.countEntries({ treatmentId: t }), 1);
  throwsMsg(() => store.applyTreatmentRemoval(t, {}), MSG.noStudios);
  store.applyTreatmentRemoval(t, { removeIds: [a] });
  assert.equal(store.getTreatments().length, 0);
  assert.equal(store.countEntries({ treatmentId: t }), 0);
});

test('studioDeleteImpact', () => {
  const { store, a, b } = setup();
  const t1 = store.addTreatment('Solo A', [a]);
  store.addTreatment('A e B', [a, b]);
  store.addEntries([
    { date: '2026-02-13', studioId: a, treatmentId: t1, patients: 1, amountCents: 100 },
    { date: '2026-02-14', studioId: a, treatmentId: t1, patients: 1, amountCents: 100 },
  ]);
  assert.deepEqual(store.studioDeleteImpact(a), { entryCount: 2, orphanTreatmentNames: ['Solo A'] });
  assert.deepEqual(store.studioDeleteImpact(b), { entryCount: 0, orphanTreatmentNames: [] });
});

test('nomi: aggiunta, rinomina, duplicati', () => {
  const { store, a, b } = setup();
  throwsMsg(() => store.addStudio(''), MSG.name);
  throwsMsg(() => store.addStudio('x'.repeat(61)), MSG.name);
  throwsMsg(() => store.addStudio('studio a'), MSG.dupStudio);
  throwsMsg(() => store.renameStudio(b, ' STUDIO A '), MSG.dupStudio);
  store.renameStudio(a, '  Studio Alfa ');
  assert.ok(store.getStudios().some((s) => s.name === 'Studio Alfa'));
  const t = store.addTreatment('Igiene', [a]);
  throwsMsg(() => store.addTreatment('IGIENE', [b]), MSG.dupTreatment);
  store.addTreatment('Sbiancamento', [b]);
  throwsMsg(() => store.renameTreatment(t, 'sbiancamento'), MSG.dupTreatment);
  store.renameTreatment(t, 'Igiene professionale');
  assert.ok(store.getTreatments().some((x) => x.name === 'Igiene professionale'));
});

test('testi esatti di validazione', () => {
  const { store, a, b } = setup();
  throwsMsg(() => store.addTreatment('X', []), MSG.noStudios);
  const t = store.addTreatment('Igiene', [a]);
  const base = { date: '2026-02-13', studioId: a, treatmentId: t, patients: 1, amountCents: 100 };
  throwsMsg(() => store.addEntries([{ ...base, date: '2026-02-30' }]), 'Data non valida');
  throwsMsg(() => store.addEntries([{ ...base, patients: 1000 }]), 'Numero pazienti non valido (1–999)');
  throwsMsg(() => store.addEntries([{ ...base, amountCents: 10000001 }]), 'Importo non valido (massimo 100.000,00 €)');
  store.archiveStudio(b);
  store.addTreatmentToStudios(t, [b]);
  throwsMsg(() => store.addEntries([{ ...base, studioId: b }]), 'Lo studio non è disponibile per nuovi inserimenti');
  store.archiveTreatmentInStudios(t, [a]);
  throwsMsg(() => store.addEntries([base]), 'Il trattamento non è attivo in questo studio');
  store.restoreTreatmentInStudios(t, [a]);
  const [id] = store.addEntries([base]);
  const { c } = { c: store.addStudio('Studio D') };
  throwsMsg(() => store.updateEntry(id, { studioId: c }), 'Il trattamento non è associato a questo studio');
});

test('trattamento su più studi, archivia/ripristina/rimuovi su 2 di 3', () => {
  const { store, a, b, c } = setup();
  const t = store.addTreatment('Igiene', [a, b, c]);
  assert.deepEqual(Object.keys(store.getTreatments()[0].studios).sort(), [a, b, c].sort());
  assert.equal(store.getTreatmentsForStudio(b).length, 1);
  store.archiveTreatmentInStudios(t, [a, b]);
  assert.deepEqual(store.getTreatments()[0].studios, { [a]: 'archived', [b]: 'archived', [c]: 'active' });
  assert.equal(store.getTreatmentsForStudio(a).length, 0);
  assert.equal(store.getTreatmentsForStudio(a, { includeArchived: true }).length, 1);
  store.restoreTreatmentInStudios(t, [a, b]);
  assert.deepEqual(store.getTreatments()[0].studios, { [a]: 'active', [b]: 'active', [c]: 'active' });
  store.addEntries([
    { date: '2026-02-13', studioId: a, treatmentId: t, patients: 1, amountCents: 100 },
    { date: '2026-02-13', studioId: c, treatmentId: t, patients: 1, amountCents: 100 },
  ]);
  store.removeTreatmentFromStudios(t, [a, b]);
  assert.deepEqual(store.getTreatments()[0].studios, { [c]: 'active' });
  assert.equal(store.countEntries({ treatmentId: t }), 1);
});

test('addEntries: validazione tutto-o-niente', () => {
  const { store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  const ok = { date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 };
  assert.throws(() => store.addEntries([ok, { ...ok, patients: 0 }]), ValidationError);
  assert.equal(store.getEntries().length, 0);
  throwsMsg(() => store.addEntries([]), MSG.noEntries);
  const ids = store.addEntries([ok, { ...ok, patients: 1 }]);
  assert.equal(ids.length, 2);
  assert.equal(store.getEntries().length, 2);
});

test('updateEntry su ogni campo, anche verso studio archiviato', () => {
  const { store, a, b, c } = setup();
  const t = store.addTreatment('Igiene', [a, b]);
  const t2 = store.addTreatment('Sbiancamento', [a]);
  const [id] = store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 }]);
  store.updateEntry(id, { date: '2026-02-12' });
  store.updateEntry(id, { patients: 8 });
  store.updateEntry(id, { amountCents: 21550 });
  store.updateEntry(id, { treatmentId: t2 });
  store.updateEntry(id, { treatmentId: t });
  store.archiveTreatmentInStudios(t, [b]);
  store.archiveStudio(b);
  store.updateEntry(id, { studioId: b }); // trattamento archiviato in B: consentito
  const e = store.getEntries()[0];
  assert.deepEqual([e.date, e.studioId, e.treatmentId, e.patients, e.amountCents], ['2026-02-12', b, t, 8, 21550]);
  throwsMsg(() => store.updateEntry(id, { studioId: c }), MSG.notAssociated);
  throwsMsg(() => store.updateEntry(id, { patients: 0 }), MSG.patients);
});

test('deleteEntry', () => {
  const { store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  const [id] = store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 }]);
  store.deleteEntry(id);
  assert.equal(store.getEntries().length, 0);
});

test('archiveStudio nasconde lo studio ma mantiene gli inserimenti', () => {
  const { store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 }]);
  store.archiveStudio(a);
  assert.ok(!store.getStudios().some((s) => s.id === a));
  assert.ok(store.getStudios({ includeArchived: true }).some((s) => s.id === a && s.archived));
  assert.equal(store.getEntries({ studioId: a }).length, 1);
  store.restoreStudio(a);
  assert.ok(store.getStudios().some((s) => s.id === a));
});

test('deleteStudio a cascata', () => {
  const { store, a, b } = setup();
  const solo = store.addTreatment('Solo A', [a]);
  const both = store.addTreatment('A e B', [a, b]);
  store.addEntries([
    { date: '2026-02-13', studioId: a, treatmentId: solo, patients: 1, amountCents: 100 },
    { date: '2026-02-13', studioId: a, treatmentId: both, patients: 1, amountCents: 100 },
    { date: '2026-02-13', studioId: b, treatmentId: both, patients: 1, amountCents: 100 },
  ]);
  store.deleteStudio(a);
  assert.ok(!store.getStudios({ includeArchived: true }).some((s) => s.id === a));
  assert.equal(store.getEntries().length, 1);
  assert.deepEqual(store.getTreatments().map((t) => [t.name, t.studios]), [['A e B', { [b]: 'active' }]]);
});

test('persistenza: un nuovo store sullo stesso storage vede gli stessi dati', () => {
  const { storage, store, a } = setup();
  const t = store.addTreatment('Igiene', [a]);
  store.addEntries([{ date: '2026-02-13', studioId: a, treatmentId: t, patients: 7, amountCents: 21000 }]);
  const again = createStore({ storage, now: counterClock(), uuid: counterUuid('x') });
  assert.deepEqual(again.exportData(), store.exportData());
  assert.equal(again.loadWarning, null);
});

test('applyRemote LWW', () => {
  const store = makeStore();
  const a = store.addStudio('Locale');
  store.setTracking(true);
  store.renameStudio(a, 'Locale 2');
  const local = store.getStudios()[0];
  assert.ok(store.getDirtyIds().includes(`studio_${a}`));
  store.applyRemote([{ kind: 'studio', data: { ...local, name: 'Vecchio' }, updatedAt: local.updatedAt - 1, deleted: false }]);
  assert.equal(store.getStudios()[0].name, 'Locale 2');
  store.applyRemote([{ kind: 'studio', data: { ...local, name: 'Nuovo' }, updatedAt: local.updatedAt + 100, deleted: false }]);
  assert.equal(store.getStudios()[0].name, 'Nuovo');
  assert.ok(!store.getDirtyIds().includes(`studio_${a}`));
  store.applyRemote([{ kind: 'studio', data: { id: a }, updatedAt: local.updatedAt + 200, deleted: true }]);
  assert.equal(store.getStudios().length, 0);
  const tomb = store.getAllRecordsIncludingDeleted().find((r) => r.data.id === a);
  assert.equal(tomb.deleted, true);
  // una pull vecchia non lo resuscita
  store.applyRemote([{ kind: 'studio', data: { ...local, name: 'Nuovo' }, updatedAt: local.updatedAt + 100, deleted: false }]);
  assert.equal(store.getStudios().length, 0);
});

test('replaceAll con tracking attivo: tombstone dei record assenti e tutto dirty', () => {
  const store = makeStore();
  const a = store.addStudio('Vecchio');
  store.setTracking(true);
  store.replaceAll({ studios: [{ id: 'n1', name: 'Nuovo', archived: false, createdAt: 1, updatedAt: 1, deleted: false }], treatments: [], entries: [] });
  assert.deepEqual(store.getStudios().map((s) => s.name), ['Nuovo']);
  assert.ok(store.getDirtyIds().includes(`studio_${a}`));
  assert.ok(store.getDirtyIds().includes('studio_n1'));
  assert.ok(store.getAllRecordsIncludingDeleted().find((r) => r.data.id === a).deleted);
});
