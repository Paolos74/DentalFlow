// Modello dati, validazione, CRUD e persistenza su localStorage (adapter iniettabile).
// 'dentalflow:data' resta identico alla versione 1 (studi, trattamenti, inserimenti, tracking).
// Calendario, note delle giornate e incassi stanno in 'dentalflow:calendar': una versione vecchia
// dell'app li ignora e, salvando, non li cancella.
import { isValidISODate } from './dates.js';
import { ruleError, dayError, occurrences } from './calendar.js';
import { COLOR_KEYS, nextStudioColor } from './colors.js';

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
export const CAL_KEY = 'dentalflow:calendar';
export const CAL_CORRUPT_PREFIX = 'dentalflow:calendar:corrupt-';
export const MAX_CENTS = 10000000;
export const MAX_NOTE = 1000;
export const KINDS = ['studio', 'treatment', 'entry', 'rule', 'day', 'note', 'payment', 'setting', 'memo'];
// memo: note libere "da ricordare" (Altro → Note), non legate a giorni o studi
export const MAX_MEMO = 4000;
// setting: impostazioni dell'account {id, value} (es. id 'tax' = parametri delle tasse); si sincronizzano
const CAL_ARRAYS = ['rules', 'days', 'notes', 'payments', 'settings', 'memos'];
export const SETTING_IDS = ['tax'];

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
  calCorrupt: 'Calendario locale illeggibile: è stata salvata una copia. Importa un backup.',
  color: 'Colore non valido',
  note: `La nota può avere al massimo ${MAX_NOTE} caratteri`,
  memo: `Scrivi la nota (al massimo ${MAX_MEMO} caratteri)`,
  memoNotFound: 'Nota non trovata: potrebbe essere stata eliminata',
  month: 'Mese non valido',
  ruleNotFound: 'Regola del calendario non trovata',
  dayNotFound: 'Giorno del calendario non trovato',
  dayDuplicate: 'In quella data lo studio ha già un giorno singolo nel calendario',
  noDay: 'Nessun inserimento in questa giornata',
  notAssociatedTarget: (name) => `Il trattamento «${name}» non è associato allo studio scelto`,
};

const ARRAY_OF = {
  studio: 'studios', treatment: 'treatments', entry: 'entries', rule: 'rules', day: 'days', note: 'notes', payment: 'payments', setting: 'settings', memo: 'memos',
};
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const noteId = (date, studioId) => `${date}_${studioId}`;
export const paymentId = (month, studioId) => `${month}_${studioId}`;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTs = (v) => Number.isSafeInteger(v) && v >= 0;
const byName = (a, b) => a.name.localeCompare(b.name, 'it') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function emptyState() {
  return {
    schemaVersion: 1, studios: [], treatments: [], entries: [], tracking: { enabled: false, dirty: [] },
    rules: [], days: [], notes: [], payments: [], settings: [], memos: [],
  };
}

