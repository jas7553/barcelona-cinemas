import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "btw-seen";
// Defensive cap: a runaway or tampered value shouldn't grow localStorage
// without bound. 2000 ids is far beyond what anyone would plausibly mark.
const MAX_SEEN = 2000;

interface SeenFilmsCtx {
  isSeen: (id: string) => boolean;
  toggleSeen: (id: string) => void;
  seenCount: number;
}

const SeenFilmsContext = createContext<SeenFilmsCtx>({
  isSeen: () => false,
  toggleSeen: () => {},
  seenCount: 0,
});

export function useSeenFilms(): SeenFilmsCtx {
  return useContext(SeenFilmsContext);
}

// localStorage content is untrusted (another tab, an extension, manual edits) —
// never assume it matches the shape this hook last wrote.
function parseSeenIds(raw: string | null): string[] {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((v): v is string => typeof v === "string");
    return ids.length > MAX_SEEN ? ids.slice(ids.length - MAX_SEEN) : ids;
  } catch {
    return [];
  }
}

export function SeenFilmsProvider({ children }: { children: React.ReactNode }) {
  // Start empty on both server and the first client render so SSG markup and
  // hydration agree — same pattern as ThemeProvider's `dark` state. The stored
  // ids are read after mount, so films only de-emphasize post-hydration.
  const [ids, setIds] = useState<string[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    const readStorage = () => {
      try {
        setIds(parseSeenIds(localStorage.getItem(STORAGE_KEY)));
      } catch {
        /* noop */
      }
    };
    if (!initialized.current) {
      initialized.current = true;
      readStorage();
    }
    // The flag is written on the film page and read on the list page. iOS
    // Safari swipe-back restores the list from bfcache with its pre-navigation
    // React state, so a mount-only read leaves the just-marked film in the main
    // list. Re-read on a persisted pageshow (and on cross-tab storage writes).
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) readStorage();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) readStorage();
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const seenSet = useMemo(() => new Set(ids), [ids]);

  const isSeen = useCallback((id: string) => seenSet.has(id), [seenSet]);

  const toggleSeen = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id].slice(-MAX_SEEN);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ isSeen, toggleSeen, seenCount: ids.length }),
    [isSeen, toggleSeen, ids.length],
  );

  return <SeenFilmsContext.Provider value={value}>{children}</SeenFilmsContext.Provider>;
}

/** Clears all locally stored "seen" state. Used by the privacy page's
 * clear-data affordance. */
export function clearSeenFilms(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
