// VN01: pagina non presente nei menu (Altro → Info, 5 tocchi veloci sul logo; indirizzo #altro/vn01).
// Voci tenute separate (es. trattamenti fatti a familiari e pagati di tasca propria). Si inseriscono,
// modificano ed eliminano solo qui: sono record 'vn' a parte, che nessuna schermata principale legge
// (non compaiono in Oggi, Inserisci, Registro, Recap, Grafici, Tasse, CSV). Sync e backup le conservano.
import {
  el, toast, showError, formDialog, groupRow, formGroup, groupNote, sectionHead, iconButton, icon, undoToast,
} from '../ui.js';
import { formatEuro, parseEuroInput, formatEuroCsv, parsePatients } from '../money.js';
import { todayISO, isValidISODate, formatDayShort } from '../dates.js';
import { MAX_CENTS, MAX_NOTE } from '../store.js';
import { line, capitalizeFirst } from './tasse.js';

const state = { year: Number(todayISO().slice(0, 4)) };
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const times = (n) => `${n} ${n === 1 ? 'volta' : 'volte'}`;

export function render(ctx) {
  const { store } = ctx;
  const year = state.year;
  const items = store.getVn({ from: `${year}-01-01`, to: `${year}-12-31` });
  const studios = store.getStudios({ includeArchived: true });
  const studioName = new Map(studios.map((s) => [s.id, s.name]));
  const total = items.reduce((a, v) => a + v.amountCents, 0);
  const patients = items.reduce((a, v) => a + v.patients, 0);
  const wrap = el('div', { id: 'res-page' });

  wrap.append(el('div', { class: 'filterbar' }, el('div', { class: 'period-nav' }, el('div', { class: 'stepper-nav' },
    iconButton({ name: 'chevron-left', label: 'Anno precedente', id: 'res-prev', onClick: () => { state.year -= 1; ctx.rerender(); } }),
    el('span', { class: 'nav-label tax-year', id: 'res-year', 'aria-live': 'polite', text: `Anno ${year}` }),
    iconButton({ name: 'chevron', label: 'Anno successivo', id: 'res-next', onClick: () => { state.year += 1; ctx.rerender(); } })))));

  wrap.append(el('section', { class: 'kpi-section', id: 'res-kpis' },
    el('div', { class: 'kpi-grid' },
      el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Totale' }), el('strong', { class: 'kpi-value', id: 'res-total', text: formatEuro(total) })),
      el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Volte' }), el('strong', { class: 'kpi-value', id: 'res-count', text: String(items.length) })),
      el('div', { class: 'kpi' }, el('span', { class: 'kpi-label', text: 'Pazienti' }), el('strong', { class: 'kpi-value', id: 'res-patients', text: String(patients) })))));

  wrap.append(el('button', {
    type: 'button', class: 'btn btn-primary btn-block', id: 'res-add', onclick: () => itemDialog(ctx, null),
  }, icon('plus'), 'Aggiungi'));

  if (items.length === 0) {
    wrap.append(el('p', { class: 'muted res-empty', id: 'res-empty', text: `Nessuna voce nel ${year}.` }));
    return wrap;
  }

  // riepilogo per trattamento e per mese
  const byT = new Map();
  const byM = new Map();
  for (const v of items) {
    const t = byT.get(v.treatment) || { cents: 0, n: 0 };
    t.cents += v.amountCents; t.n += 1; byT.set(v.treatment, t);
    const ym = v.date.slice(0, 7);
    const m = byM.get(ym) || { cents: 0, n: 0 };
    m.cents += v.amountCents; m.n += 1; byM.set(ym, m);
  }
  wrap.append(el('section', { class: 'card', id: 'res-by-treatment' }, el('h3', { text: 'Per trattamento' }),
    el('ul', { class: 'list tax-lines' }, [...byT].sort((a, b) => b[1].cents - a[1].cents)
      .map(([name, v]) => line(name, formatEuro(v.cents), { sub: times(v.n) })))));
  wrap.append(el('section', { class: 'card', id: 'res-by-month' }, el('h3', { text: 'Per mese' }),
    el('ul', { class: 'list tax-lines' }, [...byM].sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([ym, v]) => line(capitalizeFirst(MONTHS[Number(ym.slice(5, 7)) - 1]), formatEuro(v.cents), { sub: times(v.n) })))));

  // elenco delle voci: un tocco per modificare o eliminare
  const ul = el('ul', { class: 'list grouped', id: 'res-items' });
  for (const v of items) {
    const sub = [formatDayShort(v.date), studioName.get(v.studioId), `${v.patients} ${v.patients === 1 ? 'paziente' : 'pazienti'}`, v.note || null].filter(Boolean).join(' · ');
    ul.append(el('li', {}, el('button', {
      type: 'button', class: 'row', dataset: { vn: v.id }, 'aria-label': `Modifica ${v.treatment}, ${formatDayShort(v.date)}`,
      onclick: () => itemDialog(ctx, v),
    }, el('span', { class: 'row-main' }, el('span', { class: 'row-title', text: v.treatment }), el('span', { class: 'row-sub', text: sub })),
    el('span', { class: 'amount', text: formatEuro(v.amountCents) }), icon('chevron'))));
  }
  wrap.append(sectionHead('Voci'), ul);
  return wrap;
}

