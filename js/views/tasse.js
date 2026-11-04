// Tasse (sezione del Recap, #recap/tasse): stima di contributi INPS e imposta sostitutiva del forfettario
// per anno solare, quanto mettere da parte, scadenze dell'anno dopo e parametri modificabili.
// I calcoli sono in tax.js; i parametri sono un'impostazione dell'account (store 'setting' id 'tax':
// si sincronizzano ed entrano nel backup). I parametri salvati sul dispositivo dalla v11 valgono finché non si salva.
import {
  el, toast, formDialog, groupRow, formGroup, groupNote, sectionHead, iconTile, icon, iconButton, listRow,
} from '../ui.js';
import { formatEuro, formatPct, parseEuroInput, formatEuroCsv } from '../money.js';
import { todayISO, formatLong } from '../dates.js';
import {
  forfettario, scadenze, yearCompensi, yearBolli, normalizeTaxParams, TAX_DEFAULTS, TAX_LIMITS,
  FORFETTARIO_SOGLIA, lastStartupYear, yearPaymentExclusions,
} from '../tax.js';
import { isValidISODate, formatDateShort } from '../dates.js';

const state = { year: Number(todayISO().slice(0, 4)) };
const pctText = (bp) => `${formatEuroCsv(bp).replace(/,00$/, '')} %`; // 2607 → "26,07 %", 7800 → "78 %"

function yearEntries(store, year) {
  return store.getEntries({ from: `${year}-01-01`, to: `${year}-12-31` });
}

function estimateFor(store, params, year) {
  return forfettario({
    // compensi dell'anno meno le somme escluse a mano nei mesi (Incassi → "Escludi spesa")
    compensiCents: Math.max(0, yearCompensi(yearEntries(store, year), year) - yearPaymentExclusions(store.getPayments(), year)),
    bolli: yearBolli(store.getPayments(), year),
    params,
    year,
  });
}

/** Riga "etichetta … importo" di un elenco raggruppato; strong = riga di totale. */
function line(label, value, { sub, strong = false, id } = {}) {
  return el('li', { class: `tax-line${strong ? ' is-total' : ''}`, id },
    el('span', { class: 'tax-label' }, el('span', { text: label }), sub ? el('span', { class: 'row-sub', text: sub }) : null),
    el('span', { class: 'tax-value', text: value }));
}

/** Parametri: impostazione dell'account, altrimenti quelli salvati sul dispositivo (v11), altrimenti i predefiniti. */
export function taxParams(ctx) {
  return normalizeTaxParams(ctx.store.getSetting('tax') ?? ctx.prefs.get().tax);
}

