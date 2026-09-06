import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, MotionConfig, useInView } from 'framer-motion';
import { AlertCircle, ArrowRight, Loader2, Sparkles, X } from 'lucide-react';
import { CountUp } from '../../components/ui.jsx';
import { useAuth, homePathFor } from '../../auth/AuthContext';
import dashHero from '../../assets/dashboard-hero.png';

/* Fetch-X landing page — rebuilt from the designer prototype
   (upload/index.html): hero with a real product capture, team duo, feature
   cards, count-up stats band, CTA, privacy card, and a sign-in modal wired
   to REAL auth (POST /auth/login via the shared api client through
   AuthContext — same flow as Login.jsx).

   All geometry/typography comes from the index.css landing kit (2-b) —
   nothing is re-styled here. Scroll reveals use framer-motion whileInView
   with the prototype's .rv easing/delays. */

/* Prototype .rv reveal: translateY(20px) -> 0, .7s cubic-bezier(.25,.7,.3,1). */
const RV_EASE = [0.25, 0.7, 0.3, 1];
const rv = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.7, ease: RV_EASE, delay },
});

/* ── Exact inline iconography from the prototype (sized by the CSS kit) ── */
const PlayIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20" /></svg>
);
const ChartIcon = (
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

/* ── Content (prototype copy, verbatim) ── */
const TEAM = [
  {
    initial: 'K',
    avatar: 'a',
    krole: false,
    name: 'kishor kudre',
    role: 'CEO · VISION & GROWTH',
    bio: "Multi-talented CEO driving product vision and execution. From pitching and presentation to scaling — Kishor turns Fetch-X's capability into impact for every school it reaches.",
  },
  {
    initial: 'A',
    avatar: 'k',
    krole: true,
    name: 'Adhish Biradar',
    role: 'CTO · BACKEND & OPERATIONS',
    bio: 'Adhish is the Nerdy CTO who brings vision into reality by architecting the data engine, keeping every metric honest, and operating the platform end-to-end to keep Fetch-X operating smoothly.',
  },
];

const FEATURES = [
  {
    icon: ChartIcon,
    tone: '',
    title: 'Analytics that matter',
    body: 'Real-time dashboards for grades, attendance, exam performance, and at-risk detection — built for principals and leadership.',
  },
  {
    icon: BotIcon,
    tone: 'teal',
    title: 'AI Assistant',
    body: 'Ask plain-English questions about your school. Get answers with named students, specific numbers, and action recommendations.',
  },
  {
    icon: SchoolIcon,
    tone: 'amber',
    title: 'Term-wise rollups',
    body: 'Every class, section, and student tracked across three terms — rankings, trends, and distribution in one view.',
  },
];

/* Real volumes from the demo dataset (3 seeded schools) — no invented
   outcomes, just what the platform actually processes. */
const STATS = [
  { icon: PersonIcon, value: 2700, suffix: '+', label: 'Student records' },
  { icon: SchoolIcon, value: 90, suffix: '', label: 'Class sections' },
  { icon: StarIcon, value: 6, suffix: '', label: 'Subjects, term-tracked' },
  { icon: TrendIcon, value: 48600, suffix: '+', label: 'Marks analysed' },
];

export default function Landing() {
  const navigate = useNavigate();
  const { login } = useAuth();

  /* ── sign-in modal state ── */
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const emailRef = useRef(null);
  const loadingRef = useRef(false); // lets Escape/backdrop guards read it without re-binding listeners

  /* ── stats count-up trigger (prototype: counters start at 30% visibility) ── */
  const statsRef = useRef(null);
  const statsInView = useInView(statsRef, { once: true, amount: 0.3 });

  const openAuth = () => { setError(''); setAuthOpen(true); };
  const closeAuth = () => { if (!loading) setAuthOpen(false); };

  /* Escape closes the modal (unless signing in); email auto-focuses on open. */
  useEffect(() => {
    if (!authOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !loadingRef.current) setAuthOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => emailRef.current?.focus(), 80);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [authOpen]);

  /* REAL auth — mirrors Login.jsx: useAuth().login stores the token + user
     in localStorage ('token' / 'user') and we redirect to the role's home. */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    loadingRef.current = true;
    try {
      const user = await login(email.trim(), password);
      setAuthOpen(false);
      navigate(homePathFor(user.role), { replace: true });
    } catch (err) {
      if (!err.response) {
        setError('Cannot reach the server. If this is a deployed site, the backend needs to be deployed separately.');
      } else if (err.response.status === 423) {
        setError('Too many failed attempts. Please try again in 15 minutes.');
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="fx-landing">
        {/* ── HERO ── */}
        <section className="hero" id="home">
          <div className="wrap hero-grid">
            <div>
              <motion.span className="badge" {...rv()}>
                <Sparkles size={13} /> AI-POWERED SCHOOL INTELLIGENCE PLATFORM
              </motion.span>
              <motion.h1 {...rv(0.06)}>
                School management,<br />
                <span className="grad">finally intelligent.</span>
              </motion.h1>
              <motion.p className="lead" {...rv(0.12)}>
                One platform for attendance, marks, tasks, and school-wide analytics.
                Built for principals and leadership — with intelligence that actually
                reads your data.
              </motion.p>
              <motion.div className="hero-cta" {...rv(0.18)}>
                <button type="button" className="btn btn-primary" onClick={openAuth}>
                  Get Started <ArrowRight size={15} />
                </button>
                <button type="button" className="btn btn-ghost" onClick={openAuth}>
                  {PlayIcon} Live Demo
                </button>
              </motion.div>
            </div>
            <motion.div className="hero-art" {...rv(0.15)}>
              <img
                className="hero-shot"
                src={dashHero}
                alt="Fetch-X principal dashboard — school-wide performance, score distribution, and attendance trend"
                width="1440"
                height="900"
              />
            </motion.div>
          </div>
        </section>

        {/* ── TEAM ── */}
        <section id="about">
          <div className="wrap">
            <motion.div className="sec-head" {...rv()}>
              <h2>The people behind Fetch-X</h2>
              <p>Two builders, one mission — make school data actually useful.</p>
            </motion.div>
            <div className="team-grid">
              {TEAM.map((p, i) => (
                <motion.div className={`person${p.krole ? ' krole' : ''}`} {...rv(i * 0.1)} key={p.name}>
                  <div className={`pav ${p.avatar}`}>{p.initial}</div>
                  <div className="pname">{p.name}</div>
                  <span className="prole">{p.role}</span>
                  <p className="pbio">{p.bio}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES + STATS ── */}
        <section id="features">
          <div className="wrap">
            <motion.div className="sec-head" {...rv()}>
              <h2>Everything a school needs, in one place</h2>
              <p>From the classroom to the boardroom — purpose-built for every role.</p>
            </motion.div>
            <div className="feat-grid">
              {FEATURES.map((f, i) => (
                <motion.div className="fcard" {...rv(i * 0.08)} key={f.title}>
                  <div className={`fic${f.tone ? ` ${f.tone}` : ''}`}>{f.icon}</div>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </motion.div>
              ))}
            </div>
            <motion.div className="stats" ref={statsRef} {...rv()}>
              {STATS.map((s) => (
                <div className="stat" key={s.label}>
                  <span className="sic">{s.icon}</span>
                  <div className="snum">
                    <CountUp value={statsInView ? s.value : 0} duration={1.3} />{s.suffix}
                  </div>
                  <div className="slab">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section id="cta" className="pt-30">
          <div className="wrap">
            <motion.div className="cta" {...rv()}>
              <div className="cic">{PeopleIcon}</div>
              <h2>Ready to modernize your school?</h2>
              <p>Sign in with your principal account to explore the full experience — every level, every term, every student.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={openAuth}>
                  Sign In <ArrowRight size={15} />
                </button>
                <a className="btn btn-ghost" href="#features">See features</a>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── PRIVACY ── */}
        <section id="privacy" className="pt-30">
          <div className="wrap">
            <motion.div className="priv" {...rv()}>
              <div className="fic">{ShieldIcon}</div>
              <div>
                <h3>Privacy first, always</h3>
                <p>
                  Student data stays inside your school. Every record is protected by
                  role-based access, every request is authenticated and scoped to a
                  single school, and no third-party trackers are used anywhere on the
                  platform.
                </p>
              </div>
            </motion.div>
          </div>
        </section>
      </div>

      {/* ── SIGN-IN MODAL (portal: must stack above the fixed nav) ── */}
      {createPortal(
        <AnimatePresence>
          {authOpen && (
            <motion.div
              className="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeAuth}
            >
              <motion.div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-label="Sign in"
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.25, ease: RV_EASE }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mhead">
                  <div><h3>Welcome back</h3></div>
                  <button type="button" className="mclose" onClick={closeAuth} aria-label="Close">
                    <X size={13} strokeWidth={2.6} />
                  </button>
                </div>
                <p className="msub">Sign in to open your Fetch-X dashboard.</p>

                {error && (
                  <div className="login-error" role="alert">
                    <AlertCircle size={15} strokeWidth={2.4} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="field">
                    <label htmlFor="fx-auth-email">Email</label>
                    <input
                      id="fx-auth-email"
                      ref={emailRef}
                      type="email"
                      placeholder="principal@yourschool.in"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="fx-auth-pass">Password</label>
                    <input
                      id="fx-auth-pass"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary mbtn" disabled={loading}>
                    {loading ? (
                      <>
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                          style={{ display: 'inline-flex' }}
                        >
                          <Loader2 size={15} />
                        </motion.span>
                        {' '}Signing in…
                      </>
                    ) : (
                      <>Sign In <ArrowRight size={15} /></>
                    )}
                  </button>
                </form>
                <p className="mnote">
                  Authorized personnel only. By signing in you agree to our{' '}
                  <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </MotionConfig>
  );
}
