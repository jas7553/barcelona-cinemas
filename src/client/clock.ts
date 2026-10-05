import { useEffect, useState } from "preact/hooks";

/** renderedAt for the first render (hydration parity), then the live clock, refreshed on bfcache restore and tab focus. */
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
