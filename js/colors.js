// Colori degli studi (P11): otto colori, salvati come 'c1'…'c8' nel campo facoltativo studio.color.
// La classe CSS è "studio-cN"; i valori esadecimali servono ai grafici SVG.

export const STUDIO_COLORS = [
  { key: 'c1', name: 'Blu', hex: '#0A6CFF' },
  { key: 'c2', name: 'Verde acqua', hex: '#0A93B3' },
  { key: 'c3', name: 'Verde', hex: '#1FA347' },
  { key: 'c4', name: 'Arancio', hex: '#E86A00' },
  { key: 'c5', name: 'Rosa', hex: '#E0356E' },
  { key: 'c6', name: 'Viola', hex: '#9B4FD8' },
  { key: 'c7', name: 'Indaco', hex: '#5452D9' },
  { key: 'c8', name: 'Marrone', hex: '#9A6B45' },
];
export const COLOR_KEYS = STUDIO_COLORS.map((c) => c.key);

/** Colore stabile calcolato dall'id, per gli studi senza colore scelto. */
export function colorFromId(id) {
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

export function studioColorKey(studio) {
  return studio && COLOR_KEYS.includes(studio.color) ? studio.color : colorFromId(studio?.id);
}

export function studioColorHex(studio) {
  const key = studioColorKey(studio);
  return STUDIO_COLORS.find((c) => c.key === key).hex;
}

/** Colore per un nuovo studio: il primo non ancora usato, altrimenti in ordine. */
export function nextStudioColor(studios) {
  const used = new Set(studios.map(studioColorKey));
  return COLOR_KEYS.find((k) => !used.has(k)) || COLOR_KEYS[studios.length % COLOR_KEYS.length];
}
