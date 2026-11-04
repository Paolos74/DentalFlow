// Recap: numeri chiave del periodo con confronto, studi, trattamenti, giornate, anno; esportazione CSV.
// Le sezioni Grafici (#recap/grafici) e Tasse (#recap/tasse) sono in grafici.js e tasse.js.
import {
  el, clear, periodNav, resolveNav, studioLabel, downloadBlob, canShareFile, shareFile, toast, newNav, formDialog,
  checkboxDialog, studioDot, showError, filesDialog, pageHeader, emptyState, iconTile, checkRow, sectionHead,
  menuChip, choiceDialog, icon, groupNote, archivedBadge, listRow,
} from '../ui.js';
import { formatEuro, formatPct, parseEuroInput, formatEuroCsv } from '../money.js';
import {
  summarize, kpis, changeTenths, daysByStudio, yearRecap, perPatient, unpaidByStudio, paymentMonths,
} from '../aggregate.js';
import { buildStudioCsv, buildAllStudiosCsv, csvFileName, CSV_FORMATS } from '../csv.js';
import {
  todayISO, navLabel, navShift, monthLabel, addMonths, monthToDate, shiftYear, capitalize, formatSpan,
} from '../dates.js';
import { hasSchedule, missingDays, scheduleBetween, earliestDate } from '../calendar.js';
import * as grafici from './grafici.js';
import * as tasse from './tasse.js';
import { BOLLO_SOGLIA } from '../tax.js';
import { missingList } from './oggi.js';
import { studioColorKey } from '../colors.js';

