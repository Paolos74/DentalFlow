// Importi in centesimi interi ovunque: nessun float viene mai sommato.

const EURO_FMT = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

/**
 * Converte un importo digitato (formato italiano) in centesimi interi.
 * Ritorna null se l'input non è valido.
 */
export function parseEuroInput(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).replace(/[\s\u00A0\u202F€]/g, '');
  if (s === '') return null;
  let intPart;
  let frac = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    [intPart, frac] = parts;
    if (!/^\d{1,2}$/.test(frac)) return null;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, frac] = s.split('.');
  } else {
    intPart = s;
  }
  if (/^\d+$/.test(intPart)) {
    // nessun raggruppamento
  } else if (/^\d{1,3}(\.\d{3})+$/.test(intPart)) {
    intPart = intPart.replace(/\./g, '');
  } else {
    return null;
  }
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/** Solo visualizzazione, es. "210,00 €". */
export function formatEuro(cents) {
  return EURO_FMT.format(cents / 100);
}

/** Formato CSV per Excel italiano: "1234,50" (niente separatore migliaia, niente simbolo). */
export function formatEuroCsv(cents) {
  const sign = cents < 0 ? '-' : '';
  const c = Math.abs(cents);
  return `${sign}${Math.trunc(c / 100)},${String(c % 100).padStart(2, '0')}`;
}

/** Somma intera di centesimi con controllo di sicurezza. */
export function sumCents(arr) {
  let total = 0;
  for (const v of arr) {
    if (!Number.isSafeInteger(v)) throw new RangeError('Importo non intero');
    total += v;
    if (!Number.isSafeInteger(total)) throw new RangeError('Totale fuori intervallo');
  }
  return total;
}

/** Decimi di punto percentuale (intero) → "42,5 %". */
export function formatPct(p) {
  return `${Math.trunc(p / 10)},${Math.abs(p % 10)} %`;
}

/**
 * Numero pazienti: intero tra min e 999, altrimenti null.
 * Vuoto → 0 se min === 0, altrimenti null.
 */
export function parsePatients(text, { min = 0 } = {}) {
  const s = String(text ?? '').trim();
  if (s === '') return min === 0 ? 0 : null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (n < min || n > 999) return null;
  return n;
}
