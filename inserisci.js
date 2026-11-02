// Inserimento giornaliero: per giorno e studio, pazienti e importo totale per ogni trattamento.
import { el, clear, toast, showError, isUserError, confirmDialog, entryEditDialog, field } from '../ui.js';
import { todayISO, isValidISODate, formatIT } from '../dates.js';
import { parseEuroInput, parsePatients, formatEuro } from '../money.js';
import { MAX_CENTS } from '../store.js';

const state = { date: todayISO(), studioId: null, draft: {}, errors: { rows: {}, form: null } };

function resetDraft() {
  state.draft = {};
  state.errors = { rows: {}, form: null };
}

const draftOf = (tid) => (state.draft[tid] ||= { patients: '0', amountText: '' });

function clamp(n) {
  return Math.min(999, Math.max(0, n));
}

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  container.append(el('h2', { text: 'Inserisci' }));

  const studios = store.getStudios();
  if (studios.length === 0) {
    container.append(el('div', { class: 'card empty' },
      el('p', { text: 'Non hai ancora nessuno studio.' }),
      el('a', { href: '#gestione', class: 'btn btn-primary', text: 'Aggiungi il primo studio' })));
    return;
  }
  if (!studios.some((s) => s.id === state.studioId)) {
    state.studioId = studios[0].id;
  }

  const dateInput = el('input', { type: 'date', id: 'ins-date', value: state.date });
  dateInput.addEventListener('change', () => {
    if (dateInput.value === state.date) return;
    state.date = dateInput.value;
    resetDraft();
    ctx.rerender();
  });
  const studioSelect = el('select', { id: 'ins-studio' },
    studios.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === state.studioId })));
  studioSelect.addEventListener('change', () => {
    state.studioId = studioSelect.value;
    resetDraft();
    ctx.rerender();
  });

  const head = el('div', { class: 'card' }, el('div', { class: 'row-2' }, field('Data', dateInput).wrap, field('Studio', studioSelect).wrap));
  container.append(head);

  const treatments = store.getTreatmentsForStudio(state.studioId);
  if (treatments.length === 0) {
    container.append(el('div', { class: 'card empty' },
      el('p', { text: 'Nessun trattamento attivo in questo studio.' }),
      el('a', { href: '#gestione', class: 'btn btn-primary', text: 'Aggiungi trattamenti in Gestione' })));
  } else {
    container.append(renderForm(ctx, treatments));
  }

  container.append(renderExisting(ctx));
}

function renderForm(ctx, treatments) {
  const form = el('form', { class: 'card form', novalidate: true, id: 'ins-form' });
  form.append(el('p', { class: 'hint', text: "Per ogni trattamento indica i pazienti e l'importo totale incassato (per tutti i pazienti della riga)." }));
  for (const t of treatments) {
    const d = draftOf(t.id);
    const pat = el('input', { type: 'number', id: `ins-pat-${t.id}`, inputmode: 'numeric', min: '0', max: '999', value: d.patients, 'aria-label': `Pazienti ${t.name}` });
    const amt = el('input', { type: 'text', id: `ins-amt-${t.id}`, inputmode: 'decimal', placeholder: '0,00', value: d.amountText, autocomplete: 'off', 'aria-label': `Importo totale ${t.name}` });
    pat.addEventListener('input', () => { d.patients = pat.value; });
    amt.addEventListener('input', () => { d.amountText = amt.value; });
    const step = (delta) => {
      const cur = parsePatients(pat.value, { min: 0 });
      pat.value = String(clamp((cur ?? 0) + delta));
      d.patients = pat.value;
    };
    const err = state.errors.rows[t.id];
    form.append(el('div', { class: 'treat-row' },
      el('div', { class: 'treat-name', text: t.name }),
      el('div', { class: 'treat-inputs' },
        el('div', {},
          el('span', { class: 'small-label', text: 'Pazienti' }),
          el('div', { class: 'stepper' },
            el('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': `Meno un paziente per ${t.name}`, text: '−', onclick: () => step(-1) }),
            pat,
            el('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': `Più un paziente per ${t.name}`, text: '+', onclick: () => step(1) }))),
        el('div', {}, el('label', { class: 'small-label', for: amt.id, text: 'Importo totale €' }), amt)),
      err ? el('p', { class: 'field-error', role: 'alert', text: err }) : null));
  }
  if (state.errors.form) form.append(el('p', { class: 'form-error', role: 'alert', text: state.errors.form }));
  form.append(el('button', { type: 'submit', class: 'btn btn-primary btn-block', id: 'ins-save', text: 'Salva' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(ctx, treatments);
  });
  return form;
}

