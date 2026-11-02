import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, ranking, trendSeries, pctTenths, MISSING_STUDIO, MISSING_TREATMENT } from '../js/aggregate.js';

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
