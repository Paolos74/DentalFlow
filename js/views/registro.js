// Registro: elenco per giornata (data + studio) o vista mese, con modifica ed eliminazione di ogni campo.
import {
  el, clear, toast, showError, confirmDialog, entryEditDialog, periodNav, resolveNav, field, studioLabel, newNav,
  formDialog, undoToast, studioDot, noteBadge, monthNav, monthGrid, missingMark, icon,
  pageHeader, segmented, emptyState, menuChip, groupRow, formGroup, groupNote, sectionHead, archivedBadge, autoGrow,
} from '../ui.js';
import {
  formatDayTitle, formatDayShort, todayISO, isValidISODate, monthDates, navLabel, monthLabel,
} from '../dates.js';
import { formatEuro, sumCents } from '../money.js';
import { perPatient } from '../aggregate.js';
import { missingDays } from '../calendar.js';
import { MAX_NOTE } from '../store.js';

const state = { view: 'elenco', nav: newNav('mese'), studioId: '', treatmentId: '', selectedDay: null };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pazShort = (n) => `${n} paz.`;

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  // il periodo è scritto una volta sola, nel selettore sotto (niente sottotitolo che lo ripete)
  container.append(pageHeader({ title: 'Registro' }));

  const studios = store.getStudios({ includeArchived: true });
  const treatments = store.getTreatments();
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  if (state.treatmentId && !treatments.some((t) => t.id === state.treatmentId)) state.treatmentId = '';
  const studiosById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const treatmentsById = Object.fromEntries(treatments.map((t) => [t.id, t]));

  container.append(segmented({
    label: 'Vista', id: 'reg-view', value: state.view,
    options: [['elenco', 'Elenco', 'reg-view-elenco'], ['mese', 'Mese', 'reg-view-mese']],
    onPick: (v) => {
      state.view = v;
      if (v === 'mese' && state.nav.mode !== 'mese') state.nav = { ...newNav('mese', state.nav.mode === 'anno' ? state.nav.anchor : todayISO()) };
      ctx.rerender();
    },
  }));

  const studioSel = el('select', { id: 'reg-studio', 'aria-label': 'Studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });
  const treatSel = el('select', { id: 'reg-treatment', 'aria-label': 'Trattamento' },
    el('option', { value: '', text: 'Tutti i trattamenti' }),
    treatments.map((t) => el('option', { value: t.id, text: t.name, selected: t.id === state.treatmentId })));
  treatSel.addEventListener('change', () => { state.treatmentId = treatSel.value; ctx.rerender(); });
  const studioChip = menuChip(studioSel, { active: !!state.studioId });
  const treatChip = menuChip(treatSel, { active: !!state.treatmentId });

  if (state.view === 'mese') {
    renderMonth(container, ctx, { studios, studiosById, treatmentsById, studioChip });
    return;
  }

  const filters = el('div', { class: 'filterbar' },
    periodNav({ idPrefix: 'reg-period', state: state.nav, onChange: () => ctx.rerender(), extra: [studioChip, treatChip] }));
  container.append(filters);

  const { range, error } = resolveNav(state.nav);
  if (error) {
    filters.append(el('p', { class: 'field-error', role: 'alert', text: error }));
    return;
  }

  const entries = store.getEntries({ from: range.from, to: range.to, studioId: state.studioId || undefined, treatmentId: state.treatmentId || undefined });
  const noteList = store.getNotes({ from: range.from, to: range.to, studioId: state.studioId || undefined });
  const notes = new Map(noteList.map((n) => [`${n.date}|${n.studioId}`, n.text]));

  // gruppi per giornata: data (dalla più recente) e studio
  const groups = [];
  const byKey = new Map();
  const groupOf = (date, sid) => {
    const k = `${date}|${sid}`;
    if (!byKey.has(k)) {
      const g = { date, studioId: sid, entries: [] };
      byKey.set(k, g);
      groups.push(g);
    }
    return byKey.get(k);
  };
  for (const e of entries) groupOf(e.date, e.studioId).entries.push(e);
  // giornate con la sola nota (senza righe): visibili anche in Elenco, se non si filtra per trattamento
  if (!state.treatmentId) for (const n of noteList) groupOf(n.date, n.studioId);
  if (groups.length === 0) {
    container.append(el('div', { class: 'card' }, emptyState({
      iconName: 'list', color: 'teal', title: 'Nessun inserimento',
      text: 'Nel periodo selezionato non ci sono giornate registrate.',
      action: store.getStudios().length ? el('a', { href: '#inserisci', class: 'btn btn-primary', text: 'Inserisci la giornata' }) : null,
    })));
    return;
  }
  groups.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  const card = el('div', { class: 'day-list', id: 'reg-list' });
  for (const g of groups) card.append(dayGroup(ctx, g, { studiosById, treatmentsById, hasNote: notes.has(`${g.date}|${g.studioId}`), noteText: notes.get(`${g.date}|${g.studioId}`) }));
  const totalPatients = entries.reduce((n, e) => n + e.patients, 0);
  const totalCents = sumCents(entries.map((e) => e.amountCents));
  container.append(el('div', { class: 'day-total', id: 'reg-totals' },
    el('span', { class: 'row-main' },
      el('strong', { class: 'row-title', text: 'Totale' }),
      el('span', { class: 'row-sub', text: `${plural(entries.length, 'inserimento', 'inserimenti')} · ${plural(totalPatients, 'paziente', 'pazienti')}` })),
    el('span', { class: 'amount', text: formatEuro(totalCents) })));
  container.append(card);
}

/** inPanel: dentro il pannello del giorno la data è già nel titolo, la testata mostra solo lo studio. */
function dayGroup(ctx, g, { studiosById, treatmentsById, hasNote, noteText, inPanel = false }) {
  const { store } = ctx;
  const s = studiosById[g.studioId];
  const sName = s ? s.name : 'Studio eliminato';
  const badge = s?.archived ? archivedBadge() : null;
  const dayCents = sumCents(g.entries.map((e) => e.amountCents));
  const head = el('button', {
    type: 'button', class: 'day-head', dataset: { day: `${g.date}|${g.studioId}` },
    'aria-label': `${formatDayTitle(g.date, { withYear: true })}, ${sName}${badge ? ' (archiviato)' : ''}, ${formatEuro(dayCents)}${hasNote ? ', nota presente' : ''}: modifica giornata`,
    onclick: () => dayDialog(ctx, g.date, g.studioId),
  },
  s ? studioDot(s) : null,
  el('span', { class: 'day-title' },
    el('span', { class: 'day-date', text: inPanel ? sName : formatDayShort(g.date) }),
    inPanel ? (badge ? el('span', { class: 'day-sub' }, badge) : null) : el('span', { class: 'day-sub' }, el('span', { text: sName }), badge)),
  hasNote ? noteBadge() : null,
  el('span', { class: 'amount', text: formatEuro(dayCents) }),
  icon('chevron'));
  const list = el('ul', { class: 'list rows' });
  // righe dello stesso trattamento una sotto l'altra (come "Riga 2" in Inserisci), nell'ordine di inserimento
  const firstAt = new Map();
  g.entries.forEach((e, i) => { if (!firstAt.has(e.treatmentId)) firstAt.set(e.treatmentId, i); });
  const rows = g.entries.map((e, i) => ({ e, i }))
    .sort((a, b) => firstAt.get(a.e.treatmentId) - firstAt.get(b.e.treatmentId) || (a.e.createdAt ?? 0) - (b.e.createdAt ?? 0) || a.i - b.i)
    .map((x) => x.e);
  for (const e of rows) {
    const tName = treatmentsById[e.treatmentId]?.name ?? 'Trattamento eliminato';
    list.append(el('li', { class: 'list-item' },
      el('button', {
        type: 'button', class: 'row', onclick: () => entryEditDialog(store, e),
        'aria-label': `${tName}, ${plural(e.patients, 'paziente', 'pazienti')}, ${formatEuro(e.amountCents)}: modifica`,
      },
      el('span', { class: 'row-main' },
        el('span', { class: 'row-title', text: tName }),
        el('span', { class: 'row-sub', text: `${pazShort(e.patients)} · ${formatEuro(perPatient(e.amountCents, e.patients))}/paz.` })),
      el('span', { class: 'row-value amount', text: formatEuro(e.amountCents) }),
      icon('chevron'))));
  }
  const noteOnly = g.entries.length === 0 && noteText
    ? el('p', { class: 'note-only' }, noteBadge(), el('span', { text: `Solo nota: ${noteText}` }))
    : null;
  return el('section', { class: 'day-group' }, head, g.entries.length ? list : noteOnly);
}

/** Foglio "Modifica giornata": nota, sposta data/studio di tutte le righe, apri in Inserisci, elimina. */
export function dayDialog(ctx, date, studioId) {
  const { store } = ctx;
  const studios = store.getStudios({ includeArchived: true });
  const studio = studios.find((s) => s.id === studioId);
  const entries = store.getEntries({ from: date, to: date, studioId });
  const savedNote = store.getNote(date, studioId) || '';
  const dateIn = el('input', { type: 'date', id: 'day-date', value: date });
  const studioSel = el('select', { id: 'day-studio' }, studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === studioId })));
  const noteIn = el('textarea', { id: 'day-note', rows: '3', maxlength: String(MAX_NOTE), placeholder: 'Es. pagati in contanti, manca fattura…' });
  noteIn.value = savedNote;
  autoGrow(noteIn);
  const fDate = groupRow('Data', dateIn);
  const fStudio = groupRow('Studio', studioSel);
  const fNote = groupRow('Nota', noteIn, { stacked: true });
  const total = sumCents(entries.map((e) => e.amountCents));
  const patients = entries.reduce((n, e) => n + e.patients, 0);
  const label = `${formatDayTitle(date, { withYear: true })} · ${studio ? studio.name : 'Studio eliminato'}`;
  return formDialog({
    title: 'Modifica giornata',
    build: (form, closeDialog) => {
      form.append(el('p', { class: 'sheet-intro' }, el('strong', { text: label }), studio?.archived ? archivedBadge() : null, el('br'),
        `${plural(entries.length, 'riga', 'righe')} · ${plural(patients, 'paziente', 'pazienti')} · ${formatEuro(total)}`));
      if (studio && !studio.archived) {
        form.append(el('button', {
          type: 'button', class: 'btn btn-secondary btn-block', id: 'day-open-insert', text: 'Modifica le righe in Inserisci',
          onclick: () => { closeDialog(); ctx.go('inserisci', { date, studioId }); },
        }));
      }
      form.append(formGroup(fNote.wrap), groupNote('La nota non entra nel CSV per lo studio.'),
        sectionHead('Sposta la giornata'), formGroup(fDate.wrap, fStudio.wrap),
        groupNote('Cambia data o studio per spostare tutte le righe della giornata.'));
    },
    extraAction: entries.length || savedNote ? {
      label: 'Elimina giornata', kind: 'danger',
      onClick: async () => {
        if (!(await confirmDialog(`${label}: ${plural(entries.length, 'riga', 'righe')}, ${formatEuro(total)}${savedNote ? ' e la nota' : ''}.`, { title: 'Eliminare la giornata?', okText: 'Elimina giornata', danger: true }))) return;
        try {
          undoToast(store, 'Giornata eliminata', store.deleteDayEntries(date, studioId));
        } catch (err) {
          showError(err);
        }
      },
    } : undefined,
    onSubmit: () => {
      fDate.setError('');
      if (!isValidISODate(dateIn.value)) { fDate.setError('Data non valida'); return false; }
      const text = noteIn.value.trim();
      // nota e spostamento in un'unica operazione: se lo spostamento non è possibile non cambia niente
      const moved = store.moveDayEntries({ date, studioId }, { date: dateIn.value, studioId: studioSel.value },
        { note: text !== savedNote ? text : undefined });
      toast(moved ? 'Giornata spostata' : 'Giornata aggiornata');
      return true;
    },
  });
}

