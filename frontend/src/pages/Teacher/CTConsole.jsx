/* CTConsole — designer v15 "CLASS TEACHER UI" (dashboard(2).html ctmode).
   Route /teacher/console. Same dashboard chrome as the principal view
   (sidebar with CT nav, pagehead, AI panel) with seven pages:

     ctHome   My Class            → /ct/class-dashboard (full class view)
     ctAtt    Attendance          → /attendance/*  (P/A/L register per date)
     ctTask   Task Completion     → /tasks/*       (term-wise, tick students)
     ctMarks  Academic Marks      → /academics/*   (per-term marks grid)
     ctTeach  Teaching Classes    → /ct/teaching-classes
     ctMy     My Report           → /ct/teacher-report (via report modal)
     ctTT     Timetable           → /timetable/teacher/{me} (NEW backend) */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Menu, Moon, Sun } from 'lucide-react';
import {
  fetchCtClassDashboard, fetchCtMe, fetchCtTeachingClasses,
} from '../Principal/dashboard/data';
import { useTheme } from '../../components/ThemeProvider';
import { useAuth } from '../../auth/AuthContext';
import { Toast } from '../../components/ui';
import DashSidebar from '../Principal/dashboard/DashSidebar';
import ClassDetail from '../Principal/dashboard/ClassDetail';
import AiPanel from '../Principal/dashboard/AiPanel';
import { LevelThemeStyle } from '../Principal/dashboard/LevelThemes';
import { PersonalTimetable } from '../Principal/dashboard/Timetable';
import { BarChart, Distro, useReveal } from '../Principal/dashboard/charts';
import { SectionHead, Chip } from '../Principal/dashboard/Sections';
import ReportCardModal from '../Principal/dashboard/ReportCardModal';
import TeacherReportModal from '../Principal/dashboard/TeacherReportModal';
import api from '../../api/client';
import { bandOf, initials, mean, pct } from '../Principal/dashboard/util';
import '../Principal/dashboard/dashboard.css';
import '../Principal/dashboard/v15.css';

const TODAY = () => new Date().toISOString().slice(0, 10);

