// Riepilogo per studio o per tutti gli studi, con esportazione CSV per singolo studio.
import { el, clear, periodPicker, resolvePeriod, field, studioLabel, downloadBlob, canShareFile, shareFile, toast } from '../ui.js';
import { formatEuro, formatPct } from '../money.js';
import { summarize } from '../aggregate.js';
import { buildStudioCsv, csvFileName } from '../csv.js';

const state = { preset: 'questo-mese', from: null, to: null, studioId: '' };

function table(headers, rows, foot) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, headers.map(([t, num]) => el('th', { class: num ? 'num' : null, scope: 'col', text: t })))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map(([t, num]) => el('td', { class: num ? 'num' : null, text: t }))))),
    foot ? el('tfoot', {}, el('tr', {}, foot.map(([t, num]) => el('td', { class: num ? 'num' : null, text: t })))) : null));
}

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  container.append(el('h2', { text: 'Riepilogo' }));

  const studios = store.getStudios({ includeArchived: true });
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  const studioSel = el('select', { id: 'rie-studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });

  const filters = el('div', { class: 'card filters' },
    field('Studio', studioSel).wrap,
    periodPicker({ idPrefix: 'rie-period', state, onChange: () => ctx.rerender() }));
  container.append(filters);

  const { range, error } = resolvePeriod(state);
  const studio = studios.find((s) => s.id === state.studioId) || null;

  // Esportazione CSV
  const exportBtn = el('button', { type: 'button', class: 'btn btn-primary', id: 'rie-export', text: 'Esporta CSV', disabled: !studio || !!error });
  const exportBox = el('div', { class: 'toolbar' }, exportBtn);
  if (!studio) exportBox.append(el('p', { class: 'hint', text: 'Seleziona uno studio per esportare il CSV' }));
  if (studio && !error) {
    const makeFile = () => {
      const entries = store.getEntries({ from: range.from, to: range.to, studioId: studio.id });
      const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
      const csv = buildStudioCsv({ entries, treatmentsById });
      const name = csvFileName({ studioName: studio.name, from: range.from, to: range.to });
      return { file: new File([csv], name, { type: 'text/csv;charset=utf-8' }), count: entries.length };
    };
    exportBtn.addEventListener('click', () => {
      const { file, count } = makeFile();
      downloadBlob(file, file.name);
      toast(`CSV esportato (${count} ${count === 1 ? 'riga' : 'righe'})`);
    });
    const probe = new File([''], 'x.csv', { type: 'text/csv' });
    if (canShareFile(probe)) {
      exportBox.append(el('button', {
        type: 'button', class: 'btn btn-secondary', id: 'rie-share', text: 'Condividi',
        onclick: () => { const { file } = makeFile(); shareFile(file, file.name); },
      }));
    }
  }
  filters.append(exportBox);

  if (error) {
    filters.insertBefore(el('p', { class: 'field-error', role: 'alert', text: error }), exportBox);
    return;
  }

  const entries = store.getEntries({ from: range.from, to: range.to, studioId: state.studioId || undefined });
  if (entries.length === 0) {
    container.append(el('div', { class: 'card empty', text: 'Nessun dato nel periodo selezionato' }));
    return;
  }
  const studiosById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
  const sum = summarize(entries, { studiosById, treatmentsById });

  container.append(el('div', { class: 'card', id: 'rie-treatments' },
    el('h3', { text: studio ? `Trattamenti · ${studioLabel(studio)}` : 'Trattamenti · tutti gli studi' }),
    table(
      [['Trattamento'], ['Pazienti', true], ['Totale €', true], ['%', true]],
      sum.byTreatment.map((r) => [[r.name], [String(r.patients), true], [formatEuro(r.cents), true], [formatPct(r.pctTenths), true]]),
      [['Totale'], [String(sum.totalPatients), true], [formatEuro(sum.totalCents), true], [formatPct(sum.totalCents ? 1000 : 0), true]],
    )));

  if (!studio) {
    container.append(el('div', { class: 'card', id: 'rie-studios' },
      el('h3', { text: 'Per studio' }),
      table(
        [['Studio'], ['Pazienti', true], ['Totale €', true]],
        sum.byStudio.map((r) => [[r.archived ? `${r.name} (archiviato)` : r.name], [String(r.patients), true], [formatEuro(r.cents), true]]),
        [['Totale'], [String(sum.totalPatients), true], [formatEuro(sum.totalCents), true]],
      )));
  }
}
