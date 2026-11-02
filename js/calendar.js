// Calendario di lavoro: regole ricorrenti per studio e giorni singoli (funzioni pure).
// Regola: {id, studioId, type, start, end, time, exdates, ...campi del tipo}
//   weekly        weekdays:[1..7] (1 = lunedì), interval: N settimane
//   monthly-date  monthDay: 1..31 (i mesi senza quel giorno vengono saltati, come il Calendario di iOS)
//   monthly-pos   nth: 1..4 o -1 (ultimo), weekday: 1..7
//   yearly        month: 1..12, day: 1..31 (il 29 febbraio solo negli anni bisestili)
//   end: {type:'never'} | {type:'until', date} | {type:'count', count}
//   time: null | {from:'HH:MM', to:'HH:MM'} (solo informativo)
//   dayTimes (solo weekly, facoltativo): {'1': {from, to}, '3': {from, to}} orario per giorno della settimana,
//     vince su time per quel giorno (es. lunedì 9–13, mercoledì 14–19)
// Giorno singolo: {id, studioId, date, time}
import {
  isValidISODate, weekdayISO, lastDayOfMonth, addDays, daysBetween, formatDateShort, WEEKDAYS_LONG, MONTHS_LONG,
} from './dates.js';

export const RULE_TYPES = ['weekly', 'monthly-date', 'monthly-pos', 'yearly'];
export const NTH_LABELS = { 1: 'primo', 2: 'secondo', 3: 'terzo', 4: 'quarto', '-1': 'ultimo' };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_INTERVAL = 52;
const MAX_COUNT = 999;
const MAX_EXDATES = 2000;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const lookup = (byId, id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);

export const CAL_MSG = {
  studio: 'Seleziona lo studio',
  start: 'Data di inizio non valida',
  weekdays: 'Scegli almeno un giorno della settimana',
  interval: `Ogni quante settimane: da 1 a ${MAX_INTERVAL}`,
  monthDay: 'Giorno del mese non valido (1–31)',
  nth: 'Posizione nel mese non valida',
  weekday: 'Giorno della settimana non valido',
  yearDay: 'Giorno dell\'anno non valido',
  until: 'La data di fine deve essere uguale o successiva all\'inizio',
  count: `Numero di volte non valido (1–${MAX_COUNT})`,
  end: 'Fine della ripetizione non valida',
  time: 'Orario non valido: indica inizio e fine (es. 09:00 e 13:00), con la fine dopo l\'inizio',
  type: 'Tipo di ripetizione non valido',
  date: 'Data non valida',
  exdates: 'Elenco dei giorni esclusi non valido',
};

/** Orario facoltativo: null o {from, to} con from < to. */
export function timeError(time) {
  if (time === null || time === undefined) return null;
  if (typeof time !== 'object' || !TIME_RE.test(time.from ?? '') || !TIME_RE.test(time.to ?? '') || time.from >= time.to) {
    return CAL_MSG.time;
  }
  return null;
}

/** Campi della regola (non id e date di modifica). Ritorna un messaggio o null. */
export function ruleError(r) {
  if (!r || typeof r !== 'object') return CAL_MSG.type;
  if (typeof r.studioId !== 'string' || r.studioId === '') return CAL_MSG.studio;
  if (!RULE_TYPES.includes(r.type)) return CAL_MSG.type;
  if (!isValidISODate(r.start)) return CAL_MSG.start;
  if (r.type === 'weekly') {
    if (!Array.isArray(r.weekdays) || r.weekdays.length === 0 || r.weekdays.some((d) => !isInt(d, 1, 7))
      || new Set(r.weekdays).size !== r.weekdays.length) return CAL_MSG.weekdays;
    if (!isInt(r.interval, 1, MAX_INTERVAL)) return CAL_MSG.interval;
  } else if (r.type === 'monthly-date') {
    if (!isInt(r.monthDay, 1, 31)) return CAL_MSG.monthDay;
  } else if (r.type === 'monthly-pos') {
    if (![1, 2, 3, 4, -1].includes(r.nth)) return CAL_MSG.nth;
    if (!isInt(r.weekday, 1, 7)) return CAL_MSG.weekday;
  } else if (r.type === 'yearly') {
    if (!isInt(r.month, 1, 12) || !isInt(r.day, 1, 31) || r.day > lastDayOfMonth(2024, r.month)) return CAL_MSG.yearDay;
  }
  const end = r.end;
  if (!end || typeof end !== 'object') return CAL_MSG.end;
  if (end.type === 'until') {
    if (!isValidISODate(end.date) || end.date < r.start) return CAL_MSG.until;
  } else if (end.type === 'count') {
    if (!isInt(end.count, 1, MAX_COUNT)) return CAL_MSG.count;
  } else if (end.type !== 'never') {
    return CAL_MSG.end;
  }
  const te = timeError(r.time);
  if (te) return te;
  if (r.dayTimes !== undefined && r.dayTimes !== null) {
    if (r.type !== 'weekly' || typeof r.dayTimes !== 'object' || Array.isArray(r.dayTimes)) return CAL_MSG.time;
    for (const [k, v] of Object.entries(r.dayTimes)) {
      if (!/^[1-7]$/.test(k) || !r.weekdays.includes(Number(k)) || v === null || timeError(v)) return CAL_MSG.time;
    }
  }
  if (r.exdates !== undefined && (!Array.isArray(r.exdates) || r.exdates.length > MAX_EXDATES
    || r.exdates.some((d) => !isValidISODate(d)))) return CAL_MSG.exdates;
  return null;
}

