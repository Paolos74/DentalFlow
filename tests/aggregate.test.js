import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, ranking, trendSeries, pctTenths, MISSING_STUDIO, MISSING_TREATMENT, kpis, changeTenths, perPatient,
  yearRecap, usageOrder, unpaidByStudio, daysByStudio, paymentMonths,
} from '../js/aggregate.js';

const studiosById = { a: { id: 'a', name: 'Studio A' }, b: { id: 'b', name: 'Studio B', archived: true } };
const treatmentsById = { t1: { id: 't1', name: 'Igiene' }, t2: { id: 't2', name: 'Sbiancamento' } };
let n = 0;
const e = (date, studioId, treatmentId, patients, amountCents) => ({ id: `e${++n}`, date, studioId, treatmentId, patients, amountCents, createdAt: n });

test('summarize: totali esatti in centesimi, per trattamento e per studio', () => {
  const entries = [
    ...Array.from({ length: 10 }, () => e('2026-02-01', 'a', 't1', 1, 10)),
    e('2026-02-02', 'b', 't2', 2, 3333),
    e('2026-02-03', 'a', 't2', 1, 1),
  ];
  const s = summarize(entries, { studiosById, treatmentsById });
  assert.equal(s.totalCents, 100 + 3333 + 1);
  assert.equal(s.totalPatients, 13);
  assert.deepEqual(s.byTreatment.map((r) => [r.name, r.patients, r.cents]), [['Sbiancamento', 3, 3334], ['Igiene', 10, 100]]);
  assert.equal(s.byTreatment[0].pctTenths, pctTenths(3334, 3434));
  assert.deepEqual(s.byStudio.map((r) => [r.name, r.patients, r.cents, r.archived]), [['Studio B', 2, 3333, true], ['Studio A', 11, 101, false]]);
  const onlyA = summarize(entries.filter((x) => x.studioId === 'a'), { studiosById, treatmentsById });
  assert.equal(onlyA.totalCents, 101);
});

test('summarize: input vuoto e nomi mancanti', () => {
  const empty = summarize([], { studiosById, treatmentsById });
  assert.deepEqual(empty, { byTreatment: [], byStudio: [], totalPatients: 0, totalCents: 0 });
  const s = summarize([e('2026-01-01', 'zz', 'tt', 1, 100)], { studiosById, treatmentsById });
  assert.equal(s.byTreatment[0].name, MISSING_TREATMENT);
  assert.equal(s.byStudio[0].name, MISSING_STUDIO);
});

test('importi tutti a zero: percentuali 0 e niente NaN', () => {
  const s = summarize([e('2026-01-01', 'a', 't1', 1, 0), e('2026-01-02', 'a', 't2', 3, 0)], { studiosById, treatmentsById });
  for (const r of s.byTreatment) assert.equal(r.pctTenths, 0);
  const r = ranking([e('2026-01-01', 'a', 't1', 1, 0)], { measure: 'euro', treatmentsById });
  assert.equal(r[0].pctTenths, 0);
  assert.ok(!JSON.stringify(s).includes('NaN'));
});

test('ranking: ordinamento per valore, poi nome, poi id', () => {
  const tb = { x2: { name: 'Beta' }, x1: { name: 'Beta' }, y: { name: 'Alfa' }, z: { name: 'Zeta' } };
  const r = ranking([
    e('2026-01-01', 'a', 'x2', 1, 100), e('2026-01-01', 'a', 'x1', 1, 100),
    e('2026-01-01', 'a', 'y', 1, 100), e('2026-01-01', 'a', 'z', 1, 500),
  ], { measure: 'euro', treatmentsById: tb });
  assert.deepEqual(r.map((x) => x.treatmentId), ['z', 'y', 'x1', 'x2']);
  const p = ranking([e('2026-01-01', 'a', 'y', 5, 1), e('2026-01-01', 'a', 'z', 1, 500)], { measure: 'pazienti', treatmentsById: tb });
  assert.deepEqual(p.map((x) => [x.treatmentId, x.value]), [['y', 5], ['z', 1]]);
});

