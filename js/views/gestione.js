// Altro (ex Gestione): elenco in stile Impostazioni iOS con sotto-pagine
// #altro/studi[/id], #altro/trattamenti[/id], #altro/backup, #altro/sync, #altro/aspetto, #altro/installa, #altro/info.
// Il calendario di lavoro è in calendario.js (#calendario).
import {
  el, clear, toast, showError, confirmDialog, choiceDialog, textDialog, checkboxDialog, field,
  downloadBlob, canShareFile, shareFile, getSwVersion, listRow, studioDot,
  pageHeader, sectionHead, iconTile, icon, emptyState, iconButton, navButton, groupNote, groupRow, formGroup, archivedBadge,
  formDialog, undoToast, autoGrow,
} from '../ui.js';
import { todayISO, formatDateShort, formatDayTitle, formatLong, addDays } from '../dates.js';
import { buildBackup, parseBackupText, validateBackup } from '../backup.js';
import {
  describeRule, describePattern, describeTimes, describeEnd, formatTime, scheduleBetween,
} from '../calendar.js';
import { ruleDialog } from './calendario.js';
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { STUDIO_COLORS, studioColorKey } from '../colors.js';
import { readBeforeImport, writeBeforeImport, clearBeforeImport } from '../prefs.js';

const state = {
  newStudioName: '',
  syncForm: null, // {apiKey, projectId, email, password}; la password resta solo in memoria
  signingIn: false,
  syncing: false,
  version: null,
};

const MAX_BACKUP = 10 * 1024 * 1024;
const plural = (n, one, many) => `${n}\u00a0${n === 1 ? one : many}`; // spazio non divisibile: "2 inserimenti" non va a capo
const alsoDeleted = (n) => (n === 1 ? 'Verrà eliminato anche 1 inserimento. Non si può annullare.' : `Verranno eliminati anche ${n} inserimenti. Non si può annullare.`);

