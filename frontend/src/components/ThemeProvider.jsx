import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   FETCH-X user preferences (Profile → Settings)

   ONE provider owns every client-side comfort preference:
     mode     'light' | 'dark' | 'system'   — colour mode (theme tokens untouched)
     motion   'full'  | 'reduced' | 'off'   — animation level
     textScale 'sm' | 'md' | 'lg'           — comfortable text sizing (page zoom)
     density  'cozy' | 'compact'            — spacing density
     sidebarCollapsed  boolean              — remembered sidebar state

   Persisted as JSON under `fx-prefs`; the legacy `fx-mode` key is kept in
   sync (resolved light/dark) so the pre-paint script in index.html keeps
   preventing the first-paint flash. Nothing here changes the FETCH-X design
   language — these are accessibility/comfort switches, not a re-theme.
   ──────────────────────────────────────────────────────────────────────────── */

const PREFS_KEY = 'fx-prefs';
const LEGACY_MODE_KEY = 'fx-mode';

const DEFAULT_PREFS = {
  mode: 'system',
  motion: 'full',
  textScale: 'md',
  density: 'cozy',
  sidebarCollapsed: false,
};

const ZOOM = { sm: 0.92, md: 1, lg: 1.08 };

function systemPrefersDark() {
  try {
    return typeof window !== 'undefined' && window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

function readPrefs() {
  const prefs = { ...DEFAULT_PREFS };
  try {
    // Migrate the old single-value key ONCE — only when no pref object
    // exists yet. fx-mode is kept permanently in sync by the apply-effect
    // (it feeds the pre-paint script), so testing it unconditionally would
    // re-run the "migration" on every load and wipe the user's saved
    // motion/text/density choices back to defaults.
    let raw = localStorage.getItem(PREFS_KEY);
    const legacy = localStorage.getItem(LEGACY_MODE_KEY);
    if (!raw && (legacy === 'dark' || legacy === 'light')) {
      prefs.mode = legacy;
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      raw = localStorage.getItem(PREFS_KEY);
    }
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULT_PREFS)) {
        if (saved && saved[k] !== undefined && saved[k] !== null) prefs[k] = saved[k];
      }
    }
  } catch { /* corrupted prefs → defaults */ }
  return prefs;
}

const PrefsContext = createContext(null);

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [osDark, setOsDark] = useState(systemPrefersDark);

  // Follow the OS when mode === 'system'.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange);
    };
  }, []);

  const resolvedMode = prefs.mode === 'system' ? (osDark ? 'dark' : 'light') : prefs.mode;

  // Apply + persist everything.
  useEffect(() => {
    const dark = resolvedMode === 'dark';
    document.body.classList.toggle('dark', dark);
    document.documentElement.setAttribute('data-mode', resolvedMode);
    try {
      localStorage.setItem(LEGACY_MODE_KEY, resolvedMode); // pre-paint script
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable */ }
  }, [prefs, resolvedMode]);

  useEffect(() => {
    const z = ZOOM[prefs.textScale] ?? 1;
    document.documentElement.style.zoom = z === 1 ? '' : String(z);
  }, [prefs.textScale]);

  useEffect(() => {
    if (prefs.density === 'compact') document.documentElement.setAttribute('data-density', 'compact');
    else document.documentElement.removeAttribute('data-density');
  }, [prefs.density]);

  const value = useMemo(() => ({
    prefs,
    resolvedMode,
    setPref: (key, val) => setPrefs((p) => ({ ...p, [key]: val })),
    reset: () => setPrefs({ ...DEFAULT_PREFS }),
    // Back-compat API used by ThemeSelector / PublicLayout:
    mode: resolvedMode,
    setMode: (m) => setPrefs((p) => ({ ...p, mode: m === 'dark' || m === 'light' ? m : 'system' })),
    toggle: () => setPrefs((p) => ({ ...p, mode: (p.mode === 'system' ? (osDark ? 'light' : 'dark') : p.mode === 'dark' ? 'light' : 'dark') })),
  }), [prefs, resolvedMode, osDark]);

  return (
    <PrefsContext.Provider value={value}>
      {children}
    </PrefsContext.Provider>
  );
}

/* Back-compat hook — existing callers get { mode, setMode, toggle }. */
export function useTheme() {
  return useContext(PrefsContext);
}

/* Full-preference hook for the Settings modal. */
export function usePrefs() {
  return useContext(PrefsContext);
}

export default PreferencesProvider;
