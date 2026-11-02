import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync, SYNC_KEY, SYNC_MSG } from '../js/sync.js';
import { DATA_KEY, CORRUPT_PREFIX } from '../js/store.js';
import { memStorage, makeStore, counterClock } from './helpers.js';

const BASE_TS = Date.UTC(2026, 0, 1);
const ts = (n) => new Date(BASE_TS + n * 1000).toISOString();

/** Firebase finto: Auth + Firestore in memoria. */
function mockFirebase() {
  const docs = new Map();
  let clock = 100;
  const failures = [];
  const stats = { commits: 0, commitSizes: [], queries: [], refreshes: 0, calls: 0 };
  const reply = (status, body, raw) => new Response(raw ?? JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const endpointOf = (url) => (url.includes('signInWithPassword') ? 'signIn' : url.includes('securetoken') ? 'token'
    : url.endsWith(':commit') ? 'commit' : url.endsWith(':runQuery') ? 'runQuery' : 'other');
  const tnum = (s) => Date.parse(s);

  async function fetch(url, init = {}) {
    stats.calls++;
    const ep = endpointOf(url);
    const fi = failures.findIndex((f) => f.endpoint === ep);
    if (fi >= 0) {
      const [f] = failures.splice(fi, 1);
      if (f.hang) {
        return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      if (f.reject) throw new TypeError('Failed to fetch');
      return reply(f.status, f.body, f.raw);
    }
    if (ep === 'signIn') return reply(200, { idToken: 'id-1', refreshToken: 'rt-1', localId: 'uid-1', expiresIn: '3600' });
    if (ep === 'token') {
      stats.refreshes++;
      return reply(200, { id_token: `id-r${stats.refreshes}`, refresh_token: 'rt-1', expires_in: '3600', user_id: 'uid-1' });
    }
    const body = JSON.parse(init.body);
    if (ep === 'commit') {
      stats.commits++;
      stats.commitSizes.push(body.writes.length);
      const t = ts(++clock);
      for (const w of body.writes) {
        assert.deepEqual(w.updateTransforms, [{ fieldPath: 'syncedAt', setToServerValue: 'REQUEST_TIME' }]);
        docs.set(w.update.name, { name: w.update.name, fields: { ...w.update.fields, syncedAt: { timestampValue: t } } });
      }
      return reply(200, { commitTime: t, writeResults: body.writes.map(() => ({ updateTime: t })) });
    }
    if (ep === 'runQuery') {
      const q = body.structuredQuery;
      stats.queries.push(q);
      let list = [...docs.values()].sort((a, b) => tnum(a.fields.syncedAt.timestampValue) - tnum(b.fields.syncedAt.timestampValue)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (q.startAt) {
        const v = q.startAt.values;
        const ct = tnum(v[0].timestampValue);
        if (v.length === 2 && q.startAt.before === false) {
          list = list.filter((d) => { const t = tnum(d.fields.syncedAt.timestampValue); return t > ct || (t === ct && d.name > v[1].referenceValue); });
        } else if (v.length === 1 && q.startAt.before === true) {
          list = list.filter((d) => tnum(d.fields.syncedAt.timestampValue) >= ct);
        } else throw new Error('startAt non previsto');
      }
      list = list.slice(0, q.limit);
      if (list.length === 0) return reply(200, [{ readTime: ts(clock) }]);
      return reply(200, list.map((d) => ({ document: structuredClone(d), readTime: ts(clock) })));
    }
    return reply(404, { error: { message: 'not found' } });
  }
  return {
    fetch, docs, stats,
    failNext: (endpoint, status, body, raw) => failures.push({ endpoint, status, body, raw }),
    hangNext: (endpoint) => failures.push({ endpoint, hang: true }),
    rejectNext: (endpoint) => failures.push({ endpoint, reject: true }),
    tsNum: tnum, ts,
  };
}

function device(fb, { prefix = 'a', storage = memStorage(), now = counterClock(), requestTimeoutMs } = {}) {
  const store = makeStore(storage, { now, prefix });
  const sync = createSync({ fetch: fb.fetch, storage, now, store, requestTimeoutMs });
  return { storage, store, sync, now };
}

async function connect(d) {
  d.sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  await d.sync.signIn('a@b.it', 'pw');
}

const settings = (st) => JSON.parse(st.getItem(SYNC_KEY));

test('signIn: token, tracking, record preesistenti dirty, cursore azzerato, email salvata', async () => {
  const fb = mockFirebase();
  const d = device(fb);
  d.store.addStudio('Prima del login');
  d.sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  fb.failNext('runQuery', 500, {}); // ferma la sync dopo il login, per ispezionare lo stato
  await d.sync.signIn('a@b.it', 'pw');
  const s = settings(d.storage);
  assert.equal(s.uid, 'uid-1');
  assert.equal(s.refreshToken, 'rt-1');
  assert.equal(s.cursor, null);
  assert.equal(d.sync.getStatus().email, 'a@b.it');
  assert.equal(d.store.isTracking(), true);
  assert.equal(d.store.getDirtyIds().length, 1);
  assert.equal(d.sync.isEnabled(), true);
});

test('prima sync: push di tutto; un secondo dispositivo riceve i dati', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  const s1 = a.store.addStudio('Studio A');
  const t1 = a.store.addTreatment('Igiene', [s1]);
  a.store.addEntries([{ date: '2026-02-13', studioId: s1, treatmentId: t1, patients: 7, amountCents: 21000 }]);
  await connect(a);
  assert.equal(a.sync.getStatus().lastError, null);
  assert.equal(fb.docs.size, 3);
  assert.deepEqual(a.store.getDirtyIds(), []);
  const b = device(fb, { prefix: 'b' });
  await connect(b);
  assert.deepEqual(b.store.exportData(), a.store.exportData());
  assert.ok(b.sync.getStatus().lastSyncAt);
});

test('commit da max 250 scritture e paginazione dentro un commit', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  for (let i = 0; i < 300; i++) a.store.addStudio(`S${i}`);
  await a.sync.syncNow();
  assert.deepEqual(fb.stats.commitSizes, [250, 50]);
  for (let i = 300; i < 800; i++) a.store.addStudio(`S${i}`);
  await a.sync.syncNow();
  assert.deepEqual(fb.stats.commitSizes, [250, 50, 250, 250]);
  assert.ok(fb.stats.commitSizes.every((n) => n <= 250));
  const b = device(fb, { prefix: 'b' });
  await connect(b);
  assert.equal(b.store.getStudios().length, 800);
  const all = [...fb.docs.values()].sort((x, y) => fb.tsNum(x.fields.syncedAt.timestampValue) - fb.tsNum(y.fields.syncedAt.timestampValue) || (x.name < y.name ? -1 : 1));
  const last = all[all.length - 1];
  assert.deepEqual(settings(b.storage).cursor, { syncedAt: last.fields.syncedAt.timestampValue, name: last.name });
});

test('finestra di sovrapposizione: un documento visibile in ritardo viene preso', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  a.store.addStudio('Uno');
  await connect(a);
  const b = device(fb, { prefix: 'b' });
  await connect(b);
  const cur = settings(b.storage).cursor;
  const late = new Date(fb.tsNum(cur.syncedAt) - 1000).toISOString();
  const name = cur.name.replace(/records\/.*$/, 'records/studio_late');
  const data = { id: 'late', name: 'In ritardo', archived: false, createdAt: 1, updatedAt: 5, deleted: false };
  fb.docs.set(name, { name, fields: { kind: { stringValue: 'studio' }, data: { stringValue: JSON.stringify(data) }, updatedAt: { integerValue: '5' }, deleted: { booleanValue: false }, syncedAt: { timestampValue: late } } });
  await b.sync.syncNow();
  assert.ok(b.store.getStudios().some((s) => s.name === 'In ritardo'));
});

