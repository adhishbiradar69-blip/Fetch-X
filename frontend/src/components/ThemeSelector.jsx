import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider.jsx';

/* Compact light/dark mode toggle (replaces the old 5-theme picker).
   Shows the moon in light mode and the sun in dark mode, styled as the
   designer's `.btn-mode` (see index.css). `compact` is accepted for API
   compatibility with previous callers; the button is always icon-sized. */
export default function ThemeSelector({ compact = false }) {
  const { mode, toggle } = useTheme() || {};
  const dark = mode === 'dark';

  if (!mode) return null;

  return (
    <button
      type="button"
      className={`btn-mode ${compact ? 'btn-mode-compact' : ''}`}
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
      <span className="btn-mode-label">{dark ? 'LIGHT' : 'DARK'}</span>
    </button>
  );
}
