import { useCallback, useState } from "react";

const STORAGE_KEY = "hidden_film_ids";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useHiddenFilms() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHidden);

  const hideFilm = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const clearHidden = useCallback(() => {
    setHiddenIds(new Set());
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { hiddenIds, hideFilm, clearHidden };
}
