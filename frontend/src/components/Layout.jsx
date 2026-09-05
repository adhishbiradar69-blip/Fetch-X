import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, CheckSquare, PenLine, BarChart3, Building2, GraduationCap,
  KeyRound, Briefcase, Target, Users, ChevronRight, LogOut, GitCompare, Award,
  Menu, X, Settings2,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { EASE } from '../lib/motion.jsx';
import ThemeSelector from './ThemeSelector.jsx';
import ShortcutsOverlay from './ShortcutsOverlay.jsx';
import SettingsModal from './SettingsModal.jsx';
import { usePrefs } from './ThemeProvider.jsx';
import { Logo } from './Logo.jsx';

const A = ['super_admin', 'school_admin', 'admin'];
const allNavGroups = [
  {
    label: 'Class Teacher',
    roles: ['class_teacher', ...A],
    items: [
      { path: '/teacher/attendance', label: 'Attendance', icon: ClipboardList },
      { path: '/teacher/tasks', label: 'Tasks', icon: CheckSquare },
      { path: '/teacher/marks', label: 'Marks', icon: PenLine },
      { path: '/class-teacher/report', label: 'Class Report', icon: BarChart3 },
    ]
  },
  {
    label: 'Administration',
    roles: A,
    items: [
      { path: '/admin/dashboard', label: 'Dashboard', icon: Building2 },
      { path: '/admin/students', label: 'Students', icon: GraduationCap },
      { path: '/admin/accounts', label: 'Accounts', icon: KeyRound },
    ]
  },
  {
    label: 'Principal',
    roles: ['principal', ...A],
    items: [
      { path: '/principal/dashboard', label: 'Dashboard', icon: Briefcase },
      /* v5 consolidation: students/grades/subjects/at-risk/attendance/compare
         pages were folded INTO the dashboard (sections + modals). */
    ]
  },
  {
    label: 'Chairperson',
    roles: ['chairperson', ...A],
    items: [
      { path: '/chairperson/dashboard', label: 'Dashboard', icon: Target },
      { path: '/chairperson/rankings', label: 'Rankings', icon: Award },
      { path: '/chairperson/compare', label: 'Compare', icon: GitCompare },
    ]
  },
  {
    label: 'Parents',
    roles: ['parent', ...A],
    items: [
      { path: '/parent/view', label: 'My Child', icon: Users },
    ]
  },
];

/* Per-group accent colors (designer's level palette):
   Administration = lvl-1 indigo, Class Teacher = lvl-3 amber,
   Principal = lvl-2 teal, Chairperson = lvl-4 pink, Parents = lvl-5 cyan. */
const GROUP_COLOR = {
  'Administration': '#4f42dd',
  'Class Teacher': '#b45f04',
  'Principal': '#0c7a6b',
  'Chairperson': '#c2255c',
  'Parents': '#0e7490',
};

const roleLabel = { super_admin: 'Super Admin', school_admin: 'School Admin', admin: 'Administrator',
                   principal: 'Principal', chairperson: 'Chairperson',
                   class_teacher: 'Class Teacher', parent: 'Parent' };

/* Shared nav renderer — desktop sidebar and the mobile drawer use the exact
   same markup/classes so the look is identical on every screen size. */
