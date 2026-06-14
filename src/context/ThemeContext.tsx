import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface ThemeCtx {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ dark: false, toggle: () => {} });

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start light on both server and the first client render so the SSG markup and
  // hydration agree. The inline <head> script (index.html) has already applied
  // the real theme to <html> pre-paint, so there is no colour FOUC; we read the
  // stored preference after mount to sync React state (may flip the header icon).
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("btw-dark");
      // Post-hydration sync: first render is light (matches SSG); read the real
      // preference after mount. The inline <head> script already set colours.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDark(stored !== null ? stored === "true" : window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      // storage/matchMedia unavailable — stay light
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
    if (meta) meta.content = dark ? "#0f0e0c" : "#faf6ef";
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      try {
        localStorage.setItem("btw-dark", String(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}
