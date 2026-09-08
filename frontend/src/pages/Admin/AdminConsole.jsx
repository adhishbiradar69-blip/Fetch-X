/* Fetch-X — Admin Console (designer v16 "admin.html" ported to live data).
   Route /admin/dashboard (Task 3-b). Single tier build like the designer:
   the AD tier band stays fused on top of four stacked level sections —
     01 Admin Dashboard · .card-stats (6 cells) ← GET /admin/stats
     02 Classes · grade tabs → grade-blocks of class cards ← GET /admin/classes
        └ roster view (adClsSec pattern, server-paginated ?class_id=)
     03 Staff List · search + rows ← GET /principal/teachers
        └ Edit Staff modal → PUT /admin/staff/{id}
     04 All Students · search + rows ← GET /admin/students (page/page_size)
        └ Edit Student modal → PUT /admin/students/{id}
        └ ✕ deletes IMMEDIATELY (no confirm — hard delete backend) with an
          honest "{name} removed" toast (8s auto-dismiss, no undo promise).
   The pagehead gsearch mirrors the designer's global-search popover simply:
   live class + staff matches, and Enter / the STUDENTS entry jumps to
   All Students with the query applied (server-side ?search=).
   Old pages /admin/accounts + /admin/extra-teachers stay reachable by URL
   only — they are not part of the designer's sidebar. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
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
  fetchStats, fetchTeachers, fetchClasses, fetchSubjects, fetchStudentsPage,
  fetchClassCount, deleteStudent, initialsOf, subjectShort, errOf,
} from './admin16/api';
import {
  ICO_SEARCH, ICO_PERSON, ICO_EDIT, ICO_X, ICO_ARROW,
  ICO_STU_TOTAL, ICO_CLS_TOTAL, ICO_RANK, ICO_ATT, ICO_TASKS, ICO_MARKS,
} from './admin16/icons';
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

  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = 'success', dur) => {
    setToast({ msg, type, dur, key: Date.now() });
  }, []);

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
      if (rosterCls) return;
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
  }, [rosterCls]);

  const scrollSec = useCallback((id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const onNav = useCallback((key) => {
    const id = NAV_OF[key];
    if (!id) return;
    if (rosterCls) {
      setRosterCls(null);
      requestAnimationFrame(() => scrollSec(id));
    } else {
      scrollSec(id);
    }
  }, [rosterCls, scrollSec]);

  /* ---------------- 02 classes ---------------- */
  const [gradeTab, setGradeTab] = useState('all');

  const openRoster = useCallback((c) => {
    setRoRows(null);
    setRoQ('');
    setRosterCls(c);
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const closeRoster = useCallback(() => {
    setRosterCls(null);
    requestAnimationFrame(() => scrollSec('adClassSec'));
  }, [scrollSec]);

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

  /* ---------------- global search (designer gsearch, honest helper) ------- */
  const [gsQ, setGsQ] = useState('');
  const [gsOpen, setGsOpen] = useState(false);
  const gsRef = useRef(null);
  const gsInputRef = useRef(null);
  const q = gsQ.trim().toLowerCase();

  const gsCls = useMemo(() => (
    q && classes ? classes.filter((c) => clsName(c).includes(q)).slice(0, 4) : []
  ), [q, classes]);
  const gsTch = useMemo(() => (
    q && teachers ? teachers.filter((t) => `${t.name} ${t.subject || ''}`.toLowerCase().includes(q)).slice(0, 4) : []
  ), [q, teachers]);

  const jumpStudents = useCallback((raw) => {
    setGsOpen(false);
    setGsQ('');
    setStQ(raw.trim());
    if (rosterCls) {
      setRosterCls(null);
      requestAnimationFrame(() => scrollSec('adStuSec'));
    } else {
      scrollSec('adStuSec');
    }
  }, [rosterCls, scrollSec]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        gsInputRef.current?.focus();
        gsInputRef.current?.select?.();
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        gsInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDown = (e) => { if (!gsRef.current?.contains(e.target)) setGsOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
      title="Edit student — name, class, section, details"
      onClick={() => setEditStu(s)}
    >
      {opts.roster && <span className="adm-idx">{opts.idx + 1}</span>}
      <span className="st-name" style={opts.roster ? undefined : { gridColumn: '1/3' }}>
        <span className="nm" style={opts.roster ? undefined : { fontSize: 13 }}>{s.name}</span>
        {opts.roster && <span className="classchip" style={{ padding: '4px 8px' }}>{s.section}</span>}
      </span>
      {!opts.roster && <span className="classchip">{s.grade}</span>}
      {!opts.roster && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{s.section || '—'}</span>}
      <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
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
    <div key={`t${t.id}`} className="srow" title="Edit staff details" onClick={() => setEditStaff(t)}>
      <span className="st-name" style={{ gridColumn: '1/3' }}>
        <span className="nm" style={{ fontSize: 13 }}>
          {t.name}{t.is_hod ? ' · HOD' : ''}{t.is_ct ? ' · CT' : ''}
        </span>
      </span>
      <span className="classchip" title={t.subject || ''}>{subjectShort(t.subject)}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.classes_count} cls</span>
      <button type="button" className="tb" title="Edit staff details">{ICO_ARROW}</button>
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
      <DashSidebar
        logo
        roleLabel="ADMIN"
        savedCount={0}
        savedHidden
        active={activeKey}
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
        <PageHead
          tier="ad"
          eyebrow="Fetch-X · Admin Console"
          title="Admin Dashboard"
          subtitle={`Admin · Data management for the ${schoolLabel} campus — students, staff, and classes`}
          searchSlot={(
            <div className="pagehead-mid gsearch" ref={gsRef}>
              {ICO_SEARCH}
              <input
                ref={gsInputRef}
                type="text"
                value={gsQ}
                placeholder={stats ? `Search ${stats.students} students, ${stats.teachers} staff, classes…` : 'Search students, staff, classes…'}
                onChange={(e) => { setGsQ(e.target.value); setGsOpen(true); }}
                onFocus={() => { if (gsQ.trim()) setGsOpen(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter') jumpStudents(gsQ); }}
                autoComplete="off"
                aria-label="Global search"
              />
              <kbd>Ctrl K</kbd>
              {gsOpen && q && (
                <div className="gs-pop open" onMouseDown={(e) => e.preventDefault()}>
                  {gsCls.length > 0 && (
                    <>
                      <div className="gs-sec">CLASSES</div>
                      {gsCls.map((c) => (
                        <div key={`gsc${c.id}`} className="gs-item" onClick={() => { setGsOpen(false); setGsQ(''); openRoster(c); }}>
                          <span className="gi">◆</span>{clsName(c)}
                          <span className="gs">{clsCounts[c.id] ?? '…'} students</span>
                        </div>
                      ))}
                    </>
                  )}
                  {gsTch.length > 0 && (
                    <>
                      <div className="gs-sec">TEACHERS</div>
                      {gsTch.map((t) => (
                        <div key={`gst${t.id}`} className="gs-item" onClick={() => { setGsOpen(false); setGsQ(''); setEditStaff(t); }}>
                          <span className="avatar">{initialsOf(t.name)}</span>{t.name}
                          <span className="gs">{t.subject || '—'} · #{t.rank}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="gs-sec">STUDENTS</div>
                  <div className="gs-item" onClick={() => jumpStudents(gsQ)}>
                    <span className="gi">▣</span>Search students for “{gsQ.trim()}”
                    <span className="gs">ALL STUDENTS →</span>
                  </div>
                </div>
              )}
            </div>
          )}
          actions={(
            <button type="button" className="btn-mode" onClick={toggle} aria-label="Toggle theme" title="Dark / light mode">
              {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
            </button>
          )}
        />

        <Tier tier="ad" extraClass="tier-ad">
          <TierBand
            tier="ad" lvl={1} icon={TIER_ICONS.ad}
            eyebrow="TIER 01 · DATA MANAGEMENT"
            copy={`Students, staff, and classes — school data management for ${schoolLabel}.`}
            tag={`${SHORT} · DATA MANAGEMENT`}
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
                    <p>Every teaching staff member at {schoolLabel} — click a row to view details, credentials, and edit.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{staffCount} STAFF · CLICK FOR DETAILS</span>
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
                    <p>Every student at {schoolLabel} in one list — click a row to edit, or use ✕ to remove.</p>
                  </div>
                  <span className="lvl-rule" />
                  <span className="lvl-tag">{stuCount ?? '—'} STUDENTS · CLICK FOR DETAILS</span>
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
      </main>

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
