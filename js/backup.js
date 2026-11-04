// Backup completo in JSON: creazione, validazione, lettura (funzioni pure).
// Formato invariato (schemaVersion 1). Sezioni facoltative aggiunte dopo la prima versione:
// calendar: {rules, days}, notes, payments, settings (impostazioni dell'account, es. parametri delle tasse). I backup senza queste sezioni restano validi;
// una versione vecchia dell'app le ignora.
import { validateRecord } from './store.js';

const KIND_INFO = [
  ['studios', 'studio', 'uno studio', 'studi'],
  ['treatments', 'treatment', 'un trattamento', 'trattamenti'],
  ['entries', 'entry', 'un inserimento', 'inserimenti'],
];

const OPTIONAL_INFO = [
  ['rules', 'rule', 'una regola del calendario', 'regole del calendario'],
  ['days', 'day', 'un giorno del calendario', 'giorni del calendario'],
  ['notes', 'note', 'una nota', 'note'],
  ['payments', 'payment', 'un incasso', 'incassi'],
  ['settings', 'setting', 'un\'impostazione', 'impostazioni'],
  ['memos', 'memo', 'una nota', 'note da ricordare'],
];

export function buildBackup(data, exportedAt = new Date().toISOString()) {
  const strip = (arr) => (arr || []).filter((r) => !r.deleted).map((r) => structuredClone(r));
  const out = {
    app: 'DentalFlow',
    schemaVersion: 1,
    exportedAt,
    studios: strip(data.studios),
    treatments: strip(data.treatments),
    entries: strip(data.entries),
  };
  if (data.calendar) out.calendar = { rules: strip(data.calendar.rules), days: strip(data.calendar.days) };
  if (data.notes) out.notes = strip(data.notes);
  if (data.payments) out.payments = strip(data.payments);
  if (data.settings) out.settings = strip(data.settings);
  if (data.memos) out.memos = strip(data.memos);
  return out;
}

const fail = (error) => ({ ok: false, error });
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Valida un elenco di record; ritorna {list} o {error}. */
function checkList(list, kind, label, plural) {
  if (!Array.isArray(list)) return { error: `Backup non valido: elenco ${plural} mancante` };
  const ids = new Set();
  for (const r of list) {
    if (r && typeof r === 'object' && r.deleted === true) return { error: `Backup non valido: ${label} risulta eliminato` };
    const err = validateRecord(kind, r);
    if (err) return { error: `Backup non valido: ${lowerFirst(err)} in ${label}` };
    if (ids.has(r.id)) return { error: `Backup non valido: identificativo duplicato in ${label}` };
    ids.add(r.id);
  }
  return {
    list: list.map((r) => {
      const c = structuredClone(r);
      c.deleted = false;
      if (typeof c.name === 'string') c.name = c.name.trim();
      return c;
    }),
  };
}

export function validateBackup(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail('Backup non valido: formato non riconosciuto');
  if (obj.app !== 'DentalFlow') return fail('Backup non valido: il file non è un backup di DentalFlow');
  if (obj.schemaVersion !== 1) return fail('Backup non valido: versione del backup non supportata');
  const data = {};
  for (const [arr, kind, label, plural] of KIND_INFO) {
    const res = checkList(obj[arr], kind, label, plural);
    if (res.error) return fail(res.error);
    data[arr] = res.list;
  }
  if (obj.calendar !== undefined && !isObj(obj.calendar)) return fail('Backup non valido: calendario non riconosciuto');
  const sources = {
    rules: obj.calendar?.rules, days: obj.calendar?.days, notes: obj.notes, payments: obj.payments, settings: obj.settings, memos: obj.memos,
  };
  const present = {
    rules: obj.calendar !== undefined, days: obj.calendar !== undefined, notes: obj.notes !== undefined, payments: obj.payments !== undefined,
    settings: obj.settings !== undefined,
    memos: obj.memos !== undefined,
  };
  for (const [arr, kind, label, plural] of OPTIONAL_INFO) {
    if (!present[arr]) continue;
    const res = checkList(sources[arr] ?? [], kind, label, plural);
    if (res.error) return fail(res.error);
    if (arr === 'rules' || arr === 'days') {
      data.calendar ||= { rules: [], days: [] };
      data.calendar[arr] = res.list;
    } else {
      data[arr] = res.list;
    }
  }
  return { ok: true, data };
}

export function parseBackupText(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return fail('File di backup non valido');
  }
  return validateBackup(obj);
}
