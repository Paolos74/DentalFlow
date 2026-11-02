// Calendario di lavoro: griglia del mese, ripetizioni per studio, giorni singoli, esportazione .ics.
// Unico editor del calendario (#calendario, con ?studio=<id> per filtrare uno studio).
import {
  el, clear, toast, showError, confirmDialog, choiceDialog, formDialog, field, chipGroup, monthNav, monthGrid,
  studioDot, missingMark, icon, studioLabel, downloadBlob, canShareFile, shareFile,
  pageHeader, iconButton, iconTile, emptyState, groupRow, formGroup, groupNote, stepper, sectionHead, archivedBadge,
} from '../ui.js';
import {
  todayISO, isValidISODate, formatLong, formatDayTitle, formatDayShort, weekdayISO, addDays, monthDates, WEEKDAYS_LONG, MONTHS_LONG,
} from '../dates.js';
import {
  scheduleBetween, missingDays, occurrences, describeRule, describePattern, formatTime, NTH_LABELS,
} from '../calendar.js';
import { buildIcs } from '../ics.js';

const state = { ym: todayISO().slice(0, 7), studioId: '', selectedDay: null, multi: false, picked: new Set(), lastQuery: null };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  const q = ctx.query?.get('studio') || '';
  if (q !== state.lastQuery) {
    state.lastQuery = q;
    if (q) state.studioId = q;
  }
  const studios = store.getStudios();
  const allStudios = store.getStudios({ includeArchived: true });
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  const filtered = studios.filter((s) => !state.studioId || s.id === state.studioId);
  const filteredById = Object.fromEntries(filtered.map((s) => [s.id, s]));
  const cal = store.getCalendar();

  container.append(pageHeader({
    title: 'Calendario', back: ['#altro', 'Altro', 'cal-back'],
    subtitle: 'I giorni in cui lavori in ogni studio',
    actions: [iconButton({ name: 'more', label: 'Altre azioni del calendario', id: 'cal-more', onClick: () => moreMenu(ctx) })],
  }));

  if (studios.length === 0) {
    container.append(el('div', { class: 'card' }, emptyState({
      iconName: 'calendar', color: 'red', title: 'Prima uno studio',
      text: 'Il calendario dice in quale studio lavori ogni giorno: aggiungi prima uno studio.',
      action: el('a', { href: '#altro/studi', class: 'btn btn-primary', text: 'Aggiungi uno studio' }),
    })));
    return;
  }

  container.append(chipGroup({
    label: 'Studio', id: 'cal-studios', cls: 'filter-chips filterbar',
    options: [{ value: '', label: 'Tutti', pressed: !state.studioId, id: 'cal-studio-all' },
      ...studios.map((s) => ({ value: s.id, label: s.name, studio: s, pressed: s.id === state.studioId, id: `cal-studio-${s.id}` }))],
    onPick: (v) => { state.studioId = v; ctx.rerender(); },
  }));

  // griglia del mese
  const dates = monthDates(state.ym);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const today = todayISO();
  const sched = scheduleBetween(cal, from, to, { studiosById: filteredById });
  const entries = store.getEntries({ from, to });
  const missing = missingDays({ cal, entries, from, to, today, studiosById: filteredById });
  const missingByDate = new Map();
  for (const m of missing) missingByDate.set(m.date, [...(missingByDate.get(m.date) || []), m]);

  const grid = monthGrid({
    idPrefix: 'cal-day', ym: state.ym, today,
    selected: state.multi ? state.picked : new Set(state.selectedDay ? [state.selectedDay] : []),
    onPick: (iso) => {
      if (state.multi) {
        if (state.picked.has(iso)) state.picked.delete(iso); else state.picked.add(iso);
      } else {
        state.selectedDay = state.selectedDay === iso ? null : iso;
      }
      ctx.rerender();
    },
    dayInfo: (iso) => {
      const items = sched.get(iso) || [];
      const miss = missingByDate.get(iso) || [];
      if (!items.length) return {};
      return {
        missing: miss.length > 0,
        desc: [items.map((x) => `${x.studioName}${x.time ? ` ${formatTime(x.time)}` : ''}`).join(', '), miss.length ? 'dati mancanti' : null].filter(Boolean).join('; '),
        marks: [...items.map((x) => studioDot(filteredById[x.studioId])), miss.length ? missingMark() : null],
      };
    },
  });
  container.append(el('div', { class: 'card', id: 'cal-month' },
    monthNav({ idPrefix: 'cal-month', ym: state.ym, onChange: (v) => { state.ym = v; state.selectedDay = null; ctx.rerender(); } }),
    grid,
    el('p', { class: 'cal-legend' },
      el('span', {}, el('span', { class: 'legend-dots', 'aria-hidden': 'true' }, filtered.slice(0, 3).map((x) => studioDot(x))), 'colore dello studio'),
      el('span', {}, missingMark(), 'passato, senza dati')),
    el('div', { class: 'cal-toolbar' },
      el('button', {
        type: 'button', class: 'btn btn-small btn-secondary', id: 'cal-multi', 'aria-pressed': String(state.multi),
        text: state.multi ? 'Fine selezione' : 'Seleziona più giorni',
        onclick: () => { state.multi = !state.multi; state.picked = new Set(); state.selectedDay = null; ctx.rerender(); },
      }))));

  if (state.multi) container.append(multiPanel(ctx, studios));
  else if (state.selectedDay && state.selectedDay.slice(0, 7) === state.ym) {
    container.append(dayPanel(ctx, state.selectedDay, sched.get(state.selectedDay) || [], missingByDate.get(state.selectedDay) || [], cal, studios));
  }

  // le ripetizioni si gestiscono nella scheda di ogni studio (Altro → Studi)
  const target = state.studioId ? `#altro/studi/${encodeURIComponent(state.studioId)}` : '#altro/studi';
  container.append(el('p', { class: 'hint cal-rules-hint', id: 'cal-rules-hint' },
    'I giorni che si ripetono si impostano nella scheda di ogni studio. ',
    el('a', { href: target, class: 'btn-link', id: 'cal-open-studio', text: state.studioId ? 'Apri lo studio' : 'Vai a Studi' })));

  // giorni singoli
  const days = cal.days.filter((d) => !state.studioId || d.studioId === state.studioId);
  const upcoming = days.filter((d) => d.date >= today);
  const pastCount = days.length - upcoming.length;
  const daysCard = el('section', { class: 'card', id: 'cal-days' },
    el('div', { class: 'card-head' }, iconTile('calendar-day', 'red'), el('h3', { text: 'Giorni singoli' })));
  if (upcoming.length === 0) daysCard.append(el('p', { class: 'muted', text: 'Nessun giorno singolo in programma. Tocca un giorno nella griglia per aggiungerlo.' }));
  else {
    const ul = el('ul', { class: 'list grouped' });
    for (const d of upcoming) {
      const s = allStudios.find((x) => x.id === d.studioId);
      // la riga apre il foglio "Modifica giorno singolo", che ha anche "Elimina giorno"
      ul.append(el('li', {}, el('button', {
        type: 'button', class: 'row', dataset: { day: d.id }, 'aria-label': `Modifica il giorno ${formatLong(d.date)}, ${s ? s.name : 'studio eliminato'}`,
        onclick: () => workDayDialog(ctx, d),
      }, s ? studioDot(s) : null,
      el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: formatDayShort(d.date) }),
        el('span', { class: 'row-sub', text: [s ? s.name : 'Studio eliminato', d.time ? formatTime(d.time) : null].filter(Boolean).join(' · ') })),
      icon('chevron'))));
    }
    daysCard.append(ul);
  }
  if (pastCount) daysCard.append(el('p', { class: 'hint', text: `${plural(pastCount, 'giorno singolo passato', 'giorni singoli passati')} (visibili nella griglia).` }));
  container.append(daysCard);
}

