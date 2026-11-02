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
