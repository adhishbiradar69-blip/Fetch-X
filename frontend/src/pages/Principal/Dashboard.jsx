/* Fetch-X — Principal Dashboard (designer v15).
   Port of dashboard(2).html v15 with REAL backend data. Route:
   /principal/dashboard (unchanged). The page now owns its full chrome —
   the v15 sidebar (level links + Saved + sign out), level themes
   (50-swatch popover per level), subject detail view (#subject=<id>),
   per-subject class-comparison tabs, rank-band student tabs, and the
   resizable AI right panel (real /principal/ai/analyze). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Menu, Moon, Plus, Sun, X } from 'lucide-react';
import {
  fetchAttendanceSeries, fetchClassComparison, fetchClassComparisonBySubject, fetchClasses,
  fetchCtMe, fetchCtTeachingClasses, fetchCtTeacherReport,
  fetchScoreDistribution, fetchSchoolRank, fetchStats, fetchStudents, fetchTeachers,
  fetchTermAverages,
} from './dashboard/data';
import { loadFolders, saveFolders } from './dashboard/util';
import { SectionSchool, SectionSubjects, SectionClasses, SectionStudents, SectionTeachers } from './dashboard/Sections';
import ClassDetail from './dashboard/ClassDetail';
import SubjectDetail from './dashboard/SubjectDetail';
import SavedStudents from './dashboard/SavedStudents';
import ReportCardModal from './dashboard/ReportCardModal';
import TeacherReportModal from './dashboard/TeacherReportModal';
import CompareModal from './dashboard/CompareModal';
import AcademicModal from './dashboard/AcademicModal';
import AiPanel from './dashboard/AiPanel';
import GlobalSearch from './dashboard/GlobalSearch';
import DashSidebar from './dashboard/DashSidebar';
import { LevelThemeStyle } from './dashboard/LevelThemes';
import { CTWorkspace } from '../Teacher/CTConsole';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth } from '../../auth/AuthContext';
import { Toast } from '../../components/ui';
import './dashboard/dashboard.css';
import './dashboard/v15.css';

const PAGE_SIZE = 30;

/* pure hash → route parse (lazy initial state keeps first render correct) */
const parseHash = (h) => {
  if (h && h.startsWith('class=')) return { view: 'class', id: decodeURIComponent(h.slice(6)) };
  if (h && h.startsWith('subject=')) return { view: 'subject', id: decodeURIComponent(h.slice(8)) };
  if (h === 'saved') return { view: 'saved', id: null };
  return { view: 'dash', id: null };
};