const state = { nav: newNav('mese'), studioId: '' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function segmentedLinks(active) {
  return el('nav', { class: 'seg-links', 'aria-label': 'Sezioni del recap' },
    el('a', { href: '#recap', id: 'recap-tab-numeri', 'aria-current': active === 'numeri' ? 'page' : null, text: 'Numeri' }),
    el('a', { href: '#recap/grafici', id: 'recap-tab-grafici', 'aria-current': active === 'grafici' ? 'page' : null, text: 'Grafici' }),
    el('a', { href: '#recap/tasse', id: 'recap-tab-tasse', 'aria-current': active === 'tasse' ? 'page' : null, text: 'Tasse' }));
}

function changeText(cur, prev, prevLabel) {
  const c = changeTenths(cur, prev);
  if (c === null) return prev === 0 && cur > 0 ? `nuovo rispetto ${prevLabel}` : '';
  const arrow = c > 0 ? '▲' : c < 0 ? '▼' : '=';
  return `${arrow} ${formatPct(Math.abs(c))} rispetto ${prevLabel}`;
}

/** Variazione compatta per le pillole dei numeri chiave ("▲ 8,0 %"); senza confronto niente pillola. */
function shortChange(cur, prev) {
  const c = changeTenths(cur, prev);
  if (c === null) return '';
  return `${c > 0 ? '▲' : c < 0 ? '▼' : '='} ${formatPct(Math.abs(c))}`;
}

function changeClass(cur, prev) {
  const c = changeTenths(cur, prev);
  // "nuovo" (nessun dato da confrontare) resta grigio: non è un miglioramento
  if (c === null) return '';
  return c > 0 ? ' is-up' : c < 0 ? ' is-down' : '';
}

/** ['2026-10','2026-09','2025-12'] → "ott, set 2026 · dic 2025" (mesi abbreviati, raggruppati per anno). */
function shortMonths(list) {
  const byYear = new Map();
  for (const ym of list) {
    const y = ym.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(monthLabel(ym).slice(0, 3));
  }
  return [...byYear].map(([y, ms]) => `${ms.join(', ')} ${y}`).join(' · ');
}

function progressRatio(n, total) {
  return bar(total ? Math.round((n * 1000) / total) : 0);
}

function bar(tenths) {
  const outer = el('span', { class: 'share-bar', 'aria-hidden': 'true' });
  const inner = el('span', { class: 'share-fill' });
  inner.style.width = `${Math.max(0, Math.min(100, tenths / 10))}%`;
  outer.append(inner);
  return outer;
}

function previousLabel(nav) {
  if (nav.mode === 'mese') return monthLabel(navShift(nav, -1).slice(0, 7));
  if (nav.mode === 'anno') return navShift(nav, -1).slice(0, 4);
  return 'periodo precedente';
}

export function render(container, ctx) {
  clear(container);
  const sub = ['grafici', 'tasse'].includes(ctx.path?.[0]) ? ctx.path[0] : 'numeri';
  container.append(pageHeader({ title: 'Recap' }));
  container.append(segmentedLinks(sub));
  if (sub === 'grafici') {
    grafici.renderInto(container, ctx);
    return;
  }
  if (sub === 'tasse') {
    tasse.renderInto(container, ctx);
    return;
  }
  const params = ctx.takeParams?.();
  if (params?.month) {
    // dalla card principale di Oggi: recap del mese indicato, tutti gli studi
    state.nav = newNav('mese', `${params.month}-01`);
    state.studioId = '';
  }
  renderNumbers(container, ctx);
  if (params?.export) exportDialog(ctx);
}

function renderNumbers(container, ctx) {
  const { store } = ctx;
  const studios = store.getStudios({ includeArchived: true });
  if (state.studioId && !studios.some((s) => s.id === state.studioId)) state.studioId = '';
  const studio = studios.find((s) => s.id === state.studioId) || null;
  const studiosById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));

  const studioSel = el('select', { id: 'rie-studio', 'aria-label': 'Studio' },
    el('option', { value: '', text: 'Tutti gli studi' }),
    studios.map((s) => el('option', { value: s.id, text: studioLabel(s), selected: s.id === state.studioId })));
  studioSel.addEventListener('change', () => { state.studioId = studioSel.value; ctx.rerender(); });

  const filters = el('div', { class: 'filterbar' },
    periodNav({ idPrefix: 'rie-period', state: state.nav, onChange: () => ctx.rerender(), extra: [menuChip(studioSel, { active: !!state.studioId })] }));
  container.append(filters);
  // con un solo studio le azioni dello studio stanno qui (niente card "Studio" che ripete i numeri)
  if (!studio) {
    container.append(el('section', { class: 'card export-cta', id: 'rie-export' },
      iconTile('csv', 'green', { size: 'md', filled: true }),
      el('span', { class: 'reminder-text' }, el('strong', { text: 'CSV per gli studi' }), el('span', { text: 'Un file per studio, da aprire in Excel' })),
      el('button', { type: 'button', class: 'btn btn-secondary btn-small', id: 'rie-export-all', text: 'Esporta', 'aria-label': 'Esporta CSV per gli studi', disabled: studios.length === 0, onclick: () => exportDialog(ctx) })));
  }

  const { range, previous, error } = resolveNav(state.nav);
  if (error) {
    filters.append(el('p', { class: 'field-error', role: 'alert', text: error }));
    return;
  }
  const sid = state.studioId || undefined;
  const entries = store.getEntries({ from: range.from, to: range.to, studioId: sid });
  // periodo in corso: confronto con lo stesso punto del periodo precedente
  const today = todayISO();
  const ongoing = previous && range.from <= today && today <= range.to && (state.nav.mode === 'mese' || state.nav.mode === 'anno');
  if (ongoing) previous.to = state.nav.mode === 'mese' ? monthToDate(today).previous.to : shiftYear(today, -1);
  const prevEntries = previous ? store.getEntries({ from: previous.from, to: previous.to, studioId: sid }) : null;

  // da incassare: tutti i mesi con inserimenti fino a oggi, qualunque sia il periodo mostrato
  const toToday = store.getEntries({ to: today, studioId: sid });
  const unpaid = unpaidByStudio(toToday, store.getPayments());
  if (studio) {
    container.append(el('ul', { class: 'list grouped', id: 'rie-studio-actions', 'aria-label': `Azioni di ${studio.name}` },
      listRow({ id: 'rie-export-studio', title: 'Esporta CSV', subtitle: studio.archived ? 'Studio archiviato' : 'Il file da mandare allo studio', lead: iconTile('csv', 'green'), onClick: () => exportDialog(ctx) }),
      listRow({ id: 'rie-payments', title: 'Incassi', subtitle: 'Segna i mesi pagati', lead: iconTile('wallet', 'orange'), onClick: () => paymentsDialog(ctx, studio, toToday) })));
  }

  if (entries.length === 0) {
    container.append(el('div', { class: 'card', id: 'rie-empty' }, emptyState({
      iconName: 'chart', color: 'green', title: 'Nessun dato', text: 'Nel periodo selezionato non ci sono inserimenti.',
    })));
    appendUnpaid(container, ctx, { unpaid, studiosById, toToday });
    appendDays(container, ctx, { range, studiosById });
    return;
  }

  // numeri chiave
  const k = kpis(entries);
  // senza dati nel periodo di confronto niente pillole: una sola nota lo dice
  const p = prevEntries?.length ? kpis(prevEntries) : null;
  const prevName = previousLabel(state.nav);
  const of = state.nav.mode === 'anno' ? 'del' : 'di';
  const pl = ongoing ? `allo stesso punto ${of} ${prevName}` : state.nav.mode === 'anno' ? `al ${prevName}` : state.nav.mode === 'mese' ? `a ${prevName}` : 'al periodo precedente';
  // nel periodo in corso il confronto copre solo lo stesso punto: la nota non parla del periodo intero
  const noDataOf = ongoing ? `allo stesso punto ${of} ${prevName}` : state.nav.mode === 'mese' || state.nav.mode === 'anno' ? `${of} ${prevName}` : 'del periodo precedente';
  const tile = (id, label, value, cur, prev) => el('div', { class: 'kpi', id },
    el('span', { class: 'kpi-label', text: label }),
    el('strong', { class: 'kpi-value', text: value }),
    p ? el('span', { class: `kpi-change${changeClass(cur, prev)}`, 'aria-label': changeText(cur, prev, pl) || null, text: shortChange(cur, prev) }) : null);
  container.append(el('section', { class: 'kpi-section', id: 'rie-kpis', 'aria-label': 'Numeri chiave' },
    sectionHead(`${{ personalizzato: 'Periodo scelto', tutto: 'Tutto il periodo' }[state.nav.mode] || navLabel(state.nav)}${studio ? ` · ${studio.name}` : ''}`),
    el('div', { class: 'kpi-grid' },
      tile('rie-kpi-cents', 'Incasso', formatEuro(k.cents), k.cents, p?.cents),
      tile('rie-kpi-patients', 'Pazienti', String(k.patients), k.patients, p?.patients),
      tile('rie-kpi-days', 'Giorni lavorati', String(k.days), k.days, p?.days),
      tile('rie-kpi-pp', 'Media per paziente', formatEuro(k.perPatient), k.perPatient, p?.perPatient),
      tile('rie-kpi-pd', 'Media per giornata', formatEuro(k.perDay), k.perDay, p?.perDay)),
    p ? el('p', { class: 'kpi-note', id: 'rie-kpi-note', text: `Variazioni rispetto ${pl}.` })
      : prevEntries ? el('p', { class: 'kpi-note', id: 'rie-kpi-note', text: `Nessun dato ${noDataOf} da confrontare.` }) : null));

  const sum = summarize(entries, { studiosById, treatmentsById });

  // studi (con il filtro su uno studio la card ripeterebbe i numeri chiave)
  const days = daysByStudio(entries);
  const unpaidPeriod = unpaidByStudio(entries, store.getPayments());
  if (!studio) {
    const studioCards = el('section', { class: 'card', id: 'rie-studios' }, el('h3', { text: 'Per studio' }));
    const ul = el('ul', { class: 'list grouped studio-rows' });
    for (const r of sum.byStudio) {
      const s = studiosById[r.studioId];
      const share = sum.totalCents ? Math.round((r.cents * 1000) / sum.totalCents) : 0;
      const due = unpaid.get(r.studioId) || 0;
      const duePeriod = unpaidPeriod.get(r.studioId) || 0;
      const meta = `${plural(r.patients, 'paziente', 'pazienti')} · ${plural(days.get(r.studioId) || 0, 'giorno', 'giorni')} · ${formatPct(share)}`;
      // gli importi da incassare sono nella card "Da incassare" (tutti i mesi) e nel foglio dello studio
      const body = [
        el('span', { class: 'studio-row-head' },
          s ? studioDot(s) : null,
          el('span', { class: 'row-title', text: r.name }),
          el('span', { class: 'amount', text: formatEuro(r.cents) }),
          s ? icon('chevron') : null),
        el('span', { class: 'row-sub studio-row-sub' }, r.archived ? archivedBadge() : null, el('span', { text: meta })),
        bar(share),
      ];
      ul.append(el('li', { class: `studio-card${s ? ` studio-${studioColorKey(s)}` : ''}`, dataset: { studio: r.name } },
        s ? el('button', {
          type: 'button', class: 'row studio-row', 'aria-label': `${r.name}${r.archived ? ' (archiviato)' : ''}: ${formatEuro(r.cents)}, ${meta}. Azioni`,
          onclick: () => studioSheet(ctx, s, { range, toToday, due, duePeriod, cents: r.cents }),
        }, body) : el('div', { class: 'row studio-row' }, body)));
    }
    studioCards.append(ul);
    container.append(studioCards);
  }
  appendUnpaid(container, ctx, { unpaid, studiosById, toToday });

  // trattamenti
  const tl = el('ul', { class: 'list' });
  for (const r of sum.byTreatment) {
    tl.append(el('li', { class: 'list-item', dataset: { treatment: r.name } },
      el('div', { class: 'item-head' }, el('span', { class: 'item-title', text: r.name }), el('span', { class: 'amount', text: formatEuro(r.cents) })),
      el('div', { class: 'item-meta', text: `${plural(r.patients, 'paziente', 'pazienti')} · ${formatEuro(perPatient(r.cents, r.patients))}/paziente · ${formatPct(r.pctTenths)}` }),
      bar(r.pctTenths)));
  }
  container.append(el('section', { class: 'card', id: 'rie-treatments' },
    el('h3', { text: studio ? `Trattamenti · ${studio.name}` : 'Trattamenti · tutti gli studi' }),
    tl,
    el('div', { class: 'item-head total-line', id: 'rie-total' },
      el('strong', { text: `Totale: ${plural(sum.totalPatients, 'paziente', 'pazienti')}` }),
      el('strong', { class: 'amount', text: formatEuro(sum.totalCents) }))));

  appendDays(container, ctx, { range, studiosById });
  appendYear(container, ctx, { treatmentsById });
}

