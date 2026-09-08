/* Public16Shell — shared v16 shell for the secondary public pages
   (/about, /terms, /privacy). Wraps content in the landing's own .lx-root
   vocabulary so landing-v16.css styles everything (pill nav, sections,
   cards, footer) with ZERO new CSS, and re-implements the landing's two
   behaviors: .rv reveal-on-scroll (IntersectionObserver) and the slim
   fixed pill nav (router links instead of hash anchors). */
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth, homePathFor } from '../../auth/AuthContext';

const CapIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
    <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
  </svg>
);

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/about', label: 'About' },
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
];

export default function Public16Shell({ title, children }) {
  const rootRef = useRef(null);
  const { mode, toggle } = useTheme() || {};
  const { token, user } = useAuth();
  const navigate = useNavigate();

  /* .rv reveal-on-scroll — same observer the landing uses (.rv → .in). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    root.querySelectorAll('.rv').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [children]);

  return (
    <div className="lx-root pub16" ref={rootRef}>
      {/* slim pill nav — designer nav markup, router links */}
      <header className="nav">
        <Link className="brand" to="/">
          <span className="bx">{CapIcon}</span>
          <span>Fetch-<b>X</b></span>
        </Link>
        <nav className="nlinks" aria-label="Public pages">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={title === n.label ? 'active' : ''}>{n.label}</Link>
          ))}
        </nav>
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          title="Dark / light mode"
          aria-label="Toggle theme"
        >
          {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            if (token && user) navigate(homePathFor(user.role));
            else navigate('/login');
          }}
        >
          {token && user ? 'Dashboard' : 'Sign In'} <span aria-hidden="true">→</span>
        </button>
      </header>

      <main style={{ paddingTop: 120 }}>
        {children}
      </main>

      {/* designer footer (router links) */}
      <footer>
        <div className="wrap">
          <div className="frow">
            <Link className="brand" to="/">
              <span className="bx">{CapIcon}</span>
              <span>Fetch-X</span>
            </Link>
            <span className="ftag">Intelligent school management.</span>
            <nav className="flinks" aria-label="Footer">
              <Link to="/about">About</Link>
              <Link to="/">Features</Link>
              <Link to={token && user ? homePathFor(user.role) : '/login'}>Sign In</Link>
            </nav>
          </div>
          <p className="fcopy">© 2026 Fetch-X — Data Intelligence Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

/* page section helper — designer .sec-head inside .wrap */
export function PubSection({ id, eyebrow, title, lead, children, style }) {
  return (
    <section id={id} className="rv" style={{ padding: '34px 0', ...style }}>
      <div className="wrap">
        <div className="sec-head">
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
          {lead && <p>{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