function renderMonth(container, ctx, { studios, studiosById, treatmentsById, studioChip }) {
  const { store } = ctx;
  const ym = state.nav.anchor.slice(0, 7);
  const dates = monthDates(ym);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const today = todayISO();
  const entries = store.getEntries({ from, to, studioId: state.studioId || undefined });
  const activeById = Object.fromEntries(studios.filter((s) => !state.studioId || s.id === state.studioId).map((s) => [s.id, s]));
  const missing = missingDays({ cal: store.getCalendar(), entries, from, to, today, studiosById: activeById });
  const notes = store.getNotes({ from, to, studioId: state.studioId || undefined });
  const byDate = new Map();
  const ensure = (d) => { if (!byDate.has(d)) byDate.set(d, { entries: [], missing: [], notes: [] }); return byDate.get(d); };
  for (const e of entries) ensure(e.date).entries.push(e);
  for (const m of missing) ensure(m.date).missing.push(m);
  for (const n of notes) ensure(n.date).notes.push(n);

  container.append(el('div', { class: 'filterbar' }, el('div', { class: 'filter-chips' }, studioChip)));

  const grid = monthGrid({
    idPrefix: 'reg-day', ym, today,
    selected: new Set(state.selectedDay ? [state.selectedDay] : []),
    onPick: (iso) => { state.selectedDay = state.selectedDay === iso ? null : iso; ctx.rerender(); },
    dayInfo: (iso) => {
      const d = byDate.get(iso);
      if (!d) return {};
      const sids = [...new Set(d.entries.map((e) => e.studioId))];
      const cents = sumCents(d.entries.map((e) => e.amountCents));
      const desc = [];
      if (sids.length) desc.push(`${sids.map((id) => studiosById[id]?.name ?? 'Studio eliminato').join(', ')} ${formatEuro(cents)}`);
      if (d.missing.length) desc.push(`dati mancanti: ${d.missing.map((m) => m.studioName).join(', ')}`);
      if (d.notes.length) desc.push('nota presente');
      return {
        missing: d.missing.length > 0,
        desc: desc.join('; '),
        marks: [
          ...sids.map((id) => studioDot(studiosById[id] || { id })),
          d.missing.length ? missingMark() : null,
          d.notes.length ? noteBadge() : null,
          sids.length ? el('span', { class: 'cal-amount', 'aria-hidden': 'true', text: `${Math.round(cents / 100)} €` }) : null,
        ],
      };
    },
  });
  const monthTotal = sumCents(entries.map((e) => e.amountCents));
  container.append(el('div', { class: 'card', id: 'reg-month-card' },
    monthNav({ idPrefix: 'reg-month', ym, onChange: (v) => { state.nav.anchor = `${v}-01`; state.selectedDay = null; ctx.rerender(); } }),
    grid,
    el('p', { class: 'cal-legend' },
      el('span', {}, `Totale del mese: `, el('strong', { class: 'amount', text: formatEuro(monthTotal) })),
      el('span', {}, missingMark(), 'previsto senza dati'),
      el('span', {}, noteBadge(), 'nota'))));

  if (state.selectedDay && state.selectedDay.slice(0, 7) === ym) {
    container.append(dayPanel(ctx, state.selectedDay, byDate.get(state.selectedDay), { studiosById, treatmentsById, notes }));
  }
}

