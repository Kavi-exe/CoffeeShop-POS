import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const KEY = "bb.pos.theme";

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable (private mode etc.) — fall through */
  }
  return "dark"; // POS tablets default to the classic dark look
}

/** Applies the theme to <html> and returns it. Safe to call before React boots. */
export function applyTheme(theme: Theme): Theme {
  document.documentElement.dataset.theme = theme;
  return theme;
}

/** Called from main.tsx before render so the first paint already matches. */
export function initTheme(): Theme {
  return applyTheme(getStoredTheme());
}

/** React hook for toggle buttons. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
