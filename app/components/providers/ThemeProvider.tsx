"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

// Same provider as the portfolio FE/CMS: light, dark or system, remembered in
// localStorage, applied as the `dark` class on <html> (Tailwind darkMode: "class").

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "theme";
export const DEFAULT_THEME: Theme = "system";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

// Runs in <head> before the page paints (see app/[locale]/layout.tsx), so a stored
// or OS dark theme doesn't flash light first. The provider below takes over after
// hydration and keeps the class in sync.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)})||${JSON.stringify(DEFAULT_THEME)};var d=t==="dark"||(t==="system"&&matchMedia(${JSON.stringify(
  SYSTEM_DARK_QUERY
)}).matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

type ThemeContextType = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext);
}

// The stored choice and the OS preference live outside React, so they are read with
// useSyncExternalStore: the server snapshot keeps SSR on the default theme and the
// client switches over after hydration, without a setState in an effect.
const storedThemeListeners = new Set<() => void>();

function subscribeStoredTheme(onChange: () => void) {
  storedThemeListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    storedThemeListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// used instead of localStorage when it is blocked (private mode, disabled site data)
let memoryTheme: Theme | null = null;

function getStoredTheme() {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? memoryTheme;
  } catch {
    return memoryTheme;
  }
}

function subscribeSystemTheme(onChange: () => void) {
  const mql = window.matchMedia(SYSTEM_DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: Theme;
  disableTransitionOnChange?: boolean;
};

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  disableTransitionOnChange,
}: ThemeProviderProps) {
  const theme =
    useSyncExternalStore(subscribeStoredTheme, getStoredTheme, () => null) ??
    defaultTheme;
  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemTheme,
    (): ResolvedTheme => "light"
  );
  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (disableTransitionOnChange) {
      root.classList.add("[&_*]:!transition-none");
      requestAnimationFrame(() => root.classList.remove("[&_*]:!transition-none"));
    }
    root.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme, disableTransitionOnChange]);

  const setTheme = useCallback((newTheme: Theme) => {
    memoryTheme = newTheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // storage blocked: the choice still applies until the page reloads
    }
    storedThemeListeners.forEach((listener) => listener());
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
