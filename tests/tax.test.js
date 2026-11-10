import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forfettario, acconti, scadenze, yearCompensi, yearBolli, yearExcluded, normalizeTaxParams, TAX_DEFAULTS, rateForYear, lastStartupYear,
} from '../js/tax.js';

test('forfettario 2026: 30.000 € di compensi e 12 marche da bollo', () => {
  const s = forfettario({ compensiCents: 3000000, bolli: 12, params: { ...TAX_DEFAULTS, rate: 1500 } });
  assert.equal(s.bolloCents, 2400);
  assert.equal(s.ricavi, 3002400); // 30.024,00
  assert.equal(s.reddito, 2341872); // × 78 % = 23.418,72
  assert.equal(s.contributi, 610526); // × 26,07 % = 6.105,26
  assert.equal(s.imponibile, 1731346); // 17.313,46
  assert.equal(s.imposta, 259702); // × 15 % = 2.597,02
  assert.equal(s.totale, 870228);
  assert.equal(s.netto, 2132172);
  assert.equal(s.shareTenths, 290); // 29,0 %
  assert.equal(s.onRedditoTenths, 372); // 37,2 % del reddito
  assert.equal(s.soglia, null);
});

test('predefiniti: imposta al 5 %; peso sul reddito 29,8 % e sui ricavi 23,2 %', () => {
  assert.equal(TAX_DEFAULTS.rate, 500);
  const s = forfettario({ compensiCents: 1000000 });
  assert.equal(s.reddito, 780000);
  assert.equal(s.contributi, 203346); // 26,07 %
  assert.equal(s.imposta, 28833); // 5 % di 576.654
  assert.equal(s.onRedditoTenths, 298);
  assert.equal(s.shareTenths, 232);
});

test('aliquote alternative: 24 % INPS e 5 % start-up', () => {
  const s = forfettario({ compensiCents: 1000000, params: { ...TAX_DEFAULTS, inps: 2400, rate: 500 } });
  assert.equal(s.reddito, 780000);
  assert.equal(s.contributi, 187200);
  assert.equal(s.imponibile, 592800);
  assert.equal(s.imposta, 29640);
});

test('soglie del forfettario: 85.000 € e 100.000 €', () => {
  assert.equal(forfettario({ compensiCents: 8500000 }).soglia, null);
  assert.equal(forfettario({ compensiCents: 8500001 }).soglia, 'superata');
  assert.equal(forfettario({ compensiCents: 8499900, bolli: 1 }).soglia, 'superata', 'le marche da bollo contano per la soglia');
  assert.equal(forfettario({ compensiCents: 10000001 }).soglia, 'uscita');
});

test('anno senza compensi: tutto a zero, nessuna divisione per zero', () => {
  const s = forfettario({ compensiCents: 0 });
  assert.equal(s.totale, 0);
  assert.equal(s.shareTenths, 0);
  assert.deepEqual(acconti(s), { imposta: [0, 0], contributi: [0, 0] });
});

test('acconti dell\'imposta: soglie 51,65 € e 257,52 €; contributi all\'80 %', () => {
  assert.deepEqual(acconti({ imposta: 5164, contributi: 0 }).imposta, [0, 0]);
  assert.deepEqual(acconti({ imposta: 5165, contributi: 0 }).imposta, [0, 5165]);
  assert.deepEqual(acconti({ imposta: 25752, contributi: 0 }).imposta, [0, 25752]);
  assert.deepEqual(acconti({ imposta: 100000, contributi: 0 }).imposta, [40000, 60000]);
  assert.deepEqual(acconti({ imposta: 0, contributi: 100001 }).contributi, [40000, 40000]);
});

test('scadenze: primo anno senza acconti versati, anno dopo con saldo e credito', () => {
  const y1 = forfettario({ compensiCents: 3000000 });
  const first = scadenze(2026, y1, null);
  assert.equal(first.giugno.date, '2027-06-30');
  assert.equal(first.novembre.date, '2027-11-30');
  assert.equal(first.giugno.saldoImposta, y1.imposta);
  assert.equal(first.giugno.totale, y1.imposta + y1.contributi + acconti(y1).imposta[0] + acconti(y1).contributi[0]);
  // anno successivo con compensi molto più bassi: gli acconti versati superano il dovuto → credito
  const y2 = forfettario({ compensiCents: 200000 });
  const second = scadenze(2027, y2, y1);
  assert.ok(second.giugno.saldoImposta < 0 && second.giugno.saldoContributi < 0);
  assert.equal(second.giugno.totale, 0);
  assert.ok(second.giugno.credito > 0);
});

test('compensi e marche da bollo dell\'anno', () => {
  const entries = [
    { date: '2026-01-02', amountCents: 1000 }, { date: '2026-12-31', amountCents: 500 },
    { date: '2025-12-31', amountCents: 9999 }, { date: '2026-05-05', amountCents: 7, deleted: true },
  ];
  assert.equal(yearCompensi(entries, 2026), 1500);
  const pays = [
    { month: '2026-01', paid: true, bollo: true }, { month: '2026-02', paid: true },
    { month: '2026-03', paid: false, bollo: true }, { month: '2025-12', paid: true, bollo: true },
  ];
  assert.equal(yearBolli(pays, 2026), 1);
});

