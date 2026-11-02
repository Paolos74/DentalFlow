// Inserimento della giornata: per data e studio, pazienti e importo totale per ogni trattamento.
// Lo studio previsto dal calendario è preselezionato; una giornata già registrata si modifica qui.
import {
  el, clear, toast, showError, isUserError, confirmDialog, checkboxDialog, chipGroup, noteBadge,
  pageHeader, emptyState, icon, iconButton, stepper, groupRow, formGroup, archivedBadge, autoGrow,
} from '../ui.js';
import { todayISO, isValidISODate, formatLong, formatDayTitle, addDays } from '../dates.js';
import { parseEuroInput, parsePatients, formatEuro, formatEuroCsv } from '../money.js';
import { MAX_CENTS, MAX_NOTE } from '../store.js';
import { scheduleOn } from '../calendar.js';
import { usageOrder } from '../aggregate.js';

const USAGE_DAYS = 90;

const state = {
  date: todayISO(),
  pickedOn: null, // giorno in cui la data è stata scelta a mano; un altro giorno → si torna a oggi
  studioId: null,
  suggestedFor: null, // data per cui è già stato applicato il suggerimento del calendario
  key: null, // `${date}|${studioId}` della bozza caricata
  rows: {}, // treatmentId → [{id, patients, amountText}]
  note: '',
  savedNote: '',
  noteOpen: false,
  errors: { rows: {}, form: null },
  nextStudioId: null, // studio previsto lo stesso giorno, proposto dopo il salvataggio
};