export function renderInto(container, ctx) {
  const { store } = ctx;
  const params = taxParams(ctx);
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const year = state.year;
  const s = estimateFor(store, params, year);
  const prev = estimateFor(store, params, year - 1);
  const ongoing = year === thisYear;
  const months = ongoing ? Number(today.slice(5, 7)) : 12;

  // anno: ‹ 2026 ›
  container.append(el('div', { class: 'filterbar' }, el('div', { class: 'period-nav' }, el('div', { class: 'stepper-nav' },
    iconButton({ name: 'chevron-left', label: 'Anno precedente', id: 'tax-prev', onClick: () => { state.year -= 1; ctx.rerender(); } }),
    el('span', { class: 'nav-label tax-year', id: 'tax-year', 'aria-live': 'polite', text: `Anno ${year}` }),
    iconButton({ name: 'chevron', label: 'Anno successivo', id: 'tax-next', onClick: () => { state.year += 1; ctx.rerender(); } })))));

  if (s.ricavi === 0) {
    container.append(el('section', { class: 'card', id: 'tax-empty' },
      el('div', { class: 'card-head' }, iconTile('euro', 'green', { size: 'md', filled: true }),
        el('div', {}, el('h3', { text: `Nessun compenso nel ${year}` }),
          el('p', { class: 'muted', text: 'La stima compare appena inserisci le giornate di quell\'anno.' })))));
    container.append(paramsCard(ctx, params));
    return;
  }

  // avvisi sulle soglie del forfettario
  if (s.soglia) {
    container.append(el('p', { class: 'tax-warning', id: 'tax-soglia', role: 'status' }, icon('warning'),
      s.soglia === 'uscita'
        ? 'Oltre 100.000 €: si esce dal forfettario già in quest\'anno. Questa stima non vale: senti il commercialista.'
        : `Oltre ${formatEuro(FORFETTARIO_SOGLIA)}: dal ${year + 1} si passa al regime ordinario.`));
  }

  // numeri principali
  container.append(el('section', { class: 'kpi-section', id: 'tax-kpis', 'aria-label': 'Stima delle tasse' },
    sectionHead(ongoing ? `${year} · dati fino a oggi` : `${year}`),
    el('div', { class: 'kpi-grid' },
      el('div', { class: 'kpi', id: 'tax-kpi-netto' }, el('span', { class: 'kpi-label', text: 'Netto stimato' }),
        el('strong', { class: 'kpi-value', text: formatEuro(s.netto) })),
      el('div', { class: 'kpi', id: 'tax-kpi-totale' }, el('span', { class: 'kpi-label', text: 'Tasse e contributi' }),
        el('strong', { class: 'kpi-value', text: formatEuro(s.totale) })),
      el('div', { class: 'kpi', id: 'tax-kpi-share' }, el('span', { class: 'kpi-label', text: 'Da mettere da parte' }),
        el('strong', { class: 'kpi-value', text: formatPct(s.shareTenths) }),
        el('span', { class: 'kpi-change', text: `${formatEuro(Math.round(s.totale / months))} al mese` }))),
    el('p', { class: 'kpi-note', id: 'tax-share-note', text: `Di ogni euro incassato metti da parte ${formatPct(s.shareTenths)}: `
      + `in media ${formatEuro(Math.round(s.totale / months))} al mese${ongoing ? ` (su ${months} ${months === 1 ? 'mese' : 'mesi'} del ${year})` : ''}.` })));

  // calcolo passo per passo
  const ul = el('ul', { class: 'list tax-lines', id: 'tax-calc' },
    line('Compensi', formatEuro(s.compensi), { sub: 'Pagati e da incassare, per data della prestazione', id: 'tax-compensi' }),
    s.bolli ? line('Marche da bollo pagate dagli studi', formatEuro(s.bolloCents), { sub: `${s.bolli} × ${formatEuro(params.bollo)}`, id: 'tax-bolli' }) : null,
    line('Ricavi', formatEuro(s.ricavi), { strong: true, id: 'tax-ricavi' }),
    line(`Reddito (× ${pctText(params.coeff)})`, formatEuro(s.reddito), { sub: 'Coefficiente di redditività', id: 'tax-reddito' }),
    line(`Contributi INPS (${pctText(params.inps)})`, formatEuro(s.contributi), { sub: 'Gestione Separata, sul reddito', id: 'tax-inps' }),
    line('Imponibile', formatEuro(s.imponibile), { sub: 'Reddito meno contributi', id: 'tax-imponibile' }),
    line(`Imposta sostitutiva (${pctText(s.rate)})`, formatEuro(s.imposta), { id: 'tax-imposta', sub: rateNote(params, year) }),
    line('Tasse e contributi', formatEuro(s.totale), {
      strong: true, id: 'tax-totale',
      sub: `${formatPct(s.onRedditoTenths)} del reddito (la parte al ${pctText(params.coeff)}) · ${formatPct(s.shareTenths)} dei ricavi`,
    }),
    line('Netto', formatEuro(s.netto), { strong: true, id: 'tax-netto' }));
  container.append(el('section', { class: 'card', id: 'tax-calc-card' },
    el('div', { class: 'card-head' }, iconTile('euro', 'green'), el('h3', { text: 'Calcolo (regime forfettario)' })), ul));

  // scadenze dell'anno dopo
  const sc = scadenze(year, s, prev);
  const due = (d) => formatLong(d.date);
  const june = el('ul', { class: 'list tax-lines', id: 'tax-june' },
    line(sc.giugno.saldoImposta < 0 ? `Credito imposta ${year}` : `Saldo imposta ${year}`, formatEuro(Math.abs(sc.giugno.saldoImposta))),
    line(sc.giugno.saldoContributi < 0 ? `Credito contributi ${year}` : `Saldo contributi ${year}`, formatEuro(Math.abs(sc.giugno.saldoContributi))),
    line(`1° acconto imposta ${year + 1}`, formatEuro(sc.giugno.accontoImposta)),
    line(`1° acconto contributi ${year + 1}`, formatEuro(sc.giugno.accontoContributi)),
    line('Totale', formatEuro(sc.giugno.totale), { strong: true, id: 'tax-june-total' }));
  const nov = el('ul', { class: 'list tax-lines', id: 'tax-nov' },
    line(`2° acconto imposta ${year + 1}`, formatEuro(sc.novembre.accontoImposta)),
    line(`2° acconto contributi ${year + 1}`, formatEuro(sc.novembre.accontoContributi)),
    line('Totale', formatEuro(sc.novembre.totale), { strong: true, id: 'tax-nov-total' }));
  const versati = sc.versati.imposta + sc.versati.contributi;
  container.append(el('section', { class: 'card', id: 'tax-due' },
    el('div', { class: 'card-head' }, iconTile('calendar', 'red'), el('h3', { text: `Scadenze ${year + 1}` })),
    el('h4', { class: 'group-title', text: capitalizeFirst(due(sc.giugno)) }), june,
    sc.giugno.credito ? groupNote(`Credito di ${formatEuro(sc.giugno.credito)} da usare in compensazione.`) : null,
    el('h4', { class: 'group-title', text: capitalizeFirst(due(sc.novembre)) }), nov,
    groupNote(versati
      ? `Acconti già versati per il ${year}: ${formatEuro(versati)}, calcolati dai dati del ${year - 1} nell'app.`
      : `Nessun acconto versato per il ${year}: nell'app non ci sono dati del ${year - 1}. Se li hai versati, il saldo di giugno sarà più basso.`)));

  container.append(paramsCard(ctx, params));
  container.append(el('p', { class: 'hint tax-disclaimer', id: 'tax-disclaimer', text:
    'Stima indicativa, non una consulenza: confermala con il commercialista. Per legge i compensi contano nell\'anno in cui '
    + 'vieni pagata; qui contano per data della prestazione (anche quelli da incassare). I contributi dedotti sono stimati '
    + 'uguali a quelli dell\'anno; il massimale INPS e i casi di uscita dal regime non sono calcolati.' }));
}

const capitalizeFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** "5 % fino al 2028, poi 15 %" con la data di apertura; null senza. */
function rateNote(params, year) {
  const last = lastStartupYear(params);
  if (last === null) return null;
  if (year <= last) return `5 % fino al ${last} (apertura ${formatDateShort(params.openDate)}), dal ${last + 1} 15 %`;
  return `15 % dal ${last + 1}: passati i 5 anni dall'apertura`;
}

function rateSummary(params) {
  const last = lastStartupYear(params);
  return last === null ? `imposta ${pctText(params.rate)}` : `imposta 5 % fino al ${last}, poi 15 %`;
}

function paramsCard(ctx, params) {
  const custom = JSON.stringify(params) !== JSON.stringify(TAX_DEFAULTS);
  return el('ul', { class: 'list grouped', id: 'tax-params' },
    listRow({
      id: 'tax-params-open', title: 'Parametri', lead: iconTile('appearance', 'gray'),
      subtitle: `${custom ? 'Personalizzati · ' : ''}coefficiente ${pctText(params.coeff)} · INPS ${pctText(params.inps)} · ${rateSummary(params)} · bollo ${formatEuro(params.bollo)}`,
      onClick: () => paramsDialog(ctx, params),
    }));
}

function paramsDialog(ctx, params) {
  const pctInput = (id, bp) => el('input', { type: 'text', id, inputmode: 'decimal', value: formatEuroCsv(bp), autocomplete: 'off' });
  const coeff = pctInput('tax-p-coeff', params.coeff);
  const inps = el('select', { id: 'tax-p-inps' },
    [[2607, '26,07 % · senza altra copertura'], [2400, '24 % · anche dipendente o pensionata']].map(([v, t]) => el('option', { value: String(v), text: t, selected: v === params.inps })),
    ![2607, 2400].includes(params.inps) ? el('option', { value: String(params.inps), text: pctText(params.inps), selected: true }) : null);
  const rate = el('select', { id: 'tax-p-rate' },
    [[1500, '15 %'], [500, '5 % · primi 5 anni (start-up)']].map(([v, t]) => el('option', { value: String(v), text: t, selected: v === params.rate })),
    ![1500, 500].includes(params.rate) ? el('option', { value: String(params.rate), text: pctText(params.rate), selected: true }) : null);
  const bollo = el('input', { type: 'text', id: 'tax-p-bollo', inputmode: 'decimal', value: formatEuroCsv(params.bollo), autocomplete: 'off' });
  const open = el('input', { type: 'date', id: 'tax-p-open', value: params.openDate || '' });
  const fOpen = groupRow('Apertura partita IVA', open);
  const fRate = groupRow('Imposta sostitutiva', rate);
  const auto = el('p', { class: 'group-note', id: 'tax-p-auto', 'aria-live': 'polite' });
  const clearOpen = el('button', { type: 'button', class: 'btn-link', id: 'tax-p-open-clear', text: 'Togli la data', onclick: () => { open.value = ''; refresh(); } });
  const refresh = () => {
    const ok = isValidISODate(open.value);
    fRate.wrap.hidden = ok;
    clearOpen.hidden = !open.value;
    const last = ok ? Number(open.value.slice(0, 4)) + 4 : null;
    auto.textContent = ok
      ? `Imposta automatica: 5 % dal ${open.value.slice(0, 4)} al ${last}, 15 % dal ${last + 1}.`
      : 'Senza data di apertura vale l\'imposta scelta qui sopra.';
  };
  open.addEventListener('input', refresh);
  open.addEventListener('change', refresh);
  const fCoeff = groupRow('Coefficiente (%)', coeff);
  const fBollo = groupRow('Marca da bollo (€)', bollo);
  formDialog({
    title: 'Parametri delle tasse',
    build: (form) => {
      form.append(
      formGroup(fOpen.wrap, fRate.wrap), auto, el('div', { class: 'toolbar' }, clearOpen),
      formGroup(fCoeff.wrap, groupRow('Contributi INPS', inps).wrap, fBollo.wrap),
      groupNote('Valori 2026 per igienista dentale in forfettario: coefficiente 78 % (ATECO 86.99.09), Gestione Separata 26,07 %, imposta 5 % nell\'anno di apertura e nei 4 successivi (se hai i requisiti), poi 15 %, marca da bollo 2 €. Si salvano nel tuo account: valgono su tutti i dispositivi sincronizzati e nel backup.'),
      el('div', { class: 'toolbar' }, el('button', {
        type: 'button', class: 'btn btn-small btn-secondary', id: 'tax-p-reset', text: 'Ripristina i valori predefiniti',
        onclick: () => {
          coeff.value = formatEuroCsv(TAX_DEFAULTS.coeff); inps.value = String(TAX_DEFAULTS.inps);
          rate.value = String(TAX_DEFAULTS.rate); bollo.value = formatEuroCsv(TAX_DEFAULTS.bollo);
          refresh(); // la data di apertura resta: è un dato tuo, non un parametro di legge
        },
      })));
      refresh();
    },
    onSubmit: () => {
      fCoeff.setError(''); fBollo.setError(''); fOpen.setError('');
      if (open.value && !isValidISODate(open.value)) { fOpen.setError('Data non valida'); return false; }
      const c = parseEuroInput(coeff.value);
      const b = parseEuroInput(bollo.value);
      if (c === null || c < TAX_LIMITS.coeff[0] || c > TAX_LIMITS.coeff[1]) { fCoeff.setError('Coefficiente non valido (1–100 %)'); return false; }
      if (b === null || b > TAX_LIMITS.bollo[1]) { fBollo.setError('Importo non valido'); return false; }
      const next = { coeff: c, inps: Number(inps.value), rate: Number(rate.value), bollo: b, openDate: open.value || null,
      };
      ctx.store.setSetting('tax', next); // errori di salvataggio: messaggio nel foglio (formDialog)
      ctx.prefs.set({ tax: null }); // la copia sul dispositivo (v11) non serve più
      toast('Parametri aggiornati');
      ctx.rerender();
      return true;
    },
  });
}