export function dayError(d) {
  if (!d || typeof d !== 'object') return CAL_MSG.date;
  if (typeof d.studioId !== 'string' || d.studioId === '') return CAL_MSG.studio;
  if (!isValidISODate(d.date)) return CAL_MSG.date;
  return timeError(d.time);
}

/** Indice della settimana (lunedì–domenica) contato da una data fissa. */
function weekIndex(iso) {
  return Math.floor((daysBetween('2000-01-03', iso) - (weekdayISO(iso) - 1) + 7 * 100000) / 7);
}

/** La data soddisfa lo schema della regola (senza inizio, fine ed esclusioni). */
export function matchesPattern(rule, iso) {
  const day = Number(iso.slice(8, 10));
  switch (rule.type) {
    case 'weekly':
      return rule.weekdays.includes(weekdayISO(iso))
        && (weekIndex(iso) - weekIndex(rule.start)) % rule.interval === 0;
    case 'monthly-date':
      return day === rule.monthDay;
    case 'monthly-pos': {
      if (weekdayISO(iso) !== rule.weekday) return false;
      if (rule.nth > 0) return Math.ceil(day / 7) === rule.nth;
      const last = lastDayOfMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
      return day + 7 > last;
    }
    case 'yearly':
      return Number(iso.slice(5, 7)) === rule.month && day === rule.day;
    default:
      return false;
  }
}

/**
 * Date della regola tra from e to (incluse), senza le date escluse.
 * Con "Dopo N volte" le occorrenze si contano dall'inizio, comprese quelle escluse (come iOS).
 */
export function occurrences(rule, from, to) {
  const out = [];
  if (!from || !to || from > to) return out;
  const end = rule.end || { type: 'never' };
  const ex = new Set(rule.exdates || []);
  let last = to;
  if (end.type === 'until' && end.date < last) last = end.date;
  let d = end.type === 'count' ? rule.start : (from > rule.start ? from : rule.start);
  let count = 0;
  for (; d <= last; d = addDays(d, 1)) {
    if (!matchesPattern(rule, d)) continue;
    count += 1;
    if (end.type === 'count' && count > end.count) break;
    if (d >= from && !ex.has(d)) out.push(d);
  }
  return out;
}

/** Orario della regola in una data: quello del giorno della settimana (dayTimes) o quello generale. */
export function timeFor(rule, iso) {
  if (rule.type === 'weekly' && rule.dayTimes) {
    const t = rule.dayTimes[String(weekdayISO(iso))];
    if (t) return t;
  }
  return rule.time || null;
}

/** La regola ha orari diversi a seconda del giorno della settimana. */
export function hasDayTimes(rule) {
  return rule.type === 'weekly' && !!rule.dayTimes && Object.keys(rule.dayTimes).length > 0;
}

/** Prima data che soddisfa la regola (anche se esclusa), o null. */
export function firstMatch(rule) {
  const all = occurrences({ ...rule, exdates: [] }, rule.start, addDays(rule.start, 3000));
  return all[0] ?? null;
}

const byTime = (a, b) => {
  const ta = a.time?.from;
  const tb = b.time?.from;
  if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return a.studioName.localeCompare(b.studioName, 'it');
};

/**
 * Giorni previsti tra from e to: Map iso → [{studioId, studioName, time, sources:[{type:'rule'|'day', id}]}].
 * Solo studi esistenti e non archiviati. Più fonti per lo stesso studio e giorno diventano una voce.
 */
export function scheduleBetween(cal, from, to, { studiosById } = {}) {
  const map = new Map();
  const usable = (sid) => {
    const s = lookup(studiosById, sid);
    return s && !s.archived && !s.deleted ? s : null;
  };
  const add = (iso, studio, time, source) => {
    if (!map.has(iso)) map.set(iso, []);
    const list = map.get(iso);
    const found = list.find((x) => x.studioId === studio.id);
    if (found) {
      found.sources.push(source);
      if (!found.time && time) found.time = time;
      return;
    }
    list.push({ studioId: studio.id, studioName: studio.name, time: time || null, sources: [source] });
  };
  for (const r of cal?.rules || []) {
    if (r.deleted) continue;
    const s = usable(r.studioId);
    if (!s) continue;
    for (const iso of occurrences(r, from, to)) add(iso, s, timeFor(r, iso), { type: 'rule', id: r.id });
  }
  for (const d of cal?.days || []) {
    if (d.deleted || d.date < from || d.date > to) continue;
    const s = usable(d.studioId);
    if (s) add(d.date, s, d.time, { type: 'day', id: d.id });
  }
  for (const list of map.values()) list.sort(byTime);
  return map;
}