const keyOf = () => `${state.date}|${state.studioId}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Data scelta in modo esplicito (chip, frecce, campo data o link da un'altra schermata). */
function setDate(iso) {
  state.pickedOn = todayISO();
  if (iso === state.date) return;
  state.date = iso;
  state.nextStudioId = null;
}

/** Studi previsti dal calendario per la data (solo attivi), nell'ordine del calendario. */
function scheduledIds(store, studios) {
  if (!isValidISODate(state.date)) return [];
  const byId = Object.fromEntries(studios.map((s) => [s.id, s]));
  return scheduleOn(store.getCalendar(), state.date, { studiosById: byId }).map((x) => x.studioId);
}

/** Carica nella bozza le righe salvate della giornata (o una riga vuota per trattamento). */
function loadDraft(store) {
  state.key = keyOf();
  state.rows = {};
  state.errors = { rows: {}, form: null };
  state.note = '';
  state.savedNote = '';
  state.noteOpen = false;
  if (!state.studioId || !isValidISODate(state.date)) return;
  const entries = store.getEntries({ from: state.date, to: state.date, studioId: state.studioId })
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const e of entries) {
    (state.rows[e.treatmentId] ||= []).push({ id: e.id, patients: String(e.patients), amountText: formatEuroCsv(e.amountCents), saved: e });
  }
  state.savedNote = store.getNote(state.date, state.studioId) || '';
  state.note = state.savedNote;
  state.noteOpen = state.savedNote !== '';
}

/** La bozza ha valori diversi da quelli salvati (pazienti, importi, righe aggiunte o nota)? */
function isDirty() {
  if (state.note.trim() !== state.savedNote) return true;
  return Object.values(state.rows).some((list) => list.some((r) => {
    if (!r.saved) return String(r.patients).trim() !== '0' || String(r.amountText).trim() !== '';
    return String(r.patients).trim() !== String(r.saved.patients) || String(r.amountText).trim() !== formatEuroCsv(r.saved.amountCents);
  }));
}

const rowsOf = (tid) => (state.rows[tid] ||= [{ id: null, patients: '0', amountText: '' }]);

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  container.append(pageHeader({ title: 'Inserisci' }));

  const params = ctx.takeParams?.();
  if (params && isValidISODate(params.date)) {
    setDate(params.date);
    state.key = null;
    if (params.studioId) {
      state.suggestedFor = params.date;
      state.studioId = params.studioId;
    } else {
      state.suggestedFor = null; // studio dal calendario
    }
  } else if (ctx.entered && state.pickedOn !== todayISO() && state.date !== todayISO() && !isDirty()) {
    // solo entrando nella schermata o riaprendo l'app (mai nei ridisegni, mai con una bozza
    // non salvata): se la data non è stata scelta oggi, torna a oggi
    state.date = todayISO();
    state.pickedOn = null;
    state.nextStudioId = null;
  }

  const studios = store.getStudios();
  if (studios.length === 0) {
    container.append(el('div', { class: 'card' }, emptyState({
      iconName: 'studio', color: 'blue', title: 'Nessuno studio',
      text: 'Aggiungi lo studio dove lavori: poi potrai inserire pazienti e incassi di ogni giornata.',
      action: el('a', { href: '#altro/studi', class: 'btn btn-primary', text: 'Aggiungi il primo studio' }),
    })));
    return;
  }

  const planned = scheduledIds(store, studios);
  if (state.suggestedFor !== state.date) {
    state.suggestedFor = state.date;
    state.studioId = planned[0] || null;
  }
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = null;
  if (state.key !== keyOf()) loadDraft(store);

  container.append(renderHead(ctx, studios, planned));

  if (state.nextStudioId && state.nextStudioId !== state.studioId) {
    const next = studios.find((s) => s.id === state.nextStudioId);
    if (next) {
      container.append(el('div', { class: 'card suggestion', id: 'ins-next', role: 'status' },
        el('p', { class: 'hint-strong', text: `Il ${formatLong(state.date)} sei prevista anche da ${next.name}.` }),
        el('button', {
          type: 'button', class: 'btn btn-primary', id: 'ins-next-btn', text: `Passa a ${next.name}`,
          onclick: () => { state.studioId = next.id; state.nextStudioId = null; ctx.rerender(); },
        })));
    }
  }

  if (!state.studioId) {
    container.append(el('div', { class: 'card', id: 'ins-no-studio' }, emptyState({
      iconName: 'studio', color: 'gray', title: 'Dove hai lavorato?',
      text: 'Questo giorno non è nel calendario: tocca lo studio in cui hai lavorato.',
    })));
    return;
  }

  const all = store.getTreatments();
  const withRows = new Set(Object.keys(state.rows).filter((tid) => state.rows[tid].some((r) => r.id)));
  const visible = all.filter((t) => t.studios[state.studioId] === 'active' || withRows.has(t.id));
  const since = addDays(todayISO(), -USAGE_DAYS);
  const ordered = usageOrder(visible, store.getEntries({ from: since, studioId: state.studioId }), { studioId: state.studioId, since });
  if (ordered.length === 0) {
    container.append(el('div', { class: 'card' }, emptyState({
      iconName: 'tooth', color: 'mint', title: 'Nessun trattamento',
      text: 'In questo studio non hai ancora trattamenti attivi.',
      action: el('button', { type: 'button', class: 'btn btn-primary', id: 'ins-add-treatment', text: 'Aggiungi trattamento a questo studio', onclick: () => quickAddTreatment(ctx) }),
    })));
    return;
  }
  container.append(renderForm(ctx, ordered));
}

function renderHead(ctx, studios, planned) {
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const go = (iso) => { setDate(iso); ctx.rerender(); };
  const dateInput = el('input', { type: 'date', id: 'ins-date', class: 'date-native', value: state.date, 'aria-label': 'Data' });
  dateInput.addEventListener('change', () => { if (isValidISODate(dateInput.value)) go(dateInput.value); });
  const valid = isValidISODate(state.date);

  const prev = iconButton({ name: 'chevron-left', label: 'Giorno precedente', id: 'ins-prev-day', onClick: () => go(addDays(state.date, -1)) });
  const next = iconButton({ name: 'chevron', label: 'Giorno successivo', id: 'ins-next-day', onClick: () => go(addDays(state.date, 1)) });
  prev.disabled = !valid;
  next.disabled = !valid;
  // una sola data visibile, scritta per esteso (anno solo se non è quello in corso); il campo
  // nativo è invisibile sopra la scritta e apre il selettore del telefono al tocco
  const sameYear = valid && state.date.slice(0, 4) === today.slice(0, 4);
  const openPicker = () => { try { dateInput.showPicker?.(); } catch { /* il tocco sul campo basta */ } };
  dateInput.addEventListener('click', openPicker);
  const dateBox = el('div', { class: 'ins-date' },
    el('div', { class: 'date-nav' }, prev,
      el('span', { class: 'date-center' },
        el('span', { class: 'date-long', id: 'ins-date-long', 'aria-live': 'polite', text: valid ? formatDayTitle(state.date, { withYear: !sameYear }) : 'Data non valida' }),
        icon('chevron-down', 'date-caret'),
        dateInput),
      next),
    el('div', { class: 'date-tools' },
      chipGroup({
        label: 'Scorciatoie data', id: 'ins-date-chips',
        options: [
          { value: today, label: 'Oggi', pressed: state.date === today, id: 'ins-today' },
          { value: yesterday, label: 'Ieri', pressed: state.date === yesterday, id: 'ins-yesterday' },
        ],
        onPick: go,
      })));

  const plannedSet = new Set(planned);
  const studioBox = el('div', { class: 'ins-studio' },
    chipGroup({
      label: 'Studio', id: 'ins-studios',
      options: studios.map((s) => ({
        value: s.id, label: s.name, studio: s, pressed: s.id === state.studioId, id: `ins-studio-${s.id}`,
        badge: plannedSet.has(s.id) ? 'da calendario' : null,
      })),
      onPick: (id) => { if (id !== state.studioId) { state.studioId = id; ctx.rerender(); } },
    }),
    state.studioId ? null : el('p', { class: 'hint hint-strong', id: 'ins-studio-hint' }, icon('info'), 'Seleziona lo studio'));

  return el('div', { class: 'card ins-head' }, dateBox, studioBox);
}

function renderForm(ctx, treatments) {
  const { store } = ctx;
  const form = el('form', { class: 'card form', novalidate: true, id: 'ins-form' });
  const editing = Object.values(state.rows).some((list) => list.some((r) => r.id));
  if (editing) {
    form.append(el('p', { class: 'status-line', id: 'ins-editing', role: 'status' }, icon('check'), 'Giornata già registrata: stai modificando i valori salvati.'));
  }
  // una riga per trattamento: nome a sinistra, stepper a destra; l'importo compare solo con pazienti > 0
  form.append(el('div', { class: 'treat-head', 'aria-hidden': 'true' }, el('span', { text: 'Trattamento' }), el('span', { text: 'Pazienti' })));

  for (const t of treatments) {
    const active = t.studios[state.studioId] === 'active';
    const list = rowsOf(t.id);
    const block = el('div', { class: 'treat-row', dataset: { treatment: t.name } });
    list.forEach((d, i) => {
      const suffix = i === 0 ? '' : `-${i}`;
      const rowLabel = `${t.name}${i ? ` riga ${i + 1}` : ''}`;
      const pat = el('input', { type: 'number', id: `ins-pat-${t.id}${suffix}`, inputmode: 'numeric', min: '0', max: '999', value: d.patients, 'aria-label': `Pazienti ${rowLabel}` });
      const amt = el('input', { type: 'text', id: `ins-amt-${t.id}${suffix}`, inputmode: 'decimal', placeholder: '0,00', value: d.amountText, autocomplete: 'off', 'aria-label': `Importo totale ${rowLabel}` });
      amt.addEventListener('input', () => { d.amountText = amt.value; });
      const err = state.errors.rows[`${t.id}-${i}`];
      const isLast = i === list.length - 1;
      const amountLine = el('div', { class: 'treat-amount' },
        el('label', { class: 'treat-amount-label', for: amt.id, text: 'Incasso totale' }),
        el('span', { class: 'amount-input' }, amt));
      const more = active && isLast ? el('button', {
        type: 'button', class: 'treat-more', text: "+ Altra riga",
        'aria-label': `Aggiungi un'altra riga di ${t.name}`,
        onclick: () => { list.push({ id: null, patients: '0', amountText: '' }); ctx.rerender(); },
      }) : null;
      const showAmount = () => {
        const n = parsePatients(d.patients, { min: 0 });
        const open = (n ?? 0) > 0 || String(d.amountText).trim() !== '' || !!d.id || !!err;
        amountLine.hidden = !open;
        if (more) more.hidden = !open;
      };
      const step = stepper(pat, {
        label: `un paziente per ${t.name}`, min: 0, max: 999,
        onChange: (v) => { d.patients = v; showAmount(); },
      });
      const name = i === 0
        ? el('span', { class: 'treat-name' },
          el('span', { class: 'treat-name-text' }, el('span', { text: t.name }), active ? null : archivedBadge('Archiviato qui')),
          list.some((r) => r.id) ? icon('check', 'treat-saved') : null)
        : el('span', { class: 'treat-name is-extra', text: `Riga ${i + 1}${d.id ? ' · salvata' : ''}` });
      block.append(el('div', { class: `treat-line${i ? ' is-extra' : ''}` },
        el('div', { class: 'treat-main' }, name, step),
        amountLine,
        more,
        err ? el('p', { class: 'field-error', role: 'alert', text: err }) : null));
      showAmount();
    });
    form.append(block);
  }

  form.append(el('button', {
    type: 'button', class: 'btn btn-link ins-add', id: 'ins-add-treatment',
    onclick: () => quickAddTreatment(ctx),
  }, icon('plus-circle'), 'Aggiungi un trattamento'));

  // nota della giornata
  const noteArea = el('textarea', { id: 'ins-note', rows: '3', maxlength: String(MAX_NOTE), placeholder: 'Es. pagati in contanti, manca fattura…' });
  noteArea.value = state.note;
  noteArea.addEventListener('input', () => { state.note = noteArea.value; });
  autoGrow(noteArea);
  const details = el('details', { class: 'note-box', id: 'ins-note-box', open: state.noteOpen || state.note !== '' },
    el('summary', {}, state.savedNote ? noteBadge() : icon('note'), el('span', { text: state.savedNote ? 'Nota sulla giornata' : 'Aggiungi una nota' })),
    el('label', { class: 'visually-hidden', for: noteArea.id, text: 'Nota sulla giornata' }), noteArea,
    el('p', { class: 'group-note', text: 'La nota non entra nel CSV per lo studio.' }),
    state.savedNote ? el('button', {
      type: 'button', class: 'btn btn-link btn-danger-link', id: 'ins-note-delete', text: 'Elimina la nota',
      onclick: async () => {
        if (!(await confirmDialog('Eliminare la nota di questa giornata? Pazienti e importi non cambiano.', { okText: 'Elimina', danger: true }))) return;
        // la bozza (pazienti e importi non ancora salvati) resta: si toglie solo la nota,
        // prima di salvare perché lo store ridisegna subito la vista
        const before = { note: state.note, savedNote: state.savedNote, noteOpen: state.noteOpen };
        state.note = '';
        state.savedNote = '';
        state.noteOpen = false;
        try {
          store.setNote(state.date, state.studioId, '');
          toast('Nota eliminata');
        } catch (err) {
          Object.assign(state, before);
          ctx.rerender();
          showError(err);
        }
      },
    }) : null);
  details.addEventListener('toggle', () => { state.noteOpen = details.open; if (details.open) noteArea.dispatchEvent(new Event('input')); });
  form.append(details);

  if (state.errors.form) form.append(el('p', { class: 'form-error', role: 'alert', text: state.errors.form }));
  form.append(el('button', { type: 'submit', class: 'btn btn-primary btn-block', id: 'ins-save', text: editing ? 'Salva le modifiche' : 'Salva' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save(ctx, treatments);
  });
  return form;
}

