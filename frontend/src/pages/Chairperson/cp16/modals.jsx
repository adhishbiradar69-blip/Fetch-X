/* Fetch-X — v16/v17 Chairperson detail modals (Task 3-a + v17 delta).
   Ported 1:1 from chairperson.html's openSchoolModal / openGradeModal /
   cmpModal / apModal renders with REAL bundle data:
     • CpSchoolModal  — school report (.report, --lvlD = school color)
     • CpGradeModal   — grade report (ranks within school + across schools);
                        v17: section bars + chips open the class drill-down
                        and carry class bookmark buttons
     • CpCompareModal — the designer compare, CP entities: school / grade /
                        class / student / folder (class+student+folder
                        metrics resolve via POST /chairperson/compare)
     • CpAperfModal   — subject radar per term for GROUP / SCHOOL / GRADE /
                        CLASS / STUDENT / FOLDER (grade from the bundle's
                        subject_terms, class from the CP inspect endpoint,
                        student+folder from /principal/student-report which
                        admits the chairperson role)
   Charts + util are imported from the Principal dashboard's shared modules
   (never edited). Student reports / teacher reports reuse the Principal
   ReportCardModal / TeacherReportModal (mounted by the page). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { BarChart, Donut, LineChart, Radar, useReveal } from '../../Principal/dashboard/charts';
import { initials, mean, pct } from '../../Principal/dashboard/util';
import { fetchStudentReport } from '../../Principal/dashboard/data';
import { printCardEl, printStamp } from '../../Principal/dashboard/printCard';
import { csvStamp, downloadCsv } from '../../../lib/csv';
import { CpdSkel, DistroCard, SubjectGridBlock, ClassBmStrip } from './bits';
import { cpCompareEntities, fetchCpClassInspect, fetchCpStudents, PERSON_SVG } from './data';
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
export function CpGradeModal({ school, grade, nSchools, onClose, distroBands, onOpenReport, onBookmark, savedIds, onOpenClass, clsSavedIds, onClassBookmark }) {
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
      .map((c) => ({
        label: c.section,
        tip: `Section ${c.section} · avg ${pct(c.avg)}% · Grade ${gr.grade}${c.id != null ? ' — click to open the class report' : ''}`,
        val: pct(c.avg),
        id: c.id,
      }))
      .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
    [gr],
  );
  /* v17 — class rows for the bookmark strip / drill-down (stale bundles
     without section ids degrade honestly: no strip, bars not clickable) */
  const secClasses = useMemo(
    () => secItems
      .filter((c) => c.id != null)
      .map((c) => ({
        id: c.id,
        name: `${gr.grade}-${c.label}`,
        grade: gr.grade,
        section: c.label,
        avg: c.val,
      })),
    [secItems, gr.grade],
  );
  const secClickable = secClasses.length > 0;

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
          <div className="chead"><span className="label">SECTION COMPARISON · {nSections} SECTIONS · ALL-TERM AVG{secClickable ? ' · CLICK A BAR FOR THE CLASS REPORT' : ''}</span></div>
          <div className="cbody">
            <BarChart
              items={secItems}
              onClick={secClickable ? (i) => { const c = secItems[i]; if (c?.id != null) onOpenClass?.(c.id); } : undefined}
            />
            {secClickable && (
              <ClassBmStrip
                classes={secClasses}
                savedIds={clsSavedIds}
                onBookmark={onClassBookmark}
                onOpen={onOpenClass}
              />
            )}
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