test('tombstone e conflitto LWW in entrambe le direzioni', async () => {
  const fb = mockFirebase();
  const clockA = counterClock(1_000_000);
  const clockB = counterClock(2_000_000);
  const a = device(fb, { prefix: 'a', now: clockA });
  const s1 = a.store.addStudio('Condiviso');
  const s2 = a.store.addStudio('Da eliminare');
  await connect(a);
  const b = device(fb, { prefix: 'b', now: clockB });
  await connect(b);
  a.store.deleteStudio(s2);
  await a.sync.syncNow();
  await b.sync.syncNow();
  assert.ok(!b.store.getStudios().some((s) => s.id === s2));
  // LWW: A rinomina (orologio indietro), B rinomina (orologio avanti) → vince B ovunque
  a.store.renameStudio(s1, 'Nome di A');
  b.store.renameStudio(s1, 'Nome di B');
  await a.sync.syncNow();
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(a.store.getStudios()[0].name, 'Nome di B');
  assert.equal(b.store.getStudios()[0].name, 'Nome di B');
});

test('niente loop: seconda sync senza modifiche non fa commit; i dati ricevuti non emettono local', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  a.store.addStudio('Uno');
  await connect(a);
  const b = device(fb, { prefix: 'b' });
  const sources = [];
  b.store.subscribe((e) => sources.push(e.source));
  await connect(b);
  assert.ok(!sources.includes('local'));
  const before = fb.stats.commits;
  await b.sync.syncNow();
  await a.sync.syncNow();
  assert.equal(fb.stats.commits, before);
});

