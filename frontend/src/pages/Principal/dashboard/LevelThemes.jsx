/* eslint-disable react-refresh/only-export-components -- singleton store
   (setters + getters) is intentionally colocated with the components that
   consume it, same as charts.jsx's useReveal/useInView. */
/* LevelThemes — designer v15 feature: every level (1-6) plus the "ambient"
   accent can be recolored from a 50-swatch palette. Choices persist in
   localStorage ('si-themes' / 'si-amb') exactly like the prototype, and are
   applied by injecting CSS custom-property overrides for .lvl-1 … .lvl-6 in
   both light and dark modes. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const PALETTE = [
  '#5b4fe9', '#6366f1', '#7c74f2', '#8b7cf6', '#a78bfa', '#6d5bd0', '#7c3aed', '#9333ea',
  '#a855f7', '#c084fc', '#c026d3', '#d655c8', '#db2777', '#e0567f', '#ec4899', '#f472b6',
  '#d6336c', '#be123c', '#f43f5e', '#fb7185', '#ef4444', '#e5646c', '#dc2626', '#d26a5c',
  '#c2504a', '#f97316', '#ea8a3a', '#f59e0b', '#eab308', '#d97706', '#ca8a04', '#b49914',
  '#a3a635', '#8a9a2b', '#65a30d', '#4d7c0f', '#22c55e', '#16a34a', '#10b981', '#34d399',
  '#0e9f6e', '#14b8a6', '#2dd4bf', '#06b6d4', '#0e7490', '#3b82f6', '#60a5fa', '#2563eb',
  '#64748b', '#8d6e63',
];

export const DEFAULT_THEMES = { 1: '#4f42dd', 2: '#0c7a6b', 3: '#b45f04', 4: '#c2255c', 5: '#0e7490', 6: '#9333ea' };
const AMB_DEFAULT = '#8a7cf6';

const rgba = (hex, a) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

const loadThemes = () => {
  try {
    return { ...DEFAULT_THEMES, ...JSON.parse(localStorage.getItem('si-themes') || '{}') };
  } catch {
    return { ...DEFAULT_THEMES };
  }
};
const loadAmb = () => {
  try { return localStorage.getItem('si-amb') || AMB_DEFAULT; } catch { return AMB_DEFAULT; }
};

/* Singleton store shared by every ThemeBtn on the page. */
const listeners = new Set();
let themes = typeof window !== 'undefined' ? loadThemes() : { ...DEFAULT_THEMES };
let ambient = typeof window !== 'undefined' ? loadAmb() : AMB_DEFAULT;

const emit = () => listeners.forEach((fn) => fn({ themes, ambient }));

export function setLevelTheme(lvl, color) {
  themes = { ...themes, [lvl]: color };
  try { localStorage.setItem('si-themes', JSON.stringify(themes)); } catch { /* ignore */ }
  emit();
}
export function setAmbient(color) {
  ambient = color;
  try { localStorage.setItem('si-amb', color); } catch { /* ignore */ }
  emit();
}
export const getThemes = () => themes;
export const getAmbient = () => ambient;

/* Injects/updates the <style id="levelThemeStyle"> override block. */
export function LevelThemeStyle() {
  useLayoutEffect(() => {
    const apply = () => {
      let css = '';
      for (let i = 1; i <= 6; i++) {
        const c = themes[i] || DEFAULT_THEMES[i];
        css += `.lvl-${i}{--lvlD:${c};--lvlSoft:${rgba(c, .13)};--numcol:${rgba(c, .35)};--bg:${rgba(c, .045)};--bd:${rgba(c, .15)};--donut:${c};--bar:${c};--nc:${c}}`;
        css += `body.dark .lvl-${i}{--lvlSoft:${rgba(c, .2)};--numcol:${rgba(c, .55)};--bg:${rgba(c, .1)};--bd:${rgba(c, .3)}}`;
        css += `:root{--lvl-${i}-c:${c}}`;
      }
      css += `:root{--amb:${ambient};--amb-glow:${rgba(ambient, .5)};--amb-soft:${rgba(ambient, .14)}}`;
      let el = document.getElementById('levelThemeStyle');
      if (!el) {
        el = document.createElement('style');
        el.id = 'levelThemeStyle';
        document.head.appendChild(el);
      }
      el.textContent = css;
      document.documentElement.style.setProperty('--amb', ambient);
      document.documentElement.style.setProperty('--amb-glow', rgba(ambient, .5));
      document.documentElement.style.setProperty('--amb-soft', rgba(ambient, .14));
    };
    apply();
    const onStore = ({ themes: t, ambient: a }) => { themes = t; ambient = a; apply(); };
    listeners.add(onStore);
    return () => { listeners.delete(onStore); };
  }, []);
  return null;
}

/* ------------------------------------------------------------------
   ThemeBtn — the swatch pill that opens the 50-swatch popover.
   lvl: 1..6, or 'amb' for the ambient light color.
------------------------------------------------------------------ */
export function ThemeBtn({ lvl, label, className = '' }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [, force] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.target.closest?.('.tp-v15') || e.target.closest?.('.theme-btn-v15')) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    const onStore = () => force((n) => n + 1);
    listeners.add(onStore);
    return () => { listeners.delete(onStore); };
  }, []);

  const openPop = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const w = 246;
      const left = Math.min(Math.max(10, r.left - 90), window.innerWidth - w - 10);
      let top = r.bottom + 8;
      const h = 300;
      if (top + h > window.innerHeight - 10) top = r.top - h - 8;
      setPos({ left, top });
    }
    setOpen((o) => !o);
  };

  const isAmb = lvl === 'amb';
  const current = isAmb ? getAmbient() : (getThemes()[lvl] || DEFAULT_THEMES[lvl]);
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`theme-btn theme-btn-v15 ${className}`}
        onClick={openPop}
        title="Theme color"
      >
        <span className="sw" />
        {label ?? 'THEME'}
      </button>
      {open && createPortal(
        <div className="tp open tp-v15" ref={popRef} style={{ left: pos.left, top: pos.top }}>
          <div className="t"><span>THEME COLOR</span><b>{isAmb ? 'AMBIENT LIGHT' : `LEVEL 0${lvl}`}</b></div>
          <div className="grid">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                style={{ background: c }}
                className={c === current ? 'sel' : ''}
                onClick={() => { isAmb ? setAmbient(c) : setLevelTheme(lvl, c); }}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