/** Giornate lavorate rispetto a quelle previste dal calendario (fino a ieri), con le mancanti. */
function appendDays(container, ctx, { range, studiosById }) {
  const { store } = ctx;
  const cal = store.getCalendar();
  if (!hasSchedule(cal)) return;
  const today = todayISO();
  const from = range.from || earliestDate(cal);
  const to = range.to && range.to < today ? range.to : today;
  if (!from || from > to) return;
  const filterById = state.studioId ? { [state.studioId]: studiosById[state.studioId] } : studiosById;
  const sched = scheduleBetween(cal, from, to, { studiosById: filterById });
  let planned = 0;
  for (const [iso, list] of sched) if (iso < today) planned += list.length;
  const entries = store.getEntries({ from, to, studioId: state.studioId || undefined });
  const missing = missingDays({ cal, entries, from, to, today, studiosById: filterById });
  if (planned === 0) return;
  const done = planned - missing.length;
  const card = el('section', { class: 'card', id: 'rie-days' },
    el('div', { class: 'card-head' }, iconTile('calendar', 'red'), el('h3', { text: 'Giornate previste' }),
      el('span', { class: 'count-badge is-neutral', text: `${done}/${planned}` })),
    el('span', { role: 'img', 'aria-label': `${done} giornate registrate su ${planned} previste` }, progressRatio(done, planned)),
    el('p', { class: 'card-note', text: `${plural(done, 'giornata registrata', 'giornate registrate')} su ${plural(planned, 'prevista', 'previste')} dal calendario.` }));
  if (missing.length) card.append(sectionHead('Da compilare'), missingList(ctx, missing, { key: 'recap', id: 'rie-missing-list' }));
  container.append(card);
}