test('parametri: valori fuori limite tornano ai predefiniti', () => {
  assert.deepEqual(normalizeTaxParams({ coeff: 7800, inps: 99999, rate: 500, bollo: -1, openDate: '2026-13-01' }), { coeff: 7800, inps: 2607, rate: 500, bollo: 200, openDate: null, excluded: [], fixedPct: null, declared: {} });
  assert.deepEqual(normalizeTaxParams(null), { ...TAX_DEFAULTS, excluded: [] });
});

test('apertura della partita IVA: 5 % nell\'anno di apertura e nei 4 successivi, poi 15 %', () => {
  const p = { ...TAX_DEFAULTS, openDate: '2024-09-15', rate: 1500 };
  assert.equal(lastStartupYear(p), 2028);
  assert.equal(rateForYear(p, 2024), 500);
  assert.equal(rateForYear(p, 2028), 500);
  assert.equal(rateForYear(p, 2029), 1500);
  // senza data vale l'aliquota scelta
  assert.equal(rateForYear({ ...TAX_DEFAULTS, rate: 1500 }, 2029), 1500);
  assert.equal(lastStartupYear(TAX_DEFAULTS), null);
  // la stima dell'anno usa l'aliquota di quell'anno
  assert.equal(forfettario({ compensiCents: 1000000, params: p, year: 2028 }).rate, 500);
  const after = forfettario({ compensiCents: 1000000, params: p, year: 2029 });
  assert.equal(after.rate, 1500);
  assert.equal(after.imposta, 86498); // 15 % di 576.654
});

test('trattamenti esclusi dal calcolo: fuori dai compensi, elencati a parte, parametro normalizzato', () => {
  const entries = [
    { date: '2026-03-01', treatmentId: 'a', amountCents: 10000 },
    { date: '2026-03-02', treatmentId: 'b', amountCents: 2500 },
    { date: '2026-04-02', treatmentId: 'b', amountCents: 500 },
    { date: '2025-04-02', treatmentId: 'b', amountCents: 999 },
  ];
  assert.equal(yearCompensi(entries, 2026), 13000);
  assert.equal(yearCompensi(entries, 2026, ['b']), 10000);
  assert.deepEqual([...yearExcluded(entries, 2026, ['b'])], [['b', 3000]]);
  assert.deepEqual(yearExcluded(entries, 2026, []).size, 0);
  assert.deepEqual(normalizeTaxParams({ excluded: ['b', 'a', 'b', '', 3] }).excluded, ['a', 'b']);
  assert.deepEqual(normalizeTaxParams({ excluded: 'x' }).excluded, []);
});

test('esclusioni mensili dagli Incassi: sommate per anno, solo valori validi', async () => {
  const { yearPaymentExclusions } = await import('../js/tax.js');
  const pays = [
    { month: '2026-10', excludedCents: 20000 }, { month: '2026-11', excludedCents: 500 },
    { month: '2025-12', excludedCents: 9999 }, { month: '2026-09', excludedCents: 100, deleted: true },
    { month: '2026-08' }, { month: '2026-07', excludedCents: -5 },
  ];
  assert.equal(yearPaymentExclusions(pays, 2026), 20500);
  assert.equal(yearPaymentExclusions(pays, 2025), 9999);
});

test('percentuale fissa da mettere da parte: sostituisce il calcolo nei numeri principali', async () => {
  const { fixedShare } = await import('../js/tax.js');
  const s = forfettario({ compensiCents: 3000000 });
  assert.equal(fixedShare(s, TAX_DEFAULTS), null);
  const f = fixedShare(s, { ...TAX_DEFAULTS, fixedPct: 3200 });
  assert.deepEqual(f, { pct: 3200, totale: 960000, netto: 2040000, shareTenths: 320 });
  assert.equal(normalizeTaxParams({ fixedPct: 0 }).fixedPct, null);
  assert.equal(normalizeTaxParams({ fixedPct: 9500 }).fixedPct, null);
  assert.equal(normalizeTaxParams({ fixedPct: 3250 }).fixedPct, 3250);
});

test('tasse vere dell\'anno prima: sostituiscono la stima negli acconti versati', async () => {
  const { declaredFor } = await import('../js/tax.js');
  const p = normalizeTaxParams({ declared: { 2025: { imposta: 50000, contributi: 600000 }, 1800: { imposta: 1, contributi: 1 }, 2024: { imposta: -1, contributi: 0 } } });
  assert.deepEqual(Object.keys(p.declared), ['2025']);
  assert.deepEqual(declaredFor(p, 2025), { imposta: 50000, contributi: 600000 });
  assert.equal(declaredFor(p, 2026), null);
  const s = forfettario({ compensiCents: 3000000, params: p, year: 2026 });
  const sc = scadenze(2026, s, declaredFor(p, 2025));
  // acconti 2026 dalle tasse 2025: imposta 500 € → 40 % + 60 %, contributi 80 % di 6.000 €
  assert.equal(sc.versati.imposta, 50000);
  assert.equal(sc.versati.contributi, 480000);
  assert.equal(sc.giugno.saldoImposta, s.imposta - 50000);
  assert.equal(sc.giugno.saldoContributi, s.contributi - 480000);
});
