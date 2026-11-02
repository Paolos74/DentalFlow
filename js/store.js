// Modello dati, validazione, CRUD e persistenza su localStorage (adapter iniettabile).
import { isValidISODate } from './dates.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
  }
}

export const DATA_KEY = 'dentalflow:data';
export const CORRUPT_PREFIX = 'dentalflow:data:corrupt-';
export const MAX_CENTS = 10000000;
export const KINDS = ['studio', 'treatment', 'entry'];

export const MSG = {
  name: 'Il nome deve avere da 1 a 60 caratteri',
  dupStudio: 'Esiste già uno studio con questo nome',
  dupTreatment: 'Esiste già un trattamento con questo nome',
  noStudios: 'Seleziona almeno uno studio',
  date: 'Data non valida',
  patients: 'Numero pazienti non valido (1–999)',
  amount: 'Importo non valido (massimo 100.000,00 €)',
  studioUnavailable: 'Lo studio non è disponibile per nuovi inserimenti',
  treatmentInactive: 'Il trattamento non è attivo in questo studio',
  studioNotFound: 'Studio non trovato',
  treatmentNotFound: 'Trattamento non trovato',
  notAssociated: 'Il trattamento non è associato a questo studio',
  entryNotFound: 'Inserimento non trovato: potrebbe essere stato eliminato',
  noEntries: 'Inserisci almeno un paziente',
  quota: 'Impossibile salvare: spazio del browser esaurito o non disponibile. Esporta un backup.',
  corrupt: 'Dati locali illeggibili: è stata salvata una copia. Importa un backup.',
  readOnly: 'Dati locali illeggibili e impossibili da copiare: esporta o importa un backup prima di continuare',
};