/** "Il tuo 2026": totale, confronto con l'anno prima, mese migliore, trattamento più frequente. */
function appendYear(container, ctx, { treatmentsById }) {
  if (state.nav.mode !== 'mese' && state.nav.mode !== 'anno') return;
  const { store } = ctx;
  const y = Number(state.nav.anchor.slice(0, 4));
  const sid = state.studioId || undefined;
  const cur = store.getEntries({ from: `${y}-01-01`, to: `${y}-12-31`, studioId: sid });
  if (cur.length === 0) return;
  const prev = store.getEntries({ from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, studioId: sid });
  const r = yearRecap(cur, prev, { treatmentsById });
  const rows = [
    ['Totale dell\'anno', formatEuro(r.totalCents)],
    ['Pazienti', String(r.patients)],
  ];
  if (r.changeTenths !== null) rows.push([`Rispetto al ${y - 1}`, `${r.changeTenths > 0 ? '▲' : r.changeTenths < 0 ? '▼' : '='} ${formatPct(Math.abs(r.changeTenths))}`]);
  if (r.bestMonth) rows.push(['Mese migliore', `${capitalize(monthLabel(r.bestMonth.month))} · ${formatEuro(r.bestMonth.cents)}`]);
  if (r.topTreatment) rows.push(['Trattamento più frequente', `${r.topTreatment.name} · ${plural(r.topTreatment.patients, 'paziente', 'pazienti')}`]);
  container.append(el('section', { class: 'card year-card', id: 'rie-year' },
    el('div', { class: 'card-head' }, iconTile('sparkle', 'indigo', { size: 'md', filled: true }), el('h3', { text: `Il tuo ${y}` })),
    el('dl', { class: 'facts' }, rows.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]))));
}

