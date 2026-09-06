/* AdminShell — wraps the admin management pages (Dashboard / Students /
   Accounts / Subject Teachers) in the SAME v15 chrome as the principal
   dashboard, so the sidebar never switches identity mid-navigation (the
   old two-chrome glitch). Principal-level links jump back to the v15
   dashboard; the ADMINISTRATION group highlights the current page. */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import DashSidebar from '../pages/Principal/dashboard/DashSidebar';
import { LevelThemeStyle } from '../pages/Principal/dashboard/LevelThemes';
import { fetchCtMe } from '../pages/Principal/dashboard/data';
import '../pages/Principal/dashboard/dashboard.css';
import '../pages/Principal/dashboard/v15.css';

export default function AdminShell({ adminKey, children }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });
  const [mobNav, setMobNav] = useState(false);
  const [ctMe, setCtMe] = useState(null);

  useEffect(() => {
    try { localStorage.setItem('si-nav', navCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [navCollapsed]);

  /* same CT-capacity probe as the v15 shell, so accounts that hold a
     class-teacher post still see the CT group from the admin pages */
  useEffect(() => {
    let alive = true;
    fetchCtMe().then((me) => { if (alive) setCtMe(me); })
      .catch(() => { if (alive) setCtMe(false); });
    return () => { alive = false; };
  }, []);

  const signOut = () => { logout(); navigate('/'); };
  const navGo = (key) => {
    setMobNav(false);
    if (key.startsWith('ct')) { navigate('/teacher/console'); return; }
    navigate('/principal/dashboard'); // level sections live in the v15 shell
  };

  return (
    <div className={`pd-root v15-root admin-root${navCollapsed ? ' nav-collapsed' : ''}${mobNav ? ' mob-nav' : ''}`}>
      <LevelThemeStyle />
      <DashSidebar
        active="__admin"
        onGo={navGo}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((c) => !c)}
        savedCount={0}
        userName={user?.full_name}
        onSignOut={signOut}
        mode="p"
        ctGroup={ctMe ? { label: (ctMe.class?.name || '').toUpperCase(), active: null } : null}
        adminGroup
        adminActive={adminKey}
        savedHidden
      />
      <main className="v15-main pd-main">{children}</main>
      <button type="button" className="v15-mobtoggle" aria-label="Open navigation" onClick={() => setMobNav(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      {mobNav && <div className="v15-mobbackdrop" onClick={() => setMobNav(false)} role="presentation" />}
    </div>
  );
}
