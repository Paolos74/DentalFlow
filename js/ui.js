// Helper DOM condivisi dalle viste. Ogni stringa dell'utente arriva al DOM via textContent.
import { escapeHtml } from './escape.js';
import {
  todayISO, isValidISODate, navRange, navShift, navLabel, previousRange, NAV_MODES, monthDates, weekdayISO,
  monthLabel, addMonths, formatLong, WEEKDAYS_SHORT,
} from './dates.js';
import { parseEuroInput, parsePatients, formatEuroCsv, formatEuro } from './money.js';
import { ValidationError, StorageError, MAX_CENTS } from './store.js';
import { studioColorKey } from './colors.js';
import { iconSvg } from './icons.js';

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
/** action: {label, onClick} mostra un pulsante nel toast (es. "Annulla"); con un'azione il toast resta di più. */
export function toast(message, { type = 'info', timeout, action } = {}) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const t = el('div', { class: `toast toast-${type}${action ? ' toast-with-action' : ''}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'warning' : 'check', 'toast-icon'),
    el('span', { class: 'toast-text', text: message }));
  let timer = null;
  const remove = () => { clearTimeout(timer); t.remove(); };
  if (action) {
    t.append(el('button', {
      type: 'button', class: 'toast-action', text: action.label,
      onclick: () => { remove(); action.onClick(); },
    }));
  }
  host.append(t);
  timer = setTimeout(remove, timeout ?? (action ? 7000 : 3500));
}

/**
 * Dopo un'eliminazione confermata: toast con "Annulla" che ripristina i record (store.restoreRecords).
 */
export function undoToast(store, message, removed) {
  toast(message, {
    action: {
      label: 'Annulla',
      onClick: () => {
        try {
          const n = store.restoreRecords(removed);
          toast(n > 0 ? 'Eliminazione annullata' : 'Impossibile annullare: i dati sono cambiati nel frattempo', { type: n > 0 ? 'info' : 'error' });
        } catch (err) {
          showError(err);
        }
      },
    },
  });
}

/** Mostra l'errore all'utente se è di validazione/storage, altrimenti lo registra e mostra un messaggio generico. */
export function showError(err) {
  if (isUserError(err) || err?.name === 'PeriodError') toast(err.message, { type: 'error', timeout: 5000 });
  else {
    console.error(err);
    toast(`Errore imprevisto: ${err?.message || err}`, { type: 'error', timeout: 5000 });
  }
}

// ---------- fogli (sheet), avvisi (alert) e fogli d'azione, su <dialog> ----------
/**
 * kind: 'sheet' (dal basso, moduli), 'alert' (centrato, conferme), 'action' (foglio d'azione dal basso).
 * dismissable: tocco sullo sfondo = Annulla (solo dove non si perdono dati scritti).
 */
function openDialog(build, { onCancel, kind = 'sheet', label, dismissable = false } = {}) {
  const host = document.getElementById('dialog-host') || document.body;
  const dlg = el('dialog', { class: `dialog dialog-${kind}`, 'aria-label': label || null });
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
  const dismiss = () => { close(); onCancel?.(); };
  if (kind === 'sheet') {
    // fogli: si chiudono anche trascinando verso il basso o toccando lo sfondo, come in iOS;
    // con modifiche non salvate prima si chiede conferma
    let dirty = false;
    const mark = (e) => { if (!e.target.closest?.('[data-nodirty]')) dirty = true; };
    dlg.addEventListener('input', mark);
    dlg.addEventListener('change', mark);
    const guarded = async () => {
      if (!dirty) return true;
      return confirmDialog('Le modifiche non salvate andranno perse.', { title: 'Ignorare le modifiche?', okText: 'Ignora', cancelText: 'Continua', danger: true });
    };
    enableSheetSwipe(dlg, guarded, dismiss);
    dlg.addEventListener('click', async (e) => {
      if (e.target !== dlg || !isBackdropClick(dlg, e)) return;
      if (await guarded()) dismiss();
    });
  } else if (dismissable) {
    // il clic sullo sfondo arriva al <dialog> stesso (il contenuto è dentro un figlio)
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dismiss();
    });
  }
  build(dlg, close);
  dlg.showModal();
  return dlg;
}

/** Il clic è fuori dal riquadro del foglio (sullo sfondo scuro)? */
function isBackdropClick(dlg, e) {
  const r = dlg.getBoundingClientRect();
  return e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Trascinamento verso il basso per chiudere un foglio. Parte dalla barra in alto (maniglia e titolo)
 * oppure dal contenuto quando è già in cima. Si chiude oltre il 30 % dell'altezza (max 140 px) o con
 * uno scatto veloce; altrimenti torna su. canClose() → Promise<boolean> (conferma se ci sono modifiche).
 */
function enableSheetSwipe(dlg, canClose, onClose) {
  const INTERACTIVE = 'input, select, textarea, button, a, label, [contenteditable], [role="slider"]';
  let start = null; // {x, y, t, header}
  let dragging = false;
  let dy = 0;
  let last = { y: 0, t: 0 };
  let velocity = 0; // px/ms verso il basso

  const setY = (y, animate) => {
    dlg.style.transition = animate && !reduceMotion() ? 'transform 220ms cubic-bezier(.2,.8,.2,1)' : 'none';
    dlg.style.transform = y > 0 ? `translateY(${y}px)` : '';
  };
  const begin = (x, y, target) => {
    if (target.closest(INTERACTIVE)) { start = null; return; }
    start = { x, y, header: !!target.closest('.sheet-grabber, .sheet-bar') };
    dragging = false;
    dy = 0;
    velocity = 0;
    last = { y, t: performance.now() };
  };
  /** true se il gesto è un trascinamento del foglio (allora il chiamante blocca lo scorrimento). */
  const move = (x, y) => {
    if (!start) return false;
    const ddy = y - start.y;
    if (!dragging) {
      const adx = Math.abs(x - start.x);
      // verso l'alto o di lato: è uno scorrimento normale, non un trascinamento del foglio
      if (ddy < -8 || (adx > 8 && adx > ddy)) { start = null; return false; }
      if (ddy < 8) return false; // zona morta
      if (!start.header && dlg.scrollTop > 0) { start = null; return false; }
      dragging = true;
      dlg.classList.add('is-dragging');
    }
    const now = performance.now();
    if (now > last.t) velocity = (y - last.y) / (now - last.t);
    last = { y, t: now };
    dy = Math.max(0, ddy);
    setY(dy, false);
    return true;
  };
  const end = async () => {
    const was = dragging;
    start = null;
    dragging = false;
    dlg.classList.remove('is-dragging');
    if (!was) return;
    const h = dlg.offsetHeight || 1;
    const far = dy > Math.min(140, h * 0.3) || velocity > 0.6;
    if (!far) { setY(0, true); return; }
    setY(0, true); // torna su mentre (se serve) si chiede conferma
    if (!(await canClose())) return;
    if (reduceMotion()) { onClose(); return; }
    dlg.style.transition = 'transform 200ms ease-in';
    dlg.style.transform = 'translateY(100%)';
    setTimeout(onClose, 200);
  };

  dlg.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { start = null; return; }
    begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
  }, { passive: true });
  dlg.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
  }, { passive: false });
  dlg.addEventListener('touchend', end);
  dlg.addEventListener('touchcancel', end);
  // mouse (computer): stesso gesto con il puntatore
  dlg.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    begin(e.clientX, e.clientY, e.target);
    if (!start) return;
    const onMove = (ev) => { if (move(ev.clientX, ev.clientY)) ev.preventDefault(); };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); end(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

let titleSeq = 0;
const titleId = () => `dlg-title-${++titleSeq}`;

/** "Eliminare X? Conseguenza." → ['Eliminare X?', 'Conseguenza.']: in iOS la domanda è il titolo dell'avviso. */
function splitQuestion(message) {
  const i = message.indexOf('?');
  return i > 0 ? [message.slice(0, i + 1), message.slice(i + 1).trim()] : [null, message];
}

/** Avviso di conferma in stile iOS: titolo (la domanda), messaggio (la conseguenza), Annulla | azione (rossa se distruttiva). */
export function confirmDialog(text, { title, okText = 'Conferma', cancelText = 'Annulla', danger = false } = {}) {
  let message = text;
  if (!title) [title, message] = splitQuestion(text);
  if (!title) { title = message; message = ''; }
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const done = (v) => { close(); resolve(v); };
      const tid = titleId();
      dlg.setAttribute('aria-labelledby', tid);
      dlg.setAttribute('role', 'alertdialog');
      const stacked = okText.length > 12 || cancelText.length > 12;
      dlg.append(
        el('div', { class: 'alert-body' },
          el('h2', { class: 'alert-title', id: tid, tabindex: '-1', autofocus: true, text: title }),
          message ? el('p', { class: 'alert-text', text: message }) : null),
        el('div', { class: `alert-actions${stacked ? ' alert-actions-stack' : ''}` },
          el('button', { type: 'button', class: 'alert-btn', text: cancelText, onclick: () => done(false) }),
          el('button', { type: 'button', class: `alert-btn alert-btn-strong${danger ? ' is-danger' : ''}`, text: okText, onclick: () => done(true) })),
      );
    }, { onCancel: () => resolve(false), kind: 'alert' });
  });
}

/** Foglio d'azione: choices [{value, label, kind:'primary'|'danger'|'secondary'}]; value null = Annulla. */
export function choiceDialog({ title, message, details = [], choices }) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const done = (v) => { close(); resolve(v); };
      const tid = titleId();
      dlg.setAttribute('aria-labelledby', tid);
      const actions = choices.filter((c) => c.value !== null);
      const cancel = choices.find((c) => c.value === null);
      appendChildren(dlg, [
        el('div', { class: 'action-group' },
          el('div', { class: 'action-head' },
            el('h2', { class: 'action-title', id: tid, tabindex: '-1', autofocus: true, text: title }),
            message ? el('p', { class: 'action-text', text: message }) : null,
            details.length ? el('ul', { class: 'action-list' }, details.map((d) => el('li', { text: d }))) : null),
          actions.map((c) => el('button', {
            type: 'button', class: `action-btn${c.kind === 'danger' ? ' is-danger' : ''}${c.kind === 'primary' ? ' is-primary' : ''}`,
            text: c.label, onclick: () => done(c.value),
          }))),
        cancel ? el('div', { class: 'action-group' },
          el('button', { type: 'button', class: 'action-btn action-cancel', text: cancel.label, onclick: () => done(null) })) : null,
      ]);
    }, { onCancel: () => resolve(null), kind: 'action', dismissable: true });
  });
}

/**
 * Foglio di scelta con ricerca: "Annulla · titolo", campo Cerca, elenco di righe da toccare.
 * options: [{value, label, sub?}]; footer: {label, value} riga in fondo (es. "Altri…").
 * Risolve con il value toccato, o null se annullato.
 */
export function pickDialog({ title, subtitle, options, searchPlaceholder = 'Cerca', emptyText = 'Nessun risultato', footer, idPrefix = 'pick' }) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const done = (v) => { close(); resolve(v); };
      const tid = titleId();
      dlg.setAttribute('aria-labelledby', tid);
      const search = el('input', {
        type: 'search', id: `${idPrefix}-search`, class: 'pick-search', placeholder: searchPlaceholder,
        autocomplete: 'off', spellcheck: 'false', 'aria-label': searchPlaceholder, enterkeyhint: 'search',
        'data-nodirty': '', // cercare non è una modifica: chiudere non chiede conferma
      });
      const list = el('ul', { class: 'list grouped pick-list', id: `${idPrefix}-list` });
      const empty = el('p', { class: 'muted pick-empty', id: `${idPrefix}-empty`, hidden: true, text: emptyText });
      const norm = (s) => String(s).toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const paint = () => {
        clear(list);
        const q = norm(search.value.trim());
        const shown = options.filter((o) => !q || norm(o.label).includes(q));
        for (const o of shown) {
          list.append(el('li', {}, el('button', {
            type: 'button', class: 'row', dataset: { value: o.value }, onclick: () => done(o.value),
          }, el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: o.label }),
            o.sub ? el('span', { class: 'row-sub', text: o.sub }) : null), icon('plus-circle', 'pick-plus'))));
        }
        list.hidden = shown.length === 0;
        empty.hidden = shown.length > 0;
      };
      search.addEventListener('input', paint);
      // Invio nella ricerca con un solo risultato: lo sceglie
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = list.querySelectorAll('button.row');
        if (first.length === 1) first[0].click();
      });
      dlg.append(el('div', { class: 'sheet-form' },
        el('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        el('header', { class: 'sheet-bar' },
          el('button', { type: 'button', class: 'sheet-btn', text: 'Annulla', onclick: () => done(null) }),
          sheetTitle(tid, title, subtitle),
          el('span', { class: 'sheet-btn', 'aria-hidden': 'true' })),
        el('div', { class: 'sheet-body' },
          options.length > 6 ? search : null, list, empty,
          footer ? el('div', { class: 'sheet-extra' }, el('button', {
            type: 'button', class: 'btn btn-block btn-secondary', id: `${idPrefix}-footer`, onclick: () => done(footer.value),
          }, icon('plus'), footer.label)) : null)));
      paint();
    }, { onCancel: () => resolve(null), dismissable: true });
  });
}

/**
 * Foglio con modulo. Barra in alto "Annulla · titolo · Salva" come i fogli di iOS.
 * build(body, close) aggiunge i campi; onSubmit() ritorna true per chiudere,
 * false per restare aperto (errori mostrati inline). Risolve true se salvato.
 * extraAction: {label, kind, onClick} → pulsante in fondo (es. "Elimina"); il foglio si chiude prima di onClick.
 */
export function formDialog({ title, subtitle, build, onSubmit, submitText = 'Salva', submitId, extraAction }) {
  return new Promise((resolve) => {
    openDialog((dlg, close) => {
      const tid = titleId();
      dlg.setAttribute('aria-labelledby', tid);
      const form = el('form', { class: 'form sheet-form', novalidate: true });
      const body = el('div', { class: 'sheet-body' });
      const formError = el('p', { class: 'field-error form-error', role: 'alert', hidden: true });
      const submit = el('button', { type: 'submit', class: 'sheet-btn sheet-btn-strong', id: submitId, text: submitText });
      form.append(
        el('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
        el('header', { class: 'sheet-bar' },
          el('button', { type: 'button', class: 'sheet-btn', text: 'Annulla', onclick: () => { close(); resolve(false); } }),
          sheetTitle(tid, title, subtitle),
          submit),
        body);
      build(body, () => { close(); resolve(false); });
      body.append(formError);
      if (extraAction) {
        body.append(el('div', { class: 'sheet-extra' },
          el('button', {
            type: 'button', class: `btn btn-block ${extraAction.kind === 'danger' ? 'btn-destructive' : 'btn-secondary'}`, text: extraAction.label,
            onclick: () => { close(); resolve(false); extraAction.onClick(); },
          })));
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        formError.hidden = true;
        submit.disabled = true;
        try {
          const ok = await onSubmit({ form, setFormError: (m) => { formError.textContent = m; formError.hidden = false; formError.scrollIntoView({ block: 'nearest' }); } });
          if (ok) { close(); resolve(true); }
        } catch (err) {
          if (isUserError(err)) { formError.textContent = err.message; formError.hidden = false; formError.scrollIntoView({ block: 'nearest' }); }
          else { close(); showError(err); resolve(false); }
        } finally {
          submit.disabled = false;
        }
      });
      dlg.append(form);
    }, { onCancel: () => resolve(false), kind: 'sheet' });
  });
}

/** Titolo della barra del foglio su una riga; il sottotitolo (es. lo studio) va sotto, più piccolo. */
function sheetTitle(tid, title, subtitle) {
  const h = el('h2', { class: 'sheet-title', id: tid, tabindex: '-1', autofocus: true, title, text: title });
  if (!subtitle) return h;
  return el('div', { class: 'sheet-titles' }, h, el('p', { class: 'sheet-subtitle', text: subtitle }));
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

/**
 * Righe raggruppate dei fogli (stile Impostazioni iOS): etichetta a sinistra, valore a destra.
 * stacked: etichetta piccola sopra un campo a tutta larghezza (testi liberi). Stessa interfaccia di field().
 */
export function groupRow(labelText, input, { hint, stacked = false, inline = false } = {}) {
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  if (!input.id) input.id = `f-${Math.random().toString(36).slice(2, 9)}`;
  // inline: "Etichetta  [campo a tutta larghezza]" (moduli con testi, es. Sincronizzazione)
  const wrap = el('div', { class: `form-row${stacked ? ' is-stacked' : ''}${inline ? ' is-inline' : ''}` },
    el('label', { class: 'form-row-label', for: input.id, text: labelText }),
    el('div', { class: 'form-row-control' }, input),
    hint ? el('p', { class: 'form-row-hint', text: hint }) : null, err);
  return {
    wrap, input,
    setError(m) { err.textContent = m || ''; err.hidden = !m; },
  };
}

/** Gruppo di righe con sfondo bianco e angoli arrotondati; note: testo grigio sotto il gruppo. */
export function formGroup(...rows) {
  const group = el('div', { class: 'form-group' }, rows);
  return group;
}

/** Nota grigia sotto un gruppo (le spiegazioni non vanno nelle intestazioni maiuscole). */
export function groupNote(text, attrs = {}) {
  return el('p', { class: 'group-note', ...attrs, text });
}

/**
 * Stepper − n + attorno a un input numerico (pazienti, settimane). onChange(value) a ogni passo.
 */
export function stepper(input, { label, min = 0, max = 999, onChange } = {}) {
  input.classList.add('stepper-input');
  const set = (v) => {
    const n = Number.parseInt(String(input.value).trim(), 10);
    input.value = String(Math.min(max, Math.max(min, (Number.isFinite(n) ? n : min) + v)));
    onChange?.(input.value);
  };
  input.addEventListener('input', () => onChange?.(input.value));
  return el('div', { class: 'stepper' },
    el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Meno ${label}`, text: '−', onclick: () => set(-1) }),
    input,
    el('button', { type: 'button', class: 'stepper-btn', 'aria-label': `Più ${label}`, text: '+', onclick: () => set(1) }));
}

