// Utility condivise dai test (non fa parte dell'app).
import { createStore } from '../js/store.js';

/** Storage in memoria con l'interfaccia Storage usata dall'app (getItem/setItem/removeItem/key/length). */
export function memStorage(initial = {}, { failSet } = {}) {
  const map = new Map(Object.entries(initial));
  const log = [];
  return {
    log,
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (failSet && failSet(k)) throw new Error('QuotaExceededError');
      log.push(['set', k]);
      map.set(k, String(v));
    },
    removeItem(k) {
      log.push(['remove', k]);
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

export function counterClock(start = 1_700_000_000_000) {
  let t = start;
  const fn = () => t++;
  fn.set = (v) => { t = v; };
  fn.peek = () => t;
  return fn;
}

export function counterUuid(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(6, '0')}`;
}

export function makeStore(storage = memStorage(), opts = {}) {
  const now = opts.now || counterClock();
  const uuid = opts.uuid || counterUuid(opts.prefix || 'id');
  return createStore({ storage, now, uuid });
}
