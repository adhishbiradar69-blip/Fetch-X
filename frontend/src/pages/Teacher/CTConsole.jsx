/* CTConsole — designer v16 "class-teacher.html" port (Sep 7 role build).
   Route /teacher/console. Standalone console = DashSidebar(ct standalone,
   logo + "CLASS TEACHER · {CLASS}" group + "CLASS TEACHER · SIGN OUT") +
   v16 pagehead (.ph-tt.tier-ct) + ONE .tier.tier-ct whose .tier-band sits
   fused above the page sections. No AI rail — the v16 CT build has none
   (dual-mode embedding is covered by .pd-root.ct-root CSS, which hides the
   principal shell's .rightbar/.ai-handle/.ai-fab).

   Pages (all wired to the real backend — keep the endpoints):

     ctHome   My Class            → /ct/class-dashboard (full class view)
     ctAtt    Attendance          → /attendance/*  (P/A/L register per date)
     ctTask   Task Completion     → /tasks/*       (term-wise, tick students)
     ctMarks  Academic Marks      → /academics/*   (per-term marks grid)
     ctTeach  Teaching Classes    → /ct/teaching-classes
     ctMy     My Report           → /ct/teacher-report (via report modal)
     ctTT     Timetable           → /timetable/teacher/{me}

   v17 designer-port delta: wired bookmarks + Saved view (shared 'fx-folders'
   store), console global search in the pagehead (Ctrl K / "/"), a Saved nav
   entry (via DashSidebar's groups API) and the school name on the tier tag
   (/ct/me now returns school). ACADEMIC PERFORMANCE / COMPARE are honestly
   skipped: /principal/radar + /principal/compare are leadership-gated. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Bookmark, GraduationCap, Menu, Moon, Plus, Sun } from 'lucide-react';
import {
  fetchCtClassDashboard, fetchCtMe, fetchCtTeachingClasses,
} from '../Principal/dashboard/data';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth } from '../../auth/AuthContext';
import { Toast } from '../../components/ui';
import DashSidebar from '../Principal/dashboard/DashSidebar';
import ClassDetail from '../Principal/dashboard/ClassDetail';
import { LevelThemeStyle } from '../Principal/dashboard/LevelThemes';
import { PersonalTimetable } from '../Principal/dashboard/Timetable';
import { BarChart, Distro, useReveal } from '../Principal/dashboard/charts';
import { SectionHead, Chip } from '../Principal/dashboard/Sections';
import ReportCardModal from '../Principal/dashboard/ReportCardModal';
import TeacherReportModal from '../Principal/dashboard/TeacherReportModal';
import { PageHead, TierBand, Tier } from '../../components/v16/Shell';
import { TIER_ICONS } from '../../components/v16/icons';
import ExportCsvButton from '../../components/v16/ExportCsvButton';
import api from '../../api/client';
import GlobalSearch from '../Principal/dashboard/GlobalSearch';
import SavedStudents from '../Principal/dashboard/SavedStudents';
import { bandOf, initials, loadFolders, mean, pct, saveFolders } from '../Principal/dashboard/util';
import '../Principal/dashboard/dashboard.css';
import '../Principal/dashboard/v15.css';
import '../Principal/dashboard/v16.css';

const TODAY = () => new Date().toISOString().slice(0, 10);

/* designer attendance-card icons (class-teacher.html renderAtt) */
const ATT_ICONS = {
  total: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-5 8 5v13" /><path d="M2 21h20M9.5 21v-4h5v4" /></svg>
  ),
  present: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5l5 5 10-11" /></svg>
  ),
  absent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  late: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
};

/* subject SHORT names for the marks-grid header cells — mirrors the
   backend timetable router's `_short()` so the grid reads MATH / SCI /
   ENG … like the designer's (40px + name + N×64px + 60px grid). */
const SUBJ_SHORT = {
  MATHEMATICS: 'MATH', MATHS: 'MATH', MATH: 'MATH',
  SCIENCE: 'SCI', ENGLISH: 'ENG', HINDI: 'HINDI',
  SOCIAL: 'SOCIAL', 'SOCIAL STUDIES': 'SOCIAL',
  COMPUTER: 'COMP', 'COMPUTER SCIENCE': 'COMP',
  'PHYSICAL EDUCATION': 'PE', PHYSICAL: 'PE',
};
const subjShort = (name) => SUBJ_SHORT[String(name || '').trim().toUpperCase()]
  || String(name || '').slice(0, 6).toUpperCase();

