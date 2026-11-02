// Registro: elenco degli inserimenti con modifica ed eliminazione di ogni campo.
import { el, clear, toast, showError, confirmDialog, entryEditDialog, periodPicker, resolvePeriod, field, studioLabel } from '../ui.js';
import { formatIT } from '../dates.js';
import { formatEuro, sumCents } from '../money.js';

const state = { preset: 'questo-mese', from: null, to: null, studioId: '', treatmentId: '' };

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  container.append(el('h2', { text: 'Registro' }));

  const studios = store.getStudios({ includeArchived: true });
  const treatments = store.getTreatments();
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  if (state.treatmentId && !treatments.some((t) => t.id === state.treatmentId)) state.treatmentId = '';

  const studioSel = el('select', { id: 'reg-studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });
  const treatSel = el('select', { id: 'reg-treatment' },
    el('option', { value: '', text: 'Tutti i trattamenti' }),
    treatments.map((t) => el('option', { value: t.id, text: t.name, selected: t.id === state.treatmentId })));
  treatSel.addEventListener('change', () => { state.treatmentId = treatSel.value; ctx.rerender(); });

  const filters = el('div', { class: 'card filters' },
    periodPicker({ idPrefix: 'reg-period', state, onChange: () => ctx.rerender() }),
    field('Studio', studioSel).wrap,
    field('Trattamento', treatSel).wrap);
  container.append(filters);

  const { range, error } = resolvePeriod(state);
  if (error) {
    filters.append(el('p', { class: 'field-error', role: 'alert', text: error }));
    return;
  }

  const entries = store.getEntries({ from: range.from, to: range.to, studioId: state.studioId || undefined, treatmentId: state.treatmentId || undefined });
  if (entries.length === 0) {
    container.append(el('div', { class: 'card empty', text: 'Nessun inserimento nel periodo selezionato' }));
    return;
  }
  const studiosById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const treatmentsById = Object.fromEntries(treatments.map((t) => [t.id, t]));

  const card = el('div', { class: 'card' });
  let currentDate = null;
  let group = null;
  for (const e of entries) {
    if (e.date !== currentDate) {
      currentDate = e.date;
      group = el('ul', { class: 'list' });
      card.append(el('section', { class: 'day-group' }, el('h3', { class: 'day-title', text: formatIT(e.date) }), group));
    }
    const s = studiosById[e.studioId];
    const tName = treatmentsById[e.treatmentId]?.name ?? 'Trattamento eliminato';
    const sName = s ? studioLabel(s) : 'Studio eliminato';
    group.append(el('li', { class: 'list-item' },
      el('div', { class: 'item-head' },
        el('span', { class: 'item-title', text: tName }),
        el('span', { class: 'amount', text: formatEuro(e.amountCents) })),
      el('div', { class: 'item-meta', text: `${sName} · ${e.patients} ${e.patients === 1 ? 'paziente' : 'pazienti'}` }),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Modifica', onclick: () => entryEditDialog(store, e) }),
        el('button', {
          type: 'button', class: 'btn btn-secondary btn-small', text: 'Elimina',
          onclick: async () => {
            if (!(await confirmDialog(`Eliminare l'inserimento del ${formatIT(e.date)}: «${tName}», ${sName}, ${e.patients} ${e.patients === 1 ? 'paziente' : 'pazienti'}, ${formatEuro(e.amountCents)}?`, { okText: 'Elimina', danger: true }))) return;
            try {
              store.deleteEntry(e.id);
              toast('Inserimento eliminato');
            } catch (err) {
              showError(err);
            }
          },
        }))));
  }
  const totalPatients = entries.reduce((n, e) => n + e.patients, 0);
  const totalCents = sumCents(entries.map((e) => e.amountCents));
  card.append(el('div', { class: 'item-head', id: 'reg-totals' },
    el('strong', { text: `Totale: ${entries.length} ${entries.length === 1 ? 'inserimento' : 'inserimenti'}, ${totalPatients} pazienti` }),
    el('span', { class: 'amount', text: formatEuro(totalCents) })));
  container.append(card);
}