/** Foglio "Giorno singolo": studio, data e orario modificabili; elimina. */
function workDayDialog(ctx, d) {
  const { store } = ctx;
  const all = store.getStudios({ includeArchived: true });
  const s = all.find((x) => x.id === d.studioId);
  const choosable = all.filter((x) => !x.archived || x.id === d.studioId);
  const sel = el('select', { id: 'wday-studio' }, choosable.map((x) => el('option', { value: x.id, text: studioLabel(x), selected: x.id === d.studioId })));
  const date = el('input', { type: 'date', id: 'wday-date', value: d.date });
  const fDate = groupRow('Data', date);
  const t = timeInputs('wday-time', d.time);
  formDialog({
    title: 'Modifica giorno singolo',
    build: (form) => form.append(formGroup(groupRow('Studio', sel).wrap, fDate.wrap), ...t.blocks),
    extraAction: { label: 'Elimina giorno', kind: 'danger', onClick: () => removeSingle(ctx, d, s) },
    onSubmit: () => {
      fDate.setError('');
      if (!isValidISODate(date.value)) { fDate.setError('Data non valida'); return false; }
      store.updateWorkDay(d.id, { studioId: sel.value, date: date.value, time: t.read() });
      toast('Giorno aggiornato');
      return true;
    },
  });
}