export function textDialog({ title, label, value = '', submitText = 'Salva', submitId, inputId, placeholder, onSubmit }) {
  const input = el('input', { type: 'text', maxlength: '60', value, autocomplete: 'off', id: inputId, placeholder });
  return formDialog({
    title, submitText, submitId,
    build: (form) => form.append(formGroup(groupRow(label, input, { stacked: true }).wrap)),
    onSubmit: () => onSubmit(input.value),
  });
}

/** Riga con segno di spunta tondo (come Promemoria di iOS) per le liste a scelta multipla. */
export function checkRow(box, ...content) {
  return el('label', { class: 'check' }, box, el('span', { class: 'check-label' }, content));
}

/**
 * Foglio con caselle (multi-studio). options [{value,label,checked,detail?}].
 * onSubmit(values) → true per chiudere. Con selectAll aggiunge "Seleziona tutti".
 */
export function checkboxDialog({ title, subtitle, intro, note, options, submitText = 'Conferma', selectAll = true, onSubmit, extra }) {
  const boxes = options.map((o) => el('input', { type: 'checkbox', value: o.value, checked: !!o.checked }));
  return formDialog({
    title, subtitle, submitText,
    build: (form) => {
      if (extra) form.append(extra);
      if (intro || (selectAll && options.length > 1)) {
        form.append(el('div', { class: 'section-head' },
          el('span', { class: 'section-title', text: intro || '' }),
          selectAll && options.length > 1 ? el('button', {
            type: 'button', class: 'btn-link section-action', text: 'Seleziona tutti',
            onclick: () => { const all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; }); },
          }) : null));
      }
      // detail: valore grigio a destra (es. l'importo del mese negli Incassi)
      if (options.length) form.append(el('div', { class: 'checklist' }, options.map((o, i) => (o.detail
        ? checkRow(boxes[i], el('span', { text: o.label }), el('span', { class: 'muted check-value', text: o.detail }))
        : checkRow(boxes[i], o.label)))));
      if (note) form.append(el('p', { class: 'group-note', text: note }));
    },
    onSubmit: (ctx) => onSubmit(boxes.filter((b) => b.checked).map((b) => b.value), ctx),
  });
}

