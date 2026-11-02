// Grafici (sezione del Recap): peso dei trattamenti e andamento nel tempo (totale, per trattamento, per studio).
import { el, periodNav, resolveNav, studioLabel, newNav, emptyState, iconTile, menuChip, segmented } from '../ui.js';
import { todayISO, trendRange, shiftYear } from '../dates.js';
import { formatEuro, formatPct } from '../money.js';
import { ranking, trendSeries } from '../aggregate.js';
import { barChartH, lineChart } from '../charts.js';
import { STUDIO_COLORS, studioColorKey } from '../colors.js';

/** Colore dal tema attivo (token CSS --c1…--c8, --chart-total, --chart-other), con ripiego sui valori chiari. */
function themeColor(token, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v ? `rgb(${v.split(/\s+/).join(',')})` : fallback;
}
// linee "per trattamento": sequenza sfasata rispetto ai colori degli studi (si parte da indaco e viola)
const TREATMENT_ORDER = [6, 5, 4, 3, 7, 1, 2, 0];
const paletteColor = (i) => {
  const c = STUDIO_COLORS[TREATMENT_ORDER[i % TREATMENT_ORDER.length]];
  return themeColor(`--${c.key}`, c.hex);
};
/**
 * Barre dei trattamenti: un solo blu (quello del totale) che si attenua scendendo in classifica.
 * Tema chiaro: trasparenza fino al 40 %. Tema scuro: si schiarisce verso il bianco (fino al 45 %),
 * così anche la barra più corta resta sopra 3:1 sul binario quasi nero.
 */
function rankColor(i, n) {
  const root = document.documentElement;
  const [r, g, b] = (getComputedStyle(root).getPropertyValue('--chart-total').trim() || '10 108 255').split(/\s+/).map(Number);
  const t = n <= 1 ? 0 : i / (n - 1);
  if (getComputedStyle(root).colorScheme === 'dark') {
    const k = 0.45 * t;
    const mix = (c) => Math.round(c + (255 - c) * k);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }
  return `rgba(${r},${g},${b},${(1 - 0.6 * t).toFixed(2)})`;
}
const EURO_TICK = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

const state = { nav: newNav('anno'), studioId: '', granularity: 'mese', measure: 'euro', mode: 'totale', compare: false };

