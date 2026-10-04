import { useEffect, useState } from "preact/hooks";

/**
 * The "now" every time-relative label is computed from. The first render uses
 * the instant the page was rendered at, so hydration matches the baked HTML;
 * after mount it follows the live clock, including after a bfcache restore or a
 * tab coming back to the foreground hours later.
 */
export function useNow(renderedAt: string): Date {
  const [now, setNow] = useState(() => new Date(renderedAt));
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) tick();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = setInterval(tick, 60_000);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}
