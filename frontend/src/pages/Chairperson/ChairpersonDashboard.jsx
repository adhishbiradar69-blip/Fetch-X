/* Fetch-X — Chairperson Dashboard (designer v16, Task 3-a).
   Full port of chairperson.html with REAL /chairperson/v16 data:

   • shell        — DashSidebar (v16 groups API, CHAIRPERSON group, lvl 1/2/3/4/6
                    links scroll to the level sections), PageHead tier="cp",
                    TIER 01 · GROUP band fused to the five .lvl sections
   • 01 GROUP     — group donut + term averages, group stats, score
                    distribution, attendance trend (30D/3M/6M/1Y tabs) and the
                    BRANCH COMPARISON .cp-mgrid (one --sc column per school)
   • 02 SCHOOLS   — .school-card grid (principal pill, org rank, term chips,
                    composite donut, trend) → SCHOOL REPORT modal
   • 03 GRADES    — .cp-gcols rows per school/grade → GRADE REPORT modal
   • 04 STUDENTS  — rank-band tabs + search + org-stu rows, server-side
                    pagination + infinite scroll (sentinel in .st-scroll)
   • 05 TEACHERS  — rank-band tabs + search + org-tch rows → teacher report
   • modals       — school / grade reports are CP-local (cp16/modals.jsx);
                    student / teacher reports reuse the Principal
                    ReportCardModal / TeacherReportModal; the designer's
                    COMPARE + ACADEMIC PERFORMANCE pagehead actions get CP
                    equivalents (schools+grades compare / group radar).
   Every number comes from the API; class names + copy come from the
   designer file (school names from the seed, never GNPS placeholders). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, CalendarCheck2, ClipboardCheck, Menu, Moon, School, Search, Sun, Trophy, Users, X,
} from 'lucide-react';
import { Donut, Trend, useInView, useReveal } from '../Principal/dashboard/charts';
import { SectionHead, Chip, RankTabs } from '../Principal/dashboard/Sections';
import { loadFolders, pct, saveFolders } from '../Principal/dashboard/util';
import ReportCardModal from '../Principal/dashboard/ReportCardModal';
import TeacherReportModal from '../Principal/dashboard/TeacherReportModal';
import SavedStudents from '../Principal/dashboard/SavedStudents';
import { PageHead, Tier, TierBand } from '../../components/v16/Shell';
import { TIER_ICONS } from '../../components/v16/icons';
import ExportCsvButton from '../../components/v16/ExportCsvButton';
import EmptyState from '../../components/v16/EmptyState';
import DashSidebar from '../Principal/dashboard/DashSidebar';
import { Toast } from '../../components/ui';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth } from '../../auth/AuthContext';
import { csvStamp, fetchAllPages } from '../../lib/csv';
import {
  compositeOverall, distroTotal, fetchCpBundle, fetchCpStudents, fetchCpTeachers, num, PERSON_SVG, rgbaSoft,
} from './cp16/data';
import {
  AttCard, BmPopover, CpdSkel, CpdSkelRows, CpStatCell, DistroCard, OrgStudentRow, OrgTeacherRow,
} from './cp16/bits';
import { CpAperfModal, CpCompareModal, CpGradeModal, CpSchoolModal } from './cp16/modals';
import '../Principal/dashboard/v16.css';

const PAGE_SIZE = 50;

/* sidebar nav key → section id (designer data-go) */
const SECTIONS = {
  cpGroup: 'cpGroupSec',
  cpSchools: 'cpSchoolsSec',
  cpGrades: 'cpGradesSec',
  cpStudents: 'cpStudentsSec',
  cpTeachers: 'cpTeachersSec',
};
const SPY_IDS = Object.values(SECTIONS);

/* designer sidebar svgs (Group/Schools/Grades/Students/Teachers) */
const NAV_ICONS = {
  cpGroup: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l-1-9 5.5 4L12 5l4.5 7L22 8l-1 9H3z" /><path d="M5 20.5h14" /></svg>
  ),
  cpSchools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M3 10l9-6.5L21 10z" /></svg>
  ),
  cpGrades: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
  ),
  cpStudents: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M15.5 3.13a4 4 0 0 1 0 7.75" /></svg>
  ),
  cpTeachers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" /><path d="M6.5 10v4.7c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6V10" /><path d="M21 8v6" /></svg>
  ),
};

/* branch comparison rows (designer BRANCH_METRICS; OVERALL = the composite) */
const branchRows = (S) => {
  const overall = compositeOverall(S.marks, S.tasks, S.attendance);
  return [
    ['OVERALL', overall],
    ['MARKS', pct(S.marks)],
    ['ATTENDANCE', pct(S.attendance)],
    ['TASKS', pct(S.tasks)],
  ];
};

