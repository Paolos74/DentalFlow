// Oggi: saluto, recap del mese, studio di oggi, azioni rapide, giorni da compilare, prossimi giorni, promemoria backup.
import {
  el, clear, toast, showError, choiceDialog, studioDot, listRow, icon, iconTile, progressBar, offlinePill,
} from '../ui.js';
import {
  todayISO, addDays, formatLong, formatShort, formatDayTitle, formatDayShort, greeting, monthToDate, monthLabel,
} from '../dates.js';
import { formatEuro, formatPct, sumCents } from '../money.js';
import { kpis, changeTenths, ranking } from '../aggregate.js';
import { scheduleOn, hasSchedule, missingDays, upcomingDays, formatTime } from '../calendar.js';
import { backupReminder } from '../prefs.js';
import { exportBackup } from './gestione.js';
import { studioColorKey } from '../colors.js';

const MISSING_WINDOW = 30;
const MISSING_LIMIT = 3;
const expanded = new Set(); // liste "Da compilare" aperte per intero (chiave della lista)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function render(container, ctx) {
  const { store } = ctx;
  clear(container);
  const today = todayISO();
  container.append(el('header', { class: 'today-head' },
    el('h2', { class: 'large-title', id: 'oggi-greeting', text: greeting(new Date().getHours()) }),
    el('div', { class: 'pills' },
      el('p', { class: 'pill', id: 'oggi-date' }, icon('calendar'), el('span', { text: formatDayTitle(today) })),
      offlinePill())));

  const studios = store.getStudios();
  const allStudios = store.getStudios({ includeArchived: true });
  const byId = Object.fromEntries(allStudios.map((s) => [s.id, s]));
  const activeById = Object.fromEntries(studios.map((s) => [s.id, s]));
  const treatments = store.getTreatments();
  const cal = store.getCalendar();
  const scheduled = hasSchedule(cal);
  const anyEntries = store.countEntries() > 0;

  if (studios.length === 0 || treatments.length === 0 || (!anyEntries && !scheduled)) {
    container.append(firstSteps(studios.length, treatments.length, cal.rules.length + cal.days.length));
    if (studios.length === 0 || treatments.length === 0) return;
  }

  container.append(heroCard(ctx, today));
  container.append(todayCard(ctx, { today, cal, activeById, byId, scheduled }));
  container.append(quickActions(ctx));

  if (scheduled) {
    const from = addDays(today, -MISSING_WINDOW);
    const entries = store.getEntries({ from, to: addDays(today, -1) });
    const missing = missingDays({ cal, entries, from, to: addDays(today, -1), today, studiosById: activeById });
    if (missing.length) container.append(missingCard(ctx, missing));
    const next = upcomingDays(cal, addDays(today, 1), { studiosById: activeById, limit: 5 });
    container.append(upcomingCard(next, activeById));
  }

  const prefs = ctx.prefs.get();
  const rem = backupReminder({ lastBackupAt: prefs.lastBackupAt, lastChangeAt: store.lastChangeAt(), hasData: anyEntries, now: Date.now() });
  if (rem.due) {
    container.append(el('section', { class: 'card', id: 'oggi-backup' },
      el('div', { class: 'reminder' },
        iconTile('backup', 'orange', { size: 'md' }),
        el('span', { class: 'reminder-text' },
          el('strong', { text: 'Fai un backup' }),
          el('span', { text: rem.days === null ? 'Non hai ancora esportato un backup: i dati sono solo su questo telefono.' : `Ultimo backup ${plural(rem.days, 'giorno', 'giorni')} fa, e da allora hai modificato i dati.` }))),
      el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'oggi-backup-btn', text: 'Esporta backup', onclick: () => exportBackup(ctx) })));
  }
}

