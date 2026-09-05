import type { CharacterSpec, WeaponSpec } from './types';

/** Drawings are megabytes of data URL, so they live in IndexedDB, not localStorage. */
const DB = 'persona-atelier';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('weapons')) db.createObjectStore('weapons', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
    t.oncomplete = () => db.close();
  });
}

export const saveCharacter = (c: CharacterSpec) => tx<void>('characters', 'readwrite', (s) => s.put(c));
export const listCharacters = () => tx<CharacterSpec[]>('characters', 'readonly', (s) => s.getAll());
export const deleteCharacter = (id: string) => tx<void>('characters', 'readwrite', (s) => s.delete(id));

export const saveWeapon = (w: WeaponSpec) => tx<void>('weapons', 'readwrite', (s) => s.put(w));
export const listWeapons = () => tx<WeaponSpec[]>('weapons', 'readonly', (s) => s.getAll());
export const deleteWeapon = (id: string) => tx<void>('weapons', 'readwrite', (s) => s.delete(id));

const LOADOUT = 'persona-loadout';
export interface Loadout { characterId?: string; weaponIds: string[]; best: number; }

export function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(LOADOUT);
    if (raw) return { weaponIds: [], best: 0, ...JSON.parse(raw) };
  } catch { /* first run, or storage disabled */ }
  return { weaponIds: [], best: 0 };
}
export function saveLoadout(l: Loadout) {
  try { localStorage.setItem(LOADOUT, JSON.stringify(l)); } catch { /* nothing to do */ }
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
