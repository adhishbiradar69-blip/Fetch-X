/* Grade detail modal (v17) — port of designer principal.html openGradeModal
   (lines 1900-1972): rep-head identity strip (avatar G{grade} + pills),
   grade performance strip (donut + per-term averages), stat cells,
   subject-average bars, SECTION COMPARISON bars (click a bar → class
   dashboard) and the grade's top students with bookmark buttons.
   Data: GET /principal/grades/{grade}/inspect — sections carry class_id /
   label / average / attendance_rate / exam_averages and the payload has no
   per-grade mark histogram (response shape verified in backend
   app/routers/principal.py), so the designer's distro slot shows subject
   averages instead. The two fetchers live here — the shared data.js API
   layer is owned by the lead agent. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, CalendarCheck2, BookOpen, School, Users, X } from 'lucide-react';
import api from '../../../api/client';
import { BarChart, Donut, useReveal } from './charts';
import { fmt1, initials, mean, pct } from './util';

const get = (url) => api.get(url).then((r) => r.data);

/* grade = class-level tier: reuse the .lvl-3 palette from index.css the way
   the designer set --lvlD on the detail card. */
const THEME = { c: '#b45f04', soft: '#fbeeda' };

function StatCell({ icon: Icon, k, v, sep }) {
  return (
    <div className={`stat-cell${sep ? ' sep' : ''}`}>
      <div className="ic"><Icon strokeWidth={1.8} /></div>
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}</div>
      </div>
    </div>
  );
}