function firstSteps(nStudios, nTreatments, nCalendar) {
  const steps = [
    ['Aggiungi uno studio', '#altro/studi', nStudios, 'dove lavori'],
    ['Aggiungi i trattamenti', '#altro/trattamenti', nTreatments, 'quelli che fai in ogni studio'],
    ['Imposta i giorni di lavoro', '#altro/studi', nCalendar, 'nella scheda di ogni studio'],
  ];
  const done = steps.filter((s) => s[2] > 0).length;
  const looks = [['studio', 'blue'], ['tooth', 'mint'], ['calendar', 'red']];
  const ul = el('ul', { class: 'list grouped' });
  steps.forEach(([title, href, n, sub], i) => {
    const ok = n > 0;
    // passi sì/no: cerchio di spunta vuoto o pieno (il conteggio complessivo è sopra, "0 di 3")
    const li = listRow({
      href, title, subtitle: sub, lead: iconTile(looks[i][0], looks[i][1]),
      extra: el('span', { class: 'visually-hidden', text: ok ? 'Fatto' : 'Da fare' }),
    });
    const row = li.querySelector('.row');
    row.classList.add('step-row');
    if (ok) row.classList.add('is-done');
    row.insertBefore(el('span', { class: `step-check${ok ? ' is-done' : ''}`, 'aria-hidden': 'true' }, ok ? icon('check') : null), row.querySelector('.chevron')?.parentElement || null);
    ul.append(li);
  });
  return el('section', { class: 'card', id: 'oggi-first-steps' },
    el('div', { class: 'card-head' }, iconTile('flag', 'blue', { size: 'md', filled: true }),
      el('div', {}, el('h3', { text: 'Primi passi' }), el('p', { class: 'muted', id: 'oggi-first-count', text: `${done} di 3 completati` }))),
    el('span', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '3', 'aria-valuenow': String(done), 'aria-label': `Primi passi: ${done} di 3` }, progressBar(done / 3)),
    ul);
}

function heroCard(ctx, today) {
  const { store } = ctx;
  const { current, previous } = monthToDate(today);
  const cur = store.getEntries(current);
  const prev = store.getEntries(previous);
  const k = kpis(cur);
  const p = kpis(prev);
  const ch = changeTenths(k.cents, p.cents);
  const prevMonth = monthLabel(previous.from.slice(0, 7)).split(' ')[0];
  let change = '';
  if (ch !== null) change = `${ch > 0 ? '▲' : ch < 0 ? '▼' : '='} ${formatPct(Math.abs(ch))} rispetto allo stesso punto di ${prevMonth}`;
  const top = ranking(cur, { measure: 'pazienti', treatmentsById: Object.fromEntries(store.getTreatments().map((t) => [t.id, t])) }).slice(0, 3);
  return el('a', {
    class: 'hero', href: '#recap', id: 'oggi-hero',
    // sempre il recap del mese corrente, anche se nel Recap era rimasto un altro periodo
    onclick: (e) => { e.preventDefault(); ctx.go('recap', { month: today.slice(0, 7) }); },
  },
    el('span', { class: 'hero-kicker', text: `Recap di ${monthLabel(today.slice(0, 7))}` }),
    el('span', { class: 'hero-more', 'aria-hidden': 'true' }, 'Recap', icon('chevron')),
    el('strong', { class: 'hero-number', text: formatEuro(k.cents) }),
    el('span', { class: 'hero-line', text: `${plural(k.patients, 'paziente', 'pazienti')} · ${plural(k.days, 'giorno lavorato', 'giorni lavorati')}` }),
    change ? el('span', { class: 'hero-line hero-change', text: change }) : null,
    top.length ? el('ul', { class: 'hero-list', 'aria-label': 'Trattamenti principali del mese' },
      top.map((t) => el('li', {}, el('span', { text: t.name }), el('span', { text: `${t.value} paz.` })))) : null);
}