/* ─────────────────────────────── 02 ATTENDANCE ─────────────────────────── */
function CTAttendance({ cls }) {
  const [date, setDate] = useState(TODAY);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/attendance/class/${cls.id}`, { params: { date } })
      .then((r) => { if (alive) { setRows(r.data.students || []); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [cls.id, date]);

  const save = async (marks) => {
    try {
      await api.post('/attendance/mark', { class_id: cls.id, date, marks });
      // refetch so the tapped pill and the P/A/L counters reflect the save
      // (the old load() callback was a no-op and the register never updated)
      const r = await api.get(`/attendance/class/${cls.id}`, { params: { date } });
      setRows(r.data.students || []);
      setErr(false);
    } catch { setErr(true); }
  };
  const cycle = (s) => {
    const cur = s.status === 'P' ? 'P' : s.status === 'A' ? 'A' : s.status === 'L' ? 'L' : null;
    const next = cur === 'P' ? 'A' : cur === 'A' ? 'L' : cur === 'L' ? 'P' : 'P';
    save([{ student_id: s.id, status: next }]);
  };
  const setAll = (st) => save((rows || []).map((s) => ({ student_id: s.id, status: st })));

  /* EXPORT CSV — the day's register exactly as marked (P/A/L/unmarked). */
  const exportRegisterCsv = async () => ({
    filename: `fetchx-attendance-${cls.name}-${date}.csv`,
    headers: ['#', 'STUDENT NAME', 'STATUS'],
    rows: (rows || []).map((s, i) => {
      const st = s.status && ['P', 'A', 'L'].includes(s.status) ? s.status : '';
      return [i + 1, s.name, st === 'P' ? 'PRESENT' : st === 'A' ? 'ABSENT' : st === 'L' ? 'LATE' : 'NOT MARKED'];
    }),
  });

  const P = (rows || []).filter((s) => s.status === 'P').length;
  const A = (rows || []).filter((s) => s.status === 'A').length;
  const L = (rows || []).filter((s) => s.status === 'L').length;
  const T = (rows || []).length;
  const gridCols = { gridTemplateColumns: '48px minmax(0,1fr) 150px' };

  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Attendance"
        sub="Mark daily attendance for your class."
        tag="DAILY REGISTER"
      />
      <div className="ct-cards">
        <div className="ct-card">
          <span className="cic" style={{ background: 'var(--lav)', color: '#4f42dd' }}>{ATT_ICONS.total}</span>
          <div className="cnum">{T || '—'}</div>
          <div className="ck">TOTAL STUDENTS</div>
        </div>
        <div className="ct-card">
          <span className="cic" style={{ background: '#e3f5ed', color: '#0e9f6e' }}>{ATT_ICONS.present}</span>
          <div className="cnum" style={{ color: '#0e9f6e' }}>{rows ? P : '—'}</div>
          <div className="ck">PRESENT TODAY</div>
          <div className="cbar"><i style={{ background: '#0e9f6e', width: T ? `${(P / T) * 100}%` : 0 }} /></div>
        </div>
        <div className="ct-card">
          <span className="cic" style={{ background: '#fce8e8', color: '#dc2626' }}>{ATT_ICONS.absent}</span>
          <div className="cnum" style={{ color: '#dc2626' }}>{rows ? A : '—'}</div>
          <div className="ck">ABSENT TODAY</div>
          <div className="cbar"><i style={{ background: '#dc2626', width: T ? `${(A / T) * 100}%` : 0 }} /></div>
        </div>
        <div className="ct-card">
          <span className="cic" style={{ background: '#fcf0dd', color: '#d97706' }}>{ATT_ICONS.late}</span>
          <div className="cnum" style={{ color: '#d97706' }}>{rows ? L : '—'}</div>
          <div className="ck">LATE TODAY</div>
          <div className="cbar"><i style={{ background: '#d97706', width: T ? `${(L / T) * 100}%` : 0 }} /></div>
        </div>
      </div>
      <div className="ct-toolbar">
        <label htmlFor="ct-att-date">DATE</label>
        <input id="ct-att-date" type="date" value={date} max={TODAY()} onChange={(e) => setDate(e.target.value || TODAY())} />
        <span className="sp" />
        <button type="button" className="ct-btn solid" onClick={() => setAll('P')}>✓ ALL PRESENT</button>
        <button type="button" className="ct-btn" onClick={() => setAll('A')}>✕ ALL ABSENT</button>
        <ExportCsvButton fetcher={exportRegisterCsv} disabled={!rows} title="Download the day's register as a CSV file" />
      </div>
      <div className="st-list-wrap">
        <div className="st-scroll" style={{ maxHeight: 520 }}>
          <div className="st-head" style={gridCols}><span>#</span><span>STUDENT NAME</span><span style={{ textAlign: 'right' }}>STATUS</span></div>
          {err && <div className="noresult">The register could not be loaded.</div>}
          {!err && !rows && <div className="pd-note">Loading register…</div>}
          {(rows || []).map((s, i) => {
            const st = s.status && ['P', 'A', 'L'].includes(s.status) ? s.status : null;
            const lab = st === 'P' ? '✓ PRESENT' : st === 'A' ? '✕ ABSENT' : st === 'L' ? '⏰ LATE' : '○ NOT MARKED';
            return (
              <div className="srow" style={gridCols} key={s.id}>
                <span className="rankbadge">{i + 1}</span>
                <span className="st-name"><span className="avatar">{initials(s.name)}</span><span className="nm">{s.name}</span></span>
                <span style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className={`stpill${st ? ` ${st}` : ''}`}
                    style={st ? undefined : { background: 'var(--track)', color: 'var(--muted)' }}
                    onClick={() => cycle(s)}
                  >
                    {lab}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 03 TASKS ──────────────────────────────── */
function CTTasks({ cls }) {
  const [term, setTerm] = useState(1);
  const [tasks, setTasks] = useState(null);
  const [subjects, setSubjects] = useState([]);
  /* designer renders the task form expanded at the top of the page */
  const [formOpen, setFormOpen] = useState(true);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [subId, setSubId] = useState(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    api.get(`/tasks/class/${cls.id}`)
      .then((r) => { setTasks(r.data || []); setErr(false); })
      .catch(() => setErr(true));
  }, [cls.id]);
  useEffect(() => {
    let alive = true;
    api.get(`/tasks/class/${cls.id}`)
      .then((r) => { if (alive) setTasks(r.data || []); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [cls.id]);
  useEffect(() => {
    api.get('/tasks/subjects').then((r) => {
      setSubjects(r.data || []);
      if (r.data?.length) setSubId((cur) => cur ?? r.data[0].id);
    }).catch(() => {});
  }, []);

  const list = useMemo(() => (tasks || []).filter((t) => (t.term || 1) === Number(term)), [tasks, term]);

  const setStatus = async (task, s) => {
    const next = s.status === 'completed' ? 'pending' : 'completed';
    try {
      await api.post('/tasks/status', { task_id: task.task_id, student_id: s.id, status: next });
      setTasks((p) => p.map((t) => (t.task_id === task.task_id
        ? { ...t, students: t.students.map((x) => (x.id === s.id ? { ...x, status: next } : x)) }
        : t)));
    } catch { setErr(true); }
  };
  const markAll = async (task, st) => {
    try {
      await Promise.all(task.students.map((s) => api.post('/tasks/status', { task_id: task.task_id, student_id: s.id, status: st })));
      load();
    } catch { setErr(true); }
  };
  const del = async (task) => {
    try { await api.delete(`/tasks/${task.task_id}`); load(); } catch { setErr(true); }
  };
  const create = async () => {
    if (!title.trim() || !subId) return;
    try {
      await api.post('/tasks/', { title: title.trim(), due_date: due || null, class_id: cls.id, subject_id: subId, term });
      setTitle(''); setDue(''); setFormOpen(false);
      load();
    } catch { setErr(true); }
  };

  const termTabs = (
    <div className="ctabs">
      {[1, 2, 3].map((k) => (
        <button key={k} type="button" className={`gtab${Number(term) === k ? ' active' : ''}`} onClick={() => setTerm(k)}>Term {k}</button>
      ))}
    </div>
  );

  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Task Completion"
        sub="Create assignments and tick off students as they complete them."
        actions={termTabs}
      />
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="ct-btn solid" onClick={() => setFormOpen((o) => !o)}>+ NEW TASK</button>
      </div>
      {formOpen && (
        <div className="tform">
          <div className="tf-head">TASK DETAILS · TERM {term}</div>
          <label className="tf-label" htmlFor="ct-task-title">TASK NAME *</label>
          <input id="ct-task-title" type="text" placeholder="e.g., Chapter 5 Exercise, Science Project..." value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="tf-label">SUBJECT *</div>
          <div className="subj-pills">
            {subjects.map((s) => (
              <button key={s.id} type="button" className={`spill${subId === s.id ? ' active' : ''}`} onClick={() => setSubId(s.id)}>{s.name}</button>
            ))}
          </div>
          <label className="tf-label" htmlFor="ct-task-due">DUE DATE</label>
          <input id="ct-task-due" type="date" style={{ maxWidth: 230 }} value={due} onChange={(e) => setDue(e.target.value)} />
          <div className="tf-hint">Optional — leave blank if no deadline</div>
          <div className="tf-actions">
            <button type="button" className="ct-btn" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary" onClick={create}>✓ Create Task</button>
          </div>
        </div>
      )}
      {err && <div className="pd-note">A task action failed — check the backend and retry.</div>}
      {!tasks && !err && <div className="pd-skel tall" />}
      {tasks && !list.length && (
        <div className="empty-panel">
          <span className="ep-t">NO TASKS IN TERM {term}</span>
          <span className="ep-s">Create your first assignment with the + New Task button.</span>
        </div>
      )}
      {list.map((t) => {
        const done = t.students.filter((s) => s.status === 'completed').length;
        const p = t.students.length ? Math.round((done / t.students.length) * 100) : 0;
        return (
          <TaskCard key={t.task_id} task={t} done={done} pctDone={p} onToggle={setStatus} onAll={markAll} onDelete={del} />
        );
      })}
    </section>
  );
}

function TaskCard({ task, done, pctDone, onToggle, onAll, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="task-card">
      <div className="task-top">
        <div style={{ minWidth: 0 }}>
          <span className="task-sub">{String(task.subject?.name || 'General').toUpperCase()}</span>
          {task.due_date && <span className="task-due">Due {task.due_date}</span>}
          <div className="task-title">{task.title}</div>
        </div>
        <div className="task-pct"><b>{pctDone}%</b><span>{done}/{task.students.length} DONE</span></div>
        <button type="button" className="task-ic" title="Delete task" onClick={() => onDelete(task)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
        </button>
        <button type="button" className={`task-ic car${open ? ' open' : ''}`} title="Tick students" onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>
      <div className="task-cbar"><i style={{ width: `${pctDone}%` }} /></div>
      <div className={`task-body${open ? ' open' : ''}`}>
        <div className="task-body-top">
          <button type="button" className="ct-btn" onClick={() => onAll(task, 'completed')}>✓ MARK ALL DONE</button>
          <button type="button" className="ct-btn" onClick={() => onAll(task, 'pending')}>✕ CLEAR ALL</button>
        </div>
        {task.students.map((s) => (
          <div className="trow" key={s.id} onClick={() => onToggle(task, s)}>
            <span className={`tchk${s.status === 'completed' ? ' on' : ''}`} />
            <span className="nm">{s.name}</span>
            <span className={`tstat${s.status === 'completed' ? ' on' : ''}`}>{s.status === 'completed' ? 'DONE' : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── 04 MARKS ──────────────────────────────── */
function CTMarks({ cls }) {
  const [term, setTerm] = useState(1);
  const [exams, setExams] = useState(null);
  const [grid, setGrid] = useState(null);
  const [err, setErr] = useState(false);
  const [dirty, setDirty] = useState({}); // sid|subid → score

  /* the exam of this grade for the selected term */
  const exam = useMemo(
    () => (exams || []).find((e) => String(e.term).match(/\d/)?.[0] === String(term)) || null,
    [exams, term],
  );

  useEffect(() => {
    api.get(`/academics/class/${cls.id}/exams`).then((r) => setExams(r.data || [])).catch(() => setErr(true));
  }, [cls.id]);

  useEffect(() => {
    const run = async () => {
      setGrid(null);
      setDirty({});
      if (!exam) return;
      await api.get(`/academics/class/${cls.id}/marks`, { params: { exam_id: exam.id } })
        .then((r) => setGrid(r.data))
        .catch(() => setErr(true));
    };
    run();
  }, [cls.id, exam]);

  const setVal = (sid, subid, raw) => {
    let v = String(raw).replace(/[^0-9]/g, '');
    if (v !== '' && exam) v = String(Math.min(100, Number(v)));
    setGrid((g) => ({
      ...g,
      students: g.students.map((s) => (s.id === sid ? { ...s, marks: { ...s.marks, [subid]: v === '' ? null : Number(v) } } : s)),
    }));
    setDirty((d) => ({ ...d, [`${sid}|${subid}`]: v === '' ? null : Number(v) }));
  };

  const saveAll = async () => {
    if (!exam || !Object.keys(dirty).length) return;
    const marks = Object.entries(dirty).filter(([, v]) => v != null)
      .map(([k, v]) => { const [sid, subid] = k.split('|').map(Number); return { student_id: sid, subject_id: subid, score: v }; });
    try {
      await api.post('/academics/marks/bulk', { class_id: cls.id, exam_id: exam.id, marks });
      setDirty({});
    } catch { setErr(true); }
  };

  const avg = useMemo(() => {
    if (!grid) return null;
    const vals = [];
    grid.students.forEach((s) => Object.values(s.marks).forEach((v) => { if (v != null && v !== '') vals.push(Number(v)); }));
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }, [grid]);

  const termTabs = (
    <div className="ctabs">
      {[1, 2, 3].map((k) => (
        <button key={k} type="button" className={`gtab${Number(term) === k ? ' active' : ''}`} onClick={() => setTerm(k)}>Term {k}</button>
      ))}
    </div>
  );

  return (
    <section className="lvl lvl-3 compact first">
      <SectionHead
        lvl={3}
        title="Academic Marks"
        sub="Enter subject-wise marks for students in your class, term by term."
        actions={termTabs}
      />
      <div className="ct-cards" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="ct-card"><div className="cnum">{grid ? grid.students.length : '—'}</div><div className="ck">TOTAL STUDENTS</div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#0e9f6e' }}>{avg ?? '--'}</div><div className="ck">CLASS AVERAGE</div></div>
        <div className="ct-card">
          <div className="cnum" style={{ color: 'var(--lvlD)', fontSize: 22 }}>Term {term}</div>
          <div className="ck">ACTIVE TERM{exam ? ` · ${exam.name}` : ''}</div>
        </div>
      </div>
      <div className="ct-toolbar">
        <label htmlFor="ct-marks-exam">EXAM</label>
        <span id="ct-marks-exam" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{exam ? exam.name : '—'}</span>
        <span className="sp" />
        <button type="button" className="ct-btn solid" onClick={saveAll} disabled={!Object.keys(dirty).length}>
          ✓ SAVE{Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}
        </button>
      </div>
      {err && <div className="pd-note">Marks could not be loaded for this term.</div>}
      {exams && !exam && <div className="pd-note">No exam configured for Term {term} in this grade yet.</div>}
      {!grid && exam && !err && <div className="pd-skel tall" />}
      {grid && (
        <div className="mgrid-wrap">
          <div style={{ overflowX: 'auto' }}>
            <div className="st-scroll">
              <div className="mhead">
                <span>#</span><span>STUDENT</span>
                {grid.subjects.map((s) => <span key={s.id}>{subjShort(s.name)}</span>)}
                <span>TOTAL</span>
              </div>
              {grid.students.map((s, i) => {
                const tot = Object.values(s.marks).reduce((a, v) => a + (v != null && v !== '' ? Number(v) : 0), 0);
                return (
                  <div className="mrow" key={s.id}>
                    <span className="rankbadge">{i + 1}</span>
                    <span className="st-name"><span className="nm" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{s.name}</span></span>
                    {grid.subjects.map((sub) => (
                      <input
                        key={sub.id} className="mi" inputMode="numeric" maxLength={3}
                        placeholder="--"
                        value={s.marks[sub.id] ?? ''}
                        onChange={(e) => setVal(s.id, sub.id, e.target.value)}
                        aria-label={`${s.name} ${sub.name}`}
                      />
                    ))}
                    <span className="mtot">{tot || '--'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── 05 TEACHING CLASSES ───────────────────────── */
function CTTeaching({ data, onOpenReport, onOpenClass }) {
  const [sel, setSel] = useState('all');
  const [q, setQ] = useState('');
  const reveal = useReveal();
  const classes = data?.classes || [];
  const tabs = [['all', 'ALL'], ...classes.map((c) => [String(c.id), c.name])];
  const cur = sel === 'all' ? null : classes.find((c) => String(c.id) === sel);
  const cohort = data?.__students || []; // full cohort attached by parent
  const kids = sel === 'all'
    ? cohort
    : cohort.filter((k) => k.class_name === cur?.name);
  const scored = kids.filter((k) => k.score != null);
  const subjAvg = scored.length ? Math.round(mean(scored.map((k) => k.score))) : 0;
  const top = scored.length ? Math.max(...scored.map((k) => k.score)) : 0;
  const best = classes.length
    ? [...classes].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0]
    : null;
  const subjName = data?.teacher?.subject || '';
  const roster = [...scored].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const shown = q.trim()
    ? roster.filter((k) => k.name.toLowerCase().includes(q.trim().toLowerCase()))
    : roster;
  /* v17: bar click → the CT's own class switches to My Class; other classes
     stay inert (their detail is not reachable at the class_teacher role —
     ct.py's _ct_class_of ignores class_id for CT accounts). */
  const cmpBars = classes
    .map((c) => ({ id: c.id, label: c.name, tip: `Class ${c.name} · ${pct(c.avg)}% · overall rank #${c.rank}`, val: pct(c.avg) }))
    .sort((a, b) => b.val - a.val);

  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Teaching Classes"
        sub="Your subject across every class you teach — one at a time or all together."
        tag={`${String(subjName).toUpperCase()} · ${classes.length} CLASSES`}
      />
      <div className="grade-tabs" style={{ marginTop: 0 }}>
        {tabs.map(([v, l]) => (
          <button key={v} type="button" className={`gtab${String(sel) === v ? ' active' : ''}`} onClick={() => setSel(v)}>{l}</button>
        ))}
      </div>
      <div className="ct-cards">
        <div className="ct-card"><div className="cnum">{subjAvg || '—'}</div><div className="ck">SUBJECT AVG</div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#0e9f6e' }}>{top ? `${top}%` : '—'}</div><div className="ck">TOP SCORE</div></div>
        <div className="ct-card"><div className="cnum" style={{ fontSize: 20 }}>{best ? best.name : '—'}</div><div className="ck">BEST CLASS</div></div>
        <div className="ct-card"><div className="cnum">{kids.length}</div><div className="ck">STUDENTS</div></div>
      </div>
      {scored.length > 0 && (
        <div className="card distro-card fade">
          <div className="label">{String(subjName).toUpperCase()} MARK DISTRIBUTION · {kids.length} STUDENTS</div>
          <DistroRaw scores={scored.map((k) => k.score)} />
        </div>
      )}
      {sel !== 'all' && scored.length > 0 && (
        <div className="card chart-card fade">
          <div className="chead"><span className="label">STUDENT MARKS · {String(subjName).toUpperCase()} · CLASS {cur?.name}</span></div>
          <div className="cbody">
            <BarChart
              items={scored
                .map((k) => ({ label: initials(k.name), tip: `${k.name} · ${pct(k.score)}% · rank #${k.rank}`, val: pct(k.score) }))
                .sort((a, b) => b.val - a.val)}
              flat
              topName={scored[0]?.name}
              onClick={(i) => onOpenReport({ id: scored[i].id })}
            />
          </div>
        </div>
      )}
      {sel === 'all' && classes.length > 0 && (
        <div className="card chart-card fade">
          <div className="chead"><span className="label">CLASS COMPARISON · {String(subjName).toUpperCase()} · {classes.length} CLASSES</span></div>
          <div className="cbody">
            <BarChart
              items={cmpBars}
              onClick={(i) => onOpenClass?.(cmpBars[i]?.id)}
            />
          </div>
        </div>
      )}
      <div className="searchbar" style={{ marginTop: 16 }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" aria-label="Search students" />
        <span className="count">
          {q.trim()
            ? `${shown.length} MATCH${shown.length === 1 ? '' : 'ES'}`
            : `${kids.length} STUDENTS`}
        </span>
      </div>
      <div className="st-list-wrap">
        <div className="st-scroll" style={{ maxHeight: 420 }}>
          <div className="st-head"><span>RANK</span><span>STUDENT NAME</span><span>CLASS</span><span className="r">SUBJECT AVG</span></div>
          {shown.map((k) => (
            <div className="srow" key={k.id} role="button" tabIndex={0} onClick={() => onOpenReport({ id: k.id })}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenReport({ id: k.id }); }}>
              <span className="rankbadge">#{k.rank ?? '—'}</span>
              <span className="st-name"><span className="avatar">{initials(k.name)}</span><span className="nm">{k.name}</span></span>
              <span className="classchip">{k.class_name}</span>
              <span className="scorepill">
                <span className="bar"><i data-w={pct(k.score)} style={{ width: reveal ? `${Math.min(100, pct(k.score))}%` : 0 }} /></span>
                <span className="pc">{k.score != null ? `${pct(k.score)}%` : '—'}</span>
              </span>
              <span className="tb" aria-hidden>→</span>
            </div>
          ))}
          {!shown.length && (
            <div className="noresult">
              {q.trim() ? 'No students match your search.' : 'No marks recorded yet for this selection.'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* client-side distribution (bands over arbitrary scores) */
function DistroRaw({ scores }) {
  const bands = [
    { band: '<60', label: '<60' }, { band: '60-69', label: '60–69' }, { band: '70-79', label: '70–79' },
    { band: '80-89', label: '80–89' }, { band: '90-100', label: '90+' },
  ];
  const counts = bands.map((b) => {
    const n = scores.filter((v) => {
      if (b.band === '<60') return v < 60;
      if (b.band === '60-69') return v >= 60 && v < 70;
      if (b.band === '70-79') return v >= 70 && v < 80;
      if (b.band === '80-89') return v >= 80 && v < 90;
      return v >= 90;
    }).length;
    return { ...b, n };
  });
  return <Distro bands={counts} total={scores.length} />;
}

/* ─────────────────────────────── 06 MY REPORT ──────────────────────────── */
function CTMy({ report, onOpenFull }) {
  if (!report?.teacher) return <div className="pd-skel tall" />;
  const t = report.teacher;
  const g = bandOf(Math.round(t.avg ?? 0));
  return (
    <section className="lvl lvl-6 compact first">
      <SectionHead
        lvl={6}
        title="My Report"
        sub="Your own performance report card as this class's teacher."
        tag="CLASS TEACHER REPORT"
      />
      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 16, background: g.soft, color: g.c }}>{initials(t.name)}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)', marginTop: 4 }}>
            {String(t.subject || '').toUpperCase()}
            {t.ct_of ? ` · CLASS TEACHER OF ${String(t.ct_of).toUpperCase()}` : ''}
            {t.is_hod ? ' · HOD' : ''}
          </div>
        </div>
        <span className="grade-pill" style={{ background: g.soft, color: g.c }}>{Math.round(t.avg ?? 0)}% · {g.label}</span>
        <span className="rank-pill">#{t.rank ?? '—'} / {t.of ?? '—'}</span>
        <div className="chips" style={{ margin: '8px 0 0' }}>
          <Chip t="T1" n={pct(t.t1)} /><Chip t="T2" n={pct(t.t2)} /><Chip t="T3" n={pct(t.t3)} />
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="ct-btn solid" onClick={onOpenFull}>⤓ OPEN / DOWNLOAD FULL REPORT CARD</button>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 07 TIMETABLE ──────────────────────────── */
function CTTimetable({ teacherId, teacherName }) {
  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Timetable"
        sub="Your personal teaching schedule — where you are, period by period."
        tag="PERSONAL GRID"
      />
      <PersonalTimetable teacherId={teacherId} label={teacherName ? `Personal timetable · ${teacherName}` : undefined} />
    </section>
  );
}

/* ═════════════════════════════ the console shell ═════════════════════════ */

/* v17 standalone sidebar nav (DashSidebar's v16 groups API). The dedicated
   ct branch renders no Saved entry, so the console passes an explicit group
   with the SAME links / icons / lvl values as that branch (they mirror the
   designer's data-lvl attributes) plus the designer's "Saved" footer item
   (class-teacher.html #savedLink, lvl 5) wired to onGo('saved'). */
const CT_NAV_LINKS = [
  { key: 'ctHome', label: 'My Class', lvl: 3, Icon: GraduationCap },
  { key: 'ctAtt', label: 'Attendance', lvl: 2, Icon: BookOpen },
  { key: 'ctTask', label: 'Task Completion', lvl: 2, Icon: BookOpen },
  { key: 'ctMarks', label: 'Academic Marks', lvl: 3, Icon: BookOpen },
  { key: 'ctTeach', label: 'Teaching Classes', lvl: 2, Icon: GraduationCap },
  { key: 'ctMy', label: 'My Report', lvl: 6, Icon: BookOpen },
  { key: 'ctTT', label: 'Timetable', lvl: 2, Icon: BookOpen },
];

function ModeButton() {
  const { mode, toggle } = useTheme() || {};
  return (
    <button
      type="button" className="btn-mode" onClick={toggle}
      title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
    </button>
  );
}

/* CTWorkspace — the class-teacher console CONTENT (v16 pagehead + tier band
   + pages + report modals + toast). Purely driven by props so it can render
   standalone (CTConsole below) or embedded in the principal dashboard's
   shell when the signed-in user also holds a class-teacher post (dual-mode
   sidebar; the .pd-root.ct-root CSS hides that shell's AI rail for us). */
export function CTWorkspace({ me, teach, page = 'ctHome', onGo, onSavedCount }) {
  const [reportId, setReportId] = useState(null);
  const [showMyReport, setShowMyReport] = useState(false);
  const [toast, setToast] = useState(null);
  const [dash, setDash] = useState(null);

  /* v17 wired bookmarks — the same 'fx-folders' store the principal
     dashboard uses, so a dual-mode account sees ONE folder list. All state
     lives here (the workspace renders in both embeds); the standalone
     console gets the live Saved count reported up via onSavedCount. */
  const [folders, setFolders] = useState(loadFolders);
  const [bmPop, setBmPop] = useState(null);
  const [bmNew, setBmNew] = useState('');
  const gsRef = useRef(null);

  useEffect(() => { saveFolders(folders); }, [folders]);
  const savedIds = useMemo(() => new Set(folders.flatMap((f) => f.studentIds)), [folders]);
  useEffect(() => { onSavedCount?.(savedIds.size); }, [savedIds.size, onSavedCount]);

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

  /* bookmark popover anchor — same geometry as the principal dashboard's */
  const onBookmark = useCallback((e, student) => {
    if (!student?.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = 230;
    const left = Math.min(Math.max(10, rect.left - 90), window.innerWidth - w - 10);
    const top = rect.bottom + 8 + (window.innerHeight - rect.bottom < 260 ? -rect.height - 250 : 0);
    setBmPop({ student: { id: student.id, name: student.name || `Student ${student.id}` }, left, top });
    setBmNew('');
  }, []);

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

  const openReport = useCallback((student) => {
    setBmPop(null);
    setReportId(student?.id ?? null);
  }, []);

  /* the workspace owns the scrolling <main> in BOTH embeds (standalone
     console + principal-dashboard dual mode, where the shell's mainRef is
     null) — so it must reset the scroll itself when the page switches,
     or e.g. Attendance opens mid-scrolled with its header above the fold */
  const mainRef = useRef(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [page]);

  /* keyboard: Ctrl K / "/" focus the console search, Escape closes
     everything (bookmark popover, saved view, report modals). Safe inside
     the principal embed: CTWorkspace only mounts while the CT mode is
     active — where the principal pagehead (and its own Ctrl K target) is
     not rendered. The search dropdown itself closes on Escape while the
     input is focused (GlobalSearch); the blur here covers Escape pressed
     elsewhere so a stale dropdown can never linger. */
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
        setShowMyReport(false);
        if (page === 'saved') onGo?.('ctHome');
        gsRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [page, onGo]);

  /* tier-band numbers (N STUDENTS) + console-search cohort — same payload
     the My Class page renders; one light fetch per class so the band and
     the search read real API data everywhere */
  const clsId = me?.class?.id;
  useEffect(() => {
    if (!clsId) return undefined;
    let alive = true;
    fetchCtClassDashboard(clsId)
      .then((d) => { if (alive) setDash(d || null); })
      .catch(() => { /* the band simply omits the count */ });
    return () => { alive = false; };
  }, [clsId]);

  /* v17 console search — client-side over the CT-scoped cohort (the class
     dashboard for My Class + the teaching-classes report cohort).
     /principal/students is leadership-gated (principal.py _allowed), so
     nothing server-side here; rows map to GlobalSearch's student shape. */
  const searchCohort = useMemo(() => {
    const byId = new Map();
    (teach?.__students || []).forEach((k) => {
      if (k?.id == null) return;
      byId.set(Number(k.id), {
        id: Number(k.id),
        name: k.name,
        className: k.class_name || me?.class?.name || '—',
        avg: k.score ?? null,
        rank: k.rank ?? null,
      });
    });
    (dash?.students || []).forEach((s) => {
      byId.set(Number(s.id), {
        id: Number(s.id),
        name: s.name,
        className: me?.class?.name || '—',
        avg: s.avg ?? null,
        rank: s.rank ?? null,
      });
    });
    return [...byId.values()];
  }, [teach, dash, me?.class?.name]);

  const ctStudentFetcher = useCallback(async ({ search }) => {
    const q = String(search || '').trim().toLowerCase();
    const matched = q
      ? searchCohort.filter((s) => String(s.name || '').toLowerCase().includes(q))
      : searchCohort;
    return { students: matched.slice(0, 8), total: matched.length };
  }, [searchCohort]);

  /* the teacher's classes feed the search's CLASSES section */
  const ctClasses = teach?.classes || [];

  /* class bar click → My Class view, own class only: /ct/class-dashboard
     deliberately ignores class_id for class_teacher accounts (ct.py
     _ct_class_of), so another class's detail is unreachable at this role. */
  const openClass = useCallback((id) => {
    if (id != null && Number(id) === Number(me?.class?.id)) onGo?.('ctHome');
  }, [me, onGo]);

  if (!me) {
    return (
      <main className="v15-main pd-main">
        <div className="pd-skel tall" style={{ margin: 24 }} />
      </main>
    );
  }

  const cls = me.class;
  const teacher = me.teacher;
  const dashInfo = dash?.info || null;
  /* designer tag: "CLASS 10-EMERALD · GNPS MAILLOOR · 30 STUDENTS" — the
     school segment now comes straight from /ct/me (me.school.name, added
     in v17); dashInfo.school_name remains a fallback for older payloads. */
  const bandTag = [
    `CLASS ${cls.name}`,
    me.school?.name || dashInfo?.school_name || null,
    dashInfo?.students != null ? `${dashInfo.students} STUDENTS` : null,
  ].filter(Boolean).join(' · ').toUpperCase();

  return (
    <main className="v15-main pd-main" ref={mainRef}>
      <PageHead
        tier="ct"
        eyebrow="Fetch-X · Class Teacher Console"
        title="Class Teacher Dashboard"
        subtitle={`Class Teacher · Classroom intelligence for ${cls.name}`}
        searchSlot={(
          <GlobalSearch
            inputRef={gsRef}
            studentFetcher={ctStudentFetcher}
            classesAll={ctClasses}
            placeholder={`Search ${searchCohort.length} students, your classes…`}
            onOpenClass={openClass}
            onOpenStudent={openReport}
          />
        )}
        actions={<ModeButton />}
      />

      {page === 'saved' ? (
        /* v17 designer "Saved" — the shared folder view. Report cards resolve
           through /principal/student-report, which the backend grants to
           class-teacher accounts only for their OWN class; other saved
           students render the component's honest "Unavailable" card instead
           of breaking the page. */
        <SavedStudents
          folders={folders}
          onCreate={createFolder}
          onDeleteFolder={deleteFolder}
          onRemoveStudent={toggleInFolder}
          onBack={() => onGo?.('ctHome')}
          onOpenReport={openReport}
          savedCount={savedIds.size}
        />
      ) : (
      <Tier tier="ct">
        <TierBand
          tier="ct"
          lvl={3}
          icon={TIER_ICONS.ct}
          eyebrow="TIER 03 · CLASSROOM"
          copy={`Daily attendance, tasks, marks and reports for ${cls.name}.`}
          tag={bandTag}
        />

        {page === 'ctHome' && (
          <ClassDetail
            classId={cls.id}
            classesAll={[]}
            fetcher={fetchCtClassDashboard}
            embedded
            savedIds={savedIds}
            onBookmark={onBookmark}
            onOpenReport={openReport}
          />
        )}
        {page === 'ctAtt' && <CTAttendance cls={cls} />}
        {page === 'ctTask' && <CTTasks cls={cls} />}
        {page === 'ctMarks' && <CTMarks cls={cls} />}
        {page === 'ctTeach' && (
          <CTTeaching data={teach} onOpenReport={openReport} onOpenClass={openClass} />
        )}
        {page === 'ctMy' && (
          <CTMy report={teach?.__report || null} onOpenFull={() => setShowMyReport(true)} />
        )}
        {page === 'ctTT' && <CTTimetable teacherId={teacher.id} teacherName={teacher.name} />}
      </Tier>
      )}

      {reportId != null && createPortal(
        <ReportCardModal
          studentId={reportId}
          onClose={() => setReportId(null)}
          totalStudents={dashInfo?.students}
          saved={savedIds.has(reportId)}
          onBookmark={onBookmark}
        />,
        document.body,
      )}
      {showMyReport && createPortal(
        <TeacherReportModal
          teacherId={teacher.id}
          fetcher={async () => api.get('/ct/teacher-report').then((r) => r.data)}
          onClose={() => setShowMyReport(false)}
          onBookmark={onBookmark}
        />,
        document.body,
      )}

      {/* v17 bookmark-to-folder popover — same markup + geometry as the
         principal dashboard's (Dashboard.jsx bm-pop), driven by the shared
         'fx-folders' store so saved students appear in the Saved view */}
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </main>
  );
}

export default function CTConsole() {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [me, setMe] = useState(null);
  const [meErr, setMeErr] = useState(false);
  const [teach, setTeach] = useState(null);
  const [page, setPage] = useState('ctHome');
  const [mobNav, setMobNav] = useState(false);
  /* badge for the sidebar's Saved entry — CTWorkspace owns the folder
     store (it renders in both embeds) and reports the live count up */
  const [savedCount, setSavedCount] = useState(
    () => new Set(loadFolders().flatMap((f) => f.studentIds)).size,
  );
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });

  useEffect(() => {
    fetchCtMe().then(setMe).catch(() => setMeErr(true));
    fetchCtTeachingClasses()
      .then((d) => {
        /* attach the student cohort for the Teaching page (same call as report) */
        api.get('/ct/teacher-report').then((r) => {
          setTeach({ ...d, __students: r.data.students || [], __report: r.data });
        }).catch(() => setTeach(d));
      })
      .catch(() => setTeach(null));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('si-nav', navCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [navCollapsed]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setMobNav(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const signOut = () => { logout(); navigate('/'); };
  const navGo = useCallback((key) => {
    setMobNav(false);
    setPage(key);
  }, []);

  if (meErr) {
    return (
      <div className="pd-root v15-root" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ padding: 24 }}>
          <div className="pd-note">The console could not load your teaching profile. If your account has no class assigned yet, contact your admin.</div>
        </div>
      </div>
    );
  }
  if (!me) return <div className="pd-root v15-root"><div className="pd-skel tall" style={{ margin: 24 }} /></div>;

  const cls = me.class;
  const teacher = me.teacher;

  return (
    <div className={`pd-root v15-root ct-root${navCollapsed ? ' nav-collapsed' : ''}${mobNav ? ' mob-nav' : ''}`}>
      <LevelThemeStyle />
      <DashSidebar
        active={page}
        onGo={navGo}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((c) => !c)}
        userName={teacher.name}
        roleLabel="CLASS TEACHER"
        onSignOut={signOut}
        /* v17 Saved entry — see CT_NAV_LINKS above */
        activeGroup="ct"
        savedCount={savedCount}
        groups={[{
          key: 'ct',
          label: `CLASS TEACHER · ${cls.name.toUpperCase()}`,
          dot: '#b45f04',
          links: [
            ...CT_NAV_LINKS.map(({ key, label, lvl, Icon }) => ({ key, label, lvl, icon: <Icon strokeWidth={1.8} /> })),
            { key: 'saved', label: 'Saved', lvl: 5, icon: <Bookmark strokeWidth={2} /> },
          ],
        }]}
      />

      <CTWorkspace me={me} teach={teach} page={page} onGo={navGo} onSavedCount={setSavedCount} />

      <button type="button" className="v15-mobtoggle" aria-label="Open navigation" onClick={() => setMobNav(true)}>
        <Menu strokeWidth={2.2} />
      </button>
      {mobNav && <div className="v15-mobbackdrop" onClick={() => setMobNav(false)} role="presentation" />}
    </div>
  );
}