/** "Da incassare": per ogni studio, i mesi non segnati come pagati (tutti, fino a oggi), con "Incassi". */
function appendUnpaid(container, ctx, { unpaid, studiosById, toToday }) {
  const rows = [...unpaid].filter(([, cents]) => cents > 0)
    .map(([sid, cents]) => ({ s: studiosById[sid], cents }))
    .filter((r) => r.s)
    .sort((a, b) => b.cents - a.cents || a.s.name.localeCompare(b.s.name, 'it'));
  if (rows.length === 0) return;
  const payments = ctx.store.getPayments();
  const ul = el('ul', { class: 'list grouped' });
  for (const { s, cents } of rows) {
    const months = paymentMonths(toToday, payments, s.id).filter((m) => !m.paid);
    ul.append(el('li', { dataset: { unpaid: s.name } },
      el('button', { type: 'button', class: 'row', 'aria-label': `Incassi di ${s.name}: ${formatEuro(cents)} da incassare`, onclick: () => paymentsDialog(ctx, s, toToday) },
        studioDot(s),
        el('span', { class: 'row-main' },
          el('span', { class: 'row-title', text: s.name }),
          el('span', { class: 'row-sub', text: shortMonths(months.map((m) => m.month)) })),
        el('span', { class: 'row-value amount', text: formatEuro(cents) }),
        icon('chevron'))));
  }
  const total = rows.reduce((n, r) => n + r.cents, 0);
  container.append(el('section', { class: 'card', id: 'rie-unpaid' },
    el('div', { class: 'card-head' }, iconTile('wallet', 'orange'), el('h3', { text: 'Da incassare' })),
    el('p', { class: 'card-note', text: 'Mesi fino a oggi non ancora segnati come pagati, qualunque sia il periodo mostrato. Tocca uno studio per segnarli.' }),
    ul,
    rows.length > 1 ? el('div', { class: 'item-head total-line', id: 'rie-unpaid-total' },
      el('strong', { text: 'Totale da incassare' }), el('strong', { class: 'amount', text: formatEuro(total) })) : null));
}

/** Foglio d'azione di uno studio del Recap: CSV del periodo, incassi, recap del solo studio. */
async function studioSheet(ctx, s, { range, toToday, due, duePeriod, cents }) {
  const lines = [`${formatEuro(cents)} nel periodo`];
  if (due > 0) lines.push(`Da incassare: ${formatEuro(due)} in tutto${duePeriod !== due ? `, ${formatEuro(duePeriod)} nel periodo` : ''}`);
  const choice = await choiceDialog({
    title: s.name,
    message: [s.archived ? 'Studio archiviato' : null, ...lines].filter(Boolean).join('\n'),
    choices: [
      { value: 'csv', label: 'Esporta CSV del periodo', kind: 'primary' },
      { value: 'pay', label: 'Incassi', kind: 'primary' },
      state.studioId ? null : { value: 'only', label: 'Mostra solo questo studio', kind: 'primary' },
      { value: null, label: 'Annulla', kind: 'secondary' },
    ].filter(Boolean),
  });
  if (choice === 'csv') exportStudios(ctx, [s], range, { share: false });
  else if (choice === 'pay') paymentsDialog(ctx, s, toToday);
  else if (choice === 'only') { state.studioId = s.id; ctx.rerender(); }
}

