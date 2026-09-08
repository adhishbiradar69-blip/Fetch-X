import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, homePathFor } from '../auth/AuthContext';
import { DEMO_CREDS } from './public/demoCreds';
import './public/landing-v16.css';

/* ─────────────────────────────────────────────────────────────────────────────
   Designer v16 sign-in MODAL (upload/index(2).html) + standalone /login page.

   The modal component is exported so the v16 landing (pages/public/Landing.jsx)
   can host it inline; the default export renders the same modal over a dimmed
   backdrop for the standalone /login route — closing it returns to the landing.

   REAL auth: useAuth().login(email, password) → POST /auth/login (stores the
   token + user) → navigate(homePathFor(role)). Failure replays the designer's
   .auth-err shake (keyed remount). Live Demo logs in as the Chairperson demo
   account directly. The landing's cred-table pre-fills the fields via the
   `initial` prop + remount key (Landing passes key={openSeq}).

   NOTE: the modal keeps a constant instance per open — no state-sync effects.
   ──────────────────────────────────────────────────────────────────────────── */

export function SignInModal({ open, onClose, initial = null, standalone = false }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  /* State initializers read `initial` at mount — the parent remounts the
     modal per open (key = open sequence) so cred-table prefill is exact. */
  const [email, setEmail] = useState(initial ? initial.email : '');
  const [password, setPassword] = useState(initial ? initial.password : '');
  const [err, setErr] = useState('');
  const [errSeq, setErrSeq] = useState(0); // keyed remount replays the shake
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('signin'); // which action is running ('signin' | 'demo')
  const busyRef = useRef(false);
  const emailRef = useRef(null);

  const fail = (msg) => { setErr(msg); setErrSeq((n) => n + 1); };

  /* Open → focus the email field (designer's 80ms delay; DOM-only effect). */
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => emailRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open]);

  const handleClose = useCallback(() => {
    if (busyRef.current) return; // no mid-request dismissal
    setErr('');
    onClose();
  }, [onClose]);

  /* Escape closes (designer's global key handler). */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  /* Shared auth flow: REAL login via AuthContext, then route to the role home.
     The route wrappers (LandingRoute/LoginRoute) redirect on auth state too —
     the explicit navigate just makes it deterministic. */
  const go = async (em, pw, m = 'signin') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMode(m);
    try {
      const user = await login(em.trim().toLowerCase(), pw);
      if (!standalone) onClose(); // landing: drop the modal; standalone keeps the page
      navigate(homePathFor(user.role), { replace: true });
    } catch (e) {
      if (!e.response) {
        fail('Cannot reach the server. If this is a deployed site, the backend needs to be deployed separately.');
      } else if (e.response.status === 423) {
        fail(e.response?.data?.detail || 'Too many failed attempts. Please try again in 15 minutes.');
      } else {
        fail('Wrong email or password.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleSubmit = (e) => { e.preventDefault(); go(email, password, 'signin'); };
  /* Live Demo → straight into the Chairperson group dashboard (no typing). */
  const liveDemo = () => go(DEMO_CREDS[0].email, DEMO_CREDS[0].password, 'demo');

  return (
    <div
      className={`backdrop${open ? ' open' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sign in">
        <div className="mhead">
          <div><h3>Welcome back</h3></div>
          <button type="button" className="mclose" aria-label="Close" onClick={handleClose}>✕</button>
        </div>
        <p className="msub">Sign in to your dashboard.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="aEmail">EMAIL</label>
            <input
              id="aEmail"
              ref={emailRef}
              type="email"
              placeholder="you@fetchx.in"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="aPass">PASSWORD</label>
            <input
              id="aPass"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {/* keyed remount → the designer's shake replays on every failure */}
          {err && <div className="auth-err show" role="alert" key={errSeq}>{err}</div>}
          <button className="btn btn-primary mbtn" type="submit" disabled={busy}>
            {busy && mode === 'signin'
              ? 'Signing in…'
              : <>Sign In <span aria-hidden="true">→</span></>}
          </button>
        </form>
        <button type="button" className="mdemo" onClick={liveDemo} disabled={busy}>
          {busy && mode === 'demo' ? 'Loading demo…' : 'Live demo — instant Chairperson access'}
        </button>
        <div className="demo-creds">
          {DEMO_CREDS.map((c) => (
            <button
              type="button"
              key={c.email}
              className="dc-line"
              onClick={() => { setEmail(c.email); setPassword(c.password); setErr(''); }}
            >
              <span className="dc-dot" style={{ background: c.color }} />
              <span className="dc-label">{c.label}</span>
              <code>{c.email}</code>
              <code>{c.password}</code>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Standalone /login: the same designer modal, open over a dimmed page.
   Closing it (✕ / Escape / backdrop click) returns to the landing. */
export default function Login() {
  const navigate = useNavigate();
  const handleClose = useCallback(() => navigate('/', { replace: true }), [navigate]);
  return (
    <div className="lx-root lx-standalone">
      <SignInModal open onClose={handleClose} standalone />
    </div>
  );
}
