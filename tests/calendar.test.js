import test from 'node:test';
import assert from 'node:assert/strict';
import {
  occurrences, ruleError, dayError, scheduleOn, scheduleBetween, missingDays, upcomingDays, describeRule, describePattern,
  firstMatch, hasSchedule, formatTime, CAL_MSG,
} from '../js/calendar.js';

const studios = {
  r: { id: 'r', name: 'Studio Rossi' },
  s: { id: 's', name: 'Clinica Sorriso' },
  b: { id: 'b', name: 'Studio Bianchi', archived: true },
};
const weekly = (o = {}) => ({ id: 'w', studioId: 'r', type: 'weekly', weekdays: [2], interval: 1, start: '2026-09-01', end: { type: 'never' }, time: null, exdates: [], ...o });

test('settimanale: ogni martedì dall\'inizio, mai prima', () => {
  assert.deepEqual(occurrences(weekly(), '2026-08-20', '2026-09-16'), ['2026-09-01', '2026-09-08', '2026-09-15']);
  assert.deepEqual(occurrences(weekly({ weekdays: [5, 2] }), '2026-09-01', '2026-09-07'), ['2026-09-01', '2026-09-04']);
});

test('settimanale ogni 2 settimane: il conteggio parte dalla settimana di inizio, anche a cavallo d\'anno', () => {
  const r = weekly({ weekdays: [4], interval: 2, start: '2026-12-17' });
  assert.deepEqual(occurrences(r, '2026-12-01', '2027-01-31'), ['2026-12-17', '2026-12-31', '2027-01-14', '2027-01-28']);
  // inizio di mercoledì: il giovedì della stessa settimana conta come prima occorrenza
  const w = weekly({ weekdays: [4], interval: 2, start: '2026-11-04' });
  assert.deepEqual(occurrences(w, '2026-11-01', '2026-11-30'), ['2026-11-05', '2026-11-19']);
});

test('ora legale: nessuna data persa o doppia', () => {
  const r = weekly({ weekdays: [7], start: '2026-03-01' });
  assert.deepEqual(occurrences(r, '2026-03-20', '2026-04-05'), ['2026-03-22', '2026-03-29', '2026-04-05']);
  assert.deepEqual(occurrences(weekly({ weekdays: [7], start: '2026-10-01' }), '2026-10-20', '2026-11-01'), ['2026-10-25', '2026-11-01']);
});