/** Aggiunge i grafici al contenitore (senza svuotarlo). */
export function renderInto(container, ctx) {
  const { store } = ctx;
  const studios = store.getStudios({ includeArchived: true });
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  const studiosById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const studioSel = el('select', { id: 'gra-studio', 'aria-label': 'Studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });
  const granSel = el('select', { id: 'gra-granularity', 'aria-label': 'Raggruppa per' },
    [['giorno', 'Giorno'], ['settimana', 'Settimana'], ['mese', 'Mese'], ['anno', 'Anno']]
      .map(([v, l]) => el('option', { value: v, text: `Per ${l.toLowerCase()}`, selected: v === state.granularity })));
  granSel.addEventListener('change', () => { state.granularity = granSel.value; ctx.rerender(); });

  // la misura sta tra i filtri: il primo grafico resta nella prima schermata
  const measureSel = el('select', { id: 'gra-measure', 'aria-label': 'Misura' },
    [['euro', 'Incasso'], ['pazienti', 'Pazienti'], ['media', '€ per paziente']]
      .map(([v, l]) => el('option', { value: v, text: l, selected: v === state.measure })));
  measureSel.addEventListener('change', () => { state.measure = measureSel.value; ctx.rerender(); });
  const filters = el('div', { class: 'filterbar' },
    periodNav({
      idPrefix: 'gra-period', state: state.nav, onChange: () => ctx.rerender(),
      // tinta solo sui valori diversi da quello predefinito (Incasso, tutti gli studi, per mese)
      extra: [menuChip(measureSel, { active: state.measure !== 'euro' }), menuChip(studioSel, { active: !!state.studioId }), menuChip(granSel, { active: state.granularity !== 'mese' })],
    }));
  container.append(filters);

  const { range, error } = resolveNav(state.nav);
  if (error) {
    filters.append(el('p', { class: 'field-error', role: 'alert', text: error }));
    return;
  }
  const entries = store.getEntries({ from: range.from, to: range.to, studioId: state.studioId || undefined });
  if (entries.length === 0) {
    container.append(el('div', { class: 'card' }, emptyState({
      iconName: 'chart', color: 'indigo', title: 'Nessun dato', text: 'Nel periodo selezionato non ci sono inserimenti da mostrare.',
    })));
    return;
  }
  const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
  const { measure } = state;
  const euroLike = measure !== 'pazienti';
  const chartW = Math.round(Math.min(640, Math.max(280, (container.clientWidth || 600) - 34)));
  const fmtValue = (v) => (measure === 'pazienti' ? `${v} paz.` : measure === 'media' ? `${formatEuro(v)}/paz.` : formatEuro(v));
  const what = measure === 'euro' ? 'incasso' : measure === 'pazienti' ? 'numero di pazienti' : 'media per paziente';

  // A: quale trattamento pesa di più
  const rank = ranking(entries, { measure, treatmentsById });
  const barBox = el('div', { class: 'chart', id: 'gra-chart-a' });
  barBox.innerHTML = barChartH({
    items: rank.map((r, i) => ({ label: r.name, value: r.value, color: rankColor(i, rank.length), displayValue: measure === 'media' ? fmtValue(r.value) : `${fmtValue(r.value)} · ${formatPct(r.pctTenths)}` })),
    width: chartW,
    ariaLabel: `Trattamenti ordinati per ${what}`,
  });
  container.append(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, iconTile('tooth', 'mint'), el('h3', { text: 'Peso dei trattamenti' })), barBox));

  // B: andamento nel tempo
  const card = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, iconTile('chart', 'indigo'), el('h3', { text: 'Andamento nel tempo' })),
    segmented({
      label: 'Linee', id: 'gra-mode', value: state.mode,
      options: [['totale', 'Totale'], ['trattamento', 'Trattamenti'], ['studio', 'Studi']],
      onPick: (v) => { state.mode = v; ctx.rerender(); },
    }));
  if (state.mode === 'totale') {
    const box = el('input', { type: 'checkbox', id: 'gra-compare', class: 'switch', role: 'switch', checked: state.compare });
    box.addEventListener('change', () => { state.compare = box.checked; ctx.rerender(); });
    card.append(el('label', { class: 'check-inline switch-row' }, el('span', { text: "Confronta con l'anno prima" }), box));
  }
  const tr = trendRange({ from: range.from, to: range.to, today: todayISO(), entryDates: entries.map((e) => e.date) });
  if (!tr) {
    card.append(el('p', { class: 'empty', text: 'Nessun dato nel periodo selezionato' }));
  } else {
    const compareEntries = state.mode === 'totale' && state.compare
      ? store.getEntries({ from: shiftYear(tr.from, -1), to: shiftYear(tr.to, -1), studioId: state.studioId || undefined })
      : undefined;
    const data = trendSeries(entries, {
      ...tr, granularity: state.granularity, measure, mode: state.mode, treatmentsById, studiosById, compareEntries,
    });
    const series = data.series.map((s, i) => {
      let color;
      if (state.mode === 'totale') color = themeColor('--chart-total', '#0A6CFF');
      else if (s.name === 'Altri' && i === data.series.length - 1 && i >= 7) color = themeColor('--chart-other', '#7A8090');
      else if (state.mode === 'studio') color = themeColor(`--${studioColorKey(studiosById[s.studioId] || { id: s.studioId })}`, '#0A6CFF');
      else color = paletteColor(i);
      return { ...s, color };
    });
    const line = el('div', { class: 'chart', id: 'gra-chart-b' });
    line.innerHTML = lineChart({
      labels: data.labels, series, width: chartW, height: 240, area: state.mode === 'totale',
      yFormat: (v) => (euroLike ? EURO_TICK.format(v / 100) : String(v)),
      pointFormat: fmtValue,
      ariaLabel: `Andamento: ${what} nel tempo`,
    });
    if (series.length > 1) {
      card.append(el('ul', { class: 'legend' }, series.map((s) => {
        const sw = el('span', { class: `swatch${s.dashed ? ' swatch-dashed' : ''}` });
        sw.style.background = s.color;
        sw.style.color = s.color;
        return el('li', {}, sw, el('span', { text: s.name }));
      })));
    }
    card.append(line);
  }
  container.append(card);
}
