/* Academic Performance modal (.ap kit) — TERM 1/2/3 cards, each with the
   prototype's hand-rolled 6-axis subject radar, for a selectable scope
   (School / Grade / Class / Student / Folder).
   Radar data comes from GET /principal/radar; folders are aggregated
   client-side from the per-student radar of every saved student. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { fetchRadar, fetchStudents } from './data';
import { Radar } from './charts';
import { mean, pct } from './util';

const SCOPES = [
  ['group', 'GROUP'],
  ['school', 'SCHOOL'],
  ['grade', 'GRADE'],
  ['class', 'CLASS'],
  ['student', 'STUDENT'],
  ['folder', 'FOLDER'],
];

export default function AcademicModal({ onClose, classesAll = [], folders = [] }) {
  const [type, setType] = useState('school');
  const [id, setId] = useState('school');
  const [ms, setMs] = useState('');
  const [students, setStudents] = useState(null);
  const [data, setData] = useState(null); // { subjects, terms }
  const [dataKey, setDataKey] = useState(''); // which selection `data` belongs to
  const [err, setErr] = useState(false);
  const closeRef = useRef(null);

  /* key of the entity whose radar is requested — folders depend on their members.
     GROUP normalizes to school: for the principal the group is this one school. */
  const entKey = useMemo(() => JSON.stringify([
    type === 'group' ? 'school' : type,
    id,
    (type === 'folder') ? (folders.find((f) => String(f.id) === String(id))?.studentIds || []) : 0,
  ]), [type, id, folders]);
  /* busy is derived: true until data for the CURRENT selection has landed */
  const busy = dataKey !== entKey;

  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    fetchStudents({ page: 1, pageSize: 100 })
      .then((d) => { if (alive) setStudents(d.students); })
      .catch(() => { if (alive) setStudents([]); });
    return () => { alive = false; };
  }, []);

  const grades = useMemo(
    () => [...new Set(classesAll.map((c) => c.grade))].sort((a, b) => a - b),
    [classesAll],
  );

  const optionsFor = () => {
    if (type === 'school' || type === 'group') return [{ value: 'school', label: 'Entire School' }];
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

  const firstIdFor = (t) => {
    if (t === 'school' || t === 'group') return 'school';
    if (t === 'grade') return grades.length ? String(grades[grades.length - 1]) : '';
    if (t === 'class') return classesAll.length ? String(classesAll[0].id) : '';
    if (t === 'folder') return folders.length ? String(folders[0].id) : '';
    return students?.length ? String(students[0].id) : '';
  };

  /* entity header info */
  let entName = 'Entire School';
  let entSub = type === 'group'
    ? `${classesAll.length} classes · the group is this one school`
    : `${classesAll.length} classes · averaged subject results`;
  if (type === 'grade') {
    entName = `Grade ${id}`;
    entSub = 'average of all sections in this grade';
  } else if (type === 'class') {
    const c = classesAll.find((x) => String(x.id) === String(id));
    entName = c ? `Class ${c.name}` : 'Class —';
    entSub = 'class average subject results';
  } else if (type === 'folder') {
    const f = folders.find((x) => String(x.id) === String(id));
    entName = f ? f.name : 'No folder';
    entSub = f?.studentIds.length ? `average of ${f.studentIds.length} saved students · subject marks` : 'empty folder — save students first';
  } else if (type === 'student') {
    const s = (students || []).find((x) => String(x.id) === String(id));
    entName = s ? s.name : 'Student —';
    entSub = s ? `Class ${s.className} · individual subject scores` : 'individual subject scores';
  }

  useEffect(() => {
    let alive = true;
    const key = entKey;
    const apply = (d) => { // resolve helper: marks the key as served
      if (!alive) return;
      setData(d);
      setErr(false);
      setDataKey(key);
    };
    const run = async () => {
      try {
        if (type === 'folder') {
          const f = folders.find((x) => String(x.id) === String(id));
          const ids = f?.studentIds || [];
          if (!ids.length) {
            apply({ subjects: [], terms: { t1: [], t2: [], t3: [] }, empty: true });
          } else {
            const radars = (await Promise.all(ids.map((sid) => fetchRadar({ scope: 'student', studentId: sid }).catch(() => null))))
              .filter(Boolean);
            const names = radars[0]?.subjects || [];
            const terms = { t1: [], t2: [], t3: [] };
            ['t1', 't2', 't3'].forEach((t) => {
              for (let i = 0; i < names.length; i++) {
                terms[t].push(Math.round(mean(radars.map((r) => r.terms?.[t]?.[i] ?? 0))));
              }
            });
            apply({ subjects: names, terms });
          }
        } else if (type === 'school' || type === 'group') {
          apply(await fetchRadar({ scope: 'school' }));
        } else if (type === 'grade') {
          apply(await fetchRadar({ scope: 'grade', grade: id }));
        } else if (type === 'class') {
          apply(await fetchRadar({ scope: 'class', classId: id }));
        } else {
          apply(await fetchRadar({ scope: 'student', studentId: id }));
        }
      } catch {
        if (alive) { setErr(true); setDataKey(key); }
      }
    };
    run();
    return () => { alive = false; };
  }, [entKey, type, id, folders]);

  const labels = data?.subjects || [];
  const allVals = data ? [...data.terms.t1, ...data.terms.t2, ...data.terms.t3] : [];
  const allYearAvg = allVals.length ? Math.round(mean(allVals)) : 0;

  const opts = optionsFor();
  const q = ms.trim().toLowerCase();

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ap">
        <div className="rep-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">SCHOOL INTELLIGENCE</div>
            <h2>Academic Performance</h2>
            <div className="subtitle">Subject-wise radar per term — pick any one entity.</div>
          </div>
          <button ref={closeRef} type="button" className="btn-close" onClick={onClose} aria-label="Close">
            <X strokeWidth={2.4} />
          </button>
        </div>

        <div className="ap-pick">
          <div className="seg">
            {SCOPES.map(([t, label]) => (
              <button
                key={t}
                type="button"
                className={`gtab${type === t ? ' active' : ''}`}
                onClick={() => { setType(t); const nid = firstIdFor(t); setId(nid); setMs(''); }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="msearch">
            <Search strokeWidth={2} />
            <input
              placeholder="Search — e.g. “Ishaan” or “8-Emerald”"
              value={ms}
              onChange={(e) => setMs(e.target.value)}
            />
          </div>
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {opts.map((o) => (
              <option key={o.value} value={o.value} hidden={!!q && !o.label.toLowerCase().includes(q)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="card ap-ent">
          <span className="ap-badge">◈</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{entName}</div>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--muted)', marginTop: 2 }}>{entSub}</div>
          </div>
        </div>

        {busy && <div className="pd-skel tall" style={{ marginTop: 16 }} />}
        {err && !busy && <div className="pd-note">Radar data could not be loaded — the endpoint may not be seeded yet.</div>}
        {data?.empty && !busy && <div className="pd-note">This folder is empty — bookmark students to compare them here.</div>}

        {data && !data.empty && !busy && !err && (
          <div className="ap-grid">
            {['t1', 't2', 't3'].map((t, i) => {
              const vals = data.terms[t] || [];
              const avg = vals.length ? Math.round(mean(vals)) : 0;
              return (
                <div className="card ap-radar" key={t}>
                  <span className="rt">TERM {i + 1}</span>
                  <span className="rv">TERM AVG · {avg}%</span>
                  <Radar labels={labels} values={vals} size={260} />
                </div>
              );
            })}
          </div>
        )}

        <div className="ap-note">
          {data && !data.empty && !busy && !err ? (
            <><b style={{ color: '#4f42dd' }}>{entName}</b> · all-year subject average <b style={{ color: '#4f42dd' }}>{allYearAvg}%</b> · hover the dots for exact scores</>
          ) : '—'}
        </div>
      </div>
    </div>
  );
}