// ---------- intestazione della pagina: titolo grande in stile iOS ----------
/**
 * back: [href, testo] → "‹ testo" sopra il titolo; actions: pulsanti a destra del titolo;
 * subtitle: riga grigia sotto il titolo.
 */
export function pageHeader({ title, subtitle, back, actions = [], navAction, id, titleId: tId, lead }) {
  // titoli lunghi (nomi di studi e trattamenti) a corpo ridotto, senza spezzare le parole
  const long = String(title).length > 16 || String(title).split(/\s+/).some((w) => w.length > 13);
  return el('header', { class: 'page-head', id },
    back || navAction ? el('div', { class: 'nav-row' },
      back ? el('a', { class: 'back-link', href: back[0], id: back[2] || null }, icon('chevron-left'), el('span', { text: back[1] })) : el('span'),
      navAction || null) : null,
    el('div', { class: 'page-title-row' },
      el('h2', { class: `large-title${long ? ' is-long' : ''}`, id: tId || null }, lead || null, el('span', { class: 'large-title-text', text: title })),
      offlinePill(),
      actions.length ? el('div', { class: 'page-actions' }, actions) : null),
    subtitle ? el('p', { class: 'page-subtitle', text: subtitle }) : null);
}

/** Pillola "Offline" nella riga del titolo: visibile solo con html.is-offline, non sposta il contenuto. */
export function offlinePill() {
  return el('span', { class: 'offline-pill', 'aria-hidden': 'true' }, icon('cloud-off'), 'Offline');
}

