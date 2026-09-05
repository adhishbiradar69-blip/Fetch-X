import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { EASE, SPRING } from '../lib/motion.jsx';

/* Animated number that counts from previous value to next, with easing. */
export function CountUp({ value = 0, decimals = 0, duration = 0.9, className, style }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const tick = (now) => {
      const t = Math.min((now - start) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const text = Number.isInteger(value) && decimals === 0
    ? Math.round(display).toString()
    : display.toFixed(decimals);

  return <span className={className} style={style}>{text}</span>;
}

/* Toast with a shrinking progress bar + swipe-to-dismiss.
   Flat tints on a hard-offset-shadow card (design system). */
export function Toast({ message, type = 'success', onClose, duration = 2600 }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    // Timer depends on `duration` only — an unstable inline `onClose` from
    // the parent must NOT restart the dismiss countdown on every render.
    const t = setTimeout(() => closeRef.current(), duration);
    return () => clearTimeout(t);
  }, [duration]);

  const colors = {
    success: { bg: '#e3f5ed', color: '#0b7a5c', Icon: CheckCircle2 },
    error: { bg: '#fdeaea', color: '#b91c1c', Icon: XCircle },
    info: { bg: '#ece8fc', color: '#4f42dd', Icon: Info },
  }[type] || { bg: '#f3f3f9', color: '#4b4a6b', Icon: Info };

  return (
    <div className="toast-host">
      <motion.div
        className="toast toast-pro"
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, y: -40, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -40, scale: 0.9 }}
        transition={SPRING}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.4}
        onDragEnd={(e, info) => { if (info.offset.y < -30) closeRef.current(); }}
        style={{ background: colors.bg, color: colors.color }}
      >
        <span className="toast-icon"><colors.Icon size={18} strokeWidth={2.5} /></span>
        <span>{message}</span>
        <div className="toast-bar" aria-hidden="true">
          <motion.div
            className="toast-bar-fill"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            /* transform-based (compositor-only) instead of width — no layout thrash */
            style={{ background: colors.color, transformOrigin: 'left' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

/* Toast host that renders the active toast (use one per page). */
export function ToastHost({ toast, onClose }) {
  return (
    <div className="toast-host-wrap">
      <AnimatePresence>
        {toast && <Toast key="t" message={toast.message} type={toast.type} onClose={onClose} />}
      </AnimatePresence>
    </div>
  );
}

/* Modal with backdrop fade + spring scale. Visual styling (radius 16,
   hard offset shadow) lives in .modal-content/.modal-pro CSS.
   Adds the dialog semantics the ShortcutsOverlay promises: Escape closes,
   focus moves to the dialog on open, and background scroll is locked. */
export function Modal({ open, onClose, children, title, wide }) {
  const cardRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog for keyboard users.
    const t = setTimeout(() => {
      const el = cardRef.current;
      if (!el) return;
      const target = el.querySelector('[data-autofocus]') || el.querySelector('button, [href], input, select, textarea');
      if (target) target.focus({ preventScroll: true });
      else el.setAttribute('tabindex', '-1'), el.focus({ preventScroll: true });
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onClick={onClose}
        >
          <motion.div
            ref={cardRef}
            className={`modal-content modal-pro ${wide ? 'modal-wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : 'Dialog'}
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={SPRING}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="modal-header">
                <h3>{title}</h3>
                <button onClick={onClose} className="modal-close" aria-label="Close"><X size={16} /></button>
              </div>
            )}
            <div className="modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* Lightweight ripple button — tap scale + shimmer sweep already in .btn. */
// eslint-disable-next-line react-refresh/only-export-components -- MotionBtn is a styled-primitive re-export, not a component file split
export const MotionBtn = motion.button;

/* Success burst — brand indigo pulse (CSS-only, cheap). */
export function SuccessBurst({ show }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="success-burst"
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 2.4, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        />
      )}
    </AnimatePresence>
  );
}
