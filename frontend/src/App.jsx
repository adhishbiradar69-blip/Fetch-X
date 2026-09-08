import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, homePathFor } from './auth/AuthContext';
import Layout from './components/Layout';
import AdminShell from './components/AdminShell';
import { ErrorBoundary } from "./components/ErrorBoundary";
import Public16Shell from './pages/public/Public16Shell';
import Login from './pages/Login';
import Landing from './pages/public/Landing';
import About from './pages/public/About';
import Terms from './pages/public/Terms';
import Privacy from './pages/public/Privacy';
import CTConsole from './pages/Teacher/CTConsole';
import AccountCreation from './pages/Admin/Accounts';
import ExtraTeachers from './pages/Admin/ExtraTeachers';
import AdminConsole from './pages/Admin/AdminConsole';
import PrincipalDashboard from './pages/Principal/Dashboard';
import ChairpersonDashboard from './pages/Chairperson/ChairpersonDashboard';
import DevConsole from './pages/Developer/DevConsole';
import ParentChildView from './pages/Parent/ChildView';

const A = ['super_admin', 'school_admin', 'admin']; // admin roles

function ProtectedRoute({ children, roles, bare = false }) {
  const { user, token } = useAuth();
  const location = useLocation();
  // Signed out (or session expired) → the PUBLIC LANDING, matching the
  // designer flow (sign-out → index). /login is still reachable by URL,
  // but stranding users there after a sign-out lost them the landing page.
  // (location.state.from was never consumed — dropped.)
  if (!token) return <Navigate to="/" replace state={{ from: location }} />;
  // Token present but user object missing/corrupted → re-auth cleanly
  // instead of rendering pages with the wrong role chrome.
  if (!user) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }
  // v15: the dashboard + CT console own their full chrome (sidebar included),
  // so they render WITHOUT the app Layout shell.
  if (bare) return children;
  return <Layout>{children}</Layout>;
}

/* Landing route: shows Landing if NOT logged in, otherwise redirects to the
   user's role-based home. v16: the designer landing (upload/index(2).html) is
   a STANDALONE page — it owns its own fixed pill nav + footer and its own
   in-page scroll-spy — so it renders WITHOUT the PublicLayout shell, whose
   chrome would duplicate the designer nav/footer. */
function LandingRoute() {
  const { user, token } = useAuth();
  if (token && user) return <Navigate to={homePathFor(user.role)} replace />;
  return <Landing />;
}

/* Generic public-page wrapper — v16 shell (same design language as the
   landing), never blocks on auth. */
function PublicPage({ children }) {
  return <Public16Shell>{children}</Public16Shell>;
}

/* Login route: if already authenticated, send to role home. */
function LoginRoute() {
  const { user, token } = useAuth();
  if (token && user) return <Navigate to={homePathFor(user.role)} replace />;
  return <Login />;
}

/* v15 consolidation: the old teacher boards are GONE. Every legacy
   /teacher/* and /class-teacher/report URL redirects to the signed-in
   user's role home — the class-teacher console (and the v15 shell's CT
   mode for admins) covers all of it. The old chrome used to render here
   and dead-end with "No Class Assigned" for accounts without a class. */
function RoleHomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user?.role)} replace />;
}

function AnimatedRoutes() {
  const location = useLocation();
  // PERF/UX fix: the old code gated EVERY navigation behind an artificial
  // 600ms full-screen loader AND remounted the whole app shell (sidebar
  // included) per route via <AnimatePresence mode="wait"> around <Routes>.
  // Real per-page skeletons already handle loading feedback, and Layout's
  // own page-host transition is the genuine route fade — so navigation is
  // now instant with the same visual polish.
  return (
    <Routes location={location}>
      {/* Public pages — no auth required */}
      <Route path="/" element={<LandingRoute />} />
      <Route path="/about" element={<PublicPage><About /></PublicPage>} />
      <Route path="/terms" element={<PublicPage><Terms /></PublicPage>} />
      <Route path="/privacy" element={<PublicPage><Privacy /></PublicPage>} />
      <Route path="/login" element={<LoginRoute />} />

      {/* v15 full-page consoles (own chrome — no Layout shell) */}
      <Route path="/principal/dashboard" element={
        <ProtectedRoute bare roles={['principal', 'vice_principal', ...A]}><PrincipalDashboard /></ProtectedRoute>} />
      <Route path="/teacher/console" element={
        <ProtectedRoute bare roles={['class_teacher', ...A]}><CTConsole /></ProtectedRoute>} />
      {/* legacy teacher URLs — always forward to the role home */}
      <Route path="/teacher/attendance" element={<RoleHomeRedirect />} />
      <Route path="/teacher/tasks" element={<RoleHomeRedirect />} />
      <Route path="/teacher/marks" element={<RoleHomeRedirect />} />
      <Route path="/class-teacher/report" element={<RoleHomeRedirect />} />

      {/* Protected app pages — v15 chrome + role required */}
      {/* v16: the admin rebuild owns its full chrome (sidebar included) */}
      <Route path="/admin/dashboard" element={
        <ProtectedRoute bare roles={A}><AdminConsole /></ProtectedRoute>} />
      {/* legacy admin URLs — the v16 console absorbs students; accounts and
          extra-teachers stay reachable for power users */}
      <Route path="/admin/students" element={<RoleHomeRedirect />} />
      <Route path="/admin/accounts" element={
        <ProtectedRoute bare roles={A}>
          <AdminShell adminKey="adminAccounts"><AccountCreation /></AdminShell>
        </ProtectedRoute>} />
      <Route path="/admin/extra-teachers" element={
        <ProtectedRoute bare roles={A}>
          <AdminShell adminKey="adminExtra"><ExtraTeachers /></AdminShell>
        </ProtectedRoute>} />
      {/* v5 consolidation: the designer's principal section is ONE page —
          every former sub-page lives inside the dashboard (sections +
          modals). Old URLs land on the dashboard. */}
      <Route path="/principal/students" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/principal/grades" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/principal/subjects" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/principal/at-risk" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/principal/attendance" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/principal/compare" element={<Navigate to="/principal/dashboard" replace />} />
      <Route path="/chairperson/dashboard" element={
        <ProtectedRoute bare roles={['chairperson', ...A]}><ChairpersonDashboard /></ProtectedRoute>} />
      {/* v16: the old recharts pages redirect into the rebuilt CP tier */}
      <Route path="/chairperson/rankings" element={<RoleHomeRedirect />} />
      <Route path="/chairperson/compare" element={<RoleHomeRedirect />} />
      {/* v16 developer build: all four tiers in one shell */}
      <Route path="/group" element={
        <ProtectedRoute bare roles={['super_admin']}><DevConsole /></ProtectedRoute>} />
      <Route path="/parent/view" element={
        <ProtectedRoute roles={['parent', ...A]}><ParentChildView /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary><AnimatedRoutes /></ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
