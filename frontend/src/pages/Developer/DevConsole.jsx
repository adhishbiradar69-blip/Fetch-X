/* DevConsole — "Group Command Center" (developer.html, /group · super_admin).
   The designer page is ALL FOUR tier dashboards in ONE page, one visible at a
   time, switched from a single sidebar whose four nav groups (ADMIN · SCHOOL
   / CHAIRPERSON / PRINCIPAL · SCHOOL / CLASS TEACHER · CLASS, in that order,
   each with its tier-colored g-dot) are themselves the tier switches.

   The real role pages each own their FULL chrome (own .dsb sidebar + main +
   AI rail), so the honest adaptation is: mount each tier component wholesale
   inside the dev stage, hide each one's embedded sidebar / mobile-drawer
   chrome with rules scoped to .dev-tier (appended to v16.css), and supply
   ONE shared DashSidebar carrying all four groups:

     • group-label click → switchTier(key)      (designer .nav-glabel click)
     • link click        → switchTier(key) + a best-effort synthetic click on
       the embedded component's own (hidden) sidebar link, so the tier opens
       the matching section — designer switchTier(key, scrollTarget). If a
       future rewrite of a role page changes its labels, the drive quietly
       no-ops and the tier still switches (no props, no coupling).
     • all four tiers stay mounted — the designer renders every tier once at
       load and toggles .active; switching here only toggles display, so each
       tier's data/state persists across switches.
     • switching resets the active tier's scroll (designer mainEl.top = 0)
       and announces the tier through an aria-live note.

   Label probes (labels only — each component resolves its own context):
     /principal/dashboard → school name for "ADMIN · …" / "PRINCIPAL · …"
     /ct/me               → first class-teacher post for "CLASS TEACHER · …"
   A failed probe just drops the context segment; the group stays and the
   embedded component's own empty/error state shows (graceful degrade).

   Dev-level chrome (task 2-e): ONE PageHead above the stage — eyebrow
   "Fetch-X · Developer Console", the active tier's title/subtitle and its
   tier-* tint class (designer TIER_META). The subtitle shows LIVE group
   counts from GET /group/summary (super_admin-gated) as "OVERSIGHT ·
   N SCHOOLS · N CLASSES · N STUDENTS · N TEACHERS"; until it lands (or if
   it fails) the tier keeps its TIER_META subtitle minus the designer's
   hardcoded counts — no fake numbers. The per-tier TIER BAND headers are
   NOT duplicated here: every embedded component already renders its own
   band + pagehead inside its mounted chrome.

   Escape is left to the embedded components (modals/drawers handle it);
   sign-out goes through useAuth().logout → "/". */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashSidebar from '../Principal/dashboard/DashSidebar';
import { fetchCtMe, fetchSchoolOverview } from '../Principal/dashboard/data';
import { PageHead } from '../../components/v16/Shell';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api/client';
import AdminConsole from '../Admin/AdminConsole';
import ChairpersonDashboard from '../Chairperson/ChairpersonDashboard';
import PrincipalDashboard from '../Principal/Dashboard';
import CTConsole from '../Teacher/CTConsole';
import '../Principal/dashboard/v16.css';

/* designer developer.html: tier order, dot colors, default section and the
   link stack per group (dashes: label texts match the embedded sidebars so
   the link-drive can find them). `sub` is the pagehead fallback subtitle
   (designer TIER_META.sub, with its hardcoded counts/campus names dropped
   — the live counts come from /group/summary). */
const TIERS = [
  {
    key: 'ad', dot: '#c2255c', base: 'ADMIN', title: 'Admin Dashboard',
    sub: 'Admin · Data management — students, staff, and classes',
    links: [
      ['adDash', 'Admin Dashboard', 1],
      ['adClasses', 'Classes', 3],
      ['adStaff', 'Staff List', 6],
      ['adStudents', 'All Students', 4],
    ],
  },
  {
    key: 'cp', dot: '#4f42dd', base: 'CHAIRPERSON', title: 'Chairperson Dashboard',
    sub: 'Chairperson · Group-wide academic intelligence across every school',
    links: [
      ['cpGroup', 'Group Level', 1],
      ['cpSchools', 'Schools Level', 2],
      ['cpGrades', 'Grades Level', 3],
      ['cpStudents', 'Students Level', 4],
      ['cpTeachers', 'Teachers Level', 6],
    ],
  },
  {
    key: 'pr', dot: '#0e7490', base: 'PRINCIPAL', title: 'Principal Dashboard',
    sub: 'Principal · School-wide academic intelligence',
    links: [
      ['schoolSec', 'School Level', 1],
      ['subjectSec', 'Subject Level', 2],
      ['classSec', 'Class Level', 3],
      ['studentSec', 'Students Level', 4],
      ['teacherSec', 'Teachers Level', 6],
    ],
  },
  {
    key: 'ct', dot: '#b45f04', base: 'CLASS TEACHER', title: 'Class Teacher Dashboard',
    sub: 'Class Teacher · Classroom intelligence',
    links: [
      ['ctHome', 'My Class', 3],
      ['ctAtt', 'Attendance', 2],
      ['ctTask', 'Task Completion', 2],
      ['ctMarks', 'Academic Marks', 3],
      ['ctTeach', 'Teaching Classes', 2],
      ['ctMy', 'My Report', 6],
      ['ctTT', 'Timetable', 2],
    ],
  },
];

const tierMeta = (key) => TIERS.find((t) => t.key === key) || null;
const schoolLabel = (base, school) => (school?.name ? `${base} · ${String(school.name).toUpperCase()}` : base);

