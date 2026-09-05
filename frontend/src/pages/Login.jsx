import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth, homePathFor } from '../auth/AuthContext';
import { EASE, SPRING } from '../lib/motion.jsx';
import { Logo } from '../components/Logo.jsx';

const field = (delay) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: EASE, delay },
});

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!agreed) { setError('You must agree to the Terms and Conditions to continue.'); return; }
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      navigate(homePathFor(user.role), { replace: true });
    } catch (err) {
      if (!err.response) {
        // Network error — backend unreachable
        setError('Cannot reach the server. If this is a deployed site, the backend needs to be deployed separately. See the README for instructions.');
      } else if (err.response?.status === 423) {
        // Account lockout — the backend returns its own explanatory detail.
        setError(err.response?.data?.detail || 'Too many failed attempts. Please try again in 15 minutes.');
      } else {
        setError('Invalid email or password');
      }
    }
    setLoading(false);
  };

  return (
    <div className="login-shell">
      <motion.div className="login-card-wrap"
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}>
        <div className="login-card">
          {/* Logo mark with a static glow halo (the 3s infinite pulse was
              decorative — removed; a calm halo reads the same at rest). */}
          <motion.div className="login-logo"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ ...SPRING, delay: 0.1 }}>
            <span className="login-logo-glow" />
            <Logo size={54} />
          </motion.div>

          <motion.h1 className="login-title" {...field(0.08)}>Fetch-X Portal</motion.h1>
          <motion.p className="login-sub" {...field(0.12)}>Authorized personnel only</motion.p>

          {error && (
            <motion.div className="login-error"
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              transition={{ duration: 0.3, ease: EASE }}>
              <AlertCircle size={16} strokeWidth={2.4} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Stagger capped at ≤0.2s total — the submit button used to be
                invisible until ~1s after mount (A15). */}
            <motion.div className="login-field field" {...field(0.14)}>
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" placeholder="you@school.edu" value={email}
                onChange={(e) => setEmail(e.target.value)} className="input" autoComplete="username" required />
            </motion.div>
            <motion.div className="login-field field" {...field(0.17)}>
              <label htmlFor="login-password">Password</label>
              <input id="login-password" type="password" placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} className="input" autoComplete="current-password" required />
            </motion.div>

            <motion.div className="login-terms" {...field(0.20)}>
              <input type="checkbox" id="terms" checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)} />
              <label htmlFor="terms">
                I agree to the <Link to="/terms">Terms of Service</Link> and <Link to="/privacy">Privacy Policy</Link>.
                I understand this system contains confidential student data.
              </label>
            </motion.div>

            <motion.button type="submit" className="btn btn-primary login-submit"
              disabled={loading} {...field(0.23)}
              whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              {loading ? (
                <>
                  <motion.span className="spin-icon" animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    style={{ display: 'inline-flex' }}>
                    <Loader2 size={16} />
                  </motion.span>
                  Authenticating...
                </>
              ) : 'Sign In'}
            </motion.button>
          </form>
        </div>

        <motion.p className="login-footer" {...field(0.3)}>
          <Link to="/" className="login-footer-back"><ArrowLeft size={13} /> Back to site</Link>
          <span>Fetch-X Data Intelligence Platform · v1.1</span>
        </motion.p>
      </motion.div>
    </div>
  );
}
