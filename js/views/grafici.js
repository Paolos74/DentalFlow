// Grafici: peso dei trattamenti e andamento nel tempo (totale o per trattamento).
import { el, clear, periodPicker, resolvePeriod, field, studioLabel } from '../ui.js';
import { todayISO, trendRange } from '../dates.js';
import { formatEuro, formatPct } from '../money.js';
import { ranking, trendSeries } from '../aggregate.js';
import { barChartH, lineChart } from '../charts.js';

const PALETTE = ['#1565C0', '#42A5F5', '#0D3B66', '#26A69A', '#5C6BC0', '#90CAF9', '#00838F'];
const OTHERS_COLOR = '#283593';
const TOTAL_COLOR = '#1565C0';
const EURO_TICK = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const state = { preset: 'quest-anno', from: null, to: null, studioId: '', granularity: 'mese', measure: 'euro', mode: 'totale' };

function segmented(id, options, value, onPick, label) {
  return el('div', { class: 'field' },
    el('span', { class: 'small-label', text: label }),
    el('div', { class: 'seg', role: 'group', 'aria-label': label },
      options.map(([v, l]) => el('button', {
        type: 'button', id: `${id}-${v}`, 'aria-pressed': String(v === value), text: l,
        onclick: () => onPick(v),
      }))));
}

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  container.append(el('h2', { text: 'Grafici' }));

  const studios = store.getStudios({ includeArchived: true });
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  const studioSel = el('select', { id: 'gra-studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });
  const granSel = el('select', { id: 'gra-granularity' },
    [['giorno', 'Giorno'], ['settimana', 'Settimana'], ['mese', 'Mese'], ['anno', 'Anno']]
      .map(([v, l]) => el('option', { value: v, text: l, selected: v === state.granularity })));
  granSel.addEventListener('change', () => { state.granularity = granSel.value; ctx.rerender(); });

  const filters = el('div', { class: 'card filters' },
    field('Studio', studioSel).wrap,
    periodPicker({ idPrefix: 'gra-period', state, onChange: () => ctx.rerender() }),
    field('Raggruppa per', granSel).wrap,
    segmented('gra-measure', [['euro', 'Euro'], ['pazienti', 'Pazienti']], state.measure,
      (v) => { state.measure = v; ctx.rerender(); }, 'Misura'));
  container.append(filters);

  const { range, error } = resolvePeriod(state);
  if (error) {
    filters.append(el('p', { class: 'field-error', role: 'alert', text: error }));
    return;
  }
  const entries = store.getEntries({ from: range.from, to: range.to, studioId: state.studioId || undefined });
  if (entries.length === 0) {
    container.append(el('div', { class: 'card empty', text: 'Nessun dato nel periodo selezionato' }));
    return;
  }
  const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
  const euro = state.measure === 'euro';
  // larghezza reale del contenitore: il testo dell'SVG resta leggibile anche su telefono
  const chartW = Math.round(Math.min(720, Math.max(280, (container.clientWidth || 600) - 34)));
  const fmtValue = (v) => (euro ? formatEuro(v) : `${v} paz.`);

  // A: quale trattamento pesa di più
  const rank = ranking(entries, { measure: state.measure, treatmentsById });
  const bar = el('div', { class: 'chart', id: 'gra-chart-a' });
  bar.innerHTML = barChartH({
    items: rank.map((r) => ({ label: r.name, value: r.value, displayValue: `${fmtValue(r.value)} · ${formatPct(r.pctTenths)}` })),
    width: chartW,
    ariaLabel: `Trattamenti ordinati per ${euro ? 'incasso' : 'numero di pazienti'}`,
  });
  container.append(el('div', { class: 'card' }, el('h3', { text: 'Quale trattamento pesa di più' }), bar));

  // B: andamento nel tempo
  const card = el('div', { class: 'card' }, el('h3', { text: 'Andamento nel tempo' }),
    segmented('gra-mode', [['totale', 'Totale'], ['trattamento', 'Per trattamento']], state.mode,
      (v) => { state.mode = v; ctx.rerender(); }, 'Linee'));
  const tr = trendRange({ from: range.from, to: range.to, today: todayISO(), entryDates: entries.map((e) => e.date) });
  if (!tr) {
    card.append(el('p', { class: 'empty', text: 'Nessun dato nel periodo selezionato' }));
  } else {
    const data = trendSeries(entries, { ...tr, granularity: state.granularity, measure: state.measure, mode: state.mode, treatmentsById });
    const series = data.series.map((s, i) => ({
      ...s,
      // top 7 con la palette in ordine di classifica, "Altri" (8ª serie) con il suo colore riservato
      color: state.mode === 'totale' ? TOTAL_COLOR : (i < PALETTE.length ? PALETTE[i] : OTHERS_COLOR),
    }));
    const line = el('div', { class: 'chart', id: 'gra-chart-b' });
    line.innerHTML = lineChart({
      labels: data.labels, series, width: chartW, height: 240,
      yFormat: (v) => (euro ? EURO_TICK.format(v / 100) : String(v)),
      pointFormat: fmtValue,
      ariaLabel: `Andamento ${euro ? 'degli incassi' : 'dei pazienti'} nel tempo`,
    });
    card.append(line);
    if (state.mode === 'trattamento') {
      card.append(el('ul', { class: 'legend' }, series.map((s) => {
        const sw = el('span', { class: 'swatch' });
        sw.style.background = s.color;
        return el('li', {}, sw, el('span', { text: s.name }));
      })));
    }
  }
  container.append(card);
}