test('record modificato durante il push resta dirty', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  const s1 = a.store.addStudio('Uno');
  await connect(a);
  a.store.renameStudio(s1, 'Due');
  const orig = fb.fetch;
  const sync = createSync({
    fetch: async (url, init) => {
      if (url.endsWith(':commit')) a.store.renameStudio(s1, 'Tre');
      return orig(url, init);
    },
    storage: a.storage, now: a.now, store: a.store,
  });
  await sync.syncNow();
  assert.ok(a.store.getDirtyIds().includes(`studio_${s1}`));
});

test('compattazione dei tombstone dopo un push riuscito', async () => {
  const fb = mockFirebase();
  const now = counterClock(1_000_000);
  const a = device(fb, { prefix: 'a', now });
  const s1 = a.store.addStudio('Uno');
  await connect(a);
  a.store.deleteStudio(s1);
  await a.sync.syncNow();
  assert.ok(a.store.getAllRecordsIncludingDeleted().some((r) => r.data.id === s1), 'tombstone recente mantenuto');
  now.set(now.peek() + 31 * 24 * 3600 * 1000);
  await a.sync.syncNow();
  assert.ok(!a.store.getAllRecordsIncludingDeleted().some((r) => r.data.id === s1), 'tombstone vecchio rimosso');
});

test('rinnovo del token scaduto', async () => {
  const fb = mockFirebase();
  const now = counterClock(1_000_000);
  const a = device(fb, { prefix: 'a', now });
  await connect(a);
  assert.equal(fb.stats.refreshes, 0);
  now.set(now.peek() + 2 * 3600 * 1000);
  await a.sync.syncNow();
  assert.equal(fb.stats.refreshes, 1);
  assert.equal(settings(a.storage).idToken, 'id-r1');
});

test('403: messaggio italiano e dati locali intatti', async () => {
  const fb = mockFirebase();
  const a = device(fb);
  a.store.addStudio('Uno');
  a.sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  fb.failNext('runQuery', 403, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } });
  await a.sync.signIn('a@b.it', 'pw');
  assert.equal(a.sync.getStatus().lastError, SYNC_MSG.forbidden);
  assert.equal(a.store.getStudios().length, 1);
});

test('refresh 400 INVALID_REFRESH_TOKEN: sessione scaduta', async () => {
  const fb = mockFirebase();
  const now = counterClock(1_000_000);
  const a = device(fb, { prefix: 'a', now });
  a.store.addStudio('Già sincronizzato');
  await connect(a);
  await a.sync.syncNow(); // la pull ora riceve documenti → cursore impostato
  a.store.addStudio('Modifica in sospeso');
  const dirty = a.store.getDirtyIds();
  now.set(now.peek() + 2 * 3600 * 1000);
  fb.failNext('token', 400, { error: { code: 400, message: 'INVALID_REFRESH_TOKEN' } });
  await a.sync.syncNow();
  const s = settings(a.storage);
  assert.equal(a.sync.getStatus().lastError, SYNC_MSG.session);
  assert.equal(a.sync.isEnabled(), false);
  assert.equal(s.apiKey, 'key');
  assert.equal(s.projectId, 'progetto-test');
  assert.equal(s.email, 'a@b.it');
  assert.ok(s.cursor);
  assert.deepEqual(a.store.getDirtyIds(), dirty);
});