async function removeSingle(ctx, d, s) {
  if (!(await confirmDialog(`${formatDayTitle(d.date, { withYear: true })} · ${s ? s.name : 'studio eliminato'}. I dati già inseriti restano.`, { title: 'Eliminare il giorno singolo?', okText: 'Elimina', danger: true }))) return;
  try {
    ctx.store.removeWorkDay(d.id);
    toast('Giorno eliminato');
  } catch (err) {
    showError(err);
  }
}

function dayPanel(ctx, iso, items, miss, cal, studios) {
  const { store } = ctx;
  const card = el('section', { class: 'card', id: 'cal-day-panel' }, el('h3', { text: formatDayTitle(iso, { withYear: true }) }));
  if (items.length === 0) card.append(el('p', { class: 'muted', text: 'Nessuno studio previsto.' }));
  const ul = el('ul', { class: 'list' });
  for (const it of items) {
    const sources = it.sources.map((src) => {
      if (src.type === 'day') return 'giorno singolo';
      const r = cal.rules.find((x) => x.id === src.id);
      return r ? describePattern(r).toLowerCase() : 'ripetizione';
    });
    const isMissing = miss.some((m) => m.studioId === it.studioId);
    const single = it.sources.find((src) => src.type === 'day');
    const singleDay = single ? cal.days.find((x) => x.id === single.id) : null;
    ul.append(el('li', { class: 'list-item' },
      el('div', { class: 'item-head' },
        el('span', { class: 'item-title' }, studioDot(studios.find((s) => s.id === it.studioId)), it.studioName),
        it.time ? el('span', { class: 'item-meta', text: formatTime(it.time) }) : null),
      el('div', { class: 'item-meta' }, isMissing ? missingMark() : null, isMissing ? ' Dati mancanti · ' : '', `Da ${sources.join(' e ')}`),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Inserisci', onclick: () => ctx.go('inserisci', { date: iso, studioId: it.studioId }) }),
        singleDay ? el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Modifica', 'aria-label': `Modifica il giorno singolo ${formatLong(iso)}, ${it.studioName}`, onclick: () => workDayDialog(ctx, singleDay) }) : null,
        el('button', {
          type: 'button', class: 'btn btn-secondary btn-small', text: 'Togli questo giorno',
          onclick: async () => {
            if (!(await confirmDialog(`${formatDayTitle(iso)} · ${it.studioName}. Le altre date della ripetizione restano.`, { title: 'Togliere il giorno dal calendario?', okText: 'Togli il giorno', danger: true }))) return;
            try {
              store.unscheduleDay(iso, it.studioId);
              toast('Giorno tolto dal calendario');
            } catch (err) {
              showError(err);
            }
          },
        }))));
  }
  card.append(ul, el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'cal-add-single', onclick: () => singleDaysDialog(ctx, [iso], studios) }, icon('plus'), 'Aggiungi un giorno singolo'));
  return card;
}