/* ─────────────────────────────── 02 ATTENDANCE ─────────────────────────── */
function CTAttendance({ cls }) {
  const [date, setDate] = useState(TODAY);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(false);

  const load = useCallback((rows = null) => {
    if (rows !== null) setRows(rows);
  }, []);
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
      load();
    } catch { setErr(true); }
  };
  const cycle = (s) => {
    const cur = s.status === 'P' ? 'P' : s.status === 'A' ? 'A' : s.status === 'L' ? 'L' : null;
    const next = cur === 'P' ? 'A' : cur === 'A' ? 'L' : cur === 'L' ? 'P' : 'P';
    save([{ student_id: s.id, status: next }]);
  };
  const setAll = (st) => save((rows || []).map((s) => ({ student_id: s.id, status: st })));

  const P = (rows || []).filter((s) => s.status === 'P').length;
  const A = (rows || []).filter((s) => s.status === 'A').length;
  const L = (rows || []).filter((s) => s.status === 'L').length;
  const T = (rows || []).length;

  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Attendance"
        sub="Mark the register for any school day — tap a pill to cycle Present → Absent → Late."
        tag={`CLASS ${cls.name}`}
      />
      <div className="ct-toolbar">
        <input type="date" className="ct-date" value={date} max={TODAY()} onChange={(e) => setDate(e.target.value || TODAY())} aria-label="Attendance date" />
        <button type="button" className="ct-btn solid" onClick={() => setAll('P')}>✓ ALL PRESENT</button>
        <button type="button" className="ct-btn" onClick={() => setAll('A')}>✕ ALL ABSENT</button>
      </div>
      <div className="ct-cards">
        <div className="ct-card"><div className="cnum">{T || '—'}</div><div className="ck">TOTAL STUDENTS</div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#0e9f6e' }}>{rows ? P : '—'}</div><div className="ck">PRESENT</div><div className="cbar"><i style={{ background: '#0e9f6e', width: T ? `${(P / T) * 100}%` : 0 }} /></div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#dc2626' }}>{rows ? A : '—'}</div><div className="ck">ABSENT</div><div className="cbar"><i style={{ background: '#dc2626', width: T ? `${(A / T) * 100}%` : 0 }} /></div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#d97706' }}>{rows ? L : '—'}</div><div className="ck">LATE</div><div className="cbar"><i style={{ background: '#d97706', width: T ? `${(L / T) * 100}%` : 0 }} /></div></div>
      </div>
      <div className="st-list-wrap">
        <div className="st-scroll" style={{ maxHeight: 430 }}>
          <div className="st-head"><span>#</span><span>STUDENT NAME</span><span className="r">STATUS · TAP TO CYCLE</span></div>
          {err && <div className="noresult">The register could not be loaded.</div>}
          {!err && !rows && <div className="pd-note">Loading register…</div>}
          {(rows || []).map((s, i) => {
            const st = s.status && ['P', 'A', 'L'].includes(s.status) ? s.status : null;
            const lab = st === 'P' ? '✓ PRESENT' : st === 'A' ? '✕ ABSENT' : st === 'L' ? '⏰ LATE' : '○ NOT MARKED';
            return (
              <div className="srow ct-att-row" key={s.id}>
                <span className="rankbadge">{i + 1}</span>
                <span className="st-name"><span className="avatar">{initials(s.name)}</span><span className="nm">{s.name}</span></span>
                <span className="ct-att-pill">
                  <button type="button" className={`stpill ${st || ''}`} onClick={() => cycle(s)}>{lab}</button>
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
  const [formOpen, setFormOpen] = useState(false);
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

  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Task Completion"
        sub="Create assignments and tick off students as they complete them."
        tag={`CLASS ${cls.name}`}
      />
      <div className="ct-toolbar">
        <div className="ctabs">
          {[1, 2, 3].map((k) => (
            <button key={k} type="button" className={`gtab${Number(term) === k ? ' active' : ''}`} onClick={() => setTerm(k)}>Term {k}</button>
          ))}
        </div>
        <button type="button" className="ct-btn solid" onClick={() => setFormOpen((o) => !o)}>+ NEW TASK</button>
      </div>
      {formOpen && (
        <div className="tform">
          <div className="tf-head">TASK DETAILS · TERM {term}</div>
          <input type="text" placeholder="e.g., Chapter 5 Exercise, Science Project..." value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="row">
            <div className="subj-pills">
              {subjects.map((s) => (
                <button key={s.id} type="button" className={`spill${subId === s.id ? ' active' : ''}`} onClick={() => setSubId(s.id)}>{s.name}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <input type="date" style={{ maxWidth: 230 }} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
            <div className="actions" style={{ flex: 1 }}>
              <button type="button" className="ct-btn" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="button" className="ct-btn solid" onClick={create}>✓ Create Task</button>
            </div>
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
        <div>
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

  return (
    <section className="lvl lvl-3 compact first">
      <SectionHead
        lvl={3}
        title="Academic Marks"
        sub="Enter subject-wise marks for students in your class, term by term."
        tag={`CLASS ${cls.name}`}
      />
      <div className="ct-toolbar">
        <div className="ctabs">
          {[1, 2, 3].map((k) => (
            <button key={k} type="button" className={`gtab${Number(term) === k ? ' active' : ''}`} onClick={() => setTerm(k)}>Term {k}</button>
          ))}
        </div>
        <button type="button" className="ct-btn solid" onClick={saveAll} disabled={!Object.keys(dirty).length}
          style={{ opacity: Object.keys(dirty).length ? 1 : 0.5 }}>
          ✓ SAVE{Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}
        </button>
      </div>
      <div className="ct-cards" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="ct-card"><div className="cnum">{grid ? grid.students.length : '—'}</div><div className="ck">TOTAL STUDENTS</div></div>
        <div className="ct-card"><div className="cnum" style={{ color: '#0e9f6e' }}>{avg ?? '--'}</div><div className="ck">CLASS AVERAGE</div></div>
        <div className="ct-card"><div className="cnum" style={{ fontSize: 22 }}>Term {term}</div><div className="ck">ACTIVE TERM{exam ? ` · ${exam.name}` : ''}</div></div>
      </div>
      {err && <div className="pd-note">Marks could not be loaded for this term.</div>}
      {exams && !exam && <div className="pd-note">No exam configured for Term {term} in this grade yet.</div>}
      {!grid && exam && !err && <div className="pd-skel tall" />}
      {grid && (
        <div className="mgrid-wrap">
          <div style={{ overflowX: 'auto' }}>
            <div className="mhead">
              <span>#</span><span>STUDENT</span>
              {grid.subjects.map((s) => <span key={s.id}>{String(s.name).slice(0, 6).toUpperCase()}</span>)}
              <span>TOTAL</span>
            </div>
            {grid.students.map((s, i) => {
              const tot = Object.values(s.marks).reduce((a, v) => a + (v != null && v !== '' ? Number(v) : 0), 0);
              return (
                <div className="mrow" key={s.id}>
                  <span className="rankbadge">{i + 1}</span>
                  <span className="nm" style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{s.name}</span>
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
      )}
    </section>
  );
}

/* ─────────────────────────── 05 TEACHING CLASSES ───────────────────────── */
function CTTeaching({ data, onOpenReport }) {
  const [sel, setSel] = useState('all');
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
              items={classes.map((c) => ({ label: c.name, tip: `Class ${c.name} · ${pct(c.avg)}% · overall rank #${c.rank}`, val: pct(c.avg) }))
                .sort((a, b) => b.val - a.val)}
            />
          </div>
        </div>
      )}
      <div className="st-list-wrap" style={{ marginTop: 14 }}>
        <div className="st-scroll" style={{ maxHeight: 420 }}>
          <div className="st-head"><span>RANK</span><span>STUDENT NAME</span><span>CLASS</span><span className="r">{String(subjName).slice(0, 10).toUpperCase()} AVG</span></div>
          {scored.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map((k) => (
            <div className="srow" key={k.id} role="button" tabIndex={0} onClick={() => onOpenReport({ id: k.id })}>
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
          {!scored.length && <div className="noresult">No marks recorded yet for this selection.</div>}
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
        sub="Your teaching performance across every class you teach."
        tag={`${report.classes.length} CLASSES · RANK #${t.rank ?? '—'}/${t.of ?? '—'}`}
      />
      <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 16, background: g.soft, color: g.c }}>{initials(t.name)}</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)', marginTop: 4 }}>
            {String(t.subject || '').toUpperCase()}{t.is_hod ? ' · HOD' : ''}{t.ct_of ? ` · CLASS TEACHER OF ${t.ct_of}` : ''}
          </div>
        </div>
        <span className="grade-pill" style={{ background: g.soft, color: g.c }}>{Math.round(t.avg ?? 0)}% · {g.label}</span>
        <span className="rank-pill">#{t.rank ?? '—'} / {t.of ?? '—'}</span>
        <div className="chips" style={{ margin: '8px 0 0' }}>
          <Chip t="T1" n={pct(t.t1)} /><Chip t="T2" n={pct(t.t2)} /><Chip t="T3" n={pct(t.t3)} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="button" className="ct-btn solid" onClick={onOpenFull}>⤓ OPEN / DOWNLOAD FULL REPORT CARD</button>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 07 TIMETABLE ──────────────────────────── */
function CTTimetable({ teacherId }) {
  return (
    <section className="lvl lvl-2 compact first">
      <SectionHead
        lvl={2}
        title="Timetable"
        sub="Your personal teaching schedule — where you are, period by period."
        tag="PERSONAL GRID"
      />
      <PersonalTimetable teacherId={teacherId} />
    </section>
  );
}

/* ═════════════════════════════ the console shell ═════════════════════════ */
export default function CTConsole() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { mode, toggle } = useTheme() || {};

  const [me, setMe] = useState(null);
  const [meErr, setMeErr] = useState(false);
  const [teach, setTeach] = useState(null);
  const [page, setPage] = useState('ctHome');
  const [reportId, setReportId] = useState(null);
  const [showMyReport, setShowMyReport] = useState(false);
  const [mobNav, setMobNav] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('si-nav') === '1'; } catch { return false; }
  });
  const [aiCollapsed, setAiCollapsed] = useState(() => {
    try { return localStorage.getItem('fx-ai') === '1'; } catch { return false; }
  });
  const [aiOpenMobile, setAiOpenMobile] = useState(false);
  const [toast, setToast] = useState(null);
  const mainRef = useRef(null);
  const gsRef = useRef(null);

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
  useEffect(() => { try { localStorage.setItem('fx-ai', aiCollapsed ? '1' : '0'); } catch { /* ignore */ } }, [aiCollapsed]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); gsRef.current?.focus();
      } else if (e.key === 'Escape') {
        setReportId(null); setShowMyReport(false); setMobNav(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleAi = () => {
    if (window.matchMedia('(max-width:1150px)').matches) setAiOpenMobile((o) => !o);
    else setAiCollapsed((c) => !c);
  };
  const signOut = () => { logout(); navigate('/'); };
  const navGo = useCallback((key) => {
    setMobNav(false);
    setPage(key);
    mainRef.current?.scrollTo({ top: 0 });
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
    <div className={`pd-root v15-root ct-root${navCollapsed ? ' nav-collapsed' : ''}${aiCollapsed ? ' ai-collapsed' : ''}${aiOpenMobile ? ' ai-open' : ''}${mobNav ? ' mob-nav' : ''}`}>
      <LevelThemeStyle />
      <DashSidebar
        ct
        ctLabel={cls.name.toUpperCase()}
        active={page}
        onGo={navGo}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((c) => !c)}
        userName={teacher.name}
        onSignOut={signOut}
      />

      <main className="v15-main pd-main" ref={mainRef}>
        <header className="pagehead">
          <div>
            <div className="eyebrow">Fetch-X · Class Teacher</div>
            <h1>Class Teacher — {cls.name}</h1>
            <div className="subtitle">
              {teacher.name} · {teacher.subject?.name || '—'} · Grade {cls.grade}
            </div>
          </div>
          <div className="pagehead-mid gsearch" />
          <div className="pagehead-actions">
            <button type="button" className="btn-mode" onClick={toggle}
              title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
              {mode === 'dark' ? <Sun strokeWidth={2} /> : <Moon strokeWidth={2} />}
            </button>
          </div>
        </header>

        {page === 'ctHome' && (
          <ClassDetail
            classId={cls.id}
            classesAll={[]}
            fetcher={fetchCtClassDashboard}
            embedded
            savedIds={new Set()}
            onBookmark={() => {}}
            onOpenReport={(s) => setReportId(s.id)}
          />
        )}
        {page === 'ctAtt' && <CTAttendance cls={cls} />}
        {page === 'ctTask' && <CTTasks cls={cls} />}
        {page === 'ctMarks' && <CTMarks cls={cls} />}
        {page === 'ctTeach' && (
          <CTTeaching data={teach} onOpenReport={(s) => setReportId(s.id)} />
        )}
        {page === 'ctMy' && (
          <CTMy report={teach?.__report || null} onOpenFull={() => setShowMyReport(true)} />
        )}
        {page === 'ctTT' && <CTTimetable teacherId={teacher.id} />}
      </main>

      <button type="button" className="v15-mobtoggle" aria-label="Open navigation" onClick={() => setMobNav(true)}>
        <Menu strokeWidth={2.2} />
      </button>
      {mobNav && <div className="v15-mobbackdrop" onClick={() => setMobNav(false)} role="presentation" />}

      <AiPanel collapsed={aiCollapsed} onToggle={toggleAi} />
      <button type="button" className="ai-fab" onClick={toggleAi} aria-label="Open AI panel">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.7 5 3.3 7.6 8.3 8.3-5 .7-7.6 3.3-8.3 8.3-.7-5-3.3-7.6-8.3-8.3 5-.7 7.6-3.3 8.3-8.3z" /></svg>
      </button>

      {reportId != null && createPortal(
        <ReportCardModal studentId={reportId} onClose={() => setReportId(null)} />,
        document.body,
      )}
      {showMyReport && createPortal(
        <TeacherReportModal teacherId={teacher.id} fetcher={async () => api.get('/ct/teacher-report').then((r) => r.data)} onClose={() => setShowMyReport(false)} />,
        document.body,
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