export function CpCompareModal({ bundle, onClose, classesAll = [], folders = [] }) {
  const reveal = useReveal();
  const cmpRef = useRef(null);
  const [printBusy, setPrintBusy] = useState(false);
  /* designer seg: SCHOOL / GRADE / CLASS / STUDENT / FOLDER (v17 adds the
     last three — class+student+folder metrics resolve via the CP compare
     endpoint; schools+grades stay client-side over the loaded bundle) */
  const [type, setType] = useState('school');
  const [needle, setNeedle] = useState('');
  const [selV, setSelV] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  /* student options come from the CP org-rank endpoint (server search) */
  const [stuOpts, setStuOpts] = useState([]);
  const [stuLoading, setStuLoading] = useState(false);
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
    if (type === 'class') {
      return classesAll.map((c) => ({
        v: `class|${c.id}`,
        label: `${c.schoolName} · ${c.name} — ${pct(c.avg)}%`,
      }));
    }
    if (type === 'folder') {
      return folders.length
        ? folders.map((f) => ({ v: `folder|${f.id}`, label: `${f.name} — ${f.studentIds.length} saved` }))
        : [{ v: '', label: 'No folders yet' }];
    }
    if (type === 'student') {
      return stuOpts.map((s) => ({
        v: `student|${s.id}`,
        label: `#${s.org_rank} · ${s.name} (${s.school} ${s.class})`,
      }));
    }
    const grades = [...new Set((bundle.schools || []).flatMap((S) => (S.grades || []).map((g) => g.grade)))]
      .sort((a, b) => a - b);
    return grades.map((g) => {
      const e = gradeEntityOf(bundle, g);
      return { v: `grade|${g}`, label: `Grade ${g} — group average · ${e.marks}%` };
    });
  }, [type, bundle, classesAll, folders, stuOpts]);

  /* students are server-searched (the org list is paginated, so a client
     filter over the bundle would lie); debounce matches GlobalSearch */
  useEffect(() => {
    if (type !== 'student') return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setStuLoading(true);
      fetchCpStudents({ search: needle.trim(), page: 1, pageSize: 30 })
        .then((d) => { if (alive) { setStuOpts(d.students); setStuLoading(false); } })
        .catch(() => { if (alive) { setStuOpts([]); setStuLoading(false); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [type, needle]);

  const visibleOptions = options.filter(
    (o) => !needle.trim() || o.label.toLowerCase().includes(needle.trim().toLowerCase()),
  );
  const selValue = selV && visibleOptions.some((o) => o.v === selV)
    ? selV
    : visibleOptions[0]?.v || '';

  /* backend-resolved entity → the modal's {att, task, marks} shape */
  const pushRemote = (entity, key, fallbackName) => {
    if (!entity) return false;
    setEnts((p) => [...p, {
      key,
      type: entity.type || type,
      id: entity.id ?? '',
      name: entity.name || fallbackName,
      att: Math.round(Number(entity.attendance) || 0),
      task: Math.round(Number(entity.tasks) || 0),
      marks: Math.round(Number(entity.marks) || 0),
      color: CMP_COLORS[p.length % CMP_COLORS.length],
    }]);
    return true;
  };

  const addEntity = async () => {
    if (!selValue || ents.length >= CMP_MAX || ents.some((e) => e.key === selValue)) return;
    setAddError('');
    if (selValue.startsWith('school|')) {
      const S = (bundle.schools || []).find((x) => `school|${x.id}` === selValue);
      if (!S) return;
      setEnts((p) => [...p, {
        key: selValue, type: 'school', id: S.id, name: S.name,
        att: pct(S.attendance), task: pct(S.tasks), marks: pct(S.marks),
        color: CMP_COLORS[p.length % CMP_COLORS.length],
      }]);
    } else if (selValue.startsWith('grade|')) {
      const e = gradeEntityOf(bundle, Number(selValue.slice(6)));
      if (!e) return;
      setEnts((p) => [...p, { ...e, color: CMP_COLORS[p.length % CMP_COLORS.length] }]);
    } else {
      setAddBusy(true);
      try {
        let payload = null;
        if (selValue.startsWith('class|')) {
          const c = classesAll.find((x) => `class|${x.id}` === selValue);
          if (c) {
            payload = [{ type: 'class', id: String(c.id), name: `${c.schoolName} · ${c.name}` }];
          }
        } else if (selValue.startsWith('student|')) {
          const s = stuOpts.find((x) => `student|${x.id}` === selValue);
          if (s) payload = [{ type: 'student', id: String(s.id), name: s.name }];
        } else if (selValue.startsWith('folder|')) {
          const f = folders.find((x) => `folder|${x.id}` === selValue);
          if (f) {
            payload = [{ type: 'folder', id: f.id, name: f.name, student_ids: f.studentIds }];
          }
        }
        if (!payload) {
          setAddError('That entity is no longer available — refresh and try again.');
          return;
        }
        const res = await cpCompareEntities(payload);
        const ent = (res.entities || [])[0];
        if (!ent || !pushRemote(ent, selValue, payload[0].name)) {
          setAddError('The compare service returned no data for that entity.');
        }
      } catch {
        setAddError('The compare service could not be reached — try again.');
      } finally {
        setAddBusy(false);
      }
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
              <button type="button" className={`gtab${type === 'school' ? ' active' : ''}`} onClick={() => { setType('school'); setSelV(''); setNeedle(''); }}>SCHOOL</button>
              <button type="button" className={`gtab${type === 'grade' ? ' active' : ''}`} onClick={() => { setType('grade'); setSelV(''); setNeedle(''); }}>GRADE</button>
              <button type="button" className={`gtab${type === 'class' ? ' active' : ''}`} onClick={() => { setType('class'); setSelV(''); setNeedle(''); }}>CLASS</button>
              <button type="button" className={`gtab${type === 'student' ? ' active' : ''}`} onClick={() => { setType('student'); setSelV(''); setNeedle(''); }}>STUDENT</button>
              <button type="button" className={`gtab${type === 'folder' ? ' active' : ''}`} onClick={() => { setType('folder'); setSelV(''); setNeedle(''); }}>FOLDER</button>
            </div>
            <select value={selValue} aria-label="Entity to add" onChange={(e) => setSelV(e.target.value)}>
              {visibleOptions.length
                ? visibleOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)
                : <option value="">{type === 'student' ? (stuLoading ? 'Searching…' : 'No students match') : 'No matches'}</option>}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="msearch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                value={needle}
                placeholder={type === 'student' ? 'Search students — e.g. “Ananya”' : 'Search the list — e.g. “Mailoor”'}
                autoComplete="off"
                onChange={(e) => setNeedle(e.target.value)}
              />
            </div>
            <button
              type="button" className="ct-btn solid"
              disabled={rows.length >= CMP_MAX || addBusy || (type === 'folder' && !folders.length)}
              onClick={addEntity}
            >
              {addBusy ? 'ADDING…' : '+ ADD ENTITY'}
            </button>
          </div>
          {addError && (
            <div style={{ fontSize: 9.5, fontWeight: 700, color: '#dc2626', padding: '6px 2px 0' }}>{addError}</div>
          )}
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
/* v17 scopes — every one honestly reachable from the CP surface:
     GROUP   bundle (mean across schools)      SCHOOL  bundle subjects
     GRADE   bundle grade rows' subject_terms  (v17 additive key)
     CLASS   GET /chairperson/classes/{id}/inspect
     STUDENT GET /principal/student-report/{id} (object-level guard admits
             the chairperson role — the same endpoint ReportCardModal uses)
     FOLDER  mean over each member's student report (same endpoint)
   Each scope states where its numbers come from; failures render honest
   error notes instead of fake radars. */
const AP_SCOPES = ['group', 'school', 'grade', 'class', 'student', 'folder'];

export function CpAperfModal({ bundle, onClose, classesAll = [], folders = [] }) {
  /* stable identity (bundle.schools || [] allocates per render, which the
     hook deps lint rightly warns would churn every memo below) */
  const schools = useMemo(() => bundle.schools || [], [bundle.schools]);
  const [type, setType] = useState('group');
  const [schoolId, setSchoolId] = useState(String(schools[0]?.id ?? ''));
  const [classId, setClassId] = useState('');
  const [stuSel, setStuSel] = useState('');
  const [folderId, setFolderId] = useState('');
  const [needle, setNeedle] = useState('');
  /* server-searched student options (org list is paginated) */
  const [stuOpts, setStuOpts] = useState([]);
  /* async scopes (class/student/folder) resolve in an effect */
  const [data, setData] = useState(null); // { name, sub, rows, empty, err }
  const [busy, setBusy] = useState(false);

  /* subject labels = first-seen union across schools (seed: same set) */
  const labels = useMemo(() => {
    const out = [];
    schools.forEach((S) => (S.subjects || []).forEach((s) => {
      if (!out.includes(s.name)) out.push(s.name);
    }));
    return out;
  }, [schools]);

  const grades = useMemo(
    () => [...new Set((schools).flatMap((S) => (S.grades || []).map((g) => g.grade)))].sort((a, b) => a - b),
    [schools],
  );

  /* students are server-searched (same debounce as the compare sheet) */
  useEffect(() => {
    if (type !== 'student') return undefined;
    let alive = true;
    const t = setTimeout(() => {
      fetchCpStudents({ search: needle.trim(), page: 1, pageSize: 30 })
        .then((d) => { if (alive) setStuOpts(d.students); })
        .catch(() => { if (alive) setStuOpts([]); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [type, needle]);

  /* the class picker's options (bundle-derived, needle-filtered) */
  const classOpts = useMemo(
    () => classesAll
      .filter((c) => !needle.trim()
        || `${c.schoolName} · ${c.name}`.toLowerCase().includes(needle.trim().toLowerCase())),
    [classesAll, needle],
  );

  /* sync pickers when the type switches (first entry wins, like the
     designer); the school/grade scopes share the schoolId state but carry
     different id spaces, so each switch revalidates it.
     Render-phase state adjustment (react.dev: adjusting state when a
     prop/state changes) — the old effect reseed ran after paint and the
     lint rule rightly flags sync setState in effect bodies. */
  const [prevType, setPrevType] = useState(type);
  if (prevType !== type) {
    setPrevType(type);
    setNeedle('');
    if (type === 'school') setSchoolId((v) => (schools.some((S) => String(S.id) === v) ? v : String(schools[0]?.id ?? '')));
    if (type === 'grade') setSchoolId((v) => (grades.some((g) => String(g) === v) ? v : String(grades[0] ?? '')));
    if (type === 'class') setClassId((v) => (classesAll.some((c) => String(c.id) === v) ? v : String(classesAll[0]?.id ?? '')));
    if (type === 'folder') setFolderId((v) => (folders.some((f) => String(f.id) === v) ? v : String(folders[0]?.id ?? '')));
    if (type === 'student') setStuSel('');
  }

  /* GROUP / SCHOOL / GRADE resolve synchronously from the bundle; CLASS /
     STUDENT / FOLDER fetch. Every setState lives inside run() (nothing
     direct in the effect body), so scopes swap without cascading renders. */
  useEffect(() => {
    let alive = true;
    const run = async () => {
    if (type === 'group') {
      const rows = labels.map((name) => {
        const per = schools.map((S) => (S.subjects || []).find((s) => s.name === name)).filter(Boolean);
        return {
          name,
          t: [0, 1, 2].map((k) => Math.round(mean(per.map((s) => s.t?.[k] ?? 0)))),
          avg: Math.round(mean(per.map((s) => s.avg ?? 0))),
        };
      });
      setData({
        name: 'Entire Group',
        sub: `${schools.length} schools · ${num(bundle.group?.students)} students · averaged subject results`,
        rows,
      });
      return undefined;
    }
    if (type === 'school') {
      const S = schools.find((x) => String(x.id) === schoolId) || schools[0];
      if (!S) { setData({ name: '—', sub: '—', rows: [] }); return undefined; }
      setData({
        name: S.name,
        sub: `${S.principal || 'Principal'} · ${(S.grades || []).reduce((n, g) => n + (g.sections?.length || 0), 0)} classes · ${num(S.students)} students`,
        rows: (S.subjects || []).map((s) => ({ name: s.name, t: s.t, avg: s.avg })),
      });
      return undefined;
    }
    if (type === 'grade') {
      /* grade rows across every school for the chosen grade number
         (schoolId doubles as the grade number in this scope) */
      const g = Number(schoolId);
      const entries = schools
        .map((S) => (S.grades || []).find((x) => x.grade === g))
        .filter((x) => x && Array.isArray(x.subject_terms));
      if (!entries.length) {
        setData({
          name: `Grade ${g} · group`, sub: 'grade subject data',
          rows: [], empty: true,
          err: 'Grade subject data is not in the loaded group bundle yet — reload the page after the backend seeds it.',
        });
        return undefined;
      }
      /* union of subject names, mean per name per term across schools */
      const names = [];
      entries.forEach((e) => (e.subject_terms || []).forEach((s) => {
        if (!names.includes(s.name)) names.push(s.name);
      }));
      const rows = names.map((name) => {
        const per = entries.map((e) => (e.subject_terms || []).find((s) => s.name === name)).filter(Boolean);
        return {
          name,
          t: [0, 1, 2].map((k) => Math.round(mean(per.map((s) => s.t?.[k] ?? 0)))),
          avg: Math.round(mean(per.flatMap((s) => s.t.filter(Number.isFinite)))),
        };
      });
      setData({
        name: `Grade ${g} · group`,
        sub: `mean of ${entries.length} school grade rows · subject marks per term`,
        rows,
      });
      return undefined;
    }
    /* class / student / folder — async scopes */
    setBusy(true);
    setData(null);
    try {
      if (type === 'class') {
        if (!classId) { if (alive) setData({ name: '—', sub: '—', rows: [], empty: true }); return; }
        const d = await fetchCpClassInspect(classId);
        if (!alive) return;
        setData({
          name: `${d.school?.name ? `${d.school.name} · ` : ''}Class ${d.info?.name ?? ''}`,
          sub: `${d.info?.students ?? '—'} students · class teacher ${d.info?.ct_name || '—'} · subject marks per term`,
          rows: (d.subjects || []).map((s) => ({ name: s.name, t: [s.t1, s.t2, s.t3], avg: s.avg })),
        });
      } else if (type === 'student') {
        if (!stuSel) { if (alive) setData({ name: '—', sub: '—', rows: [], empty: true }); return; }
        const r = await fetchStudentReport(Number(stuSel));
        if (!alive) return;
        setData({
          name: r.student?.name || `Student ${stuSel}`,
          sub: `${r.student?.class_name || '—'} · group rank view via report card · subject marks per term`,
          rows: (r.subjects || []).map((s) => ({
            name: s.name,
            t: [s.marks?.t1, s.marks?.t2, s.marks?.t3],
            avg: s.marksAvg,
          })),
        });
      } else if (type === 'folder') {
        const f = folders.find((x) => String(x.id) === folderId);
        if (!f || !f.studentIds.length) {
          if (alive) setData({
            name: f ? f.name : 'No folder', sub: 'folder scope',
            rows: [], empty: true,
            err: f ? 'This folder is empty — bookmark students first.' : 'No folders yet — save students to compare them here.',
          });
          return;
        }
        const reports = (await Promise.all(
          f.studentIds.map((sid) => fetchStudentReport(sid).catch(() => null)),
        )).filter(Boolean);
        if (!alive) return;
        if (!reports.length) {
          setData({
            name: f.name, sub: 'folder scope', rows: [], empty: true,
            err: 'None of this folder’s reports could be loaded — try again.',
          });
          return;
        }
        /* union of subject names across members (folders may span
           schools), mean per name per term over the reports that have it */
        const names = [];
        reports.forEach((r) => (r.subjects || []).forEach((s) => {
          if (!names.includes(s.name)) names.push(s.name);
        }));
        const rows = names.map((name) => {
          const per = reports
            .map((r) => (r.subjects || []).find((s) => s.name === name))
            .filter(Boolean);
          return {
            name,
            t: [0, 1, 2].map((k) => Math.round(mean(per.map((s) => s.marks?.[`t${k + 1}`] ?? 0)))),
            avg: Math.round(mean(per.map((s) => s.avg ?? 0))),
          };
        });
        setData({
          name: f.name,
          sub: `average of ${reports.length}/${f.studentIds.length} saved students · subject marks per term`,
          rows,
        });
      }
    } catch {
      if (alive) setData({ name: '—', sub: '—', rows: [], empty: true, err: 'This entity’s report could not be loaded — try again.' });
    } finally {
      if (alive) setBusy(false);
    }
    };
    run();
    return () => { alive = false; };
  }, [type, schoolId, classId, stuSel, folderId, labels, schools, bundle.group?.students, folders]);

  const allVals = data ? data.rows.flatMap((d) => d.t) : [];
  const showPicker = type !== 'group';

  /* per-type option list for the picker (needle-filtered client-side;
     students come pre-searched from the server) */
  const pickerOptions = useMemo(() => {
    if (type === 'school') {
      return schools.map((S) => ({
        v: String(S.id),
        label: `${S.name} — ${compositeOverall(S.marks, S.tasks, S.attendance)}%`,
      }));
    }
    if (type === 'grade') {
      return grades.map((g) => ({ v: String(g), label: `Grade ${g} — group average` }));
    }
    if (type === 'class') {
      return classOpts.map((c) => ({ v: String(c.id), label: `${c.schoolName} · ${c.name} — ${pct(c.avg)}%` }));
    }
    if (type === 'folder') {
      return folders.length
        ? folders.map((f) => ({ v: String(f.id), label: `${f.name} — ${f.studentIds.length} saved` }))
        : [{ v: '', label: 'No folders yet' }];
    }
    if (type === 'student') {
      return stuOpts.map((s) => ({ v: String(s.id), label: `#${s.org_rank} · ${s.name} (${s.school} ${s.class})` }));
    }
    return [];
  }, [type, schools, grades, classOpts, folders, stuOpts]);

  const pickerValue = String(
    type === 'school' ? schoolId
      : type === 'grade' ? schoolId
        : type === 'class' ? classId
          : type === 'student' ? stuSel
            : folderId,
  );
  const onPicker = (v) => {
    if (type === 'school') setSchoolId(v);
    else if (type === 'grade') setSchoolId(v);
    else if (type === 'class') setClassId(v);
    else if (type === 'student') setStuSel(v);
    else setFolderId(v);
  };

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
            {AP_SCOPES.map((t) => (
              <button
                key={t} type="button"
                className={`gtab${type === t ? ' active' : ''}`}
                onClick={() => setType(t)}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {showPicker && (
            <div className="msearch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                value={needle}
                placeholder={type === 'student' ? 'Search — e.g. “Ishaan”' : 'Search — e.g. “8-Emerald”'}
                autoComplete="off"
                onChange={(e) => setNeedle(e.target.value)}
              />
            </div>
          )}
          <select
            value={pickerValue}
            aria-label="Entity"
            disabled={type === 'group' || (type === 'student' && !stuOpts.length)}
            onChange={(e) => onPicker(e.target.value)}
          >
            {type === 'group' && <option value="">Entire Group</option>}
            {type !== 'group' && (pickerOptions.length
              ? pickerOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)
              : <option value="">{type === 'student' ? 'No students match' : 'No matches'}</option>)}
          </select>
        </div>

        <div className="card ap-ent">
          <span className="ap-badge">◈</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{data?.name ?? '—'}</div>
            <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--muted)', marginTop: 2 }}>{data?.sub ?? '—'}</div>
          </div>
        </div>

        {busy && <CpdSkel h={180} style={{ marginTop: 16 }} />}
        {!busy && data?.err && (
          <div className="pd-note" style={{ marginTop: 16 }}>{data.err}</div>
        )}
        {!busy && !data?.err && !data?.rows.length && (
          <CpdSkel h={180} style={{ marginTop: 16 }} />
        )}
        {!busy && !data?.err && !!data?.rows.length && (
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
          <b style={{ color: '#4f42dd' }}>{data?.name ?? '—'}</b> · all-year subject average{' '}
          <b style={{ color: '#4f42dd' }}>{allVals.length ? `${Math.round(mean(allVals))}%` : '—'}</b> · hover the dots for exact scores
        </div>
      </div>
    </div>
  );
}
