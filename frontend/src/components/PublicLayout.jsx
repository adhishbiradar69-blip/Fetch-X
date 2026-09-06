import { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, X, LogIn } from 'lucide-react';
import ThemeSelector from './ThemeSelector.jsx';

/* Public site shell — the designer's floating pill nav (fixed, centered,
   blurred) + Fetch-X footer. Links keep the existing public routes.

   Props:
   - flush     — drop the shell's 88px nav clearance (landing route: the hero
                 reserves its own 170px, per the prototype).
   - spy       — optional scroll-spy map for pages with in-page sections:
                 [{ id: 'sectionId', to: '/nav/path' }, ...]. While scrolling,
                 the nav link whose section is in view gets the active state
                 (prototype's active-nav-on-scroll), without changing routes. */
const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
];

export default function PublicLayout({ children, flush = false, spy = null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [spyTo, setSpyTo] = useState(null);
  const navigate = useNavigate();

  /* Reset the spy target when the spy map changes (render-phase derived
     state reset — the React-endorsed pattern, same as useRouteTransition). */
  const [lastSpy, setLastSpy] = useState(spy);
  if (lastSpy !== spy) { setLastSpy(spy); setSpyTo(null); }

  useEffect(() => {
    if (!spy || spy.length === 0) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY + 150;
      let current = null;
      spy.forEach(({ id, to }) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= y) current = to;
      });
      /* At the very bottom of the document the last section can never cross
         the scroll threshold on tall viewports — pin the last spy target. */
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = spy[spy.length - 1].to;
      }
      /* Only write state on change — writing every frame re-rendered the
         whole shell for every scroll tick even when nothing changed. */
      setSpyTo((prev) => (prev === current ? prev : current));
    };
    raf = requestAnimationFrame(update); // initial pass, off the effect body
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [spy]);

  /* Close the mobile menu on Escape / outside click. */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    const onClick = (e) => {
      if (!e.target.closest('.fx-nav')) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [menuOpen]);

  return (
    <div className={`public-shell${flush ? ' flush' : ''}`}>
      <header className="fx-nav public-nav">
        <Link to="/" className="brand fx-nav-brand" onClick={() => setMenuOpen(false)}>
          <span className="bx">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
              <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
            </svg>
          </span>
          <span>Fetch-X</span>
        </Link>

        <nav className={`nlinks ${menuOpen ? 'open' : ''}`}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => {
                /* Scroll-spy (when enabled) overrides the route highlight so
                   exactly one link is active at a time. */
                const active = spyTo ? spyTo === item.to : isActive;
                return `fx-nav-link ${active ? 'active' : ''}`;
              }}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="fx-nav-actions public-nav-actions">
          <ThemeSelector compact />
          <button
            type="button"
            className="btn btn-primary btn-sm public-sign-in"
            onClick={() => navigate('/login')}
          >
            <LogIn size={15} /> <span>Sign In</span>
          </button>
          <button
            type="button"
            className="fx-nav-toggle public-nav-toggle"
            onClick={() => setMenuOpen(o => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      <main className="fx-main public-main">{children}</main>

      <footer className="fx-footer public-footer">
        <div className="fx-footer-inner public-footer-inner">
          <div className="frow">
            <Link to="/" className="brand">
              <span className="bx">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
                  <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
                </svg>
              </span>
              <span>Fetch-X</span>
            </Link>
            <span className="ftag">Intelligent school management.</span>
            <nav className="flinks">
              <Link to="/about">About</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/login">Sign In</Link>
            </nav>
          </div>
          <p className="fcopy">© {new Date().getFullYear()} Fetch-X — Intelligent school management. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
