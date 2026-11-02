// CSV di riepilogo per singolo studio, formattato per Excel in italiano (funzioni pure).
import { formatIT } from './dates.js';
import { formatEuroCsv } from './money.js';
import { MISSING_TREATMENT } from './aggregate.js';

export const CSV_HEADER = ['Data', 'Trattamento', 'Numero pazienti', 'Costo trattamento (€)'];

const lookup = (byId, id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);

/** Protezione da formula injection, poi quoting. */
export function csvText(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildStudioCsv({ entries, treatmentsById }) {
  const rows = entries.map((e) => ({ e, name: lookup(treatmentsById, e.treatmentId)?.name ?? MISSING_TREATMENT }));
  rows.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : 0)
    || a.name.localeCompare(b.name, 'it') || a.e.createdAt - b.e.createdAt);
  const lines = [CSV_HEADER.map(csvText).join(';')];
  for (const { e, name } of rows) {
    lines.push([formatIT(e.date), csvText(name), String(e.patients), formatEuroCsv(e.amountCents)].join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function slugify(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'studio';
}

export function csvFileName({ studioName, from, to }) {
  const slug = slugify(studioName);
  return from && to ? `DentalFlow_${slug}_${from}_${to}.csv` : `DentalFlow_${slug}_tutto.csv`;
}
