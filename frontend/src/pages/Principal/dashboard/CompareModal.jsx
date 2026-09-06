/* Compare modal — designer v15: add up to 7 entities (SCHOOL / GRADE /
   CLASS / STUDENT / FOLDER); each becomes a bar in every metric group
   (MARKS / ATTENDANCE / TASK COMPLETION / OVERALL). Metrics come from the
   NEW POST /principal/compare endpoint; folders carry their member ids
   from localStorage. Winner highlight + "highest overall" note. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { compareEntities, fetchStudents } from './data';
import { useReveal } from './charts';
import { pct } from './util';

const CMP_MAX = 7;
const CMP_COLORS = ['#4f42dd', '#0c7a6b', '#b45f04', '#c2255c', '#0e7490', '#9333ea', '#d97706'];
const TYPES = [
  ['school', 'SCHOOL'],
  ['grade', 'GRADE'],
  ['class', 'CLASS'],
  ['student', 'STUDENT'],
  ['folder', 'FOLDER'],
];

export default function CompareModal({ onClose, classesAll = [], folders = [] }) {
  const reveal = useReveal();
  const grades = useMemo(
    () => [...new Set(classesAll.map((c) => c.grade))].sort((a, b) => a - b),
    [classesAll],
  );
  const [type, setType] = useState('class');
  const [ms, setMs] = useState('');
  const [students, setStudents] = useState(null);
  const [ents, setEnts] = useState([]); // [{key,type,id,name,color}]
  const [metrics, setMetrics] = useState(null); // resolved [{...ents, marks, attendance, tasks, overall}]
  const closeRef = useRef(null);
  const selRef = useRef(null);

  useEffect(() => { closeRef.current?.focus(); }, []);

  /* students list for the STUDENT select (server-wide search) */
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      fetchStudents({ search: ms.trim(), page: 1, pageSize: ms.trim() ? 50 : 200 })
        .then((d) => { if (alive) setStudents(d.students); })
        .catch(() => { if (alive) setStudents([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [ms]);

  const options = useMemo(() => {
    if (type === 'school') return [{ value: 'school', label: 'Entire School' }];
    if (type === 'grade') return grades.map((g) => ({ value: String(g), label: `Grade ${g}` }));
    if (type === 'class') return classesAll.map((c) => ({ value: String(c.id), label: `${c.name} — ${pct(c.avg)}%` }));
    if (type === 'folder') {
      return folders.length
        ? folders.map((f) => ({ value: String(f.id), label: `${f.name} — ${f.studentIds.length} saved` }))
        : [{ value: 'none', label: 'No folders yet' }];
    }
    return (students || []).map((s) => ({
      value: String(s.id),
      label: `${s.rank ? `#${s.rank} · ` : ''}${s.name} (${s.className})`,
    }));
  }, [type, grades, classesAll, folders, students]);

  /* keep the select valid when type/options change */
  useEffect(() => {
    const sel = selRef.current;
    if (!sel) return;
    const valid = [...sel.options].some((o) => o.value === sel.value);
    if (!valid && sel.options.length) sel.value = sel.options[0].value;
  }, [options]);

  const ql = ms.trim().toLowerCase();

  const addEntity = () => {
    const sel = selRef.current;
    if (!sel || ents.length >= CMP_MAX || !sel.value || sel.value === 'none') return;
    const key = `${type}|${sel.value}`;
    if (ents.some((e) => e.key === key)) return;
    let name = sel.selectedOptions[0]?.label.split(' — ')[0] || sel.value;
    if (type === 'school') name = 'Entire School';
    if (type === 'student') name = (students || []).find((s) => String(s.id) === sel.value)?.name || name;
    if (type === 'folder') name = folders.find((f) => String(f.id) === sel.value)?.name || name;
    setEnts((p) => [...p, { key, type, id: sel.value, name, color: CMP_COLORS[p.length % CMP_COLORS.length] }]);
    setMs('');
  };

  const removeEntity = (i) => {
    setEnts((p) => p.filter((_, k) => k !== i)
      .map((e, k) => ({ ...e, color: CMP_COLORS[k % CMP_COLORS.length] })));
  };

  /* resolve metrics whenever the entity list changes */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!ents.length) { setMetrics([]); return; }
    const payload = ents.map((e) => {
      if (e.type === 'folder') {
        const f = folders.find((x) => String(x.id) === e.id);
        return { type: 'folder', id: e.id, name: e.name, student_ids: f?.studentIds || [] };
      }
      return { type: e.type, id: e.id };
    });
      await compareEntities(payload)
        .then((d) => {
          if (!alive) return;
          setMetrics((d.entities || []).map((m, i) => ({ ...m, color: ents[i]?.color })));
        })
        .catch(() => { if (alive) setMetrics([]); });
    };
    run();
    return () => { alive = false; };
  }, [ents, folders]);

  const cats = [
    { cat: 'MARKS', k: 'marks' },
    { cat: 'ATTENDANCE', k: 'attendance' },
    { cat: 'TASK COMPLETION', k: 'tasks' },
    { cat: 'OVERALL', k: 'overall' },
  ];
  const N = (metrics || []).length;
  let note = 'ADD ENTITIES ABOVE TO COMPARE';
  if (N === 1) note = null;
  else if (N > 1) {
    const best = [...metrics].sort((a, b) => b.overall - a.overall)[0];
    note = (
      <>HIGHEST OVERALL · <b style={{ color: best.color }}>{best.name}</b> ({Math.round(best.overall)}%)</>
    );
  }

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmp">
        <div className="rep-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">FETCH-X</div>
            <h2>Compare</h2>
            <div className="subtitle">Add up to {CMP_MAX} entities — each becomes a bar in every metric group.</div>
          </div>
          <button ref={closeRef} type="button" className="btn-close" onClick={onClose} aria-label="Close">
            <X strokeWidth={2.4} />
          </button>
        </div>

        <div className="cmp-row" style={{ marginTop: 14 }}>
          <div className="seg">
            {TYPES.map(([t, label]) => (
              <button
                key={t} type="button"
                className={`gtab${type === t ? ' active' : ''}`}
                onClick={() => { setType(t); setMs(''); }}
              >
                {label}
              </button>
            ))}
          </div>
          <select ref={selRef} defaultValue={options[0]?.value}>
            {options.map((o) => (
              <option key={o.value} value={o.value} hidden={!!ql && !o.label.toLowerCase().includes(ql)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <div className="msearch">
            <Search strokeWidth={2} />
            <input
              placeholder="Search the list — e.g. “Ananya”"
              value={ms}
              onChange={(e) => setMs(e.target.value)}
            />
          </div>
          <button type="button" className="ct-btn solid" onClick={addEntity} disabled={ents.length >= CMP_MAX} style={{ opacity: ents.length >= CMP_MAX ? 0.5 : 1 }}>
            + ADD ENTITY
          </button>
        </div>

        <div className="cmp-chips">
          {ents.length
            ? ents.map((e, i) => (
              <button type="button" key={e.key} className="cmp-chip" style={{ background: e.color }}
                title={`Remove ${e.name}`} onClick={() => removeEntity(i)}>
                <b>{e.name}</b><span className="x">✕</span>
              </button>
            ))
            : <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', padding: '4px 2px' }}>No entities yet — add at least one to compare.</span>}
        </div>

        <div className="card bigchart" style={{ marginTop: 14 }}>
          <div className="bc-top">
            <div className="bc-legend">
              {(metrics || []).map((m) => (
                <span key={m.key}><span className="dot" style={{ background: m.color }} />{m.name}</span>
              ))}
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
                {!N
                  ? <div className="pd-note" style={{ margin: 'auto' }}>No entities to compare yet.</div>
                  : cats.map((g) => {
                    const max = Math.max(...metrics.map((m) => m[g.k] ?? 0));
                    return (
                      <div className="bc-group" key={g.cat}>
                        <div className="bc-pair">
                          {metrics.map((m) => (
                            <div
                              key={m.key}
                              className={`bc-bar${m[g.k] === max && N > 1 ? ' win' : ''}`}
                              title={`${m.name} · ${g.cat}: ${Math.round(m[g.k] ?? 0)}%`}
                              style={{ flex: 1, maxWidth: 46, minWidth: 20 }}
                            >
                              <span className="bc-val">{Math.round(m[g.k] ?? 0)}%</span>
                              <i
                                className="bc-fill"
                                style={{ background: m.color, height: reveal ? `${Math.min(100, m[g.k] ?? 0)}%` : 0 }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="bc-cat">{g.cat}</div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
          <div className="cmp-note" style={{ textAlign: 'left' }}>{note}</div>
        </div>
      </div>
    </div>
  );
}