function dayPanel(ctx, iso, info, { studiosById, treatmentsById, notes }) {
  const { store } = ctx;
  const card = el('div', { class: 'card', id: 'reg-day-panel' }, el('h3', { text: formatDayTitle(iso, { withYear: true }) }));
  const d = info || { entries: [], missing: [], notes: [] };
  const groups = new Map();
  for (const e of d.entries) {
    if (!groups.has(e.studioId)) groups.set(e.studioId, { date: iso, studioId: e.studioId, entries: [] });
    groups.get(e.studioId).entries.push(e);
  }
  const noteKeys = new Set(notes.map((n) => `${n.date}|${n.studioId}`));
  for (const g of groups.values()) card.append(dayGroup(ctx, g, { studiosById, treatmentsById, hasNote: noteKeys.has(`${iso}|${g.studioId}`), inPanel: true }));
  for (const n of d.notes) {
    if (groups.has(n.studioId)) continue;
    card.append(el('div', { class: 'note-only' }, noteBadge(), el('span', { text: `${studiosById[n.studioId]?.name ?? 'Studio eliminato'}: ${n.text}` }),
      el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Modifica', onclick: () => dayDialog(ctx, iso, n.studioId) })));
  }
  for (const m of d.missing) {
    card.append(el('div', { class: 'missing-row list-item' }, missingMark(),
      el('span', { class: 'row-main', text: `${m.studioName}: previsto dal calendario, da compilare` }),
      el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Inserisci', onclick: () => ctx.go('inserisci', { date: iso, studioId: m.studioId }) })));
  }
  if (groups.size === 0 && d.missing.length === 0) {
    card.append(el('p', { class: 'muted', text: 'Nessun inserimento in questo giorno.' }));
  }
  if (store.getStudios().length) {
    card.append(el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'reg-day-insert', text: 'Inserisci per questo giorno', onclick: () => ctx.go('inserisci', { date: iso }) }));
  }
  return card;
}
