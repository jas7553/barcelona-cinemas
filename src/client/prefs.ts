import { useEffect, useState } from "preact/hooks";
import { NO_PREFS, OBSOLETE_KEYS, PREF_KEYS, readPrefs, type LatLng, type Prefs } from "../domain/prefs";

const listeners = new Set<(prefs: Prefs) => void>();
const KEYS: readonly string[] = Object.values(PREF_KEYS);

function load(): Prefs {
  try {
    return readPrefs(localStorage);
  } catch {
    // Storage can be unavailable outright (blocked, or Safari private mode on old iOS).
    return NO_PREFS;
  }
}

// The pre-paint script in scripts/template.mjs sets this class on load; keep it in step.
function markHome(prefs: Prefs): void {
  document.documentElement.classList.toggle("has-home", prefs.home !== null);
}

function publish(): void {
  const prefs = load();
  markHome(prefs);
  for (const listener of listeners) listener(prefs);
}

function store(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or blocked storage: the change lasts until the next load */
  }
}

export function setHome(home: LatLng | null): void {
  store(PREF_KEYS.home, home);
  publish();
}

export function forgetAll(): void {
  for (const key of KEYS) store(key, null);
  publish();
}

export function removeObsoleteKeys(): void {
  for (const key of OBSOLETE_KEYS) store(key, null);
}

/**
 * The device's saved preferences. The server can't know them, so the server
 * render and the first client render both see none (hydration parity), and the
 * real values arrive straight after mount.
 */
export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState(NO_PREFS);
  useEffect(() => {
    const stored = load();
    markHome(stored);
    setPrefs(stored);
    listeners.add(setPrefs);
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || KEYS.includes(e.key)) publish();
    };
    // A bfcache restore shows the page as it was left; the prefs may have
    // changed on the page visited since.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) publish();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onShow);
    return () => {
      listeners.delete(setPrefs);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return prefs;
}
