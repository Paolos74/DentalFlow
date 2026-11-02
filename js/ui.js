// Helper DOM condivisi dalle viste. Ogni stringa dell'utente arriva al DOM via textContent.
import { escapeHtml } from './escape.js';
import { periodRange, todayISO, isValidISODate } from './dates.js';
import { parseEuroInput, parsePatients, formatEuroCsv } from './money.js';
import { ValidationError, StorageError, MAX_CENTS } from './store.js';

export { escapeHtml };

const BOOL_PROPS = new Set(['disabled', 'checked', 'selected', 'hidden', 'required', 'multiple', 'readOnly']);

/** el('button', {class:'btn', onclick: fn, text:'Ok'}, ...children) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false && !BOOL_PROPS.has(k)) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (BOOL_PROPS.has(k)) node[k] = !!v;
    else if (k === 'value') node.value = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

export function isUserError(err) {
  return err instanceof ValidationError || err instanceof StorageError;
}

// ---------- toast ----------
export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const t = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status', text: message });
  host.append(t);
  setTimeout(() => t.remove(), timeout);
}

/** Mostra l'errore all'utente se è di validazione/storage, altrimenti lo registra e mostra un messaggio generico. */
export function showError(err) {
  if (isUserError(err) || err?.name === 'PeriodError') toast(err.message, { type: 'error', timeout: 5000 });
  else {
    console.error(err);
    toast(`Errore imprevisto: ${err?.message || err}`, { type: 'error', timeout: 5000 });
  }
}

// ---------- dialog ----------
function openDialog(build, { onCancel } = {}) {
  const host = document.getElementById('dialog-host') || document.body;
  const dlg = el('dialog', { class: 'dialog' });
  host.append(dlg);
  const close = () => {
    if (dlg.open) dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
    onCancel?.();
  });
  build(dlg, close);
  dlg.showModal();
  return dlg;
}

export function confirmDialog(message, { title = 'Conferma', okText = 'Conferma', cancelText = 'Annulla', danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const done = (v) => { close(); resolve(v); };
      dlg.append(
        el('h2', { class: 'dialog-title', text: title }),
        el('p', { class: 'dialog-text', text: message }),
        el('div', { class: 'dialog-actions' },
          el('button', { type: 'button', class: 'btn btn-secondary', text: cancelText, onclick: () => done(false) }),
          el('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okText, onclick: () => done(true), autofocus: true })),
      );
    }, { onCancel: () => resolve(false) });
  });
}

/** choices: [{value, label, kind:'primary'|'danger'|'secondary'}]; risolve con value o null (Annulla/Esc). */
export function choiceDialog({ title, message, details = [], choices }) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const done = (v) => { close(); resolve(v); };
      appendChildren(dlg, [
        el('h2', { class: 'dialog-title', text: title }),
        message ? el('p', { class: 'dialog-text', text: message }) : null,
        details.length ? el('ul', { class: 'dialog-list' }, details.map((d) => el('li', { text: d }))) : null,
        el('div', { class: 'dialog-actions dialog-actions-stack' },
          choices.map((c) => el('button', { type: 'button', class: `btn btn-${c.kind || 'secondary'}`, text: c.label, onclick: () => done(c.value) }))),
      ]);
    }, { onCancel: () => resolve(null) });
  });
}

/**
 * Dialog con form. build(form) aggiunge i campi; onSubmit() ritorna true per chiudere,
 * false per restare aperto (errori mostrati inline). Risolve true se salvato.
 */
export function formDialog({ title, build, onSubmit, submitText = 'Salva' }) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const form = el('form', { class: 'form', novalidate: true });
      const formError = el('p', { class: 'field-error', role: 'alert', hidden: true });
      const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: submitText });
      form.append(el('h2', { class: 'dialog-title', text: title }));
      build(form);
      form.append(formError, el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary', text: 'Annulla', onclick: () => { close(); resolve(false); } }),
        submit));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.hidden = true;
        submit.disabled = true;
        try {
          const ok = await onSubmit({ form, setFormError: (m) => { formError.textContent = m; formError.hidden = false; } });
          if (ok) { close(); resolve(true); }
        } catch (err) {
          if (isUserError(err)) { formError.textContent = err.message; formError.hidden = false; }
          else { close(); showError(err); resolve(false); }
        } finally {
          submit.disabled = false;
        }
      });
      dlg.append(form);
    }, { onCancel: () => resolve(false) });
  });
}

