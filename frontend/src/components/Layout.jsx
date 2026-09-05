import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, CheckSquare, PenLine, BarChart3, Building2, GraduationCap,
  KeyRound, Briefcase, Target, Users, ChevronRight, LogOut, GitCompare, Award,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { EASE } from '../lib/motion.jsx';
import ThemeSelector from './ThemeSelector.jsx';
import ShortcutsOverlay from './ShortcutsOverlay.jsx';
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

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const userRole = user?.role || 'class_teacher';
  const visibleGroups = allNavGroups.filter(g => g.roles.includes(userRole));

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <div className={`app-layout ${collapsed ? 'sidebar-collapsed' : ''}`}>
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

        <nav className="sb-nav">
          {visibleGroups.map((group) => {
            const color = GROUP_COLOR[group.label] || '#4f42dd';
            return (
              <div key={group.label} className="nav-group">
                {!collapsed && <div className="nav-group-label">{group.label}</div>}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path}
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
          })}
        </nav>

        <div className="sidebar-footer">
          {!collapsed && (
            <div className="footer-user">
              <p className="footer-label">Signed in as</p>
              <p className="footer-email">{user?.full_name || user?.email || 'User'}</p>
              <p className="footer-role">{roleLabel[userRole] || userRole}</p>
            </div>
          )}
          <div className="footer-actions">
            <ThemeSelector />
            <button onClick={handleLogout} className="btn-sign-out" title="Sign Out">
              <LogOut size={15} strokeWidth={2.2} />
              {!collapsed && <span>Sign Out</span>}
            </button>
          </div>
        </div>
      </motion.aside>

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
    </div>
  );
}