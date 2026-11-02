// CSV di riepilogo per studio, con date e importi in formato italiano (funzioni pure).
// Due separatori, stesse colonne e stessi valori:
//  - 'excel'   punto e virgola: Excel con impostazioni italiane lo apre già in colonne;
//  - 'virgola' virgola, con gli importi tra virgolette ("210,00"): Numbers, Google Fogli,
//              l'anteprima dell'iPhone ed Excel con impostazioni non italiane lo aprono in colonne.
import { formatIT } from './dates.js';
import { formatEuroCsv } from './money.js';
import { MISSING_TREATMENT, MISSING_STUDIO } from './aggregate.js';

export const CSV_HEADER = ['Data', 'Trattamento', 'Numero pazienti', 'Costo trattamento (€)'];
export const CSV_HEADER_ALL = ['Data', 'Studio', 'Trattamento', 'Numero pazienti', 'Costo trattamento (€)'];
export const CSV_FORMATS = {
  virgola: { sep: ',', label: 'Numbers, Google Fogli, iPhone' },
  excel: { sep: ';', label: 'Excel in italiano' },
};

const lookup = (byId, id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);
const sepOf = (format) => (CSV_FORMATS[format] || CSV_FORMATS.excel).sep;

/** Protezione da formula injection, poi quoting (se contiene separatore, virgolette o a capo). */
export function csvText(value, sep = ';') {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(sep) || /["\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const finish = (lines) => `\uFEFF${lines.join('\r\n')}\r\n`;

export function buildStudioCsv({ entries, treatmentsById, format = 'excel' }) {
  const sep = sepOf(format);
  const rows = entries.map((e) => ({ e, name: lookup(treatmentsById, e.treatmentId)?.name ?? MISSING_TREATMENT }));
  rows.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : 0)
    || a.name.localeCompare(b.name, 'it') || a.e.createdAt - b.e.createdAt);
  const lines = [CSV_HEADER.map((h) => csvText(h, sep)).join(sep)];
  for (const { e, name } of rows) {
    lines.push([formatIT(e.date), csvText(name, sep), String(e.patients), csvText(formatEuroCsv(e.amountCents), sep)].join(sep));
  }
  return finish(lines);
}

/** CSV unico di tutti gli studi (uso personale): stessa struttura con la colonna Studio. */
export function buildAllStudiosCsv({ entries, treatmentsById, studiosById, format = 'excel' }) {
  const sep = sepOf(format);
  const rows = entries.map((e) => ({
    e,
    name: lookup(treatmentsById, e.treatmentId)?.name ?? MISSING_TREATMENT,
    studio: lookup(studiosById, e.studioId)?.name ?? MISSING_STUDIO,
  }));
  rows.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : 0)
    || a.studio.localeCompare(b.studio, 'it') || a.name.localeCompare(b.name, 'it') || a.e.createdAt - b.e.createdAt);
  const lines = [CSV_HEADER_ALL.map((h) => csvText(h, sep)).join(sep)];
  for (const { e, name, studio } of rows) {
    lines.push([formatIT(e.date), csvText(studio, sep), csvText(name, sep), String(e.patients),
      csvText(formatEuroCsv(e.amountCents), sep)].join(sep));
  }
  return finish(lines);
}

export function slugify(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'studio';
}

export function csvFileName({ studioName, from, to }) {
  const slug = slugify(studioName);
  return from && to ? `DentalFlow_${slug}_${from}_${to}.csv` : `DentalFlow_${slug}_tutto.csv`;
}