function multiPanel(ctx, studios) {
  const picked = [...state.picked].sort();
  return el('section', { class: 'card', id: 'cal-multi-panel', role: 'status' },
    el('p', { class: 'multi-text', text: picked.length ? `${plural(picked.length, 'giorno selezionato', 'giorni selezionati')}: ${picked.map(formatDayShort).join(', ')}` : 'Tocca i giorni nella griglia (anche di mesi diversi).' }),
    el('button', {
      type: 'button', class: 'btn btn-primary btn-block', id: 'cal-multi-add', text: 'Aggiungi per uno studio', disabled: picked.length === 0,
      onclick: () => singleDaysDialog(ctx, picked, studios, () => { state.multi = false; state.picked = new Set(); }),
    }));
}

function timeInputs(prefix, time) {
  const from = el('input', { type: 'time', id: `${prefix}-from`, value: time?.from || '', step: '300' });
  const to = el('input', { type: 'time', id: `${prefix}-to`, value: time?.to || '', step: '300' });
  const read = () => (from.value || to.value ? { from: from.value, to: to.value } : null);
  const blocks = [sectionHead('Orario (facoltativo)'), formGroup(groupRow('Dalle', from).wrap, groupRow('Alle', to).wrap),
    groupNote('Solo informativo: compare in Oggi e nel calendario.')];
  return { blocks, read, from, to };
}

function singleDaysDialog(ctx, dates, studios, onDone) {
  const { store } = ctx;
  const sel = el('select', { id: 'single-studio' }, studios.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === state.studioId })));
  const t = timeInputs('single-time', null);
  formDialog({
    title: dates.length === 1 ? 'Giorno singolo' : `Aggiungi ${plural(dates.length, 'giorno', 'giorni')}`,
    submitText: 'Aggiungi',
    build: (form) => form.append(
      dates.length === 1 ? el('p', { class: 'sheet-intro', text: formatDayTitle(dates[0], { withYear: true }) }) : null,
      formGroup(groupRow('Studio', sel).wrap), ...t.blocks),
    onSubmit: () => {
      const ids = store.addWorkDays(sel.value, dates, t.read());
      toast(ids.length ? `${plural(ids.length, 'giorno aggiunto', 'giorni aggiunti')} al calendario` : 'Questi giorni erano già nel calendario');
      onDone?.();
      return true;
    },
  });
}

// ---------- foglio della ripetizione ----------
const TYPES = [['weekly', 'Ogni settimana'], ['monthly-date', 'Ogni mese, stesso giorno'], ['monthly-pos', 'Ogni mese, es. il primo lunedì'], ['yearly', 'Ogni anno']];

/**
 * Foglio "Nuova/Modifica ripetizione". Si apre dalla scheda dello studio (studioId fisso).
 * Ogni settimana: più giorni nella stessa ripetizione, ognuno con il suo orario facoltativo.
 */