test('mensile per data: i mesi senza quel giorno vengono saltati', () => {
  const r = { ...weekly(), type: 'monthly-date', monthDay: 31, start: '2026-01-01' };
  assert.deepEqual(occurrences(r, '2026-01-01', '2026-06-30'), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('mensile per posizione: primo lunedì e ultimo venerdì', () => {
  const first = { ...weekly(), type: 'monthly-pos', nth: 1, weekday: 1, start: '2026-01-01' };
  assert.deepEqual(occurrences(first, '2026-01-01', '2026-03-31'), ['2026-01-05', '2026-02-02', '2026-03-02']);
  const last = { ...weekly(), type: 'monthly-pos', nth: -1, weekday: 5, start: '2026-01-01' };
  assert.deepEqual(occurrences(last, '2026-01-01', '2026-03-31'), ['2026-01-30', '2026-02-27', '2026-03-27']);
});

test('annuale: il 29 febbraio solo negli anni bisestili', () => {
  const r = { ...weekly(), type: 'yearly', month: 2, day: 29, start: '2025-01-01' };
  assert.deepEqual(occurrences(r, '2025-01-01', '2032-12-31'), ['2028-02-29', '2032-02-29']);
  const xmas = { ...weekly(), type: 'yearly', month: 12, day: 20, start: '2026-01-01' };
  assert.deepEqual(occurrences(xmas, '2026-01-01', '2027-12-31'), ['2026-12-20', '2027-12-20']);
});

test('fine: fino al, dopo N volte (contate dall\'inizio, escluse comprese), date escluse', () => {
  assert.deepEqual(occurrences(weekly({ end: { type: 'until', date: '2026-09-08' } }), '2026-09-01', '2026-12-31'), ['2026-09-01', '2026-09-08']);
  const count = weekly({ end: { type: 'count', count: 3 }, exdates: ['2026-09-08'] });
  assert.deepEqual(occurrences(count, '2026-09-01', '2026-12-31'), ['2026-09-01', '2026-09-15']);
  assert.deepEqual(occurrences(count, '2026-09-10', '2026-12-31'), ['2026-09-15']);
  assert.deepEqual(occurrences(weekly({ exdates: ['2026-09-08'] }), '2026-09-01', '2026-09-15'), ['2026-09-01', '2026-09-15']);
  assert.equal(firstMatch(weekly({ exdates: ['2026-09-01'] })), '2026-09-01');
});

test('validazione delle regole e dei giorni', () => {
  assert.equal(ruleError(weekly()), null);
  assert.equal(ruleError(weekly({ weekdays: [] })), CAL_MSG.weekdays);
  assert.equal(ruleError(weekly({ weekdays: [8] })), CAL_MSG.weekdays);
  assert.equal(ruleError(weekly({ interval: 0 })), CAL_MSG.interval);
  assert.equal(ruleError(weekly({ start: '2026-02-30' })), CAL_MSG.start);
  assert.equal(ruleError(weekly({ end: { type: 'until', date: '2026-08-01' } })), CAL_MSG.until);
  assert.equal(ruleError(weekly({ end: { type: 'count', count: 0 } })), CAL_MSG.count);
  assert.equal(ruleError(weekly({ time: { from: '13:00', to: '09:00' } })), CAL_MSG.time);
  assert.equal(ruleError(weekly({ time: { from: '09:00', to: '13:00' } })), null);
  assert.equal(ruleError(weekly({ studioId: '' })), CAL_MSG.studio);
  assert.equal(ruleError({ ...weekly(), type: 'monthly-date', monthDay: 32 }), CAL_MSG.monthDay);
  assert.equal(ruleError({ ...weekly(), type: 'monthly-pos', nth: 5, weekday: 1 }), CAL_MSG.nth);
  assert.equal(ruleError({ ...weekly(), type: 'yearly', month: 2, day: 30 }), CAL_MSG.yearDay);
  assert.equal(ruleError({ ...weekly(), type: 'yearly', month: 2, day: 29 }), null);
  assert.equal(ruleError({ ...weekly(), type: 'boh' }), CAL_MSG.type);
  assert.equal(dayError({ studioId: 'r', date: '2026-11-14', time: null }), null);
  assert.equal(dayError({ studioId: 'r', date: '2026-13-01' }), CAL_MSG.date);
});

test('più studi nello stesso giorno: prima chi ha l\'orario più presto, poi per nome; studi archiviati esclusi', () => {
  const cal = {
    rules: [
      weekly({ id: 'a', studioId: 'r', time: { from: '14:00', to: '18:00' } }),
      weekly({ id: 'c', studioId: 'b' }),
    ],
    days: [{ id: 'd1', studioId: 's', date: '2026-09-08', time: { from: '09:00', to: '13:00' } }, { id: 'd2', studioId: 'r', date: '2026-09-08', time: null }],
  };
  const list = scheduleOn(cal, '2026-09-08', { studiosById: studios });
  assert.deepEqual(list.map((x) => x.studioId), ['s', 'r']);
  assert.deepEqual(list[1].sources.map((x) => x.type), ['rule', 'day']);
  assert.deepEqual(scheduleOn(cal, '2026-09-15', { studiosById: studios }).map((x) => x.studioId), ['r']);
  const noTime = { rules: [weekly({ id: 'x', studioId: 's' }), weekly({ id: 'y', studioId: 'r' })], days: [] };
  assert.deepEqual(scheduleOn(noTime, '2026-09-08', { studiosById: studios }).map((x) => x.studioName), ['Clinica Sorriso', 'Studio Rossi']);
  assert.equal(hasSchedule({ rules: [], days: [] }), false);
  assert.equal(scheduleBetween(cal, '2026-09-01', '2026-09-30', { studiosById: studios }).size, 5);
});

test('giorni mancanti: solo giorni passati, per studio, dalla data di inizio', () => {
  const cal = { rules: [weekly({ studioId: 'r' }), weekly({ id: 'w2', studioId: 's', weekdays: [4], start: '2026-09-01' })], days: [] };
  const entries = [{ date: '2026-09-01', studioId: 'r' }, { date: '2026-09-03', studioId: 'r' }];
  const miss = missingDays({ cal, entries, from: '2026-08-01', to: '2026-09-30', today: '2026-09-08', studiosById: studios });
  assert.deepEqual(miss.map((m) => `${m.date} ${m.studioId}`), ['2026-09-03 s']);
  assert.deepEqual(missingDays({ cal, entries, from: '2026-09-10', to: '2026-09-30', today: '2026-09-08', studiosById: studios }), []);
});

test('prossimi giorni di lavoro', () => {
  const cal = { rules: [weekly()], days: [{ id: 'd', studioId: 's', date: '2026-09-02', time: null }] };
  const next = upcomingDays(cal, '2026-09-01', { studiosById: studios, limit: 3 });
  assert.deepEqual(next.map((d) => d.date), ['2026-09-01', '2026-09-02', '2026-09-08']);
});

test('descrizioni in italiano', () => {
  assert.equal(describePattern(weekly()), 'Ogni martedì');
  assert.equal(describePattern(weekly({ weekdays: [5, 2] })), 'Ogni martedì e venerdì');
  assert.equal(describePattern(weekly({ weekdays: [4], interval: 2 })), 'Ogni 2 settimane il giovedì');
  assert.equal(describePattern(weekly({ weekdays: [7], interval: 2 })), 'Ogni 2 settimane la domenica');
  assert.equal(describePattern({ type: 'monthly-date', monthDay: 15 }), 'Ogni mese il giorno 15');
  assert.equal(describePattern({ type: 'monthly-pos', nth: 1, weekday: 1 }), 'Il primo lunedì del mese');
  assert.equal(describePattern({ type: 'monthly-pos', nth: -1, weekday: 5 }), "L'ultimo venerdì del mese");
  assert.equal(describePattern({ type: 'monthly-pos', nth: 1, weekday: 7 }), 'La prima domenica del mese');
  assert.equal(describePattern({ type: 'yearly', month: 12, day: 20 }), 'Ogni anno il 20 dicembre');
  assert.equal(describeRule(weekly({ time: { from: '09:00', to: '13:00' } })), 'Ogni martedì · 9:00\u2060–\u206013:00 · dal 1\u00a0set\u00a02026');
  assert.equal(describeRule(weekly({ end: { type: 'count', count: 10 } })), 'Ogni martedì · dal 1\u00a0set\u00a02026, 10 volte');
  assert.equal(formatTime({ from: '14:30', to: '18:00' }), '14:30\u2060–\u206018:00');
  assert.equal(describeRule(weekly({ end: { type: 'until', date: '2026-12-31' } })), 'Ogni martedì · dal 1\u00a0set\u00a02026 al 31\u00a0dic\u00a02026');
});

test('settimanale con orario diverso per ogni giorno (dayTimes)', async () => {
  const { timeFor, describeTimes, describeEnd } = await import('../js/calendar.js');
  const r = weekly({
    weekdays: [1, 3], start: '2026-11-02',
    dayTimes: { 1: { from: '09:00', to: '13:00' }, 3: { from: '14:00', to: '19:00' } },
  });
  assert.equal(ruleError(r), null);
  assert.deepEqual(timeFor(r, '2026-11-02'), { from: '09:00', to: '13:00' });
  assert.deepEqual(timeFor(r, '2026-11-04'), { from: '14:00', to: '19:00' });
  const sched = scheduleBetween({ rules: [r], days: [] }, '2026-11-02', '2026-11-08', { studiosById: studios });
  assert.deepEqual(sched.get('2026-11-02')[0].time, { from: '09:00', to: '13:00' });
  assert.deepEqual(sched.get('2026-11-04')[0].time, { from: '14:00', to: '19:00' });
  assert.equal(describeTimes(r), 'lun 9:00\u2060–\u206013:00, mer 14:00\u2060–\u206019:00');
  assert.equal(describeRule(r), 'Ogni lunedì e mercoledì · lun 9:00\u2060–\u206013:00, mer 14:00\u2060–\u206019:00 · ' + describeEnd(r));
  // stesso orario su tutti i giorni: una sola indicazione
  const same = weekly({ weekdays: [1, 3], dayTimes: { 1: { from: '09:00', to: '13:00' }, 3: { from: '09:00', to: '13:00' } } });
  assert.equal(describeTimes(same), '9:00\u2060–\u206013:00');
  // un giorno senza orario: per quel giorno vale l'orario generale (qui nessuno)
  assert.equal(timeFor(weekly({ weekdays: [1, 3], dayTimes: { 1: { from: '09:00', to: '13:00' } } }), '2026-11-04'), null);
});

test('dayTimes non validi vengono rifiutati', () => {
  assert.equal(ruleError(weekly({ weekdays: [1], dayTimes: { 3: { from: '09:00', to: '13:00' } } })), CAL_MSG.time, 'giorno non scelto');
  assert.equal(ruleError(weekly({ weekdays: [1], dayTimes: { 1: { from: '13:00', to: '09:00' } } })), CAL_MSG.time, 'fine prima dell\'inizio');
  assert.equal(ruleError(weekly({ weekdays: [1], dayTimes: { 1: { from: '09:00' } } })), CAL_MSG.time, 'orario a metà');
  assert.equal(ruleError(weekly({ weekdays: [1], dayTimes: [] })), CAL_MSG.time);
  assert.equal(ruleError({ ...weekly(), type: 'monthly-date', monthDay: 5, dayTimes: { 1: { from: '09:00', to: '13:00' } } }), CAL_MSG.time);
  assert.equal(ruleError(weekly({ dayTimes: null })), null, 'null equivale ad assente');
});
