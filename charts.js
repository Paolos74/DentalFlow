// Grafici SVG scritti a mano: funzioni pure che ritornano stringhe.
import { escapeHtml } from './escape.js';

const AXIS = '#90A4AE';
const GRID = '#E3F2FD';
const TEXT = '#10243E';
const BAR = '#1565C0';
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const r1 = (n) => Math.round(n * 10) / 10;

/** Tick "belli" da 0, passo intero ≥ 1. Un massimo ≤ 0 diventa 1. */
export function niceTicks(maxValue, count = 4) {
  const max = maxValue > 0 && Number.isFinite(maxValue) ? maxValue : 1;
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, Math.ceil(nice * mag));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { ticks, top };
}

function emptySvg(width, height, label) {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(label)}" xmlns="http://www.w3.org/2000/svg">`
    + `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${TEXT}">Nessun dato</text></svg>`;
}

/** Barre orizzontali: items [{label, value, displayValue}] già ordinati. */
export function barChartH({ items, width = 600, ariaLabel = 'Grafico a barre' }) {
  const rowH = 46;
  const padTop = 8;
  if (!items || items.length === 0) return emptySvg(width, 80, ariaLabel);
  const height = padTop + items.length * rowH + 4;
  const max = Math.max(0, ...items.map((i) => i.value));
  const scaleMax = max > 0 ? max : 1;
  const barW = width - 8;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">`;
  items.forEach((it, i) => {
    const y = padTop + i * rowH;
    const w = r1(Math.max(it.value > 0 ? 2 : 0, (it.value / scaleMax) * barW));
    const label = escapeHtml(it.label);
    const dv = escapeHtml(it.displayValue ?? String(it.value));
    out += '<g>';
    out += `<title>${label}: ${dv}</title>`;
    out += `<text x="0" y="${y + 14}" font-size="13" fill="${TEXT}">${label}</text>`;
    out += `<text x="${width}" y="${y + 14}" font-size="13" fill="${TEXT}" text-anchor="end">${dv}</text>`;
    out += `<rect x="0" y="${y + 20}" width="${barW}" height="16" rx="4" fill="${GRID}"/>`;
    out += `<rect x="0" y="${y + 20}" width="${w}" height="16" rx="4" fill="${BAR}"/>`;
    out += '</g>';
  });
  return `${out}</svg>`;
}

/**
 * Linee: labels[] per l'asse X, series [{name, values, color}].
 * yFormat formatta i tick, pointFormat i valori nei tooltip (default yFormat).
 */
export function lineChart({ labels, series, width = 600, height = 260, yFormat = String, pointFormat, ariaLabel = 'Grafico andamento' }) {
  const n = labels ? labels.length : 0;
  if (n === 0 || !series || series.length === 0) return emptySvg(width, height, ariaLabel);
  const fmtPoint = pointFormat || yFormat;
  const left = 64;
  const right = 12;
  const top = 12;
  const bottom = 40;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  let max = 0;
  for (const s of series) for (const v of s.values) if (Number.isFinite(v) && v > max) max = v;
  const { ticks, top: yTop } = niceTicks(max);
  const x = (i) => (n === 1 ? left + plotW / 2 : left + (i * plotW) / (n - 1));
  const y = (v) => top + plotH - ((Number.isFinite(v) ? v : 0) / yTop) * plotH;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">`;
  // griglia e asse Y
  for (const t of ticks) {
    const yy = r1(y(t));
    out += `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="${t === 0 ? AXIS : GRID}" stroke-width="1"/>`;
    out += `<text x="${left - 6}" y="${r1(yy + 4)}" font-size="11" fill="${TEXT}" text-anchor="end">${escapeHtml(yFormat(t))}</text>`;
  }
  out += `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="${AXIS}" stroke-width="1"/>`;
  // etichette X (al massimo ~12)
  const maxLabels = Math.max(2, Math.min(12, Math.floor(plotW / 62)));
  const step = Math.max(1, Math.ceil(n / maxLabels));
  for (let i = 0; i < n; i += step) {
    out += `<text x="${r1(x(i))}" y="${height - bottom + 18}" font-size="11" fill="${TEXT}" text-anchor="middle">${escapeHtml(labels[i])}</text>`;
  }
  // serie
  const dotR = n > 100 ? 1.5 : 3;
  for (const s of series) {
    const color = escapeHtml(s.color || BAR);
    const pts = s.values.map((v, i) => `${r1(x(i))},${r1(y(v))}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((v, i) => {
      out += `<circle cx="${r1(x(i))}" cy="${r1(y(v))}" r="${dotR}" fill="${color}"><title>${escapeHtml(labels[i])} · ${escapeHtml(s.name)}: ${escapeHtml(fmtPoint(Number.isFinite(v) ? v : 0))}</title></circle>`;
    });
  }
  return `${out}</svg>`;
}
