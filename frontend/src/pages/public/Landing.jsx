import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, homePathFor } from '../../auth/AuthContext';
import { useTheme } from '../../components/ThemeProvider';
import { SignInModal } from '../Login';
import { DEMO_CREDS } from './demoCreds';
import './landing-v16.css';

/* ─────────────────────────────────────────────────────────────────────────────
   Fetch-X v16 PUBLIC LANDING — designer upload/index(2).html, ported 1:1.

   Standalone page: it owns its own fixed pill nav + footer (no PublicLayout
   chrome — App.jsx renders <Landing/> bare). Markup, classes, copy and SVGs
   are the designer's verbatim; only the stat numbers become real (2 700 demo
   students · 3 schools · 80% avg performance · 3 house sections) and the
   DEMO ACCESS cred-table maps to REAL seed_demo accounts.

   Behaviors ported from the designer <script>:
     • scroll-spy nav (y+150, bottom pin) — same algorithm as the old
       LANDING_SPY/PublicLayout spy, now self-contained
     • .rv reveal-on-scroll via IntersectionObserver (threshold .12)
     • stat count-up via IntersectionObserver (threshold .3, 1300ms ease-out)
     • theme toggle uses the app's ThemeProvider (body.dark — the designer's
       dark tokens are bound to body.dark .lx-root in landing-v16.css)
     • Sign In / Get Started open the shared SignInModal (pages/Login.jsx);
       cred-table rows open it PRE-FILLED; Live Demo logs in as Chairperson
   ──────────────────────────────────────────────────────────────────────────── */

/* ── designer inline SVGs (verbatim paths) ── */
const CapIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
    <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
  </svg>
);
const MoonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
const SunIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);
const PlayIcon = <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>;
const BarsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
  </svg>
);
const BotIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V5M12 5a1.5 1.5 0 1 0-.01-3A1.5 1.5 0 0 0 12 5z" />
    <path d="M9 13.5h.01M15 13.5h.01M9.5 17h5" />
  </svg>
);
const SchoolIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 21V8l8-5 8 5v13" />
    <path d="M2 21h20M9.5 21v-4h5v4M12 11h.01" />
  </svg>
);
const PersonIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5" />
  </svg>
);
const TrendIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6.5-6.5 3.5 3.5L21 6M15 6h6v6" />
  </svg>
);
const StarIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3z" />
  </svg>
);
const PeopleIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 19c.6-3 2.9-4.7 6.2-4.7s5.6 1.7 6.2 4.7" />
    <circle cx="17" cy="9" r="2.6" />
    <path d="M15.8 14.6c2.9.1 4.9 1.6 5.4 4.1" />
  </svg>
);
const ShieldIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 4.4-3 8.4-7 10-4-1.6-7-5.6-7-10V6l7-3z" />
    <path d="M9 12l2 2 4-4.5" />
  </svg>
);

/* Hero squircle → the real school logo mark (public/gnps-logo.png), with the
   designer's cap SVG as the graceful fallback if the asset is missing. */
function SquircleLogo() {
  const [ok, setOk] = useState(true);
  return (
    <div className="squircle">
      {ok
        ? <img src="/gnps-logo.png" alt="Guru Nanak Group of Schools" onError={() => setOk(false)} />
        : CapIcon}
    </div>
  );
}

/* Designer count-up: 1300ms, cubic ease-out, rAF (verbatim algorithm). */
function Snum({ target, suffix = '', run }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    const dur = 1300;
    const st = performance.now();
    let raf = 0;
    const tick = (now) => {
      const p = Math.min(1, (now - st) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target]);
  return <div className="snum" data-count={target}>{val}{suffix}</div>;
}

/* Real volumes from the demo dataset — the designer's numbers made real
   (designer showed 900 / 1 / 80% / 3; the seed is 3 schools × 900 students). */
const STATS = [
  { icon: PersonIcon, target: 2700, suffix: '', label: 'Demo students seeded' },
  { icon: SchoolIcon, target: 3, suffix: '', label: 'Demo schools' },
  { icon: TrendIcon, target: 80, suffix: '%', label: 'Avg school performance' },
  { icon: StarIcon, target: 3, suffix: '', label: 'House sections' },
];

const NAV_IDS = ['home', 'about', 'features', 'privacy'];

