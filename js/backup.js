// Backup completo in JSON: creazione, validazione, lettura (funzioni pure).
import { validateRecord } from './store.js';

const KIND_INFO = [
  ['studios', 'studio', 'uno studio', 'studi'],
  ['treatments', 'treatment', 'un trattamento', 'trattamenti'],
  ['entries', 'entry', 'un inserimento', 'inserimenti'],
];

export function buildBackup(data, exportedAt = new Date().toISOString()) {
  const strip = (arr) => (arr || []).filter((r) => !r.deleted).map((r) => structuredClone(r));
  return {
    app: 'DentalFlow',
    schemaVersion: 1,
    exportedAt,
    studios: strip(data.studios),
    treatments: strip(data.treatments),
    entries: strip(data.entries),
  };
}

const fail = (error) => ({ ok: false, error });
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function validateBackup(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail('Backup non valido: formato non riconosciuto');
  if (obj.app !== 'DentalFlow') return fail('Backup non valido: il file non è un backup di DentalFlow');
  if (obj.schemaVersion !== 1) return fail('Backup non valido: versione del backup non supportata');
  const data = {};
  for (const [arr, kind, label, plural] of KIND_INFO) {
    if (!Array.isArray(obj[arr])) return fail(`Backup non valido: elenco ${plural} mancante`);
    const ids = new Set();
    for (const r of obj[arr]) {
      if (r && typeof r === 'object' && r.deleted === true) return fail(`Backup non valido: ${label} risulta eliminato`);
      const err = validateRecord(kind, r);
      if (err) return fail(`Backup non valido: ${lowerFirst(err)} in ${label}`);
      if (ids.has(r.id)) return fail(`Backup non valido: identificativo duplicato in ${label}`);
      ids.add(r.id);
    }
    data[arr] = obj[arr].map((r) => {
      const c = structuredClone(r);
      c.deleted = false;
      if (typeof c.name === 'string') c.name = c.name.trim();
      return c;
    });
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
