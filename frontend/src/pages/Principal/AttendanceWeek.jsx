import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarRange, ChevronLeft, ChevronRight, Download, Users, Percent,
  Award, AlertTriangle, Lock, CalendarCheck, TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, EASE, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { CountUp, Toast } from '../../components/ui.jsx';

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/* week window helpers — Monday-anchored, same contract as /attendance/week */
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/* tiny 6-week attendance sparkline rendered INSIDE a follow-up pill */
function FuSpark({ weeks }) {
  if (!weeks || !weeks.length) return null;
  return (
    <span className="fx-fu-spark" role="img" aria-label="Six week attendance trend">
      {weeks.map((w, i) => (
        <i key={i} title={w.pct == null ? `${w.label} · no data` : `${w.label} · ${w.pct}%`}
          className={`${w.pct == null ? 'is-empty' : w.pct >= 90 ? 'is-good' : w.pct >= 75 ? 'is-mid' : 'is-low'}${i === weeks.length - 1 ? ' is-cur' : ''}`}
          style={{ height: w.pct == null ? 3 : Math.max(3, Math.round(w.pct * 0.16)) }} />
      ))}
    </span>
  );
}

export default function PrincipalAttendanceWeek() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [weekStart, setWeekStart] = useState(() => isoOf(mondayOf(new Date())));
  const [week, setWeek] = useState(null);      // { start, days[5], students[] }
  const [trend, setTrend] = useState(null);    // { weeks: [{start,label,pct,marked,present}] }
  const [stuTrends, setStuTrends] = useState({}); // sid → [{pct,label,...}] for follow-up pills
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (m, t = 'success') => { setToast({ message: m, type: t }); setTimeout(() => setToast(null), 2600); };

  /* classes of this principal's school (client-side filter over /admin/classes) */
  useEffect(() => {
    api.get('/admin/classes').then(r => {
      const mine = (r.data || []).filter(c => !user?.school_id || c.school_id === user.school_id);
      setClasses(mine);
      if (mine.length) setClassId(prev => (prev && mine.some(c => String(c.id) === String(prev))) ? prev : String(mine[0].id));
    }).catch(e => console.error(e));
  }, [user?.school_id]);

  const fetchWeek = useCallback(async (cid, start) => {
    if (!cid || !start) return;
    setLoading(true);
    try {
      const r = await api.get(`/attendance/week/${cid}?start=${start}`);
      setWeek(r.data);
      setLoaded(true);
    } catch (e) { console.error(e); showToast('Failed to load week', 'error'); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { fetchWeek(classId, weekStart); }, 0);
    return () => clearTimeout(t);
  }, [classId, weekStart, fetchWeek]);

  /* 6-week present% trend for the selected class (independent of weekStart) */
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      if (!classId) { setTrend(null); return; }
      api.get(`/attendance/trend/${classId}?weeks=6`).then(r => {
        if (!stale) setTrend(r.data.weeks || []);
      }).catch(e => console.error(e));
    }, 0);
    return () => { stale = true; clearTimeout(t); };
  }, [classId]);

  /* per-student 6-week trends for the follow-up pills (≤4 small requests).
     NOTE: declared after `lowStudents` is memoized (its dep array reads it). */

  const shiftWeek = (delta) => {
    const d = new Date(`${weekStart}T00:00:00`);
    setWeekStart(isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta * 7)));
  };

  const weekLabel = useMemo(() => {
    if (!week?.days?.length) return weekStart;
    const a = new Date(`${week.days[0]}T00:00:00`), b = new Date(`${week.days[4]}T00:00:00`);
    return `${MO[a.getMonth()]} ${a.getDate()} – ${MO[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
  }, [week, weekStart]);

  /* ── derived metrics (all client-side, read-only) ── */
  const dayStats = useMemo(() => {
    const rows = week?.students || [];
    return (week?.days || []).map((d, i) => {
      const marked = rows.filter(r => r.days[i]);
      const p = rows.filter(r => r.days[i] === 'P').length;
      return { date: d, name: DAY_NAMES[i], marked: marked.length, present: p, pct: marked.length ? Math.round(p / marked.length * 100) : null };
    });
  }, [week]);

  const weekAvg = useMemo(() => {
    const vals = dayStats.filter(s => s.pct !== null).map(s => s.pct);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [dayStats]);

  const bestDay = useMemo(() => {
    const withData = dayStats.filter(s => s.pct !== null);
    return withData.length ? withData.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
  }, [dayStats]);

  const lowDays = useMemo(() => dayStats.filter(s => s.pct !== null && s.pct < 75), [dayStats]);

  const lowStudents = useMemo(() => {
    const rows = (week?.students || []).filter(r => r.week_rate != null && r.week_rate < 75);
    return rows.sort((a, b) => a.week_rate - b.week_rate).slice(0, 4);
  }, [week]);

  /* per-student 6-week trends for the follow-up pills (≤4 small requests) */
  useEffect(() => {
    let stale = false;
    const ids = lowStudents.map(r => r.id);
    const t = setTimeout(() => {
      if (!ids.length) { setStuTrends(prev => (Object.keys(prev).length ? {} : prev)); return; }
      ids.forEach(sid => {
        api.get(`/attendance/student-trend/${sid}?weeks=6`).then(r => {
          if (!stale) setStuTrends(prev => ({ ...prev, [sid]: r.data.weeks || [] }));
        }).catch(e => console.error(e));
      });
    }, 0);
    return () => { stale = true; clearTimeout(t); };
  }, [lowStudents]);

  const hasAnyMark = (week?.students || []).some(r => r.days.some(Boolean));

  /* CSV of the whole week (student · 5 day columns · week rate) */
  const exportCsv = () => {
    if (!week?.students?.length) { showToast('Nothing to export yet', 'error'); return; }
    const cls = classes.find(c => String(c.id) === String(classId));
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Student', ...week.days.map(d => DAY_NAMES[week.days.indexOf(d)] + ' ' + Number(d.slice(-2))), 'Week Rate'].map(esc).join(',') + '\n';
    const body = week.students.map(r => [r.name, ...r.days.map(s => s || ''), r.week_rate != null ? `${Math.round(r.week_rate)}%` : ''].map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${(cls?.label || 'class').replace(/\s+/g, '')}-${week.days[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${week.students.length} students`, 'success');
  };

  const todayIso = isoOf(new Date());
  const selClass = classes.find(c => String(c.id) === String(classId));

  /* week-over-week direction (last two data-bearing weeks) */
  const trendDir = useMemo(() => {
    if (!trend) return null;
    const vals = trend.filter(w => w.pct != null);
    if (vals.length < 2) return null;
    const last = vals[vals.length - 1].pct, prev = vals[vals.length - 2].pct;
    return last - prev;
  }, [trend]);

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / Attendance Weeks</div>
          <h1>Attendance Weeks</h1>
          <div className="subtitle">Read-only week explorer — review any class's Mon-Fri attendance at a glance</div>
        </div>
        <span className="fx-readonly-chip" title="Principals review attendance; editing stays with the class teacher">
          <Lock size={11} /> READ-ONLY
        </span>
      </div>

      {/* controls */}
      <div className="card controls-bar" style={{ padding: '14px 18px', marginTop: 6, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="filter-label" style={{ fontSize: 12 }}>Class</label>
          <select value={classId} onChange={e => setClassId(e.target.value)} className="input" style={{ width: 'auto', minWidth: 190 }} aria-label="Choose class">
            {classes.length === 0 && <option value="">No classes in your school</option>}
            {classes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn btn-secondary" onClick={() => shiftWeek(-1)} aria-label="Previous week" style={{ padding: '7px 9px' }}><ChevronLeft size={15} /></button>
            <div className="att-week-label">{weekLabel}</div>
            <button type="button" className="btn btn-secondary" onClick={() => shiftWeek(1)} aria-label="Next week" style={{ padding: '7px 9px' }}><ChevronRight size={15} /></button>
            <button type="button" className="btn btn-secondary" onClick={() => setWeekStart(isoOf(mondayOf(new Date())))} style={{ fontSize: 12 }}>This week</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="att-week-legend"><i className="att-wc-p">P</i> Present</span>
          <span className="att-week-legend"><i className="att-wc-a">A</i> Absent</span>
          <span className="att-week-legend"><i className="att-wc-l">L</i> Late</span>
          <span className="att-week-legend"><i className="att-wc-n">·</i> Not marked</span>
          <button onClick={exportCsv} className="btn btn-ghost" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Download this week's sheet as CSV">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 0, marginBottom: 20 }}>
        <div className="card-stats cols-4">
          {[
            { v: week?.students?.length ?? 0, l: 'Students', Icon: Users, accent: 'a-indigo' },
            { v: weekAvg == null ? null : weekAvg, l: 'Week Present Avg', Icon: Percent, accent: 'a-teal', suffix: '%', bar: weekAvg, barColor: 'var(--teal)' },
            { v: bestDay ? `${bestDay.name}` : '—', l: bestDay ? `Best Day · ${bestDay.pct}%` : 'Best Day', Icon: Award, accent: 'a-amber', text: true },
            { v: lowStudents.length, l: 'Students Under 75%', Icon: AlertTriangle, accent: lowStudents.length ? 'a-red' : 'a-teal', bar: lowStudents.length, barColor: lowStudents.length ? 'linear-gradient(90deg,#f87171,#dc2626)' : 'var(--teal)' },
          ].map((s, i) => {
            const SIcon = s.Icon;
            return (
              <motion.div key={i} variants={staggerItem} className={`stat-cell ${s.accent}`}>
                <div className="ic"><SIcon size={15} strokeWidth={2.2} /></div>
                <div>
                  <div className="k">{s.l}</div>
                  <div className="v" style={s.text ? { fontSize: 22 } : undefined}>
                    {s.v === null ? '—' : s.text ? s.v : <CountUp value={s.v} />}{s.suffix && s.v !== null && !s.text ? <span className="of">{s.suffix}</span> : null}
                  </div>
                  {s.bar !== undefined && (
                    <div className="attendance-bar-track">
                      <motion.div className="attendance-bar-fill" initial={{ width: 0 }} animate={{ width: `${Math.min(100, s.bar || 0)}%` }} transition={{ duration: 0.7, ease: EASE }} style={{ background: s.barColor }} />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* 6-week trend strip */}
      {trend && trend.length > 0 && (
        <motion.div className="card fx-trend-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} style={{ padding: '16px 18px', marginBottom: 20 }}>
          <div className="fx-trend-head">
            <div className="chart-title-premium" style={{ fontSize: 14 }}><TrendingUp size={15} /> 6-Week Attendance Trend</div>
            {trendDir != null && (
              <span className={`fx-trend-dir ${trendDir > 0 ? 'is-up' : trendDir < 0 ? 'is-down' : 'is-flat'}`}>
                {trendDir > 0 ? <ArrowUpRight size={13} /> : trendDir < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}
                {Math.abs(trendDir).toFixed(1)} pts vs last week
              </span>
            )}
          </div>
          <div className="fx-trend-strip" role="img" aria-label="Attendance percent for the last six weeks">
            {trend.map((w, i) => {
              const isCurrent = i === trend.length - 1;
              return (
                <div key={w.start} className={`fx-trend-col${isCurrent ? ' is-current' : ''}${w.pct == null ? ' is-empty' : ''}`}
                  title={w.pct == null ? `${w.label} · no attendance marked` : `${w.label} · ${w.pct}% · ${w.present}/${w.marked} present`}>
                  <span className="fx-trend-val">{w.pct == null ? '—' : `${Math.round(w.pct)}%`}</span>
                  <motion.span className={`fx-trend-bar ${w.pct == null ? '' : w.pct >= 90 ? 'is-good' : w.pct >= 75 ? 'is-mid' : 'is-low'}`}
                    initial={{ height: 4 }} animate={{ height: w.pct == null ? 4 : Math.max(6, Math.round(w.pct * 0.52)) }}
                    transition={{ duration: 0.6, delay: i * 0.06, ease: EASE }} />
                  <span className="fx-trend-label">{w.label}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* low-day / low-student insight strip */}
      {(lowDays.length > 0 || lowStudents.length > 0) && (
        <motion.div className="card fx-att-insight" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {lowDays.length > 0 && (
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="stat-label" style={{ color: '#b45f04', marginBottom: 8 }}>Weak Days (under 75%)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {lowDays.map(d => (
                  <motion.span key={d.date} className="pill-tag" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                    style={{ background: 'rgba(180,95,4,.14)', color: '#b45f04', fontWeight: 800, padding: '5px 12px', fontSize: 12 }}>
                    {d.name} {Number(d.date.slice(-2))} · {d.pct}%
                  </motion.span>
                ))}
              </div>
            </div>
          )}
          {lowStudents.length > 0 && (
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="stat-label" style={{ color: '#dc2626', marginBottom: 8 }}>Follow Up (lowest rates)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {lowStudents.map(r => {
                  const tw = stuTrends[r.id];
                  const vals = (tw || []).filter(w => w.pct != null);
                  const delta = vals.length >= 2 ? vals[vals.length - 1].pct - vals[vals.length - 2].pct : null;
                  return (
                    <motion.span key={r.id} className="fx-fu-pill" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                      title={delta == null ? `${r.name} — ${Math.round(r.week_rate)}% this week` : `${r.name} — ${Math.round(r.week_rate)}% this week · ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts vs last week`}>
                      <span className="fx-fu-name">{r.name}</span>
                      <span className="fx-fu-rate">{Math.round(r.week_rate)}%</span>
                      <FuSpark weeks={stuTrends[r.id]} />
                      {delta != null && (
                        <span className={`fx-fu-delta ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'}`}>
                          {delta > 0 ? <ArrowUpRight size={11} /> : delta < 0 ? <ArrowDownRight size={11} /> : <Minus size={11} />}
                          {Math.abs(delta).toFixed(1)}
                        </span>
                      )}
                    </motion.span>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* the read-only grid */}
      {loading && !loaded ? (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--muted)' }}>Loading week…</div>
      ) : !classId ? (
        <div className="card" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><CalendarCheck size={40} color="var(--muted)" /></div>
          <p style={{ color: 'var(--body-text)', fontSize: 15 }}>No classes found for your school.</p>
        </div>
      ) : !hasAnyMark && loaded ? (
        <div className="card" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><CalendarRange size={40} color="var(--muted)" /></div>
          <p style={{ color: 'var(--body-text)', fontSize: 15, marginBottom: 6 }}>No attendance marked for {selClass?.label || 'this class'} in {weekLabel}.</p>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Teachers mark attendance from their Attendance board — pick another week with the arrows above.</p>
        </div>
      ) : (
        <motion.div className="table-wrap att-week-wrap" animate={{ opacity: loading ? 0.6 : 1 }} transition={{ duration: 0.25 }}>
          <table className="att-week-table">
            <thead>
              <tr>
                <th style={{ minWidth: 170 }}>Student</th>
                {(week?.days || []).map((d, i) => (
                  <th key={d} className={`att-week-th${d === todayIso ? ' is-today' : ''}`} style={{ textAlign: 'center', width: 64 }}>
                    {DAY_NAMES[i]}<span className="att-week-date">{Number(d.slice(-2))}</span>
                  </th>
                ))}
                <th style={{ textAlign: 'center', width: 74 }}>Rate</th>
              </tr>
            </thead>
            <tbody key={`pawk-${classId}-${weekStart}`}>
              {(week?.students || []).map((s, ri) => (
                <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: Math.min(ri * 0.015, 0.4) }} className="attendance-row fx-att-ro-row">
                  <td style={{ fontWeight: 600, fontSize: 14 }}>
                    <span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12, marginRight: 10 }}>{s.id}</span>{s.name}
                  </td>
                  {s.days.map((st, i) => {
                    const conf = st ? { P: ['P', 'att-wc-p'], A: ['A', 'att-wc-a'], L: ['L', 'att-wc-l'] }[st] : null;
                    return (
                      <td key={i} style={{ textAlign: 'center' }}>
                        <span title={st ? { P: 'Present', A: 'Absent', L: 'Late' }[st] : 'Not marked'}
                          className={`att-week-cell fx-att-ro${conf ? ` ${conf[1]}` : ' att-wc-n'}${(week?.days || [])[i] === todayIso ? ' is-today' : ''}`}>
                          {conf ? conf[0] : '·'}
                        </span>
                      </td>
                    );
                  })}
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
                {dayStats.map(d => (
                  <td key={d.date} style={{ textAlign: 'center' }}>
                    <span className={`att-week-rate${d.pct == null ? ' is-none' : d.pct >= 90 ? ' is-good' : d.pct >= 75 ? ' is-mid' : ' is-low'}`}>
                      {d.pct == null ? '—' : `${d.pct}%`}
                    </span>
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </motion.div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={12} /> Review mode — editing stays with the class teacher on their Attendance board.
      </div>
    </Page>
  );
}
