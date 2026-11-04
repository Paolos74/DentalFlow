// Preferenze del dispositivo in 'dentalflow:prefs' (non entrano nel backup né nella sincronizzazione).
// {theme:'light'|'dark'|'auto', csvFormat:'virgola'|'excel', lastBackupAt:ms|null, tax:{coeff,inps,rate,bollo}|null}
import { normalizeTaxParams } from './tax.js';

export const PREFS_KEY = 'dentalflow:prefs';
export const BEFORE_IMPORT_KEY = 'dentalflow:before-import';
export const BACKUP_REMINDER_DAYS = 14;
const DAY_MS = 86400000;

const DEFAULTS = { theme: 'light', csvFormat: 'virgola', lastBackupAt: null, tax: null };
const VALID = {
  theme: (v) => ['light', 'dark', 'auto'].includes(v),
  csvFormat: (v) => ['virgola', 'excel'].includes(v),
  lastBackupAt: (v) => v === null || (Number.isSafeInteger(v) && v >= 0),
  // parametri delle tasse salvati sul dispositivo dalla v11 (ora stanno nell'account: store 'setting' 'tax')
  tax: (v) => v === null || (typeof v === 'object' && !Array.isArray(v)),
};

export function readPrefs(storage) {
  let o = null;
  try {
    o = JSON.parse(storage.getItem(PREFS_KEY) || 'null');
  } catch {
    o = null;
  }
  const out = { ...DEFAULTS };
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of Object.keys(DEFAULTS)) if (k in o && VALID[k](o[k])) out[k] = o[k];
  }
  if (out.tax) out.tax = normalizeTaxParams(out.tax);
  return out;
}

/** Aggiorna alcune preferenze; ritorna false se lo storage non le accetta. */
export function writePrefs(storage, patch) {
  const next = { ...readPrefs(storage), ...patch };
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Promemoria backup: dovuto se ci sono dati e l'ultimo backup manca o ha più di BACKUP_REMINDER_DAYS giorni
 * ed è precedente all'ultima modifica.
 */
export function backupReminder({ lastBackupAt, lastChangeAt, hasData, now }) {
  if (!hasData) return { due: false, days: null };
  if (!lastBackupAt) return { due: true, days: null };
  const days = Math.floor((now - lastBackupAt) / DAY_MS);
  return { due: days >= BACKUP_REMINDER_DAYS && (lastChangeAt || 0) > lastBackupAt, days };
}

/** Copia di sicurezza prima di un'importazione: {savedAt, backup} oppure null. */
export function readBeforeImport(storage) {
  try {
    const o = JSON.parse(storage.getItem(BEFORE_IMPORT_KEY) || 'null');
    return o && typeof o === 'object' && Number.isSafeInteger(o.savedAt) && o.backup ? o : null;
  } catch {
    return null;
  }
}

/** Elimina la copia di sicurezza (libera lo spazio che occupa); false se lo storage non lo permette. */
export function clearBeforeImport(storage) {
  try {
    storage.removeItem(BEFORE_IMPORT_KEY);
    return true;
  } catch {
    return false;
  }
}

export function writeBeforeImport(storage, backup, savedAt) {
  try {
    storage.setItem(BEFORE_IMPORT_KEY, JSON.stringify({ savedAt, backup }));
    return true;
  } catch {
    return false;
  }
}
