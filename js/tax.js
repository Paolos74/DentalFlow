// Stima di tasse e contributi nel regime forfettario (funzioni pure, importi in centesimi interi).
// Percentuali in centesimi di punto: 7800 = 78,00 %, 2607 = 26,07 %.
//
// Regole (2026, Gestione Separata INPS, professionista senza cassa):
//  ricavi        = compensi dell'anno (data della prestazione, pagati e da incassare) + marche da bollo addebitate
//  reddito       = ricavi × coefficiente di redditività (78 %)
//  contributi    = reddito × aliquota Gestione Separata (26,07 %; 24 % con altra copertura, es. dipendente)
//  imponibile    = reddito − contributi (stima "a regime": contributi versati nell'anno ≈ quelli dovuti sull'anno)
//  imposta       = imponibile × imposta sostitutiva (15 %; 5 % per i primi 5 anni con i requisiti)
//                  con openDate (apertura della partita IVA): 5 % nell'anno di apertura e nei 4 successivi, poi 15 %
// Acconti (metodo storico): imposta 100 % (40 % a giugno, 60 % a novembre; un solo acconto a novembre
// tra 51,65 € e 257,52 €; nessuno sotto 51,65 €), contributi 80 % (40 % + 40 %).

// imposta predefinita 5 % (scelta dell'utente: primi 5 anni di attività)
export const TAX_DEFAULTS = Object.freeze({ coeff: 7800, inps: 2607, rate: 500, bollo: 200, openDate: null });
export const RATE_STARTUP = 500;
export const RATE_STANDARD = 1500;
export const STARTUP_YEARS = 5;
const ISO_RE = /^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TAX_LIMITS = Object.freeze({
  coeff: [100, 10000], inps: [0, 5000], rate: [0, 5000], bollo: [0, 10000],
});
export const FORFETTARIO_SOGLIA = 8500000; // 85.000,00 €: oltre, dall'anno dopo regime ordinario
export const FORFETTARIO_USCITA = 10000000; // 100.000,00 €: oltre, uscita nello stesso anno
export const BOLLO_SOGLIA = 7747; // 77,47 €: oltre, la fattura esente IVA vuole la marca da bollo
const ACCONTO_MIN = 5165; // 51,65 €
const ACCONTO_UNICO = 25752; // 257,52 €

const pct = (cents, bp) => Math.round((cents * bp) / 10000);

/** Parametri validi (interi nei limiti), con i valori predefiniti al posto di quelli mancanti o errati. */
export function normalizeTaxParams(p) {
  const out = { ...TAX_DEFAULTS };
  if (p && typeof p === 'object') {
    for (const [k, [min, max]] of Object.entries(TAX_LIMITS)) {
      const v = p[k];
      if (Number.isInteger(v) && v >= min && v <= max) out[k] = v;
    }
    if (typeof p.openDate === 'string' && ISO_RE.test(p.openDate)) out.openDate = p.openDate;
  }
  return out;
}

/** Ultimo anno con l'imposta al 5 % (anno di apertura + 4), o null senza data di apertura. */
export function lastStartupYear(params) {
  const d = normalizeTaxParams(params).openDate;
  return d ? Number(d.slice(0, 4)) + STARTUP_YEARS - 1 : null;
}

/** Aliquota dell'imposta per l'anno: automatica con la data di apertura, altrimenti quella scelta. */
export function rateForYear(params, year) {
  const p = normalizeTaxParams(params);
  const last = lastStartupYear(p);
  if (last === null || year === undefined || year === null) return p.rate;
  return Number(year) <= last ? RATE_STARTUP : RATE_STANDARD;
}

/** Compensi dell'anno: somma degli inserimenti con data nell'anno (YYYY). */
export function yearCompensi(entries, year) {
  const y = String(year);
  let cents = 0;
  for (const e of entries || []) if (!e.deleted && e.date.slice(0, 4) === y) cents += e.amountCents;
  return cents;
}

/** Marche da bollo addebitate nell'anno: mesi pagati con la spunta "bollo". */
export function yearBolli(payments, year) {
  const y = String(year);
  return (payments || []).filter((p) => !p.deleted && p.paid === true && p.bollo === true && p.month.slice(0, 4) === y).length;
}

/** Stima annuale del forfettario. */
export function forfettario({ compensiCents, bolli = 0, params, year }) {
  const p = normalizeTaxParams(params);
  const rate = rateForYear(p, year);
  const bolloCents = bolli * p.bollo;
  const ricavi = compensiCents + bolloCents;
  const reddito = pct(ricavi, p.coeff);
  const contributi = pct(reddito, p.inps);
  const imponibile = Math.max(0, reddito - contributi);
  const imposta = pct(imponibile, rate);
  const totale = contributi + imposta;
  return {
    rate, compensi: compensiCents, bolli, bolloCents, ricavi, reddito, contributi, imponibile, imposta, totale,
    netto: ricavi - totale,
    // quota da mettere da parte su ogni euro incassato, in decimi di punto (es. 316 = 31,6 %)
    shareTenths: ricavi > 0 ? Math.round((totale * 1000) / ricavi) : 0,
    // peso di tasse e contributi sul reddito forfettario (la parte al 78 %), in decimi di punto
    onRedditoTenths: reddito > 0 ? Math.round((totale * 1000) / reddito) : 0,
    soglia: ricavi > FORFETTARIO_USCITA ? 'uscita' : ricavi > FORFETTARIO_SOGLIA ? 'superata' : null,
  };
}

/** Acconti dovuti per l'anno successivo a partire dalla stima di un anno: {imposta:[giugno, novembre], contributi:[…]}. */
export function acconti(stima) {
  const t = stima?.imposta || 0;
  let imposta;
  if (t < ACCONTO_MIN) imposta = [0, 0];
  else if (t <= ACCONTO_UNICO) imposta = [0, t];
  else {
    const first = Math.round(t * 0.4);
    imposta = [first, t - first];
  }
  const c = stima?.contributi || 0;
  const half = Math.round(c * 0.4);
  return { imposta, contributi: [half, half] };
}

/**
 * Scadenze nell'anno successivo a `year` (stima di `year`; `previous` = stima dell'anno prima, per gli
 * acconti già versati). Saldo negativo = credito, scalato dai versamenti di giugno.
 */
export function scadenze(year, stima, previous) {
  const next = Number(year) + 1;
  const prevAcc = acconti(previous);
  const versatiImposta = prevAcc.imposta[0] + prevAcc.imposta[1];
  const versatiContributi = prevAcc.contributi[0] + prevAcc.contributi[1];
  const saldoImposta = stima.imposta - versatiImposta;
  const saldoContributi = stima.contributi - versatiContributi;
  const acc = acconti(stima);
  const giugnoLordo = saldoImposta + saldoContributi + acc.imposta[0] + acc.contributi[0];
  return {
    versati: { imposta: versatiImposta, contributi: versatiContributi },
    giugno: {
      date: `${next}-06-30`,
      saldoImposta, saldoContributi, accontoImposta: acc.imposta[0], accontoContributi: acc.contributi[0],
      totale: Math.max(0, giugnoLordo),
      credito: giugnoLordo < 0 ? -giugnoLordo : 0,
    },
    novembre: {
      date: `${next}-11-30`,
      accontoImposta: acc.imposta[1], accontoContributi: acc.contributi[1],
      totale: acc.imposta[1] + acc.contributi[1],
    },
  };
}