/** Pulsante di testo della barra di navigazione (es. "Rinomina" a destra di "‹ Studi"). */
export function navButton({ text, id, onClick }) {
  return el('button', { type: 'button', class: 'nav-btn', id, onclick: onClick, text });
}

/** Pulsante tondo con sola icona (es. "⋯", "+"), con etichetta per i lettori di schermo. */
export function iconButton({ name, label, id, onClick, href }) {
  const attrs = { class: 'icon-btn', id, 'aria-label': label, title: label };
  return href ? el('a', { ...attrs, href }, icon(name)) : el('button', { ...attrs, type: 'button', onclick: onClick }, icon(name));
}

/** Intestazione di sezione maiuscola grigia, con eventuale azione a destra. */
export function sectionHead(text, action) {
  return el('div', { class: 'section-head' }, el('h3', { class: 'section-title', text }), action || null);
}

// ---------- periodo navigabile: Mese / Anno / Tutto / Personalizzato, con ‹ › ----------
export function newNav(mode = 'mese', anchor = todayISO()) {
  return { mode, anchor, from: null, to: null };
}

/**
 * state: {mode, anchor, from, to}; onChange() dopo ogni modifica.
 * extra: altri filtri (select) mostrati come pillole accanto al periodo.
 */
export function periodNav({ idPrefix, state, onChange, modes = NAV_MODES, extra = [] }) {
  // il tipo di periodo si sceglie toccando l'etichetta ("Novembre 2026 ▾"), come i menu di iOS
  const select = el('select', { id: `${idPrefix}-mode`, 'aria-label': 'Tipo di periodo', class: 'menu-native' },
    modes.map(([v, l]) => el('option', { value: v, text: l, selected: state.mode === v })));
  select.addEventListener('change', () => {
    const prev = { ...state };
    state.mode = select.value;
    if (state.mode === 'personalizzato' && (!state.from || !state.to)) {
      let r = null;
      try { r = prev.mode === 'tutto' ? null : navRange(prev); } catch { r = null; }
      r = r || navRange({ mode: 'mese', anchor: todayISO() });
      state.from = r.from;
      state.to = r.to;
    }
    onChange();
  });
  const wrap = el('div', { class: 'period-nav' });
  const text = state.mode === 'mese' || state.mode === 'anno' ? navLabel(state)
    : state.mode === 'personalizzato' ? 'Periodo personalizzato' : 'Tutto il periodo';
  const menu = el('span', { class: 'nav-menu' },
    el('span', { class: 'nav-label', id: `${idPrefix}-label`, 'aria-live': 'polite', text }), icon('chevron-down', 'nav-menu-caret'), select);
  if (state.mode === 'mese' || state.mode === 'anno') {
    const unit = state.mode === 'mese' ? 'Mese' : 'Anno';
    const move = (d) => { state.anchor = navShift(state, d); onChange(); };
    wrap.append(el('div', { class: 'stepper-nav' },
      el('button', { type: 'button', class: 'icon-btn', id: `${idPrefix}-prev`, 'aria-label': `${unit} precedente`, onclick: () => move(-1) }, icon('chevron-left')),
      menu,
      el('button', { type: 'button', class: 'icon-btn', id: `${idPrefix}-next`, 'aria-label': `${unit} successivo`, onclick: () => move(1) }, icon('chevron'))));
  } else {
    wrap.append(el('div', { class: 'stepper-nav is-static' }, menu));
  }
  if (state.mode === 'personalizzato') {
    const from = el('input', { type: 'date', id: `${idPrefix}-from`, value: state.from || '' });
    const to = el('input', { type: 'date', id: `${idPrefix}-to`, value: state.to || '' });
    from.addEventListener('change', () => { state.from = from.value; onChange(); });
    to.addEventListener('change', () => { state.to = to.value; onChange(); });
    wrap.append(formGroup(groupRow('Dal', from).wrap, groupRow('Al', to).wrap));
  }
  if (extra.length) wrap.append(el('div', { class: 'filter-chips' }, extra));
  return wrap;
}

