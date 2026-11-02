import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, rruleOf, icsText, foldLine } from '../js/ics.js';

const studios = { r: { id: 'r', name: 'Studio Rossi, sede 2' }, b: { id: 'b', name: 'Bianchi', archived: true } };
const base = { id: 'w', studioId: 'r', type: 'weekly', weekdays: [4, 2], interval: 1, start: '2026-09-02', end: { type: 'never' }, time: null, exdates: [] };

test('RRULE per ogni tipo di ripetizione', () => {
  assert.equal(rruleOf(base), 'FREQ=WEEKLY;BYDAY=TU,TH;WKST=MO');
  assert.equal(rruleOf({ ...base, interval: 2, end: { type: 'count', count: 5 } }), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=MO;COUNT=5');
  assert.equal(rruleOf({ ...base, type: 'monthly-date', monthDay: 15, end: { type: 'until', date: '2027-06-30' } }), 'FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20270630');
  assert.equal(rruleOf({ ...base, type: 'monthly-pos', nth: -1, weekday: 5 }), 'FREQ=MONTHLY;BYDAY=-1FR');
  assert.equal(rruleOf({ ...base, type: 'yearly', month: 12, day: 20 }), 'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=20');
  assert.equal(rruleOf({ ...base, time: { from: '09:00', to: '13:00' }, end: { type: 'until', date: '2027-06-30' } }), 'FREQ=WEEKLY;BYDAY=TU,TH;WKST=MO;UNTIL=20270630T235959');
});

test('calendario completo: eventi, prima data reale, date escluse, orari, studi archiviati esclusi', () => {
  const ics = buildIcs({
    rules: [{ ...base, exdates: ['2026-09-08'] }, { ...base, id: 't', time: { from: '09:00', to: '13:00' }, exdates: ['2026-09-10'] }, { ...base, id: 'x', studioId: 'b' }],
    days: [{ id: 'd', studioId: 'r', date: '2026-11-14', time: null }],
    studiosById: studios,
    now: Date.UTC(2026, 10, 2, 3, 4, 5),
  });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 3);
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20260903'), 'la prima data è il primo giovedì utile, non l\'inizio');
  assert.ok(lines.includes('DTEND;VALUE=DATE:20260904'));
  assert.ok(lines.includes('EXDATE;VALUE=DATE:20260908'));
  assert.ok(lines.includes('DTSTART:20260903T090000'));
  assert.ok(lines.includes('DTEND:20260903T130000'));
  assert.ok(lines.includes('EXDATE:20260910T090000'));
  assert.ok(lines.includes('SUMMARY:Studio Rossi\\, sede 2'));
  assert.ok(lines.includes('DTSTAMP:20261102T030405Z'));
  assert.ok(lines.includes('UID:d@dentalflow'));
  assert.ok(!ics.includes('UID:x@dentalflow'));
});

test('testo protetto e righe piegate a 75 byte', () => {
  assert.equal(icsText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const long = `SUMMARY:${'è'.repeat(60)}`;
  const folded = foldLine(long);
  for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75);
  assert.equal(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join(''), long);
});

test('orari diversi per giorno: un evento per orario, COUNT diventa UNTIL, date escluse sul giorno giusto', async () => {
  const { splitByTime } = await import('../js/ics.js');
  const r = {
    ...base, weekdays: [1, 3], start: '2026-11-02', end: { type: 'count', count: 4 },
    dayTimes: { 1: { from: '09:00', to: '13:00' }, 3: { from: '14:00', to: '19:00' } },
    exdates: ['2026-11-04'],
  };
  const parts = splitByTime(r);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.rule.weekdays), [[1], [3]]);
  // 4 volte: 2/11, 4/11, 9/11, 11/11 → fine al 11/11 per entrambi gli eventi
  assert.deepEqual(parts.map((p) => p.rule.end), [{ type: 'until', date: '2026-11-11' }, { type: 'until', date: '2026-11-11' }]);
  const ics = buildIcs({ rules: [r], studiosById: studios, now: Date.UTC(2026, 10, 2) });
  const lines = ics.split('\r\n');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.ok(lines.includes('DTSTART:20261102T090000'));
  assert.ok(lines.includes('DTEND:20261102T130000'));
  assert.ok(lines.includes('DTSTART:20261104T140000'));
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=MO;WKST=MO;UNTIL=20261111T235959'));
  assert.ok(lines.includes('RRULE:FREQ=WEEKLY;BYDAY=WE;WKST=MO;UNTIL=20261111T235959'));
  assert.ok(lines.includes('EXDATE:20261104T140000'), 'la data esclusa va solo sull\'evento del mercoledì');
  assert.equal(lines.filter((l) => l.startsWith('EXDATE')).length, 1);
  assert.equal(lines.filter((l) => l.startsWith('UID:')).length, new Set(lines.filter((l) => l.startsWith('UID:'))).size, 'UID distinti');
  // stesso orario su tutti i giorni: un solo evento, come prima
  const same = { ...r, end: { type: 'never' }, dayTimes: { 1: { from: '09:00', to: '13:00' }, 3: { from: '09:00', to: '13:00' } } };
  assert.equal(splitByTime(same).length, 1);
  assert.equal(splitByTime(same)[0].uid, 'w');
});