async function save(ctx, treatments) {
  const { store } = ctx;
  const errors = {};
  const rows = [];
  const deleteIds = [];
  const deletions = [];
  for (const t of treatments) {
    (state.rows[t.id] || []).forEach((d, i) => {
      const k = `${t.id}-${i}`;
      const p = parsePatients(d.patients, { min: 0 });
      const amountText = String(d.amountText ?? '').trim();
      if (p === null) { errors[k] = 'Numero pazienti non valido (0–999)'; return; }
      if (p > 0) {
        const cents = parseEuroInput(amountText);
        if (amountText === '' || cents === null) { errors[k] = 'Importo non valido'; return; }
        if (cents > MAX_CENTS) { errors[k] = 'Importo non valido (massimo 100.000,00 €)'; return; }
        rows.push({ id: d.id || undefined, treatmentId: t.id, patients: p, amountCents: cents });
      } else if (d.id) {
        deleteIds.push(d.id);
        deletions.push(`${t.name}: ${plural(d.saved.patients, 'paziente', 'pazienti')}, ${formatEuro(d.saved.amountCents)}`);
      } else if (amountText !== '') {
        errors[k] = "Indica il numero di pazienti o cancella l'importo";
      }
    });
  }
  const noteText = state.note.trim();
  const noteChanged = noteText !== state.savedNote;
  state.errors = { rows: errors, form: null };
  if (Object.keys(errors).length === 0) {
    if (!isValidISODate(state.date)) state.errors.form = 'Data non valida';
    else if (rows.length === 0 && deleteIds.length === 0 && !noteChanged) state.errors.form = 'Inserisci almeno un paziente';
  }
  if (Object.keys(errors).length > 0 || state.errors.form) {
    ctx.rerender();
    return;
  }
  if (deletions.length > 0) {
    const ok = await confirmDialog(`Le righe portate a 0 pazienti verranno eliminate:\n${deletions.join('\n')}`, { title: 'Eliminare le righe?', okText: 'Elimina e salva', danger: true });
    if (!ok) return;
  }
  let res;
  try {
    res = store.saveDay({ date: state.date, studioId: state.studioId, rows, deleteIds, note: noteChanged ? noteText : undefined });
  } catch (err) {
    if (isUserError(err)) {
      state.errors.form = err.message;
      ctx.rerender();
      return;
    }
    showError(err);
    return;
  }
  const parts = [];
  if (res.added.length) parts.push(res.added.length === 1 ? '1 inserimento aggiunto' : `${res.added.length} inserimenti aggiunti`);
  if (res.updated) parts.push(res.updated === 1 ? '1 modificato' : `${res.updated} modificati`);
  if (res.deleted) parts.push(res.deleted === 1 ? '1 eliminato' : `${res.deleted} eliminati`);
  if (noteChanged) parts.push(noteText ? 'nota salvata' : 'nota eliminata');
  // dopo il salvataggio: proponi l'altro studio previsto lo stesso giorno, se non ancora registrato
  const studios = store.getStudios();
  const others = scheduledIds(store, studios).filter((id) => id !== state.studioId
    && store.getEntries({ from: state.date, to: state.date, studioId: id }).length === 0);
  state.nextStudioId = others[0] || null;
  state.key = null;
  ctx.rerender();
  toast(parts.length ? `Giornata salvata: ${parts.join(', ')}` : 'Nessuna modifica');
}