test('Firestore 401 una volta poi 200; 401 due volte → sessione scaduta', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  fb.failNext('runQuery', 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  await a.sync.syncNow();
  assert.equal(fb.stats.refreshes, 1);
  assert.equal(a.sync.getStatus().lastError, null);
  fb.failNext('runQuery', 401, {});
  fb.failNext('runQuery', 401, {});
  await a.sync.syncNow();
  assert.equal(a.sync.getStatus().lastError, SYNC_MSG.session);
  assert.equal(a.sync.isEnabled(), false);
});

test('Firestore 500 e 502 HTML: Firebase non disponibile, token mantenuti', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  fb.failNext('runQuery', 500, { error: { code: 500, status: 'INTERNAL' } });
  await a.sync.syncNow();
  assert.equal(a.sync.getStatus().lastError, 'Firebase non disponibile al momento (HTTP 500): riprova più tardi');
  assert.equal(a.sync.isEnabled(), true);
  fb.failNext('runQuery', 502, null, '<html>Bad Gateway</html>');
  await a.sync.syncNow();
  assert.equal(a.sync.getStatus().lastError, 'Firebase non disponibile al momento (HTTP 502): riprova più tardi');
});

test('errori di accesso', async () => {
  const cases = [
    [400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, SYNC_MSG.apiKey],
    [400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Too many unsuccessful login attempts.' } }, SYNC_MSG.tooMany],
    [400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, SYNC_MSG.credentials],
    [418, {}, 'Errore Firebase (HTTP 418)'],
  ];
  for (const [status, body, msg] of cases) {
    const fb = mockFirebase();
    const a = device(fb);
    a.sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
    fb.failNext('signIn', status, body);
    await a.sync.signIn('a@b.it', 'pw');
    assert.equal(a.sync.getStatus().lastError, msg);
    assert.equal(a.sync.isEnabled(), false);
  }
});

test('timeout della richiesta e nuovo tentativo successivo', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a', requestTimeoutMs: 50 });
  await connect(a);
  fb.hangNext('runQuery');
  await a.sync.syncNow();
  assert.equal(a.sync.getStatus().lastError, SYNC_MSG.network);
  const calls = fb.stats.calls;
  await a.sync.syncNow();
  assert.ok(fb.stats.calls > calls);
  assert.equal(a.sync.getStatus().lastError, null);
});

test('fetch che rifiuta → rete; corpo 2xx non JSON → errore interno', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  fb.rejectNext('runQuery');
  await a.sync.syncNow();
  assert.equal(a.sync.getStatus().lastError, SYNC_MSG.network);
  fb.failNext('runQuery', 200, null, 'non json');
  await a.sync.syncNow();
  assert.ok(a.sync.getStatus().lastError.startsWith('Errore interno di sincronizzazione: '));
});

test('dipendenze usate solo via destrutturazione (fetch senza this)', async () => {
  const fb = mockFirebase();
  const storage = memStorage();
  const now = counterClock();
  const store = makeStore(storage, { now });
  store.addStudio('Uno');
  const deps = {
    fetch: function (...args) { if (this && this.store) throw new TypeError('Illegal invocation'); return fb.fetch(...args); },
    storage, now, store,
  };
  const sync = createSync(deps);
  sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  await sync.signIn('a@b.it', 'pw');
  assert.equal(sync.getStatus().lastError, null);
  assert.equal(fb.docs.size, 1);
});

test('signOut: rimuove la chiave prima di spegnere il tracking, dati locali mantenuti', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  const s1 = a.store.addStudio('Uno');
  a.store.addStudio('Due');
  await connect(a);
  a.store.deleteStudio(s1);
  a.storage.log.length = 0;
  a.sync.signOut();
  assert.equal(a.storage.getItem(SYNC_KEY), null);
  assert.equal(a.store.isTracking(), false);
  assert.deepEqual(a.store.getStudios().map((s) => s.name), ['Due']);
  const ri = a.storage.log.findIndex(([op, k]) => op === 'remove' && k === SYNC_KEY);
  const wi = a.storage.log.findIndex(([op, k]) => op === 'set' && k === DATA_KEY);
  assert.ok(ri >= 0 && wi > ri, JSON.stringify(a.storage.log));
  assert.equal(JSON.parse(a.storage.getItem(DATA_KEY)).tracking.enabled, false);
});