function NavItems({ groups, collapsed, onNavigate }) {
  return groups.map((group) => {
    const color = GROUP_COLOR[group.label] || '#4f42dd';
    return (
      <div key={group.label} className="nav-group">
        {!collapsed && <div className="nav-group-label">{group.label}</div>}
        {group.items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.path} to={item.path}
              onClick={onNavigate}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              style={{ '--nc': color }}
              data-tip={item.label}
              title={collapsed ? '' : undefined}
            >
              <span className="nav-icon"><Icon strokeWidth={2} /></span>
              {!collapsed && <span className="nav-text">{item.label}</span>}
            </NavLink>
          );
        })}
      </div>
    );
  });
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const prefsApi = usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => !!prefsApi?.prefs?.sidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const userRole = user?.role || 'class_teacher';
  const visibleGroups = allNavGroups.filter(g => g.roles.includes(userRole));

  // Remember the sidebar default between visits (user preference).
  useEffect(() => {
    prefsApi?.setPref?.('sidebarCollapsed', collapsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Keep the ACTIVE nav link visible: on short viewports the sidebar nav
  // scrolls internally (.sb-nav has overflow-y:auto), and without this the
  // current section can sit clipped below the fold with no obvious
  // affordance — it just looks like the menu ends there.
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector('.nav-link.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    else nav.scrollTop = 0;
  }, [location.pathname, collapsed]);

  // Escape closes the drawer; scroll-lock the page behind it.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const handleLogout = () => { logout(); navigate('/'); };

  const sidebarCollapsed = collapsed;

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Mobile top bar — the only navigation surface on phones (≤860px). */}
      <div className="mobile-topbar">
        <button className="mobile-menu-btn" onClick={() => setDrawerOpen(true)}
                aria-label="Open navigation menu" aria-expanded={drawerOpen} aria-controls="fx-mobile-drawer">
          <Menu size={20} strokeWidth={2.2} />
        </button>
        <div className="mobile-topbar-brand"><Logo size={18} /><span>FETCH-X</span></div>
        <ThemeSelector compact />
      </div>

      <motion.aside
        className="sidebar"
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="sb-brand">
          <Logo size={22} />
          <span className="brand-name">FETCH-X</span>
          <button
            className="chev"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle sidebar"
          >
            <ChevronRight size={14} strokeWidth={2.4} />
          </button>
        </div>

        <nav className="sb-nav" ref={navRef} aria-label="Primary navigation">
          <NavItems groups={visibleGroups} collapsed={collapsed} />
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <button type="button" className="footer-user footer-user-btn" onClick={() => setSettingsOpen(true)}
                    title="Profile & settings" aria-label="Open profile settings">
              <p className="footer-label">Signed in as</p>
              <p className="footer-email">{user?.full_name || user?.email || 'User'}</p>
              <p className="footer-role">{roleLabel[userRole] || userRole}</p>
              <span className="footer-user-gear"><Settings2 size={12} strokeWidth={2.2} /> Profile &amp; Settings</span>
            </button>
          )}
          <div className="footer-actions">
            {!collapsed && (
              <button onClick={() => setSettingsOpen(true)} className="btn-sign-out" title="Profile & Settings"
                      aria-label="Open profile settings">
                <Settings2 size={15} strokeWidth={2.2} />
                <span>Settings</span>
              </button>
            )}
            <ThemeSelector />
            <button onClick={handleLogout} className="btn-sign-out" title="Sign Out">
              <LogOut size={15} strokeWidth={2.2} />
              {!collapsed && <span>Sign Out</span>}
            </button>
          </div>
        </div>
      </motion.aside>

      {/* Mobile drawer (off-canvas sidebar) */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div key="drawer-bg" className="mobile-drawer-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawerOpen(false)} aria-hidden="true" />
            <motion.div key="drawer" id="fx-mobile-drawer" className="mobile-drawer"
              role="dialog" aria-modal="true" aria-label="Navigation"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            >
              <div className="sb-brand">
                <Logo size={22} />
                <span className="brand-name">FETCH-X</span>
                <button className="chev" onClick={() => setDrawerOpen(false)}
                        aria-label="Close navigation menu">
                  <X size={15} strokeWidth={2.4} />
                </button>
              </div>
              <nav className="sb-nav">
                <NavItems groups={visibleGroups} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <div className="sidebar-footer">
                <button type="button" className="footer-user footer-user-btn" onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }}>
                  <p className="footer-label">Signed in as</p>
                  <p className="footer-email">{user?.full_name || user?.email || 'User'}</p>
                  <p className="footer-role">{roleLabel[userRole] || userRole}</p>
                  <span className="footer-user-gear"><Settings2 size={12} strokeWidth={2.2} /> Profile &amp; Settings</span>
                </button>
                <div className="footer-actions">
                  <button onClick={() => { setDrawerOpen(false); setSettingsOpen(true); }} className="btn-sign-out">
                    <Settings2 size={15} strokeWidth={2.2} /><span>Settings</span>
                  </button>
                  <button onClick={handleLogout} className="btn-sign-out" title="Sign Out">
                    <LogOut size={15} strokeWidth={2.2} /><span>Sign Out</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="main-area">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} className="page-host"
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.38, ease: EASE }}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <ShortcutsOverlay />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
