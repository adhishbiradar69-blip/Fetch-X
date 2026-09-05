/* Fetch-X — Principal Dashboard.
   Exact port of the designer prototype (upload/dashboard.html) to React
   with REAL backend data. Route: /principal/dashboard (unchanged).

   Structure mirrors dashboard.html:
     pagehead (global search + mode/compare/academic buttons)
     ├─ 01 School Level (.lvl-1)     ├─ 02 Subject Level (.lvl-2)
     ├─ 03 Class Level (.lvl-3)      ├─ 04 Student Level (.lvl-4)
     ├─ class detail view (#class=<id>)   ├─ saved students view (#saved)
     ├─ resizable AI right panel (real /principal/ai/analyze)
     └─ report card / compare / academic performance modals
   View state lives in location.hash so back/forward work. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitCompare, Moon, Plus, Sun } from 'lucide-react';
import {
  fetchAttendanceSeries, fetchClassComparison, fetchClasses, fetchScoreDistribution,
  fetchSchoolRank, fetchStats, fetchStudents, fetchTeachers, fetchTermAverages,
} from './dashboard/data';
import { loadFolders, saveFolders } from './dashboard/util';
import { SectionSchool, SectionSubjects, SectionClasses, SectionStudents, SectionTeachers } from './dashboard/Sections';
import ClassDetail from './dashboard/ClassDetail';
import SavedStudents from './dashboard/SavedStudents';
import ReportCardModal from './dashboard/ReportCardModal';
import TeacherReportModal from './dashboard/TeacherReportModal';
import CompareModal from './dashboard/CompareModal';
import AcademicModal from './dashboard/AcademicModal';
import AiPanel from './dashboard/AiPanel';
import GlobalSearch from './dashboard/GlobalSearch';
import { useTheme } from '../../components/ThemeProvider';
import { Toast } from '../../components/ui';
import './dashboard/dashboard.css';

const PAGE_SIZE = 30;

/* pure hash → route parse (lazy initial state keeps first render correct) */
const parseHash = (h) => {
  if (h && h.startsWith('class=')) return { view: 'class', classId: decodeURIComponent(h.slice(6)) };
  if (h === 'saved') return { view: 'saved', classId: null };
  return { view: 'dash', classId: null };
};

export default function PrincipalDashboard() {
  /* ---------------- section data ---------------- */
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(false);
  const [termAvg, setTermAvg] = useState(null);
  const [distro, setDistro] = useState(null);
  const [rank, setRank] = useState(null);
  const [classesAll, setClassesAll] = useState(null);

  const [attRange, setAttRange] = useState('3M');
  const [attPoints, setAttPoints] = useState(null);
  const [cmpMetric, setCmpMetric] = useState('avg');
  const [cmpClasses, setCmpClasses] = useState(null);

  const [grade, setGrade] = useState('all');
  const [classesList, setClassesList] = useState(null);
  const [teachers, setTeachers] = useState(null);

  /* ---------------- students (server-paginated) ---------------- */
  const [query, setQuery] = useState('');
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
  const view = route.view; // dash | class | saved
  const classId = route.classId;
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

  const mainRef = useRef(null);
  const gsRef = useRef(null);
  const { mode, toggle } = useTheme() || {};

  const showToast = (message, type = 'error') => {
    setToast({ message, type });
  };

  /* ================= hash routing (#class=<id>, #saved) ================ */
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
        fetchClassComparison(cmpMetric),
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

  /* refresh per tab / range change */
  const changeAttRange = (k) => {
    setAttRange(k);
    fetchAttendanceSeries(k)
      .then((d) => setAttPoints(d.points || []))
      .catch(() => showToast('Attendance series unavailable', 'error'));
  };
  const changeCmpMetric = (m) => {
    setCmpMetric(m);
    fetchClassComparison(m)
      .then((d) => setCmpClasses(d.classes || []))
      .catch(() => showToast('Class comparison unavailable', 'error'));
  };
  const changeGrade = (g) => {
    setGrade(g);
    fetchClasses(g)
      .then((d) => setClassesList(d.classes || []))
      .catch(() => showToast('Classes unavailable', 'error'));
  };

  /* ================= students: server search + infinite scroll ========= */
  const onQuery = (q) => { setQuery(q); setStLoading(true); };
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchStudents({ search: query.trim(), page: 1, pageSize: PAGE_SIZE })
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
  }, [query]);

  const loadMore = useCallback(() => {
    if (stLoading || stLoadingMore) return;
    if (stTotal != null && stRows.length >= stTotal) return;
    setStLoadingMore(true);
    fetchStudents({ search: query.trim(), page: stPage + 1, pageSize: PAGE_SIZE })
      .then((d) => {
        setStRows((rows) => [...rows, ...d.students]);
        setStPage(d.page);
      })
      .catch(() => showToast('Could not load more students', 'error'))
      .finally(() => setStLoadingMore(false));
  }, [stLoading, stLoadingMore, stTotal, stRows.length, stPage, query]);

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
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { try { localStorage.setItem('fx-ai', aiCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [aiCollapsed]);

  /* close the bookmark popover on any outside click or scroll (document-level
     capture so it also closes when a report modal behind it scrolls) */
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

  /* ================= render ================= */
  const booting = !stats && !statsErr;
  return (
    <div className={`pd-root${aiCollapsed ? ' ai-collapsed' : ''}${aiOpenMobile ? ' ai-open' : ''}`}>
      <div className="pd-main" ref={mainRef}>
        {booting && <div className="pd-bootbar" role="progressbar" aria-label="Loading dashboard data" />}
        <header className="pagehead">
          <div>
            <div className="eyebrow">School Intelligence</div>
            <h1>Principal Dashboard</h1>
            <div className="subtitle">{booting ? 'Crunching school data…' : 'School-wide academic and operational performance.'}</div>
          </div>
          <GlobalSearch
            inputRef={gsRef}
            classesAll={classesAll || []}
            teachers={teachers || []}
            onOpenClass={openClass}
            onOpenStudent={openReport}
            onOpenTeacher={openTeacher}
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
              onOpenClass={openClass}
            />
            <SectionSubjects termAvg={termAvg} />
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

        {view === 'class' && classId != null && (
          <ClassDetail
            classId={classId}
            classesAll={classesAll || []}
            onBack={() => go('')}
            onOpenReport={openReport}
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
      </div>

      <AiPanel collapsed={aiCollapsed} onToggle={toggleAi} />
      <button type="button" className="ai-fab" onClick={toggleAi} aria-label="Open AI panel">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.7 5 3.3 7.6 8.3 8.3-5 .7-7.6 3.3-8.3 8.3-.7-5-3.3-7.6-8.3-8.3 5-.7 7.6-3.3 8.3-8.3z" /></svg>
      </button>

      {/* bookmark-to-folder popover — portal to body so it paints ABOVE the
          report modals (z100): .main-area traps it in a z-index:1 context. */}
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

      {/* Modals portal to document.body: .main-area creates a z-index:1
          stacking context, so an in-page fixed backdrop (z100) would paint
          UNDER the sidebar (z2) and its left controls would be covered. */}
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