test('riparazione del tracking: store senza tracking e config attiva con cursore', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  a.store.addStudio('Remoto');
  await connect(a);
  await a.sync.syncNow();
  const storage = memStorage({ [SYNC_KEY]: a.storage.getItem(SYNC_KEY) });
  assert.ok(settings(storage).cursor);
  const now = counterClock();
  const store = makeStore(storage, { now, prefix: 'c' });
  store.addStudio('Locale 1');
  store.addStudio('Locale 2');
  const sync = createSync({ fetch: fb.fetch, storage, now, store });
  const q = fb.stats.queries.length;
  await sync.syncNow();
  assert.equal(store.isTracking(), true);
  assert.equal(fb.stats.queries[q].startAt, undefined);
  assert.equal(fb.docs.size, 3);
  assert.equal(store.getStudios().length, 3);
  assert.deepEqual(store.getDirtyIds(), []);
});

test('impostazioni lette a ogni chiamata: signOut in un altro tab ferma la sync', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  const syncB = createSync({ fetch: fb.fetch, storage: a.storage, now: a.now, store: a.store });
  syncB.signOut();
  const calls = fb.stats.calls;
  await a.sync.syncNow();
  assert.equal(fb.stats.calls, calls);
  assert.equal(a.storage.getItem(SYNC_KEY), null);
});

test('sync.js scrive solo dentalflow:sync', async () => {
  const fb = mockFirebase();
  const keys = new Set();
  const inner = memStorage();
  const syncStorage = { ...inner, getItem: inner.getItem, removeItem: inner.removeItem, setItem: (k, v) => { keys.add(k); inner.setItem(k, v); } };
  const now = counterClock();
  const store = makeStore(inner, { now });
  store.addStudio('Uno');
  const sync = createSync({ fetch: fb.fetch, storage: syncStorage, now, store });
  sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  await sync.signIn('a@b.it', 'pw');
  await sync.syncNow();
  assert.deepEqual([...keys], [SYNC_KEY]);
});

test('configure: progetto diverso azzera sessione; stesso progetto mantiene; storage vuoto scrive i default', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  a.store.addStudio('Uno');
  await connect(a);
  await a.sync.syncNow();
  const before = settings(a.storage);
  a.sync.configure({ apiKey: 'key', projectId: 'progetto-test' });
  assert.equal(a.sync.isEnabled(), true);
  assert.ok(settings(a.storage).cursor);
  assert.deepEqual(settings(a.storage), before);
  a.sync.configure({ apiKey: 'key', projectId: 'altro-progetto' });
  const s = settings(a.storage);
  assert.equal(a.sync.isEnabled(), false);
  assert.deepEqual([s.cursor, s.uid, s.refreshToken, s.idToken], [null, null, null, null]);
  assert.equal(s.email, 'a@b.it');
  assert.equal(a.sync.getStatus().projectId, 'altro-progetto');
  const calls = fb.stats.calls;
  await a.sync.syncNow();
  assert.equal(fb.stats.calls, calls);

  const b = device(fb, { prefix: 'b' });
  b.sync.configure({ apiKey: 'k2', projectId: 'p-due-x' });
  assert.deepEqual(settings(b.storage), {
    apiKey: 'k2', projectId: 'p-due-x', uid: null, email: null, refreshToken: null, idToken: null,
    idTokenExpiresAt: null, cursor: null, lastSyncAt: null, lastError: null,
  });
  const st = b.sync.getStatus();
  assert.deepEqual([st.configured, st.enabled, st.apiKey, st.projectId, st.email], [true, false, 'k2', 'p-due-x', null]);
});

test('store in sola lettura: ensureTracking e signOut non lanciano', async () => {
  const fb = mockFirebase();
  const a = device(fb, { prefix: 'a' });
  await connect(a);
  const storage = memStorage({ [DATA_KEY]: '{', [SYNC_KEY]: a.storage.getItem(SYNC_KEY) }, { failSet: (k) => k.startsWith(CORRUPT_PREFIX) });
  const store = makeStore(storage);
  assert.equal(store.isReadOnly(), true);
  const sync = createSync({ fetch: fb.fetch, storage, now: Date.now, store });
  assert.doesNotThrow(() => sync.ensureTracking());
  assert.equal(storage.getItem(DATA_KEY), '{');
  assert.doesNotThrow(() => sync.signOut());
  assert.equal(storage.getItem(SYNC_KEY), null);
});