const serializeData = (s) => JSON.stringify({
  schemaVersion: 1, studios: s.studios, treatments: s.treatments, entries: s.entries, tracking: s.tracking,
});
const serializeCal = (s) => JSON.stringify({ version: 1, rules: s.rules, days: s.days, notes: s.notes, payments: s.payments, settings: s.settings, memos: s.memos });

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
    if (r.color !== undefined && !COLOR_KEYS.includes(r.color)) return MSG.color;
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
  if (kind === 'rule') return ruleError(r);
  if (kind === 'day') return dayError(r);
  if (kind === 'note') {
    if (!isValidISODate(r.date)) return MSG.date;
    if (typeof r.studioId !== 'string' || r.studioId === '') return 'Studio non valido';
    if (typeof r.text !== 'string' || r.text.trim() === '' || r.text.length > MAX_NOTE) return MSG.note;
    return null;
  }
  if (kind === 'payment') {
    if (typeof r.month !== 'string' || !MONTH_RE.test(r.month)) return MSG.month;
    if (typeof r.studioId !== 'string' || r.studioId === '') return 'Studio non valido';
    if (typeof r.paid !== 'boolean') return 'Stato del pagamento non valido';
    if (r.bollo !== undefined && typeof r.bollo !== 'boolean') return 'Marca da bollo non valida';
    if (r.excludedCents !== undefined && (!Number.isInteger(r.excludedCents) || r.excludedCents < 0 || r.excludedCents > MAX_CENTS)) return MSG.amount;
    return null;
  }
  if (kind === 'memo') {
    if (typeof r.text !== 'string' || r.text.trim() === '' || r.text.length > MAX_MEMO) return MSG.memo;
    return null;
  }
  if (kind === 'setting') {
    if (!SETTING_IDS.includes(r.id)) return 'Impostazione sconosciuta';
    if (!isObj(r.value)) return 'Valore dell\'impostazione non valido';
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
    ...emptyState(),
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
  // Contenuto di 'dentalflow:calendar': calDisk = stringa su disco (null se assente), calSaved = ultimo stato salvato.
  let calDisk = null;
  let calSaved = serializeCal(emptyState());
  const subscribers = new Set();

  /** Copia un valore illeggibile sotto prefix+timestamp (una sola volta). false se non si può copiare. */
  function keepCorruptCopy(prefix, raw) {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix) && storage.getItem(k) === raw) return true;
    }
    try {
      storage.setItem(prefix + now(), raw);
      return true;
    } catch {
      return false;
    }
  }

  function loadData() {
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
    if (!keepCorruptCopy(CORRUPT_PREFIX, raw)) {
      readOnly = true;
      loadWarning = MSG.readOnly;
      return;
    }
    loadWarning = MSG.corrupt;
  }

  function loadCal() {
    let raw = null;
    try {
      raw = storage.getItem(CAL_KEY);
    } catch {
      raw = null;
    }
    calDisk = raw ?? null;
    if (raw === null || raw === undefined) {
      calSaved = serializeCal(state);
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (isObj(parsed) && CAL_ARRAYS.every((a) => parsed[a] === undefined || Array.isArray(parsed[a]))) {
      for (const a of CAL_ARRAYS) state[a] = (parsed[a] || []).filter(isObj);
      calSaved = serializeCal(state);
      return;
    }
    calSaved = null; // al primo salvataggio il calendario viene riscritto (la copia è già salvata)
    if (!keepCorruptCopy(CAL_CORRUPT_PREFIX, raw)) {
      readOnly = true;
      loadWarning = MSG.readOnly;
      return;
    }
    if (!readOnly) loadWarning = loadWarning ? `${loadWarning} ${MSG.calCorrupt}` : MSG.calCorrupt;
  }

  function load() {
    readOnly = false;
    loadWarning = null;
    loadData();
    loadCal();
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
      for (const arr of Object.values(ARRAY_OF)) next[arr] = next[arr].filter((r) => !r.deleted);
      next.tracking.dirty = [];
    }
    const calStr = serializeCal(next);
    const calChanged = calStr !== calSaved;
    if (calChanged) {
      try {
        storage.setItem(CAL_KEY, calStr);
      } catch {
        throw new StorageError(MSG.quota);
      }
    }
    try {
      storage.setItem(DATA_KEY, serializeData(next));
    } catch {
      if (calChanged) {
        try {
          if (calDisk === null) storage.removeItem(CAL_KEY);
          else storage.setItem(CAL_KEY, calDisk);
        } catch { /* il calendario resta quello nuovo: lo stato in memoria non cambia */ }
      }
      throw new StorageError(MSG.quota);
    }
    if (calChanged) {
      calSaved = calStr;
      calDisk = calStr;
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
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

  /** Crea o aggiorna (anche riportando in vita un record eliminato) un record con id deterministico. */
  function upsert(next, kind, id, fields) {
    const arr = next[ARRAY_OF[kind]];
    const rec = arr.find((r) => r.id === id);
    if (rec) {
      const same = !rec.deleted && Object.entries(fields).every(([k, v]) => rec[k] === v);
      if (same) return;
      Object.assign(rec, fields, { deleted: false });
      touch(next, kind, rec);
      return;
    }
    const t = now();
    const created = { id, ...fields, createdAt: t, updatedAt: t, deleted: false };
    arr.push(created);
    markDirty(next, kind, id);
  }

  function upsertNote(next, date, studioId, text) {
    const clean = String(text ?? '').trim();
    if (clean.length > MAX_NOTE) throw new ValidationError(MSG.note);
    const id = noteId(date, studioId);
    if (clean === '') {
      const n = findLive(next.notes, id);
      if (n) tombstone(next, 'note', n);
      return;
    }
    upsert(next, 'note', id, { date, studioId, text: clean });
  }

  function ruleFields(i) {
    const end = i.end?.type === 'until' ? { type: 'until', date: i.end.date }
      : i.end?.type === 'count' ? { type: 'count', count: i.end.count } : { type: 'never' };
    const time = i.time && (i.time.from || i.time.to) ? { from: i.time.from, to: i.time.to } : null;
    const base = { studioId: i.studioId, type: i.type, start: i.start, end, time };
    if (i.type === 'weekly') {
      base.weekdays = Array.isArray(i.weekdays) ? [...new Set(i.weekdays)].sort((a, b) => a - b) : i.weekdays;
      base.interval = i.interval ?? 1;
      // orario per giorno della settimana (facoltativo): solo i giorni scelti, senza le righe vuote
      if (i.dayTimes && typeof i.dayTimes === 'object' && !Array.isArray(i.dayTimes)) {
        const dt = {};
        for (const [k, v] of Object.entries(i.dayTimes)) {
          if (!v || (!v.from && !v.to)) continue;
          if (Array.isArray(base.weekdays) && !base.weekdays.includes(Number(k))) continue;
          dt[k] = { from: v.from, to: v.to };
        }
        if (Object.keys(dt).length) base.dayTimes = dt;
      } else if (i.dayTimes !== undefined && i.dayTimes !== null) {
        base.dayTimes = i.dayTimes; // tipo sbagliato: lo rifiuta ruleError
      }
    } else if (i.type === 'monthly-date') base.monthDay = i.monthDay;
    else if (i.type === 'monthly-pos') Object.assign(base, { nth: i.nth, weekday: i.weekday });
    else if (i.type === 'yearly') Object.assign(base, { month: i.month, day: i.day });
    return base;
  }

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
        const rec = {
          id: uuid(), name: n, archived: false, color: nextStudioColor(live(next.studios)), createdAt: t, updatedAt: t, deleted: false,
        };
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
        for (const [kind, arr] of [['rule', 'rules'], ['day', 'days'], ['note', 'notes'], ['payment', 'payments']]) {
          for (const r of next[arr]) if (!r.deleted && r.studioId === id) tombstone(next, kind, r);
        }
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
    /** Elimina un inserimento; ritorna la copia per "Annulla" ([{kind, data}]). */
    deleteEntry(id) {
      return mutate((next) => {
        const e = findLive(next.entries, id);
        if (!e) throw new ValidationError(MSG.entryNotFound);
        const copy = copyRec(e);
        tombstone(next, 'entry', e);
        return [{ kind: 'entry', data: copy }];
      });
    },

    /**
     * Salva una giornata (data + studio) in un'unica operazione.
     * rows: [{id?, treatmentId, patients, amountCents}] (con id = modifica, senza = nuova riga);
     * deleteIds: inserimenti da eliminare; note: testo della nota ('' = elimina, undefined = invariata).
     */
    saveDay({ date, studioId, rows = [], deleteIds = [], note } = {}) {
      if (!isValidISODate(date)) throw new ValidationError(MSG.date);
      return mutate((next) => {
        const s = findLive(next.studios, studioId);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        const t0 = now();
        const res = { added: [], updated: 0, deleted: 0 };
        for (const row of rows) {
          const fields = { date, patients: row.patients, amountCents: row.amountCents };
          const err = entryFieldsError(fields);
          if (err) throw new ValidationError(err);
          if (row.id) {
            const e = findLive(next.entries, row.id);
            if (!e || e.date !== date || e.studioId !== studioId) throw new ValidationError(MSG.entryNotFound);
            if (e.patients === row.patients && e.amountCents === row.amountCents) continue;
            e.patients = row.patients;
            e.amountCents = row.amountCents;
            touch(next, 'entry', e);
            res.updated += 1;
          } else {
            if (s.archived) throw new ValidationError(MSG.studioUnavailable);
            const t = findLive(next.treatments, row.treatmentId);
            if (!t || t.studios[studioId] !== 'active') throw new ValidationError(MSG.treatmentInactive);
            const rec = {
              id: uuid(), date, studioId, treatmentId: row.treatmentId, patients: row.patients, amountCents: row.amountCents,
              createdAt: t0, updatedAt: t0, deleted: false,
            };
            next.entries.push(rec);
            markDirty(next, 'entry', rec.id);
            res.added.push(rec.id);
          }
        }
        for (const id of deleteIds) {
          const e = findLive(next.entries, id);
          if (!e || e.date !== date || e.studioId !== studioId) throw new ValidationError(MSG.entryNotFound);
          tombstone(next, 'entry', e);
          res.deleted += 1;
        }
        if (note !== undefined) upsertNote(next, date, studioId, note);
        return res;
      });
    },

    /** Elimina tutti gli inserimenti (e la nota) di una giornata; ritorna le copie per "Annulla". */
    deleteDayEntries(date, studioId) {
      return mutate((next) => {
        const removed = [];
        for (const e of next.entries) {
          if (e.deleted || e.date !== date || e.studioId !== studioId) continue;
          removed.push({ kind: 'entry', data: copyRec(e) });
          tombstone(next, 'entry', e);
        }
        const n = findLive(next.notes, noteId(date, studioId));
        if (n) {
          removed.push({ kind: 'note', data: copyRec(n) });
          tombstone(next, 'note', n);
        }
        if (removed.length === 0) throw new ValidationError(MSG.noDay);
        return removed;
      });
    },

    /**
     * Sposta una giornata (tutte le righe e la nota) su un'altra data e/o un altro studio.
     * note (facoltativa): nuovo testo della nota ('' = elimina), salvato nella stessa operazione:
     * se lo spostamento non è possibile non cambia niente.
     */
    moveDayEntries(src, dst, { note } = {}) {
      if (!isValidISODate(dst?.date)) throw new ValidationError(MSG.date);
      const same = src.date === dst.date && src.studioId === dst.studioId;
      if (same && note === undefined) return 0;
      return mutate((next) => {
        if (note !== undefined) {
          if (!findLive(next.studios, src.studioId)) throw new ValidationError(MSG.studioNotFound);
          upsertNote(next, src.date, src.studioId, note);
        }
        if (same) return 0;
        if (!findLive(next.studios, dst.studioId)) throw new ValidationError(MSG.studioNotFound);
        const list = next.entries.filter((e) => !e.deleted && e.date === src.date && e.studioId === src.studioId);
        const srcNote = findLive(next.notes, noteId(src.date, src.studioId));
        if (list.length === 0 && !srcNote) {
          if (note !== undefined) return 0; // la nota appena tolta era tutto: niente da spostare
          throw new ValidationError(MSG.noDay);
        }
        for (const e of list) {
          const t = findLive(next.treatments, e.treatmentId);
          if (!t) throw new ValidationError(MSG.treatmentNotFound);
          if (!(dst.studioId in t.studios)) throw new ValidationError(MSG.notAssociatedTarget(t.name));
        }
        for (const e of list) {
          e.date = dst.date;
          e.studioId = dst.studioId;
          touch(next, 'entry', e);
        }
        if (srcNote) {
          const target = findLive(next.notes, noteId(dst.date, dst.studioId));
          const text = target ? `${target.text}\n${srcNote.text}`.slice(0, MAX_NOTE) : srcNote.text;
          tombstone(next, 'note', srcNote);
          upsertNote(next, dst.date, dst.studioId, text);
        }
        return list.length;
      });
    },

    /** Ripristina record eliminati (da "Annulla"); salta quelli già presenti o senza studio/trattamento. */
    restoreRecords(list) {
      return mutate((next) => {
        let n = 0;
        for (const item of list || []) {
          const arr = ARRAY_OF[item?.kind] && next[ARRAY_OF[item.kind]];
          if (!arr || !isObj(item.data)) continue;
          const data = item.data;
          if (findLive(arr, data.id)) continue;
          if (data.studioId && !findLive(next.studios, data.studioId)) continue;
          if (item.kind === 'entry' && !findLive(next.treatments, data.treatmentId)) continue;
          const rec = { ...copyRec(data), deleted: false };
          const idx = arr.findIndex((r) => r.id === data.id);
          if (idx >= 0) {
            rec.updatedAt = arr[idx].updatedAt;
            arr[idx] = rec;
          } else {
            arr.push(rec);
          }
          touch(next, item.kind, rec);
          n += 1;
        }
        return n;
      });
    },

    // ---------- colore dello studio ----------
    /** Studi della versione 1 senza colore: colori diversi in ordine di creazione (una sola volta). */
    assignMissingColors() {
      const missing = live(state.studios).filter((s) => !COLOR_KEYS.includes(s.color));
      if (missing.length === 0 || readOnly) return 0;
      return mutate((next) => {
        const studios = live(next.studios).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
        let n = 0;
        for (const s of studios) {
          if (COLOR_KEYS.includes(s.color)) continue;
          s.color = nextStudioColor(studios.filter((x) => COLOR_KEYS.includes(x.color)));
          touch(next, 'studio', s);
          n += 1;
        }
        return n;
      });
    },
    setStudioColor(id, color) {
      if (!COLOR_KEYS.includes(color)) throw new ValidationError(MSG.color);
      mutate((next) => {
        const s = findLive(next.studios, id);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        s.color = color;
        touch(next, 'studio', s);
      });
    },

    // ---------- calendario di lavoro ----------
    getCalendar() {
      return {
        rules: live(state.rules).map(copyRec),
        days: live(state.days).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map(copyRec),
      };
    },
    addRule(input) {
      const fields = ruleFields(input);
      const err = ruleError(fields);
      if (err) throw new ValidationError(err);
      return mutate((next) => {
        const s = findLive(next.studios, fields.studioId);
        if (!s || s.archived) throw new ValidationError(MSG.studioUnavailable);
        const t = now();
        const rec = { id: uuid(), ...fields, exdates: [], createdAt: t, updatedAt: t, deleted: false };
        next.rules.push(rec);
        markDirty(next, 'rule', rec.id);
        return rec.id;
      });
    },
    updateRule(id, input) {
      mutate((next) => {
        const idx = next.rules.findIndex((r) => r.id === id && !r.deleted);
        if (idx < 0) throw new ValidationError(MSG.ruleNotFound);
        const old = next.rules[idx];
        const fields = ruleFields({ ...old, ...input });
        const rec = {
          id: old.id, ...fields, exdates: [...(input.exdates ?? old.exdates ?? [])].sort(),
          createdAt: old.createdAt, updatedAt: old.updatedAt, deleted: false,
        };
        const err = ruleError(rec);
        if (err) throw new ValidationError(err);
        if (!findLive(next.studios, rec.studioId)) throw new ValidationError(MSG.studioNotFound);
        next.rules[idx] = rec;
        touch(next, 'rule', rec);
      });
    },
    deleteRule(id) {
      mutate((next) => {
        const r = findLive(next.rules, id);
        if (!r) throw new ValidationError(MSG.ruleNotFound);
        tombstone(next, 'rule', r);
      });
    },
    /** Aggiunge giorni singoli per uno studio (salta quelli già presenti). Ritorna gli id creati. */
    addWorkDays(studioId, dates, time = null) {
      const list = [...new Set(dates || [])].sort();
      if (list.length === 0) throw new ValidationError(MSG.date);
      for (const date of list) {
        const err = dayError({ studioId, date, time });
        if (err) throw new ValidationError(err);
      }
      return mutate((next) => {
        const s = findLive(next.studios, studioId);
        if (!s || s.archived) throw new ValidationError(MSG.studioUnavailable);
        const t = now();
        const ids = [];
        for (const date of list) {
          if (next.days.some((d) => !d.deleted && d.studioId === studioId && d.date === date)) continue;
          const rec = { id: uuid(), studioId, date, time: time || null, createdAt: t, updatedAt: t, deleted: false };
          next.days.push(rec);
          markDirty(next, 'day', rec.id);
          ids.push(rec.id);
        }
        return ids;
      });
    },
    updateWorkDay(id, patch) {
      mutate((next) => {
        const d = findLive(next.days, id);
        if (!d) throw new ValidationError(MSG.dayNotFound);
        const merged = { ...d, ...pick(patch, ['studioId', 'date', 'time']) };
        const err = dayError(merged);
        if (err) throw new ValidationError(err);
        const s = findLive(next.studios, merged.studioId);
        if (!s) throw new ValidationError(MSG.studioNotFound);
        // come addWorkDays: niente giorni nuovi per uno studio archiviato (resta modificabile solo l'orario)
        const moved = merged.studioId !== d.studioId || merged.date !== d.date;
        if (s.archived && moved) throw new ValidationError(MSG.studioUnavailable);
        if (moved && next.days.some((x) => !x.deleted && x.id !== d.id && x.studioId === merged.studioId && x.date === merged.date)) {
          throw new ValidationError(MSG.dayDuplicate);
        }
        Object.assign(d, merged);
        touch(next, 'day', d);
      });
    },
    removeWorkDay(id) {
      mutate((next) => {
        const d = findLive(next.days, id);
        if (!d) throw new ValidationError(MSG.dayNotFound);
        tombstone(next, 'day', d);
      });
    },
    /** Toglie dal calendario un giorno per uno studio: data esclusa nelle regole, giorni singoli eliminati. */
    unscheduleDay(date, studioId) {
      if (!isValidISODate(date)) throw new ValidationError(MSG.date);
      return mutate((next) => {
        let n = 0;
        for (const r of next.rules) {
          if (r.deleted || r.studioId !== studioId || occurrences(r, date, date).length === 0) continue;
          r.exdates = [...new Set([...(r.exdates || []), date])].sort();
          touch(next, 'rule', r);
          n += 1;
        }
        for (const d of next.days) {
          if (d.deleted || d.studioId !== studioId || d.date !== date) continue;
          tombstone(next, 'day', d);
          n += 1;
        }
        return n;
      });
    },

    // ---------- note delle giornate ----------
    getNote(date, studioId) {
      const n = findLive(state.notes, noteId(date, studioId));
      return n ? n.text : null;
    },
    getNotes({ from, to, studioId } = {}) {
      return live(state.notes)
        .filter((n) => (!from || n.date >= from) && (!to || n.date <= to) && (!studioId || n.studioId === studioId))
        .map(copyRec);
    },
    setNote(date, studioId, text) {
      if (!isValidISODate(date)) throw new ValidationError(MSG.date);
      mutate((next) => {
        if (!findLive(next.studios, studioId)) throw new ValidationError(MSG.studioNotFound);
        upsertNote(next, date, studioId, text);
      });
    },

    // ---------- note da ricordare (Altro → Note) ----------
    /** Note, la più recente (per ultima modifica) in alto. */
    getMemos() {
      return live(state.memos).sort((a, b) => b.updatedAt - a.updatedAt).map(copyRec);
    },
    addMemo(text) {
      const clean = String(text ?? '').trim();
      if (!clean || clean.length > MAX_MEMO) throw new ValidationError(MSG.memo);
      return mutate((next) => {
        const t = now();
        const rec = { id: uuid(), text: clean, createdAt: t, updatedAt: t, deleted: false };
        next.memos.push(rec);
        markDirty(next, 'memo', rec.id);
        return rec.id;
      });
    },
    updateMemo(id, text) {
      const clean = String(text ?? '').trim();
      if (!clean || clean.length > MAX_MEMO) throw new ValidationError(MSG.memo);
      mutate((next) => {
        const r = findLive(next.memos, id);
        if (!r) throw new ValidationError(MSG.memoNotFound);
        if (r.text === clean) return;
        r.text = clean;
        touch(next, 'memo', r);
      });
    },
    deleteMemo(id) {
      return mutate((next) => {
        const r = findLive(next.memos, id);
        if (!r) throw new ValidationError(MSG.memoNotFound);
        const copy = copyRec(r);
        tombstone(next, 'memo', r);
        return [{ kind: 'memo', data: copy }];
      });
    },

    // ---------- impostazioni dell'account (si sincronizzano e vanno nel backup) ----------
    /** Valore dell'impostazione (copia) o null. */
    getSetting(id) {
      const r = findLive(state.settings, id);
      return r ? structuredClone(r.value) : null;
    },
    setSetting(id, value) {
      if (!SETTING_IDS.includes(id)) throw new ValidationError('Impostazione sconosciuta');
      if (!isObj(value)) throw new ValidationError('Valore dell\'impostazione non valido');
      mutate((next) => {
        const r = findLive(next.settings, id);
        if (r && JSON.stringify(r.value) === JSON.stringify(value)) return;
        upsert(next, 'setting', id, { value: structuredClone(value) });
      });
    },

    // ---------- incassi (pagato / da incassare) per mese e studio ----------
    getPayments() {
      return live(state.payments).map(copyRec);
    },
    /**
     * list: [{month:'YYYY-MM', studioId, paid, bollo?, excludedCents?}]; bollo = marca da bollo pagata dallo studio
     * (conta solo se pagato); excludedCents = parte del mese da non contare nelle tasse (undefined = invariata).
     */
    setPaid(list) {
      for (const p of list || []) {
        if (typeof p?.month !== 'string' || !MONTH_RE.test(p.month)) throw new ValidationError(MSG.month);
      }
      mutate((next) => {
        for (const p of list || []) {
          if (!findLive(next.studios, p.studioId)) throw new ValidationError(MSG.studioNotFound);
          const fields = { month: p.month, studioId: p.studioId, paid: p.paid === true, bollo: p.paid === true && p.bollo === true };
          if (p.excludedCents !== undefined) {
            if (!Number.isInteger(p.excludedCents) || p.excludedCents < 0 || p.excludedCents > MAX_CENTS) throw new ValidationError(MSG.amount);
            fields.excludedCents = p.excludedCents;
          }
          upsert(next, 'payment', paymentId(p.month, p.studioId), fields);
        }
      });
    },

    /** Momento dell'ultima modifica nota (ms), o 0. */
    lastChangeAt() {
      let max = 0;
      for (const arr of Object.values(ARRAY_OF)) for (const r of state[arr]) if (r.updatedAt > max) max = r.updatedAt;
      return max;
    },

    // ---------- backup e sincronizzazione ----------
    exportData() {
      return {
        studios: live(state.studios).map(copyRec),
        treatments: live(state.treatments).map(copyRec),
        entries: live(state.entries).map(copyRec),
        calendar: { rules: live(state.rules).map(copyRec), days: live(state.days).map(copyRec) },
        notes: live(state.notes).map(copyRec),
        payments: live(state.payments).map(copyRec),
        settings: live(state.settings).map(copyRec),
        memos: live(state.memos).map(copyRec),
      };
    },
    /**
     * Sostituisce i dati con quelli di un backup. Le sezioni facoltative assenti
     * (calendar, notes, payments: backup della versione 1) lasciano invariati i dati attuali.
     */
    replaceAll(data) {
      const next = structuredClone(state);
      const incoming = {
        studios: structuredClone(data.studios || []),
        treatments: structuredClone(data.treatments || []),
        entries: structuredClone(data.entries || []),
      };
      if (isObj(data.calendar)) {
        incoming.rules = structuredClone(data.calendar.rules || []);
        incoming.days = structuredClone(data.calendar.days || []);
      }
      if (Array.isArray(data.notes)) incoming.notes = structuredClone(data.notes);
      if (Array.isArray(data.payments)) incoming.payments = structuredClone(data.payments);
      if (Array.isArray(data.settings)) incoming.settings = structuredClone(data.settings);
      if (Array.isArray(data.memos)) incoming.memos = structuredClone(data.memos);
      if (!next.tracking.enabled) {
        for (const arr of Object.keys(incoming)) next[arr] = incoming[arr];
        next.tracking = { enabled: false, dirty: [] };
      } else {
        for (const kind of KINDS) {
          const arr = ARRAY_OF[kind];
          if (!incoming[arr]) continue;
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
        const hasTomb = Object.values(ARRAY_OF).some((arr) => state[arr].some((r) => r.deleted));
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