// ---------- incassi ----------
/**
 * Foglio "Incassi": tutti i mesi dello studio con inserimenti fino a oggi, prima quelli da incassare.
 * Per i mesi oltre 77,47 € una seconda spunta, visibile solo se il mese è pagato: marca da bollo pagata dallo
 * studio (conta come ricavo nella stima delle tasse). Sotto ogni mese un link piccolo "Escludi dalle tasse":
 * una parte del mese che non entra nella stima delle tasse ("di cui esclusi …"), sempre modificabile.
 */
function paymentsDialog(ctx, studio, entries) {
  const { store } = ctx;
  const payments = store.getPayments();
  const months = paymentMonths(entries, payments, studio.id);
  if (months.length === 0) { toast('Nessun inserimento per questo studio'); return; }
  const mine = payments.filter((p) => p.studioId === studio.id);
  const bolloOf = new Map(mine.map((p) => [p.month, p.bollo === true]));
  const exclOf = new Map(mine.map((p) => [p.month, Number.isInteger(p.excludedCents) ? p.excludedCents : 0]));
  const bolloText = formatEuro(tasse.taxParams(ctx).bollo);
  const rows = months.map((m) => {
    const paid = el('input', { type: 'checkbox', value: m.month, id: `pay-${m.month}`, checked: m.paid });
    const needsBollo = m.cents > BOLLO_SOGLIA;
    const bollo = needsBollo ? el('input', { type: 'checkbox', id: `pay-bollo-${m.month}`, checked: m.paid && bolloOf.get(m.month) === true }) : null;
    const bolloRow = needsBollo ? el('label', { class: 'check check-bollo' }, bollo,
      el('span', { class: 'check-label' }, el('span', { class: 'check-sub', text: `Marca da bollo ${bolloText} pagata dallo studio` }))) : null;
    const refresh = () => {
      if (!bolloRow) return;
      bolloRow.hidden = !paid.checked;
      if (!paid.checked) bollo.checked = false;
    };
    paid.addEventListener('change', refresh);
    refresh();

    // esclusione dalle tasse
    const ex = { cents: exclOf.get(m.month) || 0, error: null };
    const ofWhich = el('span', { class: 'pay-ofwhich', id: `pay-ofwhich-${m.month}` });
    const value = el('span', { class: 'check-value-wrap' }, el('span', { class: 'muted check-value', text: formatEuro(m.cents) }), ofWhich);
    const main = checkRow(paid, el('span', { text: capitalize(monthLabel(m.month)) }), value);
    const input = el('input', {
      type: 'text', inputmode: 'decimal', id: `pay-excl-${m.month}`, placeholder: '0,00', autocomplete: 'off',
      'aria-label': `Importo da escludere dalle tasse, ${monthLabel(m.month)}`,
    });
    const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const link = el('button', { type: 'button', class: 'btn-link pay-excl-link', id: `pay-excl-open-${m.month}` });
    const clear = el('button', { type: 'button', class: 'btn-link pay-excl-clear', text: 'Togli' });
    const editor = el('div', { class: 'pay-excl-editor', hidden: true },
      el('span', { class: 'amount-input' }, input), clear, err);
    const paint = () => {
      ofWhich.textContent = ex.cents > 0 ? `di cui esclusi ${formatEuro(ex.cents)}` : '';
      ofWhich.hidden = ex.cents === 0;
      link.textContent = ex.cents > 0 ? 'Modifica esclusione' : 'Escludi dalle tasse';
    };
    const read = () => {
      const t = input.value.trim();
      const c = t === '' ? 0 : parseEuroInput(t);
      if (c === null) ex.error = 'Importo non valido';
      else if (c > m.cents) ex.error = `Al massimo ${formatEuro(m.cents)} (il totale del mese)`;
      else { ex.error = null; ex.cents = c; }
      err.textContent = ex.error || '';
      err.hidden = !ex.error;
      paint();
    };
    input.addEventListener('input', read);
    link.addEventListener('click', () => {
      editor.hidden = !editor.hidden;
      if (!editor.hidden) {
        input.value = ex.cents ? formatEuroCsv(ex.cents) : '';
        input.focus();
      }
    });
    clear.addEventListener('click', () => { input.value = ''; read(); editor.hidden = true; });
    paint();
    const exRow = el('div', { class: 'check pay-excl' }, link, editor);
    return { m, paid, bollo, ex, nodes: [main, bolloRow, exRow].filter(Boolean) };
  });
  formDialog({
    title: 'Incassi',
    subtitle: studio.name,
    submitText: 'Salva',
    build: (form) => form.append(
      sectionHead('Mesi pagati'),
      el('div', { class: 'checklist', id: 'pay-list' }, rows.flatMap((r) => r.nodes)),
      el('p', { class: 'group-note', text: 'Spunta i mesi che lo studio ti ha già pagato: gli altri restano da incassare. '
        + 'Se lo studio ti ha pagato anche la marca da bollo (fatture oltre 77,47 €), spunta anche quella: conta come ricavo nelle tasse.' })),
    onSubmit: ({ setFormError }) => {
      const bad = rows.find((r) => r.ex.error);
      if (bad) { setFormError(`${capitalize(monthLabel(bad.m.month))}: ${bad.ex.error}`); return false; }
      store.setPaid(rows.map((r) => ({
        month: r.m.month, studioId: studio.id, paid: r.paid.checked, bollo: !!r.bollo?.checked, excludedCents: r.ex.cents,
      })));
      toast('Incassi aggiornati');
      return true;
    },
  });
}

