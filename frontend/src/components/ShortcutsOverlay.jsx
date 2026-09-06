import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Command, X } from 'lucide-react';
import { EASE } from '../lib/motion.jsx';

/* Global keyboard-shortcut cheat sheet.
   Opens with "?" (shift+/) anywhere inside the app shell, closes with
   Escape or the close button. Read-only reference — no behavior lives here. */
const SHORTCUTS = [
  { keys: ['Ctrl', 'K'], label: 'Global search (students, classes, subjects)', area: 'Anywhere' },
  { keys: ['/'], label: 'Focus the search field', area: 'Dashboard' },
  { keys: ['?'], label: 'Toggle this cheat sheet', area: 'Anywhere' },
  { keys: ['Enter', '→'], label: 'Move to next mark cell', area: 'Marks entry' },
  { keys: ['↑', '↓'], label: 'Move up / down the roster', area: 'Marks entry' },
  { keys: ['Click'], label: 'Cycle status P → A → L', area: 'Attendance week' },
  { keys: ['Esc'], label: 'Close modals & dialogs', area: 'Anywhere' },
];

export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.tagName === 'SELECT');
      if (e.key === '?' && !typing) {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fx-kbd-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }} onClick={() => setOpen(false)}>
          <motion.div className="fx-kbd-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.24, ease: EASE }} onClick={e => e.stopPropagation()}>
            <div className="fx-kbd-head">
              <div className="fx-kbd-title"><Command size={16} /> Keyboard Shortcuts</div>
              <button type="button" className="fx-kbd-close" onClick={() => setOpen(false)} aria-label="Close shortcuts">
                <X size={15} />
              </button>
            </div>
            <div className="fx-kbd-body">
              {SHORTCUTS.map(s => (
                <div key={s.label} className="fx-kbd-row">
                  <span className="fx-kbd-label">
                    <span className="fx-kbd-area">{s.area}</span>
                    {s.label}
                  </span>
                  <span className="fx-kbd-keys">
                    {s.keys.map(k => <kbd key={k}>{k}</kbd>)}
                  </span>
                </div>
              ))}
            </div>
            <div className="fx-kbd-foot">Press <kbd>?</kbd> anytime to toggle this panel</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