/**
 * Filtro a pillola larga quanto il valore scelto ("Tutti gli studi ▾"): la select nativa resta
 * sopra la pillola, invisibile, così il menu è quello del sistema e id/eventi non cambiano.
 * active: evidenziata quando il filtro non è su "tutti".
 */
export function menuChip(select, { active = false } = {}) {
  select.classList.add('menu-native');
  const label = el('span', { class: 'chip-menu-label' });
  const paint = () => { label.textContent = select.selectedOptions[0]?.textContent || ''; };
  paint();
  select.addEventListener('change', paint);
  return el('span', { class: `chip-menu${active ? ' is-active' : ''}` }, label, icon('chevron-down', 'chip-menu-caret'), select);
}

/** Select a pillola per i filtri (con menuChip); evidenziata quando non è sul valore "tutti". */
export function chipSelect(attrs, options, active) {
  return menuChip(el('select', attrs, options), { active });
}

/** Intervallo del periodo: {range, previous} oppure {error}. */
export function resolveNav(state) {
  try {
    return { range: navRange(state), previous: previousRange(state) };
  } catch (err) {
    if (err?.name === 'PeriodError') return { error: err.message };
    throw err;
  }
}

// ---------- chip, colori, icone ----------
/** Pallino del colore dello studio (decorativo). */
export function studioDot(studio) {
  return el('span', { class: `studio-dot studio-${studioColorKey(studio)}`, 'aria-hidden': 'true' });
}