export default function ChairpersonDashboard() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { mode, toggle } = useTheme() || {};

  /* view: dash | saved (designer savedLink) — declared before the callbacks
     that switch it (react-hooks ordering) */
  const [view, setView] = useState('dash');

  /* ---------------- bundle (one-shot v16 payload) ---------------- */
  const [bundle, setBundle] = useState(null);
  const [bundleErr, setBundleErr] = useState(false);
  const [booting, setBooting] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, type = 'error') => setToast({ message, type }), []);

  const loadBundle = useCallback(() => {
    let alive = true;
    fetchCpBundle()
      .then((d) => { if (alive) { setBundle(d); setBundleErr(false); setBooting(false); } })
      .catch(() => {
        if (alive) {
          setBundleErr(true);
          setBooting(false);
          showToast('The group bundle is unavailable — the backend may still be starting', 'error');
        }
      });
    return () => { alive = false; };
  }, [showToast]);

  useEffect(() => loadBundle(), [loadBundle]);

  /* ---------------- derived counts ---------------- */
  const schools = bundle?.schools || [];
  const group = bundle?.group || null;
  const nSchools = schools.length;
  /* classes = sections summed across every grade of every school
     (designer: 10 grades × 3 sections per school) */
  const nClasses = useMemo(
    () => schools.reduce((n, S) => n + (S.grades || []).reduce((m, g) => m + (g.sections?.length || 0), 0), 0),
    [schools],
  );
  const nStudents = group?.students ?? 0;
  const colorOf = useCallback((name) => {
    const S = schools.find((x) => x.name === name);
    return S ? { color: S.color, soft: rgbaSoft(S.color) } : null;
  }, [schools]);

  /* ---------------- shell state ---------------- */
  const mainRef = useRef(null);
  const gsRef = useRef(null);
  const [mobNav, setMobNav] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('si-nav', navCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [navCollapsed]);
  const [navActive, setNavActive] = useState('cpGroup');

  /* scroll spy (designer updateActiveNav) */
  useEffect(() => {
    const el = mainRef.current;
    if (!el || !bundle) return undefined;
    const onScroll = () => {
      const mt = el.getBoundingClientRect().top;
      let cur = null;
      SPY_IDS.forEach((id) => {
        const sec = document.getElementById(id);
        if (sec && sec.getBoundingClientRect().top - mt <= 160) cur = id;
      });
      const key = Object.keys(SECTIONS).find((k) => SECTIONS[k] === cur);
      if (key) setNavActive((p) => (p === key ? p : key));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [bundle]);

  const scrollToSection = useCallback((id) => {
    setView('dash');
    /* double rAF — the designer's own pattern: waits out the view switch so
       the section exists before scrollIntoView */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else mainRef.current?.scrollTo({ top: 0 });
    }));
  }, []);

  /* ---------------- folders (designer bmPop) ---------------- */
  const [folders, setFolders] = useState(loadFolders);
  const savedIds = useMemo(() => new Set(folders.flatMap((f) => f.studentIds)), [folders]);
  useEffect(() => { saveFolders(folders); }, [folders]);
  const [bmPop, setBmPop] = useState(null); // { student, left, top }
  const [bmName, setBmName] = useState('');

  const onBookmark = useCallback((e, student) => {
    if (!student?.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 230;
    const left = Math.min(Math.max(10, rect.left - 90), window.innerWidth - w - 10);
    const top = rect.bottom + 8 + (window.innerHeight - rect.bottom < 260 ? -rect.height - 250 : 0);
    setBmName('');
    setBmPop({ student: { id: student.id, name: student.name || `Student ${student.id}` }, left, top });
  }, []);

  const createFolder = (name) => {
    const n = (name || '').trim();
    if (!n) return null;
    const f = { id: `f${Date.now()}${Math.floor(Math.random() * 999)}`, name: n, studentIds: [] };
    setFolders((p) => [...p, f]);
    return f;
  };
  const toggleInFolder = (folderId, sid) => setFolders((p) => p.map((f) => (
    f.id === folderId
      ? { ...f, studentIds: f.studentIds.includes(sid) ? f.studentIds.filter((x) => x !== sid) : [...f.studentIds, sid] }
      : f
  )));

  /* close the bookmark popover on any outside click or scroll */
  useEffect(() => {
    if (!bmPop) return undefined;
    const close = (e) => {
      if (e.target.closest?.('.bm-pop')) return;
      setBmPop(null);
    };
    const onScroll = () => setBmPop(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [bmPop]);

  /* ---------------- modals ---------------- */
  const [reportId, setReportId] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const [schoolModalId, setSchoolModalId] = useState(null);
  const [gradeModal, setGradeModal] = useState(null); // { schoolId, grade }
  const [showCompare, setShowCompare] = useState(false);
  const [showAperf, setShowAperf] = useState(false);

  const openReport = useCallback((s) => { setBmPop(null); setReportId(s.id); }, []);
  const openTeacher = useCallback((t) => { setTeacherId(t.id); }, []);
  const openSchool = useCallback((id) => { setSchoolModalId(id); }, []);
  const openGrade = useCallback((schoolId, g) => {
    setGradeModal({ schoolId, grade: Number(g) });
  }, []);

  /* Escape closes whatever is open; Ctrl K / "/" focus the search */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        gsRef.current?.focus();
        gsRef.current?.select?.();
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        gsRef.current?.focus();
      } else if (e.key === 'Escape') {
        setBmPop(null);
        setReportId(null);
        setTeacherId(null);
        setSchoolModalId(null);
        setGradeModal(null);
        setShowCompare(false);
        setShowAperf(false);
        setMobNav(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- students level (server-paginated org rank) -------- */
  const [gsQuery, setGsQuery] = useState('');
  const [stuMin, setStuMin] = useState(0);
  const [stuRows, setStuRows] = useState([]);
  const [stuTotal, setStuTotal] = useState(null);
  const [stuPage, setStuPage] = useState(1);
  const [stuLoading, setStuLoading] = useState(true);
  const [stuLoadingMore, setStuLoadingMore] = useState(false);
  const stuListRef = useRef(null);
  const stuSentinelRef = useRef(null);

  /* pagehead search routes into the Students Level (designer gsInput): the
     first character scrolls the section into view and the query filters the
     org list live */
  const onGsChange = (v) => {
    setGsQuery(v);
    if (v && !gsQuery) scrollToSection(SECTIONS.cpStudents);
  };
  const onStuQuery = (v) => { setGsQuery(v); setStuLoading(true); };

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchCpStudents({ search: gsQuery.trim(), page: 1, pageSize: PAGE_SIZE, minAvg: stuMin })
        .then((d) => {
          if (!alive) return;
          setStuRows(d.students);
          setStuTotal(d.total);
          setStuPage(1);
        })
        .catch(() => { if (alive) { setStuRows([]); setStuTotal(0); } })
        .finally(() => { if (alive) setStuLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [gsQuery, stuMin]);

  const loadMoreStudents = useCallback(() => {
    if (stuLoading || stuLoadingMore) return;
    if (stuTotal != null && stuRows.length >= stuTotal) return;
    setStuLoadingMore(true);
    fetchCpStudents({ search: gsQuery.trim(), page: stuPage + 1, pageSize: PAGE_SIZE, minAvg: stuMin })
      .then((d) => {
        setStuRows((rows) => [...rows, ...d.students]);
        setStuPage(d.page);
      })
      .catch(() => showToast('Could not load more students', 'error'))
      .finally(() => setStuLoadingMore(false));
  }, [stuLoading, stuLoadingMore, stuTotal, stuRows.length, stuPage, gsQuery, stuMin, showToast]);

  useEffect(() => {
    const el = stuSentinelRef.current;
    const scroller = stuListRef.current;
    if (!el || !scroller || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMoreStudents();
    }, { root: scroller, rootMargin: '220px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMoreStudents, stuRows.length]);

  /* EXPORT CSV — every row of the CURRENT filter (search + rank band), not
     just the ones infinite-scroll has lazy-loaded. Streams pages of 200
     (server cap) while the button shows EXPORTING done/total. */
  const exportStudentsCsv = useCallback(async (onProgress) => {
    const rows = await fetchAllPages(
      (page, pageSize) => fetchCpStudents({ search: gsQuery.trim(), page, pageSize, minAvg: stuMin })
        .then((d) => ({ items: d.students, total: d.total })),
      onProgress,
    );
    return {
      filename: `fetchx-students-${csvStamp()}.csv`,
      headers: ['RANK', 'STUDENT NAME', 'SCHOOL', 'CLASS', 'ALL-TERM AVG %'],
      rows: rows.map((s) => [s.org_rank, s.name, s.school, s.class, pct(s.avg)]),
    };
  }, [gsQuery, stuMin]);

  /* ---------------- teachers level (server-paginated org rank) -------- */
  const [tchQuery, setTchQuery] = useState('');
  const [tchMin, setTchMin] = useState(0);
  const [tchRows, setTchRows] = useState([]);
  const [tchTotal, setTchTotal] = useState(null);
  const [tchPage, setTchPage] = useState(1);
  const [tchLoading, setTchLoading] = useState(true);
  const [tchLoadingMore, setTchLoadingMore] = useState(false);
  const tchListRef = useRef(null);
  const tchSentinelRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchCpTeachers({ search: tchQuery.trim(), page: 1, pageSize: PAGE_SIZE, minAvg: tchMin })
        .then((d) => {
          if (!alive) return;
          setTchRows(d.teachers);
          setTchTotal(d.total);
          setTchPage(1);
        })
        .catch(() => { if (alive) { setTchRows([]); setTchTotal(0); } })
        .finally(() => { if (alive) setTchLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [tchQuery, tchMin]);

  const loadMoreTeachers = useCallback(() => {
    if (tchLoading || tchLoadingMore) return;
    if (tchTotal != null && tchRows.length >= tchTotal) return;
    setTchLoadingMore(true);
    fetchCpTeachers({ search: tchQuery.trim(), page: tchPage + 1, pageSize: PAGE_SIZE, minAvg: tchMin })
      .then((d) => {
        setTchRows((rows) => [...rows, ...d.teachers]);
        setTchPage(d.page);
      })
      .catch(() => showToast('Could not load more teachers', 'error'))
      .finally(() => setTchLoadingMore(false));
  }, [tchLoading, tchLoadingMore, tchTotal, tchRows.length, tchPage, tchQuery, tchMin, showToast]);

  useEffect(() => {
    const el = tchSentinelRef.current;
    const scroller = tchListRef.current;
    if (!el || !scroller || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMoreTeachers();
    }, { root: scroller, rootMargin: '220px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMoreTeachers, tchRows.length]);

  /* EXPORT CSV — teachers variant (roles column joins HOD/CT flags) */
  const exportTeachersCsv = useCallback(async (onProgress) => {
    const rows = await fetchAllPages(
      (page, pageSize) => fetchCpTeachers({ search: tchQuery.trim(), page, pageSize, minAvg: tchMin })
        .then((d) => ({ items: d.teachers, total: d.total })),
      onProgress,
    );
    return {
      filename: `fetchx-teachers-${csvStamp()}.csv`,
      headers: ['RANK', 'TEACHER NAME', 'SCHOOL', 'SUBJECT', 'CLASS AVG %', 'ROLES'],
      rows: rows.map((t) => [
        t.org_rank, t.name, t.school, t.subject || '',
        t.avg != null ? pct(t.avg) : '',
        [t.is_hod ? 'HOD' : '', t.is_ct ? 'CT' : ''].filter(Boolean).join('+'),
      ]),
    };
  }, [tchQuery, tchMin]);

  /* ---------------- group attendance range ---------------- */
  const [attRange, setAttRange] = useState('3M');

  /* ---------------- v16 pagehead / tier-band copy ---------------- */
  const searchPlaceholder = bundle
    ? `Search ${num(nStudents)} students, ${nClasses} classes, teachers, schools…`
    : 'Search students, classes, teachers, schools…';
  const tierTag = bundle
    ? `${nSchools} SCHOOLS · ${nClasses} CLASSES · ${num(nStudents)} STUDENTS`
    : 'GROUP COMMAND CENTER';

  const navGo = useCallback((key) => {
    setMobNav(false);
    if (key === 'saved') { setView('saved'); return; }
    setView('dash');
    const id = SECTIONS[key];
    if (id) scrollToSection(id);
    else mainRef.current?.scrollTo({ top: 0 });
  }, [scrollToSection]);

  const signOut = () => { logout(); navigate('/'); };

  /* ================= render ================= */
  return (
    <div className={`pd-root v15-root${navCollapsed ? ' nav-collapsed' : ''}${mobNav ? ' mob-nav' : ''}`}>
      <DashSidebar
        logo
        roleLabel="CHAIRPERSON"
        savedCount={savedIds.size}
        active={view === 'saved' ? 'saved' : navActive}
        activeGroup="cp"
        onGo={navGo}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((c) => !c)}
        onSignOut={signOut}
        groups={[{
          key: 'cp', label: 'CHAIRPERSON', dot: '#4f42dd',
          links: [
            { key: 'cpGroup', label: 'Group Level', lvl: 1, icon: NAV_ICONS.cpGroup },
            { key: 'cpSchools', label: 'Schools Level', lvl: 2, icon: NAV_ICONS.cpSchools },
            { key: 'cpGrades', label: 'Grades Level', lvl: 3, icon: NAV_ICONS.cpGrades },
            { key: 'cpStudents', label: 'Students Level', lvl: 4, icon: NAV_ICONS.cpStudents },
            { key: 'cpTeachers', label: 'Teachers Level', lvl: 6, icon: NAV_ICONS.cpTeachers },
          ],
        }]}
      />

      {view === 'saved' ? (
        <main className="v15-main pd-main" ref={mainRef}>
          <SavedStudents
            folders={folders}
            onCreate={createFolder}
            onDeleteFolder={(id) => setFolders((p) => p.filter((f) => f.id !== id))}
            onRemoveStudent={toggleInFolder}
            onBack={() => setView('dash')}
            onOpenReport={openReport}
            savedCount={savedIds.size}
          />
        </main>
      ) : (
        <main className="v15-main pd-main" ref={mainRef}>
          <PageHead
            tier="cp"
            eyebrow="Fetch-X · Group Command Center"
            title="Chairperson Dashboard"
            subtitle={booting
              ? 'Crunching group data…'
              : `Chairperson · The whole group on one screen — ${nSchools} schools, ${nClasses} classes, ${num(nStudents)} students`}
            searchSlot={(
              <div className="pagehead-mid gsearch">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                <input
                  ref={gsRef}
                  type="text"
                  value={gsQuery}
                  placeholder={searchPlaceholder}
                  autoComplete="off"
                  onChange={(e) => onGsChange(e.target.value)}
                />
                <kbd>Ctrl K</kbd>
              </div>
            )}
            actions={(
              <>
                <button type="button" className="btn-mode" onClick={toggle} title="Dark / light mode" aria-label="Toggle theme">
                  {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
                </button>
                <button type="button" className="btn-aperf" onClick={() => setShowAperf(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 20 7 20 17 12 22 4 17 4 7" /><polygon points="12 8 15.5 10 15.5 14 12 16 8.5 14 8.5 10" /></svg>
                  ACADEMIC PERFORMANCE
                </button>
                <button type="button" className="btn-compare" onClick={() => setShowCompare(true)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15h-.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" /></svg>
                  COMPARE
                </button>
              </>
            )}
          />

          <Tier tier="cp" id="tierCP">
            <TierBand
              tier="cp"
              lvl={1}
              icon={TIER_ICONS.cp}
              eyebrow="TIER 01 · GROUP"
              copy="All three branches merged into one academic picture."
              tag={tierTag}
            />

            {/* ==================== 01 GROUP LEVEL ==================== */}
            <SectionGroup
              bundle={bundle}
              booting={booting}
              bundleErr={bundleErr}
              onRetry={loadBundle}
              attRange={attRange}
              onAttRange={setAttRange}
              nSchools={nSchools}
              nStudents={nStudents}
              onOpenSchool={openSchool}
              schools={schools}
            />

            {/* ==================== 02 SCHOOLS LEVEL ==================== */}
            <SectionSchools
              bundle={bundle}
              nSchools={nSchools}
              onOpenSchool={openSchool}
            />

            {/* ==================== 03 GRADES LEVEL ==================== */}
            <SectionGrades
              bundle={bundle}
              nSchools={nSchools}
              onOpenGrade={openGrade}
            />

            {/* ==================== 04 STUDENTS LEVEL ==================== */}
            <section className="lvl lvl-4" id="cpStudentsSec">
              <SectionHead
                num="04"
                title="Students Level"
                sub={`Every student across all ${nSchools || 'three'} schools, ranked by their all-term average score.`}
                tag={stuTotal != null
                  ? `${num(stuTotal)} STUDENT${stuTotal === 1 ? '' : 'S'} · ORGANISATION RANK`
                  : 'ORGANISATION RANK'}
              />
              <RankTabs value={String(stuMin)} onChange={(v) => { setStuMin(v === 'all' ? 0 : Number(v)); setStuLoading(true); }} />
              <div className="searchbar fade">
                <Search strokeWidth={2} />
                <input
                  type="text"
                  value={gsQuery}
                  placeholder="Search by name, school or class — e.g. “Ananya” or “Mailoor”"
                  autoComplete="off"
                  onChange={(e) => onStuQuery(e.target.value)}
                />
                <span className="count">
                  {stuTotal != null
                    ? (gsQuery.trim() || stuMin
                      ? `${num(stuTotal)} MATCH${stuTotal === 1 ? '' : 'ES'}`
                      : `${num(stuTotal)} STUDENTS`)
                    : '…'}
                </span>
                <ExportCsvButton
                  fetcher={exportStudentsCsv}
                  disabled={!stuTotal}
                  onDone={(n) => showToast(`${num(n)} students exported as CSV`, 'success')}
                  onError={() => showToast('The CSV export failed — try again', 'error')}
                />
              </div>
              <div className="st-list-wrap fade">
                <div className="st-scroll" ref={stuListRef}>
                  <div className="st-head org-stu">
                    <span>RANK</span><span>STUDENT NAME</span><span>SCHOOL</span><span>CLASS</span>
                    <span className="r">ALL-TERM AVG</span><span>SAVE</span>
                  </div>
                  {stuLoading && !stuRows.length ? (
                    <CpdSkelRows n={6} />
                  ) : (
                    <>
                      {stuRows.map((s) => (
                        <OrgStudentRow
                          key={s.id}
                          s={s}
                          colorOf={colorOf}
                          saved={savedIds.has(s.id)}
                          onOpen={openReport}
                          onBookmark={onBookmark}
                        />
                      ))}
                      {stuLoadingMore && <div className="pd-note">Loading more…</div>}
                      {!stuRows.length && !stuLoading && (
                        <EmptyState
                          title="No students match this filter"
                          hint="Try a different name, school or rank band — or clear the search."
                        />
                      )}
                      <div ref={stuSentinelRef} className="list-sentinel" />
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* ==================== 05 TEACHERS LEVEL ==================== */}
            <section className="lvl lvl-6" id="cpTeachersSec">
              <SectionHead
                num="05"
                title="Teachers Level"
                sub={`Academic faculty of all ${nSchools || 'three'} schools, ranked across the organisation.`}
                tag={tchTotal != null
                  ? `${num(tchTotal)} TEACHER${tchTotal === 1 ? '' : 'S'} · ORGANISATION RANK`
                  : 'ORGANISATION RANK'}
              />
              <RankTabs value={String(tchMin)} onChange={(v) => { setTchMin(v === 'all' ? 0 : Number(v)); setTchLoading(true); }} />
              <div className="searchbar fade">
                <Search strokeWidth={2} />
                <input
                  type="text"
                  value={tchQuery}
                  placeholder="Search by teacher name, subject or school — e.g. “Kavita” or “Saundatti”"
                  autoComplete="off"
                  onChange={(e) => { setTchQuery(e.target.value); setTchLoading(true); }}
                />
                <span className="count">
                  {tchTotal != null
                    ? (tchQuery.trim() || tchMin
                      ? `${num(tchTotal)} MATCH${tchTotal === 1 ? '' : 'ES'}`
                      : `${num(tchTotal)} TEACHERS`)
                    : '…'}
                </span>
                <ExportCsvButton
                  fetcher={exportTeachersCsv}
                  disabled={!tchTotal}
                  onDone={(n) => showToast(`${num(n)} teachers exported as CSV`, 'success')}
                  onError={() => showToast('The CSV export failed — try again', 'error')}
                />
              </div>
              <div className="st-list-wrap fade">
                <div className="st-scroll" ref={tchListRef}>
                  <div className="st-head org-tch">
                    <span>RANK</span><span>TEACHER NAME</span><span>SCHOOL</span><span>SUBJ</span>
                    <span className="r">CLASS AVG</span><span>REPORT</span>
                  </div>
                  {tchLoading && !tchRows.length ? (
                    <CpdSkelRows n={6} />
                  ) : (
                    <>
                      {tchRows.map((t) => (
                        <OrgTeacherRow
                          key={t.id}
                          t={t}
                          colorOf={colorOf}
                          onOpen={openTeacher}
                        />
                      ))}
                      {tchLoadingMore && <div className="pd-note">Loading more…</div>}
                      {!tchRows.length && !tchLoading && (
                        <EmptyState
                          title="No teachers match this filter"
                          hint="Try a different name, subject or school — or widen the rank band."
                        />
                      )}
                      <div ref={tchSentinelRef} className="list-sentinel" />
                    </>
                  )}
                </div>
              </div>
            </section>
          </Tier>
        </main>
      )}

      {/* mobile nav (v15 shell) */}
      <button type="button" className="v15-mobtoggle" aria-label="Open navigation" onClick={() => setMobNav(true)}>
        <Menu strokeWidth={2.2} />
      </button>
      {mobNav && (
        <div className="v15-mobbackdrop" onClick={() => setMobNav(false)} role="presentation">
          <div className="v15-mobclose"><X strokeWidth={2.4} /></div>
        </div>
      )}

      {/* ---------------- modals (portal to document.body) ---------------- */}
      {reportId != null && createPortal(
        <ReportCardModal
          studentId={reportId}
          onClose={() => setReportId(null)}
          saved={savedIds.has(reportId)}
          onBookmark={onBookmark}
        />,
        document.body,
      )}
      {teacherId != null && createPortal(
        <TeacherReportModal
          teacherId={teacherId}
          onClose={() => setTeacherId(null)}
          onOpenReport={openReport}
          onBookmark={onBookmark}
        />,
        document.body,
      )}
      {schoolModalId != null && bundle && createPortal(
        <CpSchoolModal
          school={schools.find((S) => S.id === schoolModalId)}
          nSchools={nSchools}
          onClose={() => setSchoolModalId(null)}
          onOpenGrade={openGrade}
        />,
        document.body,
      )}
      {gradeModal != null && bundle && createPortal(
        <CpGradeModal
          school={schools.find((S) => S.id === gradeModal.schoolId)}
          grade={schools
            .find((S) => S.id === gradeModal.schoolId)?.grades
            ?.find((g) => g.grade === gradeModal.grade)}
          nSchools={nSchools}
          distroBands={schools.find((S) => S.id === gradeModal.schoolId)?.distribution}
          onClose={() => setGradeModal(null)}
          onOpenReport={openReport}
          onBookmark={onBookmark}
          savedIds={savedIds}
        />,
        document.body,
      )}
      {showCompare && bundle && createPortal(
        <CpCompareModal bundle={bundle} onClose={() => setShowCompare(false)} />,
        document.body,
      )}
      {showAperf && bundle && createPortal(
        <CpAperfModal bundle={bundle} onClose={() => setShowAperf(false)} />,
        document.body,
      )}

      {/* bookmark-to-folder popover */}
      {bmPop && createPortal(
        <BmPopover
          pop={bmPop}
          newName={bmName}
          onNewName={setBmName}
          folders={folders}
          onToggle={toggleInFolder}
          onCreate={() => {
            const f = createFolder(bmName);
            if (f) toggleInFolder(f.id, bmPop.student.id);
          }}
        />,
        document.body,
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

/* ================================================== 01 GROUP LEVEL ===== */
function SectionGroup({
  bundle, booting, bundleErr, onRetry, attRange, onAttRange, nSchools, nStudents, onOpenSchool, schools,
}) {
  const reveal = useReveal();
  const [secRef, secIn] = useInView();
  const group = bundle?.group || null;
  const overall = group
    ? compositeOverall(group.marks_avg, group.tasks_rate, group.attendance_rate)
    : null;

  if (bundleErr) {
    return (
      <section className="lvl lvl-1 first in" id="cpGroupSec">
        <SectionHead num="01" title="Group Level" sub="Overall branches data with visuals — every school, every term, merged into one." tag="GROUP" />
        <div className="pd-note" style={{ padding: 40 }}>
          The group bundle could not be loaded.
          <div style={{ marginTop: 12 }}>
            <button type="button" className="gtab" onClick={onRetry}>RETRY</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`lvl lvl-1 first rv${secIn ? ' in' : ''}`} id="cpGroupSec" ref={secRef}>
      <SectionHead
        num="01"
        title="Group Level"
        sub="Overall branches data with visuals — every school, every term, merged into one."
        tag={group ? `${nSchools} SCHOOLS · ALL BRANCHES MERGED` : 'GROUP'}
      />
      <div className="school-strip">
        <div className="card card-op fade">
          <div className="label">OVERALL PERFORMANCE (ALL TERMS · ALL BRANCHES)</div>
          <div className="op-stats">
            <div
              className="op-stat"
              title={group
                ? `(${pct(group.marks_avg)}% marks + ${pct(group.tasks_rate)}% tasks + ${pct(group.attendance_rate)}% attendance) ÷ 3 = ${overall}%`
                : undefined}
            >
              <div className="k">ALL TERM<br />AVERAGE</div>
              {overall != null
                ? <Donut value={overall} variant="d-md" />
                : <CpdSkel h={54} style={{ width: 54, borderRadius: '50%' }} />}
            </div>
            {[group?.t1, group?.t2, group?.t3].map((t, i) => (
              <div className="op-stat" key={i}>
                <div className="k">TERM {i + 1}<br />GROUP AVERAGE</div>
                <div className="v">{t != null ? `${pct(t)}%` : (group ? '—' : '')}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-stats fade">
          {booting || !group ? (
            <div style={{ gridColumn: '1/-1', padding: 8 }}><CpdSkel h={70} /></div>
          ) : (
            <>
              <CpStatCell icon={Users} k="TOTAL STUDENTS" v={num(group.students)} />
              <CpStatCell icon={School} k="TOTAL SCHOOLS" v={group.schools} />
              <CpStatCell icon={Trophy} sep k="GROUP RANKING" v="#1" of={1} title="This console merges every school the chairperson oversees into one group." />
              <CpStatCell icon={CalendarCheck2} k="ATTENDANCE (AVG)" v={`${pct(group.attendance_rate)}%`} />
              <CpStatCell icon={ClipboardCheck} k="TASK COMPLETION (AVG)" v={`${pct(group.tasks_rate)}%`} />
              <CpStatCell icon={BookOpen} sep k="AVERAGE MARKS" v={`${pct(group.marks_avg)}%`} />
            </>
          )}
        </div>
      </div>

      <DistroCard
        label={group
          ? `SCORE DISTRIBUTION · ALL ${num(nStudents)} STUDENTS · ALL-TERM AVERAGE · BAR = SHARE OF STUDENTS`
          : 'SCORE DISTRIBUTION'}
        bands={group?.distribution}
        total={group ? distroTotal(group.distribution) : 0}
        loading={booting || !group}
      />

      <AttCard
        label={`ATTENDANCE TREND · GROUP · LAST ${attLabel(attRange)}`}
        series={group?.attendance_series}
        range={attRange}
        onRange={onAttRange}
        loading={booting || !group}
      />

      <div className="card chart-card fade">
        <div className="chead">
          <span className="label">
            {group
              ? `BRANCH COMPARISON · ALL METRICS · ${nSchools} SCHOOLS · CLICK A COLUMN TO OPEN`
              : 'BRANCH COMPARISON'}
          </span>
        </div>
        <div className="cbody">
          {booting || !group ? (
            <div className="cp-mgrid">{[0, 1, 2].map((i) => <CpdSkel key={i} h={170} />)}</div>
          ) : (
            <div className="cp-mgrid">
              {schools.map((S) => (
                <div
                  key={S.id}
                  className="cp-mcol fade"
                  role="button"
                  tabIndex={0}
                  title={`Open ${S.name} report`}
                  style={{ '--sc': S.color, '--scSoft': rgbaSoft(S.color) }}
                  onClick={() => onOpenSchool(S.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenSchool(S.id); }}
                >
                  <div className="cp-mcol-head">
                    <span className="mh-name">{String(S.name).toUpperCase()}</span>
                    <span className="mh-rank">#{S.org_rank}/{nSchools} · {pct(S.overall)}%</span>
                  </div>
                  <div className="cp-mcol-body">
                    {branchRows(S).map(([lbl, val]) => (
                      <div className={`cp-mrow${lbl === 'OVERALL' ? ' overall' : ''}`} key={lbl}>
                        <span className="mr-lbl">{lbl}</span>
                        <span className="mr-track"><i style={{ width: reveal ? `${Math.min(100, val)}%` : 0 }} /></span>
                        <span className="mr-val">{val}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* =============================================== 02 SCHOOLS LEVEL ===== */
function SectionSchools({ bundle, nSchools, onOpenSchool }) {
  const schools = bundle?.schools || null;
  const [secRef, secIn] = useInView();
  return (
    <section className={`lvl lvl-2 rv${secIn ? ' in' : ''}`} id="cpSchoolsSec" ref={secRef}>
      <SectionHead
        num="02"
        title="Schools Level"
        sub="Each branch of the group, ranked — click a school to open its full report."
        tag={schools ? `${nSchools} SCHOOLS · RANKED #1–#${nSchools}` : 'SCHOOLS'}
      />
      {!schools ? (
        <div className="subject-grid">{[0, 1, 2].map((i) => <CpdSkel key={i} h={104} />)}</div>
      ) : (
        <div className="subject-grid">
          {schools.map((S) => {
            const soft = rgbaSoft(S.color);
            return (
              <div
                key={S.id}
                className="card s-card clickable fade school-card"
                role="button"
                tabIndex={0}
                title={`Open ${S.name} report`}
                style={{ '--sc': S.color, '--scSoft': soft }}
                onClick={() => onOpenSchool(S.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenSchool(S.id); }}
              >
                <div className="s-head">
                  <span className="s-name">{String(S.name).toUpperCase()}</span>
                  <span className="teach-pill" title={`Principal · ${S.principal || '—'}`}>
                    {PERSON_SVG}<b>{S.principal || '—'}</b><em>PRINCIPAL</em>
                  </span>
                  <span className={`rank-pill${S.org_rank === 1 ? ' top' : ''}`}>#{S.org_rank}<span className="of30">/{nSchools}</span></span>
                </div>
                <div className="s-body">
                  <div className="chips">
                    <Chip t="T1" n={pct(S.t1)} />
                    <Chip t="T2" n={pct(S.t2)} />
                    <Chip t="T3" n={pct(S.t3)} />
                    <Chip t="STUDENTS" n={num(S.students)} />
                  </div>
                  <div className="avg-wrap">
                    <span className="avg-label">AVERAGE</span>
                    <Donut
                      value={compositeOverall(S.marks, S.tasks, S.attendance)}
                      variant="d-md"
                      style={{ '--donut': S.color, '--lvlD': S.color }}
                    />
                    <Trend d={pct(S.t3) - pct(S.t2)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ================================================ 03 GRADES LEVEL ===== */
function SectionGrades({ bundle, nSchools, onOpenGrade }) {
  const schools = bundle?.schools || null;
  const reveal = useReveal();
  const [secRef, secIn] = useInView();
  const nGrades = schools?.[0]?.grades?.length;
  return (
    <section className={`lvl lvl-3 rv${secIn ? ' in' : ''}`} id="cpGradesSec" ref={secRef}>
      <SectionHead
        num="03"
        title="Grades Level"
        sub="One row per school — grade-level averages only. Click any grade for its report."
        tag={schools ? `${nSchools} SCHOOLS · ${nGrades ?? '—'} GRADES EACH` : 'GRADES'}
      />
      {!schools ? (
        <CpdSkel h={280} />
      ) : (
        <>
          <div className="cp-gcols">
            {schools.map((S) => (
              <div className="cp-gcol" key={S.id} style={{ '--sc': S.color, '--scSoft': rgbaSoft(S.color) }}>
                <div className="cp-gcol-head">
                  <span className="gh-name">{String(S.name).toUpperCase()}</span>
                  <span className="gh-tag">AVG {pct(S.overall)}% · #{S.org_rank}/{nSchools}</span>
                </div>
                <div className="cp-grows">
                  {(S.grades || []).map((gr) => (
                    <div
                      className="cp-grow fade"
                      key={gr.grade}
                      role="button"
                      tabIndex={0}
                      title={`Open Grade ${gr.grade} report — ${S.name}`}
                      onClick={() => onOpenGrade(S.id, gr.grade)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onOpenGrade(S.id, gr.grade); }}
                    >
                      <span className="gn">G{gr.grade}</span>
                      <span className="gbar"><i style={{ width: reveal ? `${Math.min(100, pct(gr.avg))}%` : 0 }} /></span>
                      <span className="gv">{pct(gr.avg)}%</span>
                      <Trend d={pct(gr.t?.[2]) - pct(gr.t?.[1])} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grade-more">GRADE REPORTS RANKED WITHIN EACH SCHOOL</div>
        </>
      )}
    </section>
  );
}

/* attLabel for the group attendance card */
function attLabel(range) {
  return { '30D': '30 DAYS', '3M': '3 MONTHS', '6M': '6 MONTHS', '1Y': '1 YEAR' }[range] || range;
}
