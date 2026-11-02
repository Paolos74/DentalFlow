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

// ---------- nomi italiani e formati estesi ----------
export const WEEKDAYS_LONG = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
export const WEEKDAYS_SHORT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
export const MONTHS_LONG = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Giorno della settimana ISO: 1 = lunedì … 7 = domenica. */
export function weekdayISO(iso) {
  const [y, m, d] = parts(iso);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Giorni di calendario da a a b (b − a), indipendente dall'ora legale. */
export function daysBetween(a, b) {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** "lunedì 2 novembre" (con withYear: "lunedì 2 novembre 2026"). */
export function formatLong(iso, { withYear = false } = {}) {
  const [y, m, d] = parts(iso);
  return `${WEEKDAYS_LONG[weekdayISO(iso) - 1]} ${d} ${MONTHS_LONG[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** "lun 2 nov". */
export function formatShort(iso) {
  const [, m, d] = parts(iso);
  return `${WEEKDAYS_SHORT[weekdayISO(iso) - 1]} ${d} ${MONTHS_IT[m - 1]}`;
}

/** Prima lettera maiuscola (le date in testa a titoli e righe). */
export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Titoli: "Lunedì 2 novembre" (con withYear: "Lunedì 2 novembre 2026"). */
export function formatDayTitle(iso, opts) {
  return capitalize(formatLong(iso, opts));
}

const NBSP = '\u00a0';

/** Righe e sottotitoli: "Gio 29 ott", con spazi non divisibili (la data non va mai a capo). */
export function formatDayShort(iso) {
  return capitalize(formatShort(iso)).replace(/ /g, NBSP);
}

/** Date dentro una frase: "1 ott 2026", con spazi non divisibili. */
export function formatDateShort(iso) {
  const [y, m, d] = parts(iso);
  return [d, MONTHS_IT[m - 1], y].join(NBSP);
}

/** Intervallo compatto: "1–31 ott 2026", "29 set – 4 ott 2026", "30 dic 2025 – 2 gen 2026", "2 nov 2026". */
export function formatSpan(from, to) {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  if (from === to) return formatDateShort(from);
  if (y1 === y2 && m1 === m2) return `${d1}–${formatDateShort(to)}`;
  if (y1 === y2) return `${d1}${NBSP}${MONTHS_IT[m1 - 1]} – ${formatDateShort(to)}`;
  return `${formatDateShort(from)} – ${formatDateShort(to)}`;
}

/** 'YYYY-MM' → "ottobre 2026". */
export function monthLabel(ym) {
  return `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** 'YYYY-MM' + n mesi. */
export function addMonths(ym, n) {
  const total = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad2((total % 12) + 1)}`;
}

/** Stesso giorno n anni dopo (o prima); il 29 febbraio diventa 28 negli anni non bisestili. */
export function shiftYear(iso, n) {
  const [y, m, d] = parts(iso);
  const ny = y + n;
  return toISO(ny, m, Math.min(d, lastDayOfMonth(ny, m)));
}

/** Tutte le date del mese 'YYYY-MM'. */
export function monthDates(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return Array.from({ length: lastDayOfMonth(y, m) }, (_, i) => toISO(y, m, i + 1));
}

/** Saluto secondo l'ora: 5–12 Buongiorno, 12–18 Buon pomeriggio, altrimenti Buonasera. */
export function greeting(hour) {
  if (hour >= 5 && hour < 12) return 'Buongiorno';
  if (hour >= 12 && hour < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

// ---------- periodo navigabile (‹ ottobre 2026 ›) ----------
export const NAV_MODES = [['mese', 'Mese'], ['anno', 'Anno'], ['tutto', 'Tutto'], ['personalizzato', 'Personalizzato']];

/** nav: {mode, anchor:'YYYY-MM-DD', from, to} → {from, to} (null = senza limite). Lancia PeriodError. */
export function navRange(nav) {
  const a = nav.anchor;
  switch (nav.mode) {
    case 'mese': {
      const [y, m] = parts(a);
      return { from: toISO(y, m, 1), to: toISO(y, m, lastDayOfMonth(y, m)) };
    }
    case 'anno': {
      const y = parts(a)[0];
      return { from: toISO(y, 1, 1), to: toISO(y, 12, 31) };
    }
    case 'tutto':
      return { from: null, to: null };
    case 'personalizzato':
      return periodRange('personalizzato', a, { from: nav.from, to: nav.to });
    default:
      throw new PeriodError('Periodo non valido');
  }
}

/** Nuova data di riferimento spostata di delta mesi o anni. */
export function navShift(nav, delta) {
  const [y, m] = parts(nav.anchor);
  if (nav.mode === 'mese') {
    const ym = addMonths(toISO(y, m, 1).slice(0, 7), delta);
    return `${ym}-01`;
  }
  if (nav.mode === 'anno') return toISO(y + delta, 1, 1);
  return nav.anchor;
}

export function navLabel(nav) {
  if (nav.mode === 'mese') return monthLabel(nav.anchor.slice(0, 7));
  if (nav.mode === 'anno') return nav.anchor.slice(0, 4);
  if (nav.mode === 'tutto') return 'Tutto';
  return 'Personalizzato';
}

/** Periodo precedente per il confronto, o null ('tutto' o periodo non valido). */
export function previousRange(nav) {
  if (nav.mode === 'mese' || nav.mode === 'anno') return navRange({ ...nav, anchor: navShift(nav, -1) });
  if (nav.mode === 'personalizzato') {
    let r;
    try {
      r = navRange(nav);
    } catch {
      return null;
    }
    const len = daysBetween(r.from, r.to) + 1;
    return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
  }
  return null;
}

/** Dal 1° del mese a oggi, e lo stesso tratto del mese prima (giorno limitato alla fine del mese). */
export function monthToDate(today) {
  const [y, m, d] = parts(today);
  const pm = addMonths(today.slice(0, 7), -1);
  const py = Number(pm.slice(0, 4));
  const pmm = Number(pm.slice(5, 7));
  return {
    current: { from: toISO(y, m, 1), to: today },
    previous: { from: toISO(py, pmm, 1), to: toISO(py, pmm, Math.min(d, lastDayOfMonth(py, pmm))) },
  };
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
