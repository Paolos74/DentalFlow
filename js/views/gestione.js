// Gestione: studi, trattamenti (multi-studio), backup, sincronizzazione, installazione, info.
import {
  el, clear, toast, showError, confirmDialog, choiceDialog, textDialog, checkboxDialog, field,
  downloadBlob, canShareFile, shareFile, getSwVersion, studioLabel,
} from '../ui.js';
import { todayISO } from '../dates.js';
import { buildBackup, parseBackupText } from '../backup.js';

const state = {
  newStudioName: '',
  syncForm: null, // {apiKey, projectId, email, password}; la password resta solo in memoria
  signingIn: false,
  syncing: false,
  version: null,
};

const MAX_BACKUP = 10 * 1024 * 1024;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const alsoDeleted = (n) => (n === 1 ? 'Verrà eliminato anche 1 inserimento. Confermi?' : `Verranno eliminati anche ${n} inserimenti. Confermi?`);

function run(fn) {
  try {
    fn();
    return true;
  } catch (err) {
    showError(err);
    return false;
  }
}

export function render(container, ctx) {
  clear(container);
  container.append(el('h2', { text: 'Gestione' }));
  container.append(studiSection(ctx), trattamentiSection(ctx), backupSection(ctx), syncSection(ctx), installSection(ctx), infoSection());
}

