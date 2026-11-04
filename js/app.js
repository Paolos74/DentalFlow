// Avvio: store, router, viste, service worker, banner di aggiornamento, installazione, sincronizzazione.
import { createStore } from './store.js';
import { createSync } from './sync.js';
import { el } from './ui.js';
import { readPrefs, writePrefs } from './prefs.js';
import * as oggi from './views/oggi.js';
import * as inserisci from './views/inserisci.js';
import * as registro from './views/registro.js';
import * as riepilogo from './views/riepilogo.js';
import * as gestione from './views/gestione.js';
import * as calendario from './views/calendario.js';

// Rotte: #oggi, #inserisci, #registro, #recap[/grafici|/tasse], #altro[/pagina[/id]], #calendario[?studio=id].
const routes = { oggi, inserisci, registro, recap: riepilogo, altro: gestione, calendario };
// Indirizzi della prima versione: restano validi (segnalibri, icone installate).
const LEGACY = { riepilogo: 'recap', grafici: 'recap/grafici', gestione: 'altro' };
// Scheda evidenziata nella barra per le rotte senza scheda propria.
const TAB_OF = { calendario: 'altro' };
const DEFAULT_ROUTE = 'oggi';

// ---------- prompt di installazione (catturato subito, prima di qualunque vista) ----------
let deferredPrompt = null;
let firstRenderDone = false;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; rerender(); });
addEventListener('appinstalled', () => { deferredPrompt = null; rerender(); });
const install = {
  canInstall: () => !!deferredPrompt,
  isInstalled: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  prompt: async () => {
    if (!deferredPrompt) return;
    const p = deferredPrompt;
    deferredPrompt = null;
    p.prompt();
    await p.userChoice;
    rerender();
  },
};

// ---------- store e sync (wrapper: mai metodi del browser passati "nudi") ----------
const store = createStore({ storage: window.localStorage, now: () => Date.now(), uuid: () => crypto.randomUUID() });
const prefs = {
  get: () => readPrefs(window.localStorage),
  set: (patch) => writePrefs(window.localStorage, patch),
};
/** Tema scelto in Altro → Aspetto: data-theme="light" | "dark" | "auto" su <html>. */
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const THEME_COLOR = { light: '#F2F4F8', dark: '#0B0D12' };
function applyTheme() {
  const theme = prefs.get().theme;
  document.documentElement.dataset.theme = theme;
  const resolved = theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}
applyTheme();
// Automatico: il telefono passa da chiaro a scuro → barra di stato e grafici seguono.
darkQuery.addEventListener?.('change', () => {
  if (prefs.get().theme !== 'auto') return;
  applyTheme();
  rerender();
});
const sync = createSync({ fetch: (...a) => globalThis.fetch(...a), storage: window.localStorage, now: () => Date.now(), store });

navigator.storage?.persist?.().catch(() => {});
try {
  store.assignMissingColors(); // studi creati con la prima versione: un colore diverso per ciascuno
} catch (err) {
  console.warn('assignMissingColors', err);
}

const view = document.getElementById('view');
const navLinks = [...document.querySelectorAll('[data-route]')];
const loadWarningEl = document.getElementById('load-warning');

/** Legge l'hash: {route, path, query}; i vecchi indirizzi vengono riscritti con replaceState. */
function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const qi = h.indexOf('?');
  const pathPart = qi < 0 ? h : h.slice(0, qi);
  const query = new URLSearchParams(qi < 0 ? '' : h.slice(qi + 1));
  let segs = pathPart.split('/').filter(Boolean);
  if (LEGACY[segs[0]]) {
    const target = LEGACY[segs[0]];
    history.replaceState(null, '', `#${target}`);
    segs = target.split('/');
  }
  if (!routes[segs[0]]) return { route: DEFAULT_ROUTE, path: [], query: new URLSearchParams() };
  return { route: segs[0], path: segs.slice(1), query };
}

function currentRoute() {
  return parseHash().route;
}

const navigate = (route) => { location.hash = `#${route}`; };

// Parametri passati alla vista successiva (es. data e studio per Inserisci), letti una sola volta.
let pendingParams = null;
function go(route, params = null) {
  pendingParams = params;
  if (location.hash === `#${route}`) renderView({ resetScroll: true });
  else location.hash = `#${route}`;
}
function takeParams() {
  const p = pendingParams;
  pendingParams = null;
  return p;
}

const ctx = {
  store, sync, navigate, go, takeParams, install, prefs, applyTheme, path: [], query: new URLSearchParams(), entered: false,
  rerender: () => rerender(),
};