export function ruleDialog(ctx, rule, { studioId } = {}) {
  const { store } = ctx;
  const all = store.getStudios({ includeArchived: true });
  const fixedId = studioId || rule?.studioId;
  const fixed = all.find((s) => s.id === fixedId);
  const startDefault = rule?.start || todayISO();
  const wd0 = weekdayISO(startDefault);
  const day0 = Number(startDefault.slice(8, 10));

  const studio = el('input', { type: 'hidden', id: 'rule-studio', value: fixedId || '' });
  const type = el('select', { id: 'rule-type' }, TYPES.map(([v, l]) => el('option', { value: v, text: l, selected: v === (rule?.type || 'weekly') })));
  const wdBoxes = WEEKDAYS_LONG.map((name, i) => el('input', { type: 'checkbox', value: String(i + 1), checked: rule?.type === 'weekly' ? rule.weekdays.includes(i + 1) : i + 1 === wd0 }));
  const interval = el('input', { type: 'number', id: 'rule-interval', min: '1', max: '52', inputmode: 'numeric', value: String(rule?.interval || 1), 'aria-label': 'Ogni quante settimane' });
  const monthDay = el('input', { type: 'number', id: 'rule-monthday', min: '1', max: '31', inputmode: 'numeric', value: String(rule?.monthDay || day0) });
  const nth = el('select', { id: 'rule-nth' }, [1, 2, 3, 4, -1].map((n) => el('option', { value: String(n), text: NTH_LABELS[String(n)], selected: n === (rule?.nth ?? Math.min(4, Math.ceil(day0 / 7))) })));
  const posWd = el('select', { id: 'rule-pos-weekday' }, WEEKDAYS_LONG.map((n, i) => el('option', { value: String(i + 1), text: n, selected: i + 1 === (rule?.weekday || wd0) })));
  const yDay = el('select', { id: 'rule-year-day' }, Array.from({ length: 31 }, (_, i) => el('option', { value: String(i + 1), text: String(i + 1), selected: i + 1 === (rule?.day || day0) })));
  const yMonth = el('select', { id: 'rule-year-month' }, MONTHS_LONG.map((n, i) => el('option', { value: String(i + 1), text: n, selected: i + 1 === (rule?.month || Number(startDefault.slice(5, 7))) })));
  const start = el('input', { type: 'date', id: 'rule-start', value: startDefault });
  const endType = el('select', { id: 'rule-end' }, [['never', 'Mai'], ['until', 'Fino al'], ['count', 'Dopo un numero di volte']].map(([v, l]) => el('option', { value: v, text: l, selected: v === (rule?.end?.type || 'never') })));
  const until = el('input', { type: 'date', id: 'rule-until', value: rule?.end?.type === 'until' ? rule.end.date : '' });
  const count = el('input', { type: 'number', id: 'rule-count', min: '1', max: '999', inputmode: 'numeric', value: String(rule?.end?.type === 'count' ? rule.end.count : 10) });
  const t = timeInputs('rule-time', rule?.time);
  const preview = el('p', { class: 'group-note rule-preview', id: 'rule-preview', 'aria-live': 'polite' });

  // orario per ogni giorno della settimana (solo "Ogni settimana")
  const dayTime = (d) => (rule?.type === 'weekly' ? rule.dayTimes?.[String(d)] || rule.time : null) || null;
  const dayRows = WEEKDAYS_LONG.map((name, i) => {
    const d = i + 1;
    const from = el('input', { type: 'time', id: `rule-dt-${d}-from`, value: dayTime(d)?.from || '', step: '300', 'aria-label': `${name}, dalle` });
    const to = el('input', { type: 'time', id: `rule-dt-${d}-to`, value: dayTime(d)?.to || '', step: '300', 'aria-label': `${name}, alle` });
    // etichetta corta (Lun, Mer…) così i due orari hanno spazio anche su un telefono stretto
    const row = groupRow(name.charAt(0).toUpperCase() + name.slice(1, 3),
      el('span', { class: 'time-pair' }, from, el('span', { class: 'muted', 'aria-hidden': 'true', text: '–' }), to));
    row.wrap.classList.add('is-time-row');
    row.wrap.querySelector('label').htmlFor = from.id;
    return { d, from, to, row };
  });
  const copyBtn = el('button', {
    type: 'button', class: 'btn btn-small btn-secondary', id: 'rule-dt-copy', text: 'Stesso orario per tutti i giorni',
    onclick: () => {
      const shown = dayRows.filter((x) => wdBoxes[x.d - 1].checked);
      const src = shown.find((x) => x.from.value || x.to.value);
      if (!src) return;
      for (const x of shown) { x.from.value = src.from.value; x.to.value = src.to.value; }
      refresh();
    },
  });
  const dayTimesBlock = el('div', { class: 'rule-group', id: 'rule-daytimes' },
    sectionHead('Orari (facoltativi)'),
    formGroup(...dayRows.map((x) => x.row.wrap)),
    el('div', { class: 'toolbar' }, copyBtn),
    groupNote('Ogni giorno può avere il suo orario. Solo informativo: compare in Oggi e nel calendario.'));
  const timeBlocks = el('div', { class: 'rule-group', id: 'rule-time-general' }, ...t.blocks);

  const intervalRow = groupRow('Ogni', el('span', { class: 'stepper-with-unit' },
    stepper(interval, { label: 'una settimana', min: 1, max: 52 }), el('span', { class: 'muted', text: 'sett.' })));
  intervalRow.wrap.querySelector('label').htmlFor = interval.id;
  const groups = {
    weekly: el('div', { class: 'rule-group' },
      el('fieldset', { class: 'weekday-list form-group' }, el('legend', { class: 'visually-hidden', text: 'Giorni della settimana' }),
        el('div', { class: 'wd-pills' }, WEEKDAYS_LONG.map((n, i) => el('label', { class: 'wd-pill', title: n },
          wdBoxes[i], el('span', { 'aria-hidden': 'true', text: n.charAt(0).toUpperCase() }), el('span', { class: 'visually-hidden', text: n }))))),
      formGroup(intervalRow.wrap),
      groupNote('1 = tutte le settimane, 2 = una settimana sì e una no.')),
    'monthly-date': el('div', { class: 'rule-group' }, formGroup(groupRow('Giorno del mese', monthDay).wrap),
      groupNote('Se un mese non ha quel giorno (es. 31), quel mese viene saltato.')),
    'monthly-pos': el('div', { class: 'rule-group' }, formGroup(groupRow('Quale', nth).wrap, groupRow('Giorno', posWd).wrap)),
    yearly: el('div', { class: 'rule-group' }, formGroup(groupRow('Giorno', yDay).wrap, groupRow('Mese', yMonth).wrap)),
  };
  const untilField = groupRow('Data di fine', until);
  const countField = groupRow('Numero di volte', count);

  const read = () => {
    const ty = type.value;
    const input = { studioId: studio.value, type: ty, start: start.value, time: t.read() };
    if (ty === 'weekly') {
      input.weekdays = wdBoxes.filter((b) => b.checked).map((b) => Number(b.value));
      input.interval = Number(interval.value);
      input.time = null;
      input.dayTimes = {};
      for (const x of dayRows) {
        if (!input.weekdays.includes(x.d) || (!x.from.value && !x.to.value)) continue;
        input.dayTimes[String(x.d)] = { from: x.from.value, to: x.to.value };
      }
    } else if (ty === 'monthly-date') input.monthDay = Number(monthDay.value);
    else if (ty === 'monthly-pos') Object.assign(input, { nth: Number(nth.value), weekday: Number(posWd.value) });
    else Object.assign(input, { day: Number(yDay.value), month: Number(yMonth.value) });
    input.end = endType.value === 'until' ? { type: 'until', date: until.value }
      : endType.value === 'count' ? { type: 'count', count: Number(count.value) } : { type: 'never' };
    return input;
  };
  const refresh = () => {
    for (const [k, g] of Object.entries(groups)) g.hidden = k !== type.value;
    const weeklyType = type.value === 'weekly';
    dayTimesBlock.hidden = !weeklyType;
    timeBlocks.hidden = weeklyType;
    let shownDays = 0;
    for (const x of dayRows) {
      x.row.wrap.hidden = !wdBoxes[x.d - 1].checked;
      if (!x.row.wrap.hidden) shownDays += 1;
    }
    copyBtn.hidden = shownDays < 2;
    untilField.wrap.hidden = endType.value !== 'until';
    countField.wrap.hidden = endType.value !== 'count';
    const r = { ...read(), exdates: rule?.exdates || [] };
    if (!isValidISODate(r.start)) { preview.textContent = ''; return; }
    try {
      const fromD = r.start > todayISO() ? r.start : todayISO();
      const next = occurrences(r, fromD, addDays(fromD, 800)).slice(0, 5);
      preview.textContent = next.length ? `Prossime date: ${next.map(formatDayShort).join(', ')}` : 'Nessuna data futura con queste impostazioni.';
    } catch {
      preview.textContent = '';
    }
  };

  formDialog({
    title: rule ? 'Modifica ripetizione' : 'Nuova ripetizione',
    submitText: rule ? 'Salva' : 'Aggiungi',
    build: (form) => {
      form.append(studio,
        fixed ? el('p', { class: 'sheet-intro' }, studioDot(fixed), ` ${fixed.name}`) : null,
        formGroup(groupRow('Si ripete', type).wrap), ...Object.values(groups),
        dayTimesBlock, timeBlocks,
        sectionHead('Durata'), formGroup(groupRow('Dal', start).wrap, groupRow('Fine', endType).wrap, untilField.wrap, countField.wrap),
        preview);
      form.addEventListener('input', refresh);
      form.addEventListener('change', refresh);
      refresh();
    },
    extraAction: rule ? {
      label: 'Elimina ripetizione', kind: 'danger',
      onClick: async () => {
        if (!(await confirmDialog(`«${describePattern(rule)}». I dati già inseriti restano.`, { title: 'Eliminare la ripetizione?', okText: 'Elimina', danger: true }))) return;
        try {
          store.deleteRule(rule.id);
          toast('Ripetizione eliminata');
        } catch (err) {
          showError(err);
        }
      },
    } : undefined,
    onSubmit: () => {
      const input = read();
      if (rule) store.updateRule(rule.id, input);
      else store.addRule(input);
      toast(rule ? 'Ripetizione aggiornata' : 'Ripetizione aggiunta');
      return true;
    },
  });
}