// ---------- esportazione CSV ----------
function csvFiles(ctx, list, range, { all = false } = {}) {
  const { store } = ctx;
  const format = ctx.prefs.get().csvFormat;
  const treatmentsById = Object.fromEntries(store.getTreatments().map((t) => [t.id, t]));
  const files = [];
  const titles = [];
  const subs = [];
  // sottotitolo del foglio "File CSV pronti": periodo del file (con "Tutto": prima e ultima data) e righe
  const subOf = (entries) => {
    const dates = entries.map((e) => e.date).sort();
    return `${formatSpan(range.from || dates[0], range.to || dates[dates.length - 1])} · ${plural(entries.length, 'riga', 'righe')}`;
  };
  let rows = 0;
  for (const s of list) {
    const entries = store.getEntries({ from: range.from, to: range.to, studioId: s.id });
    if (entries.length === 0) continue;
    rows += entries.length;
    subs.push(subOf(entries));
    const csv = buildStudioCsv({ entries, treatmentsById, format });
    files.push(new File([csv], csvFileName({ studioName: s.name, from: range.from, to: range.to }), { type: 'text/csv' }));
    titles.push(s.name);
  }
  if (all) {
    const ids = new Set(list.map((s) => s.id));
    const entries = store.getEntries({ from: range.from, to: range.to }).filter((e) => ids.has(e.studioId));
    if (entries.length) {
      const studiosById = Object.fromEntries(store.getStudios({ includeArchived: true }).map((s) => [s.id, s]));
      const csv = buildAllStudiosCsv({ entries, treatmentsById, studiosById, format });
      files.push(new File([csv], csvFileName({ studioName: 'tutti-gli-studi', from: range.from, to: range.to }), { type: 'text/csv' }));
      titles.push('Tutti gli studi');
      subs.push(subOf(entries));
    }
  }
  return { files, titles, subs, rows };
}

function exportStudios(ctx, list, range, { share, all = false }) {
  const { files, titles, subs, rows } = csvFiles(ctx, list, range, { all });
  if (files.length === 0) {
    toast('Nessuna riga nel periodo per gli studi scelti', { type: 'error' });
    return false;
  }
  if (share) {
    shareFile(files, files.length === 1 ? files[0].name : 'DentalFlow CSV');
  } else if (files.length === 1) {
    downloadBlob(files[0], files[0].name);
    toast(`CSV esportato (${plural(rows, 'riga', 'righe')})`);
  } else {
    // un file per tocco: Safari su iPhone blocca i download in sequenza fuori dal gesto dell'utente
    filesDialog({
      title: 'File CSV pronti',
      intro: `${plural(files.length, 'file', 'file')}, ${plural(rows, 'riga', 'righe')}. Scarica o condividi ogni file.`,
      files: files.map((file, i) => ({ file, title: titles[i], sub: subs[i] })),
    });
  }
  return true;
}

