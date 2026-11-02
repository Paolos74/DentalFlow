// Riepiloghi e serie per i grafici (funzioni pure).
import { bucketKey, bucketRange, bucketLabel } from './dates.js';
import { sumCents } from './money.js';

export const MISSING_STUDIO = 'Studio eliminato';
export const MISSING_TREATMENT = 'Trattamento eliminato';
export const TOP_N = 7;

const lookup = (byId, id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);

/** Decimi di punto percentuale, intero. */
export function pctTenths(value, total) {
  return total === 0 ? 0 : Math.round((value * 1000) / total);
}

function treatmentName(treatmentsById, id) {
  return lookup(treatmentsById, id)?.name ?? MISSING_TREATMENT;
}

export function summarize(entries, { studiosById, treatmentsById } = {}) {
  const byT = new Map();
  const byS = new Map();
  for (const e of entries) {
    if (!byT.has(e.treatmentId)) byT.set(e.treatmentId, { patients: 0, cents: [] });
    const t = byT.get(e.treatmentId);
    t.patients += e.patients;
    t.cents.push(e.amountCents);
    if (!byS.has(e.studioId)) byS.set(e.studioId, { patients: 0, cents: [] });
    const s = byS.get(e.studioId);
    s.patients += e.patients;
    s.cents.push(e.amountCents);
  }
  const totalCents = sumCents(entries.map((e) => e.amountCents));
  const totalPatients = entries.reduce((n, e) => n + e.patients, 0);
  const byTreatment = [...byT.entries()].map(([treatmentId, v]) => {
    const cents = sumCents(v.cents);
    return {
      treatmentId, name: treatmentName(treatmentsById, treatmentId), patients: v.patients, cents,
      pctTenths: pctTenths(cents, totalCents),
    };
  }).sort((a, b) => b.cents - a.cents || b.patients - a.patients || a.name.localeCompare(b.name, 'it'));
  const byStudio = [...byS.entries()].map(([studioId, v]) => {
    const s = lookup(studiosById, studioId);
    return {
      studioId, name: s?.name ?? MISSING_STUDIO, archived: !!s?.archived, patients: v.patients, cents: sumCents(v.cents),
    };
  }).sort((a, b) => b.cents - a.cents || b.patients - a.patients || a.name.localeCompare(b.name, 'it'));
  return { byTreatment, byStudio, totalPatients, totalCents };
}

const measureOf = (e, measure) => (measure === 'pazienti' ? e.patients : e.amountCents);

export function ranking(entries, { measure = 'euro', treatmentsById } = {}) {
  const sums = new Map();
  for (const e of entries) sums.set(e.treatmentId, (sums.get(e.treatmentId) || 0) + measureOf(e, measure));
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return [...sums.entries()].map(([treatmentId, value]) => ({
    treatmentId, name: treatmentName(treatmentsById, treatmentId), value, pctTenths: pctTenths(value, total),
  })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it')
    || (a.treatmentId < b.treatmentId ? -1 : a.treatmentId > b.treatmentId ? 1 : 0));
}

export function trendSeries(entries, { from, to, granularity = 'mese', measure = 'euro', mode = 'totale', treatmentsById } = {}) {
  const keys = bucketRange(from, to, granularity);
  const labels = keys.map((k) => bucketLabel(k, granularity));
  const index = new Map(keys.map((k, i) => [k, i]));
  const inRange = entries.filter((e) => e.date >= from && e.date <= to);
  const zeros = () => keys.map(() => 0);
  if (mode !== 'trattamento') {
    const values = zeros();
    for (const e of inRange) {
      const i = index.get(bucketKey(e.date, granularity));
      if (i !== undefined) values[i] += measureOf(e, measure);
    }
    return { keys, labels, series: [{ name: 'Totale', values }] };
  }
  const ranked = ranking(inRange, { measure, treatmentsById });
  const top = ranked.slice(0, TOP_N);
  const topIdx = new Map(top.map((r, i) => [r.treatmentId, i]));
  const series = top.map((r) => ({ name: r.name, values: zeros() }));
  const hasOthers = ranked.length > TOP_N;
  if (hasOthers) series.push({ name: 'Altri', values: zeros() });
  for (const e of inRange) {
    const i = index.get(bucketKey(e.date, granularity));
    if (i === undefined) continue;
    const si = topIdx.has(e.treatmentId) ? topIdx.get(e.treatmentId) : (hasOthers ? series.length - 1 : -1);
    if (si >= 0) series[si].values[i] += measureOf(e, measure);
  }
  return { keys, labels, series };
}
