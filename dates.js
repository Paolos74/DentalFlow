// Date di calendario locali nel formato 'YYYY-MM-DD'. Mai new Date('YYYY-MM-DD') (verrebbe letta come UTC).

export class PeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PeriodError';
  }
}

const DAY_MS = 86400000;
const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const pad2 = (n) => String(n).padStart(2, '0');

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

function parts(iso) {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

export function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

export function todayISO(now = Date.now()) {
  const d = new Date(now);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = parts(iso);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOfMonth(y, m);
}

export function formatIT(iso) {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  const dt = new Date(y, m - 1, d + n);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Intervallo (date incluse) per un preset di periodo.
 * 'tutto' → {from:null,to:null}. 'personalizzato' usa custom e lancia PeriodError se non valido.
 */
export function periodRange(preset, today, custom = {}) {
  const [y, m] = parts(today);
  switch (preset) {
    case 'questo-mese':
      return { from: toISO(y, m, 1), to: toISO(y, m, lastDayOfMonth(y, m)) };
    case 'mese-scorso': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: toISO(py, pm, 1), to: toISO(py, pm, lastDayOfMonth(py, pm)) };
    }
    case 'quest-anno':
      return { from: toISO(y, 1, 1), to: toISO(y, 12, 31) };
    case 'tutto':
      return { from: null, to: null };
    case 'personalizzato': {
      const from = custom?.from;
      const to = custom?.to;
      if (!isValidISODate(from) || !isValidISODate(to)) throw new PeriodError('Seleziona la data iniziale e finale');
      if (from > to) throw new PeriodError('La data iniziale è successiva alla finale');
      return { from, to };
    }
    default:
      throw new PeriodError('Periodo non valido');
  }
}

/** Asse temporale dei grafici. null se non ci sono date. */
export function trendRange({ from, to, today, entryDates }) {
  const dates = (entryDates || []).filter((d) => (!from || d >= from) && (!to || d <= to));
  if (dates.length === 0) return null;
  let minD = dates[0];
  let maxD = dates[0];
  for (const d of dates) {
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  const start = from || minD;
  let end;
  if (!to) end = maxD;
  else {
    const capped = to < today ? to : today;
    end = capped > maxD ? capped : maxD;
  }
  if (end < start) end = start;
  return { from: start, to: end };
}

function isoWeek(iso) {
  const [y, m, d] = parts(iso);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // lunedì = 0
  const thursday = t + (3 - dow) * DAY_MS;
  const wy = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(wy, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4dow * DAY_MS;
  const monday = t - dow * DAY_MS;
  const week = Math.round((monday - week1Monday) / (7 * DAY_MS)) + 1;
  return { year: wy, week };
}

export function bucketKey(iso, granularity) {
  switch (granularity) {
    case 'giorno':
      return iso;
    case 'settimana': {
      const { year, week } = isoWeek(iso);
      return `${year}-W${pad2(week)}`;
    }
    case 'mese':
      return iso.slice(0, 7);
    case 'anno':
      return iso.slice(0, 4);
    default:
      throw new Error('Granularità non valida');
  }
}

/** Tutte le chiavi dei bucket da from a to (inclusi), in ordine. */
export function bucketRange(from, to, granularity) {
  const keys = [];
  if (!from || !to || from > to) return keys;
  if (granularity === 'giorno') {
    for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  } else if (granularity === 'settimana') {
    const [y, m, d] = parts(from);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
    for (let cur = addDays(from, -dow); cur <= to; cur = addDays(cur, 7)) keys.push(bucketKey(cur, 'settimana'));
  } else if (granularity === 'mese') {
    let [y, m] = parts(from);
    const [ty, tm] = parts(to);
    while (y < ty || (y === ty && m <= tm)) {
      keys.push(`${String(y).padStart(4, '0')}-${pad2(m)}`);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  } else if (granularity === 'anno') {
    for (let y = parts(from)[0]; y <= parts(to)[0]; y++) keys.push(String(y).padStart(4, '0'));
  } else {
    throw new Error('Granularità non valida');
  }
  return keys;
}

export function bucketLabel(key, granularity) {
  switch (granularity) {
    case 'giorno':
      return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
    case 'settimana':
      return `Sett. ${Number(key.slice(6))} ${key.slice(0, 4)}`;
    case 'mese':
      return `${MONTHS_IT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    case 'anno':
      return key;
    default:
      return key;
  }
}
