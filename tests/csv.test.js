import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioCsv, buildAllStudiosCsv, csvFileName } from '../js/csv.js';

const tb = { t1: { name: 'Igiene dentale' }, t2: { name: 'A; "speciale"' }, t3: { name: '=A;1' }, t4: { name: 'Sbiancamento' } };

test('esempio esatto', () => {
  const csv = buildStudioCsv({ entries: [{ id: 'e1', date: '2026-02-13', treatmentId: 't1', patients: 7, amountCents: 21000, createdAt: 1 }], treatmentsById: tb });
  assert.equal(csv, '\uFEFFData;Trattamento;Numero pazienti;Costo trattamento (€)\r\n13/02/2026;Igiene dentale;7;210,00\r\n');
});

test('quoting e protezione formule prima del quoting', () => {
  const csv = buildStudioCsv({ entries: [
    { id: 'a', date: '2026-02-13', treatmentId: 't2', patients: 1, amountCents: 5, createdAt: 1 },
    { id: 'b', date: '2026-02-14', treatmentId: 't3', patients: 1, amountCents: 123450, createdAt: 2 },
  ], treatmentsById: tb });
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '13/02/2026;"A; ""speciale""";1;0,05');
  assert.equal(lines[2], `14/02/2026;"'=A;1";1;1234,50`);
});

test('ordinamento: data, nome trattamento, createdAt; righe dello stesso giorno mantenute', () => {
  const csv = buildStudioCsv({ entries: [
    { id: 'c', date: '2026-02-14', treatmentId: 't1', patients: 3, amountCents: 300, createdAt: 3 },
    { id: 'b', date: '2026-02-13', treatmentId: 't4', patients: 2, amountCents: 200, createdAt: 2 },
    { id: 'a', date: '2026-02-13', treatmentId: 't1', patients: 1, amountCents: 100, createdAt: 9 },
    { id: 'd', date: '2026-02-13', treatmentId: 't1', patients: 4, amountCents: 400, createdAt: 1 },
  ], treatmentsById: tb });
  const lines = csv.trim().split('\r\n').slice(1);
  assert.deepEqual(lines, [
    '13/02/2026;Igiene dentale;4;4,00',
    '13/02/2026;Igiene dentale;1;1,00',
    '13/02/2026;Sbiancamento;2;2,00',
    '14/02/2026;Igiene dentale;3;3,00',
  ]);
});

test('csvFileName', () => {
  assert.equal(csvFileName({ studioName: 'Studio Rossi', from: '2026-02-01', to: '2026-02-28' }), 'DentalFlow_studio-rossi_2026-02-01_2026-02-28.csv');
  assert.equal(csvFileName({ studioName: 'Studio Rossi', from: null, to: null }), 'DentalFlow_studio-rossi_tutto.csv');
  assert.equal(csvFileName({ studioName: 'Studio Rossi & Figli – Città', from: null, to: null }), 'DentalFlow_studio-rossi-figli-citta_tutto.csv');
  assert.equal(csvFileName({ studioName: '&&& ###', from: null, to: null }), 'DentalFlow_studio_tutto.csv');
});

test('formato con la virgola: stesse colonne e stessi valori, importi tra virgolette', () => {
  const entries = [{ id: 'e1', date: '2026-02-13', treatmentId: 't1', patients: 7, amountCents: 21000, createdAt: 1 },
    { id: 'e2', date: '2026-02-14', treatmentId: 't2', patients: 1, amountCents: 123450, createdAt: 2 }];
  const csv = buildStudioCsv({ entries, treatmentsById: tb, format: 'virgola' });
  assert.equal(csv, '\uFEFFData,Trattamento,Numero pazienti,Costo trattamento (€)\r\n'
    + '13/02/2026,Igiene dentale,7,"210,00"\r\n14/02/2026,"A; ""speciale""",1,"1234,50"\r\n');
  // ogni riga ha 4 campi se letta con la virgola come separatore e le virgolette CSV
  const fields = (line) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((x) => x !== '').length;
  for (const line of csv.slice(1).trim().split('\r\n')) assert.equal(fields(line), 4, line);
  assert.equal(buildStudioCsv({ entries, treatmentsById: tb }), buildStudioCsv({ entries, treatmentsById: tb, format: 'excel' }));
});

test('CSV unico di tutti gli studi con la colonna Studio', () => {
  const csv = buildAllStudiosCsv({
    entries: [
      { id: 'b', date: '2026-02-13', studioId: 's2', treatmentId: 't1', patients: 2, amountCents: 6000, createdAt: 2 },
      { id: 'a', date: '2026-02-13', studioId: 's1', treatmentId: 't1', patients: 7, amountCents: 21000, createdAt: 1 },
    ],
    treatmentsById: tb, studiosById: { s1: { name: 'Clinica Sorriso' }, s2: { name: 'Studio Rossi' } },
  });
  assert.deepEqual(csv.slice(1).trim().split('\r\n'), [
    'Data;Studio;Trattamento;Numero pazienti;Costo trattamento (€)',
    '13/02/2026;Clinica Sorriso;Igiene dentale;7;210,00',
    '13/02/2026;Studio Rossi;Igiene dentale;2;60,00',
  ]);
});