export default function DevConsole() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  /* designer: curTier = 'ad' — the ADMIN group leads, active link = its
     default section */
  const [tier, setTier] = useState('ad');
  const [activeLink, setActiveLink] = useState('adDash');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [school, setSchool] = useState(null);   // super_admin's first school
  const [ctClass, setCtClass] = useState(null); // super_admin's first CT post
  const [summary, setSummary] = useState(null); // /group/summary live counts
  const stageRef = useRef(null);
  const wrapRefs = useRef({});                  // tier key → wrapper element

  /* light probes for the sidebar labels; failures keep the plain label */
  useEffect(() => {
    let alive = true;
    fetchSchoolOverview()
      .then((ov) => { if (alive) setSchool(ov?.school || null); })
      .catch(() => { /* label falls back to the plain tier name */ });
    fetchCtMe()
      .then((me) => { if (alive) setCtClass(me?.class?.name || null); })
      .catch(() => { /* no CT capacity — component shows its own state */ });
    return () => { alive = false; };
  }, []);

  /* dev pagehead live counts (task 2-e): until /group/summary lands (or if
     it fails) the subtitle stays the tier's own TIER_META copy — honest. */
  useEffect(() => {
    let alive = true;
    api.get('/group/summary')
      .then((r) => { if (alive) setSummary(r.data || null); })
      .catch(() => { /* subtitle falls back to the tier's own copy */ });
    return () => { alive = false; };
  }, []);

  /* designer switchTier: show the tier, highlight its group + default link.
     Scroll reset happens in the effect below, after the tier is displayed. */
  const switchTier = useCallback((key, linkKey) => {
    const meta = tierMeta(key);
    if (!meta) return;
    setTier(key);
    setActiveLink(linkKey || meta.links[0][0]);
  }, []);

  /* the active tier's own .v15-main is the scroll container — reset it on
     every switch (designer: mainEl.scrollTop = 0) */
  useEffect(() => {
    stageRef.current?.querySelector('.dev-tier-on .v15-main')?.scrollTo({ top: 0 });
  }, [tier]);

  /* link clicks also drive the embedded component's own sidebar (it stays
     mounted, just hidden) so the tier lands on the matching section. Best
     effort: matched by data-tip label; no match → plain tier switch. */
  const driveTier = (key, linkKey) => {
    const meta = tierMeta(key);
    const label = meta?.links.find(([k]) => k === linkKey)?.[1];
    const wrap = wrapRefs.current[key];
    if (!wrap || !label) return;
    const btn = Array.from(wrap.querySelectorAll('.dsb-nav button'))
      .find((b) => b.dataset.tip === label);
    if (btn) btn.click();
  };

  const onGroupClick = (key) => switchTier(key);
  const onGo = (linkKey) => {
    const meta = TIERS.find((t) => t.links.some(([k]) => k === linkKey));
    if (!meta) return;
    switchTier(meta.key, linkKey);
    driveTier(meta.key, linkKey);
  };

  /* pagehead (designer TIER_META): title + tier-* tint class swap per tier;
     the subtitle prefers the live OVERSIGHT line, then the tier's own copy
     (ct names the real CT post when the probe found one). */
  const meta = tierMeta(tier);
  const oversight = summary
    ? `OVERSIGHT · ${summary.schools} SCHOOLS · ${summary.classes} CLASSES · ${summary.students} STUDENTS · ${summary.teachers} TEACHERS`
    : null;
  const sub = oversight
    || (tier === 'ct' && ctClass ? `${meta.sub} for ${ctClass}` : meta.sub);

  /* designer group labels: "ADMIN · MAILLOOR" / "CHAIRPERSON" /
     "PRINCIPAL · MAILLOOR" / "CLASS TEACHER · 10-EMERALD" — here with the
     real signed-in context (full school name, uppercased) */
  const groups = TIERS.map((t) => ({
    key: t.key,
    dot: t.dot,
    label: t.key === 'ad' || t.key === 'pr'
      ? schoolLabel(t.base, school)
      : t.key === 'ct'
        ? (ctClass ? `${t.base} · ${String(ctClass).toUpperCase()}` : t.base)
        : t.base,
    links: t.links.map(([key, label, lvl]) => ({ key, label, lvl })),
  }));

  return (
    <div className={`pd-root v15-root dev-root${navCollapsed ? ' nav-collapsed' : ''}`}>
      <DashSidebar
        logo
        roleLabel="DEVELOPER"
        savedCount={0}
        savedHidden
        active={activeLink}
        activeGroup={tier}
        onGo={onGo}
        onToggle={() => setNavCollapsed((c) => !c)}
        onSignOut={() => { logout(); navigate('/'); }}
        groups={groups}
        onGroupClick={onGroupClick}
      />

      <div className="dev-stage" ref={stageRef}>
        <PageHead
          tier={tier}
          eyebrow="Fetch-X · Developer Console"
          title={meta.title}
          subtitle={sub}
        />

        <p className="sr-only" aria-live="polite">
          {`${meta.title} shown — switch tiers from the sidebar group labels`}
        </p>

        {TIERS.map((t) => (
          <div
            key={t.key}
            ref={(el) => { wrapRefs.current[t.key] = el; }}
            className={`dev-tier dev-tier-${t.key}${tier === t.key ? ' dev-tier-on' : ''}`}
            aria-hidden={tier !== t.key}
          >
            {t.key === 'ad' && <AdminConsole />}
            {t.key === 'cp' && <ChairpersonDashboard />}
            {t.key === 'pr' && <PrincipalDashboard />}
            {t.key === 'ct' && <CTConsole />}
          </div>
        ))}
      </div>
    </div>
  );
}