export default function GradeDetail({ grade, school, onClose, onOpenClass, classesAll = [], onBookmarkStudent, savedIds }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setData(null);
      setErr(false);
      if (grade == null) return;
      try {
        const d = await get(`/principal/grades/${grade}/inspect`);
        if (alive) setData(d);
      } catch {
        if (alive) setErr(true);
      }
    };
    run();
    return () => { alive = false; };
  }, [grade]);

  /* per-term grade averages — derived client-side from the sections' exam
     averages (the inspect payload carries no per-term rollup); a term with
     no recorded marks stays null and renders as "—" */
  const termAvgs = useMemo(() => {
    const cols = { t1: [], t2: [], t3: [] };
    (data?.sections || []).forEach((s) => (s.exam_averages || []).forEach((e) => {
      /* exam_averages[].term is "Term 1" (sometimes bare "1") — extract the digit */
      const m = String(e.term ?? '').match(/(\d+)/);
      const k = m ? `t${m[1]}` : null;
      if (k && cols[k] && e.average != null && (e.student_count ?? 1) > 0) cols[k].push(e.average);
    }));
    return {
      t1: cols.t1.length ? Math.round(mean(cols.t1)) : null,
      t2: cols.t2.length ? Math.round(mean(cols.t2)) : null,
      t3: cols.t3.length ? Math.round(mean(cols.t3)) : null,
    };
  }, [data]);

  const subjectItems = useMemo(() => (data?.subject_averages || [])
    .map((s) => ({
      key: s.subject_id,
      label: String(s.name || '—').toUpperCase().slice(0, 8),
      tip: `${s.name} · grade average ${fmt1(s.average)}% · pass rate ${pct(s.pass_rate)}%`,
      val: pct(s.average),
    }))
    .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
  [data]);

  const sectionItems = useMemo(() => (data?.sections || [])
    .map((s) => ({
      key: s.class_id,
      label: `${s.grade}-${s.section}`,
      tip: `${s.label || `Grade ${s.grade}-${s.section}`} · avg ${fmt1(s.average)}% · attendance ${pct(s.attendance_rate)}% · ${s.students} students`,
      val: pct(s.average),
    }))
    .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
  [data]);

  const top = useMemo(() => (data?.top_students || []).slice(0, 10), [data]);
  const bestSec = useMemo(() => {
    const list = (data?.sections || []).filter((s) => s.average != null);
    return list.length ? [...list].sort((a, b) => b.average - a.average)[0] : null;
  }, [data]);
  /* fallback when the payload omits sections_count */
  const sectionsCount = data?.sections_count
    ?? (classesAll || []).filter((c) => String(c.grade) === String(grade)).length;
  const schoolName = school?.name || data?.school?.name || '';
  const reveal = useReveal();

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="report"
        style={{ '--lvlD': THEME.c, '--lvlSoft': THEME.soft, '--donut': THEME.c, '--bar': THEME.c }}
      >
        {!data && !err && <div className="pd-skel tall" style={{ marginTop: 8 }} />}

        {err && !data && (
          <div className="pd-note" style={{ padding: 60 }}>
            This grade report could not be loaded — grade {grade} may not have sections or marks in your school yet.
            <div style={{ marginTop: 12 }}><button type="button" className="gtab" onClick={onClose}>CLOSE</button></div>
          </div>
        )}

        {data && (
          <>
            <div className="rep-head">
              <div className="rep-id">
                <span className="avatar big" style={{ background: THEME.soft, color: THEME.c }}>G{grade}</span>
                <div>
                  <div className="eyebrow">FETCH-X · GRADE REPORT{schoolName ? ` · ${String(schoolName).toUpperCase()}` : ''}</div>
                  <h2>Grade {grade}{schoolName ? ` — ${schoolName}` : ''}</h2>
                </div>
              </div>
              <div className="rep-ranks">
                <span className="grade-pill" style={{ background: THEME.soft, color: THEME.c }}>
                  {data.grade_average != null ? `${pct(data.grade_average)}% AVG MARKS` : 'NO MARKS YET'}
                </span>
                <div className="bigrank">
                  <span className="pill" style={{ background: THEME.soft, color: THEME.c }}>{bestSec ? bestSec.label : '—'}</span>
                  <span className="sub">TOP SECTION</span>
                </div>
                <button ref={closeRef} type="button" className="btn-close" onClick={onClose} aria-label="Close">
                  <X strokeWidth={2.4} />
                </button>
              </div>
            </div>

            <div className="school-strip">
              <div className="card card-op fade">
                <div className="label">GRADE PERFORMANCE (ALL TERMS)</div>
                <div className="op-stats">
                  <div
                    className="op-stat"
                    title={`Average marks of ${data.total_students ?? '—'} students across ${sectionsCount ?? '—'} sections`}
                  >
                    <div className="k">ALL TERM<br />AVERAGE</div>
                    <Donut value={data.grade_average ?? 0} variant="d-md" />
                  </div>
                  {['t1', 't2', 't3'].map((k, i) => (
                    <div className="op-stat" key={k}>
                      <div className="k">TERM {i + 1}<br />AVERAGE</div>
                      <div className="v">{termAvgs[k] != null ? `${termAvgs[k]}%` : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card card-stats fade">
                <StatCell icon={Users} k="TOTAL STUDENTS" v={data.total_students ?? '—'} />
                <StatCell icon={School} k="SECTIONS" v={sectionsCount ?? '—'} />
                <StatCell icon={CalendarCheck2} sep k="ATTENDANCE (AVG)" v={data.attendance_rate != null ? `${pct(data.attendance_rate)}%` : '—'} />
                <StatCell icon={BookOpen} k="AVERAGE MARKS" v={data.grade_average != null ? `${pct(data.grade_average)}%` : '—'} />
              </div>
            </div>

            <div className="card chart-card fade">
              <div className="chead">
                <span className="label">SUBJECT AVERAGES · GRADE {grade} · ALL TERMS COMBINED</span>
              </div>
              <div className="cbody">
                {subjectItems.length
                  ? <BarChart items={subjectItems} height={190} />
                  : <div className="pd-note">No subject marks recorded in this grade yet.</div>}
              </div>
            </div>

            <div className="card chart-card fade">
              <div className="chead">
                <span className="label">
                  SECTION COMPARISON · GRADE {grade} · {sectionItems.length} SECTIONS{onOpenClass ? ' · CLICK A BAR FOR THE CLASS DASHBOARD' : ''}
                </span>
              </div>
              <div className="cbody">
                {sectionItems.length
                  ? (
                    <BarChart
                      items={sectionItems}
                      height={190}
                      onClick={onOpenClass ? (i) => onOpenClass(sectionItems[i].key) : undefined}
                    />
                  )
                  : <div className="pd-note">No sections in this grade yet.</div>}
              </div>
            </div>

            <div className="rep-sub">
              <h3>Top Students</h3>
              <span>TOP {top.length} OF {data.total_students ?? top.length} · RANKED WITHIN GRADE · SAVE WITH THE BOOKMARK</span>
              <i />
            </div>
            <div className="st-list-wrap fade">
              <div className="st-scroll" style={{ maxHeight: 330 }}>
                <div className="st-head">
                  <span>RANK</span><span>STUDENT NAME</span><span>SECTION</span>
                  <span className="r">ALL-TERM AVG</span><span>SAVE</span>
                </div>
                {top.map((s, i) => (
                  <div className="srow" key={s.student_id ?? i}>
                    <span className={`rankbadge${i < 3 ? ' top' : ''}`}>#{i + 1}</span>
                    <span className="st-name">
                      <span className="avatar">{initials(s.name)}</span>
                      <span className="nm">{s.name}</span>
                    </span>
                    <span className="classchip">{s.class_label || '—'}</span>
                    <span className="scorepill">
                      <span className="bar"><i data-w={pct(s.average)} style={{ width: reveal ? `${Math.min(100, pct(s.average))}%` : 0 }} /></span>
                      <span className="pc">{pct(s.average)}%</span>
                    </span>
                    <button
                      type="button"
                      className={`bm${savedIds?.has(s.student_id) ? ' on' : ''}`}
                      title="Save to folder"
                      aria-label={`Save ${s.name} to folder`}
                      onClick={(e) => { e.stopPropagation(); onBookmarkStudent?.(e, { id: s.student_id, name: s.name }); }}
                    >
                      <Bookmark strokeWidth={2} />
                    </button>
                  </div>
                ))}
                {!top.length && <div className="noresult">No student marks recorded in this grade yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