/** Campo con etichetta ed errore inline. Ritorna {wrap, input, setError}. */
export function field(labelText, input, { hint } = {}) {
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  if (!input.id) input.id = `f-${Math.random().toString(36).slice(2, 9)}`;
  const wrap = el('div', { class: 'field' },
    el('label', { for: input.id, text: labelText }), input, hint ? el('p', { class: 'hint', text: hint }) : null, err);
  return {
    wrap, input,
    setError(m) { err.textContent = m || ''; err.hidden = !m; },
  };
}

export function textDialog({ title, label, value = '', submitText = 'Salva', onSubmit }) {
  const input = el('input', { type: 'text', maxlength: '60', value, autocomplete: 'off' });
  return formDialog({
    title, submitText,
    build: (form) => form.append(field(label, input).wrap),
    onSubmit: () => onSubmit(input.value),
  });
}

/**
 * Dialog con checkbox (multi-studio). options [{value,label,checked}].
 * onSubmit(values) → true per chiudere. Con selectAll aggiunge "Seleziona tutti".
 */
export function checkboxDialog({ title, intro, options, submitText = 'Conferma', selectAll = true, onSubmit, extra }) {
  const boxes = options.map((o) => el('input', { type: 'checkbox', value: o.value, checked: !!o.checked }));
  return formDialog({
    title, submitText,
    build: (form) => {
      if (extra) form.append(extra);
      if (intro) form.append(el('p', { class: 'dialog-text', text: intro }));
      if (selectAll && options.length > 1) {
        form.append(el('button', {
          type: 'button', class: 'btn btn-link', text: 'Seleziona tutti',
          onclick: () => { const all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; }); },
        }));
      }
      form.append(el('div', { class: 'checklist' }, options.map((o, i) => el('label', { class: 'check' }, boxes[i], el('span', { text: o.label })))));
    },
    onSubmit: (ctx) => onSubmit(boxes.filter((b) => b.checked).map((b) => b.value), ctx),
  });
}

// ---------- selettore periodo ----------
export const PERIOD_PRESETS = [
  ['questo-mese', 'Questo mese'],
  ['mese-scorso', 'Mese scorso'],
  ['quest-anno', "Quest'anno"],
  ['tutto', 'Tutto'],
  ['personalizzato', 'Personalizzato'],
];

/** state: {preset, from, to}; onChange() chiamato dopo ogni modifica. */
export function periodPicker({ idPrefix, state, onChange }) {
  const select = el('select', { id: `${idPrefix}-preset` },
    PERIOD_PRESETS.map(([v, l]) => el('option', { value: v, text: l, selected: state.preset === v })));
  select.addEventListener('change', () => {
    const prev = state.preset;
    state.preset = select.value;
    if (state.preset === 'personalizzato') {
      const base = prev === 'tutto' || prev === 'personalizzato' ? 'questo-mese' : prev;
      const r = periodRange(base, todayISO());
      state.from = r.from;
      state.to = r.to;
    }
    onChange();
  });
  const wrap = el('div', { class: 'period-picker' }, field('Periodo', select).wrap);
  if (state.preset === 'personalizzato') {
    const from = el('input', { type: 'date', id: `${idPrefix}-from`, value: state.from || '' });
    const to = el('input', { type: 'date', id: `${idPrefix}-to`, value: state.to || '' });
    from.addEventListener('change', () => { state.from = from.value; onChange(); });
    to.addEventListener('change', () => { state.to = to.value; onChange(); });
    wrap.append(el('div', { class: 'row-2' }, field('Dal', from).wrap, field('Al', to).wrap));
  }
  return wrap;
}

