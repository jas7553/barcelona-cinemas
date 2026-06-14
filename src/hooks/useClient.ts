import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Read the hydration payload embedded by the SSG renderer as inert JSON
 * (<script type="application/json" id="__APP_DATA__">). Inert JSON sidesteps a
 * strict `script-src` CSP — no per-page hash needed. Returns null if absent.
 */
export function readPageData<T>(): T | null {
  const el = document.getElementById("__APP_DATA__");
  if (!el?.textContent) return null;
  return JSON.parse(el.textContent) as T;
}

/**
 * SSR-safe "current instant".
 *
 * The page is pre-rendered (SSG) at `serverNow`, so the first client render must
 * use the *same* instant or hydration mismatches. We seed state from `serverNow`
 * and swap to the live clock only after mount — the post-hydration re-render then
 * re-filters past showtimes and refreshes "Today/Tonight" labels the baked
 * snapshot may have gotten wrong (up to one 12h refresh window stale).
 */
export function useNow(serverNow: string): Date {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    // Intentional post-hydration swap: first render must match the SSG snapshot,
    // then we move to the live clock. This is the whole point of the hook.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);
  return now;
}

/**
 * SSR-safe URL search params, replacing react-router's useSearchParams.
 *
 * Pages are baked once at the *bare* URL (no query), so the first client render
 * must also ignore the query string or hydration mismatches. We seed empty and
 * read `window.location.search` only after mount; writes use history.replaceState
 * (no new history entry — matches the SPA's replace semantics for ?q=/?day=/?view=).
 */
export function useUrlParams(): {
  params: URLSearchParams;
  setParams: (mutate: (next: URLSearchParams) => void) => void;
} {
  const [search, setSearch] = useState("");
  useEffect(() => {
    // Intentional post-hydration swap: SSG bakes the bare URL, so first render
    // must ignore the query string, then we apply the real one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(window.location.search);
  }, []);

  const params = useMemo(() => new URLSearchParams(search), [search]);

  const setParams = useCallback((mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(window.location.search);
    mutate(next);
    const qs = next.toString();
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
    setSearch(qs ? `?${qs}` : "");
  }, []);

  return { params, setParams };
}