/**
 * Gruppo di chip a scelta singola. options: [{value, label, pressed, studio?, badge?}].
 */
export function chipGroup({ label, id, options, onPick, cls = '' }) {
  return el('div', { class: `chips ${cls}`.trim(), role: 'group', 'aria-label': label, id },
    options.map((o) => el('button', {
      type: 'button', class: `chip${o.studio ? ` chip-studio studio-${studioColorKey(o.studio)}` : ''}`, 'aria-pressed': String(!!o.pressed), id: o.id,
      onclick: () => onPick(o.value),
    }, o.studio ? studioDot(o.studio) : null, el('span', { class: 'chip-text', text: o.label }),
    o.pressed && o.studio ? icon('check', 'chip-check') : null,
    o.badge ? el('span', { class: 'chip-badge', text: o.badge }) : null)));
}

/** Controllo segmentato iOS: options [[value, label, id?]]; aria-pressed sul segmento attivo. */
export function segmented({ label, id, options, value, onPick }) {
  return el('div', { class: 'segmented', role: 'group', 'aria-label': label, id },
    options.map(([v, l, bid]) => el('button', {
      type: 'button', id: bid || (id ? `${id}-${v}` : null), 'aria-pressed': String(v === value), text: l,
      onclick: () => { if (v !== value) onPick(v); },
    })));
}

