// Sincronizzazione facoltativa con Firebase (Auth + Firestore) via REST. Disattivata finché non si accede.
// Nessuna impostazione è tenuta in memoria: 'dentalflow:sync' è letto dallo storage a ogni chiamata.

export const SYNC_KEY = 'dentalflow:sync';
const PAGE = 500;
const MAX_WRITES = 250;
const OVERLAP_MS = 60000;
const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;

export const SYNC_MSG = {
  network: 'Impossibile raggiungere Firebase',
  apiKey: 'Chiave API non valida',
  credentials: 'Email o password errati',
  tooMany: 'Troppi tentativi: riprova più tardi',
  session: 'Sessione scaduta: inserisci di nuovo email e password e premi «Accedi e sincronizza»',
  forbidden: 'Permesso negato: controlla le regole di Firestore',
  notFound: 'Progetto o database non trovato',
  unavailable: (s) => `Firebase non disponibile al momento (HTTP ${s}): riprova più tardi`,
  other: (s) => `Errore Firebase (HTTP ${s})`,
  internal: (m) => `Errore interno di sincronizzazione: ${m}`,
};

class NetworkError extends Error {}
class SessionExpired extends Error {}
class Gone extends Error {}
class HttpError extends Error {
  constructor(status, message, kind) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

const DEFAULTS = {
  apiKey: null, projectId: null, uid: null, email: null, refreshToken: null, idToken: null,
  idTokenExpiresAt: null, cursor: null, lastSyncAt: null, lastError: null,
};

export function mapSyncError(err) {
  if (err instanceof NetworkError) return SYNC_MSG.network;
  if (err instanceof SessionExpired) return SYNC_MSG.session;
  if (err instanceof HttpError) {
    const m = err.message || '';
    const s = err.status;
    if (s === 400 && /API_KEY_INVALID|API key not valid/.test(m)) return SYNC_MSG.apiKey;
    if (s === 400 && err.kind === 'auth' && /INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(m)) {
      return SYNC_MSG.credentials;
    }
    if (/TOO_MANY_ATTEMPTS_TRY_LATER/.test(m)) return SYNC_MSG.tooMany;
    if (s === 403) return SYNC_MSG.forbidden;
    if (s === 404) return SYNC_MSG.notFound;
    if (s === 429 || s >= 500) return SYNC_MSG.unavailable(s);
    return SYNC_MSG.other(s);
  }
  return SYNC_MSG.internal(err && err.message ? err.message : String(err));
}

export function createSync(deps) {
  const { fetch: doFetch, storage, now, store, requestTimeoutMs = 20000 } = deps;
  let inflight = null;

  // ---------- impostazioni (sempre lette dallo storage) ----------
  function read() {
    let raw;
    try {
      raw = storage.getItem(SYNC_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? { ...DEFAULTS, ...o } : null;
    } catch {
      return null;
    }
  }
  const write = (o) => storage.setItem(SYNC_KEY, JSON.stringify(o));
  /** Read-modify-write; false se la chiave non esiste più (disconnesso altrove). */
  function patch(fields) {
    const cur = read();
    if (!cur) return false;
    write({ ...cur, ...fields });
    return true;
  }
  function patchOrStop(fields) {
    if (!patch(fields)) throw new Gone();
  }
  function readOrStop() {
    const s = read();
    if (!s || !s.refreshToken || !s.uid) throw new Gone();
    return s;
  }
  const enabledIn = (s) => !!(s && s.refreshToken && s.uid);

  // ---------- HTTP ----------
  async function request(url, init, kind) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
    try {
      let res;
      let text;
      try {
        res = await doFetch(url, { ...init, signal: ctrl.signal });
        text = await res.text();
      } catch {
        throw new NetworkError('network');
      }
      if (!res.ok) {
        let msg = '';
        try {
          const body = JSON.parse(text);
          const e = body && (Array.isArray(body) ? body[0]?.error : body.error);
          if (e) msg = [e.message, e.status].filter(Boolean).join(' ');
        } catch {
          msg = '';
        }
        throw new HttpError(res.status, msg, kind);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('risposta non valida dal server');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function idToken(force = false) {
    const s = readOrStop();
    if (!force && s.idToken && Number.isFinite(s.idTokenExpiresAt) && s.idTokenExpiresAt - now() > 60000) {
      return s.idToken;
    }
    let r;
    try {
      r = await request(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(s.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
      }, 'refresh');
    } catch (e) {
      if (e instanceof HttpError && e.status === 400
        && /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND/.test(e.message)) {
        throw new SessionExpired();
      }
      throw e;
    }
    if (!r || typeof r.id_token !== 'string') throw new Error('risposta di rinnovo non valida');
    patchOrStop({
      idToken: r.id_token,
      refreshToken: typeof r.refresh_token === 'string' ? r.refresh_token : s.refreshToken,
      idTokenExpiresAt: now() + (Number(r.expires_in) || 3600) * 1000,
    });
    return r.id_token;
  }

  async function firestore(url, body) {
    const send = (token) => request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }, 'firestore');
    try {
      return await send(await idToken());
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
    }
    try {
      return await send(await idToken(true));
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw new SessionExpired();
      throw e;
    }
  }

  const docRoot = (s) => `projects/${encodeURIComponent(s.projectId)}/databases/(default)/documents`;
  const baseUrl = (s) => `https://firestore.googleapis.com/v1/${docRoot(s)}`;

  function decode(doc) {
    try {
      const f = doc.fields || {};
      const kind = f.kind?.stringValue;
      const data = JSON.parse(f.data?.stringValue);
      const updatedAt = Number(f.updatedAt?.integerValue);
      return { kind, data, updatedAt, deleted: f.deleted?.booleanValue === true };
    } catch {
      return null;
    }
  }

  // ---------- pull / push ----------
  async function pull() {
    const s = readOrStop();
    let cursor = s.cursor;
    let first = true;
    for (;;) {
      const sq = {
        from: [{ collectionId: 'records' }],
        orderBy: [
          { field: { fieldPath: 'syncedAt' }, direction: 'ASCENDING' },
          { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
        ],
        limit: PAGE,
      };
      if (cursor) {
        const t = Date.parse(cursor.syncedAt);
        if (first && Number.isFinite(t)) {
          sq.startAt = { values: [{ timestampValue: new Date(t - OVERLAP_MS).toISOString() }], before: true };
        } else {
          sq.startAt = { values: [{ timestampValue: cursor.syncedAt }, { referenceValue: cursor.name }], before: false };
        }
      }
      first = false;
      const res = await firestore(`${baseUrl(s)}/users/${encodeURIComponent(s.uid)}:runQuery`, { structuredQuery: sq });
      if (!Array.isArray(res)) throw new Error('risposta della query non valida');
      const docs = res.filter((x) => x && x.document).map((x) => x.document);
      if (docs.length === 0) break;
      store.applyRemote(docs.map(decode).filter(Boolean));
      const last = docs[docs.length - 1];
      const syncedAt = last.fields?.syncedAt?.timestampValue;
      if (typeof syncedAt !== 'string' || typeof last.name !== 'string') throw new Error('documento senza syncedAt');
      cursor = { syncedAt, name: last.name };
      patchOrStop({ cursor });
      if (docs.length < PAGE) break;
    }
  }

  async function push() {
    const keys = store.getDirtyIds();
    if (keys.length === 0) return;
    const records = store.getRecordsByKeys(keys);
    for (let i = 0; i < records.length; i += MAX_WRITES) {
      const s = readOrStop();
      const chunk = records.slice(i, i + MAX_WRITES);
      const writes = chunk.map((r) => ({
        update: {
          name: `${docRoot(s)}/users/${s.uid}/records/${r.key}`,
          fields: {
            kind: { stringValue: r.kind },
            data: { stringValue: JSON.stringify(r.data) },
            updatedAt: { integerValue: String(r.updatedAt) },
            deleted: { booleanValue: !!r.deleted },
          },
        },
        updateTransforms: [{ fieldPath: 'syncedAt', setToServerValue: 'REQUEST_TIME' }],
      }));
      await firestore(`${baseUrl(s)}:commit`, { writes });
      store.clearDirty(chunk.map((r) => ({ key: r.key, updatedAt: r.updatedAt })));
    }
  }

  function handleError(err) {
    if (err instanceof Gone) return;
    const fields = { lastError: mapSyncError(err) };
    if (err instanceof SessionExpired) {
      Object.assign(fields, { idToken: null, refreshToken: null, idTokenExpiresAt: null, uid: null });
    }
    try {
      patch(fields);
    } catch (e) {
      console.warn('Sync: impossibile salvare lo stato', e);
    }
  }

  function ensureTracking() {
    if (store.isReadOnly()) return;
    if (enabledIn(read()) && !store.isTracking()) {
      store.setTracking(true);
      store.markAllDirty();
      patch({ cursor: null });
    }
  }

  async function run() {
    try {
      if (!enabledIn(read())) return;
      ensureTracking();
      await pull();
      await push();
      store.compactTombstones({ olderThanMs: TOMBSTONE_TTL });
      patchOrStop({ lastSyncAt: now(), lastError: null });
    } catch (err) {
      handleError(err);
    }
  }

  function syncNow() {
    if (inflight) return inflight;
    const p = run();
    inflight = p;
    p.finally(() => {
      if (inflight === p) inflight = null;
    });
    return p;
  }

  async function signIn(email, password) {
    try {
      const s = read();
      if (!s) return;
      const r = await request(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(s.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
        'auth',
      );
      if (!r || typeof r.idToken !== 'string' || typeof r.refreshToken !== 'string' || typeof r.localId !== 'string') {
        throw new Error('risposta di accesso non valida');
      }
      patchOrStop({
        email,
        uid: r.localId,
        idToken: r.idToken,
        refreshToken: r.refreshToken,
        idTokenExpiresAt: now() + (Number(r.expiresIn) || 3600) * 1000,
        cursor: null,
        lastError: null,
      });
      store.setTracking(true);
      store.markAllDirty();
    } catch (err) {
      handleError(err);
      return;
    }
    if (inflight) await inflight;
    await syncNow();
  }

  return {
    getStatus() {
      const s = read();
      return {
        configured: !!s,
        enabled: enabledIn(s),
        apiKey: s ? s.apiKey : null,
        projectId: s ? s.projectId : null,
        email: s ? s.email : null,
        lastSyncAt: s ? s.lastSyncAt : null,
        lastError: s ? s.lastError : null,
      };
    },
    configure({ apiKey, projectId }) {
      const cur = read();
      if (!cur) {
        write({ ...DEFAULTS, apiKey, projectId });
      } else if (cur.apiKey !== apiKey || cur.projectId !== projectId) {
        write({
          ...cur, apiKey, projectId, uid: null, refreshToken: null, idToken: null, idTokenExpiresAt: null,
          cursor: null, lastSyncAt: null, lastError: null,
        });
      }
    },
    signIn,
    syncNow,
    signOut() {
      storage.removeItem(SYNC_KEY);
      store.setTracking(false);
    },
    isEnabled: () => enabledIn(read()),
    ensureTracking,
  };
}