function save(ctx, treatments) {
  const { store } = ctx;
  const rows = {};
  const toSave = [];
  for (const t of treatments) {
    const d = draftOf(t.id);
    const p = parsePatients(d.patients, { min: 0 });
    const amountText = String(d.amountText ?? '').trim();
    if (p === null) { rows[t.id] = 'Numero pazienti non valido (0–999)'; continue; }
    if (p > 0) {
      const cents = parseEuroInput(amountText);
      if (amountText === '' || cents === null) { rows[t.id] = 'Importo non valido'; continue; }
      if (cents > MAX_CENTS) { rows[t.id] = 'Importo non valido (massimo 100.000,00 €)'; continue; }
      toSave.push({ treatment: t, entry: { date: state.date, studioId: state.studioId, treatmentId: t.id, patients: p, amountCents: cents } });
    } else if (amountText !== '') {
      rows[t.id] = "Indica il numero di pazienti o cancella l'importo";
    }
  }
  state.errors = { rows, form: null };
  if (Object.keys(rows).length === 0) {
    if (!isValidISODate(state.date)) state.errors.form = 'Data non valida';
    else if (toSave.length === 0) state.errors.form = 'Inserisci almeno un paziente';
  }
  if (Object.keys(rows).length > 0 || state.errors.form) {
    ctx.rerender();
    return;
  }
  const existing = new Set(store.getEntries({ from: state.date, to: state.date, studioId: state.studioId }).map((e) => e.treatmentId));
  const dup = toSave.filter((x) => existing.has(x.treatment.id)).map((x) => x.treatment.name);
  try {
    store.addEntries(toSave.map((x) => x.entry));
  } catch (err) {
    if (isUserError(err)) {
      state.errors.form = err.message;
      ctx.rerender();
      return;
    }
    showError(err);
    return;
  }
  const n = toSave.length;
  resetDraft();
  ctx.rerender();
  const base = n === 1 ? 'Salvato 1 inserimento' : `Salvati ${n} inserimenti`;
  toast(dup.length ? `${base} (aggiunti a quelli già presenti per: ${dup.join(', ')})` : base);
}

function renderExisting(ctx) {
  const { store } = ctx;
  const card = el('div', { class: 'card' });
  card.append(el('h3', { text: 'Già registrati in questo giorno' }));
  if (!isValidISODate(state.date)) {
    card.append(el('p', { class: 'muted', text: 'Seleziona una data valida.' }));
    return card;
  }
  const entries = store.getEntries({ from: state.date, to: state.date, studioId: state.studioId });
  if (entries.length === 0) {
    card.append(el('p', { class: 'muted', text: `Nessun inserimento il ${formatIT(state.date)} in questo studio.` }));
    return card;
  }
  const byId = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
  const list = el('ul', { class: 'list' });
  for (const e of entries) {
    const name = byId[e.treatmentId]?.name ?? 'Trattamento eliminato';
    list.append(el('li', { class: 'list-item' },
      el('div', { class: 'item-head' },
        el('span', { class: 'item-title', text: name }),
        el('span', { class: 'amount', text: formatEuro(e.amountCents) })),
      el('div', { class: 'item-meta', text: `${e.patients} ${e.patients === 1 ? 'paziente' : 'pazienti'}` }),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Modifica', onclick: () => entryEditDialog(store, e) }),
        el('button', {
          type: 'button', class: 'btn btn-secondary btn-small', text: 'Elimina',
          onclick: async () => {
            if (!(await confirmDialog(`Eliminare l'inserimento «${name}» (${e.patients} ${e.patients === 1 ? 'paziente' : 'pazienti'}, ${formatEuro(e.amountCents)})?`, { okText: 'Elimina', danger: true }))) return;
            try {
              store.deleteEntry(e.id);
              toast('Inserimento eliminato');
            } catch (err) {
              showError(err);
            }
          },
        }))));
  }
  card.append(list);
  return card;
}