// ---------- menu secondario: esportazione .ics ----------
async function moreMenu(ctx) {
  const choice = await choiceDialog({
    title: 'Calendario',
    choices: [
      { value: 'ics', label: 'Esporta nel calendario del telefono', kind: 'primary' },
      { value: null, label: 'Annulla', kind: 'secondary' },
    ],
  });
  if (choice === 'ics') icsDialog(ctx);
}

async function icsDialog(ctx) {
  const { store } = ctx;
  const cal = store.getCalendar();
  const studiosById = Object.fromEntries(store.getStudios({ includeArchived: true }).map((s) => [s.id, s]));
  if (cal.rules.length + cal.days.length === 0) { toast('Il calendario è vuoto', { type: 'error' }); return; }
  const text = buildIcs({ rules: cal.rules, days: cal.days, studiosById });
  const file = new File([text], 'DentalFlow-calendario.ics', { type: 'text/calendar' });
  const canShare = canShareFile(file);
  const choice = await choiceDialog({
    title: 'Esporta nel calendario del telefono',
    message: 'Crea un file .ics con i tuoi giorni di lavoro (le ripetizioni restano ripetizioni). '
      + 'Su iPhone aprilo e tocca «Aggiungi tutti». Su Android dipende dall\'app calendario: alcune lo aprono direttamente, '
      + 'Google Calendar lo importa dal sito calendar.google.com (Impostazioni → Importa). '
      + 'Se poi cambi il calendario qui, esporta di nuovo.',
    choices: [
      { value: 'download', label: 'Scarica il file .ics', kind: 'primary' },
      canShare ? { value: 'share', label: 'Condividi…', kind: 'secondary' } : null,
      { value: null, label: 'Annulla', kind: 'secondary' },
    ].filter(Boolean),
  });
  if (choice === 'download') { downloadBlob(file, file.name); toast('File del calendario esportato'); }
  if (choice === 'share') shareFile(file, file.name);
}