/** Calcola l'intervallo del periodo; ritorna {range} oppure {error}. */
export function resolvePeriod(state) {
  try {
    return { range: periodRange(state.preset, todayISO(), { from: state.from, to: state.to }) };
  } catch (err) {
    if (err?.name === 'PeriodError') return { error: err.message };
    throw err;
  }
}

// ---------- dialog di modifica inserimento ----------
export function studioLabel(s) {
  return s.archived ? `${s.name} (archiviato)` : s.name;
}

export function entryEditDialog(store, entry) {
  const studios = store.getStudios({ includeArchived: true });
  const date = el('input', { type: 'date', id: 'edit-date', value: entry.date });
  const studio = el('select', { id: 'edit-studio' }, studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === entry.studioId })));
  if (!studios.some((s) => s.id === entry.studioId)) studio.prepend(el('option', { value: '', text: 'Studio eliminato', selected: true }));
  const treatment = el('select', { id: 'edit-treatment' });
  const patients = el('input', { type: 'number', id: 'edit-patients', inputmode: 'numeric', min: '1', max: '999', value: String(entry.patients) });
  const amount = el('input', { type: 'text', id: 'edit-amount', inputmode: 'decimal', placeholder: '0,00', value: formatEuroCsv(entry.amountCents), autocomplete: 'off' });
  const fDate = field('Data', date);
  const fStudio = field('Studio', studio);
  const fTreatment = field('Trattamento', treatment);
  const fPatients = field('Numero pazienti', patients);
  const fAmount = field('Importo totale (€)', amount);

  function fillTreatments(selectedId) {
    clear(treatment);
    const list = store.getTreatmentsForStudio(studio.value, { includeArchived: true });
    const has = list.some((t) => t.id === selectedId);
    treatment.append(el('option', { value: '', text: '— seleziona —', selected: !has }));
    for (const t of list) {
      const label = t.studios[studio.value] === 'archived' ? `${t.name} (archiviato)` : t.name;
      treatment.append(el('option', { value: t.id, text: label, selected: t.id === selectedId }));
    }
  }
  fillTreatments(entry.treatmentId);
  studio.addEventListener('change', () => fillTreatments(treatment.value));

  return formDialog({
    title: 'Modifica inserimento',
    build: (form) => form.append(fDate.wrap, fStudio.wrap, fTreatment.wrap, el('div', { class: 'row-2' }, fPatients.wrap, fAmount.wrap)),
    onSubmit: ({ setFormError }) => {
      [fDate, fStudio, fTreatment, fPatients, fAmount].forEach((f) => f.setError(''));
      let ok = true;
      if (!isValidISODate(date.value)) { fDate.setError('Data non valida'); ok = false; }
      if (!studio.value) { fStudio.setError('Seleziona uno studio'); ok = false; }
      if (!treatment.value) { fTreatment.setError('Seleziona un trattamento'); ok = false; }
      const p = parsePatients(patients.value, { min: 1 });
      if (p === null) { fPatients.setError('Numero pazienti non valido (1–999)'); ok = false; }
      const cents = parseEuroInput(amount.value);
      if (cents === null || cents > MAX_CENTS) { fAmount.setError('Importo non valido (massimo 100.000,00 €)'); ok = false; }
      if (!ok) return false;
      try {
        store.updateEntry(entry.id, { date: date.value, studioId: studio.value, treatmentId: treatment.value, patients: p, amountCents: cents });
      } catch (err) {
        if (isUserError(err)) { setFormError(err.message); return false; }
        throw err;
      }
      toast('Inserimento aggiornato');
      return true;
    },
  });
}

// ---------- file ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, class: 'visually-hidden' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function canShareFile(file) {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

export async function shareFile(file, title) {
  try {
    await navigator.share({ files: [file], title });
  } catch (err) {
    if (err?.name !== 'AbortError') showError(err);
  }
}

/** Versione dell'app dal service worker attivo (messaggio GET_VERSION), oppure '—'. */
export function getSwVersion() {
  return new Promise((resolve) => {
    const ctrl = navigator.serviceWorker?.controller;
    if (!ctrl) { resolve('—'); return; }
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve('—'), 2000);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data?.version || '—'); };
    ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  });
}