/** Foglio "Nuova voce" / "Modifica voce": data, studio (facoltativo), trattamento, pazienti, importo, nota. */
function itemDialog(ctx, item) {
  const { store } = ctx;
  const studios = store.getStudios({ includeArchived: true }).filter((s) => !s.archived || s.id === item?.studioId);
  const names = [...new Set([...store.getTreatments().map((t) => t.name), ...store.getVn().map((v) => v.treatment)])]
    .sort((a, b) => a.localeCompare(b, 'it'));
  const listId = 'res-f-treatments';
  const date = el('input', { type: 'date', id: 'res-f-date', value: item?.date || todayISO() });
  const studio = el('select', { id: 'res-f-studio' }, el('option', { value: '', text: '—' }),
    studios.map((s) => el('option', { value: s.id, text: s.name, selected: s.id === item?.studioId })));
  const treatment = el('input', { type: 'text', id: 'res-f-treatment', list: listId, maxlength: '60', autocomplete: 'off', value: item?.treatment || '', placeholder: 'Es. Igiene dentale' });
  const datalist = el('datalist', { id: listId }, names.map((n) => el('option', { value: n })));
  const pat = el('input', { type: 'number', id: 'res-f-patients', inputmode: 'numeric', min: '1', max: '999', value: String(item?.patients ?? 1) });
  const amt = el('input', { type: 'text', id: 'res-f-amount', inputmode: 'decimal', placeholder: '0,00', autocomplete: 'off', value: item ? formatEuroCsv(item.amountCents) : '' });
  const note = el('input', { type: 'text', id: 'res-f-note', maxlength: String(MAX_NOTE), autocomplete: 'off', value: item?.note || '', placeholder: 'Facoltativa' });
  const f = {
    date: groupRow('Data', date), studio: groupRow('Studio', studio), treatment: groupRow('Trattamento', treatment, { stacked: true }),
    patients: groupRow('Pazienti', pat), amount: groupRow('Importo (€)', amt), note: groupRow('Nota', note, { stacked: true }),
  };
  formDialog({
    title: item ? 'Modifica voce' : 'Nuova voce',
    submitText: item ? 'Salva' : 'Aggiungi',
    build: (form) => form.append(
      formGroup(f.date.wrap, f.studio.wrap), formGroup(f.treatment.wrap), datalist,
      formGroup(f.patients.wrap, f.amount.wrap), formGroup(f.note.wrap),
      groupNote('Visibile solo in questa pagina.')),
    extraAction: item ? {
      label: 'Elimina', kind: 'danger',
      onClick: () => {
        try {
          undoToast(store, 'Voce eliminata', store.deleteVn(item.id));
        } catch (err) {
          showError(err);
        }
      },
    } : undefined,
    onSubmit: () => {
      Object.values(f).forEach((x) => x.setError(''));
      const p = parsePatients(pat.value, { min: 1 });
      const cents = parseEuroInput(amt.value);
      if (!isValidISODate(date.value)) { f.date.setError('Data non valida'); return false; }
      if (!treatment.value.trim()) { f.treatment.setError('Scrivi il trattamento'); return false; }
      if (p === null) { f.patients.setError('Numero pazienti non valido (1–999)'); return false; }
      if (cents === null || cents > MAX_CENTS) { f.amount.setError('Importo non valido'); return false; }
      const input = { date: date.value, studioId: studio.value, treatment: treatment.value, patients: p, amountCents: cents, note: note.value };
      if (item) store.updateVn(item.id, input);
      else store.addVn(input);
      toast(item ? 'Voce aggiornata' : 'Voce aggiunta');
      if (!item) state.year = Number(date.value.slice(0, 4));
      ctx.rerender();
      return true;
    },
  });
}
