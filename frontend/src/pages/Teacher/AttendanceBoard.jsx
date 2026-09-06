import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X, Clock, Save, Loader2, Users, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, CopyPlus, Eraser } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, EASE, SPRING, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { CountUp, Toast } from '../../components/ui.jsx';

function SkeletonRow({ index }) {
  return (
    <tr style={{ animationDelay: `${index * 0.06}s` }}>
      <td style={{ textAlign: 'center', padding: '16px 20px' }}><div className="skeleton-block" style={{ width: 20, height: 14, margin: '0 auto' }} /></td>
      <td style={{ padding: '16px 20px' }}><div className="skeleton-block" style={{ width: '60%', height: 14 }} /></td>
      <td style={{ textAlign: 'center', padding: '16px 20px' }}><div className="skeleton-block" style={{ width: 70, height: 28, borderRadius: 14, margin: '0 auto' }} /></td>
    </tr>
  );
}

const STATUS = {
  P: { next: 'A', cls: 'pill-present', label: 'Present', Icon: Check, color: '#059669' },
  A: { next: 'L', cls: 'pill-absent', label: 'Absent', Icon: X, color: '#dc2626' },
  L: { next: 'P', cls: 'pill-late', label: 'Late', Icon: Clock, color: '#d97706' },
};

function StatusPill({ status, onClick, active }) {
  // null/undefined = NOT MARKED — its own visible state (first tap marks
  // Present). The old board silently coerced this to 'P' and then saved the
  // whole roster as Present on an untouched Save press (M17).
  const s = STATUS[status] || { cls: 'pill-attendance pill-unmarked', label: 'Not Marked', Icon: Clock, color: 'var(--muted)' };
  const StatusIcon = s.Icon;
  return (
    <motion.button
      onClick={onClick}
      className={`pill pill-attendance ${s.cls} ${active ? 'status-changing' : ''}`}
      animate={{ scale: active ? [1, 0.88, 1.06, 1] : 1 }}
      transition={{ duration: 0.34, ease: EASE }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      style={{ '--pill-color': s.color }}
    >
      <motion.span animate={{ rotate: active ? [0, -8, 8, 0] : 0 }} transition={{ duration: 0.34 }}
        style={{ display: 'inline-flex', alignItems: 'center' }}><StatusIcon size={14} strokeWidth={3} /></motion.span>
      <span style={{ marginLeft: 4 }}>{s.label}</span>
    </motion.button>
  );
}

/* ── Weekly board ── compact status cell for the Mon-Fri grid ────────────── */
const WEEK_CELL = {
  P: { letter: 'P', cls: 'att-week-cell att-wc-p', title: 'Present' },
  A: { letter: 'A', cls: 'att-week-cell att-wc-a', title: 'Absent' },
  L: { letter: 'L', cls: 'att-week-cell att-wc-l', title: 'Late' },
};

function WeekCell({ status, dirty, today, onClick }) {
  const conf = status ? WEEK_CELL[status] : null;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={conf ? conf.title : 'Not marked'}
      className={`${conf ? conf.cls : 'att-week-cell att-wc-n'}${today ? ' is-today' : ''}${dirty ? ' is-dirty' : ''}`}
      whileTap={{ scale: 0.86 }}
      whileHover={{ scale: 1.12 }}
      animate={dirty ? { scale: [1, 1.25, 1] } : { scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {conf ? conf.letter : '·'}
    </motion.button>
  );
}

export default function AttendanceBoard() {
  const { user } = useAuth();
  const classId = user?.assigned_class_id;
  const [mode, setMode] = useState(() => (sessionStorage.getItem('att-mode') === 'weekly' ? 'weekly' : 'daily'));
  const switchMode = (m) => { setMode(m); try { sessionStorage.setItem('att-mode', m); } catch { /* private mode */ } };
  const [students, setStudents] = useState([]);
  // daily board: ids touched since the last load/save — Save posts ONLY these
  const [dirtyDaily, setDirtyDaily] = useState({});
  const [date, setDate] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [changingId, setChangingId] = useState(null);
  const [dateChanging, setDateChanging] = useState(false);
  const toastTimer = useRef(null);
  const showToast = useCallback((m, t = 'success') => {
    setToast({ message: m, type: t });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);  // single auto-dismiss owner — cleaned up on unmount
  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), []);

  /* ── weekly board state ── */
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [weekStart, setWeekStart] = useState(() => {
    const t = new Date();
    return isoOf(new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)));
  });
  const [weekDays, setWeekDays] = useState([]);
  const [weekGrid, setWeekGrid] = useState([]); // [{id,name,days:[5],week_rate}]
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekLoaded, setWeekLoaded] = useState(false);
  const [dirty, setDirty] = useState({});      // {"sid|dateKey": status}
  const [savingWeek, setSavingWeek] = useState(false);
  const [copyingLast, setCopyingLast] = useState(false);

  useEffect(() => {
    if (!classId || mode !== 'weekly') return;
    let stale = false;
    // deferred start keeps setState out of the effect's synchronous path
    const timer = setTimeout(() => {
      if (stale) return;
      setWeekLoading(true);
      api.get(`/attendance/week/${classId}?start=${weekStart}`).then(r => {
        if (stale) return;
        setWeekDays(r.data.days || []);
        setWeekGrid((r.data.students || []).map(s => ({ ...s, days: [...(s.days || [])] })));
        setDirty({});
        setWeekLoaded(true);
      }).catch(e => { console.error(e); showToast('Failed to load the week', 'error'); }).finally(() => { if (!stale) setWeekLoading(false); });
    }, 0);
    return () => { stale = true; clearTimeout(timer); };
  }, [classId, mode, weekStart]);

  const cycleWeekCell = (sid, dayIdx, dayKey) => {
    const current = weekGrid.find(r => r.id === sid)?.days[dayIdx];
    // unmarked cells enter the chain at P (the natural "mark present" first tap)
    const next = current ? (STATUS[current] || STATUS.P).next : 'P';
    setWeekGrid(prev => prev.map(r => r.id === sid ? {
      ...r,
      days: r.days.map((v, i) => (i === dayIdx ? next : v)),
      week_rate: (() => {
        const days = r.days.map((v, i) => (i === dayIdx ? next : v));
        const marked = days.filter(Boolean);
        const p = marked.filter(x => x === 'P').length;
        return marked.length ? Math.round(p / marked.length * 100) : null;
      })(),
    } : r));
    setDirty(prev => ({ ...prev, [`${sid}|${dayKey}`]: next }));
  };

  const saveWeek = async () => {
    const byDay = {};
    Object.entries(dirty).forEach(([key, status]) => {
      const [sid, dayKey] = key.split('|');
      (byDay[dayKey] = byDay[dayKey] || []).push({ student_id: Number(sid), status });
    });
    if (!Object.keys(byDay).length) return;
    setSavingWeek(true);
    try {
      await Promise.all(Object.entries(byDay).map(([dayKey, marks]) =>
        api.post('/attendance/mark', { class_id: classId, date: dayKey, marks })));
      setDirty({});
      showToast('Week attendance saved!', 'success');
    } catch { showToast('Failed to save week attendance', 'error'); }
    setSavingWeek(false);
  };

  const shiftWeek = (delta) => {
    const d = new Date(`${weekStart}T00:00:00`);
    setWeekStart(isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7)));
  };

  /* prefill the visible week from LAST week's statuses (draft-only until saved) */
  const copyLastWeek = async () => {
    setCopyingLast(true);
    try {
      const d = new Date(`${weekStart}T00:00:00`);
      const prev = isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
      const r = await api.get(`/attendance/week/${classId}?start=${prev}`);
      const prevBySid = new Map((r.data.students || []).map(s => [s.id, s.days || []]));
      let n = 0;
      const nextGrid = weekGrid.map(row => {
        const prevDays = prevBySid.get(row.id) || [];
        const days = row.days.map((cur, i) => {
          const v = prevDays[i];
          return v ? v : cur;
        });
        const marked = days.filter(Boolean);
        const p = marked.filter(x => x === 'P').length;
        return { ...row, days, week_rate: marked.length ? Math.round(p / marked.length * 100) : null };
      });
      const nextDirty = { ...dirty };
      nextGrid.forEach(row => row.days.forEach((v, i) => {
        if (v && weekDays[i] && v !== weekGrid.find(g => g.id === row.id)?.days[i]) {
          nextDirty[`${row.id}|${weekDays[i]}`] = v;
          n++;
        }
      }));
      setWeekGrid(nextGrid);
      setDirty(nextDirty);
      showToast(n ? `Copied ${n} status${n === 1 ? '' : 'es'} from last week — review and save` : 'Last week has nothing to copy yet', n ? 'success' : 'info');
    } catch { showToast('Failed to copy last week', 'error'); }
    setCopyingLast(false);
  };
  /* clear every marked cell in the visible week (draft-only until saved;
     save posts status:null which the backend treats as UNMARK) */
  const clearWeek = () => {
    let n = 0;
    const nextGrid = weekGrid.map(row => {
      const days = row.days.map(cur => {
        if (!cur) return cur;
        n++;
        return null;
      });
      return { ...row, days, week_rate: null };
    });
    if (!n) { showToast('Nothing marked to clear this week', 'info'); return; }
    const nextDirty = { ...dirty };
    nextGrid.forEach(row => row.days.forEach((v, i) => {
      const before = weekGrid.find(g => g.id === row.id)?.days[i];
      if (weekDays[i] && before) nextDirty[`${row.id}|${weekDays[i]}`] = null;
    }));
    setWeekGrid(nextGrid);
    setDirty(nextDirty);
    showToast(`Cleared ${n} cell${n === 1 ? '' : 's'} — press Save Week to apply`, 'success');
  };

  const weekLabel = (() => {
    if (!weekDays.length) return '';
    // derive from the actual array — never assume exactly 5 days (M23)
    const a = new Date(`${weekDays[0]}T00:00:00`), b = new Date(`${weekDays[weekDays.length - 1]}T00:00:00`);
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return weekStart;
    return `${mo[a.getMonth()]} ${a.getDate()} – ${mo[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  })();
  const dirtyCount = Object.keys(dirty).length;
  const todayIso = isoOf(new Date());

  useEffect(() => { if (classId) fetchAttendance(); }, [date, classId]);

  const fetchAttendance = async () => {
    setLoading(true); setDateChanging(true);
    // stale-response guard: fast date navigation must never render the
    // wrong day's roster (M4)
    const reqDate = date;
    try {
      const res = await api.get(`/attendance/class/${classId}?date=${reqDate}`);
      setStudents(res.data.students.map(s => ({ ...s, status: s.status === 'Not Marked' ? null : s.status })));
      setDirtyDaily({});
    } catch (e) { console.error(e); showToast('Failed to load attendance', 'error'); }
    setTimeout(() => setDateChanging(false), 280);
    setLoading(false);
  };

  const toggleStatus = useCallback((id) => {
    setChangingId(id);
    setStudents(prev => prev.map(s => {
      if (s.id !== id) return s;
      const next = s.status ? (STATUS[s.status] || STATUS.P).next : 'P';
      setDirtyDaily(d => ({ ...d, [id]: next }));
      return { ...s, status: next };
    }));
    setTimeout(() => setChangingId(null), 340);
  }, []);

  const markAll = (status) => {
    setStudents(prev => prev.map(s => ({ ...s, status })));
    setDirtyDaily(prev => {
      const next = { ...prev };
      students.forEach(s => { next[s.id] = status; });
      return next;
    });
  };

  const present = students.filter(s => s.status === 'P');
  const absent = students.filter(s => s.status === 'A');
  const late = students.filter(s => s.status === 'L');
  const unmarked = students.filter(s => !s.status);
  const dailyDirtyCount = Object.keys(dirtyDaily).length;

  const save = async () => {
    if (!dailyDirtyCount) { showToast('No changes to save yet', 'info'); return; }
    setSaving(true);
    try {
      // Only the students actually touched on this visit are posted —
      // pressing Save on an untouched roster can no longer write Present
      // for the whole class (M17).
      const marks = students
        .filter(s => dirtyDaily[s.id] !== undefined)
        .map(s => ({ student_id: s.id, status: s.status }));
      await api.post('/attendance/mark', { class_id: classId, date, marks });
      setDirtyDaily({});
      showToast(`Attendance saved for ${marks.length} student${marks.length === 1 ? '' : 's'}!`, 'success');
    } catch { showToast('Failed to save attendance', 'error'); }
    setSaving(false);
  };

  if (!classId) return (
    <Page><div className="card" style={{ textAlign: 'center', padding: 60, marginTop: 40 }}>
      <AlertTriangle size={48} color="#d97706" style={{ marginBottom: 16 }} />
      <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Class Assigned</h3>
      <p style={{ color: 'var(--body-text)' }}>Please contact the administrator to assign you a class.</p>
    </div></Page>
  );

  if (loading && students.length === 0) return (
    <Page>
      <div className="pagehead"><div><div className="eyebrow">Fetch-X · Class Teacher</div><h1>Attendance</h1><div className="subtitle">Mark daily attendance</div></div></div>
      <div className="card" style={{ marginTop: 6 }}><div className="card-stats cols-4">{[0,1,2,3].map(i => <div key={i} className="stat-cell" style={{ opacity: 0.5 }}>
        <div className="skeleton-block" style={{ width: 31, height: 31, borderRadius: 9 }} />
        <div><div className="skeleton-block" style={{ width: 60, height: 10, borderRadius: 4, marginBottom: 6 }} />
        <div className="skeleton-block" style={{ width: 40, height: 16, borderRadius: 5 }} /></div>
      </div>)}</div></div>
      <div className="table-wrap" style={{ marginTop: 24 }}><table><tbody>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} index={i} />)}</tbody></table></div>
    </Page>
  );

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Class Teacher</div>
          <h1>Attendance</h1>
          <div className="subtitle">{mode === 'daily' ? 'Mark daily attendance for your class' : 'Review and edit the whole week at a glance'}</div>
        </div>
        <div className="gtabs" role="tablist" aria-label="Attendance mode" style={{ display: 'flex', gap: 8, alignSelf: 'flex-start', marginTop: 6 }}>
          <button type="button" role="tab" aria-selected={mode === 'daily'}
            className={`gtab${mode === 'daily' ? ' active' : ''}`} onClick={() => switchMode('daily')}>
            <CalendarDays size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Daily
          </button>
          <button type="button" role="tab" aria-selected={mode === 'weekly'}
            className={`gtab${mode === 'weekly' ? ' active' : ''}`} onClick={() => switchMode('weekly')}>
            <CalendarRange size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Week
          </button>
        </div>
      </div>

      {mode === 'daily' && (<>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 6 }}>
        <div className="card-stats cols-4">
          {[
            { v: students.length, l: 'Total Students', Icon: Users, accent: 'a-indigo' },
            { v: present.length, l: 'Present', Icon: Check, accent: 'a-teal', bar: present.length, barColor: 'var(--teal)' },
            { v: absent.length, l: 'Absent', Icon: X, accent: 'a-red', bar: absent.length, barColor: 'linear-gradient(90deg,#f87171,#dc2626)' },
            { v: late.length, l: 'Late', Icon: Clock, accent: 'a-amber', bar: late.length, barColor: 'linear-gradient(90deg,#fbbf24,#d97706)' },
          ].map((s, i) => {
            const SIcon = s.Icon;
            return (
              <motion.div key={i} variants={staggerItem} className={`stat-cell ${s.accent}`}>
                <div className="ic"><SIcon size={15} strokeWidth={2.2} /></div>
                <div>
                  <div className="k">{s.l}</div>
                  <div className="v"><CountUp value={s.v} /></div>
                  {s.bar !== undefined && (
                    <div className="attendance-bar-track">
                      <motion.div className="attendance-bar-fill"
                        initial={{ width: 0 }} animate={{ width: `${students.length ? (s.bar / students.length) * 100 : 0}%` }}
                        transition={{ duration: 0.7, ease: EASE }}
                        style={{ background: s.barColor }} />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <AnimatePresence>
        {(absent.length > 0 || late.length > 0) && (
          <motion.div className="card" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ padding: 20, marginBottom: 24, overflow: 'hidden', marginTop: 20 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {absent.length > 0 && (
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="stat-label" style={{ color: '#dc2626', marginBottom: 10 }}>Absent ({absent.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {absent.map((s, i) => <motion.span key={s.id} className="pill-tag" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.04, ...SPRING }}
                      style={{ background: 'rgba(220,38,38,.14)', color: '#ef4444', fontSize: 12, fontWeight: 700, padding: '5px 12px' }}>{s.name}</motion.span>)}
                  </div>
                </div>
              )}
              {late.length > 0 && (
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="stat-label" style={{ color: '#b45f04', marginBottom: 10 }}>Late ({late.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {late.map((s, i) => <motion.span key={s.id} className="pill-tag" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.04, ...SPRING }}
                      style={{ background: 'rgba(180,95,4,.16)', color: '#f59e0b', fontSize: 12, fontWeight: 700, padding: '5px 12px' }}>{s.name}</motion.span>)}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card controls-bar" style={{ padding: 18, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div className="date-picker-wrap">
          <label className="filter-label" style={{ fontSize: 12 }}>Date</label>
          {/* keyboard entry allowed — typing a date is a primary flow; only
              stray wheel-scrolls are prevented below */}
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault(); }}
            className="input" style={{ width: 'auto', minWidth: 150 }} aria-label="Attendance date" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => markAll('P')} className="btn btn-secondary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={14} /> All Present</button>
          <button onClick={() => markAll('A')} className="btn btn-secondary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><X size={14} /> All Absent</button>
        </div>
      </div>

      <motion.div className="table-wrap" animate={{ opacity: dateChanging ? 0.5 : 1, y: dateChanging ? 6 : 0 }} transition={{ duration: 0.28 }}>
        <table>
          <thead>
            <tr><th style={{ width: 50, textAlign: 'center' }}>#</th><th>Student Name</th><th style={{ width: 140, textAlign: 'center' }}>Status</th></tr>
          </thead>
          <tbody key={`tbody-${date}`}>
            {students.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--muted)' }}>
                No students in this class yet.
              </td></tr>
            )}
            {students.map(s => (
              <motion.tr key={s.id} className="attendance-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <td style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: 13 }}>{s.id}</td>
                <td style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</td>
                <td style={{ textAlign: 'center' }}>
                  <StatusPill status={s.status} active={changingId === s.id} onClick={() => toggleStatus(s.id)} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </motion.div>

      <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
        <motion.button onClick={save} disabled={saving || !dailyDirtyCount} className="btn btn-primary"
          whileHover={dailyDirtyCount ? { y: -2 } : {}} whileTap={{ scale: 0.97 }}
          style={{ padding: '12px 36px', fontSize: 15, opacity: dailyDirtyCount ? 1 : 0.55 }}>
          {saving ? (<><motion.span className="spin-icon" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ marginRight: 8, display: 'inline-flex' }}><Loader2 size={16} /></motion.span>Saving...</>) : <><Save size={16} style={{ marginRight: 6, display: 'inline-flex', verticalAlign: '-2px' }} /> Save Attendance{dailyDirtyCount ? ` (${dailyDirtyCount} change${dailyDirtyCount > 1 ? 's' : ''})` : ''}</>}
        </motion.button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Tap a pill to cycle Present → Absent → Late.{unmarked.length > 0 ? ` ${unmarked.length} not yet marked.` : ''}
        </span>
      </div>
      </>)}

      {mode === 'weekly' && (
        <>
          <div className="card controls-bar" style={{ padding: '14px 18px', marginTop: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => shiftWeek(-1)} aria-label="Previous week" style={{ padding: '7px 9px' }}><ChevronLeft size={15} /></button>
              <div className="att-week-label">{weekLabel || weekStart}</div>
              <button type="button" className="btn btn-secondary" onClick={() => shiftWeek(1)} aria-label="Next week" style={{ padding: '7px 9px' }}><ChevronRight size={15} /></button>
              <button type="button" className="btn btn-secondary" onClick={() => setWeekStart(isoOf(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - ((new Date().getDay() + 6) % 7))))} style={{ fontSize: 12 }}>This week</button>
              <button type="button" className="btn btn-secondary fx-copy-last" onClick={copyLastWeek} disabled={copyingLast || savingWeek}
                title="Prefill this week with last week's statuses (saved only after you press Save Week)">
                {copyingLast ? <Loader2 size={13} className="spin-icon" style={{ display: 'inline-flex' }} /> : <CopyPlus size={13} />}
                <span style={{ marginLeft: 5 }}>Copy last week</span>
              </button>
              <button type="button" className="btn btn-secondary fx-clear-week" onClick={clearWeek} disabled={savingWeek}
                title="Clear every marked cell in this week (saved only after you press Save Week)">
                <Eraser size={13} />
                <span style={{ marginLeft: 5 }}>Clear week</span>
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="att-week-legend"><i className="att-wc-p">P</i> Present</span>
              <span className="att-week-legend"><i className="att-wc-a">A</i> Absent</span>
              <span className="att-week-legend"><i className="att-wc-l">L</i> Late</span>
              <span className="att-week-legend"><i className="att-wc-n">·</i> Not marked</span>
            </div>
          </div>

          {weekLoading && !weekLoaded ? (
            <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading week…</div>
          ) : (
            <>
              <motion.div className="table-wrap att-week-wrap" animate={{ opacity: weekLoading ? 0.6 : 1 }} transition={{ duration: 0.25 }}>
                <table className="att-week-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 170 }}>Student</th>
                      {weekDays.map((d, i) => {
                        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                        const dt = new Date(`${d}T00:00:00`);
                        const name = isNaN(dt.getTime()) ? `D${i + 1}` : dayNames[(dt.getDay() + 6) % 7];
                        return (
                          <th key={d} className={`att-week-th${d === todayIso ? ' is-today' : ''}`} style={{ textAlign: 'center', width: 64 }}>
                            {name}
                            <span className="att-week-date">{Number(d.slice(-2))}</span>
                          </th>
                        );
                      })}
                      <th style={{ textAlign: 'center', width: 74 }}>Rate</th>
                    </tr>
                  </thead>
                  <tbody key={`wk-${weekStart}`}>
                    {weekGrid.length === 0 && (
                      <tr><td colSpan={weekDays.length + 2} style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--muted)' }}>
                        No students in this class yet.
                      </td></tr>
                    )}
                    {weekGrid.map(s => (
                      <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="attendance-row">
                        <td style={{ fontWeight: 600, fontSize: 14 }}>
                          <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12, marginRight: 10 }}>{s.id}</span>{s.name}
                        </td>
                        {weekDays.map((d, i) => (
                          <td key={d} style={{ textAlign: 'center' }}>
                            <WeekCell status={s.days[i]} today={d === todayIso}
                              dirty={dirty[`${s.id}|${d}`] !== undefined}
                              onClick={() => cycleWeekCell(s.id, i, d)} />
                          </td>
                        ))}
                        <td style={{ textAlign: 'center' }}>
                          <span className={`att-week-rate${s.week_rate == null ? ' is-none' : s.week_rate >= 90 ? ' is-good' : s.week_rate >= 75 ? ' is-mid' : ' is-low'}`}>
                            {s.week_rate == null ? '—' : `${Math.round(s.week_rate)}%`}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>Present / day</td>
                      {weekDays.map((d, i) => {
                        const marked = weekGrid.filter(r => r.days[i]);
                        const p = weekGrid.filter(r => r.days[i] === 'P').length;
                        const pct = marked.length ? Math.round(p / marked.length * 100) : null;
                        return (
                          <td key={d} style={{ textAlign: 'center' }}>
                            <span className={`att-week-rate${pct == null ? ' is-none' : pct >= 90 ? ' is-good' : pct >= 75 ? ' is-mid' : ' is-low'}`}>
                              {pct == null ? '—' : `${pct}%`}
                            </span>
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </motion.div>

              <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 14 }}>
                <motion.button onClick={saveWeek} disabled={savingWeek || !dirtyCount} className="btn btn-primary"
                  whileHover={dirtyCount ? { y: -2 } : {}} whileTap={{ scale: 0.97 }} style={{ padding: '12px 30px', fontSize: 14, opacity: dirtyCount ? 1 : 0.55 }}>
                  {savingWeek ? (<><motion.span className="spin-icon" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ marginRight: 8, display: 'inline-flex' }}><Loader2 size={16} /></motion.span>Saving...</>) : <><Save size={15} style={{ marginRight: 6, display: 'inline-flex', verticalAlign: '-2px' }} /> Save Week{dirtyCount ? ` (${dirtyCount} change${dirtyCount > 1 ? 's' : ''})` : ''}</>}
                </motion.button>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Click any cell to cycle P → A → L. Unsaved edits pulse.</span>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}
