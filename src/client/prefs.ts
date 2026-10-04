import { useEffect, useLayoutEffect, useState } from "preact/hooks";
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

function toggle(key: "seen" | "favourites", id: string): void {
  const ids = new Set(load()[key]);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  store(PREF_KEYS[key], [...ids]);
  publish();
}

export const toggleSeen = (filmId: string) => toggle("seen", filmId);
export const toggleFavourite = (theaterId: string) => toggle("favourites", theaterId);

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

/**
 * Before first paint, the scripts in scripts/template.mjs order lists by the
 * stored prefs through CSS (data-o, data-seen), leaving the markup as
 * rendered. Once the page has rendered with those prefs its DOM order agrees,
 * so the CSS order comes off before the browser paints again.
 */
export function useSettledOrder(prefs: Prefs): void {
  useLayoutEffect(() => {
    if (prefs === NO_PREFS) return;
    for (const el of document.querySelectorAll("[data-o]")) el.removeAttribute("data-o");
    for (const el of document.querySelectorAll("[data-seen]")) el.removeAttribute("data-seen");
  }, [prefs]);
}
