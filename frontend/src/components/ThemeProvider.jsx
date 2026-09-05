import { createContext, useContext, useEffect, useState } from 'react';

/* Fetch-X light/dark mode system (replaces the old 5-theme system).
   Mode is a single `dark` class on <body>; index.css carries all
   light values in :root and all dark overrides in body.dark.
   Persists to localStorage key `fx-mode`, mirrored on <html data-mode>. */

const MODE_KEY = 'fx-mode';
const ModeContext = createContext(null);

function readInitialMode() {
  try {
    // The old 5-theme system stored its key here — remove it so stale
    // preferences never come back.
    localStorage.removeItem('schoolai-theme');
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readInitialMode);

  useEffect(() => {
    const dark = mode === 'dark';
    document.body.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-mode', mode);
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return (
    <ModeContext.Provider value={{ mode, setMode, toggle }}>
      {children}
    </ModeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useTheme is the public hook API; splitting it into another file would break every existing import path
export function useTheme() {
  return useContext(ModeContext);
}