function todayCard(ctx, { today, cal, activeById, byId, scheduled }) {
  const { store } = ctx;
  const card = el('section', { class: 'card', id: 'oggi-today' });
  const planned = scheduleOn(cal, today, { studiosById: activeById });
  const entries = store.getEntries({ from: today, to: today });
  const byStudio = new Map();
  for (const e of entries) {
    if (!byStudio.has(e.studioId)) byStudio.set(e.studioId, []);
    byStudio.get(e.studioId).push(e);
  }
  const registered = (sid) => {
    const list = byStudio.get(sid) || [];
    return `Registrata: ${plural(list.reduce((n, e) => n + e.patients, 0), 'paziente', 'pazienti')} · ${formatEuro(sumCents(list.map((e) => e.amountCents)))}`;
  };
  const doneLine = (sid) => el('p', { class: 'today-done' }, icon('check'), el('span', { text: registered(sid) }));
  planned.forEach((item, i) => {
    const s = activeById[item.studioId];
    const done = byStudio.has(item.studioId);
    card.append(el('div', { class: `today-item studio-${studioColorKey(s)}` },
      el('span', { class: 'today-kicker', text: i === 0 ? 'Oggi sei da' : 'Poi da' }),
      el('h3', {}, studioDot(s), s.name),
      item.time ? el('p', { class: 'today-meta' }, el('span', {}, icon('clock'), formatTime(item.time))) : null,
      done ? doneLine(item.studioId) : null,
      el('button', {
        type: 'button', class: `btn ${done ? 'btn-secondary' : 'btn-primary'}`, id: `oggi-insert-${item.studioId}`,
        text: done ? 'Modifica la giornata' : 'Inserisci la giornata',
        onclick: () => ctx.go('inserisci', { date: today, studioId: item.studioId }),
      })));
  });
  for (const [sid] of byStudio) {
    if (planned.some((p) => p.studioId === sid)) continue;
    const s = byId[sid];
    card.append(el('div', { class: 'today-item' },
      el('span', { class: 'today-kicker', text: 'Registrato oggi' }),
      el('h3', {}, s ? studioDot(s) : null, s ? s.name : 'Studio eliminato'),
      doneLine(sid),
      s && !s.archived ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'Modifica la giornata', onclick: () => ctx.go('inserisci', { date: today, studioId: sid }) }) : null));
  }
  if (planned.length === 0 && byStudio.size === 0) {
    if (!scheduled) {
      card.append(el('div', { class: 'card-head' }, iconTile('calendar', 'red', { size: 'md', filled: true }),
        el('div', {}, el('h3', { text: 'Dove lavori oggi?' }),
          el('p', { class: 'muted', text: 'Imposta i tuoi giorni: l\'app ti proporrà lo studio giusto.' }))),
        el('div', { class: 'toolbar' },
          el('a', { class: 'btn btn-primary', href: '#altro/studi', id: 'oggi-setup-calendar', text: 'Imposta i tuoi giorni di lavoro' }),
          el('a', { class: 'btn btn-secondary', href: '#inserisci', text: 'Inserisci una giornata' })));
    } else {
      const next = upcomingDays(cal, addDays(today, 1), { studiosById: activeById, limit: 1 })[0];
      card.append(el('div', { class: 'card-head' }, iconTile('calendar-day', 'gray', { size: 'md', filled: true }),
        el('div', {}, el('h3', { text: 'Oggi non lavori' }),
          next ? el('p', { class: 'muted', id: 'oggi-next', text: `Prossimo: ${formatDayTitle(next.date)} · ${next.items.map((x) => x.studioName).join(', ')}` }) : null)),
        el('a', { class: 'btn btn-secondary btn-block', href: '#inserisci', text: 'Inserisci comunque una giornata' }));
    }
  }
  return card;
}

function quickActions(ctx) {
  const tile = (id, label, ic, color, attrs) => el(attrs.href ? 'a' : 'button', { class: 'tile', id, type: attrs.href ? null : 'button', ...attrs },
    iconTile(ic, color, { size: 'md', filled: true }), el('span', { class: 'tile-label', text: label }));
  return el('nav', { class: 'tiles', 'aria-label': 'Azioni rapide' },
    tile('oggi-qa-insert', 'Inserisci', 'plus', 'blue', { href: '#inserisci' }),
    tile('oggi-qa-registro', 'Registro', 'list', 'teal', { href: '#registro' }),
    tile('oggi-qa-csv', 'CSV studi', 'csv', 'green', { onclick: () => ctx.go('recap', { export: true }), 'aria-label': 'Esporta CSV per gli studi' }),
    tile('oggi-qa-backup', 'Backup', 'backup', 'orange', { href: '#altro/backup' }));
}

/**
 * Righe "da compilare" (giorni previsti senza dati), dalla più recente: al massimo MISSING_LIMIT,
 * poi "Mostra tutti". Tocco sulla riga = Inserisci; "⋯" = foglio d'azione con "Non ho lavorato".
 * Usata anche dal Recap, con la stessa forma.
 */
