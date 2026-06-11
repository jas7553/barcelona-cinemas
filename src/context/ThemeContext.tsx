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
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("btw-dark");
      if (stored !== null) return stored === "true";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

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
