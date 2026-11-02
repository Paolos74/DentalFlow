// Riepiloghi e serie per i grafici (funzioni pure).
import { bucketKey, bucketRange, bucketLabel, shiftYear } from './dates.js';
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

/** Media in centesimi per paziente (arrotondata), 0 se non ci sono pazienti. */
export function perPatient(cents, patients) {
  return patients > 0 ? Math.round(cents / patients) : 0;
}

/**
 * Classifica dei trattamenti. measure: 'euro' | 'pazienti' | 'media' (€/paziente).
 * Con 'media' la percentuale è la quota dell'incasso.
 */
export function ranking(entries, { measure = 'euro', treatmentsById } = {}) {
  const sums = new Map();
  for (const e of entries) {
    const cur = sums.get(e.treatmentId) || { c: 0, p: 0 };
    cur.c += e.amountCents;
    cur.p += e.patients;
    sums.set(e.treatmentId, cur);
  }
  const valueOf = (v) => (measure === 'media' ? perPatient(v.c, v.p) : measure === 'pazienti' ? v.p : v.c);
  const pctBase = (v) => (measure === 'pazienti' ? v.p : v.c);
  const total = [...sums.values()].reduce((a, v) => a + pctBase(v), 0);
  return [...sums.entries()].map(([treatmentId, v]) => ({
    treatmentId, name: treatmentName(treatmentsById, treatmentId), value: valueOf(v), pctTenths: pctTenths(pctBase(v), total),
  })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it')
    || (a.treatmentId < b.treatmentId ? -1 : a.treatmentId > b.treatmentId ? 1 : 0));
}

function rankStudios(entries, studiosById) {
  const sums = new Map();
  for (const e of entries) sums.set(e.studioId, (sums.get(e.studioId) || 0) + e.amountCents);
  return [...sums.entries()].map(([studioId, value]) => ({ studioId, name: lookup(studiosById, studioId)?.name ?? MISSING_STUDIO, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'it'));
}

/**
 * Serie per il grafico dell'andamento.
 * mode: 'totale' | 'trattamento' (top 7 + Altri) | 'studio' (top 7 + Altri, con studioId).
 * measure: 'euro' | 'pazienti' | 'media'.
 * compareEntries (solo con 'totale'): inserimenti dell'anno prima, aggiunti come serie tratteggiata "Anno prima".
 */
export function trendSeries(entries, {
  from, to, granularity = 'mese', measure = 'euro', mode = 'totale', treatmentsById, studiosById, compareEntries,
} = {}) {
  const keys = bucketRange(from, to, granularity);
  const labels = keys.map((k) => bucketLabel(k, granularity));
  const index = new Map(keys.map((k, i) => [k, i]));
  const inRange = entries.filter((e) => e.date >= from && e.date <= to);
  const acc = () => ({ c: keys.map(() => 0), p: keys.map(() => 0) });
  const valuesOf = (a) => keys.map((_, i) => (measure === 'media' ? perPatient(a.c[i], a.p[i]) : measure === 'pazienti' ? a.p[i] : a.c[i]));
  const addTo = (a, e, dateForBucket = e.date) => {
    const i = index.get(bucketKey(dateForBucket, granularity));
    if (i === undefined) return;
    a.c[i] += e.amountCents;
    a.p[i] += e.patients;
  };
  if (mode !== 'trattamento' && mode !== 'studio') {
    const a = acc();
    for (const e of inRange) addTo(a, e);
    const series = [{ name: 'Totale', values: valuesOf(a) }];
    if (compareEntries) {
      const pFrom = shiftYear(from, -1);
      const pTo = shiftYear(to, -1);
      const b = acc();
      for (const e of compareEntries) if (e.date >= pFrom && e.date <= pTo) addTo(b, e, shiftYear(e.date, 1));
      series.push({ name: 'Anno prima', values: valuesOf(b), dashed: true });
    }
    return { keys, labels, series };
  }
  const byStudio = mode === 'studio';
  const idOf = (e) => (byStudio ? e.studioId : e.treatmentId);
  const ranked = byStudio
    ? rankStudios(inRange, studiosById).map((r) => ({ id: r.studioId, name: r.name }))
    : ranking(inRange, { measure: measure === 'media' ? 'euro' : measure, treatmentsById }).map((r) => ({ id: r.treatmentId, name: r.name }));
  const top = ranked.slice(0, TOP_N);
  const topIdx = new Map(top.map((r, i) => [r.id, i]));
  const accs = top.map(() => acc());
  const hasOthers = ranked.length > TOP_N;
  const others = acc();
  for (const e of inRange) {
    if (topIdx.has(idOf(e))) addTo(accs[topIdx.get(idOf(e))], e);
    else if (hasOthers) addTo(others, e);
  }
  const series = top.map((r, i) => (byStudio
    ? { name: r.name, studioId: r.id, values: valuesOf(accs[i]) }
    : { name: r.name, values: valuesOf(accs[i]) }));
  if (hasOthers) series.push({ name: 'Altri', values: valuesOf(others) });
  return { keys, labels, series };
}

// ---------- recap ----------

/** Numeri chiave: incasso, pazienti, giorni lavorati (date distinte), medie. */
export function kpis(entries) {
  const cents = sumCents(entries.map((e) => e.amountCents));
  const patients = entries.reduce((n, e) => n + e.patients, 0);
  const days = new Set(entries.map((e) => e.date)).size;
  return {
    cents, patients, days, entries: entries.length,
    perPatient: perPatient(cents, patients),
    perDay: days > 0 ? Math.round(cents / days) : 0,
  };
}

/** Variazione in decimi di punto percentuale, null se il valore precedente è 0. */
export function changeTenths(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) * 1000) / previous);
}