export function scheduleOn(cal, iso, opts) {
  return scheduleBetween(cal, iso, iso, opts).get(iso) || [];
}

export function hasSchedule(cal) {
  return (cal?.rules || []).some((r) => !r.deleted) || (cal?.days || []).some((d) => !d.deleted);
}

/** Giorni passati (prima di today) previsti e senza inserimenti per quello studio: [{date, studioId, studioName, time}]. */
export function missingDays({ cal, entries, from, to, today, studiosById }) {
  const last = to && to < today ? to : addDays(today, -1);
  if (!from || from > last) return [];
  const done = new Set((entries || []).map((e) => `${e.date}|${e.studioId}`));
  const out = [];
  const sched = scheduleBetween(cal, from, last, { studiosById });
  for (const iso of [...sched.keys()].sort()) {
    for (const item of sched.get(iso)) {
      if (!done.has(`${iso}|${item.studioId}`)) out.push({ date: iso, ...item });
    }
  }
  return out;
}

/** Prossimi giorni di lavoro da start (incluso): [{date, items}] al massimo limit giorni. */
export function upcomingDays(cal, start, { studiosById, limit = 7, horizon = 120 } = {}) {
  const sched = scheduleBetween(cal, start, addDays(start, horizon), { studiosById });
  return [...sched.keys()].sort().slice(0, limit).map((date) => ({ date, items: sched.get(date) }));
}

/** Prima data utile per calcolare il "tutto": la regola o il giorno singolo più vecchio. */
export function earliestDate(cal) {
  let min = null;
  for (const r of cal?.rules || []) if (!r.deleted && (!min || r.start < min)) min = r.start;
  for (const d of cal?.days || []) if (!d.deleted && (!min || d.date < min)) min = d.date;
  return min;
}

// ---------- descrizioni in italiano ----------
export function formatTime(time) {
  if (!time) return '';
  const t = (s) => s.replace(/^0(\d)/, '$1');
  // U+2060 (word joiner) attorno al trattino: l'orario non va mai a capo
  return `${t(time.from)}\u2060–\u2060${t(time.to)}`;
}

function joinIt(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

/** "Ogni martedì", "Ogni 2 settimane il giovedì", "Ogni mese il giorno 15", "Il primo lunedì del mese", "Ogni anno il 20 dicembre". */
export function describePattern(rule) {
  switch (rule.type) {
    case 'weekly': {
      const sorted = [...rule.weekdays].sort((a, b) => a - b);
      if (rule.interval === 1) return `Ogni ${joinIt(sorted.map((d) => WEEKDAYS_LONG[d - 1]))}`;
      const withArt = sorted.map((d) => `${d === 7 ? 'la' : 'il'} ${WEEKDAYS_LONG[d - 1]}`);
      return `Ogni ${rule.interval} settimane ${joinIt(withArt)}`;
    }
    case 'monthly-date':
      return `Ogni mese il giorno ${rule.monthDay}`;
    case 'monthly-pos': {
      const nth = NTH_LABELS[String(rule.nth)];
      const wd = WEEKDAYS_LONG[rule.weekday - 1];
      const art = rule.weekday === 7 ? (rule.nth === -1 ? "L'ultima" : `La ${nth.replace(/o$/, 'a')}`) : (rule.nth === -1 ? "L'ultimo" : `Il ${nth}`);
      return `${art} ${wd} del mese`;
    }
    case 'yearly':
      return `Ogni anno il ${rule.day} ${MONTHS_LONG[rule.month - 1]}`;
    default:
      return '';
  }
}

export function describeEnd(rule) {
  const end = rule.end || { type: 'never' };
  const since = `dal ${formatDateShort(rule.start)}`;
  if (end.type === 'until') return `${since} al ${formatDateShort(end.date)}`;
  if (end.type === 'count') return `${since}, ${end.count} ${end.count === 1 ? 'volta' : 'volte'}`;
  return since;
}

/** Orari della regola: "9–13" oppure, con orari per giorno, "lun 9–13, mer 14–19". */
export function describeTimes(rule) {
  if (!hasDayTimes(rule)) return formatTime(rule.time);
  const days = [...rule.weekdays].sort((a, b) => a - b);
  const times = days.map((d) => rule.dayTimes[String(d)] || rule.time || null);
  const key = (t) => (t ? `${t.from}-${t.to}` : '');
  if (times.every((t) => key(t) === key(times[0]))) return formatTime(times[0]);
  return days.map((d, i) => (times[i] ? `${WEEKDAYS_LONG[d - 1].slice(0, 3)} ${formatTime(times[i])}` : null))
    .filter(Boolean).join(', ');
}

/** Riga completa: "Ogni martedì · 9:00–13:00 · dal 1 set 2026". */
export function describeRule(rule) {
  return [describePattern(rule), describeTimes(rule), describeEnd(rule)].filter(Boolean).join(' · ');
}