// ---------- studi ----------
function studiSection(ctx) {
  const { store } = ctx;
  const card = el('section', { class: 'card', id: 'ges-studi' }, el('h3', { text: 'Studi' }));
  const input = el('input', { type: 'text', id: 'ges-studio-name', maxlength: '60', placeholder: 'Nome dello studio', value: state.newStudioName, autocomplete: 'off' });
  input.addEventListener('input', () => { state.newStudioName = input.value; });
  const form = el('form', { class: 'form', novalidate: true, id: 'ges-studio-form' },
    field('Nuovo studio', input).wrap,
    el('button', { type: 'submit', class: 'btn btn-primary', id: 'ges-studio-add', text: 'Aggiungi studio' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value;
    state.newStudioName = '';
    if (!run(() => store.addStudio(name))) { state.newStudioName = name; return; }
    toast('Studio aggiunto');
  });
  card.append(form);

  const studios = store.getStudios({ includeArchived: true });
  if (studios.length === 0) {
    card.append(el('p', { class: 'muted', text: 'Nessuno studio. Aggiungi il primo qui sopra.' }));
    return card;
  }
  const list = el('ul', { class: 'list' });
  for (const s of studios) {
    const n = store.countEntries({ studioId: s.id });
    list.append(el('li', { class: 'list-item', dataset: { studio: s.name } },
      el('div', { class: 'item-head' },
        el('span', { class: 'item-title' }, s.name, s.archived ? el('span', { class: 'badge', text: 'archiviato' }) : null),
        el('span', { class: 'item-meta', text: plural(n, 'inserimento', 'inserimenti') })),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Rinomina', onclick: () => renameStudio(store, s) }),
        s.archived
          ? el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Ripristina', onclick: () => { if (run(() => store.restoreStudio(s.id))) toast('Studio ripristinato'); } })
          : el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Archivia', onclick: () => archiveStudio(store, s) }),
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Elimina', onclick: () => deleteStudio(store, s) }))));
  }
  card.append(list);
  return card;
}

function renameStudio(store, s) {
  textDialog({
    title: 'Rinomina studio', label: 'Nome', value: s.name,
    onSubmit: (name) => { store.renameStudio(s.id, name); toast('Studio rinominato'); return true; },
  });
}

async function archiveStudio(store, s) {
  if (!(await confirmDialog(`Archiviare lo studio «${s.name}»? Non comparirà più per i nuovi inserimenti; i dati passati restano in Riepilogo, Grafici, CSV e Registro.`, { okText: 'Archivia' }))) return;
  if (run(() => store.archiveStudio(s.id))) toast('Studio archiviato');
}

async function deleteStudio(store, s) {
  const { entryCount, orphanTreatmentNames } = store.studioDeleteImpact(s.id);
  const orphanText = orphanTreatmentNames.length
    ? ` Verranno eliminati anche i trattamenti presenti solo in questo studio: ${orphanTreatmentNames.join(', ')}.`
    : '';
  if (entryCount === 0) {
    if (!(await confirmDialog(`Eliminare lo studio «${s.name}»?${orphanText}`, { okText: 'Elimina', danger: true }))) return;
    if (run(() => store.deleteStudio(s.id))) toast('Studio eliminato');
    return;
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
    if (!(await confirmDialog(`${alsoDeleted(entryCount)}${orphanText}`, { okText: 'Elimina definitivamente', danger: true }))) return;
    if (run(() => store.deleteStudio(s.id))) toast('Studio eliminato');
  }
}

// ---------- trattamenti ----------
function trattamentiSection(ctx) {
  const { store } = ctx;
  const card = el('section', { class: 'card', id: 'ges-trattamenti' }, el('h3', { text: 'Trattamenti' }));
  const allStudios = store.getStudios({ includeArchived: true });
  const studioName = (id) => { const s = allStudios.find((x) => x.id === id); return s ? studioLabel(s) : 'Studio eliminato'; };
  const activeStudios = store.getStudios();
  card.append(el('button', {
    type: 'button', class: 'btn btn-primary', id: 'ges-treatment-new', text: 'Nuovo trattamento', disabled: activeStudios.length === 0,
    onclick: () => newTreatment(store, activeStudios),
  }));
  if (activeStudios.length === 0) card.append(el('p', { class: 'hint', text: 'Aggiungi prima uno studio.' }));

  const treatments = store.getTreatments();
  if (treatments.length === 0) {
    card.append(el('p', { class: 'muted', text: 'Nessun trattamento.' }));
    return card;
  }
  const list = el('ul', { class: 'list' });
  for (const t of treatments) {
    const keys = Object.keys(t.studios);
    const active = keys.filter((k) => t.studios[k] === 'active').map(studioName).sort((a, b) => a.localeCompare(b, 'it'));
    const archived = keys.filter((k) => t.studios[k] === 'archived').map(studioName).sort((a, b) => a.localeCompare(b, 'it'));
    const n = store.countEntries({ treatmentId: t.id });
    const addable = activeStudios.filter((s) => t.studios[s.id] !== 'active');
    list.append(el('li', { class: 'list-item', dataset: { treatment: t.name } },
      el('div', { class: 'item-head' },
        el('span', { class: 'item-title', text: t.name }),
        el('span', { class: 'item-meta', text: plural(n, 'inserimento', 'inserimenti') })),
      active.length ? el('div', { class: 'item-meta', text: `Attivo in: ${active.join(', ')}` }) : null,
      archived.length ? el('div', { class: 'item-meta', text: `Archiviato in: ${archived.join(', ')}` }) : null,
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Rinomina', onclick: () => renameTreatment(store, t) }),
        addable.length ? el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Aggiungi a studi', onclick: () => addToStudios(store, t, addable) }) : null,
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Rimuovi da studi', onclick: () => removeFromStudios(store, t, studioName) }),
        archived.length ? el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Ripristina', onclick: () => restoreInStudios(store, t, studioName) }) : null,
        el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Elimina', onclick: () => removalFlow(store, t, Object.keys(t.studios), studioName, true) }))));
  }
  card.append(list);
  return card;
}

function newTreatment(store, activeStudios) {
  const name = el('input', { type: 'text', id: 'dlg-treatment-name', maxlength: '60', autocomplete: 'off' });
  const fName = field('Nome del trattamento', name);
  checkboxDialog({
    title: 'Nuovo trattamento',
    intro: 'In quali studi lo offri?',
    options: activeStudios.map((s) => ({ value: s.id, label: s.name, checked: activeStudios.length === 1 })),
    submitText: 'Crea',
    extra: fName.wrap,
    onSubmit: (ids, { setFormError }) => {
      fName.setError('');
      if (ids.length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      store.addTreatment(name.value, ids);
      toast(`Trattamento creato in ${plural(ids.length, 'studio', 'studi')}`);
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

function addToStudios(store, t, addable) {
  checkboxDialog({
    title: `Aggiungi «${t.name}» a studi`,
    options: addable.map((s) => ({ value: s.id, label: t.studios[s.id] === 'archived' ? `${s.name} (archiviato qui: verrà riattivato)` : s.name })),
    submitText: 'Aggiungi',
    onSubmit: (ids, { setFormError }) => {
      if (ids.length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      store.addTreatmentToStudios(t.id, ids);
      toast(`Aggiunto a ${plural(ids.length, 'studio', 'studi')}`);
      return true;
    },
  });
}

function restoreInStudios(store, t, studioName) {
  const archived = Object.keys(t.studios).filter((k) => t.studios[k] === 'archived');
  checkboxDialog({
    title: `Ripristina «${t.name}»`,
    options: archived.map((id) => ({ value: id, label: studioName(id) })),
    submitText: 'Ripristina',
    onSubmit: (ids, { setFormError }) => {
      if (ids.length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      store.restoreTreatmentInStudios(t.id, ids);
      toast('Trattamento ripristinato');
      return true;
    },
  });
}

async function removeFromStudios(store, t, studioName) {
  let selected = null;
  const keys = Object.keys(t.studios);
  await checkboxDialog({
    title: `Rimuovi «${t.name}» da studi`,
    options: keys.map((id) => ({ value: id, label: studioName(id) })),
    submitText: 'Continua',
    onSubmit: (ids, { setFormError }) => {
      if (ids.length === 0) { setFormError('Seleziona almeno uno studio'); return false; }
      selected = ids;
      return true;
    },
  });
  if (selected) await removalFlow(store, t, selected, studioName, false);
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
    if (!(await confirmDialog(alsoDeleted(total), { okText: 'Elimina definitivamente', danger: true }))) return;
    if (run(() => store.applyTreatmentRemoval(t.id, { archiveIds: [], removeIds: [...S0, ...S1.map((x) => x.id)] }))) done(isDelete ? 'Trattamento eliminato' : 'Trattamento rimosso');
  }
}

// ---------- backup ----------
function backupSection(ctx) {
  const { store } = ctx;
  const card = el('section', { class: 'card', id: 'ges-backup' }, el('h3', { text: 'Backup' }),
    el('p', { class: 'hint', text: 'I dati sono salvati solo in questo browser. Esporta un backup regolarmente: cancellare i dati del sito li elimina.' }));
  const makeFile = () => {
    const json = JSON.stringify(buildBackup(store.exportData()), null, 2);
    return new File([json], `DentalFlow-backup-${todayISO()}.json`, { type: 'application/json' });
  };
  const exportBtn = el('button', {
    type: 'button', class: 'btn btn-primary', id: 'ges-backup-export', text: 'Esporta backup',
    onclick: () => { const f = makeFile(); downloadBlob(f, f.name); toast('Backup esportato'); },
  });
  const fileInput = el('input', { type: 'file', id: 'ges-backup-file', accept: '.json,application/json', class: 'visually-hidden' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    await importBackup(store, file);
  });
  const importBtn = el('button', { type: 'button', class: 'btn btn-secondary', id: 'ges-backup-import', text: 'Importa backup', onclick: () => fileInput.click() });
  const bar = el('div', { class: 'toolbar' }, exportBtn, importBtn, fileInput);
  if (canShareFile(new File(['{}'], 'x.json', { type: 'application/json' }))) {
    bar.append(el('button', { type: 'button', class: 'btn btn-secondary', text: 'Condividi', onclick: () => { const f = makeFile(); shareFile(f, f.name); } }));
  }
  card.append(bar);
  return card;
}

async function importBackup(store, file) {
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
  const { studios, treatments, entries } = res.data;
  const ok = await confirmDialog(
    `Sostituire tutti i dati attuali con quelli del backup (${plural(studios.length, 'studio', 'studi')}, ${plural(treatments.length, 'trattamento', 'trattamenti')}, ${plural(entries.length, 'inserimento', 'inserimenti')})?`,
    { okText: 'Sostituisci', danger: true },
  );
  if (!ok) return;
  if (run(() => store.replaceAll(res.data))) toast('Backup importato');
}

// ---------- sincronizzazione ----------
function syncSection(ctx) {
  const { sync } = ctx;
  const st = sync.getStatus();
  if (!state.syncForm) {
    state.syncForm = { apiKey: st.apiKey || '', projectId: st.projectId || '', email: st.email || '', password: '' };
  }
  const f = state.syncForm;
  const mk = (id, type, key, label, extra = {}) => {
    const input = el('input', { type, id, value: f[key], autocomplete: 'off', spellcheck: 'false', ...extra });
    input.addEventListener('input', () => { f[key] = input.value; });
    return field(label, input);
  };
  const fKey = mk('ges-sync-apikey', 'text', 'apiKey', 'API key');
  const fProject = mk('ges-sync-project', 'text', 'projectId', 'Project ID');
  const fEmail = mk('ges-sync-email', 'email', 'email', 'Email', { autocomplete: 'username' });
  const fPass = mk('ges-sync-password', 'password', 'password', 'Password', { autocomplete: 'current-password' });

  const signInBtn = el('button', {
    type: 'submit', class: 'btn btn-primary', id: 'ges-sync-signin',
    text: state.signingIn ? 'Accesso in corso…' : 'Accedi e sincronizza', disabled: state.signingIn,
  });
  const form = el('form', { class: 'form', novalidate: true, id: 'ges-sync-form' }, fKey.wrap, fProject.wrap, fEmail.wrap, fPass.wrap,
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

  return el('section', { class: 'card', id: 'ges-sync' },
    el('h3', { text: 'Sincronizzazione online (Firebase) · facoltativa' }),
    el('p', { class: 'hint', text: 'Serve solo per avere i dati su più dispositivi. Senza configurazione l\'app funziona completamente offline. Le istruzioni sono nel README.' }),
    form,
    el('p', { class: st.lastError ? 'field-error' : 'muted', id: 'ges-sync-status', role: 'status', text: status }),
    actions);
}

// ---------- installazione e info ----------
function installSection(ctx) {
  const { install } = ctx;
  const card = el('section', { class: 'card', id: 'ges-install' }, el('h3', { text: 'Installa app' }));
  if (install.isInstalled()) {
    card.append(el('p', { text: 'App installata' }));
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
    el('p', {}, 'Versione app: ', version),
    el('p', { class: 'hint', text: 'DentalFlow · dati salvati sul dispositivo · funziona anche offline.' }));
}