function run(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

const PAGES = {
  studi: ['Studi', (ctx, id) => (id ? studioPage(ctx, id) : studiSection(ctx)),
    (ctx) => [iconButton({ name: 'plus', label: 'Nuovo studio', id: 'ges-studio-new', onClick: () => newStudio(ctx.store) })]],
  trattamenti: ['Trattamenti', (ctx, id) => (id ? treatmentPage(ctx, id) : trattamentiSection(ctx)),
    (ctx) => {
      const b = iconButton({ name: 'plus', label: 'Nuovo trattamento', id: 'ges-treatment-new', onClick: () => newTreatment(ctx.store, ctx.store.getStudios()) });
      b.disabled = ctx.store.getStudios().length === 0;
      return [b];
    }],
  note: ['Note', (ctx) => memoSection(ctx),
    (ctx) => [iconButton({ name: 'plus', label: 'Nuova nota', id: 'memo-new', onClick: () => memoDialog(ctx, null) })]],
  backup: ['Backup e ripristino', (ctx) => backupSection(ctx)],
  sync: ['Sincronizzazione', (ctx) => syncSection(ctx)],
  aspetto: ['Aspetto', (ctx) => aspettoSection(ctx)],
  installa: ['Installa app', (ctx) => installSection(ctx)],
  info: ['Info', () => infoSection()],
};

export function render(container, ctx) {
  clear(container);
  const [page, id] = ctx.path || [];
  if (PAGES[page]) {
    const [title, build, actions] = PAGES[page];
    // le schede (studio, trattamento) disegnano la propria intestazione con "‹ Studi" e "Rinomina"
    if (!id) container.append(pageHeader({ title, back: ['#altro', 'Altro', 'altro-back'], actions: actions ? actions(ctx) : [] }));
    const body = build(ctx, id);
    const first = body.firstElementChild;
    if (!id && first?.tagName === 'H3' && first.textContent === title) first.remove(); // niente titolo ripetuto
    container.append(body);
    return;
  }
  container.append(pageHeader({ title: 'Altro', subtitle: 'Calendario, studi, trattamenti e dati' }));
  const { store, sync, install } = ctx;
  const cal = store.getCalendar();
  const nCal = cal.rules.length + cal.days.length;
  const last = ctx.prefs.get().lastBackupAt;
  const st = sync.getStatus();
  const lead = (name, color) => iconTile(name, color);
  container.append(
    sectionHead('Lavoro'),
    el('ul', { class: 'list grouped', id: 'altro-menu' },
      listRow({ href: '#calendario', id: 'altro-calendario', lead: lead('calendar', 'red'), title: 'Calendario di lavoro', subtitle: nCal ? `${nCal} ${nCal === 1 ? 'regola o giorno' : 'regole e giorni'}` : 'Imposta i giorni in cui lavori' }),
      listRow({ href: '#altro/studi', id: 'altro-studi', lead: lead('studio', 'blue'), title: 'Studi', value: String(store.getStudios({ includeArchived: true }).length) }),
      listRow({ href: '#altro/trattamenti', id: 'altro-trattamenti', lead: lead('tooth', 'mint'), title: 'Trattamenti', value: String(store.getTreatments().length) }),
      listRow({ href: '#altro/note', id: 'altro-note', lead: lead('note', 'teal'), title: 'Note', subtitle: 'Cose da ricordare', value: store.getMemos().length ? String(store.getMemos().length) : null })),
    sectionHead('Dati'),
    el('ul', { class: 'list grouped' },
      listRow({ href: '#altro/backup', id: 'altro-backup', lead: lead('backup', 'orange'), title: 'Backup e ripristino', subtitle: last ? `Ultimo backup: ${formatDateShort(todayISO(last))}` : 'Nessun backup esportato' }),
      listRow({ href: '#altro/sync', id: 'altro-sync', lead: lead('sync', 'sky'), title: 'Sincronizzazione', subtitle: st.enabled ? 'Attiva' : 'Disattivata (facoltativa)' })),
    sectionHead('App'),
    el('ul', { class: 'list grouped' },
      listRow({ href: '#altro/aspetto', id: 'altro-aspetto', lead: lead('appearance', 'purple'), title: 'Aspetto', value: THEMES.find(([v]) => v === ctx.prefs.get().theme)?.[1] }),
      listRow({ href: '#altro/installa', id: 'altro-installa', lead: lead('install', 'indigo'), title: 'Installa app', value: install.isInstalled() ? 'Installata' : null }),
      listRow({ href: '#altro/info', id: 'altro-info', lead: lead('info', 'gray'), title: 'Info' })));
}

// ---------- note da ricordare ----------
function memoSection(ctx) {
  const memos = ctx.store.getMemos();
  const wrap = el('div', { id: 'memo-page' });
  if (memos.length === 0) {
    wrap.append(el('div', { class: 'card' }, emptyState({
      iconName: 'note', color: 'teal', title: 'Nessuna nota', id: 'memo-empty',
      text: 'Scrivi qui le cose da ricordare: materiali da ordinare, appuntamenti, promemoria.',
      action: el('button', { type: 'button', class: 'btn btn-primary', id: 'memo-new-empty', text: 'Nuova nota', onclick: () => memoDialog(ctx, null) }),
    })));
    return wrap;
  }
  const ul = el('ul', { class: 'list grouped', id: 'memo-list' });
  for (const m of memos) {
    const [first, ...rest] = m.text.split('\n');
    const body = rest.join(' ').trim();
    ul.append(el('li', {}, el('button', {
      type: 'button', class: 'row memo-row', dataset: { memo: m.id }, 'aria-label': `Modifica la nota: ${first}`,
      onclick: () => memoDialog(ctx, m),
    }, el('span', { class: 'row-main' },
      el('span', { class: 'row-title memo-title', text: first }),
      body ? el('span', { class: 'row-sub memo-preview', text: body }) : null,
      el('span', { class: 'row-sub memo-date', text: formatDateShort(todayISO(m.updatedAt)) })), icon('chevron'))));
  }
  wrap.append(ul, el('button', {
    type: 'button', class: 'btn btn-secondary btn-block memo-add', id: 'memo-new-bottom', onclick: () => memoDialog(ctx, null),
  }, icon('plus'), 'Nuova nota'));
  return wrap;
}

/** Foglio della nota: un solo campo di testo (la prima riga fa da titolo nell'elenco). */
function memoDialog(ctx, memo) {
  const { store } = ctx;
  const area = el('textarea', { id: 'memo-text', rows: '8', maxlength: '4000', placeholder: 'Scrivi qui…', 'aria-label': 'Testo della nota' });
  area.value = memo?.text || '';
  formDialog({
    title: memo ? 'Nota' : 'Nuova nota',
    submitText: memo ? 'Salva' : 'Aggiungi',
    build: (form) => {
      form.append(el('div', { class: 'form-group memo-box' }, area),
        groupNote('La prima riga è il titolo nell\'elenco.'));
      autoGrow(area);
      setTimeout(() => area.focus(), 50);
    },
    extraAction: memo ? {
      label: 'Elimina nota', kind: 'danger',
      onClick: () => {
        try {
          undoToast(store, 'Nota eliminata', store.deleteMemo(memo.id));
        } catch (err) {
          showError(err);
        }
      },
    } : undefined,
    onSubmit: ({ setFormError }) => {
      if (!area.value.trim()) { setFormError('Scrivi qualcosa nella nota'); return false; }
      if (memo) store.updateMemo(memo.id, area.value);
      else store.addMemo(area.value);
      toast(memo ? 'Nota salvata' : 'Nota aggiunta');
      return true;
    },
  });
}

// ---------- aspetto ----------
const THEMES = [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']];

function aspettoSection(ctx) {
  const cur = ctx.prefs.get().theme;
  return el('section', { class: 'card', id: 'ges-aspetto' },
    el('h3', { text: 'Tema' }),
    el('div', { class: 'theme-options', role: 'group', 'aria-label': 'Tema', id: 'ges-theme' },
      THEMES.map(([v, l]) => el('button', {
        type: 'button', class: 'theme-option', id: `ges-theme-${v}`, 'aria-pressed': String(v === cur),
        onclick: () => { ctx.prefs.set({ theme: v }); ctx.applyTheme(); ctx.rerender(); },
      }, el('span', { class: `theme-preview is-${v}`, 'aria-hidden': 'true' }), el('span', { text: l })))),
    el('p', { class: 'hint', text: 'Automatico segue l\'impostazione chiaro/scuro del telefono.' }));
}

// ---------- studi ----------
function studiSection(ctx) {
  const { store } = ctx;
  const card = el('section', { id: 'ges-studi' });
  const studios = store.getStudios({ includeArchived: true });
  if (studios.length === 0) {
    card.append(el('div', { class: 'card' }, emptyState({
      iconName: 'studio', color: 'blue', title: 'Nessuno studio', text: 'Aggiungi lo studio dove lavori: poi potrai registrare le giornate.',
      action: el('button', { type: 'button', class: 'btn btn-primary', id: 'ges-studio-first', text: 'Aggiungi il primo studio', onclick: () => newStudio(store) }),
    })));
    return card;
  }
  const cal = store.getCalendar();
  const rowOf = (s) => {
    const n = store.countEntries({ studioId: s.id });
    const rules = cal.rules.filter((r) => r.studioId === s.id);
    const sub = [plural(n, 'inserimento', 'inserimenti'), rules[0] ? describePattern(rules[0]) : null, rules.length > 1 ? `+${rules.length - 1}` : null].filter(Boolean).join(' · ');
    const row = listRow({ href: `#altro/studi/${encodeURIComponent(s.id)}`, title: s.name, subtitle: sub, lead: studioDot(s) });
    row.dataset.studio = s.name;
    return row;
  };
  const active = studios.filter((s) => !s.archived);
  const archived = studios.filter((s) => s.archived);
  if (active.length) card.append(sectionHead('I tuoi studi'), el('ul', { class: 'list grouped', id: 'ges-studi-list' }, active.map(rowOf)));
  if (archived.length) {
    card.append(sectionHead('Archiviati'), el('ul', { class: 'list grouped', id: active.length ? 'ges-studi-archived' : 'ges-studi-list' }, archived.map(rowOf)),
      groupNote('Non compaiono nei nuovi inserimenti; i dati passati restano nel Recap, nei CSV e nel Registro.'));
  }
  return card;
}

function newStudio(store) {
  textDialog({
    title: 'Nuovo studio', label: 'Nome', value: state.newStudioName, submitText: 'Aggiungi',
    submitId: 'ges-studio-add', inputId: 'ges-studio-name', placeholder: 'Es. Studio Rossi',
    onSubmit: (name) => { store.addStudio(name); state.newStudioName = ''; toast('Studio aggiunto'); return true; },
  });
}

const STATE_LABELS = { active: 'Offerto', archived: 'Archiviato', none: 'Non offerto' };

/** Selettore a 3 stati del trattamento in uno studio (Offerto / Archiviato / Non offerto). */
function treatmentStateSelect(ctx, t, studioId, studioName, id) {
  const { store } = ctx;
  const cur = t.studios[studioId] || 'none';
  const opts = cur === 'none' ? ['active', 'none'] : ['active', 'archived', 'none'];
  const sel = el('select', { id, 'aria-label': `${t.name} in ${studioName(studioId)}` },
    opts.map((v) => el('option', { value: v, text: STATE_LABELS[v], selected: v === cur })));
  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (v === cur) return;
    if (v === 'active') {
      if (cur === 'archived' && run(() => store.restoreTreatmentInStudios(t.id, [studioId]))) toast('Trattamento ripristinato');
      if (cur === 'none' && run(() => store.addTreatmentToStudios(t.id, [studioId]))) toast('Trattamento aggiunto allo studio');
    } else if (v === 'archived') {
      if (run(() => store.archiveTreatmentInStudios(t.id, [studioId]))) toast('Trattamento archiviato in questo studio');
    } else {
      await removalFlow(store, t, [studioId], studioName, false);
    }
    ctx.rerender();
  });
  return sel;
}

