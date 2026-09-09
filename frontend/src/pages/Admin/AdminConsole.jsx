/* Fetch-X — Admin Console (designer v16 "admin.html" ported to live data).
   Route /admin/dashboard (Task 3-b). Single tier build like the designer:
   the AD tier band stays fused on top of four stacked level sections —
     01 Admin Dashboard · .card-stats (6 cells) ← GET /admin/stats
     02 Classes · grade tabs → grade-blocks of class cards ← GET /admin/classes
        └ roster view (adClsSec pattern, server-paginated ?class_id=)
          └ .dm-act "+ ADD STUDENT" / "+ ADD BULK" → POST /admin/students
     03 Staff List · search + rows ← GET /principal/teachers
        └ row opens the faculty report (TeacherReportModal); arrow edits
        └ Edit Staff modal → PUT /admin/staff/{id}
     04 All Students · search + rows ← GET /admin/students (page/page_size)
        └ row opens the report card (ReportCardModal)
        └ Edit Student modal → PUT /admin/students/{id}
        └ ✕ deletes IMMEDIATELY (no confirm — hard delete backend) with an
          honest "{name} removed" toast (8s auto-dismiss, no undo promise).

   v17 designer delta (Task 2-d):
   · Add Student / Add Bulk modals (admin16/AddStudentModal.jsx) from the
     roster header; freshly created ids render a .newtag NEW pill for the
     rest of the browser session.
   · Saved students — bookmark (.bm) rows into the shared 'fx-folders'
     store (admin16/saved.js wraps the Principal dashboard util), a .bm-pop
     folder picker, and a sidebar "Saved" view reusing SavedStudents.
   · Report cards — student rows open ReportCardModal, staff rows open
     TeacherReportModal (both /principal/* reports allow school_admin).
   · Theme buttons on every section head + the collapsible tier band.
   · The pagehead gsearch is now the shared GlobalSearch: students come
     from /admin/students?search=, classes/teachers/subjects from the
     loaded lists; Ctrl K + "/" focus is kept.
   Old pages /admin/accounts + /admin/extra-teachers stay reachable by URL
   only — they are not part of the designer's sidebar. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Moon, Plus, Sun } from 'lucide-react';
import { PageHead, Tier, TierBand } from '../../components/v16/Shell';
import { TIER_ICONS } from '../../components/v16/icons';
import ExportCsvButton from '../../components/v16/ExportCsvButton';
import EmptyState from '../../components/v16/EmptyState';
import DashSidebar from '../Principal/dashboard/DashSidebar';
import GlobalSearch from '../Principal/dashboard/GlobalSearch';
import ReportCardModal from '../Principal/dashboard/ReportCardModal';
import TeacherReportModal from '../Principal/dashboard/TeacherReportModal';
import SavedStudents from '../Principal/dashboard/SavedStudents';
import { LevelThemeStyle, ThemeBtn } from '../Principal/dashboard/LevelThemes';
import { Toast } from '../../components/ui';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth } from '../../auth/AuthContext';
import { csvStamp, fetchAllPages } from '../../lib/csv';
import {
  fetchStats, fetchTeachers, fetchClasses, fetchSubjects, fetchStudentsPage,
  fetchClassCount, deleteStudent, subjectShort, errOf,
} from './admin16/api';
import {
  loadStudentFolders, savedIdsOf, createStudentFolder, deleteStudentFolder, toggleStudentInFolder,
} from './admin16/saved';
import {
  ICO_SEARCH, ICO_PERSON, ICO_EDIT, ICO_X, ICO_ARROW,
  ICO_STU_TOTAL, ICO_CLS_TOTAL, ICO_RANK, ICO_ATT, ICO_TASKS, ICO_MARKS,
} from './admin16/icons';
import AddStudentModal, { AddBulkModal } from './admin16/AddStudentModal';
import EditStaffModal from './admin16/EditStaffModal';
import EditStudentModal from './admin16/EditStudentModal';
import '../Principal/dashboard/dashboard.css';
import '../Principal/dashboard/v16.css';

const GRADES = Array.from({ length: 10 }, (_, i) => i + 1);
const NAV_OF = { adDash: 'adDashSec', adClass: 'adClassSec', adStaff: 'adStaffSec', adStudents: 'adStuSec' };
const KEY_OF = { adDashSec: 'adDash', adClassSec: 'adClass', adStaffSec: 'adStaff', adStuSec: 'adStudents' };
const clsName = (c) => `${c.grade}-${c.section}`;
const match = (n) => `${n} MATCH${n === 1 ? '' : 'ES'}`;

const chip = (t, n) => (
  <div className="chip"><span className="t">{t}</span><span className="n">{n}</span></div>
);

function SkelRows({ n = 7 }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="pd-skel-row" key={i} aria-hidden="true">
          <div className="pd-skel" style={{ width: 26, height: 26, borderRadius: '50%' }} />
          <div className="pd-skel line" style={{ margin: 0, width: '42%' }} />
          <div className="pd-skel line" style={{ margin: 0, width: 46 }} />
          <div className="pd-skel line" style={{ margin: 0, width: '32%' }} />
          <div className="pd-skel line" style={{ margin: 0, width: 28 }} />
        </div>
      ))}
    </>
  );
}

function SkelStats() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <div className={`stat-cell${i === 2 || i === 5 ? ' sep' : ''}`} key={i} aria-hidden="true">
          <div className="pd-skel" style={{ width: 31, height: 31, borderRadius: 9 }} />
          <div style={{ flex: 1 }}>
            <div className="pd-skel line" style={{ margin: '0 0 6px', width: 74 }} />
            <div className="pd-skel line" style={{ margin: 0, width: 40 }} />
          </div>
        </div>
      ))}
    </>
  );
}

function InlineErr({ msg, onRetry }) {
  return (
    <div className="noresult" style={{ display: 'block' }}>
      {msg}
      <div>
        <button type="button" className="btn btn-ghost" style={{ padding: '7px 16px', fontSize: 10.5, marginTop: 10 }} onClick={onRetry}>
          Retry
        </button>
      </div>
    </div>
  );
}

export default function AdminConsole() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { mode, toggle } = useTheme() || {};
  const mainRef = useRef(null);

  /* ---------------- shell ---------------- */
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('si-nav', navCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [navCollapsed]);

  /* v17: the tier band can collapse every .lvl section below it (designer
     chevron). Opening a roster or jumping via the nav re-expands it. */
  const [tierCollapsed, setTierCollapsed] = useState(false);

  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success', dur) => {
    setToast({ msg, type, dur, key: Date.now() });
  }, []);

  /* ---------------- v17 · saved students + report modals ---------------- */
  const [folders, setFolders] = useState(loadStudentFolders);
  const savedIds = useMemo(() => savedIdsOf(folders), [folders]);
  const [bmPop, setBmPop] = useState(null); // { student, left, top }
  const [bmNew, setBmNew] = useState('');
  const [reportId, setReportId] = useState(null);
  const [teacherId, setTeacherId] = useState(null);
  const [savedView, setSavedView] = useState(false);
  const [addModal, setAddModal] = useState(null); // { mode: 'one' | 'bulk', cls }
  const [newIds, setNewIds] = useState(() => new Set()); // ids created this session → .newtag

  const createFolder = useCallback((name) => {
    const next = createStudentFolder(folders, name);
    if (!next) return null;
    setFolders(next);
    return next[next.length - 1];
  }, [folders]);
  const deleteFolder = useCallback((id) => setFolders(deleteStudentFolder(folders, id)), [folders]);
  const toggleInFolder = useCallback((fid, sid) => setFolders(toggleStudentInFolder(folders, fid, sid)), [folders]);

  /* .bm click → position the folder picker popover under the button */
  const onBookmark = useCallback((e, student) => {
    if (!student?.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 230;
    const left = Math.min(Math.max(10, rect.left - 90), window.innerWidth - w - 10);
    const top = rect.bottom + 8 + (window.innerHeight - rect.bottom < 260 ? -rect.height - 250 : 0);
    setBmPop({ student: { id: student.id, name: student.name || `Student ${student.id}` }, left, top });
  }, []);

  /* report-card opener shared by rows, the global search, the Saved view
     and the teacher report's student cohort */
  const openReport = useCallback((s) => { setBmPop(null); setReportId(s?.id ?? null); }, []);

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

  /* ---------------- data ---------------- */
  const [stats, setStats] = useState(null);
  const [statsErr, setStatsErr] = useState(false);
  const [teachers, setTeachers] = useState(null);
  const [teachersErr, setTeachersErr] = useState(false);
  const [classes, setClasses] = useState(null);
  const [classesErr, setClassesErr] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [clsCounts, setClsCounts] = useState({});

  const refreshStats = useCallback(() => {
    fetchStats().then((d) => setStats(d)).catch(() => {});
  }, []);

  const refreshCounts = useCallback((ids) => {
    if (!ids?.length) return;
    Promise.allSettled(ids.map((id) => fetchClassCount(id))).then((res) => {
      setClsCounts((prev) => {
        const next = { ...prev };
        res.forEach((r, i) => { if (r.status === 'fulfilled') next[ids[i]] = r.value; });
        return next;
      });
    });
  }, []);

  const boot = useCallback(() => {
    let alive = true;
    fetchStats()
      .then((d) => { if (alive) { setStats(d); setStatsErr(false); } })
      .catch((e) => { if (alive) { setStatsErr(true); showToast(errOf(e, 'Could not load school stats.'), 'error'); } });
    fetchTeachers()
      .then((d) => { if (alive) { setTeachers(d); setTeachersErr(false); } })
      .catch((e) => { if (alive) { setTeachersErr(true); showToast(errOf(e, 'Could not load the staff list.'), 'error'); } });
    fetchClasses()
      .then((d) => { if (alive) { setClasses(d); setClassesErr(false); } })
      .catch((e) => { if (alive) { setClassesErr(true); showToast(errOf(e, 'Could not load classes.'), 'error'); } });
    fetchSubjects().then((d) => { if (alive) setSubjects(d); }).catch(() => {});
    return () => { alive = false; };
  }, [showToast]);

  useEffect(() => boot(), [boot]);

  /* per-class enrolment chips for the Classes section (classes endpoint has
     no count — read ?page_size=1 totals, then patch single classes after
     edits/deletes) */
  useEffect(() => {
    if (!classes?.length) return undefined;
    const ids = classes.map((c) => c.id);
    let alive = true;
    Promise.allSettled(ids.map((id) => fetchClassCount(id))).then((res) => {
      if (!alive) return;
      setClsCounts((prev) => {
        const next = { ...prev };
        res.forEach((r, i) => { if (r.status === 'fulfilled') next[ids[i]] = r.value; });
        return next;
      });
    });
    return () => { alive = false; };
  }, [classes]);

  /* ---------------- 04 All Students (server-paginated) ---------------- */
  const [stRows, setStRows] = useState(null);
  const [stTotal, setStTotal] = useState(0);
  const [stPage, setStPage] = useState(1);
  const [stHasMore, setStHasMore] = useState(false);
  const [stLoading, setStLoading] = useState(true);
  const [stMore, setStMore] = useState(false);
  const [stErr, setStErr] = useState(null);
  const [stQ, setStQ] = useState('');
  const stSeq = useRef(0);

  const loadStudents = useCallback(async ({ q = '', page = 1, append = false } = {}) => {
    const seq = ++stSeq.current;
    if (append) setStMore(true); else setStLoading(true);
    setStErr(null);
    try {
      const d = await fetchStudentsPage({ search: q, page });
      if (seq !== stSeq.current) return;
      setStRows((prev) => (append && Array.isArray(prev) ? [...prev, ...d.students] : d.students));
      setStTotal(d.total);
      setStPage(d.page);
      setStHasMore(d.page * d.page_size < d.total);
    } catch (e) {
      if (seq === stSeq.current) setStErr(errOf(e, 'Could not load students.'));
    } finally {
      if (seq === stSeq.current) { setStLoading(false); setStMore(false); }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadStudents({ q: stQ, page: 1 }), 350);
    return () => clearTimeout(t);
  }, [stQ, loadStudents]);

  /* EXPORT CSV — every student of the CURRENT search, school-scoped server-
     side. Columns mirror the roster (admin carries no academic data). */
  const exportStudentsCsv = useCallback(async (onProgress) => {
    const rows = await fetchAllPages(
      (page, pageSize) => fetchStudentsPage({ search: stQ, page, pageSize })
        .then((d) => ({ items: d.students, total: d.total })),
      onProgress,
    );
    return {
      filename: `fetchx-students-${csvStamp()}.csv`,
      headers: ['ROLL NO', 'STUDENT NAME', 'GRADE', 'SECTION', 'CLASS', 'NOTES'],
      rows: rows.map((s) => [
        s.roll_no ?? '', s.name, s.grade ?? '', s.section ?? '',
        s.class_label || s.class_name || '', s.notes || '',
      ]),
    };
  }, [stQ]);

  /* ---------------- 02 roster view (same paginated source, class-scoped) -- */
  const [rosterCls, setRosterCls] = useState(null);
  const [roRows, setRoRows] = useState(null);
  const [roTotal, setRoTotal] = useState(0);
  const [roPage, setRoPage] = useState(1);
  const [roHasMore, setRoHasMore] = useState(false);
  const [roLoading, setRoLoading] = useState(false);
  const [roMore, setRoMore] = useState(false);
  const [roErr, setRoErr] = useState(null);
  const [roQ, setRoQ] = useState('');
  const roSeq = useRef(0);

  const loadRoster = useCallback(async ({ cls, q = '', page = 1, append = false }) => {
    if (!cls) return;
    const seq = ++roSeq.current;
    if (append) setRoMore(true); else setRoLoading(true);
    setRoErr(null);
    try {
      const d = await fetchStudentsPage({ search: q, classId: cls.id, page });
      if (seq !== roSeq.current) return;
      setRoRows((prev) => (append && Array.isArray(prev) ? [...prev, ...d.students] : d.students));
      setRoTotal(d.total);
      setRoPage(d.page);
      setRoHasMore(d.page * d.page_size < d.total);
    } catch (e) {
      if (seq === roSeq.current) setRoErr(errOf(e, 'Could not load the class roster.'));
    } finally {
      if (seq === roSeq.current) { setRoLoading(false); setRoMore(false); }
    }
  }, []);

  useEffect(() => {
    if (!rosterCls) return undefined;
    const t = setTimeout(() => loadRoster({ cls: rosterCls, q: roQ, page: 1 }), 300);
    return () => clearTimeout(t);
  }, [roQ, rosterCls, loadRoster]);

  /* EXPORT CSV — per-class roster (teachers/PT handout style) */
  const exportRosterCsv = useCallback(async (onProgress) => {
    const rows = await fetchAllPages(
      (page, pageSize) => fetchStudentsPage({ search: roQ, classId: rosterCls?.id, page, pageSize })
        .then((d) => ({ items: d.students, total: d.total })),
      onProgress,
    );
    return {
      filename: `fetchx-class-${rosterCls ? clsName(rosterCls) : 'export'}-${csvStamp()}.csv`,
      headers: ['#', 'ROLL NO', 'STUDENT NAME', 'GRADE', 'SECTION', 'NOTES'],
      rows: rows.map((s, i) => [
        i + 1, s.roll_no ?? '', s.name, s.grade ?? '', s.section ?? '', s.notes || '',
      ]),
    };
  }, [roQ, rosterCls]);

  /* ---------------- nav (scroll spy, single-page sections) ---------------- */
  const [activeKey, setActiveKey] = useState('adDash');

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      if (rosterCls || savedView) return;
      const top = el.getBoundingClientRect().top;
      let cur = 'adDashSec';
      ['adDashSec', 'adClassSec', 'adStaffSec', 'adStuSec'].forEach((id) => {
        const s = document.getElementById(id);
        if (s && s.getBoundingClientRect().top - top <= 160) cur = id;
      });
      setActiveKey(KEY_OF[cur]);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [rosterCls, savedView]);

  const scrollSec = useCallback((id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const onNav = useCallback((key) => {
    if (key === 'saved') {
      /* v17 Saved view — replaces the tier content until a section link or
         the view's back button restores the dashboard */
      setRosterCls(null);
      setSavedView(true);
      mainRef.current?.scrollTo({ top: 0 });
      return;
    }
    const id = NAV_OF[key];
    if (!id) return;
    setSavedView(false);
    setTierCollapsed(false);
    if (rosterCls) {
      setRosterCls(null);
      requestAnimationFrame(() => scrollSec(id));
    } else {
      requestAnimationFrame(() => scrollSec(id));
    }
  }, [rosterCls, scrollSec]);

  /* ---------------- 02 classes ---------------- */
  const [gradeTab, setGradeTab] = useState('all');

  const openRoster = useCallback((c) => {
    setRoRows(null);
    setRoQ('');
    setTierCollapsed(false);
    setRosterCls(c);
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const closeRoster = useCallback(() => {
    setRosterCls(null);
    requestAnimationFrame(() => scrollSec('adClassSec'));
  }, [scrollSec]);

  /* v17: open a roster from the global search / teacher-report modal by id */
  const openClassById = useCallback((id) => {
    const c = (classes || []).find((x) => x.id === id);
    setSavedView(false);
    setBmPop(null);
    if (!c) {
      showToast('That class is not in the loaded class list yet — try again in a moment.', 'error');
      return;
    }
    openRoster(c);
  }, [classes, openRoster, showToast]);

  /* ---------------- 03 staff ---------------- */
  const [staffQ, setStaffQ] = useState('');
  const [editStaff, setEditStaff] = useState(null);

  const staffRows = useMemo(() => {
    if (!teachers) return null;
    const q = staffQ.trim().toLowerCase();
    if (!q) return teachers;
    return teachers.filter((t) => `${t.name} ${t.subject || ''}`.toLowerCase().includes(q));
  }, [teachers, staffQ]);

  /* EXPORT CSV — the current staff filter (full list from
     GET /principal/teachers): parity with every other roster — rank,
     subject, HOD/CT roles, CT post, load, average and on-record notes. */
  const exportStaffCsv = useCallback(async () => ({
    filename: `fetchx-staff-${csvStamp()}.csv`,
    headers: ['FACULTY RANK', 'NAME', 'EMAIL', 'SUBJECT', 'ROLES', 'CT OF', 'CLASSES', 'AVG %', 'NOTES'],
    rows: (staffRows || teachers || []).map((t) => [
      t.rank ?? '', t.name || '', t.email || '', t.subject || '',
      [t.is_hod ? 'HOD' : '', t.is_ct ? 'CT' : ''].filter(Boolean).join(' + '),
      t.ct_class_label || '', t.classes_count ?? '',
      t.avg != null ? Math.round(t.avg) : '', t.notes || '',
    ]),
  }), [staffRows, teachers]);

  const onStaffSaved = useCallback((upd) => {
    setEditStaff(null);
    showToast('Staff details saved');
    if (upd?.id) {
      setTeachers((prev) => prev.map((t) => (t.id === upd.id ? {
        ...t,
        name: upd.full_name || t.name,
        subject: upd.subject ?? t.subject,
        subject_id: upd.subject_id ?? t.subject_id,
        is_hod: upd.is_hod,
        is_ct: upd.is_ct,
        ct_class_id: upd.ct_class_id,
        ct_class_label: upd.ct_class_label,
        classes_count: upd.classes_count,
        classes_assigned: upd.classes_assigned,
        notes: upd.notes,
      } : t)));
      /* claiming a CT post displaces the class's previous teacher — the
         class cards' teach-pills must reflect the new assignment */
      fetchClasses().then((d) => setClasses(d)).catch(() => {});
    }
  }, [showToast]);

  /* ---------------- 04 students: edit + delete ---------------- */
  const [editStu, setEditStu] = useState(null);

  const onDeleteStudent = useCallback(async (s) => {
    try {
      await deleteStudent(s.id);
      /* hard delete on the backend — the toast is informational, no undo */
      showToast(`${s.name} removed`, 'info', 8000);
      loadStudents({ q: stQ, page: 1 });
      if (rosterCls) loadRoster({ cls: rosterCls, q: roQ, page: 1 });
      if (s.class_id) refreshCounts([s.class_id]);
      refreshStats();
    } catch (e) {
      showToast(errOf(e, 'Could not remove the student.'), 'error');
    }
  }, [showToast, loadStudents, stQ, rosterCls, loadRoster, roQ, refreshCounts, refreshStats]);

  const onStudentSaved = useCallback((prev, upd) => {
    setEditStu(null);
    showToast('Student details saved');
    loadStudents({ q: stQ, page: 1 });
    if (rosterCls) loadRoster({ cls: rosterCls, q: roQ, page: 1 });
    const ids = new Set();
    if (prev?.class_id) ids.add(prev.class_id);
    if (upd?.class_id) ids.add(upd.class_id);
    if (rosterCls) ids.add(rosterCls.id);
    if (ids.size) refreshCounts([...ids]);
    refreshStats();
  }, [showToast, loadStudents, stQ, rosterCls, loadRoster, roQ, refreshCounts, refreshStats]);

  /* v17: Add Student / Add Bulk landed — tag the created ids (NEW pill for
     the session), refetch both lists + counts so search/pagination stay
     truthful, and report the batch result honestly. */
  const onStudentCreated = useCallback((created, failed = []) => {
    const cls = addModal?.cls;
    setAddModal(null);
    if (!cls) return;
    setNewIds((prev) => {
      const next = new Set(prev);
      created.forEach((r) => next.add(r.id));
      return next;
    });
    showToast(
      failed.length
        ? `${created.length} of ${created.length + failed.length} students added — ${failed.length} could not be saved`
        : created.length === 1
          ? `${created[0].name} added to ${clsName(cls)}`
          : `${created.length} students added`,
      failed.length ? 'error' : 'success',
    );
    loadStudents({ q: stQ, page: 1 });
    if (rosterCls) loadRoster({ cls: rosterCls, q: roQ, page: 1 });
    refreshCounts([cls.id]);
    refreshStats();
  }, [addModal, showToast, loadStudents, stQ, rosterCls, loadRoster, roQ, refreshCounts, refreshStats]);

  /* ---------------- global search (shared GlobalSearch, v17) -------------- */
  /* Students come from the admin roster endpoint (server-side search). The
     admin payload carries no academic data, so rows map to id/name/class
     only — avg/rank are omitted honestly rather than faked as 0. */
  const gsInputRef = useRef(null);

  const adminStudentFetcher = useCallback(async ({ search, page, pageSize }) => {
    const d = await fetchStudentsPage({ search, page, pageSize });
    return {
      students: d.students.map((s) => ({
        id: s.id,
        name: s.name,
        className: s.class_name || s.class_label || '',
      })),
      total: d.total,
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        gsInputRef.current?.focus();
        gsInputRef.current?.select?.();
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        gsInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        setBmPop(null);
        setReportId(null);
        setTeacherId(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- derived copy ---------------- */
  const SCHOOL = stats?.school?.name || null;
  const SHORT = (SCHOOL || 'SCHOOL').split(' ')[0].toUpperCase();
  const schoolLabel = SCHOOL || 'the school campus';

  const onStudentsScroll = (e) => {
    const el = e.currentTarget;
    if (stLoading || stMore || !stHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 140) {
      loadStudents({ q: stQ, page: stPage + 1, append: true });
    }
  };
  const onRosterScroll = (e) => {
    const el = e.currentTarget;
    if (roLoading || roMore || !roHasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 140) {
      loadRoster({ cls: rosterCls, q: roQ, page: roPage + 1, append: true });
    }
  };

  const stuCount = stLoading && !stRows ? null : stTotal;
  const staffCount = staffRows ? staffRows.length : (teachers?.length ?? 0);

  /* ---------------- rows ---------------- */
  const studentRow = (s, opts = {}) => (
    <div
      key={`s${s.id}`}
      className={opts.roster ? 'srow adm-roster' : 'srow'}
      title={opts.roster ? 'Edit student — name, class, section, details' : 'Open report card'}
      onClick={() => (opts.roster ? setEditStu(s) : setReportId(s.id))}
    >
      {opts.roster && <span className="adm-idx">{opts.idx + 1}</span>}
      <span className="st-name" style={opts.roster ? undefined : { gridColumn: '1/3' }}>
        <span className="nm" style={opts.roster ? undefined : { fontSize: 13 }}>{s.name}</span>
        {newIds.has(s.id) && <span className="newtag">NEW</span>}
        {opts.roster && <span className="classchip" style={{ padding: '4px 8px' }}>{s.section}</span>}
      </span>
      {!opts.roster && <span className="classchip">{s.grade}</span>}
      {!opts.roster && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.section || '—'}</span>}
      <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
        {!opts.roster && (
          <button
            type="button"
            className={`bm${savedIds.has(s.id) ? ' on' : ''}`}
            title="Save to folder"
            aria-label={`Save ${s.name} to folder`}
            onClick={(e) => { e.stopPropagation(); onBookmark(e, s); }}
          >
            <Bookmark strokeWidth={2} />
          </button>
        )}
        <button
          type="button" className="tb" title="Edit student — name, class, section, details"
          onClick={(e) => { e.stopPropagation(); setEditStu(s); }}
        >
          {ICO_EDIT}
        </button>
        <button
          type="button" className="tb" title="Remove student"
          onClick={(e) => { e.stopPropagation(); onDeleteStudent(s); }}
        >
          {ICO_X}
        </button>
      </span>
    </div>
  );

  const staffRow = (t) => (
    <div key={`t${t.id}`} className="srow" title="Open teacher report" onClick={() => setTeacherId(t.id)}>
      <span className="st-name" style={{ gridColumn: '1/3' }}>
        <span className="nm" style={{ fontSize: 13 }}>
          {t.name}{t.is_hod ? ' · HOD' : ''}{t.is_ct ? ' · CT' : ''}
        </span>
      </span>
      <span className="classchip" title={t.subject || ''}>{subjectShort(t.subject)}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.classes_count} cls</span>
      <button
        type="button" className="tb" title="Edit staff details"
        aria-label={`Edit ${t.name}`}
        onClick={(e) => { e.stopPropagation(); setEditStaff(t); }}
      >
        {ICO_ARROW}
      </button>
    </div>
  );

  const classCard = (c) => {
    const n = clsCounts[c.id];
    return (
      <div
        key={`c${c.id}`}
        className="card s-card clickable fade"
        title={`Open ${clsName(c)} — ${n ?? '…'} students`}
        onClick={() => openRoster(c)}
      >
        <div className="s-head">
          <span className="s-name">{clsName(c)}</span>
          <span className="teach-pill" title={`Class Teacher · ${c.class_teacher?.name || '—'}`}>
            {ICO_PERSON}<b>{c.class_teacher?.name || '—'}</b><em>CT</em>
          </span>
        </div>
        <div className="s-body">
          <div className="chips">{chip('STUDENTS', n ?? '…')}</div>
          <div className="avg-wrap">
            <span className="avg-label" style={{ fontSize: 9, color: 'var(--muted)' }}>
              GRADE {c.grade} · {c.section.toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`pd-root v15-root${navCollapsed ? ' nav-collapsed' : ''}`}>
      <LevelThemeStyle />
      <DashSidebar
        logo
        roleLabel="ADMIN"
        savedCount={savedIds.size}
        active={savedView ? 'saved' : activeKey}
        activeGroup="ad"
        onGo={onNav}
        onToggle={() => setNavCollapsed((c) => !c)}
        onSignOut={() => { logout(); navigate('/'); }}
        groups={[{
          key: 'ad',
          label: `ADMIN · ${SHORT}`,
          dot: '#c2255c',
          links: [
            { key: 'adDash', label: 'Admin Dashboard', lvl: 1 },
            { key: 'adClass', label: 'Classes', lvl: 3 },
            { key: 'adStaff', label: 'Staff List', lvl: 6 },
            { key: 'adStudents', label: 'All Students', lvl: 4 },
          ],
        }]}
      />

      <main className="v15-main pd-main" ref={mainRef}>
        {savedView ? (
          /* v17 Saved view — the designer's sidebar "Saved" page, reusing
             the Principal dashboard's folder view (report lookups hit
             /principal/student-report, which allows school_admin). */
          <SavedStudents
            folders={folders}
            onCreate={createFolder}
            onDeleteFolder={deleteFolder}
            onRemoveStudent={toggleInFolder}
            onBack={() => { setSavedView(false); mainRef.current?.scrollTo({ top: 0 }); }}
            onOpenReport={openReport}
            savedCount={savedIds.size}
          />
        ) : (
        <>
        <PageHead
          tier="ad"
          eyebrow="Fetch-X · Admin Console"
          title="Admin Dashboard"
          subtitle={`Admin · Data management for the ${schoolLabel} campus — students, staff, and classes`}
          searchSlot={(
            <GlobalSearch
              inputRef={gsInputRef}
              classesAll={(classes || []).map((c) => ({ id: c.id, name: clsName(c) }))}
              teachers={teachers || []}
              subjects={subjects}
              studentFetcher={adminStudentFetcher}
              placeholder={stats ? `Search ${stats.students} students, ${stats.teachers} staff, classes…` : 'Search students, staff, classes…'}
              onOpenClass={openClassById}
              onOpenStudent={openReport}
              onOpenTeacher={(t) => setTeacherId(t.id)}
            />
          )}
          actions={(
            <button type="button" className="btn-mode" onClick={toggle} aria-label="Toggle theme" title="Dark / light mode">
              {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
            </button>
          )}
        />

        <Tier tier="ad" extraClass={`tier-ad${tierCollapsed ? ' collapsed' : ''}`}>
          <TierBand
            tier="ad" lvl={1} icon={TIER_ICONS.ad}
            eyebrow="TIER 01 · DATA MANAGEMENT"
            copy={`Students, staff, and classes — school data management for ${schoolLabel}.`}
            tag={`${SHORT} · DATA MANAGEMENT`}
            collapsible
            collapsed={tierCollapsed}
            onToggleCollapse={() => setTierCollapsed((c) => !c)}
          />

          {!rosterCls && (
            <>
              {/* ============ 01 ADMIN DASHBOARD ============ */}
              <section className="lvl lvl-1 first" id="adDashSec">
                <header className="lvl-head">
                  <span className="lvl-num">01</span>
                  <div className="lvl-tt">
                    <h2>Admin Dashboard</h2>
                    <p>School-wide management summary — enrolment, ranking, attendance, tasks and marks.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{SHORT} · LIVE DATA</span>
                  <ThemeBtn lvl={1} />
                </header>
                <div className="card card-stats fade" id="adDashStats">
                  {!stats || statsErr ? (
                    statsErr ? (
                      <InlineErr
                        msg="Could not load school stats."
                        onRetry={() => {
                          setStatsErr(false);
                          fetchStats().then((d) => { setStats(d); setStatsErr(false); })
                            .catch((e) => { setStatsErr(true); showToast(errOf(e, 'Could not load school stats.'), 'error'); });
                        }}
                      />
                    ) : (
                      <SkelStats />
                    )
                  ) : (
                    <>
                      <div className="stat-cell">
                        <div className="ic">{ICO_STU_TOTAL}</div>
                        <div><div className="k">TOTAL STUDENTS</div><div className="v">{stats.students}</div></div>
                      </div>
                      <div className="stat-cell">
                        <div className="ic">{ICO_CLS_TOTAL}</div>
                        <div><div className="k">TOTAL CLASSES</div><div className="v">{stats.classes}</div></div>
                      </div>
                      <div className="stat-cell sep">
                        <div className="ic">{ICO_RANK}</div>
                        <div><div className="k">SCHOOL RANKING</div><div className="v">#{stats.school_rank}<span className="of">/{stats.school_rank_of}</span></div></div>
                      </div>
                      <div className="stat-cell">
                        <div className="ic">{ICO_ATT}</div>
                        <div><div className="k">ATTENDANCE (AVG)</div><div className="v">{Math.round(stats.attendance_pct)}%</div></div>
                      </div>
                      <div className="stat-cell">
                        <div className="ic">{ICO_TASKS}</div>
                        <div><div className="k">TASK COMPLETION (AVG)</div><div className="v">{Math.round(stats.task_completion_pct)}%</div></div>
                      </div>
                      <div className="stat-cell sep">
                        <div className="ic">{ICO_MARKS}</div>
                        <div><div className="k">AVERAGE MARKS</div><div className="v">{Math.round(stats.avg_score)}%</div></div>
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* ============ 02 CLASSES ============ */}
              <section className="lvl lvl-2" id="adClassSec">
                <header className="lvl-head">
                  <span className="lvl-num">02</span>
                  <div className="lvl-tt">
                    <h2>Classes</h2>
                    <p>All {classes?.length ?? 30} classes grouped by grade — no academic data, just enrolment. Click a class to view its students.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{classes?.length ?? '—'} CLASSES · 10 GRADES</span>
                  <ThemeBtn lvl={2} />
                </header>
                <div className="rank-tabs fade" id="adGradeTabs">
                  <button type="button" className={`gtab${gradeTab === 'all' ? ' active' : ''}`} onClick={() => setGradeTab('all')}>ALL</button>
                  {GRADES.map((g) => (
                    <button type="button" key={g} className={`gtab${gradeTab === g ? ' active' : ''}`} onClick={() => setGradeTab(g)}>G{g}</button>
                  ))}
                </div>
                <div id="adClassWrap">
                  {classesErr && (
                    <InlineErr msg="Could not load classes." onRetry={boot} />
                  )}
                  {GRADES.map((g) => {
                    const list = (classes || []).filter((c) => c.grade === g);
                    if (classes && !list.length) return null;
                    const hidden = gradeTab !== 'all' && gradeTab !== g;
                    return (
                      <div key={g} className="grade-block" data-grade={g} style={hidden ? { display: 'none' } : undefined}>
                        <div className="grade-label">GRADE {g}</div>
                        <div className="class-grid">
                          {!classes
                            ? Array.from({ length: 3 }, (_, i) => (
                              <div className="card s-card" key={i} aria-hidden="true">
                                <div className="pd-skel line" style={{ width: '55%' }} />
                                <div className="pd-skel line" style={{ width: '35%' }} />
                              </div>
                            ))
                            : list.map(classCard)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ============ 03 STAFF LIST ============ */}
              <section className="lvl lvl-3" id="adStaffSec">
                <header className="lvl-head">
                  <span className="lvl-num">03</span>
                  <div className="lvl-tt">
                    <h2>Staff List</h2>
                    <p>Every teaching staff member at {schoolLabel} — click a row for the faculty report, use the arrow to edit.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{staffCount} STAFF · CLICK FOR DETAILS</span>
                  <ThemeBtn lvl={3} />
                </header>
                <div className="searchbar fade">
                  {ICO_SEARCH}
                  <input
                    type="text"
                    value={staffQ}
                    onChange={(e) => setStaffQ(e.target.value)}
                    placeholder="Search by staff name or subject — e.g. “Kavita” or “Mathematics”"
                    autoComplete="off"
                  />
                  <span className="count">
                    {staffRows ? (staffQ.trim() ? match(staffRows.length) : `${staffRows.length} STAFF`) : 'STAFF'}
                  </span>
                  <ExportCsvButton
                    fetcher={exportStaffCsv}
                    disabled={!staffCount}
                    onDone={(n) => showToast(`${n} staff exported as CSV`)}
                    onError={() => showToast('The CSV export failed — try again', 'error')}
                  />
                </div>
                <div className="st-list-wrap fade">
                  <div className="st-scroll">
                    <div className="st-head">
                      <span style={{ gridColumn: '1/3' }}>NAME</span><span>SUBJECT</span><span className="r">CLASSES</span><span>ACTIONS</span>
                    </div>
                    {!teachers ? (
                      <SkelRows />
                    ) : teachersErr ? (
                      <InlineErr msg="Could not load the staff list." onRetry={boot} />
                    ) : staffRows.length === 0 ? (
                      <div className="noresult" style={{ display: 'block' }}>No staff match your search.</div>
                    ) : (
                      staffRows.map(staffRow)
                    )}
                  </div>
                </div>
              </section>

              {/* ============ 04 ALL STUDENTS ============ */}
              <section className="lvl lvl-4" id="adStuSec">
                <header className="lvl-head">
                  <span className="lvl-num">04</span>
                  <div className="lvl-tt">
                    <h2>All Students</h2>
                    <p>Every student at {schoolLabel} in one list — click a row for the report card, or use ✕ to remove.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{stuCount ?? '—'} STUDENTS · CLICK FOR DETAILS</span>
                  <ThemeBtn lvl={4} />
                </header>
                <div className="searchbar fade">
                  {ICO_SEARCH}
                  <input
                    type="text"
                    value={stQ}
                    onChange={(e) => setStQ(e.target.value)}
                    placeholder="Search by student name or class — e.g. “Ananya” or “5-Sapphire”"
                    autoComplete="off"
                  />
                  <span className="count">
                    {stRows ? (stQ.trim() ? match(stTotal) : `${stTotal} STUDENTS`) : 'STUDENTS'}
                  </span>
                  <ExportCsvButton
                    fetcher={exportStudentsCsv}
                    disabled={!stTotal}
                    onDone={(n) => showToast(`${n} students exported as CSV`)}
                    onError={() => showToast('The CSV export failed — try again', 'error')}
                  />
                </div>
                <div className="st-list-wrap fade">
                  <div className="st-scroll" onScroll={onStudentsScroll}>
                    <div className="st-head">
                      <span style={{ gridColumn: '1/3' }}>NAME</span><span>GRADE</span><span className="r">SECTION</span><span>ACTIONS</span>
                    </div>
                    {stLoading && !stRows ? (
                      <SkelRows />
                    ) : stErr && !stRows ? (
                      <InlineErr msg={stErr} onRetry={() => loadStudents({ q: stQ, page: 1 })} />
                    ) : stRows.length === 0 ? (
                      <EmptyState
                        title="No students match this search"
                        hint="Search by name or class — e.g. “Ananya” or “5-Sapphire”."
                      />
                    ) : (
                      <>
                        {stRows.map((s) => studentRow(s))}
                        {(stMore || stErr) && (
                          <div style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>
                            {stMore ? 'Loading more…' : `${stErr} — retry by scrolling again or refining the search.`}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ============ 02b · CLASS ROSTER (adClsSec pattern) ============ */}
          {rosterCls && (
            <section className="lvl lvl-2" id="adClsSec">
              <header className="lvl-head">
                <div className="lvl-tt">
                  <h2>{clsName(rosterCls)}</h2>
                  <p>All students of {clsName(rosterCls)} — same list as All Students. Click a row for details.</p>
                </div>
                <span className="lvl-rule" />
                <span className="lvl-tag">{roLoading && !roRows ? '…' : roTotal} STUDENTS · CLICK FOR DETAILS</span>
                <div className="dm-act">
                  <button
                    type="button" className="ct-btn solid"
                    onClick={() => setAddModal({ mode: 'one', cls: rosterCls })}
                  >
                    + ADD STUDENT
                  </button>
                  <button
                    type="button" className="ct-btn"
                    onClick={() => setAddModal({ mode: 'bulk', cls: rosterCls })}
                  >
                    + ADD BULK
                  </button>
                </div>
                <ThemeBtn lvl={2} />
              </header>
              <button type="button" className="btn-back" onClick={closeRoster}>← BACK TO CLASSES</button>
              <div className="searchbar fade">
                {ICO_SEARCH}
                <input
                  type="text"
                  value={roQ}
                  onChange={(e) => setRoQ(e.target.value)}
                  placeholder="Search students in this class…"
                  autoComplete="off"
                />
                <span className="count">
                  {roRows ? (roQ.trim() ? match(roTotal) : `${roTotal} STUDENTS`) : 'STUDENTS'}
                </span>
                <ExportCsvButton
                  fetcher={exportRosterCsv}
                  disabled={!roTotal}
                  onDone={(n) => showToast(`${n} students exported as CSV`)}
                  onError={() => showToast('The CSV export failed — try again', 'error')}
                />
              </div>
              <div className="st-list-wrap fade">
                <div className="st-scroll" onScroll={onRosterScroll}>
                  <div className="st-head adm-roster">
                    <span>#</span><span>STUDENT NAME</span><span>EDIT</span><span>REMOVE</span>
                  </div>
                  {roLoading && !roRows ? (
                    <SkelRows />
                  ) : roErr && !roRows ? (
                    <InlineErr msg={roErr} onRetry={() => loadRoster({ cls: rosterCls, q: roQ, page: 1 })} />
                  ) : roRows && roRows.length === 0 ? (
                    <EmptyState
                      title="No students in this roster match"
                      hint="Try another spelling, or clear the search to see the whole class."
                    />
                  ) : (
                    <>
                      {(roRows || []).map((s, i) => studentRow(s, { roster: true, idx: i }))}
                      {(roMore || (roErr && roRows)) && (
                        <div style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: 'var(--muted)' }}>
                          {roMore ? 'Loading more…' : `${roErr}`}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          )}
        </Tier>
        </>
        )}
      </main>

      {/* ---------------- v17 · add student / add bulk ---------------- */}
      {addModal?.mode === 'one' && (
        <AddStudentModal
          cls={addModal.cls}
          schoolName={SCHOOL || '—'}
          onClose={() => setAddModal(null)}
          onCreated={onStudentCreated}
        />
      )}
      {addModal?.mode === 'bulk' && (
        <AddBulkModal
          cls={addModal.cls}
          schoolName={SCHOOL || '—'}
          onClose={() => setAddModal(null)}
          onCreated={onStudentCreated}
        />
      )}

      {/* ---------------- edit modals ---------------- */}
      {editStaff && (
        <EditStaffModal
          staff={editStaff}
          schoolName={SCHOOL || '—'}
          subjects={subjects}
          classes={classes || []}
          onClose={() => setEditStaff(null)}
          onSaved={onStaffSaved}
        />
      )}
      {editStu && (
        <EditStudentModal
          student={editStu}
          schoolName={SCHOOL || '—'}
          onClose={() => setEditStu(null)}
          onSaved={(upd) => onStudentSaved(editStu, upd)}
        />
      )}

      {/* ---------------- v17 · bookmark folder picker (designer .bm-pop) -- */}
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
                  const next = createStudentFolder(folders, bmNew);
                  if (next) {
                    setFolders(toggleStudentInFolder(next, next[next.length - 1].id, bmPop.student.id));
                    setBmNew('');
                  }
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const next = createStudentFolder(folders, bmNew);
                if (next) {
                  setFolders(toggleStudentInFolder(next, next[next.length - 1].id, bmPop.student.id));
                  setBmNew('');
                }
              }}
              aria-label="Create folder and save"
            >
              <Plus strokeWidth={2.6} />
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* ---------------- v17 · report modals (portaled) ----------------
          ReportCardModal → GET /principal/student-report/{id} and
          TeacherReportModal → GET /principal/teacher-report/{id}; both
          routes allow school_admin (verified in principal.py), so the
          modals keep their default fetchers. */}
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
          onOpenClass={openClassById}
          onOpenReport={openReport}
          onBookmark={onBookmark}
          totalClasses={(classes || []).length}
        />,
        document.body,
      )}

      {/* ---------------- toast ---------------- */}
      <AnimatePresence>
        {toast && (
          <Toast
            key={toast.key}
            message={toast.msg}
            type={toast.type}
            duration={toast.dur || 2600}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
