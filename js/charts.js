// Grafici SVG scritti a mano: funzioni pure che ritornano stringhe.
// Testi, griglia e binari usano classi (ch-*) colorate dal CSS del tema; gli attributi fill/stroke
// sono il ripiego per chi apre l'SVG fuori dall'app.
import { escapeHtml } from './escape.js';

const GRID = '#D5DAE3';
const TRACK = '#E9EDF3';
const TEXT = '#5B6577';
const LABEL = '#0B1220';
const BAR = '#0A6CFF';
const FONT = '-apple-system, system-ui, Segoe UI, Roboto, sans-serif';

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
    + `<text class="ch-empty" x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${TEXT}">Nessun dato</text></svg>`;
}

/** Barre orizzontali: items [{label, value, displayValue, color?}] già ordinati. */
export function barChartH({ items, width = 600, ariaLabel = 'Grafico a barre' }) {
  const rowH = 50;
  const padTop = 4;
  if (!items || items.length === 0) return emptySvg(width, 80, ariaLabel);
  const height = padTop + items.length * rowH;
  const max = Math.max(0, ...items.map((i) => i.value));
  const scaleMax = max > 0 ? max : 1;
  const barW = width;
  const barH = 12;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">`;
  items.forEach((it, i) => {
    const y = padTop + i * rowH;
    const w = r1(Math.max(it.value > 0 ? barH : 0, (it.value / scaleMax) * barW));
    const label = escapeHtml(it.label);
    const dv = escapeHtml(it.displayValue ?? String(it.value));
    const color = escapeHtml(it.color || BAR);
    out += '<g>';
    out += `<title>${label}: ${dv}</title>`;
    out += `<text class="ch-label" x="0" y="${y + 16}" font-size="14" font-weight="600" fill="${LABEL}">${label}</text>`;
    out += `<text class="ch-value" x="${width}" y="${y + 16}" font-size="13" fill="${TEXT}" text-anchor="end">${dv}</text>`;
    out += `<rect class="ch-track" x="0" y="${y + 26}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${TRACK}"/>`;
    if (w > 0) out += `<rect x="0" y="${y + 26}" width="${w}" height="${barH}" rx="${barH / 2}" fill="${color}"/>`;
    out += '</g>';
  });
  return `${out}</svg>`;
}

/**
 * Linee: labels[] per l'asse X, series [{name, values, color, dashed?}].
 * yFormat formatta i tick, pointFormat i valori nei tooltip (default yFormat).
 * area: riempimento sfumato sotto la prima serie (andamento totale).
 */
export function lineChart({ labels, series, width = 600, height = 260, yFormat = String, pointFormat, ariaLabel = 'Grafico andamento', area = false }) {
  const n = labels ? labels.length : 0;
  if (n === 0 || !series || series.length === 0) return emptySvg(width, height, ariaLabel);
  const fmtPoint = pointFormat || yFormat;
  const left = 58;
  const right = 10;
  const top = 12;
  const bottom = 34;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  let max = 0;
  for (const s of series) for (const v of s.values) if (Number.isFinite(v) && v > max) max = v;
  const { ticks, top: yTop } = niceTicks(max);
  const x = (i) => (n === 1 ? left + plotW / 2 : left + (i * plotW) / (n - 1));
  const y = (v) => top + plotH - ((Number.isFinite(v) ? v : 0) / yTop) * plotH;
  let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg" font-family="${FONT}">`;
  // griglia orizzontale tratteggiata, nessun asse verticale
  for (const t of ticks) {
    const yy = r1(y(t));
    out += `<line class="${t === 0 ? 'ch-base' : 'ch-grid'}" x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="${GRID}" stroke-width="1"${t === 0 ? '' : ' stroke-dasharray="3 4"'}/>`;
    out += `<text x="${left - 8}" y="${r1(yy + 4)}" font-size="11" fill="${TEXT}" text-anchor="end">${escapeHtml(yFormat(t))}</text>`;
  }
  // etichette X (al massimo ~12)
  const maxLabels = Math.max(2, Math.min(12, Math.floor(plotW / 62)));
  const step = Math.max(1, Math.ceil(n / maxLabels));
  for (let i = 0; i < n; i += step) {
    out += `<text x="${r1(x(i))}" y="${height - bottom + 20}" font-size="11" fill="${TEXT}" text-anchor="middle">${escapeHtml(labels[i])}</text>`;
  }
  // area sotto la prima serie
  const first = series[0];
  if (area && first && !first.dashed && n > 1) {
    const c = escapeHtml(first.color || BAR);
    const pts = first.values.map((v, i) => `${r1(x(i))},${r1(y(v))}`).join(' L');
    out += `<defs><linearGradient id="ch-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.22"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>`;
    out += `<path d="M${pts} L${r1(x(n - 1))},${r1(top + plotH)} L${r1(x(0))},${r1(top + plotH)} Z" fill="url(#ch-area)"/>`;
  }
  // serie: linea, punti piccoli (con tooltip) e punto in evidenza sull'ultimo valore
  const dotR = n > 60 ? 1.5 : 2.5;
  for (const s of series) {
    const color = escapeHtml(s.color || BAR);
    const pts = s.values.map((v, i) => `${r1(x(i))},${r1(y(v))}`).join(' ');
    const dash = s.dashed ? ' stroke-dasharray="6 5" stroke-opacity="0.7"' : '';
    out += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
    s.values.forEach((v, i) => {
      const last = i === n - 1 && !s.dashed;
      out += `<circle cx="${r1(x(i))}" cy="${r1(y(v))}" r="${last ? 4.5 : dotR}" fill="${color}"${last ? ' stroke="#FFFFFF" stroke-width="2"' : ' fill-opacity="0.55"'}><title>${escapeHtml(labels[i])} · ${escapeHtml(s.name)}: ${escapeHtml(fmtPoint(Number.isFinite(v) ? v : 0))}</title></circle>`;
    });
  }
  return `${out}</svg>`;
}
