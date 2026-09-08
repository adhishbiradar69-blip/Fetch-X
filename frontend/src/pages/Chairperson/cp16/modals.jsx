/* Fetch-X — v16 Chairperson detail modals (Task 3-a).
   Ported 1:1 from chairperson.html's openSchoolModal / openGradeModal /
   cmpModal / apModal renders with REAL bundle data:
     • CpSchoolModal  — school report (.report, --lvlD = school color)
     • CpGradeModal   — grade report (ranks within school + across schools)
     • CpCompareModal — the designer compare, CP entities: schools + grades
     • CpAperfModal   — subject radar per term for GROUP / SCHOOL
   Charts + util are imported from the Principal dashboard's shared modules
   (never edited). Student reports / teacher reports reuse the Principal
   ReportCardModal / TeacherReportModal (mounted by the page). */
import { useMemo, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { BarChart, Donut, LineChart, Radar, useReveal } from '../../Principal/dashboard/charts';
import { initials, mean, pct } from '../../Principal/dashboard/util';
import { printCardEl, printStamp } from '../../Principal/dashboard/printCard';
import { csvStamp, downloadCsv } from '../../../lib/csv';
import { CpdSkel, DistroCard, SubjectGridBlock } from './bits';
import { PERSON_SVG } from './data';
import { compositeOverall, distroTotal, num, rgbaSoft } from './data';

/* rep-head close button (designer btn-close ✕) */
function CloseBtn({ onClose }) {
  return <button type="button" className="btn-close" title="Close" onClick={onClose}>✕</button>;
}

/* attendance range tabs (designer ctabs + ATT_TABS) */
function AttTabs({ range, onRange }) {
  const TABS = { '30D': '30 DAYS', '3M': '3 MONTHS', '6M': '6 MONTHS', '1Y': '1 YEAR' };
  return (
    <div className="ctabs">
      {Object.entries(TABS).map(([k, lab]) => (
        <button key={k} type="button" className={`gtab${k === range ? ' active' : ''}`} onClick={() => onRange(k)}>{lab}</button>
      ))}
    </div>
  );
}

/* school-strip: terms donut card + stat cells (designer card-op/card-stats) */
function SchoolStrip({ opLabel, overall, terms, statCells, formula }) {
  return (
    <div className="school-strip">
      <div className="card card-op fade">
        <div className="label">{opLabel}</div>
        <div className="op-stats">
          <div className="op-stat" title={formula}>
            <div className="k">ALL TERM<br />AVERAGE</div>
            <Donut value={overall} variant="d-md" />
          </div>
          {terms.map((t, i) => (
            <div className="op-stat" key={i}>
              <div className="k">TERM {i + 1}<br />AVERAGE</div>
              <div className="v">{t != null ? `${pct(t)}%` : '—'}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card card-stats fade">{statCells}</div>
    </div>
  );
}

/* stat-cell icons from the designer inline SVGs */
const IC = {
  person: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="7.5" r="3.5" /><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" /></svg>,
  trophy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4" /><path d="M7 4h10v6a5 5 0 0 1-10 0V4z" /><path d="M7 5H4a3 3 0 0 0 3 5.5M17 5h3a3 3 0 0 1-3 5.5" /></svg>,
  cal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10.5h17" /></svg>,
  task: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" /><path d="M8.5 12.2l2.6 2.6 4.9-5.4" /></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4.5h6.5A3.5 3.5 0 0 1 12 8v12a3 3 0 0 0-3-3H2z" /><path d="M22 4.5h-6.5A3.5 3.5 0 0 0 12 8v12a3 3 0 0 1 3-3h7z" /></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-5 8 5v13" /><path d="M2 21h20M9.5 21v-4h5v4" /></svg>,
  growth: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6.5-6.5 3.5 3.5L21 6M15 6h6v6" /></svg>,
};

function StatCell({ ic, k, v, of, sep, title, small }) {
  return (
    <div className={`stat-cell${sep ? ' sep' : ''}`} title={title}>
      <div className="ic">{ic}</div>
      <div>
        <div className="k">{k}</div>
        <div className="v" style={small ? { fontSize: 12 } : undefined}>
          {v}{of != null && <span className="of">/{of}</span>}
        </div>
      </div>
    </div>
  );
}

/* grade entity helper (pure over bundle) — "Grade {g} · group" averages */
function gradeEntityOf(bundle, g) {
  const list = (bundle.schools || [])
    .map((S) => (S.grades || []).find((x) => x.grade === g))
    .filter(Boolean);
  return {
    key: `grade|${g}`,
    type: 'grade',
    id: g,
    name: `Grade ${g} · group`,
    att: Math.round(mean(list.map((x) => x.att))),
    task: Math.round(mean(list.map((x) => x.task))),
    marks: Math.round(mean(list.map((x) => x.avg))),
  };
}

/* ================================================== SCHOOL REPORT ===== */
export function CpSchoolModal({ school, nSchools, onClose, onOpenGrade }) {
  const [attRange, setAttRange] = useState('3M');
  const S = school;
  const overall = compositeOverall(S.marks, S.tasks, S.attendance);
  const soft = rgbaSoft(S.color, 0.13);
  const nGrades = (S.grades || []).length;

  const gradeItems = useMemo(
    () => (S.grades || [])
      .map((g) => ({
        label: `G${g.grade}`,
        tip: `Grade ${g.grade} · avg ${pct(g.avg)}% · rank #${g.grank_in_school}/${nGrades} in school · #${g.xrank_across}/${nSchools} across group`,
        val: pct(g.avg),
        g: g.grade,
      }))
      .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
    [S.grades, nGrades, nSchools],
  );

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="report" style={{ '--lvlD': S.color, '--lvlSoft': soft, '--donut': S.color, '--bar': S.color }}>
        <div className="rep-head">
          <div className="rep-id">
            <span className="avatar big" style={{ background: soft, color: S.color }}>{initials(S.name)}</span>
            <div>
              <div className="eyebrow">FETCH-X · SCHOOL REPORT · {String(S.name).toUpperCase()}</div>
              <h2>{S.name}</h2>
            </div>
          </div>
          <div className="rep-ranks">
            <span className="grade-pill" style={{ background: soft, color: S.color }}>{overall}% OVERALL</span>
            <div className="bigrank">
              <span className="pill" style={{ background: S.color }}>#{S.org_rank} / {nSchools}</span>
              <span className="sub">GROUP RANK</span>
            </div>
            <CloseBtn onClose={onClose} />
          </div>
        </div>

        <SchoolStrip
          opLabel="OVERALL PERFORMANCE (ALL TERMS)"
          overall={overall}
          terms={[S.t1, S.t2, S.t3]}
          formula={`(${pct(S.marks)}% marks + ${pct(S.tasks)}% tasks + ${pct(S.attendance)}% attendance) ÷ 3 = ${overall}%`}
          statCells={(
            <>
              <StatCell ic={PERSON_SVG} k="PRINCIPAL" v={S.principal || '—'} small />
              <StatCell ic={IC.person} k="TOTAL STUDENTS" v={num(S.students)} />
              <StatCell ic={IC.trophy} sep k="GROUP RANKING" v={`#${S.org_rank}`} of={nSchools} />
              <StatCell ic={IC.cal} k="ATTENDANCE (AVG)" v={`${pct(S.attendance)}%`} />
              <StatCell ic={IC.task} k="TASK COMPLETION (AVG)" v={`${pct(S.tasks)}%`} />
              <StatCell ic={IC.book} sep k="AVERAGE MARKS" v={`${pct(S.marks)}%`} />
            </>
          )}
        />

        <DistroCard
          label={`SCORE DISTRIBUTION · ${num(S.students)} STUDENTS · ALL-TERM AVERAGE`}
          bands={S.distribution}
          total={distroTotal(S.distribution)}
        />

        <div className="card chart-card fade">
          <div className="chead">
            <span className="label">ATTENDANCE TREND · {String(S.name).toUpperCase()}</span>
            <AttTabs range={attRange} onRange={setAttRange} />
          </div>
          <div className="cbody">
            <LineChart points={(S.attendance_series || {})[attRange] || []} rangeKey={attRange} />
          </div>
        </div>

        <div className="card chart-card fade">
          <div className="chead"><span className="label">GRADE COMPARISON · CLICK A BAR FOR THE GRADE REPORT</span></div>
          <div className="cbody">
            <BarChart items={gradeItems} onClick={(i) => onOpenGrade(S.id, gradeItems[i].g)} />
          </div>
        </div>

        <div className="rep-sub"><h3>Subject Level</h3><span>ALL TERMS · RANKED WITHIN {String(S.name).toUpperCase()}</span><i /></div>
        <SubjectGridBlock subjects={S.subjects} nSubjects={(S.subjects || []).length} />
      </div>
    </div>
  );
}

/* =================================================== GRADE REPORT ===== */
export function CpGradeModal({ school, grade, nSchools, onClose, distroBands, onOpenReport, onBookmark, savedIds }) {
  const [attRange, setAttRange] = useState('3M');
  const reveal = useReveal();
  const S = school;
  const gr = grade;
  const overall = compositeOverall(gr.marks, gr.task, gr.att);
  const soft = rgbaSoft(S.color, 0.13);
  const nGrades = (S.grades || []).length;
  const nSections = (gr.sections || []).length;

  const secItems = useMemo(
    () => (gr.sections || [])
      .map((c) => ({ label: c.section, tip: `Section ${c.section} · avg ${pct(c.avg)}% · Grade ${gr.grade}`, val: pct(c.avg) }))
      .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
    [gr],
  );

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="report" style={{ '--lvlD': S.color, '--lvlSoft': soft, '--donut': S.color, '--bar': S.color }}>
        <div className="rep-head">
          <div className="rep-id">
            <span className="avatar big" style={{ background: soft, color: S.color }}>G{gr.grade}</span>
            <div>
              <div className="eyebrow">FETCH-X · GRADE REPORT · {String(S.name).toUpperCase()}</div>
              <h2>Grade {gr.grade} — {S.name}</h2>
            </div>
          </div>
          <div className="rep-ranks">
            <span className="grade-pill" style={{ background: soft, color: S.color }}>{pct(gr.avg)}% AVG MARKS</span>
            <div className="bigrank">
              <span className="pill" style={{ background: S.color }}>#{gr.xrank_across} / {nSchools}</span>
              <span className="sub">ACROSS SCHOOLS</span>
            </div>
            <div className="bigrank">
              <span className="pill" style={{ background: soft, color: S.color }}>#{gr.grank_in_school} / {nGrades}</span>
              <span className="sub">IN SCHOOL</span>
            </div>
            <CloseBtn onClose={onClose} />
          </div>
        </div>

        <SchoolStrip
          opLabel="GRADE PERFORMANCE (ALL TERMS)"
          overall={overall}
          terms={gr.t}
          formula={`(${pct(gr.marks)}% marks + ${pct(gr.task)}% tasks + ${pct(gr.att)}% attendance) ÷ 3 = ${overall}%`}
          statCells={(
            <>
              {/* the v16 bundle carries no grade-level student count — honest dash */}
              <StatCell ic={IC.person} k="TOTAL STUDENTS" v="—" title="Not reported by the group API" />
              <StatCell ic={IC.building} k="SECTIONS" v={nSections} />
              <StatCell ic={IC.cal} sep k="ATTENDANCE (AVG)" v={`${pct(gr.att)}%`} />
              <StatCell ic={IC.task} k="TASK COMPLETION (AVG)" v={`${pct(gr.task)}%`} />
              <StatCell ic={IC.book} sep k="AVERAGE MARKS" v={`${pct(gr.marks)}%`} />
              <StatCell ic={IC.growth} k="OVERALL (A+T+AT)" v={`${overall}%`} />
            </>
          )}
        />

        {/* the API carries no grade-level band breakdown — the school's own
            distribution is reused and the label says so honestly */}
        <DistroCard
          label={`SCORE DISTRIBUTION · GRADE ${gr.grade} · ${String(S.name).toUpperCase()} · SCHOOL-LEVEL DATA`}
          bands={distroBands}
          total={distroTotal(distroBands)}
        />

        <div className="card chart-card fade">
          <div className="chead">
            <span className="label">ATTENDANCE TREND · GRADE {gr.grade} · SCHOOL SERIES</span>
            <AttTabs range={attRange} onRange={setAttRange} />
          </div>
          <div className="cbody">
            <LineChart points={(S.attendance_series || {})[attRange] || []} rangeKey={attRange} />
          </div>
        </div>

        <div className="card chart-card fade">
          <div className="chead"><span className="label">SECTION COMPARISON · {nSections} SECTIONS · ALL-TERM AVG</span></div>
          <div className="cbody">
            <BarChart items={secItems} />
          </div>
        </div>

        <div className="rep-sub"><h3>Subject Level</h3><span>SCHOOL SUBJECTS · ALL TERMS · RANKED WITHIN {String(S.name).toUpperCase()}</span><i /></div>
        <SubjectGridBlock subjects={S.subjects} nSubjects={(S.subjects || []).length} />

        <div className="rep-sub"><h3>Top Students</h3><span>TOP {(gr.students_top10 || []).length} · RANKED WITHIN GRADE · CLICK FOR REPORT CARD</span><i /></div>
        <div className="st-list-wrap fade">
          <div className="st-scroll" style={{ maxHeight: 330 }}>
            <div className="st-head"><span>RANK</span><span>STUDENT NAME</span><span>SECTION</span><span className="r">ALL-TERM AVG</span><span>SAVE</span></div>
            <div>
              {(gr.students_top10 || []).map((s, i) => (
                <GradeStudentRow
                  key={s.id}
                  s={s}
                  rank={i + 1}
                  reveal={reveal}
                  saved={savedIds?.has(s.id)}
                  onOpen={onOpenReport}
                  onBookmark={onBookmark}
                />
              ))}
              {!(gr.students_top10 || []).length && <div className="noresult">No students in this grade yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* top-10 row inside the grade report (designer srow + bm) */
export function GradeStudentRow({ s, rank, reveal, onOpen, onBookmark, saved }) {
  return (
    <div
      className="srow"
      role="button"
      tabIndex={0}
      title="Open report card"
      onClick={() => onOpen?.({ id: s.id, name: s.name })}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.({ id: s.id, name: s.name }); }}
    >
      <span className={`rankbadge${rank <= 3 ? ' top' : ''}`}>#{rank}</span>
      <span className="st-name">
        <span className="avatar">{initials(s.name)}</span>
        <span className="nm">{s.name}</span>
      </span>
      <span className="classchip">{s.class}</span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(s.avg)} style={{ width: reveal ? `${Math.min(100, pct(s.avg))}%` : 0 }} /></span>
        <span className="pc">{pct(s.avg)}%</span>
      </span>
      <button
        type="button"
        className={`bm${saved ? ' on' : ''}`}
        title="Save to folder"
        aria-label={`Save ${s.name} to folder`}
        onClick={(e) => { e.stopPropagation(); onBookmark?.(e, { id: s.id, name: s.name }); }}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none"><path d="M6 3h12v18l-6-4.5L6 21z" /></svg>
      </button>
    </div>
  );
}

/* ================================================== GROUP COMPARE ===== */
const CMP_MAX = 7;
const CMP_COLORS = ['#4f42dd', '#0c7a6b', '#b45f04', '#c2255c', '#0e7490', '#9333ea', '#d97706'];

export function CpCompareModal({ bundle, onClose }) {
  const reveal = useReveal();
  const cmpRef = useRef(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [type, setType] = useState('school');
  const [needle, setNeedle] = useState('');
  const [selV, setSelV] = useState('');
  /* pre-seeded with all three branches (designer openCompareFor('school')) */
  const [ents, setEnts] = useState(() => (bundle.schools || []).slice(0, 3).map((S, i) => ({
    key: `school|${S.id}`,
    type: 'school',
    id: S.id,
    name: S.name,
    att: pct(S.attendance),
    task: pct(S.tasks),
    marks: pct(S.marks),
    color: CMP_COLORS[i % CMP_COLORS.length],
  })));

  const options = useMemo(() => {
    if (type === 'school') {
      return (bundle.schools || []).map((S) => ({
        v: `school|${S.id}`,
        label: `${S.name} — ${compositeOverall(S.marks, S.tasks, S.attendance)}%`,
      }));
    }
    const grades = [...new Set((bundle.schools || []).flatMap((S) => (S.grades || []).map((g) => g.grade)))]
      .sort((a, b) => a - b);
    return grades.map((g) => {
      const e = gradeEntityOf(bundle, g);
      return { v: `grade|${g}`, label: `Grade ${g} — group average · ${e.marks}%` };
    });
  }, [type, bundle]);

  const visibleOptions = options.filter(
    (o) => !needle.trim() || o.label.toLowerCase().includes(needle.trim().toLowerCase()),
  );
  const selValue = selV && visibleOptions.some((o) => o.v === selV)
    ? selV
    : visibleOptions[0]?.v || '';

  const addEntity = () => {
    if (!selValue || ents.length >= CMP_MAX || ents.some((e) => e.key === selValue)) return;
    if (selValue.startsWith('school|')) {
      const S = (bundle.schools || []).find((x) => `school|${x.id}` === selValue);
      if (!S) return;
      setEnts((p) => [...p, {
        key: selValue, type: 'school', id: S.id, name: S.name,
        att: pct(S.attendance), task: pct(S.tasks), marks: pct(S.marks),
        color: CMP_COLORS[p.length % CMP_COLORS.length],
      }]);
    } else {
      const e = gradeEntityOf(bundle, Number(selValue.slice(6)));
      if (!e) return;
      setEnts((p) => [...p, { ...e, color: CMP_COLORS[p.length % CMP_COLORS.length] }]);
    }
  };

  const removeAt = (i) => setEnts((p) => p.filter((_, j) => j !== i)
    .map((e, j) => ({ ...e, color: CMP_COLORS[j % CMP_COLORS.length] })));

  /* composite OVERALL per entity (designer: ov = (att+task+marks)/3) */
  const rows = ents.map((e) => ({ ...e, ov: Math.round((e.att + e.task + e.marks) / 3) }));
  const cats = [
    { cat: 'MARKS', k: 'marks' },
    { cat: 'ATTENDANCE', k: 'att' },
    { cat: 'TASK COMPLETION', k: 'task' },
    { cat: 'OVERALL', k: 'ov' },
  ];
  const best = rows.length > 1 ? [...rows].sort((a, b) => b.ov - a.ov)[0] : null;

  /* CSV export — the comparison sheet, same numbers as the bars */
  const exportCsv = () => {
    if (!rows.length) return;
    downloadCsv(
      `fetchx-group-compare-${csvStamp()}.csv`,
      ['ENTITY', 'TYPE', 'MARKS %', 'ATTENDANCE %', 'TASK COMPLETION %', 'OVERALL %'],
      rows.map((e) => [
        e.name || '', String(e.type || '').toUpperCase(),
        e.marks ?? 0, e.att ?? 0, e.task ?? 0, e.ov ?? 0,
      ]),
    );
  };

  /* browser-print path — print.css scopes the sheet to this .cmp card */
  const printCompare = async () => {
    if (printBusy || !cmpRef.current || !rows.length) return;
    setPrintBusy(true);
    await printCardEl(cmpRef.current, `GROUP COMPARISON · ${rows.length} ENTITIES · GENERATED ${printStamp()}`);
    setPrintBusy(false);
  };

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cmp" ref={cmpRef}>
        <div className="rep-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">FETCH-X</div>
            <h2>Compare</h2>
            <div className="subtitle">Add up to {CMP_MAX} entities — each becomes a bar in every metric group.</div>
          </div>
          <div className="rep-tools">
            <button
              type="button" className="exe" onClick={exportCsv}
              disabled={!rows.length}
              title="Download the comparison as a CSV file"
            >
              <Download strokeWidth={2.4} aria-hidden="true" /><span>EXPORT CSV</span>
            </button>
            <button
              type="button" className="exe" onClick={printCompare}
              disabled={!rows.length || printBusy}
              title="Print the comparison sheet"
            >
              <Printer strokeWidth={2.4} aria-hidden="true" /><span>PRINT</span>
            </button>
            <CloseBtn onClose={onClose} />
          </div>
        </div>

        <div className="card cmp-picker">
          <div className="cmp-row">
            <div className="seg">
              <button type="button" className={`gtab${type === 'school' ? ' active' : ''}`} onClick={() => setType('school')}>SCHOOLS</button>
              <button type="button" className={`gtab${type === 'grade' ? ' active' : ''}`} onClick={() => setType('grade')}>GRADES</button>
            </div>
            <select value={selValue} aria-label="Entity to add" onChange={(e) => setSelV(e.target.value)}>
              {visibleOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="msearch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                value={needle}
                placeholder="Search the list — e.g. “Greenwood”"
                autoComplete="off"
                onChange={(e) => setNeedle(e.target.value)}
              />
            </div>
            <button type="button" className="ct-btn solid" disabled={rows.length >= CMP_MAX} onClick={addEntity}>+ ADD ENTITY</button>
          </div>
          <div className="cmp-chips">
            {rows.length ? rows.map((e, i) => (
              <button key={e.key} type="button" className="cmp-chip" style={{ background: e.color, color: '#fff' }} title={`Remove ${e.name}`} onClick={() => removeAt(i)}>
                <b>{e.name}</b><span className="x">✕</span>
              </button>
            )) : (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--muted)', padding: '4px 2px' }}>
                No entities yet — add at least one to compare.
              </span>
            )}
          </div>
        </div>

        <div className="card bigchart">
          <div className="bc-top">
            <div className="bc-legend">
              {rows.map((e) => <span key={e.key}><span className="dot" style={{ background: e.color }} />{e.name}</span>)}
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
                {cats.map((g) => {
                  const max = Math.max(...rows.map((e) => e[g.k]));
                  return (
                    <div className="bc-group" key={g.k}>
                      <div className="bc-pair">
                        {rows.map((e) => (
                          <div
                            key={e.key}
                            className={`bc-bar${e[g.k] === max && rows.length > 1 ? ' win' : ''}`}
                            title={`${e.name} · ${g.cat}: ${e[g.k]}%`}
                          >
                            <span className="bc-val">{e[g.k]}%</span>
                            <i
                              className="bc-fill"
                              data-h={e[g.k]}
                              style={{ background: e.color, height: reveal ? `${Math.min(100, e[g.k])}%` : 0 }}
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
          <div className="cmp-note">
            {rows.length === 0 && 'ADD ENTITIES ABOVE TO COMPARE'}
            {rows.length === 1 && (
              <span><b style={{ color: rows[0].color }}>{rows[0].name}</b> · overall <b>{rows[0].ov}%</b></span>
            )}
            {best && (
              <span>HIGHEST OVERALL · <b style={{ color: best.color }}>{best.name}</b> ({best.ov}%)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================== ACADEMIC PERFORMANCE ===== */
export function CpAperfModal({ bundle, onClose }) {
  const [type, setType] = useState('group');
  const schools = bundle.schools || [];
  const [schoolId, setSchoolId] = useState(String(schools[0]?.id ?? ''));

  /* subject labels = first-seen union across schools (seed: same set) */
  const labels = useMemo(() => {
    const out = [];
    schools.forEach((S) => (S.subjects || []).forEach((s) => {
      if (!out.includes(s.name)) out.push(s.name);
    }));
    return out;
  }, [schools]);

  const data = useMemo(() => {
    if (type === 'school') {
      const S = schools.find((x) => String(x.id) === schoolId) || schools[0];
      if (!S) return { name: '—', sub: '—', rows: [] };
      return {
        name: S.name,
        sub: `${S.principal || 'Principal'} · ${(S.grades || []).reduce((n, g) => n + (g.sections?.length || 0), 0)} classes · ${num(S.students)} students`,
        rows: (S.subjects || []).map((s) => ({ name: s.name, t: s.t, avg: s.avg })),
      };
    }
    /* group: mean across schools per subject per term */
    const rows = labels.map((name) => {
      const per = schools.map((S) => (S.subjects || []).find((s) => s.name === name)).filter(Boolean);
      return {
        name,
        t: [0, 1, 2].map((k) => Math.round(mean(per.map((s) => s.t?.[k] ?? 0)))),
        avg: Math.round(mean(per.map((s) => s.avg ?? 0))),
      };
    });
    return {
      name: 'Entire Group',
      sub: `${schools.length} schools · ${num(bundle.group?.students)} students · averaged subject results`,
      rows,
    };
  }, [type, schoolId, schools, labels, bundle.group?.students]);

  const allVals = data.rows.flatMap((d) => d.t);

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ap">
        <div className="rep-head" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">FETCH-X</div>
            <h2>Academic Performance</h2>
            <div className="subtitle">Subject-wise radar per term — pick any one entity.</div>
          </div>
          <CloseBtn onClose={onClose} />
        </div>

        <div className="ap-pick">
          <div className="seg">
            <button type="button" className={`gtab${type === 'group' ? ' active' : ''}`} onClick={() => setType('group')}>GROUP</button>
            <button type="button" className={`gtab${type === 'school' ? ' active' : ''}`} onClick={() => setType('school')}>SCHOOL</button>
          </div>
          <select
            value={schoolId}
            aria-label="School"
            disabled={type === 'group'}
            onChange={(e) => setSchoolId(e.target.value)}
          >
            {schools.map((S) => (
              <option key={S.id} value={String(S.id)}>{S.name} — {compositeOverall(S.marks, S.tasks, S.attendance)}%</option>
            ))}
          </select>
        </div>

        <div className="card ap-ent">
          <span className="ap-badge">◈</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{data.name}</div>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--muted)', marginTop: 2 }}>{data.sub}</div>
          </div>
        </div>

        {!data.rows.length ? (
          <CpdSkel h={180} style={{ marginTop: 16 }} />
        ) : (
          <div className="ap-grid">
            {[0, 1, 2].map((k) => {
              const vals = data.rows.map((d) => d.t[k]);
              return (
                <div className="card ap-radar" key={k}>
                  <span className="rt">TERM {k + 1}</span>
                  <span className="rv">TERM AVG · {Math.round(mean(vals))}%</span>
                  <Radar labels={data.rows.map((d) => d.name)} values={vals} size={260} />
                </div>
              );
            })}
          </div>
        )}

        <div className="ap-note">
          <b style={{ color: '#4f42dd' }}>{data.name}</b> · all-year subject average{' '}
          <b style={{ color: '#4f42dd' }}>{Math.round(mean(allVals))}%</b> · hover the dots for exact scores
        </div>
      </div>
    </div>
  );
}