/** Foglio "Esporta CSV": periodo (predefinito mese scorso), studi da scegliere, CSV unico facoltativo, formato. */
export function exportDialog(ctx) {
  const { store } = ctx;
  const studios = store.getStudios({ includeArchived: true });
  if (studios.length === 0) { toast('Aggiungi prima uno studio', { type: 'error' }); return; }
  const nav = newNav('mese', addMonths(todayISO().slice(0, 7), -1) + '-01');
  const checked = new Set(state.studioId ? [state.studioId] : studios.filter((s) => !s.archived).map((s) => s.id));
  let all = false;
  const body = el('div', { class: 'export-body' });
  // formato: due righe con spunta (prima Excel, il caso degli studi), sottotitolo breve
  const FORMAT_SUB = { excel: 'Per gli studi con Excel su computer · punto e virgola', virgola: 'Anteprima sul telefono, Mac · virgola' };
  const curFormat = CSV_FORMATS[ctx.prefs.get().csvFormat] ? ctx.prefs.get().csvFormat : 'excel';
  const format = el('div', { class: 'checklist', id: 'exp-format', role: 'radiogroup', 'aria-label': 'Formato del file' },
    ['excel', 'virgola'].filter((k) => CSV_FORMATS[k]).map((k) => {
      const r = el('input', { type: 'radio', name: 'exp-format', id: `exp-format-${k}`, value: k, checked: k === curFormat });
      r.addEventListener('change', () => { if (r.checked) ctx.prefs.set({ csvFormat: k }); });
      // scelta singola: spunta a destra come nelle liste di scelta di iOS (le caselle multiple hanno il cerchio a sinistra)
      return el('label', { class: 'check check-pick' }, el('span', { class: 'check-label' },
        el('span', { class: 'check-text' }, el('span', { text: CSV_FORMATS[k].label }), el('span', { class: 'check-sub', text: FORMAT_SUB[k] }))), r);
    }));
  let range = null;
  const paint = () => {
    clear(body);
    body.append(periodNav({ idPrefix: 'exp-period', state: nav, onChange: paint }));
    const res = resolveNav(nav);
    range = res.range || null;
    if (res.error) { body.append(el('p', { class: 'field-error', role: 'alert', text: res.error })); return; }
    const list = el('div', { class: 'checklist', id: 'exp-studios' });
    for (const s of studios) {
      const n = store.getEntries({ from: range.from, to: range.to, studioId: s.id }).length;
      const box = el('input', { type: 'checkbox', value: s.id, checked: checked.has(s.id) });
      box.addEventListener('change', () => { if (box.checked) checked.add(s.id); else checked.delete(s.id); });
      list.append(checkRow(box, studioDot(s), el('span', { class: 'check-text' }, el('span', { text: s.name }), s.archived ? archivedBadge() : null),
        el('span', { class: 'muted', text: plural(n, 'riga', 'righe') })));
    }
    const allBox = el('input', { type: 'checkbox', id: 'exp-all', checked: all });
    allBox.addEventListener('change', () => { all = allBox.checked; });
    body.append(sectionHead('Studi'),
      list,
      groupNote('Un file per studio: Data, Trattamento, Numero pazienti, Costo trattamento (€).'),
      el('div', { class: 'checklist' }, checkRow(allBox, el('span', { class: 'check-text' },
        el('span', { text: 'Anche un CSV unico' }), el('span', { class: 'check-sub', text: 'Tutti gli studi scelti, con la colonna Studio' })))));
  };
  paint();
  const chosen = () => studios.filter((s) => checked.has(s.id));
  const probe = new File([''], 'x.csv', { type: 'text/csv' });
  formDialog({
    title: 'Esporta CSV',
    submitText: 'Scarica',
    build: (form) => form.append(body, sectionHead('Formato'), format,
      groupNote('Se il file si apre con tutti i valori in una colonna, scegli l\'altro formato.', { id: 'exp-format-hint' })),
    extraAction: canShareFile(probe) ? {
      label: 'Condividi', kind: 'secondary',
      onClick: () => { if (range && chosen().length) exportStudios(ctx, chosen(), range, { share: true, all }); },
    } : undefined,
    onSubmit: ({ setFormError }) => {
      if (!range) { setFormError('Periodo non valido'); return false; }
      if (chosen().length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      try {
        return exportStudios(ctx, chosen(), range, { share: false, all });
      } catch (err) {
        showError(err);
        return false;
      }
    },
  });
}