// ---------- giorni di lavoro dello studio: ripetizioni e prossimi giorni ----------
const NEXT_DAYS = 8;

function workDaysCard(ctx, s) {
  const { store } = ctx;
  const cal = store.getCalendar();
  const rules = cal.rules.filter((r) => r.studioId === s.id);
  const card = el('section', { class: 'card', id: 'ges-studio-workdays' },
    el('div', { class: 'card-head' }, iconTile('repeat', 'red'), el('h3', { text: 'Giorni di lavoro' })));

  // ripetizioni: un tocco apre il foglio (modifica, elimina)
  if (rules.length) {
    const ul = el('ul', { class: 'list grouped', id: 'ges-studio-rules' });
    for (const r of rules) {
      ul.append(el('li', {}, el('button', {
        type: 'button', class: 'row', dataset: { rule: r.id }, 'aria-label': `Modifica la ripetizione: ${describeRule(r)}`,
        onclick: () => ruleDialog(ctx, r, { studioId: s.id }),
      }, el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: describePattern(r) }),
        el('span', { class: 'row-sub', text: [describeTimes(r), describeEnd(r)].filter(Boolean).join(' · ') })), icon('chevron'))));
    }
    card.append(ul);
  } else {
    card.append(el('p', { class: 'muted', text: s.archived
      ? 'Nessuna ripetizione.'
      : 'Nessuna ripetizione. Esempio: ogni lunedì 9–13 e mercoledì 14–19.' }));
  }
  if (!s.archived) {
    card.append(el('button', {
      type: 'button', class: 'btn btn-primary btn-block', id: 'ges-rule-new', onclick: () => ruleDialog(ctx, null, { studioId: s.id }),
    }, icon('plus'), 'Nuova ripetizione'));
  } else if (rules.length) {
    card.append(groupNote('Lo studio è archiviato: le ripetizioni restano salvate ma non vengono proposte.'));
  }

  // prossimi giorni: ognuno si toglie da solo, le altre date restano
  if (!s.archived) {
    const today = todayISO();
    const sched = scheduleBetween(cal, today, addDays(today, 180), { studiosById: { [s.id]: s } });
    const next = [...sched.keys()].sort().slice(0, NEXT_DAYS);
    card.append(sectionHead('Prossimi giorni'));
    if (next.length === 0) {
      card.append(el('p', { class: 'muted', text: 'Nessun giorno in programma.' }));
    } else {
      const ul = el('ul', { class: 'list', id: 'ges-studio-next' });
      for (const iso of next) {
        const item = sched.get(iso)[0];
        const fromRule = item.sources.some((x) => x.type === 'rule');
        ul.append(el('li', { class: 'list-item next-day-row', dataset: { date: iso } },
          el('div', { class: 'item-head' },
            el('span', { class: 'item-title', text: formatDayTitle(iso) }),
            el('button', {
              type: 'button', class: 'btn btn-small btn-secondary', text: 'Togli',
              'aria-label': `Togli ${formatLong(iso)} dal calendario`,
              onclick: async () => {
                const msg = fromRule ? 'Solo questo giorno: le altre date della ripetizione restano. I dati già inseriti restano.' : 'I dati già inseriti restano.';
                if (!(await confirmDialog(msg, { title: `Togliere ${formatDayTitle(iso)}?`, okText: 'Togli il giorno', danger: true }))) return;
                if (run(() => store.unscheduleDay(iso, s.id))) toast('Giorno tolto dal calendario');
              },
            })),
          el('div', { class: 'item-meta', text: [item.time ? formatTime(item.time) : null, fromRule ? 'ripetizione' : 'giorno singolo'].filter(Boolean).join(' · ') })));
      }
      card.append(ul);
    }
  }
  card.append(el('ul', { class: 'list grouped' },
    listRow({ href: `#calendario?studio=${encodeURIComponent(s.id)}`, id: 'ges-studio-calendar', title: 'Apri nel calendario', subtitle: 'Giorni singoli e vista del mese', lead: iconTile('calendar', 'red') })));
  return card;
}