const ARRAY_OF = { studio: 'studios', treatment: 'treatments', entry: 'entries' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTs = (v) => Number.isSafeInteger(v) && v >= 0;
const byName = (a, b) => a.name.localeCompare(b.name, 'it') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function emptyState() {
  return { schemaVersion: 1, studios: [], treatments: [], entries: [], tracking: { enabled: false, dirty: [] } };
}

function nameError(name) {
  if (typeof name !== 'string') return MSG.name;
  const n = name.trim();
  return n.length < 1 || n.length > 60 ? MSG.name : null;
}

/**
 * Regole per singolo record (tipi, data, intervalli, nome 1–60).
 * Ritorna un messaggio italiano o null.
 */
export function validateRecord(kind, r) {
  if (!isObj(r)) return 'Record non valido';
  if (typeof r.id !== 'string' || r.id === '') return 'Identificativo non valido';
  if (!isTs(r.createdAt) || !isTs(r.updatedAt)) return 'Data di modifica non valida';
  if (r.deleted !== undefined && typeof r.deleted !== 'boolean') return 'Campo "deleted" non valido';
  if (kind === 'studio') {
    const e = nameError(r.name);
    if (e) return e;
    if (typeof r.archived !== 'boolean') return 'Campo "archiviato" non valido';
    return null;
  }
  if (kind === 'treatment') {
    const e = nameError(r.name);
    if (e) return e;
    if (!isObj(r.studios)) return 'Elenco studi del trattamento non valido';
    for (const v of Object.values(r.studios)) {
      if (v !== 'active' && v !== 'archived') return 'Stato del trattamento in uno studio non valido';
    }
    return null;
  }
  if (kind === 'entry') {
    if (!isValidISODate(r.date)) return MSG.date;
    if (typeof r.studioId !== 'string' || r.studioId === '') return 'Studio non valido';
    if (typeof r.treatmentId !== 'string' || r.treatmentId === '') return 'Trattamento non valido';
    if (!Number.isInteger(r.patients) || r.patients < 1 || r.patients > 999) return MSG.patients;
    if (!Number.isInteger(r.amountCents) || r.amountCents < 0 || r.amountCents > MAX_CENTS) return MSG.amount;
    return null;
  }
  return 'Tipo di record sconosciuto';
}

function isValidState(s) {
  return isObj(s) && s.schemaVersion === 1 && Array.isArray(s.studios) && Array.isArray(s.treatments)
    && Array.isArray(s.entries);
}

function normalizeLoaded(s) {
  const t = isObj(s.tracking) ? s.tracking : {};
  return {
    schemaVersion: 1,
    studios: s.studios,
    treatments: s.treatments,
    entries: s.entries,
    tracking: {
      enabled: t.enabled === true,
      dirty: Array.isArray(t.dirty) ? t.dirty.filter((k) => typeof k === 'string') : [],
    },
  };
}

const keyOf = (kind, id) => `${kind}_${id}`;
function splitKey(key) {
  const i = key.indexOf('_');
  return i < 0 ? [null, null] : [key.slice(0, i), key.slice(i + 1)];
}

export function createStore(deps) {
  const { storage, now, uuid } = deps;
  let state = emptyState();
  let readOnly = false;
  let loadWarning = null;
  const subscribers = new Set();

  function load() {
    readOnly = false;
    loadWarning = null;
    let raw = null;
    try {
      raw = storage.getItem(DATA_KEY);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      state = emptyState();
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (isValidState(parsed)) {
      state = normalizeLoaded(parsed);
      return;
    }
    state = emptyState();
    let exists = false;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(CORRUPT_PREFIX) && storage.getItem(k) === raw) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      try {
        storage.setItem(CORRUPT_PREFIX + now(), raw);
      } catch {
        readOnly = true;
        loadWarning = MSG.readOnly;
        return;
      }
    }
    loadWarning = MSG.corrupt;
  }

  function notify(source) {
    for (const fn of [...subscribers]) {
      try {
        fn({ source });
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** Salva next (rimuove i tombstone se il tracking è spento); solo dopo il salvataggio sostituisce lo stato. */
  function commit(next, { emit = true, source = 'local', allowReadOnly = false } = {}) {
    if (readOnly && !allowReadOnly) throw new StorageError(MSG.readOnly);
    if (!next.tracking.enabled) {
      next.studios = next.studios.filter((r) => !r.deleted);
      next.treatments = next.treatments.filter((r) => !r.deleted);
      next.entries = next.entries.filter((r) => !r.deleted);
      next.tracking.dirty = [];
    }
    try {
      storage.setItem(DATA_KEY, JSON.stringify(next));
    } catch {
      throw new StorageError(MSG.quota);
    }
    state = next;
    if (emit) notify(source);
  }

  function mutate(fn, opts) {
    if (readOnly) throw new StorageError(MSG.readOnly);
    const next = structuredClone(state);
    const result = fn(next);
    commit(next, opts);
    return result;
  }

  function stamp(rec) {
    rec.updatedAt = Math.max(now(), (rec.updatedAt || 0) + 1);
  }

  function markDirty(next, kind, id) {
    if (!next.tracking.enabled) return;
    const k = keyOf(kind, id);
    if (!next.tracking.dirty.includes(k)) next.tracking.dirty.push(k);
  }

  function touch(next, kind, rec) {
    stamp(rec);
    markDirty(next, kind, rec.id);
  }

  function tombstone(next, kind, rec) {
    rec.deleted = true;
    touch(next, kind, rec);
  }

  const live = (arr) => arr.filter((r) => !r.deleted);
  const findLive = (arr, id) => arr.find((r) => r.id === id && !r.deleted);

  function cleanName(name) {
    const e = nameError(typeof name === 'string' ? name : String(name ?? ''));
    if (e) throw new ValidationError(e);
    return String(name).trim();
  }

  function checkUnique(arr, name, excludeId, msg) {
    const low = name.toLocaleLowerCase('it');
    if (arr.some((r) => !r.deleted && r.id !== excludeId && r.name.toLocaleLowerCase('it') === low)) {
      throw new ValidationError(msg);
    }
  }

  function requireIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) throw new ValidationError(MSG.noStudios);
  }

  function entryFieldsError(e) {
    if (!isValidISODate(e.date)) return MSG.date;
    if (!Number.isInteger(e.patients) || e.patients < 1 || e.patients > 999) return MSG.patients;
    if (!Number.isInteger(e.amountCents) || e.amountCents < 0 || e.amountCents > MAX_CENTS) return MSG.amount;
    return null;
  }

  const copyRec = (r) => structuredClone(r);

  // ---------- rimozione trattamento (blocchi interni su bozza) ----------
  function archiveIn(next, t, ids) {
    let changed = false;
    for (const sid of ids) {
      if (t.studios[sid] === 'active') {
        t.studios[sid] = 'archived';
        changed = true;
      }
    }
    if (changed) touch(next, 'treatment', t);
  }

  function removeFrom(next, t, ids) {
    const set = new Set(ids);
    for (const e of next.entries) {
      if (!e.deleted && e.treatmentId === t.id && set.has(e.studioId)) tombstone(next, 'entry', e);
    }
    let changed = false;
    for (const sid of ids) {
      if (sid in t.studios) {
        delete t.studios[sid];
        changed = true;
      }
    }
    if (Object.keys(t.studios).length === 0) tombstone(next, 'treatment', t);
    else if (changed) touch(next, 'treatment', t);
  }

  function getTreatmentDraft(next, id) {
    const t = findLive(next.treatments, id);
    if (!t) throw new ValidationError(MSG.treatmentNotFound);
    return t;
  }

  load();

  const api = {
    get loadWarning() {
      return loadWarning;
    },
    isReadOnly: () => readOnly,

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    // ---------- query ----------
    getStudios({ includeArchived = false } = {}) {
      return live(state.studios).filter((s) => includeArchived || !s.archived).sort(byName).map(copyRec);
    },
    getTreatments() {
      return live(state.treatments).sort(byName).map(copyRec);
    },
    getTreatmentsForStudio(studioId, { includeArchived = false } = {}) {
      return live(state.treatments)
        .filter((t) => t.studios[studioId] === 'active' || (includeArchived && t.studios[studioId] === 'archived'))
        .sort(byName).map(copyRec);
    },
    getEntries({ from, to, studioId, treatmentId } = {}) {
      return live(state.entries)
        .filter((e) => (!from || e.date >= from) && (!to || e.date <= to)
          && (!studioId || e.studioId === studioId) && (!treatmentId || e.treatmentId === treatmentId))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
        .map(copyRec);
    },
    countEntries({ studioId, treatmentId } = {}) {
      let n = 0;
      for (const e of state.entries) {
        if (!e.deleted && (!studioId || e.studioId === studioId) && (!treatmentId || e.treatmentId === treatmentId)) n++;
      }
      return n;
    },
    studioDeleteImpact(id) {
      const entryCount = api.countEntries({ studioId: id });
      const orphanTreatmentNames = live(state.treatments)
        .filter((t) => { const k = Object.keys(t.studios); return k.length === 1 && k[0] === id; })
        .sort(byName).map((t) => t.name);
      return { entryCount, orphanTreatmentNames };
    },

    // ---------- studi ----------
    addStudio(name) {
      const n = cleanName(name);
      return mutate((next) => {
        checkUnique(next.studios, n, null, MSG.dupStudio);
        const t = now();
        const rec = { id: uuid(), name: n, archived: false, createdAt: t, updatedAt: t, deleted: false };
        next.studios.push(rec);
        markDirty(next, 'studio', rec.id);
        return rec.id;
      });
    },
    renameStudio(id, name) {
      const n = cleanName(name);
      mutate((next) => {
        const s = findLive(next.studios, id);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        checkUnique(next.studios, n, id, MSG.dupStudio);
        s.name = n;
        touch(next, 'studio', s);
      });
    },
    archiveStudio(id) {
      mutate((next) => {
        const s = findLive(next.studios, id);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        s.archived = true;
        touch(next, 'studio', s);
      });
    },
    restoreStudio(id) {
      mutate((next) => {
        const s = findLive(next.studios, id);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        s.archived = false;
        touch(next, 'studio', s);
      });
    },
    deleteStudio(id) {
      mutate((next) => {
        const s = findLive(next.studios, id);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        tombstone(next, 'studio', s);
        for (const e of next.entries) if (!e.deleted && e.studioId === id) tombstone(next, 'entry', e);
        for (const t of next.treatments) {
          if (t.deleted || !(id in t.studios)) continue;
          delete t.studios[id];
          if (Object.keys(t.studios).length === 0) tombstone(next, 'treatment', t);
          else touch(next, 'treatment', t);
        }
      });
    },

    // ---------- trattamenti ----------
    addTreatment(name, studioIds) {
      const n = cleanName(name);
      requireIds(studioIds);
      return mutate((next) => {
        checkUnique(next.treatments, n, null, MSG.dupTreatment);
        const studios = {};
        for (const sid of studioIds) {
          if (!findLive(next.studios, sid)) throw new ValidationError(MSG.studioNotFound);
          studios[sid] = 'active';
        }
        const t = now();
        const rec = { id: uuid(), name: n, studios, createdAt: t, updatedAt: t, deleted: false };
        next.treatments.push(rec);
        markDirty(next, 'treatment', rec.id);
        return rec.id;
      });
    },
    renameTreatment(id, name) {
      const n = cleanName(name);
      mutate((next) => {
        const t = getTreatmentDraft(next, id);
        checkUnique(next.treatments, n, id, MSG.dupTreatment);
        t.name = n;
        touch(next, 'treatment', t);
      });
    },
    addTreatmentToStudios(id, studioIds) {
      requireIds(studioIds);
      mutate((next) => {
        const t = getTreatmentDraft(next, id);
        for (const sid of studioIds) {
          if (!findLive(next.studios, sid)) throw new ValidationError(MSG.studioNotFound);
          t.studios[sid] = 'active';
        }
        touch(next, 'treatment', t);
      });
    },
    archiveTreatmentInStudios(id, studioIds) {
      requireIds(studioIds);
      mutate((next) => archiveIn(next, getTreatmentDraft(next, id), studioIds));
    },
    restoreTreatmentInStudios(id, studioIds) {
      requireIds(studioIds);
      mutate((next) => {
        const t = getTreatmentDraft(next, id);
        let changed = false;
        for (const sid of studioIds) {
          if (t.studios[sid] === 'archived') {
            t.studios[sid] = 'active';
            changed = true;
          }
        }
        if (changed) touch(next, 'treatment', t);
      });
    },
    removeTreatmentFromStudios(id, studioIds) {
      requireIds(studioIds);
      mutate((next) => removeFrom(next, getTreatmentDraft(next, id), studioIds));
    },
    applyTreatmentRemoval(id, { archiveIds = [], removeIds = [] } = {}) {
      if (archiveIds.length === 0 && removeIds.length === 0) throw new ValidationError(MSG.noStudios);
      mutate((next) => {
        const t = getTreatmentDraft(next, id);
        if (archiveIds.length) archiveIn(next, t, archiveIds);
        if (removeIds.length) removeFrom(next, t, removeIds);
      });
    },

    // ---------- inserimenti ----------
    addEntries(list) {
      if (!Array.isArray(list) || list.length === 0) throw new ValidationError(MSG.noEntries);
      return mutate((next) => {
        const recs = list.map((input) => {
          const e = {
            date: input.date, studioId: input.studioId, treatmentId: input.treatmentId,
            patients: input.patients, amountCents: input.amountCents,
          };
          const err = entryFieldsError(e);
          if (err) throw new ValidationError(err);
          const s = findLive(next.studios, e.studioId);
          if (!s || s.archived) throw new ValidationError(MSG.studioUnavailable);
          const t = findLive(next.treatments, e.treatmentId);
          if (!t || t.studios[e.studioId] !== 'active') throw new ValidationError(MSG.treatmentInactive);
          return e;
        });
        const t = now();
        const ids = [];
        for (const e of recs) {
          const rec = { id: uuid(), ...e, createdAt: t, updatedAt: t, deleted: false };
          next.entries.push(rec);
          markDirty(next, 'entry', rec.id);
          ids.push(rec.id);
        }
        return ids;
      });
    },
    updateEntry(id, patch) {
      mutate((next) => {
        const e = findLive(next.entries, id);
        if (!e) throw new ValidationError(MSG.entryNotFound);
        const merged = { ...e };
        for (const f of ['date', 'studioId', 'treatmentId', 'patients', 'amountCents']) {
          if (patch && patch[f] !== undefined) merged[f] = patch[f];
        }
        const err = entryFieldsError(merged);
        if (err) throw new ValidationError(err);
        if (!findLive(next.studios, merged.studioId)) throw new ValidationError(MSG.studioNotFound);
        const t = findLive(next.treatments, merged.treatmentId);
        if (!t) throw new ValidationError(MSG.treatmentNotFound);
        if (!(merged.studioId in t.studios)) throw new ValidationError(MSG.notAssociated);
        Object.assign(e, merged);
        touch(next, 'entry', e);
      });
    },
    deleteEntry(id) {
      mutate((next) => {
        const e = findLive(next.entries, id);
        if (!e) throw new ValidationError(MSG.entryNotFound);
        tombstone(next, 'entry', e);
      });
    },

    // ---------- backup e sincronizzazione ----------
    exportData() {
      return {
        studios: live(state.studios).map(copyRec),
        treatments: live(state.treatments).map(copyRec),
        entries: live(state.entries).map(copyRec),
      };
    },
    replaceAll(data) {
      const next = structuredClone(state);
      const incoming = {
        studios: structuredClone(data.studios || []),
        treatments: structuredClone(data.treatments || []),
        entries: structuredClone(data.entries || []),
      };
      if (!next.tracking.enabled) {
        next.studios = incoming.studios;
        next.treatments = incoming.treatments;
        next.entries = incoming.entries;
        next.tracking = { enabled: false, dirty: [] };
      } else {
        for (const kind of KINDS) {
          const arr = ARRAY_OF[kind];
          const current = new Map(next[arr].map((r) => [r.id, r]));
          const incomingIds = new Set(incoming[arr].map((r) => r.id));
          const result = [];
          for (const r of next[arr]) {
            if (incomingIds.has(r.id)) continue;
            if (!r.deleted) tombstone(next, kind, r);
            result.push(r);
          }
          for (const r of incoming[arr]) {
            const old = current.get(r.id);
            r.deleted = false;
            r.updatedAt = Math.max(now(), old ? old.updatedAt + 1 : 0);
            markDirty(next, kind, r.id);
            result.push(r);
          }
          next[arr] = result;
        }
      }
      commit(next, { allowReadOnly: true, emit: false });
      readOnly = false;
      loadWarning = null;
      notify('local');
    },
    getAllRecordsIncludingDeleted() {
      const out = [];
      for (const kind of KINDS) {
        for (const r of state[ARRAY_OF[kind]]) {
          out.push({ key: keyOf(kind, r.id), kind, data: copyRec(r), updatedAt: r.updatedAt, deleted: !!r.deleted });
        }
      }
      return out;
    },
    getRecordsByKeys(keys) {
      const out = [];
      for (const key of keys) {
        const [kind, id] = splitKey(key);
        if (!ARRAY_OF[kind]) continue;
        const r = state[ARRAY_OF[kind]].find((x) => x.id === id);
        if (r) out.push({ key, kind, data: copyRec(r), updatedAt: r.updatedAt, deleted: !!r.deleted });
      }
      return out;
    },
    applyRemote(records) {
      if (readOnly) throw new StorageError(MSG.readOnly);
      const next = structuredClone(state);
      let taken = 0;
      for (const rec of records || []) {
        if (!rec || !ARRAY_OF[rec.kind] || !isObj(rec.data)) continue;
        const { kind } = rec;
        const id = rec.data.id;
        if (typeof id !== 'string' || id === '' || !isTs(rec.updatedAt)) continue;
        const candidate = { ...rec.data, id, updatedAt: rec.updatedAt, deleted: rec.deleted === true };
        if (!candidate.deleted && validateRecord(kind, candidate) !== null) continue;
        const arr = next[ARRAY_OF[kind]];
        const idx = arr.findIndex((r) => r.id === id);
        if (idx >= 0 && !(rec.updatedAt > arr[idx].updatedAt)) continue;
        if (idx >= 0) arr[idx] = candidate;
        else arr.push(candidate);
        const k = keyOf(kind, id);
        next.tracking.dirty = next.tracking.dirty.filter((d) => d !== k);
        taken++;
      }
      if (taken > 0) commit(next, { source: 'remote' });
      return taken;
    },
    isTracking: () => state.tracking.enabled,
    setTracking(enabled) {
      const on = enabled === true;
      if (state.tracking.enabled === on) {
        if (on) return;
        const hasTomb = state.studios.some((r) => r.deleted) || state.treatments.some((r) => r.deleted)
          || state.entries.some((r) => r.deleted);
        if (state.tracking.dirty.length === 0 && !hasTomb) return;
      }
      mutate((next) => {
        next.tracking.enabled = on;
        if (!on) next.tracking.dirty = [];
      }, { emit: false });
    },
    markAllDirty() {
      mutate((next) => {
        const set = new Set(next.tracking.dirty);
        for (const kind of KINDS) for (const r of next[ARRAY_OF[kind]]) set.add(keyOf(kind, r.id));
        next.tracking.dirty = [...set];
      }, { emit: false });
    },
    getDirtyIds: () => [...state.tracking.dirty],
    clearDirty(list) {
      const remove = new Set();
      for (const { key, updatedAt } of list || []) {
        const [kind, id] = splitKey(key);
        const arr = ARRAY_OF[kind] ? state[ARRAY_OF[kind]] : null;
        const r = arr && arr.find((x) => x.id === id);
        if (!r || r.updatedAt === updatedAt) remove.add(key);
      }
      if (remove.size === 0 || !state.tracking.dirty.some((k) => remove.has(k))) return;
      mutate((next) => {
        next.tracking.dirty = next.tracking.dirty.filter((k) => !remove.has(k));
      }, { emit: false });
    },
    compactTombstones({ olderThanMs }) {
      const limit = now() - olderThanMs;
      const dirty = new Set(state.tracking.dirty);
      const drop = (kind, r) => r.deleted && !dirty.has(keyOf(kind, r.id)) && r.updatedAt < limit;
      const any = KINDS.some((kind) => state[ARRAY_OF[kind]].some((r) => drop(kind, r)));
      if (!any) return;
      mutate((next) => {
        for (const kind of KINDS) next[ARRAY_OF[kind]] = next[ARRAY_OF[kind]].filter((r) => !drop(kind, r));
      }, { emit: false });
    },
    reloadFromStorage() {
      load();
      notify('remote');
    },
  };
  return api;
}
