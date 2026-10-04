// Home, seen films and My cinemas live in localStorage only. Its contents are
// untrusted (other tabs, extensions, hand edits, older versions of this site),
// so every read is validated and falls back to "nothing set".

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Prefs {
  home: LatLng | null;
  seen: ReadonlySet<string>;
  favourites: ReadonlySet<string>;
}

// `btw-seen` is the old site's key, kept so seen films carry over.
export const PREF_KEYS = { home: "btw-home", seen: "btw-seen", favourites: "btw-fav" } as const;

// The old site's dark-mode flag and live-location toggle; nothing reads them now.
export const OBSOLETE_KEYS = ["btw-dark", "location_active"] as const;

// A runaway or tampered value shouldn't grow storage without bound.
const MAX_IDS = 2000;

export const NO_PREFS: Prefs = { home: null, seen: new Set(), favourites: new Set() };

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseHome(raw: string | null): LatLng | null {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null) return null;
  const { lat, lng } = value as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseIds(raw: string | null): Set<string> {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return new Set();
  const ids = value.filter((v): v is string => typeof v === "string");
  return new Set(ids.slice(-MAX_IDS));
}

export function readPrefs(storage: Pick<Storage, "getItem">): Prefs {
  return {
    home: parseHome(storage.getItem(PREF_KEYS.home)),
    seen: parseIds(storage.getItem(PREF_KEYS.seen)),
    favourites: parseIds(storage.getItem(PREF_KEYS.favourites)),
  };
}