function studioPage(ctx, rawId) {
  const { store } = ctx;
  const id = decodeURIComponent(rawId);
  const s = store.getStudios({ includeArchived: true }).find((x) => x.id === id);
  if (!s) return notFound('Studio non trovato: potrebbe essere stato eliminato.', ['#altro/studi', 'Studi', 'altro-back']);
  const allStudios = store.getStudios({ includeArchived: true });
  const studioName = (sid) => allStudios.find((y) => y.id === sid)?.name ?? 'Studio eliminato';
  const wrap = el('div', { id: 'ges-studio-page', dataset: { studio: s.name } });
  wrap.append(pageHeader({
    title: s.name, lead: studioDot(s), back: ['#altro/studi', 'Studi', 'altro-back'],
    subtitle: s.archived ? 'Studio archiviato' : null,
    navAction: navButton({ text: 'Rinomina', id: 'ges-studio-rename', onClick: () => renameStudio(store, s) }),
  }));

  const color = studioColorKey(s);
  wrap.append(el('section', { class: 'card' },
    el('h3', { text: 'Colore' }),
    el('div', { class: 'color-swatches', role: 'group', 'aria-label': 'Colore dello studio', id: 'ges-studio-colors' },
      STUDIO_COLORS.map((c) => el('button', {
        type: 'button', class: `color-swatch studio-${c.key}`, 'aria-pressed': String(c.key === color), id: `ges-color-${c.key}`,
        'aria-label': c.name, title: c.name,
        onclick: () => { if (c.key !== color && run(() => store.setStudioColor(s.id, c.key))) toast('Colore aggiornato'); },
      }, c.key === color ? icon('check') : null)))));

  wrap.append(workDaysCard(ctx, s));

  // trattamenti con stato nello studio
  const treatments = store.getTreatments();
  const tl = el('ul', { class: 'list' });
  for (const t of treatments) {
    tl.append(el('li', { class: 'list-item state-row', dataset: { treatment: t.name } },
      el('label', { for: `ges-ts-${t.id}`, class: 'item-title state-label', text: t.name }),
      treatmentStateSelect(ctx, t, s.id, studioName, `ges-ts-${t.id}`)));
  }
  wrap.append(el('section', { class: 'card' }, el('h3', { text: 'Trattamenti in questo studio' }),
    treatments.length ? tl : el('p', { class: 'muted', text: 'Nessun trattamento. Aggiungili in Altro → Trattamenti.' })));

  const n = store.countEntries({ studioId: s.id });
  wrap.append(sectionHead(`Dati · ${plural(n, 'inserimento', 'inserimenti')}`),
    el('div', { class: 'danger-zone' },
      s.archived
        ? el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'ges-studio-restore', text: 'Ripristina studio', onclick: () => { if (run(() => store.restoreStudio(s.id))) toast('Studio ripristinato'); } })
        : el('button', { type: 'button', class: 'btn btn-secondary btn-block', id: 'ges-studio-archive', text: 'Archivia studio', onclick: () => archiveStudio(store, s) }),
      el('button', { type: 'button', class: 'btn btn-destructive btn-block', id: 'ges-studio-delete', text: 'Elimina studio', onclick: async () => { if (await deleteStudio(store, s)) ctx.navigate('altro/studi'); } })));
  return wrap;
}

function notFound(text, back) {
  return el('div', {}, pageHeader({ title: 'Non trovato', back }), el('div', { class: 'card empty', text }));
}

function renameStudio(store, s) {
  textDialog({
    title: 'Rinomina studio', label: 'Nome', value: s.name,
    onSubmit: (name) => { store.renameStudio(s.id, name); toast('Studio rinominato'); return true; },
  });
}

async function archiveStudio(store, s) {
  if (!(await confirmDialog(`Archiviare «${s.name}»? Non comparirà più nei nuovi inserimenti; i dati passati restano nel Recap, nei CSV e nel Registro.`, { okText: 'Archivia' }))) return;
  if (run(() => store.archiveStudio(s.id))) toast('Studio archiviato');
}