export default function Landing() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { mode, toggle } = useTheme() || {};

  /* ── sign-in modal state (open + prefill for the cred-table buttons) ──
     `seq` increments on EVERY open so the modal remounts fresh: its state
     initializers pick up the prefill (no state-sync effects needed). */
  const [auth, setAuth] = useState({ seq: 0, open: false, prefill: null });
  const openAuth = useCallback(() => {
    setAuth((s) => ({ seq: s.seq + 1, open: true, prefill: null }));
  }, []);
  const openAuthWith = useCallback((email, password) => {
    setAuth((s) => ({ seq: s.seq + 1, open: true, prefill: { email, password } }));
  }, []);
  const closeAuth = useCallback(() => setAuth((s) => ({ ...s, open: false })), []);

  /* ── scroll-spy nav (designer algorithm: y+150, last section wins,
        bottom-of-document pins the last id) ── */
  const [active, setActive] = useState('home');
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY + 150;
      let cur = 'home';
      NAV_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= y) cur = id;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        cur = NAV_IDS[NAV_IDS.length - 1];
      }
      setActive((p) => (p === cur ? p : cur)); // no re-render per scroll tick
    };
    raf = requestAnimationFrame(update); // initial pass
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  /* ── .rv reveal-on-scroll (designer: threshold .12, fire once) ── */
  useEffect(() => {
    const els = document.querySelectorAll('.lx-root .rv');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  /* ── stat counters (designer: start at 30% visibility, once) ── */
  const statsRef = useRef(null);
  const [statsOn, setStatsOn] = useState(false);
  useEffect(() => {
    const el = statsRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { setStatsOn(true); io.disconnect(); }
      });
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ── Live Demo: straight into the Chairperson group dashboard. If the
        backend is unreachable, fall back to the pre-filled sign-in modal. ── */
  const [demoBusy, setDemoBusy] = useState(false);
  const demoGo = async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      await login(DEMO_CREDS[0].email, DEMO_CREDS[0].password);
      navigate(homePathFor('chairperson'), { replace: true });
    } catch {
      setDemoBusy(false);
      openAuthWith(DEMO_CREDS[0].email, DEMO_CREDS[0].password);
    }
  };

  return (
    <div className="lx-root">

      {/* ============ NAV ============ */}
      <header className="nav">
        <a className="brand" href="#home">
          <span className="bx">{CapIcon}</span>
          <span>Fetch-<b>X</b></span>
        </a>
        <nav className="nlinks" id="navLinks">
          <a href="#home" className={active === 'home' ? 'active' : ''}>Home</a>
          <a href="#about" className={active === 'about' ? 'active' : ''}>About</a>
          <a href="#features" className={active === 'features' ? 'active' : ''}>Features</a>
          <a href="#privacy" className={active === 'privacy' ? 'active' : ''}>Privacy</a>
        </nav>
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          title="Dark / light mode"
          aria-label="Toggle theme"
        >
          {mode === 'dark' ? SunIcon : MoonIcon}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={openAuth}>
          Sign In <span aria-hidden="true">→</span>
        </button>
      </header>

      <main>
        {/* ============ HERO ============ */}
        <section className="hero" id="home">
          <div className="wrap hero-grid">
            <div>
              <span className="badge rv">✦ &nbsp;AI-POWERED SCHOOL INTELLIGENCE PLATFORM</span>
              <h1 className="rv" style={{ transitionDelay: '.06s' }}>
                School management,<br /><span className="grad">finally intelligent.</span>
              </h1>
              <p className="lead rv" style={{ transitionDelay: '.12s' }}>
                One platform for attendance, marks, tasks, and school-wide analytics.
                Built for principals and leadership — with intelligence that actually
                reads your data.
              </p>
              <div className="hero-cta rv" style={{ transitionDelay: '.18s' }}>
                <button type="button" className="btn btn-primary" onClick={openAuth}>
                  Get Started <span aria-hidden="true">→</span>
                </button>
                <a
                  className="btn btn-ghost"
                  href="#"
                  onClick={(e) => { e.preventDefault(); demoGo(); }}
                >
                  {PlayIcon} {demoBusy ? 'Loading demo…' : 'Live Demo'}
                </a>
              </div>
              <div className="checks rv" style={{ transitionDelay: '.24s' }}>
                <span className="check">{CheckIcon}Role-based access</span>
                <span className="check">{CheckIcon}Insights in seconds</span>
                <span className="check">{CheckIcon}Term-wise rollups</span>
              </div>
            </div>
            <div className="hero-art rv" style={{ transitionDelay: '.15s' }}>
              <SquircleLogo />
            </div>
          </div>
        </section>

        {/* ============ TEAM ============ */}
        <section id="about">
          <div className="wrap">
            <div className="sec-head rv">
              <h2>The people behind Fetch-X</h2>
              <p>Two builders, one mission — make school data actually useful.</p>
            </div>
            <div className="team-grid">
              <div className="person rv">
                <div className="pav a">K</div>
                <div className="pname">kishor kudre</div>
                <span className="prole">CEO · VISION &amp; GROWTH</span>
                <p className="pbio">
                  Multi-talented CEO driving product vision and execution. From pitching
                  and presentation to scaling — Kishor turns Fetch-X's capability into
                  impact for every school it reaches.
                </p>
              </div>
              <div className="person krole rv" style={{ transitionDelay: '.1s' }}>
                <div className="pav k">A</div>
                <div className="pname">Adhish Biradar</div>
                <span className="prole">CTO · BACKEND &amp; OPERATIONS</span>
                <p className="pbio">
                  Adhish is the Nerdy CTO who brings vision into reality by architecting
                  the data engine, keeping every metric honest, and operating the platform
                  end-to-end to keep Fetch-X operating smoothly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FEATURES ============ */}
        <section id="features">
          <div className="wrap">
            <div className="sec-head rv">
              <h2>Everything a school needs, in one place</h2>
              <p>From the classroom to the boardroom — purpose-built for every role.</p>
            </div>
            <div className="feat-grid">
              <div className="fcard rv">
                <div className="fic">{BarsIcon}</div>
                <h3>Analytics that matter</h3>
                <p>Real-time dashboards for grades, attendance, exam performance, and at-risk detection — built for principals and leadership.</p>
              </div>
              <div className="fcard rv" style={{ transitionDelay: '.08s' }}>
                <div className="fic">{BotIcon}</div>
                <h3>AI Assistant</h3>
                <p>Ask plain-English questions about your school. Get answers with named students, specific numbers, and action recommendations.</p>
              </div>
              <div className="fcard rv" style={{ transitionDelay: '.16s' }}>
                <div className="fic teal">{SchoolIcon}</div>
                <h3>Term-wise rollups</h3>
                <p>Every class, section, and student tracked across three terms — rankings, trends, and distribution in one view.</p>
              </div>
            </div>
            <div className="stats rv" id="stats" ref={statsRef}>
              {STATS.map((s) => (
                <div className="stat" key={s.label}>
                  <span className="sic">{s.icon}</span>
                  <Snum target={s.target} suffix={s.suffix} run={statsOn} />
                  <div className="slab">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section id="cta" style={{ paddingTop: 30 }}>
          <div className="wrap">
            <div className="cta rv">
              <div className="cic">{PeopleIcon}</div>
              <h2>Ready to modernize your school?</h2>
              <p>Sign in with your principal account to explore the full experience — every level, every term, every student.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={openAuth}>
                  Sign In <span aria-hidden="true">→</span>
                </button>
                <a className="btn btn-ghost" href="#features">Learn More</a>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PRIVACY ============ */}
        <section id="privacy" style={{ paddingTop: 30 }}>
          <div className="wrap">
            <div className="priv rv">
              <div className="fic">{ShieldIcon}</div>
              <div>
                <h3>Privacy first, always</h3>
                <p>
                  This demo runs entirely in your browser — no accounts are created, no
                  data leaves your device, and no third-party trackers are used. Saved
                  students, folders, and theme preferences live in local storage and stay
                  under your control.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ============ DEMO ACCESS ============ */}
      <section id="demo-ids" className="rv" style={{ padding: '48px 0 8px' }}>
        <div className="wrap">
          <div className="sec-head" style={{ textAlign: 'center', marginBottom: 28 }}>
            <span className="eyebrow">LIVE DEMO</span>
            <h2 style={{ fontSize: 28, marginTop: 6 }}>Demo Access — try every dashboard</h2>
            <p style={{ color: 'var(--muted)', maxWidth: 560, margin: '8px auto 0', fontSize: 14, lineHeight: 1.6 }}>
              Four roles, four dashboards. Use the credentials below to sign in — each
              opens a different view of the platform.
            </p>
          </div>
          <div className="cred-table" id="credTable">
            <div className="cred-row cred-head">
              <span>ROLE</span><span>EMAIL</span><span>PASSWORD</span><span></span>
            </div>
            {DEMO_CREDS.map((c) => (
              <div className="cred-row" key={c.email}>
                <span className="cr-role">
                  <span className="cr-ic" style={{ background: c.color }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {c.icon}
                    </svg>
                  </span>
                  <b>{c.label}</b>
                  <em>{c.scope}</em>
                </span>
                <span className="cr-email"><code>{c.email}</code></span>
                <span className="cr-pass"><code>{c.password}</code></span>
                <span className="cr-go">
                  <button
                    type="button"
                    className="btn btn-ghost cr-btn"
                    onClick={() => openAuthWith(c.email, c.password)}
                  >
                    Sign in
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer>
        <div className="wrap">
          <div className="frow">
            <a className="brand" href="#home">
              <span className="bx">{CapIcon}</span>
              <span>Fetch-<b>X</b></span>
            </a>
            <span className="ftag">Intelligent school management.</span>
            <nav className="flinks">
              {/* real routes — the pill nav keeps the designer's in-page
                  scroll-spy; the footer carries the full page map */}
              <Link to="/about">About</Link>
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
              <a href="#" onClick={(e) => { e.preventDefault(); openAuth(); }}>Sign In</a>
            </nav>
          </div>
          <p className="fcopy">© 2026 Fetch-X — Data Intelligence Platform. All rights reserved.</p>
        </div>
      </footer>

      {/* ============ SIGN-IN MODAL (designer structure; shared with /login) ============ */}
      <SignInModal key={auth.seq} open={auth.open} onClose={closeAuth} initial={auth.prefill} />
    </div>
  );
}
