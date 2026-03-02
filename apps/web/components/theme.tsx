'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_KEY = 'research-agent-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyThemeToDocument(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyThemeToDocument(initial);
  }, []);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    applyThemeToDocument(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  return <ThemeToggleInner theme={theme} onToggle={toggleTheme} compact={compact} />;
}

export function ThemeToggleInner({
  theme,
  onToggle,
  compact,
}: {
  theme: Theme;
  onToggle: () => void;
  compact: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex h-10 w-full items-center justify-center rounded-xl border border-black/10 bg-white/90 text-neutral-700 transition hover:bg-black/[0.04] dark:border-white/10 dark:bg-[#0d0f13] dark:text-neutral-300 dark:hover:bg-white/[0.06]"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="relative flex w-full items-center rounded-2xl border border-black/10 bg-white/90 p-1 text-sm dark:border-white/10 dark:bg-[#0d0f13]"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      <span
        className={`absolute top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-xl bg-black text-white transition-transform duration-300 dark:bg-white dark:text-black ${
          theme === 'dark' ? 'translate-x-full' : 'translate-x-0'
        }`}
      />
      <span
        className={`relative z-10 inline-flex w-1/2 items-center justify-center gap-1 py-1.5 text-xs ${
          theme === 'light'
            ? 'text-white dark:text-black'
            : 'text-neutral-700 dark:text-neutral-200'
        }`}
      >
        <Sun size={13} />
        Light
      </span>
      <span
        className={`relative z-10 inline-flex w-1/2 items-center justify-center gap-1 py-1.5 text-xs ${
          theme === 'dark'
            ? 'text-black dark:text-black'
            : 'text-neutral-700 dark:text-neutral-200'
        }`}
      >
        <Moon size={13} />
        Dark
      </span>
    </button>
  );
}