async function deleteStudio(store, s) {
  const { entryCount, orphanTreatmentNames } = store.studioDeleteImpact(s.id);
  const orphanText = orphanTreatmentNames.length
    ? ` Verranno eliminati anche i trattamenti presenti solo in questo studio: ${orphanTreatmentNames.join(', ')}.`
    : '';
  if (entryCount === 0) {
    if (!(await confirmDialog(`Eliminare lo studio «${s.name}»?${orphanText}`, { okText: 'Elimina', danger: true }))) return false;
    if (run(() => store.deleteStudio(s.id))) { toast('Studio eliminato'); return true; }
    return false;
  }
  const choice = await choiceDialog({
    title: `Eliminare «${s.name}»?`,
    message: `Lo studio ha ${plural(entryCount, 'inserimento', 'inserimenti')}. Puoi archiviarlo (i dati restano) oppure eliminarlo definitivamente.${orphanText}`,
    choices: [
      { value: 'archive', label: 'Archivia', kind: 'primary' },
      { value: 'delete', label: 'Elimina definitivamente', kind: 'danger' },
      { value: null, label: 'Annulla', kind: 'secondary' },
    ],
  });
  if (choice === 'archive') {
    if (run(() => store.archiveStudio(s.id))) toast('Studio archiviato');
  } else if (choice === 'delete') {
    if (!(await confirmDialog(`${alsoDeleted(entryCount)}${orphanText}`, { title: `Eliminare definitivamente «${s.name}»?`, okText: 'Elimina definitivamente', danger: true }))) return false;
    if (run(() => store.deleteStudio(s.id))) { toast('Studio eliminato'); return true; }
  }
  return false;
}

// ---------- trattamenti ----------
function trattamentiSection(ctx) {
  const { store } = ctx;
  const card = el('section', { id: 'ges-trattamenti' });
  const allStudios = store.getStudios({ includeArchived: true });
  const studioName = (id) => allStudios.find((x) => x.id === id)?.name ?? 'Studio eliminato';
  const activeStudios = store.getStudios();
  const treatments = store.getTreatments();
  if (treatments.length === 0) {
    card.append(el('div', { class: 'card' }, emptyState({
      iconName: 'tooth', color: 'mint', title: 'Nessun trattamento',
      text: activeStudios.length ? 'Aggiungi i trattamenti che fai (es. igiene dentale, sbiancamento) e scegli in quali studi li offri.' : 'Aggiungi prima uno studio, poi i trattamenti che fai lì.',
      action: activeStudios.length
        ? el('button', { type: 'button', class: 'btn btn-primary', id: 'ges-treatment-first', text: 'Aggiungi il primo trattamento', onclick: () => newTreatment(store, activeStudios) })
        : el('a', { class: 'btn btn-primary', href: '#altro/studi', text: 'Vai a Studi' }),
    })));
    return card;
  }
  card.append(sectionHead('I tuoi trattamenti'));
  const list = el('ul', { class: 'list grouped', id: 'ges-trattamenti-list' });
  for (const t of treatments) {
    const keys = Object.keys(t.studios);
    const active = keys.filter((k) => t.studios[k] === 'active').map(studioName).sort((a, b) => a.localeCompare(b, 'it'));
    const n = store.countEntries({ treatmentId: t.id });
    // sottotitolo di una riga: "Studio Rossi · 2 inserimenti" o "3 studi · …"; gli archiviati sono nella scheda.
    // senza studi attivi mai "0 studi": "Archiviato ovunque" o "Non offerto", come nel menu della scheda
    const where = active.length === 0 ? (keys.length ? 'Archiviato ovunque' : 'Non offerto')
      : active.length === 1 ? active[0] : plural(active.length, 'studio', 'studi');
    const sub = `${where} · ${plural(n, 'inserimento', 'inserimenti')}`;
    const row = listRow({ href: `#altro/trattamenti/${encodeURIComponent(t.id)}`, title: t.name, subtitle: sub });
    row.dataset.treatment = t.name;
    list.append(row);
  }
  card.append(list);
  return card;
}

function treatmentPage(ctx, rawId) {
  const { store } = ctx;
  const id = decodeURIComponent(rawId);
  const t = store.getTreatments().find((x) => x.id === id);
  if (!t) return notFound('Trattamento non trovato: potrebbe essere stato eliminato.', ['#altro/trattamenti', 'Trattamenti', 'altro-back']);
  const allStudios = store.getStudios({ includeArchived: true });
  const studioName = (sid) => allStudios.find((y) => y.id === sid)?.name ?? 'Studio eliminato';
  const wrap = el('div', { id: 'ges-treatment-page', dataset: { treatment: t.name } }, pageHeader({
    title: t.name, back: ['#altro/trattamenti', 'Trattamenti', 'altro-back'],
    navAction: navButton({ text: 'Rinomina', id: 'ges-treatment-rename', onClick: () => renameTreatment(store, t) }),
  }));
  const ul = el('ul', { class: 'list' });
  const ids = [...new Set([...allStudios.map((s) => s.id), ...Object.keys(t.studios)])];
  for (const sid of ids) {
    const s = allStudios.find((x) => x.id === sid);
    ul.append(el('li', { class: 'list-item state-row' },
      el('label', { for: `ges-ss-${sid}`, class: 'item-title state-label' }, s ? studioDot(s) : null,
        el('span', { class: 'state-name' }, el('span', { text: s ? s.name : 'Studio eliminato' }), s?.archived ? archivedBadge() : null)),
      treatmentStateSelect(ctx, t, sid, studioName, `ges-ss-${sid}`)));
  }
  wrap.append(el('section', { class: 'card' }, el('h3', { text: 'In quali studi lo offri' }), ul,
    groupNote('Archiviato: non compare più nei nuovi inserimenti di quello studio, i dati passati restano.')));
  const n = store.countEntries({ treatmentId: t.id });
  wrap.append(sectionHead(`Dati · ${plural(n, 'inserimento', 'inserimenti')}`), el('div', { class: 'danger-zone' },
    el('button', {
      type: 'button', class: 'btn btn-destructive btn-block', id: 'ges-treatment-delete', text: 'Elimina trattamento',
      onclick: async () => { await removalFlow(store, t, Object.keys(t.studios), studioName, true); if (!store.getTreatments().some((x) => x.id === t.id)) ctx.navigate('altro/trattamenti'); },
    })));
  return wrap;
}