/** Icona SVG statica (decorativa). */
export function icon(name, cls = '') {
  const span = el('span', { class: `icon-wrap icon-${name}${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true' });
  span.innerHTML = iconSvg(name, name === 'chevron' ? 'icon chevron' : 'icon');
  return span;
}

/**
 * Riquadro icona colorato (§3.4 dello spec): color = blue|teal|green|indigo|red|orange|mint|sky|purple|gray.
 * size: 'sm' (30, righe), 'md' (44, card), 'lg' (56, stati vuoti); filled: glifo bianco su colore pieno.
 */
export function iconTile(name, color = 'blue', { size = 'sm', filled = false } = {}) {
  const span = el('span', { class: `tile-ic tile-ic-${size} sec-${color}${filled ? ' is-filled' : ''}`, 'aria-hidden': 'true' });
  span.innerHTML = iconSvg(name);
  return span;
}

/** Stato vuoto: riquadro icona, titolo, testo, azione. */
export function emptyState({ iconName = 'list', color = 'blue', title, text, action, id }) {
  return el('div', { class: 'empty-state', id },
    iconTile(iconName, color, { size: 'lg', filled: true }),
    el('h3', { class: 'empty-title', text: title }),
    text ? el('p', { class: 'empty-text', text }) : null,
    action || null);
}

/** Badge "Archiviato" (studi e trattamenti), sempre nella riga del sottotitolo: il nome resta intero. */
export function archivedBadge(text = 'Archiviato') {
  return el('span', { class: 'badge badge-archived', text });
}

/** Area di testo senza maniglia che cresce col contenuto (minimo le righe di rows). */
export function autoGrow(textarea) {
  textarea.classList.add('auto-grow');
  const fit = () => {
    textarea.style.height = 'auto';
    if (textarea.scrollHeight) textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener('input', fit);
  // misura dopo l'inserimento nel DOM (prima scrollHeight vale 0)
  requestAnimationFrame(fit);
  return textarea;
}

/** Indicatore "c'è una nota" visibile a colpo d'occhio, con testo per gli screen reader. */
export function noteBadge() {
  return el('span', { class: 'note-badge', title: 'Nota presente' }, icon('note'), el('span', { class: 'visually-hidden', text: 'Nota presente' }));
}

/** Riga di lista toccabile (link o pulsante) con titolo, sottotitolo, valore e freccia. */
export function listRow({ href, onClick, title, subtitle, value, lead, id, extra }) {
  const body = [
    lead || null,
    el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: title }), subtitle ? el('span', { class: 'row-sub', text: subtitle }) : null, extra || null),
    value !== undefined && value !== null ? el('span', { class: 'row-value', text: value }) : null,
    icon('chevron'),
  ];
  const node = href
    ? el('a', { class: 'row', href, id }, body)
    : el('button', { type: 'button', class: 'row', id, onclick: onClick }, body);
  return el('li', {}, node);
}

/** Barra di avanzamento sottile (decorativa: il valore va scritto anche nel testo). */
export function progressBar(fraction, cls = '') {
  const outer = el('span', { class: `progress ${cls}`.trim(), 'aria-hidden': 'true' });
  const inner = el('span', { class: 'progress-fill' });
  inner.style.setProperty('--p', String(Math.max(0, Math.min(1, fraction))));
  outer.append(inner);
  return outer;
}

// ---------- calendario mensile ----------
/** Intestazione ‹ mese › per le griglie. */
export function monthNav({ idPrefix, ym, onChange }) {
  return el('div', { class: 'stepper-nav month-nav' },
    el('span', { class: 'nav-label', id: `${idPrefix}-label`, 'aria-live': 'polite', text: monthLabel(ym) }),
    el('div', { class: 'month-nav-btns' },
      el('button', { type: 'button', class: 'icon-btn', id: `${idPrefix}-prev`, 'aria-label': 'Mese precedente', onclick: () => onChange(addMonths(ym, -1)) }, icon('chevron-left')),
      el('button', { type: 'button', class: 'icon-btn', id: `${idPrefix}-next`, 'aria-label': 'Mese successivo', onclick: () => onChange(addMonths(ym, 1)) }, icon('chevron'))));
}

/**
 * Griglia del mese (lunedì per primo). dayInfo(iso) → {marks: Node[], desc: string, missing: bool}.
 * onPick(iso) al tocco; selected: Set di date evidenziate.
 */
export function monthGrid({ idPrefix, ym, dayInfo, onPick, selected = new Set(), today = todayISO() }) {
  const dates = monthDates(ym);
  const grid = el('div', { class: 'cal-grid', role: 'group', 'aria-label': monthLabel(ym) });
  for (const w of WEEKDAYS_SHORT) grid.append(el('span', { class: 'cal-wd', 'aria-hidden': 'true', text: w.charAt(0).toUpperCase() }));
  for (let i = 1; i < weekdayISO(dates[0]); i++) grid.append(el('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
  for (const iso of dates) {
    const info = dayInfo(iso) || {};
    const cls = ['cal-day'];
    if (iso === today) cls.push('is-today');
    if (iso < today) cls.push('is-past');
    if (selected.has(iso)) cls.push('is-selected');
    if (info.missing) cls.push('is-missing');
    if (weekdayISO(iso) >= 6) cls.push('is-weekend');
    const label = [formatLong(iso), info.desc].filter(Boolean).join(': ');
    grid.append(el('button', {
      type: 'button', class: cls.join(' '), id: `${idPrefix}-${iso}`, 'aria-label': label, 'aria-pressed': String(selected.has(iso)),
      onclick: () => onPick(iso),
    }, el('span', { class: 'cal-num', text: String(Number(iso.slice(8, 10))) }), el('span', { class: 'cal-marks' }, info.marks || [])));
  }
  return grid;
}

/** Segno rosso dei dati mancanti (decorativo: il testo è nell'aria-label del giorno). */
export function missingMark() {
  return el('span', { class: 'missing-mark', 'aria-hidden': 'true' });
}
// ---------- dialog di modifica inserimento ----------
export function studioLabel(s) {
  return s.archived ? `${s.name} (archiviato)` : s.name;
}

export function entryEditDialog(store, entry) {
  const tAll = store.getTreatments();
  const tName = tAll.find((t) => t.id === entry.treatmentId)?.name ?? 'Trattamento eliminato';
  const studios = store.getStudios({ includeArchived: true });
  const date = el('input', { type: 'date', id: 'edit-date', value: entry.date });
  const studio = el('select', { id: 'edit-studio' }, studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === entry.studioId })));
  if (!studios.some((s) => s.id === entry.studioId)) studio.prepend(el('option', { value: '', text: 'Studio eliminato', selected: true }));
  const treatment = el('select', { id: 'edit-treatment' });
  const patients = el('input', { type: 'number', id: 'edit-patients', inputmode: 'numeric', min: '1', max: '999', value: String(entry.patients) });
  const amount = el('input', { type: 'text', id: 'edit-amount', inputmode: 'decimal', placeholder: '0,00', value: formatEuroCsv(entry.amountCents), autocomplete: 'off' });
  const fDate = groupRow('Data', date);
  const fStudio = groupRow('Studio', studio);
  const fTreatment = groupRow('Trattamento', treatment);
  const fPatients = groupRow('Pazienti', stepper(patients, { label: 'un paziente', min: 1 }));
  fPatients.wrap.querySelector('label').htmlFor = patients.id;
  const fAmount = groupRow('Importo totale', el('span', { class: 'amount-input' }, amount));
  fAmount.wrap.querySelector('label').htmlFor = amount.id;

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
    extraAction: {
      label: 'Elimina inserimento', kind: 'danger',
      onClick: async () => {
        const pz = `${entry.patients} ${entry.patients === 1 ? 'paziente' : 'pazienti'}`;
        if (!(await confirmDialog(`${tName} · ${pz} · ${formatEuro(entry.amountCents)}`, { title: 'Eliminare l\'inserimento?', okText: 'Elimina', danger: true }))) return;
        try {
          undoToast(store, 'Inserimento eliminato', store.deleteEntry(entry.id));
        } catch (err) {
          showError(err);
        }
      },
    },
    build: (form) => form.append(
      formGroup(fTreatment.wrap, fPatients.wrap, fAmount.wrap),
      formGroup(fDate.wrap, fStudio.wrap)),
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
    return !!(navigator.canShare && navigator.canShare({ files: Array.isArray(file) ? file : [file] }));
  } catch {
    return false;
  }
}

/**
 * Condivide uno o più file con il foglio di condivisione del sistema.
 * Se il browser rifiuta la condivisione (es. Chrome su computer: "Permission denied" per il tipo di file)
 * i file vengono scaricati, così l'esportazione non fallisce mai.
 */
export async function shareFile(file, title) {
  const files = Array.isArray(file) ? file : [file];
  const download = () => {
    for (const f of files) downloadBlob(f, f.name);
    toast(files.length === 1 ? 'Condivisione non disponibile qui: file scaricato' : 'Condivisione non disponibile qui: file scaricati');
  };
  if (!canShareFile(files)) { download(); return; }
  try {
    await navigator.share({ files, title });
  } catch (err) {
    if (err?.name === 'AbortError') return; // l'utente ha chiuso il foglio di condivisione
    if (err?.name === 'NotAllowedError' || err?.name === 'TypeError' || err?.name === 'DataError') { download(); return; }
    showError(err);
  }
}

/** Nome di file lungo accorciato al centro ("DentalFl…2026-10-31.csv"): inizio e data finale restano leggibili. */
export function middleTruncate(name, max = 23) {
  if (name.length <= max) return name;
  const tail = Math.round((max - 1) * 0.64); // "2026-10-31.csv": la data di fine resta intera
  return `${name.slice(0, max - 1 - tail)}…${name.slice(-tail)}`;
}

/**
 * Foglio con più file pronti: una riga per file (titolo = studio, sottotitolo = periodo e righe,
 * o in mancanza il nome del file accorciato; nome intero nel title e nelle etichette dei pulsanti)
 * con "Scarica" tinto a destra (e l'icona Condividi se possibile), così ogni download parte da un tocco.
 * files: File[] oppure [{file, title, sub?}].
 */
export function filesDialog({ title, intro, files }) {
  const items = files.map((f) => (f instanceof Blob ? { file: f, title: f.name } : f));
  const all = items.map((it) => it.file);
  openDialog((dlg, close) => {
    const tid = titleId();
    dlg.setAttribute('aria-labelledby', tid);
    const rows = items.map(({ file: f, title: t, sub }) => {
      const dl = el('button', {
        type: 'button', class: 'btn btn-secondary btn-small file-dl', text: 'Scarica', 'aria-label': `Scarica ${f.name}`,
        onclick: () => { downloadBlob(f, f.name); dl.textContent = 'Scaricato'; dl.classList.add('is-done'); },
      });
      return el('li', { class: 'file-row' },
        iconTile('csv', 'green'),
        el('span', { class: 'row-main', title: f.name },
          el('span', { class: 'row-title', text: t }),
          el('span', { class: 'row-sub file-name', text: sub || middleTruncate(f.name) })),
        canShareFile(f) ? el('button', { type: 'button', class: 'icon-btn file-share', 'aria-label': `Condividi ${f.name}`, title: 'Condividi', onclick: () => shareFile(f, f.name) }, icon('share')) : null,
        dl);
    });
    let shareAll = false;
    try {
      shareAll = !!(navigator.canShare && navigator.canShare({ files: all }));
    } catch { /* non supportato */ }
    appendChildren(dlg, [
      el('div', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
      el('header', { class: 'sheet-bar' },
        el('span', { 'aria-hidden': 'true' }),
        sheetTitle(tid, title),
        el('button', { type: 'button', class: 'sheet-btn sheet-btn-strong', id: 'files-close', text: 'Chiudi', onclick: close })),
      el('div', { class: 'sheet-body' },
        intro ? el('p', { class: 'sheet-intro', text: intro }) : null,
        el('ul', { class: 'list grouped', id: 'files-list' }, rows),
        shareAll ? el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'files-share-all', text: 'Condividi tutti', onclick: () => shareFile(all, title) }) : null),
    ]);
  }, { kind: 'sheet', dismissable: true });
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