function quickAddTreatment(ctx) {
  const { store } = ctx;
  const studioId = state.studioId;
  const studio = store.getStudios({ includeArchived: true }).find((s) => s.id === studioId);
  if (!studio) return;
  const others = store.getTreatments().filter((t) => t.studios[studioId] !== 'active');
  const name = el('input', { type: 'text', id: 'dlg-quick-treatment', maxlength: '60', autocomplete: 'off', placeholder: 'Nome del nuovo trattamento' });
  const fName = groupRow('Nuovo trattamento', name, { stacked: true });
  checkboxDialog({
    title: 'Trattamenti',
    subtitle: `Aggiungi a ${studio.name}`,
    intro: others.length ? 'Già offerti in altri studi' : null,
    options: others.map((t) => ({
      value: t.id,
      label: t.studios[studioId] === 'archived'
        ? el('span', { class: 'check-text' }, el('span', { text: t.name }), el('span', { class: 'check-sub' }, archivedBadge('Archiviato qui'), ' verrà riattivato'))
        : t.name,
    })),
    selectAll: false,
    submitText: 'Aggiungi',
    extra: formGroup(fName.wrap),
    onSubmit: (ids, { setFormError }) => {
      fName.setError('');
      const n = name.value.trim();
      if (!n && ids.length === 0) { setFormError('Scegli un trattamento o scrivi il nome di uno nuovo'); return false; }
      if (n) store.addTreatment(n, [studioId]);
      for (const id of ids) store.addTreatmentToStudios(id, [studioId]);
      const count = ids.length + (n ? 1 : 0);
      toast(count === 1 ? 'Trattamento aggiunto allo studio' : `${count} trattamenti aggiunti allo studio`);
      return true;
    },
  });
}