export default function PrincipalDashboard() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { mode, toggle } = useTheme() || {};

  /* ---------------- section data ---------------- */
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(false);
  const [termAvg, setTermAvg] = useState(null);
  const [distro, setDistro] = useState(null);
  const [rank, setRank] = useState(null);
  const [classesAll, setClassesAll] = useState(null);

  const [attRange, setAttRange] = useState('3M');
  const [attPoints, setAttPoints] = useState(null);
  /* v15: comparison metric = 'overall' | subject id */
  const [cmpMetric, setCmpMetric] = useState('overall');
  const [cmpClasses, setCmpClasses] = useState(null);

  const [grade, setGrade] = useState('all');
  const [classesList, setClassesList] = useState(null);
  const [teachers, setTeachers] = useState(null);

  /* ---------------- students (server-paginated, v15 rank bands) ---- */
  const [query, setQuery] = useState('');
  const [minAvg, setMinAvg] = useState(0);
  const [stRows, setStRows] = useState([]);
  const [stTotal, setStTotal] = useState(null);
  const [stPage, setStPage] = useState(1);
  const [stLoading, setStLoading] = useState(true);
  const [stLoadingMore, setStLoadingMore] = useState(false);
  const listRef = useRef(null);

  /* ---------------- folders (localStorage fx-folders) ---------------- */
  const [folders, setFolders] = useState(loadFolders);
  const [bmPop, setBmPop] = useState(null); // { student, left, top }
  const [bmNew, setBmNew] = useState('');
  const savedIds = useMemo(() => new Set(folders.flatMap((f) => f.studentIds)), [folders]);
  useEffect(() => { saveFolders(folders); }, [folders]);

  /* ---------------- views + modals ---------------- */
  const [route, setRoute] = useState(() => parseHash(location.hash.replace(/^#/, '')));
  const view = route.view; // dash | class | subject | saved
  const [reportId, setReportId] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [showAperf, setShowAperf] = useState(false);
  const [toast, setToast] = useState(null);

  /* ---------------- AI panel ---------------- */
  const [aiCollapsed, setAiCollapsed] = useState(() => {
    try { return localStorage.getItem('fx-ai') === '1'; } catch { return false; }
  });
  const [aiOpenMobile, setAiOpenMobile] = useState(false);

  /* ---------------- dual mode (principal ↔ class teacher) ---------------- */
  /* The designer's role-admin shell: an account that also holds a CT post
     (school admins do in the seed; super-admin previews the first class)
     gets a second nav group and switches modes in place. /ct/me is the
     probe — it 404s for accounts with no class capacity. */
  const [uiMode, setUiMode] = useState('p');
  const [ctMe, setCtMe] = useState(null); // null = probing, false = no CT capacity
  const [ctTeach, setCtTeach] = useState(null);
  const [ctPage, setCtPage] = useState('ctHome');

  useEffect(() => {
    let alive = true;
    fetchCtMe()
      .then((me) => {
        if (!alive) return;
        setCtMe(me);
        fetchCtTeachingClasses()
          .then((d) => {
            if (!alive) return;
            fetchCtTeacherReport().then((r) => {
              if (!alive) return;
              setCtTeach({ ...d, __students: r.data.students || [], __report: r.data });
            }).catch(() => { if (alive) setCtTeach(d); });
          })
          .catch(() => { if (alive) setCtTeach(null); });
      })
      .catch(() => { if (alive) setCtMe(false); });
    return () => { alive = false; };
  }, []);

  const mainRef = useRef(null);
  const gsRef = useRef(null);
  const [mobNav, setMobNav] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('si-nav', navCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [navCollapsed]);

  const showToast = (message, type = 'error') => setToast({ message, type });

  /* ================= hash routing (#class=, #subject=, #saved) ======= */
  const applyRoute = useCallback((h) => {
    setBmPop(null);
    setRoute(parseHash(h));
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => applyRoute(location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [applyRoute]);

  const go = useCallback((h) => {
    const current = location.hash.replace(/^#/, '');
    if (current === h) return;
    try {
      history.pushState(null, '', h ? `#${h}` : `${location.pathname}${location.search}`);
    } catch { /* ignore */ }
    applyRoute(h);
  }, [applyRoute]);

  /* sidebar nav → scroll to the level section, switch view, or jump into
     the class-teacher mode (ct* keys come from the second nav group) */
  const navGo = useCallback((key) => {
    setMobNav(false);
    if (key.startsWith('ct')) {
      setUiMode('ct');
      setCtPage(key);
      mainRef.current?.scrollTo({ top: 0 });
      return;
    }
    setUiMode('p');
    if (key === 'saved') { go('saved'); return; }
    if (view !== 'dash') { go(''); }
    requestAnimationFrame(() => {
      const el = document.getElementById(key);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else mainRef.current?.scrollTo({ top: 0 });
    });
  }, [go, view]);

  /* ================= initial parallel load ================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, t, d, c, r, a, cm, tc] = await Promise.allSettled([
        fetchStats(),
        fetchTermAverages(),
        fetchScoreDistribution(),
        fetchClasses('all'),
        fetchSchoolRank(),
        fetchAttendanceSeries(attRange),
        fetchClassComparison('avg'),
        fetchTeachers(),
      ]);
      if (!alive) return;
      if (s.status === 'fulfilled') { setStats(s.value); setStatsErr(false); } else setStatsErr(true);
      if (t.status === 'fulfilled') setTermAvg(t.value);
      if (d.status === 'fulfilled') setDistro(d.value);
      if (c.status === 'fulfilled') { setClassesAll(c.value.classes || []); setClassesList(c.value.classes || []); }
      if (r.status === 'fulfilled') setRank(r.value);
      if (a.status === 'fulfilled') setAttPoints(a.value.points || []);
      if (cm.status === 'fulfilled') setCmpClasses(cm.value.classes || []);
      if (tc.status === 'fulfilled') setTeachers(tc.value.teachers || []);
      const failed = [s, t, d, c, r, a, cm, tc].filter((x) => x.status === 'rejected').length;
      if (failed) showToast(`${failed} data source${failed > 1 ? 's' : ''} unavailable — the backend seed may still be running`, 'error');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; range/metric changes have their own effects
  }, []);

  /* refresh per tab / range / metric change */
  const changeAttRange = (k) => {
    setAttRange(k);
    fetchAttendanceSeries(k)
      .then((d) => setAttPoints(d.points || []))
      .catch(() => showToast('Attendance series unavailable', 'error'));
  };
  const changeCmpMetric = (m) => {
    setCmpMetric(m);
    const fetcher = m === 'overall' ? fetchClassComparison('avg') : fetchClassComparisonBySubject(m);
    fetcher
      .then((d) => setCmpClasses(d.classes || []))
      .catch(() => showToast('Class comparison unavailable', 'error'));
  };
  const changeGrade = (g) => {
    setGrade(g);
    fetchClasses(g)
      .then((d) => setClassesList(d.classes || []))
      .catch(() => showToast('Classes unavailable', 'error'));
  };

  /* ================= students: server search + rank bands + scroll ==== */
  const onQuery = (q) => { setQuery(q); setStLoading(true); };
  const onMinAvg = (v) => { setMinAvg(v); setStLoading(true); };
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchStudents({ search: query.trim(), page: 1, pageSize: PAGE_SIZE, minAvg })
        .then((d) => {
          if (!alive) return;
          setStRows(d.students);
          setStTotal(d.total);
          setStPage(1);
        })
        .catch(() => { if (alive) { setStRows([]); setStTotal(0); } })
        .finally(() => { if (alive) setStLoading(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, minAvg]);

  const loadMore = useCallback(() => {
    if (stLoading || stLoadingMore) return;
    if (stTotal != null && stRows.length >= stTotal) return;
    setStLoadingMore(true);
    fetchStudents({ search: query.trim(), page: stPage + 1, pageSize: PAGE_SIZE, minAvg })
      .then((d) => {
        setStRows((rows) => [...rows, ...d.students]);
        setStPage(d.page);
      })
      .catch(() => showToast('Could not load more students', 'error'))
      .finally(() => setStLoadingMore(false));
  }, [stLoading, stLoadingMore, stTotal, stRows.length, stPage, query, minAvg]);

  /* ================= folders ================= */
  const createFolder = (name) => {
    const n = (name || '').trim();
    if (!n) return null;
    const f = { id: `f${Date.now()}${Math.floor(Math.random() * 999)}`, name: n, studentIds: [] };
    setFolders((p) => [...p, f]);
    return f;
  };
  const deleteFolder = (id) => setFolders((p) => p.filter((f) => f.id !== id));
  const toggleInFolder = (folderId, sid) => setFolders((p) => p.map((f) => (
    f.id === folderId
      ? { ...f, studentIds: f.studentIds.includes(sid) ? f.studentIds.filter((x) => x !== sid) : [...f.studentIds, sid] }
      : f
  )));

  const onBookmark = (e, student) => {
    if (!student?.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 230;
    const left = Math.min(Math.max(10, rect.left - 90), window.innerWidth - w - 10);
    const top = rect.bottom + 8 + (window.innerHeight - rect.bottom < 260 ? -rect.height - 250 : 0);
    setBmPop({ student: { id: student.id, name: student.name || `Student ${student.id}` }, left, top });
  };

  /* ================= keyboard: Ctrl K / "/" / Escape ================= */
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
        setShowCompare(false);
        setShowAperf(false);
        setMobNav(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { try { localStorage.setItem('fx-ai', aiCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [aiCollapsed]);

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

  const toggleAi = () => {
    if (window.matchMedia('(max-width:1150px)').matches) setAiOpenMobile((o) => !o);
    else setAiCollapsed((c) => !c);
  };

  const openReport = (student) => { setBmPop(null); setReportId(student.id); };
  const openTeacher = (t) => { setBmPop(null); setTeacherId(t.id); };
  const openClass = (id) => go(`class=${id}`);
  const openSubject = (s) => {
    setBmPop(null);
    go(`subject=${s.id ?? s.name}`);
  };
  const signOut = () => { logout(); navigate('/'); };
  const isAdminRole = ['super_admin', 'school_admin', 'admin'].includes(user?.role);
  const inCtMode = uiMode === 'ct' && !!ctMe;

  /* ================= render ================= */
  const booting = !stats && !statsErr;
  return (
    <div className={`pd-root v15-root${navCollapsed ? ' nav-collapsed' : ''}${aiCollapsed ? ' ai-collapsed' : ''}${aiOpenMobile ? ' ai-open' : ''}${mobNav ? ' mob-nav' : ''}${inCtMode ? ' ct-root' : ''}`}>
      <LevelThemeStyle />
      <DashSidebar
        active={view === 'dash' ? 'schoolSec' : view}
        onGo={navGo}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((c) => !c)}
        savedCount={savedIds.size}
        userName={user?.full_name}
        onSignOut={signOut}
        mode={uiMode}
        ctGroup={ctMe ? { label: (ctMe.class?.name || '').toUpperCase(), active: ctPage } : null}
        adminGroup={isAdminRole}
      />

      {/* class-teacher mode: the workspace replaces the whole principal main
          (it brings its own pagehead), shell chrome stays */}
      {inCtMode && (
        <CTWorkspace me={ctMe} teach={ctTeach} page={ctPage} />
      )}

      {!inCtMode && (
      <main className="v15-main pd-main" ref={mainRef}>
        <header className="pagehead">
          <div>
            <div className="eyebrow">Fetch-X</div>
            <h1>Principal Dashboard</h1>
            <div className="subtitle">{booting ? 'Crunching school data…' : 'School-wide academic and operational performance.'}</div>
          </div>
          <GlobalSearch
            inputRef={gsRef}
            classesAll={classesAll || []}
            teachers={teachers || []}
            subjects={termAvg?.subjects || []}
            onOpenClass={openClass}
            onOpenStudent={openReport}
            onOpenTeacher={openTeacher}
            onOpenSubject={openSubject}
          />
          <div className="pagehead-actions">
            <button
              type="button"
              className="btn-mode"
              onClick={toggle}
              title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
              aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
            </button>
            <button type="button" className="btn-aperf" onClick={() => setShowAperf(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 20 7 20 17 12 22 4 17 4 7" /><polygon points="12 8 15.5 10 15.5 14 12 16 8.5 14 8.5 10" /></svg>
              ACADEMIC PERFORMANCE
            </button>
            <button type="button" className="btn-compare" onClick={() => setShowCompare(true)}>
              <GitCompare strokeWidth={1.8} />
              COMPARE
            </button>
          </div>
        </header>

        {view === 'dash' && (
          <div id="dashView">
            <SectionSchool
              stats={stats} statsErr={statsErr} termAvg={termAvg} distro={distro} rank={rank}
              attPoints={attPoints} attRange={attRange} onAttRange={changeAttRange}
              cmpClasses={cmpClasses} cmpMetric={cmpMetric} onCmpMetric={changeCmpMetric}
              cmpSubjects={termAvg?.subjects || []}
              onOpenClass={openClass}
            />
            <SectionSubjects termAvg={termAvg} onOpenSubject={openSubject} />
            <SectionClasses
              classesAll={classesAll}
              classes={classesList}
              grade={grade}
              onGrade={changeGrade}
              onOpenClass={openClass}
            />
            <SectionStudents
              query={query}
              onQuery={onQuery}
              minAvg={minAvg}
              onMinAvg={onMinAvg}
              rows={stRows}
              total={stTotal}
              loading={stLoading}
              loadingMore={stLoadingMore}
              onMore={loadMore}
              onOpenReport={openReport}
              savedIds={savedIds}
              onBookmark={onBookmark}
              listRef={listRef}
            />
            <SectionTeachers
              teachers={teachers}
              loading={!teachers}
              onOpenTeacher={openTeacher}
            />
          </div>
        )}

        {view === 'class' && route.id != null && (
          <ClassDetail
            classId={route.id}
            classesAll={classesAll || []}
            onBack={() => go('')}
            onOpenReport={openReport}
            savedIds={savedIds}
            onBookmark={onBookmark}
          />
        )}

        {view === 'subject' && route.id != null && (
          <SubjectDetail
            subjectId={route.id}
            onBack={() => go('')}
            onOpenReport={openReport}
            onOpenTeacher={openTeacher}
            savedIds={savedIds}
            onBookmark={onBookmark}
          />
        )}

        {view === 'saved' && (
          <SavedStudents
            folders={folders}
            onCreate={createFolder}
            onDeleteFolder={deleteFolder}
            onRemoveStudent={toggleInFolder}
            onBack={() => go('')}
            onOpenReport={openReport}
            savedCount={savedIds.size}
          />
        )}
      </main>
      )}

      {/* mobile bar (below sidebar in DOM so the drawer paints above) */}
      <button
        type="button" className="v15-mobtoggle" aria-label="Open navigation"
        onClick={() => setMobNav(true)}
      >
        <Menu strokeWidth={2.2} />
      </button>
      {mobNav && (
        <div className="v15-mobbackdrop" onClick={() => setMobNav(false)} role="presentation">
          <div className="v15-mobclose"><X strokeWidth={2.4} /></div>
        </div>
      )}

      <AiPanel
        collapsed={aiCollapsed} onToggle={toggleAi}
        subtitle={inCtMode ? 'Analysing your class' : 'Analysing the entire school'}
      />
      <button type="button" className="ai-fab" onClick={toggleAi} aria-label="Open AI panel">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.7 5 3.3 7.6 8.3 8.3-5 .7-7.6 3.3-8.3 8.3-.7-5-3.3-7.6-8.3-8.3 5-.7 7.6-3.3 8.3-8.3z" /></svg>
      </button>

      {/* bookmark-to-folder popover */}
      {bmPop && createPortal(
        <div className="bm-pop open" style={{ left: bmPop.left, top: bmPop.top }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="bmp-t">SAVE · {bmPop.student.name.toUpperCase()}</div>
          <div>
            {folders.length ? folders.map((f) => (
              <label className="bmopt" key={f.id}>
                <input
                  type="checkbox"
                  checked={f.studentIds.includes(bmPop.student.id)}
                  onChange={() => toggleInFolder(f.id, bmPop.student.id)}
                />
                <i className="bx" />
                <span>{f.name}</span>
                <em>{f.studentIds.length}</em>
              </label>
            )) : <div className="bmp-empty">No folders yet — create one below.</div>}
          </div>
          <div className="bmp-new">
            <input
              placeholder="New folder name"
              value={bmNew}
              onChange={(e) => setBmNew(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const f = createFolder(bmNew);
                  if (f) { toggleInFolder(f.id, bmPop.student.id); setBmNew(''); }
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const f = createFolder(bmNew);
                if (f) { toggleInFolder(f.id, bmPop.student.id); setBmNew(''); }
              }}
              aria-label="Create folder and save"
            >
              <Plus strokeWidth={2.6} />
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Modals portal to document.body */}
      {reportId != null && createPortal(
        <ReportCardModal
          studentId={reportId}
          onClose={() => setReportId(null)}
          totalStudents={stats?.students}
          saved={savedIds.has(reportId)}
          onBookmark={onBookmark}
        />,
        document.body,
      )}
      {teacherId != null && createPortal(
        <TeacherReportModal
          teacherId={teacherId}
          onClose={() => setTeacherId(null)}
          onOpenClass={openClass}
          onOpenReport={openReport}
          onBookmark={onBookmark}
          totalClasses={(classesAll || []).length}
        />,
        document.body,
      )}
      {showCompare && createPortal(
        <CompareModal
          onClose={() => setShowCompare(false)}
          classesAll={classesAll || []}
          folders={folders}
        />,
        document.body,
      )}
      {showAperf && createPortal(
        <AcademicModal
          onClose={() => setShowAperf(false)}
          classesAll={classesAll || []}
          folders={folders}
        />,
        document.body,
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
