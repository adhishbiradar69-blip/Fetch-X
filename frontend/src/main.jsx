import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import './index.css'
import './motion.css'
import App from './App.jsx'
import PreferencesProvider, { usePrefs } from './components/ThemeProvider.jsx'

// MotionConfig honours the user's Motion & animation setting (Profile →
// Settings) AND the OS-level prefers-reduced-motion flag on every page —
// previously only the Landing page respected reduced motion.
function MotionGate({ children }) {
  const { prefs } = usePrefs() || { prefs: { motion: 'full' } };
  const reducedMotion =
    prefs.motion === 'off' ? 'always' :
    prefs.motion === 'reduced' ? 'always' : 'user';
  return <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>;
}

// PreferencesProvider wraps the entire app (OUTSIDE BrowserRouter) so theme
// CSS variables + comfort prefs apply to <html> on every route — including
// public pages that don't go through the auth-protected Layout.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PreferencesProvider>
      <MotionGate>
        <App />
      </MotionGate>
    </PreferencesProvider>
  </StrictMode>,
)
