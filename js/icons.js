// Icone SVG in stile simboli iOS (griglia 24, tratto 2, estremità arrotondate), statiche e decorative.
// Nessun font di icone, nessuna rete: ogni glifo è una stringa con solo percorsi.

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  home: `<path ${S} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>`,
  plus: `<path ${S} d="M12 5v14M5 12h14"/>`,
  'plus-circle': `<circle ${S} cx="12" cy="12" r="9"/><path ${S} d="M12 8v8M8 12h8"/>`,
  list: `<rect ${S} x="4" y="3.5" width="16" height="17" rx="3"/><path ${S} d="M8 8.5h8M8 12h8M8 15.5h5"/>`,
  chart: `<path ${S} d="M4 20h16"/><rect ${S} x="5.5" y="11" width="3" height="6" rx="1"/><rect ${S} x="10.5" y="6" width="3" height="11" rx="1"/><rect ${S} x="15.5" y="9" width="3" height="8" rx="1"/>`,
  more: '<circle cx="5.5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.5" cy="12" r="1.9" fill="currentColor"/>',
  'more-circle': `<circle ${S} cx="12" cy="12" r="9"/><circle cx="8" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="16" cy="12" r="1.3" fill="currentColor"/>`,
  calendar: `<rect ${S} x="3.5" y="5" width="17" height="15.5" rx="3"/><path ${S} d="M3.5 10h17M8 3v4M16 3v4"/>`,
  'calendar-day': `<rect ${S} x="3.5" y="5" width="17" height="15.5" rx="3"/><path ${S} d="M3.5 10h17M8 3v4M16 3v4"/><rect x="7" y="13" width="4" height="4" rx="1" fill="currentColor"/>`,
  studio: `<path ${S} d="M4 20V7.5L12 4l8 3.5V20M4 20h16M9 20v-4h6v4M8.5 10.5h1M14.5 10.5h1M8.5 13.5h1M14.5 13.5h1"/>`,
  tooth: `<path ${S} d="M7.5 3.5C5 3.5 3.5 5.4 3.5 8c0 2.6 1.3 3.9 1.8 6.6.5 2.8 1 5.9 2.6 5.9 1.4 0 1.6-2.8 2.1-4.6.3-1.2.9-1.9 2-1.9s1.7.7 2 1.9c.5 1.8.7 4.6 2.1 4.6 1.6 0 2.1-3.1 2.6-5.9.5-2.7 1.8-4 1.8-6.6 0-2.6-1.5-4.5-4-4.5-1.8 0-2.7.9-4.5.9s-2.7-.9-4.5-.9z"/>`,
  backup: `<path ${S} d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5"/><path ${S} d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/>`,
  sync: `<path ${S} d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5z"/>`,
  appearance: `<circle ${S} cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>`,
  install: `<rect ${S} x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path ${S} d="M12 7v7M9.2 11.3 12 14l2.8-2.7M10.5 18.5h3"/>`,
  info: `<circle ${S} cx="12" cy="12" r="9"/><path ${S} d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.2" fill="currentColor"/>`,
  share: `<path ${S} d="M12 3.5v11M8 7.5l4-4 4 4M7 10.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2h-1"/>`,
  csv: `<path ${S} d="M6 3.5h8l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z"/><path ${S} d="M13.5 3.5V8.5h5M12 11.5v6M9.5 15l2.5 2.5 2.5-2.5"/>`,
  note: `<path ${S} d="M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h6"/>`,
  chevron: `<path ${S} d="M9 6l6 6-6 6"/>`,
  'chevron-left': `<path ${S} d="M15 5.5 8.5 12l6.5 6.5"/>`,
  'chevron-down': `<path ${S} d="M6 9l6 6 6-6"/>`,
  sparkle: '<path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5zM19 15.5c.2 1.8 1.1 2.7 2.9 2.9-1.8.2-2.7 1.1-2.9 2.9-.2-1.8-1.1-2.7-2.9-2.9 1.8-.2 2.7-1.1 2.9-2.9z" fill="currentColor"/>',
  'cloud-off': `<path ${S} d="M8.5 6.6a6 6 0 0 1 9.1 3.95A4 4 0 0 1 19.4 18M15.5 18.5H7a4.5 4.5 0 0 1-.9-8.9M3.5 3.5l17 17"/>`,
  clock: `<circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M12 7.5V12l3 2"/>`,
  check: `<path ${S} d="M5 12.5 10 17.5 19 7"/>`,
  warning: `<path ${S} d="M10.3 4.6 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0zM12 9.5v4.5"/><circle cx="12" cy="17" r="1.1" fill="currentColor"/>`,
  person: `<circle ${S} cx="12" cy="8" r="3.8"/><path ${S} d="M4.5 20c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5"/>`,
  euro: `<path ${S} d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5M4.5 10.5h9M4.5 13.5h9"/>`,
  flag: `<path ${S} d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>`,
  repeat: `<path ${S} d="M17 3.5l3 3-3 3M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 0 1-4 4H4"/>`,
  xmark: `<path ${S} d="M7 7l10 10M17 7 7 17"/>`,
  trash: `<path ${S} d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-13"/>`,
  wallet: `<rect ${S} x="3.5" y="6" width="17" height="13" rx="3"/><path ${S} d="M3.5 10h17M15.5 14.5h1.5"/>`,
  search: `<circle ${S} cx="11" cy="11" r="6.5"/><path ${S} d="M16 16l4.5 4.5"/>`,
};

/** Markup SVG dell'icona (stringa statica, nessun dato dell'utente). */
export function iconSvg(name, cls = 'icon') {
  const body = PATHS[name] || '';
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