function newTreatment(store, activeStudios) {
  const name = el('input', { type: 'text', id: 'dlg-treatment-name', maxlength: '60', autocomplete: 'off' });
  const fName = groupRow('Nome', name, { stacked: true });
  checkboxDialog({
    title: 'Nuovo trattamento',
    intro: 'In quali studi lo offri?',
    options: activeStudios.map((s) => ({ value: s.id, label: s.name, checked: activeStudios.length === 1 })),
    submitText: 'Aggiungi',
    extra: formGroup(fName.wrap),
    onSubmit: (ids, { setFormError }) => {
      fName.setError('');
      if (ids.length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      store.addTreatment(name.value, ids);
      toast(`Trattamento aggiunto in ${plural(ids.length, 'studio', 'studi')}`);
      return true;
    },
  });
}

function renameTreatment(store, t) {
  textDialog({
    title: 'Rinomina trattamento', label: 'Nome', value: t.name,
    onSubmit: (name) => { store.renameTreatment(t.id, name); toast('Trattamento rinominato'); return true; },
  });
}




/** Flusso di rimozione per la selezione S: S0 senza inserimenti, S1 con inserimenti. */
async function removalFlow(store, t, S, studioName, isDelete) {
  const S0 = [];
  const S1 = [];
  for (const id of S) {
    const n = store.countEntries({ studioId: id, treatmentId: t.id });
    if (n > 0) S1.push({ id, n }); else S0.push(id);
  }
  const done = (msg) => toast(msg);
  if (S1.length === 0) {
    const text = isDelete ? `Eliminare il trattamento «${t.name}»?` : `Rimuovere «${t.name}» da ${plural(S0.length, 'studio', 'studi')}?`;
    if (!(await confirmDialog(text, { okText: isDelete ? 'Elimina' : 'Rimuovi', danger: true }))) return;
    if (run(() => store.applyTreatmentRemoval(t.id, { archiveIds: [], removeIds: S0 }))) done(isDelete ? 'Trattamento eliminato' : 'Trattamento rimosso');
    return;
  }
  const total = S1.reduce((a, x) => a + x.n, 0);
  const choice = await choiceDialog({
    title: isDelete ? `Eliminare «${t.name}»?` : `Rimuovere «${t.name}»?`,
    message: 'In questi studi ci sono inserimenti con questo trattamento. Puoi archiviarlo (i dati restano) oppure eliminarlo definitivamente insieme agli inserimenti.',
    details: S1.map((x) => `${studioName(x.id)}: ${plural(x.n, 'inserimento', 'inserimenti')}`),
    choices: [
      { value: 'archive', label: 'Archivia', kind: 'primary' },
      { value: 'delete', label: 'Elimina definitivamente', kind: 'danger' },
      { value: null, label: 'Annulla', kind: 'secondary' },
    ],
  });
  if (choice === 'archive') {
    if (run(() => store.applyTreatmentRemoval(t.id, { archiveIds: S1.map((x) => x.id), removeIds: S0 }))) done('Trattamento archiviato');
  } else if (choice === 'delete') {
    if (!(await confirmDialog(alsoDeleted(total), { title: `Eliminare definitivamente «${t.name}»?`, okText: 'Elimina definitivamente', danger: true }))) return;
    if (run(() => store.applyTreatmentRemoval(t.id, { archiveIds: [], removeIds: [...S0, ...S1.map((x) => x.id)] }))) done(isDelete ? 'Trattamento eliminato' : 'Trattamento rimosso');
  }
}

// ---------- backup ----------
function backupFile(store) {
  const json = JSON.stringify(buildBackup(store.exportData()), null, 2);
  return new File([json], `DentalFlow-backup-${todayISO()}.json`, { type: 'application/json' });
}

/** Esporta (o condivide) il backup e ricorda la data per il promemoria. */
export function exportBackup(ctx, { share = false } = {}) {
  const f = backupFile(ctx.store);
  if (share) shareFile(f, f.name);
  else downloadBlob(f, f.name);
  ctx.prefs.set({ lastBackupAt: Date.now() });
  if (!share) toast('Backup esportato');
  ctx.rerender();
}

function daysAgo(ms) {
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'oggi' : d === 1 ? 'ieri' : `${d} giorni fa`;
}

function backupSection(ctx) {
  const { store } = ctx;
  const last = ctx.prefs.get().lastBackupAt;
  const card = el('section', { class: 'card', id: 'ges-backup' },
    el('div', { class: 'card-head' }, iconTile('backup', 'orange', { size: 'md', filled: true }),
      el('div', {}, el('h3', { text: 'Backup' }),
        el('p', { class: 'muted', id: 'ges-backup-last', text: last ? `Ultimo backup: ${formatDateShort(todayISO(last))} (${daysAgo(last)})` : 'Ultimo backup: mai' }))),
    el('p', { class: 'hint', text: 'I dati sono salvati solo in questo browser. Esporta un backup regolarmente: cancellare i dati del sito li elimina.' }));
  const exportBtn = el('button', {
    type: 'button', class: 'btn btn-primary', id: 'ges-backup-export', text: 'Esporta backup',
    onclick: () => exportBackup(ctx),
  });
  const fileInput = el('input', { type: 'file', id: 'ges-backup-file', accept: '.json,application/json', class: 'visually-hidden' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    await importBackup(ctx, file);
  });
  const importBtn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'ges-backup-import', text: 'Importa backup', onclick: () => fileInput.click() });
  const bar = el('div', { class: 'toolbar' }, exportBtn, importBtn, fileInput);
  if (canShareFile(new File(['{}'], 'x.json', { type: 'application/json' }))) {
    bar.append(el('button', { type: 'button', class: 'btn btn-secondary', id: 'ges-backup-share', text: 'Condividi', onclick: () => exportBackup(ctx, { share: true }) }));
  }
  card.append(bar);
  const copy = readBeforeImport(window.localStorage);
  if (copy) {
    card.append(el('div', { class: 'safety-copy', id: 'ges-before-import' },
      el('p', { class: 'hint', text: `Copia di sicurezza dei dati com'erano prima dell'ultima importazione (${new Date(copy.savedAt).toLocaleString('it-IT')}).` }),
      el('div', { class: 'toolbar' },
        el('button', { type: 'button', class: 'btn btn-secondary', id: 'ges-before-import-restore', text: 'Ripristina la copia di prima', onclick: () => restoreBeforeImport(ctx) }),
        el('button', { type: 'button', class: 'btn btn-secondary', id: 'ges-before-import-delete', text: 'Elimina la copia', onclick: () => deleteBeforeImport(ctx) }))));
  }
  return card;
}