/** Giorni lavorati (date distinte) per studio. */
export function daysByStudio(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!m.has(e.studioId)) m.set(e.studioId, new Set());
    m.get(e.studioId).add(e.date);
  }
  return new Map([...m].map(([k, v]) => [k, v.size]));
}

/** Totali per mese 'YYYY-MM' → {cents, patients}, in ordine di mese. */
export function monthlyTotals(entries) {
  const m = new Map();
  for (const e of entries) {
    const k = e.date.slice(0, 7);
    const cur = m.get(k) || { cents: 0, patients: 0 };
    cur.cents += e.amountCents;
    cur.patients += e.patients;
    m.set(k, cur);
  }
  return new Map([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** Recap dell'anno: totale, confronto con l'anno prima, mese migliore, trattamento più frequente. */
export function yearRecap(entries, previousEntries, { treatmentsById } = {}) {
  const totalCents = sumCents(entries.map((e) => e.amountCents));
  const prevCents = sumCents((previousEntries || []).map((e) => e.amountCents));
  let bestMonth = null;
  for (const [month, v] of monthlyTotals(entries)) if (!bestMonth || v.cents > bestMonth.cents) bestMonth = { month, ...v };
  const byPatients = ranking(entries, { measure: 'pazienti', treatmentsById });
  const top = byPatients[0] ? { treatmentId: byPatients[0].treatmentId, name: byPatients[0].name, patients: byPatients[0].value } : null;
  return {
    totalCents, prevCents, changeTenths: changeTenths(totalCents, prevCents),
    patients: entries.reduce((n, e) => n + e.patients, 0), bestMonth, topTreatment: top,
  };
}

/**
 * Trattamenti ordinati per uso nello studio da `since` in poi (numero di inserimenti), poi per nome.
 */
export function usageOrder(treatments, entries, { studioId, since } = {}) {
  const count = new Map();
  for (const e of entries) {
    if (e.studioId !== studioId || (since && e.date < since)) continue;
    count.set(e.treatmentId, (count.get(e.treatmentId) || 0) + 1);
  }
  return [...treatments].sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0) || a.name.localeCompare(b.name, 'it'));
}

/**
 * Mesi con inserimenti di uno studio e stato dell'incasso: [{month, cents, patients, paid}],
 * prima i mesi non pagati, poi i pagati; in ciascun gruppo dal più recente.
 */
export function paymentMonths(entries, payments, studioId) {
  const paid = new Set((payments || []).filter((p) => p.paid && p.studioId === studioId).map((p) => p.month));
  const list = [...monthlyTotals(entries.filter((e) => e.studioId === studioId))]
    .map(([month, v]) => ({ month, cents: v.cents, patients: v.patients, paid: paid.has(month) }));
  return list.sort((a, b) => (a.paid === b.paid ? (a.month < b.month ? 1 : -1) : a.paid ? 1 : -1));
}

/** Importo da incassare per studio: somma dei mesi con inserimenti non segnati come pagati. */
export function unpaidByStudio(entries, payments) {
  const paid = new Set((payments || []).filter((p) => p.paid).map((p) => `${p.month}|${p.studioId}`));
  const out = new Map();
  for (const e of entries) {
    if (paid.has(`${e.date.slice(0, 7)}|${e.studioId}`)) continue;
    out.set(e.studioId, (out.get(e.studioId) || 0) + e.amountCents);
  }
  return out;
}
