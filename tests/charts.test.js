import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/escape.js';
import { barChartH, lineChart, niceTicks } from '../js/charts.js';

const clean = (svg) => {
  assert.ok(svg.startsWith('<svg'), svg.slice(0, 40));
  assert.ok(!svg.includes('NaN'), 'NaN');
  assert.ok(!svg.includes('Infinity'), 'Infinity');
};

test('escapeHtml', () => {
  assert.equal(escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(escapeHtml(null), '');
});

test('barChartH: zero, un punto, etichette con escape', () => {
  clean(barChartH({ items: [{ label: 'A', value: 0, displayValue: '0' }, { label: 'B', value: 0, displayValue: '0' }] }));
  clean(barChartH({ items: [{ label: 'A', value: 5, displayValue: '5' }] }));
  clean(barChartH({ items: [] }));
  const svg = barChartH({ items: [{ label: '<script>&"', value: 5, displayValue: 'x' }] });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;&amp;&quot;'));
});

test('lineChart: zero, un punto, 400 punti; numero serie; etichette X ≤ 12', () => {
  clean(lineChart({ labels: ['a', 'b'], series: [{ name: 'T', values: [0, 0], color: '#1565C0' }] }));
  clean(lineChart({ labels: ['a'], series: [{ name: 'T', values: [7], color: '#1565C0' }] }));
  const labels = Array.from({ length: 400 }, (_, i) => `L${i}`);
  const series = [0, 1, 2].map((k) => ({ name: `S${k}`, values: labels.map((_, i) => (i * (k + 1)) % 37), color: '#42A5F5' }));
  const svg = lineChart({ labels, series });
  clean(svg);
  assert.equal((svg.match(/<polyline|<path/g) || []).length, 3);
  const xLabels = (svg.match(/>L\d+<\/text>/g) || []).length;
  assert.ok(xLabels <= 12, `etichette: ${xLabels}`);
  const esc = lineChart({ labels: ['<b>'], series: [{ name: '<script>&"', values: [1] }] });
  assert.ok(!esc.includes('<script>') && !esc.includes('<b>'));
});

test('barChartH: colore per barra (con escape) e ripiego; classi per i colori del tema', () => {
  const svg = barChartH({ items: [{ label: 'A', value: 5, displayValue: '5', color: 'rgb(10,108,255)' }, { label: 'B', value: 2, displayValue: '2' }] });
  clean(svg);
  assert.ok(svg.includes('fill="rgb(10,108,255)"'));
  assert.ok(svg.includes('fill="#0A6CFF"'), 'ripiego senza colore');
  assert.ok(svg.includes('class="ch-track"') && svg.includes('class="ch-label"'));
  const bad = barChartH({ items: [{ label: 'A', value: 1, color: '"><script>' }] });
  assert.ok(!bad.includes('<script>'));
  // valore zero: solo il binario, nessuna barra
  const zero = barChartH({ items: [{ label: 'A', value: 0, displayValue: '0' }] });
  assert.equal((zero.match(/<rect/g) || []).length, 1);
});

test('lineChart: area sfumata solo se richiesta, punto finale in evidenza', () => {
  const base = { labels: ['a', 'b', 'c'], series: [{ name: 'T', values: [1, 3, 2], color: '#0A6CFF' }] };
  const plain = lineChart(base);
  assert.ok(!plain.includes('ch-area'));
  const withArea = lineChart({ ...base, area: true });
  clean(withArea);
  assert.ok(withArea.includes('url(#ch-area)'));
  assert.equal((withArea.match(/r="4.5"/g) || []).length, 1);
  // serie tratteggiata come prima: nessuna area
  const dashed = lineChart({ ...base, series: [{ ...base.series[0], dashed: true }], area: true });
  assert.ok(!dashed.includes('url(#ch-area)'));
});

test('niceTicks', () => {
  assert.deepEqual(niceTicks(0).ticks, [0, 1]);
  assert.deepEqual(niceTicks(1).ticks, [0, 1]);
  const t = niceTicks(21000);
  assert.ok(t.top >= 21000 && t.ticks[0] === 0);
});