/** La copia occupa quanto i dati: si può eliminare quando l'importazione va bene. */
async function deleteBeforeImport(ctx) {
  if (!(await confirmDialog('Eliminare la copia dei dati di prima dell\'importazione? Non potrai più tornare a quei dati. I dati attuali non cambiano.', { okText: 'Elimina la copia', danger: true }))) return;
  if (clearBeforeImport(window.localStorage)) toast('Copia di sicurezza eliminata');
  else toast('Impossibile eliminare la copia', { type: 'error' });
  ctx.rerender();
}

async function restoreBeforeImport(ctx) {
  const copy = readBeforeImport(window.localStorage);
  const res = copy ? validateBackup(copy.backup) : { ok: false, error: 'Copia di sicurezza non disponibile' };
  if (!res.ok) { toast(res.error, { type: 'error' }); return; }
  if (!(await confirmDialog(`Tornare ai dati di prima dell'importazione (${plural(res.data.entries.length, 'inserimento', 'inserimenti')})? I dati attuali verranno sostituiti.`, { okText: 'Ripristina', danger: true }))) return;
  if (run(() => ctx.store.replaceAll(res.data))) toast('Dati di prima dell\'importazione ripristinati');
}

async function importBackup(ctx, file) {
  const { store } = ctx;
  if (file.size > MAX_BACKUP) { toast('File troppo grande (max 10 MB)', { type: 'error' }); return; }
  let text;
  try {
    text = await file.text();
  } catch {
    toast('File di backup non valido', { type: 'error' });
    return;
  }
  const res = parseBackupText(text);
  if (!res.ok) { toast(res.error, { type: 'error', timeout: 6000 }); return; }
  const { studios, treatments, entries, calendar } = res.data;
  const calText = calendar
    ? `, calendario con ${plural(calendar.rules.length, 'regola', 'regole')} e ${plural(calendar.days.length, 'giorno singolo', 'giorni singoli')}`
    : '; il backup non contiene il calendario: quello attuale resta com\'è';
  const ok = await confirmDialog(
    `Sostituire tutti i dati attuali con quelli del backup (${plural(studios.length, 'studio', 'studi')}, ${plural(treatments.length, 'trattamento', 'trattamenti')}, ${plural(entries.length, 'inserimento', 'inserimenti')}${calText})? Prima dell'importazione viene salvata una copia dei dati attuali.`,
    { okText: 'Sostituisci', danger: true },
  );
  if (!ok) return;
  if (!writeBeforeImport(window.localStorage, buildBackup(store.exportData()), Date.now())) {
    if (!(await confirmDialog('Non c\'è spazio per salvare la copia di sicurezza dei dati attuali. Importare comunque?', { okText: 'Importa comunque', danger: true }))) return;
  }
  if (run(() => store.replaceAll(res.data))) {
    toast('Backup importato', { action: { label: 'Annulla importazione', onClick: () => restoreBeforeImport(ctx) } });
  }
}