test('trendSeries: totale e top 7 + Altri', () => {
  const tot = trendSeries([e('2026-01-05', 'a', 't1', 1, 100), e('2026-03-05', 'a', 't1', 2, 250)],
    { from: '2026-01-01', to: '2026-03-31', granularity: 'mese', measure: 'euro', mode: 'totale', treatmentsById });
  assert.deepEqual(tot.keys, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(tot.labels, ['gen 2026', 'feb 2026', 'mar 2026']);
  assert.deepEqual(tot.series, [{ name: 'Totale', values: [100, 0, 250] }]);

  const tb = {};
  const entries = [];
  for (let i = 1; i <= 9; i++) {
    tb[`t${i}`] = { name: `T${i}` };
    entries.push(e('2026-01-10', 'a', `t${i}`, 1, i * 100));
    entries.push(e('2026-02-10', 'a', `t${i}`, 1, i * 10));
  }
  const tr = trendSeries(entries, { from: '2026-01-01', to: '2026-02-28', granularity: 'mese', measure: 'euro', mode: 'trattamento', treatmentsById: tb });
  assert.equal(tr.series.length, 8);
  assert.equal(tr.series[0].name, 'T9');
  assert.equal(tr.series[7].name, 'Altri');
  assert.deepEqual(tr.series[7].values, [100 + 200, 10 + 20]);
  assert.ok(tr.series.every((s) => !('color' in s)));
});

test('numeri chiave e variazioni', () => {
  const k = kpis([e('2026-03-01', 'a', 't1', 3, 9000), e('2026-03-01', 'b', 't1', 1, 1000), e('2026-03-05', 'a', 't2', 2, 5000)]);
  assert.deepEqual(k, { cents: 15000, patients: 6, days: 2, entries: 3, perPatient: 2500, perDay: 7500 });
  assert.deepEqual(kpis([]), { cents: 0, patients: 0, days: 0, entries: 0, perPatient: 0, perDay: 0 });
  assert.equal(changeTenths(110, 100), 100);
  assert.equal(changeTenths(90, 100), -100);
  assert.equal(changeTenths(5, 0), null);
  assert.equal(perPatient(1000, 3), 333);
});

test('trendSeries: per studio, media per paziente, confronto con l\'anno prima', () => {
  const entries = [e('2026-01-10', 'a', 't1', 2, 1000), e('2026-01-12', 'b', 't1', 1, 3000), e('2026-02-10', 'a', 't1', 4, 2000)];
  const by = trendSeries(entries, { from: '2026-01-01', to: '2026-02-28', granularity: 'mese', mode: 'studio', studiosById, treatmentsById });
  assert.deepEqual(by.series, [
    { name: 'Studio A', studioId: 'a', values: [1000, 2000] },
    { name: 'Studio B', studioId: 'b', values: [3000, 0] },
  ], 'a pari incasso, in ordine di nome');
  const media = trendSeries(entries, { from: '2026-01-01', to: '2026-02-28', granularity: 'mese', measure: 'media', treatmentsById });
  assert.deepEqual(media.series[0].values, [Math.round(4000 / 3), 500]);
  const prev = [e('2025-01-20', 'a', 't1', 1, 700), e('2025-02-28', 'a', 't1', 1, 300), e('2024-12-31', 'a', 't1', 1, 999)];
  const cmp = trendSeries(entries, { from: '2026-01-01', to: '2026-02-28', granularity: 'mese', compareEntries: prev, treatmentsById });
  assert.deepEqual(cmp.series[1], { name: 'Anno prima', values: [700, 300], dashed: true });
  const r = ranking(entries, { measure: 'media', treatmentsById });
  assert.equal(r[0].value, Math.round(6000 / 7));
});

test('recap dell\'anno, ordine d\'uso, da incassare', () => {
  const cur = [e('2026-03-01', 'a', 't1', 3, 9000), e('2026-05-01', 'a', 't2', 1, 20000), e('2026-05-02', 'a', 't1', 2, 100)];
  const r = yearRecap(cur, [e('2025-03-01', 'a', 't1', 1, 14550)], { treatmentsById });
  assert.equal(r.totalCents, 29100);
  assert.equal(r.changeTenths, 1000);
  assert.deepEqual(r.bestMonth, { month: '2026-05', cents: 20100, patients: 3 });
  assert.deepEqual(r.topTreatment, { treatmentId: 't1', name: 'Igiene', patients: 5 });
  const order = usageOrder([{ id: 't1', name: 'Igiene' }, { id: 't2', name: 'Sbiancamento' }, { id: 't3', name: 'Altro' }],
    [e('2026-05-01', 'a', 't2', 1, 1), e('2026-05-02', 'a', 't2', 1, 1), e('2026-05-02', 'a', 't1', 1, 1), e('2026-05-02', 'b', 't1', 1, 1), e('2025-01-01', 'a', 't1', 1, 1)],
    { studioId: 'a', since: '2026-01-01' });
  assert.deepEqual(order.map((t) => t.id), ['t2', 't1', 't3']);
  const due = unpaidByStudio(cur, [{ month: '2026-03', studioId: 'a', paid: true }, { month: '2026-05', studioId: 'a', paid: false }]);
  assert.equal(due.get('a'), 20100);
  assert.deepEqual([...daysByStudio(cur)], [['a', 3]]);
});

test('da incassare su più mesi: totale per studio e mesi con prima quelli non pagati', () => {
  const list = [
    e('2026-09-03', 'a', 't1', 2, 6000), e('2026-09-20', 'a', 't1', 1, 3000),
    e('2026-10-07', 'a', 't1', 3, 9000),
    e('2026-11-04', 'a', 't2', 1, 15000),
    e('2026-10-08', 'b', 't1', 1, 2500),
  ];
  const pay = [{ month: '2026-10', studioId: 'a', paid: true }, { month: '2026-09', studioId: 'b', paid: true }, { month: '2026-11', studioId: 'a', paid: false }];
  const due = unpaidByStudio(list, pay);
  assert.equal(due.get('a'), 9000 + 15000, 'settembre e novembre, non ottobre (pagato)');
  assert.equal(due.get('b'), 2500, 'il pagamento di un altro mese non conta');
  assert.deepEqual(paymentMonths(list, pay, 'a'), [
    { month: '2026-11', cents: 15000, patients: 1, paid: false },
    { month: '2026-09', cents: 9000, patients: 3, paid: false },
    { month: '2026-10', cents: 9000, patients: 3, paid: true },
  ]);
  assert.deepEqual(paymentMonths(list, pay, 'b').map((m) => [m.month, m.paid]), [['2026-10', false]]);
  assert.deepEqual(paymentMonths(list, pay, 'zzz'), []);
});
