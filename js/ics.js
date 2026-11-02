// Esportazione del calendario di lavoro in formato iCalendar (.ics, RFC 5545). Funzioni pure.
import { addDays } from './dates.js';
import { firstMatch, describePattern, hasDayTimes, occurrences } from './calendar.js';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const lookup = (byId, id) => (byId instanceof Map ? byId.get(id) : byId?.[id]);

/** Testo con i caratteri speciali di iCalendar protetti. */
export function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Piega le righe oltre 75 byte (UTF-8) come richiesto dallo standard. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  for (const ch of line) {
    const len = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curLen + len > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
    cur += ch;
    curLen += len;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compact = (iso) => iso.replace(/-/g, '');
const hhmm = (t) => t.replace(':', '');

function stampUTC(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** RRULE della regola (senza "RRULE:"). */
export function rruleOf(rule) {
  const parts = [];
  if (rule.type === 'weekly') {
    parts.push('FREQ=WEEKLY');
    if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
    parts.push(`BYDAY=${[...rule.weekdays].sort((a, b) => a - b).map((d) => BYDAY[d - 1]).join(',')}`);
    parts.push('WKST=MO');
  } else if (rule.type === 'monthly-date') {
    parts.push('FREQ=MONTHLY', `BYMONTHDAY=${rule.monthDay}`);
  } else if (rule.type === 'monthly-pos') {
    parts.push('FREQ=MONTHLY', `BYDAY=${rule.nth}${BYDAY[rule.weekday - 1]}`);
  } else if (rule.type === 'yearly') {
    parts.push('FREQ=YEARLY', `BYMONTH=${rule.month}`, `BYMONTHDAY=${rule.day}`);
  }
  const end = rule.end || { type: 'never' };
  if (end.type === 'until') parts.push(`UNTIL=${compact(end.date)}${rule.time ? 'T235959' : ''}`);
  else if (end.type === 'count') parts.push(`COUNT=${end.count}`);
  return parts.join(';');
}

/**
 * Una regola settimanale con orari diversi per giorno diventa un evento per ogni orario
 * (es. lunedì 9–13 e mercoledì 14–19 sono due eventi). Con "Dopo N volte" la fine diventa
 * la data dell'ultima occorrenza, perché il conteggio vale per la regola intera.
 */
export function splitByTime(rule) {
  if (!hasDayTimes(rule)) return [{ uid: rule.id, rule }];
  const groups = new Map();
  for (const d of [...rule.weekdays].sort((a, b) => a - b)) {
    const t = rule.dayTimes[String(d)] || rule.time || null;
    const key = t ? `${t.from}-${t.to}` : '';
    if (!groups.has(key)) groups.set(key, { time: t, weekdays: [] });
    groups.get(key).weekdays.push(d);
  }
  if (groups.size === 1) {
    const [g] = groups.values();
    return [{ uid: rule.id, rule: { ...rule, time: g.time, dayTimes: undefined } }];
  }
  let end = rule.end || { type: 'never' };
  if (end.type === 'count') {
    const horizon = 7 * (rule.interval || 1) * end.count + 14;
    const all = occurrences({ ...rule, exdates: [] }, rule.start, addDays(rule.start, horizon));
    end = { type: 'until', date: all[all.length - 1] || rule.start };
  }
  return [...groups.values()].map((g) => ({
    uid: `${rule.id}-${g.weekdays.join('')}`,
    rule: { ...rule, weekdays: g.weekdays, time: g.time, dayTimes: undefined, end },
  }));
}

function timing(date, time) {
  if (time) {
    return [`DTSTART:${compact(date)}T${hhmm(time.from)}00`, `DTEND:${compact(date)}T${hhmm(time.to)}00`];
  }
  return [`DTSTART;VALUE=DATE:${compact(date)}`, `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`];
}

/**
 * Calendario con un evento ricorrente per regola e un evento per giorno singolo.
 * Orari "fluttuanti" (ora locale del telefono); senza orario l'evento dura tutto il giorno.
 * Solo studi esistenti e non archiviati.
 */
export function buildIcs({ rules = [], days = [], studiosById, now = Date.now() }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DentalFlow//Calendario di lavoro//IT', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${icsText('DentalFlow · lavoro')}`];
  const stamp = stampUTC(now);
  const usable = (sid) => {
    const s = lookup(studiosById, sid);
    return s && !s.archived && !s.deleted ? s : null;
  };
  for (const r of rules) {
    if (r.deleted) continue;
    const s = usable(r.studioId);
    if (!s) continue;
    for (const part of splitByTime(r)) {
      const first = firstMatch(part.rule);
      if (!first) continue;
      const time = part.rule.time;
      lines.push('BEGIN:VEVENT', `UID:${part.uid}@dentalflow`, `DTSTAMP:${stamp}`, ...timing(first, time),
        `RRULE:${rruleOf(part.rule)}`);
      const ex = (r.exdates || []).filter((d) => d >= first && occurrences({ ...part.rule, exdates: [] }, d, d).length).sort();
      if (ex.length) {
        lines.push(time
          ? `EXDATE:${ex.map((d) => `${compact(d)}T${hhmm(time.from)}00`).join(',')}`
          : `EXDATE;VALUE=DATE:${ex.map(compact).join(',')}`);
      }
      lines.push(`SUMMARY:${icsText(s.name)}`, `DESCRIPTION:${icsText(`${describePattern(r)} · DentalFlow`)}`, 'TRANSP:OPAQUE', 'END:VEVENT');
    }
  }
  for (const d of days) {
    if (d.deleted) continue;
    const s = usable(d.studioId);
    if (!s) continue;
    lines.push('BEGIN:VEVENT', `UID:${d.id}@dentalflow`, `DTSTAMP:${stamp}`, ...timing(d.date, d.time),
      `SUMMARY:${icsText(s.name)}`, `DESCRIPTION:${icsText('Giorno singolo · DentalFlow')}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
