/* Compare modal (.cmp kit) — strictly A vs B over GRADE / CLASS / STUDENT /
   FOLDER entities (school-scoped), 4 metric groups as paired bars with
   winner highlight, delta chips and a lead summary.
   All numbers are computed from data already fetched from the backend
   (classes list, student reports, saved-folder reports). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { fetchStudentReport } from './data';
import { Donut, useReveal } from './charts';
import { mean, pct } from './util';

const TYPES = [
  ['grade', 'GRADE'],
  ['class', 'CLASS'],
  ['student', 'STUDENT'],
  ['folder', 'FOLDER'],
];

async function reportOf(id) {
  try {
    return await fetchStudentReport(id);
  } catch {
    return null;
  }
}

export default function CompareModal({ onClose, classesAll = [], folders = [] }) {
  const reveal = useReveal();
  const grades = useMemo(
    () => [...new Set(classesAll.map((c) => c.grade))].sort((a, b) => a - b),
    [classesAll],
  );
  const [students, setStudents] = useState(null); // for the STUDENT selects
  const [state, setState] = useState(() => ({
    A: { type: 'grade', id: null },
    B: { type: 'class', id: null },
  }));
  const [seeded, setSeeded] = useState(false);
  const [ms, setMs] = useState({ A: '', B: '' });
  const [metrics, setMetrics] = useState(null);
  const [mKey, setMKey] = useState('');
  const closeRef = useRef(null);

  /* busy is derived: true until metrics for the CURRENT selection have landed */
  const stateKey = JSON.stringify([state.A, state.B, classesAll.length, folders.length]);
  const busy = mKey !== stateKey;

  /* seed default ids once the classes list is known (render-phase adjust) */
  if (!seeded && classesAll.length) {
    setSeeded(true);
    setState((s) => ({
      A: { ...s.A, id: s.A.id ?? String(grades[grades.length - 1]) },
      B: { ...s.B, id: s.B.id ?? String(classesAll[0].id) },
    }));
  }

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /* students list for the STUDENT selects — debounced SERVER-side search.
     The backend caps page_size at 200, so a static fetch can only ever see
     a slice of the school; typing in the search box now queries the API
     and reaches every student. Shared list for both sides (existing UX). */
  const stuQ = (state.A.type === 'student' ? ms.A : '') || (state.B.type === 'student' ? ms.B : '');
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      import('./data').then(({ fetchStudents }) =>
        fetchStudents({ search: stuQ.trim(), page: 1, pageSize: stuQ.trim() ? 50 : 200 })
          .then((d) => { if (alive) setStudents(d.students); })
          .catch(() => { if (alive) setStudents([]); }),
      );
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [stuQ]);

  /* resolve metrics whenever a side changes */
  useEffect(() => {
    let alive = true;
    const key = JSON.stringify([state.A, state.B, classesAll.length, folders.length]);
    const resolve = async ({ type, id }) => {
      if (type === 'grade') {
        const cs = classesAll.filter((c) => String(c.grade) === String(id));
        if (!cs.length) return { name: `Grade ${id ?? '—'}`, sub: 'no classes', marks: 0, att: 0, tasks: 0 };
        return {
          name: `Grade ${id}`,
          sub: `${cs.length} classes · ${cs.reduce((a, c) => a + (c.students || 0), 0)} students`,
          marks: Math.round(mean(cs.map((c) => c.avg))),
          att: Math.round(mean(cs.map((c) => c.attendance_pct))),
          tasks: Math.round(mean(cs.map((c) => c.tasks_pct))),
        };
      }
      if (type === 'class') {
        const c = classesAll.find((x) => String(x.id) === String(id));
        if (!c) return { name: 'Class —', sub: '—', marks: 0, att: 0, tasks: 0 };
        return {
          name: `Class ${c.name}`,
          sub: `Grade ${c.grade} · ${c.students ?? '—'} students`,
          marks: pct(c.avg), att: pct(c.attendance_pct), tasks: pct(c.tasks_pct),
        };
      }
      if (type === 'student') {
        const r = await reportOf(id);
        if (!r) return { name: 'Student —', sub: 'unavailable', marks: 0, att: 0, tasks: 0 };
        return {
          name: r.student?.name || 'Student',
          sub: `Class ${r.student?.class_name || '—'} · school rank #${r.ranks?.in_school ?? '—'}`,
          marks: r.derived.marks, att: r.derived.attendance, tasks: r.derived.tasks,
        };
      }
      /* folder */
      const f = folders.find((x) => String(x.id) === String(id));
      const ids = f?.studentIds || [];
      if (!ids.length) return { name: f?.name || 'No folder', sub: 'empty folder — save students first', marks: 0, att: 0, tasks: 0 };
      const reports = (await Promise.all(ids.map(reportOf))).filter(Boolean);
      return {
        name: f.name,
        sub: `${reports.length} saved students · averaged`,
        marks: Math.round(mean(reports.map((r) => r.derived.marks))),
        att: Math.round(mean(reports.map((r) => r.derived.attendance))),
        tasks: Math.round(mean(reports.map((r) => r.derived.tasks))),
      };
    };
    Promise.all([resolve(state.A), resolve(state.B)]).then(([A, B]) => {
      if (!alive) return;
      setMetrics({ A, B });
      setMKey(key);
    });
    return () => { alive = false; };
  }, [state, classesAll, folders]);

  const optionsFor = (side) => {
    const { type } = state[side];
    if (type === 'grade') return grades.map((g) => ({ value: String(g), label: `Grade ${g}` }));
    if (type === 'class') return classesAll.map((c) => ({ value: String(c.id), label: `${c.name} — ${pct(c.avg)}%` }));
    if (type === 'folder') {
      return folders.length
        ? folders.map((f) => ({ value: String(f.id), label: `${f.name} — ${f.studentIds.length} saved` }))
        : [{ value: '', label: 'No folders yet' }];
    }
    return (students || []).map((s) => ({
      value: String(s.id),
      label: `${s.rank ? `#${s.rank} · ` : ''}${s.name} (${s.className})`,
    }));
  };

  const setSide = (side, patch) => setState((s) => ({ ...s, [side]: { ...s[side], ...patch } }));

  const firstIdFor = (type) => {
    if (type === 'grade') return grades.length ? String(grades[grades.length - 1]) : null;
    if (type === 'class') return classesAll.length ? String(classesAll[0].id) : null;
    if (type === 'folder') return folders.length ? String(folders[0].id) : '';
    return students?.length ? String(students[0].id) : null;
  };

  const swap = () => setState((s) => ({ A: s.B, B: s.A }));

  const ov = (M) => M.overall ?? Math.round((M.marks + M.att + M.tasks) / 3);
  const fmtv = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  const groups = metrics
    ? [
        { cat: 'MARKS', a: metrics.A.marks, b: metrics.B.marks },
        { cat: 'ATTENDANCE', a: metrics.A.att, b: metrics.B.att },
        { cat: 'TASK COMPLETION', a: metrics.A.tasks, b: metrics.B.tasks },
        { cat: 'OVERALL', a: ov(metrics.A), b: ov(metrics.B) },
      ]
    : [];

  let aW = 0;
  let bW = 0;
  let tied = 0;
  if (metrics) {
    [[metrics.A.att, metrics.B.att], [metrics.A.marks, metrics.B.marks], [metrics.A.tasks, metrics.B.tasks]]
      .forEach(([x, y]) => { if (x > y) aW++; else if (y > x) bW++; else tied++; });
  }

  const entitySide = (side) => {
    const st = state[side];
    const M = metrics?.[side];
    const opts = optionsFor(side);
    const q = ms[side].trim().toLowerCase();
    return (
      <div className="card cmp-entity">
        <div className="cmp-ehead">
          <span className={`cmp-badge ${side.toLowerCase()}`}>{side}</span>
          <div className="info">
            <div className="nm">{M ? M.name : '—'}</div>
            <div className="sub">{M ? M.sub : '—'}</div>
          </div>
          <span className={side === 'A' ? 'lvlc-a' : 'lvlc-b'}>
            {M ? <Donut value={ov(M)} variant="d-sm" /> : <span className="donut d-sm" />}
          </span>
        </div>
        <div className="msearch">
          <Search strokeWidth={2} />
          <input
            placeholder={st.type === 'student' ? 'Search all students by name — then pick below' : side === 'A' ? 'Search the list — e.g. “Ananya”' : 'Search the list — e.g. “10-Sapphire”'}
            value={ms[side]}
            onChange={(e) => setMs((m) => ({ ...m, [side]: e.target.value }))}
          />
        </div>
        <div className="cmp-row">
          <div className="seg">
            {TYPES.map(([t, label]) => (
              <button
                key={t}
                type="button"
                className={`gtab${st.type === t ? ' active' : ''}`}
                onClick={() => { setSide(side, { type: t, id: firstIdFor(t) }); setMs((m) => ({ ...m, [side]: '' })); }}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={st.id ?? ''}
            onChange={(e) => setSide(side, { id: e.target.value })}
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value} hidden={!!q && !o.label.toLowerCase().includes(q)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {st.type === 'student' && (
          <div className="cmp-hint">
            {students === null
              ? 'LOADING STUDENTS…'
              : `${students.length} ${students.length === 1 ? 'STUDENT' : 'STUDENTS'} LOADED${q ? ' · MATCHES — REFINING SEARCHES QUERIES THE WHOLE SCHOOL' : ' · TYPE ABOVE TO SEARCH EVERY STUDENT'}`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmp">
        <div className="rep-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">SCHOOL INTELLIGENCE</div>
            <h2>Compare</h2>
            <div className="subtitle">All-year attendance, marks &amp; task completion — side by side.</div>
          </div>
          <button ref={closeRef} type="button" className="btn-close" onClick={onClose} aria-label="Close">
            <X strokeWidth={2.4} />
          </button>
        </div>

        <div className="cmp-entities">
          {entitySide('A')}
          <button type="button" className="btn-swap" onClick={swap} title="Swap A and B" aria-label="Swap A and B">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" /></svg>
          </button>
          {entitySide('B')}
        </div>

        <div className="card bigchart">
          <div className="bc-top">
            <div className="bc-legend">
              <span><span className="dot a" />A · {metrics?.A?.name || '—'}</span>
              <span><span className="dot b" />B · {metrics?.B?.name || '—'}</span>
            </div>
            <span className="bc-hint">ALL-YEAR AVERAGES · 0–100%</span>
          </div>
          <div className="bc-wrap">
            <div className="bc-y"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
            <div className="bc-plot">
              <div className="bc-grid">
                {[0, 25, 50, 75, 100].map((v) => <i key={v} style={{ top: `${v}%` }} />)}
              </div>
              <div className="bc-groups">
                {busy && !metrics
                  ? <div className="pd-note" style={{ margin: 'auto' }}>Computing…</div>
                  : groups.map((g2) => {
                      const d = Math.abs(g2.a - g2.b).toFixed(1);
                      const win = g2.a === g2.b ? '' : g2.a > g2.b ? 'a' : 'b';
                      return (
                        <div className="bc-group" key={g2.cat}>
                          <div className="bc-pair">
                            <div className={`bc-bar a${win === 'a' ? ' win' : ''}`}>
                              <span className="bc-val">{fmtv(g2.a)}%</span>
                              <i className="bc-fill" style={{ height: reveal ? `${Math.min(100, g2.a)}%` : 0 }} />
                            </div>
                            <div className={`bc-bar b${win === 'b' ? ' win' : ''}`}>
                              <span className="bc-val">{fmtv(g2.b)}%</span>
                              <i className="bc-fill" style={{ height: reveal ? `${Math.min(100, g2.b)}%` : 0 }} />
                            </div>
                          </div>
                          <div className="bc-cat">
                            {g2.cat}
                            {win
                              ? <span className={`delta ${win}`}>▲ {win.toUpperCase()} +{d}</span>
                              : <span className="delta">TIE</span>}
                          </div>
                        </div>
                      );
                    })}
              </div>
            </div>
          </div>
          <div className="cmp-note">
            {metrics
              ? (aW === 0 && bW === 0 && tied === 3
                ? 'PERFECTLY TIED ACROSS ALL THREE METRICS'
                : <><b>{metrics.A.name}</b> leads {aW} · <b>{metrics.B.name}</b> leads {bW}{tied ? ` · tied ${tied}` : ''}</>)
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