export function missingList(ctx, missing, { key, id }) {
  const { store } = ctx;
  const all = [...missing].reverse();
  const open = expanded.has(key) || all.length <= MISSING_LIMIT + 1;
  const shown = open ? all : all.slice(0, MISSING_LIMIT);
  const ul = el('ul', { class: 'list grouped missing-list', id });
  for (const m of shown) {
    const when = `${formatDayTitle(m.date)}, ${m.studioName}`;
    ul.append(el('li', { class: 'missing-row' },
      el('button', {
        type: 'button', class: 'row', 'aria-label': `Inserisci ${when}`,
        onclick: () => ctx.go('inserisci', { date: m.date, studioId: m.studioId }),
      },
      el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: formatDayShort(m.date) }), el('span', { class: 'row-sub', text: m.studioName })),
      icon('chevron')),
      el('button', {
        type: 'button', class: 'row-more', 'aria-label': `Altre azioni: ${when}`,
        onclick: async () => {
          const choice = await choiceDialog({
            title: when,
            message: 'Previsto dal calendario, senza dati.',
            choices: [
              { value: 'insert', label: 'Inserisci la giornata', kind: 'primary' },
              { value: 'skip', label: 'Non ho lavorato', kind: 'danger' },
              { value: null, label: 'Annulla', kind: 'secondary' },
            ],
          });
          if (choice === 'insert') ctx.go('inserisci', { date: m.date, studioId: m.studioId });
          if (choice !== 'skip') return;
          try {
            store.unscheduleDay(m.date, m.studioId);
            toast('Giorno tolto dal calendario: le altre date della ripetizione restano');
          } catch (err) {
            showError(err);
          }
        },
      }, icon('more'))));
  }
  if (all.length > MISSING_LIMIT + 1) {
    ul.append(el('li', {}, el('button', {
      type: 'button', class: 'row row-toggle', id: `${id}-toggle`, 'aria-expanded': String(open),
      onclick: () => { if (open) expanded.delete(key); else expanded.add(key); ctx.rerender(); },
    }, el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: open ? 'Mostra meno' : `Mostra tutti (${all.length})` })),
    icon('chevron-down', open ? 'is-up' : ''))));
  }
  return ul;
}

function missingCard(ctx, missing) {
  return el('section', { class: 'card', id: 'oggi-missing' },
    el('div', { class: 'card-head' }, iconTile('calendar-day', 'red'), el('h3', { text: 'Da compilare' }), el('span', { class: 'count-badge', text: String(missing.length) })),
    el('p', { class: 'card-note', text: `Giorni del calendario degli ultimi ${MISSING_WINDOW} giorni senza dati.` }),
    missingList(ctx, missing, { key: 'oggi', id: 'oggi-missing-list' }));
}

function upcomingCard(next, studiosById) {
  const ul = el('ul', { class: 'list grouped' });
  for (const d of next) {
    const [wd, num, mon] = formatShort(d.date).split(' ');
    ul.append(el('li', { class: 'upcoming-row', 'aria-label': `${formatLong(d.date)}: ${d.items.map((x) => `${x.studioName}${x.time ? ` ${formatTime(x.time)}` : ''}`).join(', ')}` },
      el('span', { class: 'upcoming-date', 'aria-hidden': 'true' }, el('small', { text: wd }), el('strong', { text: num }), el('small', { class: 'upcoming-month', text: mon })),
      el('span', { class: 'upcoming-studios', 'aria-hidden': 'true' }, d.items.map((x) => el('span', { class: 'upcoming-studio' },
        studiosById[x.studioId] ? studioDot(studiosById[x.studioId]) : null, x.studioName, x.time ? el('small', { text: formatTime(x.time) }) : null)))));
  }
  return el('section', { class: 'card', id: 'oggi-upcoming' },
    el('div', { class: 'card-head' }, iconTile('calendar', 'red'), el('h3', { text: 'Prossimi giorni' }),
      el('a', { href: '#calendario', class: 'btn-link', id: 'oggi-open-calendar', text: 'Calendario' })),
    next.length ? ul : el('p', { class: 'muted', text: 'Nessun giorno di lavoro nei prossimi mesi.' }));
}