// ---------- sincronizzazione ----------
function syncSection(ctx) {
  const { sync } = ctx;
  const st = sync.getStatus();
  // progetto già scritto nel codice (js/firebase-config.js): nel modulo restano solo email e password
  const preset = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId ? FIREBASE_CONFIG : null;
  if (!state.syncForm) {
    state.syncForm = {
      apiKey: preset ? preset.apiKey : st.apiKey || '',
      projectId: preset ? preset.projectId : st.projectId || '',
      email: st.email || '', password: '',
    };
  }
  const f = state.syncForm;
  const mk = (id, type, key, label, extra = {}) => {
    const input = el('input', { type, id, value: f[key], autocomplete: 'off', spellcheck: 'false', ...extra });
    input.addEventListener('input', () => { f[key] = input.value; });
    return groupRow(label, input, { inline: true });
  };
  const fKey = mk('ges-sync-apikey', 'text', 'apiKey', 'API key', { placeholder: 'AIza…' });
  const fProject = mk('ges-sync-project', 'text', 'projectId', 'Project ID', { placeholder: 'es. dentalflow-1234' });
  const fEmail = mk('ges-sync-email', 'email', 'email', 'Email', { autocomplete: 'username', placeholder: 'nome@esempio.it' });
  const fPass = mk('ges-sync-password', 'password', 'password', 'Password', { autocomplete: 'current-password', placeholder: 'Obbligatoria' });

  const signInBtn = el('button', {
    type: 'submit', class: 'btn btn-primary', id: 'ges-sync-signin',
    text: state.signingIn ? 'Accesso in corso…' : 'Accedi e sincronizza', disabled: state.signingIn,
  });
  const form = el('form', { class: 'form', novalidate: true, id: 'ges-sync-form' },
    preset ? null : sectionHead('Progetto Firebase'), preset ? null : formGroup(fKey.wrap, fProject.wrap),
    sectionHead('Account'), formGroup(fEmail.wrap, fPass.wrap),
    preset ? groupNote(`Progetto Firebase: ${preset.projectId}`, { id: 'ges-sync-project-note' }) : null,
    el('div', { class: 'toolbar' }, signInBtn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.signingIn) return;
    [fKey, fProject, fEmail, fPass].forEach((x) => x.setError(''));
    const apiKey = f.apiKey.trim();
    const projectId = f.projectId.trim();
    const email = f.email.trim();
    const password = f.password.trim();
    if (!apiKey) { fKey.setError('Inserisci la chiave API'); return; }
    if (!/^[a-z0-9-]{6,30}$/.test(projectId)) { fProject.setError('Project ID non valido (solo lettere minuscole, numeri e trattini)'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fEmail.setError('Email non valida'); return; }
    if (!password) { fPass.setError('Inserisci la password'); return; }
    state.signingIn = true;
    ctx.rerender();
    try {
      sync.configure({ apiKey, projectId });
      await sync.signIn(email, password);
      const after = sync.getStatus();
      toast(after.lastError ? after.lastError : 'Sincronizzazione completata', { type: after.lastError ? 'error' : 'info', timeout: 5000 });
    } catch (err) {
      toast(err?.message || String(err), { type: 'error', timeout: 5000 });
    } finally {
      state.signingIn = false;
      f.password = '';
      const pw = document.getElementById('ges-sync-password');
      if (pw) pw.value = '';
      ctx.rerender();
    }
  });

  let status;
  if (!st.configured) status = 'Sincronizzazione disattivata: i dati restano solo su questo dispositivo.';
  else if (st.lastError) status = st.lastError;
  else if (st.lastSyncAt) status = `Ultima sincronizzazione: ${new Date(st.lastSyncAt).toLocaleString('it-IT')}`;
  else if (st.enabled) status = 'Connesso: in attesa della prima sincronizzazione.';
  else status = 'Non connesso.';

  const actions = el('div', { class: 'toolbar' });
  if (st.enabled) {
    actions.append(el('button', {
      type: 'button', class: 'btn btn-secondary', id: 'ges-sync-now', text: state.syncing ? 'Sincronizzazione…' : 'Sincronizza ora', disabled: state.syncing,
      onclick: async () => {
        state.syncing = true;
        ctx.rerender();
        try {
          await sync.syncNow();
        } finally {
          state.syncing = false;
          ctx.rerender();
        }
      },
    }));
  }
  if (st.configured) {
    actions.append(el('button', {
      type: 'button', class: 'btn btn-secondary', id: 'ges-sync-signout', text: 'Disconnetti',
      onclick: async () => {
        if (!(await confirmDialog('Disconnettere la sincronizzazione? I dati locali restano su questo dispositivo.', { okText: 'Disconnetti' }))) return;
        try {
          sync.signOut();
          state.syncForm = null;
          toast('Sincronizzazione disconnessa');
        } catch (err) {
          showError(err);
        }
        ctx.rerender();
      },
    }));
  }

  return el('section', { id: 'ges-sync' },
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, iconTile('sync', 'sky', { size: 'md', filled: true }),
        el('div', {}, el('h3', { text: 'Firebase · facoltativa' }),
          el('p', { class: st.lastError ? 'field-error' : 'muted', id: 'ges-sync-status', role: 'status', text: status }))),
      el('p', { class: 'card-note', text: 'Serve solo per avere i dati su più dispositivi. Senza configurazione l\'app funziona completamente offline. Le istruzioni sono nel README.' }),
      actions.childElementCount ? actions : null),
    form);
}

// ---------- installazione e info ----------
function installSection(ctx) {
  const { install } = ctx;
  const card = el('section', { class: 'card', id: 'ges-install' }, el('h3', { text: 'Installa app' }));
  card.append(el('div', { class: 'card-head' }, iconTile('install', 'indigo', { size: 'md', filled: true }),
    el('p', { class: 'muted', text: 'Installata, DentalFlow si apre a schermo intero dalla schermata Home e funziona anche senza rete.' })));
  if (install.isInstalled()) {
    card.append(el('p', { class: 'today-done' }, icon('check'), 'App installata'));
  } else {
    if (install.canInstall()) {
      card.append(el('button', { type: 'button', class: 'btn btn-primary', id: 'ges-install-btn', text: 'Installa app', onclick: () => install.prompt() }));
    } else {
      card.append(el('p', { class: 'muted', text: 'Su Android/Chrome usa il menu del browser → "Installa app" se il pulsante non compare.' }));
    }
    card.append(el('p', { class: 'hint', text: 'Su iPhone: Condividi → Aggiungi alla schermata Home' }));
  }
  return card;
}

function infoSection() {
  const version = el('span', { id: 'ges-version', text: state.version || '…' });
  getSwVersion().then((v) => { state.version = v; version.textContent = v; });
  return el('section', { class: 'card', id: 'ges-info' }, el('h3', { text: 'Info' }),
    el('div', { class: 'app-info' },
      el('img', { src: './icons/icon-192.png', alt: '', width: '72', height: '72' }),
      el('h3', { text: 'DentalFlow' }),
      el('p', { class: 'muted' }, 'Versione app: ', version),
      el('p', { class: 'hint', text: 'Dati salvati sul dispositivo · funziona anche offline.' })));
}
