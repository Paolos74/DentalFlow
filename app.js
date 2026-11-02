// Avvio: store, router, viste, service worker, banner di aggiornamento, installazione, sincronizzazione.
import { createStore } from './store.js';
import { createSync } from './sync.js';
import { el } from './ui.js';
import * as inserisci from './views/inserisci.js';
import * as registro from './views/registro.js';
import * as riepilogo from './views/riepilogo.js';
import * as grafici from './views/grafici.js';
import * as gestione from './views/gestione.js';

const routes = { inserisci, registro, riepilogo, grafici, gestione };
const DEFAULT_ROUTE = 'inserisci';

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
const sync = createSync({ fetch: (...a) => globalThis.fetch(...a), storage: window.localStorage, now: () => Date.now(), store });

navigator.storage?.persist?.().catch(() => {});

const view = document.getElementById('view');
const navLinks = [...document.querySelectorAll('[data-route]')];
const loadWarningEl = document.getElementById('load-warning');

function currentRoute() {
  const h = location.hash.replace(/^#/, '');
  return routes[h] ? h : DEFAULT_ROUTE;
}

const navigate = (route) => { location.hash = `#${route}`; };

const ctx = { store, sync, navigate, install, rerender: () => rerender() };

function updateChrome(route) {
  for (const a of navLinks) {
    const active = a.dataset.route === route;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const w = store.loadWarning;
  loadWarningEl.textContent = w || '';
  loadWarningEl.hidden = !w;
}

/** Renderizza la vista corrente mantenendo focus, cursore e scroll. */
function renderView({ resetScroll = false } = {}) {
  const route = currentRoute();
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
    view.replaceChildren(el('p', { class: 'field-error', text: `Errore nella visualizzazione: ${err.message}` }));
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
}

function rerender() {
  if (!firstRenderDone) return;
  renderView();
}

// ---------- sincronizzazione: trigger ----------
let syncTimer = null;
function runSync() {
  if (!sync.isEnabled() || !navigator.onLine) return;
  sync.syncNow().then(() => { if (currentRoute() === 'gestione') rerender(); });
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
  if (event.key === 'dentalflow:data') {
    store.reloadFromStorage(); // emette {source:'remote'} → re-render
    try {
      sync.ensureTracking();
    } catch (err) {
      console.warn('ensureTracking', err);
    }
  } else if (event.key === 'dentalflow:sync') {
    rerender();
  }
});

// ---------- badge offline ----------
const offlineBadge = document.getElementById('offline-badge');
function updateOnline() {
  offlineBadge.hidden = navigator.onLine;
}
addEventListener('online', () => { updateOnline(); runSync(); });
addEventListener('offline', updateOnline);
updateOnline();

// ---------- primo render ----------
renderView();
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