function updateChrome(route) {
  const tab = TAB_OF[route] || route;
  for (const a of navLinks) {
    const active = a.dataset.route === tab;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const w = store.loadWarning;
  loadWarningEl.textContent = w || '';
  loadWarningEl.hidden = !w;
}

/** Renderizza la vista corrente mantenendo focus, cursore e scroll. */
function renderView({ resetScroll = false, entered = resetScroll } = {}) {
  const { route, path, query } = parseHash();
  ctx.path = path;
  ctx.query = query;
  ctx.entered = entered; // true entrando nella schermata o riaprendo l'app; false nei ridisegni
  const active = document.activeElement;
  let focusId = null;
  let sel = null;
  if (active && active.id && view.contains(active)) {
    focusId = active.id;
    if (active.tagName === 'INPUT' && active.type === 'text') sel = [active.selectionStart, active.selectionEnd];
  }
  const scrollY = window.scrollY;
  updateChrome(route);
  try {
    routes[route].render(view, ctx);
  } catch (err) {
    console.error(err);
    view.replaceChildren(el('p', { class: 'field-error card', text: `Errore nella visualizzazione: ${err.message}` }));
  }
  if (focusId) {
    const target = document.getElementById(focusId);
    if (target && view.contains(target)) {
      target.focus({ preventScroll: true });
      if (sel && target.tagName === 'INPUT' && target.type === 'text') {
        try { target.setSelectionRange(sel[0], sel[1]); } catch { /* ignorato */ }
      }
    }
  }
  window.scrollTo(0, resetScroll ? 0 : scrollY);
  watchLargeTitle();
}

// ---------- barra superiore compatta (titolo piccolo quando il titolo grande esce dallo schermo) ----------
const topbar = document.getElementById('topbar');
const topbarTitle = document.getElementById('topbar-title');
let titleObserver = null;
function watchLargeTitle() {
  titleObserver?.disconnect();
  const title = view.querySelector('.large-title');
  topbarTitle.textContent = title ? title.textContent : '';
  topbar.classList.remove('is-visible');
  if (!title || !('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([entry]) => {
    topbar.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 44);
  }, { rootMargin: '-44px 0px 0px 0px' });
  titleObserver.observe(title);
}

function rerender() {
  if (!firstRenderDone) return;
  renderView();
}

// ---------- sincronizzazione: trigger ----------
let syncTimer = null;
function runSync() {
  if (!sync.isEnabled() || !navigator.onLine) return;
  sync.syncNow().then(() => { if (currentRoute() === 'altro') rerender(); });
}

store.subscribe(({ source }) => {
  rerender();
  if (source === 'local' && sync.isEnabled()) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 3000);
  }
});

addEventListener('hashchange', () => renderView({ resetScroll: true }));

// Altri tab: ricarica i dati quando cambiano altrove.
addEventListener('storage', (event) => {
  if (event.key === 'dentalflow:data' || event.key === 'dentalflow:calendar') {
    store.reloadFromStorage(); // emette {source:'remote'} → re-render
    try {
      sync.ensureTracking();
    } catch (err) {
      console.warn('ensureTracking', err);
    }
  } else if (event.key === 'dentalflow:sync') {
    rerender();
  } else if (event.key === 'dentalflow:prefs') {
    applyTheme();
    rerender();
  }
});

// ---------- badge offline ----------
const offlineBadge = document.getElementById('offline-badge');
function updateOnline() {
  offlineBadge.hidden = navigator.onLine;
  // la pillola visibile è nella riga del titolo di ogni schermata (nessuno spostamento della pagina)
  document.documentElement.classList.toggle('is-offline', !navigator.onLine);
}
addEventListener('online', () => { updateOnline(); runSync(); });
addEventListener('offline', updateOnline);
updateOnline();

// App tornata in primo piano (es. riaperta il giorno dopo): la vista la tratta come un ingresso.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && firstRenderDone) renderView({ entered: true });
});

// ---------- primo render ----------
renderView({ entered: true });
firstRenderDone = true;
try {
  sync.ensureTracking();
} catch (err) {
  console.warn('ensureTracking', err);
}
runSync();

// ---------- service worker e aggiornamenti ----------
const updateBanner = document.getElementById('update-banner');
const updateBtn = document.getElementById('update-btn');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    let controller = navigator.serviceWorker.controller; // controller precedente, aggiornato a ogni cambio
    let updateRequested = false;
    let reloaded = false;
    let waitingWorker = null;

    const showUpdateBanner = (worker) => {
      waitingWorker = worker;
      updateBanner.hidden = false;
    };
    updateBtn.addEventListener('click', () => {
      if (waitingWorker) {
        updateRequested = true;
        updateBtn.disabled = true;
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else {
        location.reload();
      }
    });

    let reg;
    try {
      reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (err) {
      console.warn('Registrazione del service worker non riuscita', err);
      return;
    }
    const showIfWaiting = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting); };
    showIfWaiting();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => { if (sw.state === 'installed') showIfWaiting(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const prev = controller;
      controller = navigator.serviceWorker.controller;
      if (!prev || reloaded) return; // primo claim dopo l'installazione: niente reload, niente banner
      if (updateRequested) {
        reloaded = true;
        location.reload();
      } else {
        showUpdateBanner(null); // un altro tab ha attivato l'aggiornamento: offri il reload
      }
    });
    const check = () => reg.update().catch(() => {});
    check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  });
}
