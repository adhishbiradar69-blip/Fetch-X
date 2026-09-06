/* eslint-disable react-refresh/only-export-components -- RANK_TABS is a
   shared constant colocated with the tabs component, same as charts.jsx. */
/* The five .lvl sections of the dashboard (School, Subject, Class, Student,
   Teachers) — markup mirrors dashboard(2).html v15:
   • subject cards are CLICKABLE → #subject=<id> detail view
   • class comparison tabs = OVERALL + per-subject metrics (v15)
   • student + teacher levels get rank-band filter tabs (v15)
   • section heads can carry a theme swatch button (v15 level themes). */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, Bookmark, CalendarCheck2, ClipboardCheck, School, Search, Trophy, User, Users,
} from 'lucide-react';
import { Donut, Distro, BarChart, LineChart, Trend, useReveal, useInView } from './charts';
import { ATT_TABS, initials, pct } from './util';
import { ThemeBtn } from './LevelThemes';

/* ---------------------------------------------- small building blocks */
export function SectionHead({ title, sub, tag, actions, lvl }) {
  return (
    <header className="lvl-head">
      <div className="lvl-tt"><h2>{title}</h2><p>{sub}</p></div>
      <span className="lvl-rule" />
      {tag && <span className="lvl-tag">{tag}</span>}
      {lvl && <ThemeBtn lvl={lvl} />}
      {actions}
    </header>
  );
}

export function Chip({ t, n }) {
  return <div className="chip"><span className="t">{t}</span><span className="n">{n}</span></div>;
}

function StatCell({ icon: Icon, k, v, of, sep, title }) {
  return (
    <div className={`stat-cell${sep ? ' sep' : ''}`} title={title}>
      <div className="ic"><Icon strokeWidth={1.8} /></div>
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}{of && <span className="of">/{of}</span>}</div>
      </div>
    </div>
  );
}

export function TeachPill({ name, tag, title }) {
  return (
    <span className="teach-pill" title={title || name}>
      <User strokeWidth={2} />
      <b>{name || '—'}</b>
      {tag && <em>{tag}</em>}
    </span>
  );
}

function Skel({ h = 96, style }) {
  return <div className="pd-skel block" style={{ height: h, ...style }} />;
}

/* v15 rank-band filter tabs (ALL / 90+ / 80+ / …) */
export const RANK_TABS = [['all', 'ALL'], ['90', '90+'], ['80', '80+'], ['70', '70+'], ['60', '60+'], ['50', '50+'], ['40', '40+']];

export function RankTabs({ value, onChange }) {
  return (
    <div className="rank-tabs fade">
      {RANK_TABS.map(([v, l]) => (
        <button
          key={v} type="button"
          className={`gtab${String(value) === v ? ' active' : ''}`}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/* ============================================================ 01 SCHOOL */
export function SectionSchool({
  stats, statsErr, termAvg, distro, rank,
  attPoints, attRange, onAttRange, attLoading,
  cmpClasses, cmpMetric, onCmpMetric, cmpLoading, cmpSubjects, onOpenClass,
}) {
  const loading = !stats && !statsErr;
  const overallAll = termAvg?.overall?.all ?? (stats ? Math.round((stats.avg_score + stats.attendance_pct + stats.task_completion_pct) / 3) : null);
  const marks = stats ? pct(stats.avg_score) : null;
  const att = stats ? pct(stats.attendance_pct) : null;
  const tasks = stats ? pct(stats.task_completion_pct) : null;
  const formula = overallAll != null && stats
    ? `(${marks} marks + ${tasks}% tasks + ${att}% attendance) ÷ 3 = ${Math.round(overallAll)}%` : undefined;

  /* v15: metric tabs — OVERALL + one per subject (key = subject id) */
  const CMP_TABS = useMemo(() => {
    const tabs = { overall: 'OVERALL' };
    (cmpSubjects || []).forEach((s) => { tabs[String(s.id)] = String(s.name).toUpperCase().slice(0, 8); });
    return tabs;
  }, [cmpSubjects]);
  const metricLabel = CMP_TABS[String(cmpMetric)] || 'OVERALL';

  const cmpItems = useMemo(
    () => (cmpClasses || [])
      .map((c) => ({
        key: c.id,
        label: c.name,
        tip: `Class ${c.name}${c.grade ? ` · Grade ${c.grade}` : ''}${c.rank ? ` · overall rank #${c.rank}` : ''}`,
        val: Math.round(c.avg ?? 0),
      }))
      .sort((a, b) => b.val - a.val || a.label.localeCompare(b.label)),
    [cmpClasses],
  );
  const [secRef, secIn] = useInView();

  return (
    <section className={`lvl lvl-1 first rv${secIn ? ' in' : ''}`} id="schoolSec" ref={secRef}>
      <SectionHead
        lvl={1}
        title="School Level"
        sub="The entire school at a glance: all terms, all classes, all subjects combined."
        tag={rank ? `RANKED #${rank.rank} OF ${rank.of} SCHOOLS` : 'ALL CLASSES · ALL TERMS'}
      />
      <div className="school-strip">
        <div className="card card-op fade">
          <div className="label">OVERALL PERFORMANCE (ALL TERMS)</div>
          <div className="op-stats">
            <div className="op-stat" title={formula}>
              <div className="k">ALL TERM<br />AVERAGE</div>
              {overallAll != null
                ? <Donut value={overallAll} variant="d-md" />
                : <Skel h={54} style={{ width: 54, borderRadius: '50%' }} />}
            </div>
            {['t1', 't2', 't3'].map((t, i) => (
              <div className="op-stat" key={t}>
                <div className="k">TERM {i + 1}<br />OVERALL AVERAGE</div>
                <div className="v">{termAvg?.overall?.[t] != null ? `${pct(termAvg.overall[t])}%` : '—'}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-stats fade">
          {loading || statsErr ? (
            <div style={{ gridColumn: '1/-1', padding: 8 }}><Skel h={70} /></div>
          ) : (
            <>
              <StatCell icon={Users} k="TOTAL STUDENTS" v={stats.students ?? '—'} />
              <StatCell icon={School} k="TOTAL CLASSES" v={stats.classes ?? '—'} />
              <StatCell
                icon={Trophy} sep k="SCHOOL RANKING"
                v={rank ? `#${rank.rank}` : '—'} of={rank ? rank.of : undefined}
                title={rank ? undefined : 'School ranking not available'}
              />
              <StatCell icon={CalendarCheck2} k="ATTENDANCE (AVG)" v={att != null ? `${att}%` : '—'} />
              <StatCell icon={ClipboardCheck} k="TASK COMPLETION (AVG)" v={tasks != null ? `${tasks}%` : '—'} />
              <StatCell icon={BookOpen} sep k="AVERAGE MARKS" v={marks != null ? `${marks}%` : '—'} />
            </>
          )}
        </div>
      </div>

      <div className="card distro-card fade">
        <div className="label">
          {distro
            ? `SCORE DISTRIBUTION · ${Number(distro.total).toLocaleString('en-IN')} marks recorded, all terms. Bar = share of marks`
            : 'SCORE DISTRIBUTION'}
        </div>
        {distro ? <Distro bands={distro.bands} total={distro.total} /> : <div style={{ padding: '4px 16px 20px' }}><Skel h={110} /></div>}
      </div>

      <div className="card chart-card fade">
        <div className="chead">
          <span className="label">ATTENDANCE TREND · SCHOOL{attRange ? ` · LAST ${ATT_TABS[attRange]}` : ''}</span>
          <div className="ctabs">
            {Object.entries(ATT_TABS).map(([k, label]) => (
              <button key={k} type="button" className={`gtab${k === attRange ? ' active' : ''}`} onClick={() => onAttRange(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="cbody">
          {attLoading && !attPoints ? <Skel h={190} /> : <LineChart points={attPoints || []} rangeKey={attRange} />}
        </div>
      </div>

      <div className="card chart-card fade">
        <div className="chead">
          <span className="label">CLASS COMPARISON · {metricLabel} · {(cmpClasses || []).length} CLASSES · CLICK A BAR TO OPEN</span>
          <div className="ctabs">
            {Object.entries(CMP_TABS).map(([k, label]) => (
              <button key={k} type="button" className={`gtab${String(cmpMetric) === k ? ' active' : ''}`} onClick={() => onCmpMetric(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="cbody">
          {cmpLoading && !cmpClasses
            ? <Skel h={210} />
            : <BarChart items={cmpItems} onClick={(i) => onOpenClass(cmpItems[i].key)} />}
        </div>
      </div>
    </section>
  );
}

/* =========================================================== 02 SUBJECT */
export function SectionSubjects({ termAvg, onOpenSubject }) {
  const subjects = termAvg?.subjects || [];
  const [secRef, secIn] = useInView();
  return (
    <section className={`lvl lvl-2 rv${secIn ? ' in' : ''}`} id="subjectSec" ref={secRef}>
      <SectionHead
        lvl={2}
        title="Subject Level"
        sub="How each subject performs across the whole school, term by term. Click a subject to open it."
        tag={subjects.length ? `${subjects.length} SUBJECTS · RANKED #1–#${subjects.length}` : 'SUBJECTS'}
      />
      {!termAvg ? (
        <div className="subject-grid">{[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} h={104} />)}</div>
      ) : (
        <div className="subject-grid">
          {subjects.map((s) => (
            <div
              className="card s-card clickable fade" key={s.id ?? s.name}
              role="button" tabIndex={0}
              title={`Open ${s.name} dashboard`}
              onClick={() => onOpenSubject?.(s)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpenSubject?.(s); }}
            >
              <div className="s-head">
                <span className="s-name">{String(s.name).toUpperCase()}</span>
                <TeachPill name={s.hod} tag="HOD" title={`Head of Department · ${s.hod || '—'}`} />
                <span className="rank-pill">#{s.rank ?? '—'}</span>
              </div>
              <div className="s-body">
                <div className="chips">
                  <Chip t="T1" n={pct(s.t1)} />
                  <Chip t="T2" n={pct(s.t2)} />
                  <Chip t="T3" n={pct(s.t3)} />
                </div>
                <div className="avg-wrap">
                  <span className="avg-label">AVERAGE</span>
                  <Donut value={s.avg} variant="d-md" />
                  <Trend d={s.trend ?? (pct(s.t3) - pct(s.t2))} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============================================================= 03 CLASS */
function ClassCard({ c, total, onOpen }) {
  return (
    <div
      className="card s-card clickable fade"
      role="button"
      tabIndex={0}
      title={`Open ${c.name} dashboard`}
      onClick={() => onOpen(c.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(c.id); }}
    >
      <div className="s-head">
        <span className="s-name">{c.name}</span>
        <TeachPill name={c.ct_name} tag="CT" title={`Class Teacher · ${c.ct_name || '—'}`} />
        <span className={`rank-pill${c.rank <= 3 ? ' top' : ''}`}>#{c.rank}<span className="of30">/{total}</span></span>
      </div>
      <div className="s-body">
        <div className="chips">
          <Chip t="T1" n={pct(c.t1)} />
          <Chip t="T2" n={pct(c.t2)} />
          <Chip t="T3" n={pct(c.t3)} />
        </div>
        <div className="avg-wrap">
          <span className="avg-label">AVERAGE</span>
          <Donut value={c.avg} variant="d-sm" />
          <Trend d={pct(c.t3) - pct(c.t2)} />
        </div>
      </div>
    </div>
  );
}

export function SectionClasses({
  classesAll, classes, grade, onGrade, loading, onOpenClass,
}) {
  const grades = useMemo(() => {
    const set = [...new Set((classesAll || []).map((c) => c.grade))].sort((a, b) => a - b);
    return set;
  }, [classesAll]);
  const total = (classesAll || []).length;

  const blocks = useMemo(() => {
    const byGrade = new Map();
    (classes || []).forEach((c) => {
      if (!byGrade.has(c.grade)) byGrade.set(c.grade, []);
      byGrade.get(c.grade).push(c);
    });
    return [...byGrade.entries()].sort((a, b) => a[0] - b[0]);
  }, [classes]);
  const [secRef, secIn] = useInView();

  return (
    <section className={`lvl lvl-3 rv${secIn ? ' in' : ''}`} id="classSec" ref={secRef}>
      <SectionHead
        lvl={3}
        title="Class Level"
        sub="Every section from Grade 1 to 10. Click any class to open its full dashboard."
        tag={classesAll ? `${grades.length} GRADES · ${total} SECTIONS` : 'CLASSES'}
      />
      <div className="grade-tabs">
        <button type="button" className={`gtab${grade === 'all' ? ' active' : ''}`} onClick={() => onGrade('all')}>ALL</button>
        {grades.map((g) => (
          <button key={g} type="button" className={`gtab${String(g) === String(grade) ? ' active' : ''}`} onClick={() => onGrade(g)}>G{g}</button>
        ))}
      </div>
      {loading && !classes ? (
        <div className="class-grid">{[0, 1, 2].map((i) => <Skel key={i} h={104} />)}</div>
      ) : (
        <>
          {blocks.map(([g, list]) => (
            <div className="grade-block" key={g}>
              <div className="grade-label">GRADE {g}</div>
              <div className="class-grid">
                {list.map((c) => <ClassCard key={c.id} c={c} total={total} onOpen={onOpenClass} />)}
              </div>
            </div>
          ))}
          <div className="grade-more">RANKED ACROSS THE WHOLE SCHOOL</div>
        </>
      )}
    </section>
  );
}

/* ========================================================== 05 TEACHERS */
function TeacherRow({ t, onOpen }) {
  const reveal = useReveal();
  return (
    <div
      className="srow"
      role="button"
      tabIndex={0}
      title="Open teacher report"
      onClick={() => onOpen(t)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}
    >
      <span className={`rankbadge${t.rank && t.rank <= 3 ? ' top' : ''}`}>#{t.rank ?? '—'}</span>
      <span className="st-name">
        <span className="avatar">{initials(t.name)}</span>
        <span className="nm">{t.name}{t.is_hod ? ' · HOD' : ''}{t.ct_of ? ' · CT' : ''}</span>
      </span>
      <span className="classchip" title={t.is_hod ? `${t.subject} · Head of Department` : t.subject}>
        {t.subject}{t.is_hod ? ' · HOD' : ''}
      </span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(t.avg)} style={{ width: reveal ? `${Math.min(100, pct(t.avg))}%` : 0 }} /></span>
        <span className="pc">{t.avg != null ? `${pct(t.avg)}%` : '—'}</span>
        <Trend d={t.trend} />
      </span>
      <button
        type="button"
        className="tb"
        title="Open teacher report"
        aria-label={`Open report for ${t.name}`}
        onClick={(e) => { e.stopPropagation(); onOpen(t); }}
      >
        <ArrowRight strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function SectionTeachers({ teachers, loading, onOpenTeacher }) {
  const [q, setQ] = useState('');
  const [minAvg, setMinAvg] = useState(0);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = teachers || [];
    return list.filter((t) =>
      (minAvg === 0 || pct(t.avg) >= minAvg)
      && (!ql
        || String(t.name).toLowerCase().includes(ql)
        || String(t.subject).toLowerCase().includes(ql)
        || (t.ct_of || '').toLowerCase().includes(ql)));
  }, [teachers, ql, minAvg]);
  const [secRef, secIn] = useInView();

  return (
    <section className={`lvl lvl-6 rv${secIn ? ' in' : ''}`} id="teacherSec" ref={secRef}>
      <SectionHead
        lvl={6}
        title="Teachers Level"
        sub="Academic faculty ranked by average class performance."
        tag={teachers != null
          ? `${rows.length} TEACHER${rows.length === 1 ? '' : 'S'} · CLICK FOR REPORT`
          : 'FACULTY'}
      />
      <RankTabs value={String(minAvg)} onChange={(v) => setMinAvg(v === 'all' ? 0 : Number(v))} />
      <div className="searchbar fade">
        <Search strokeWidth={2} />
        <input
          type="text"
          value={q}
          placeholder="Search by teacher name or subject — e.g. “Kavita” or “Mathematics”"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="count">
          {teachers != null
            ? `${rows.length} ${ql || minAvg ? `MATCH${rows.length === 1 ? '' : 'ES'}` : 'TEACHERS'}`
            : '…'}
        </span>
      </div>
      <div className="st-list-wrap fade">
        <div className="st-scroll">
          <div className="st-head">
            <span>RANK</span><span>TEACHER NAME</span><span>SUBJECT</span>
            <span className="r">CLASS AVG</span><span>REPORT</span>
          </div>
          {loading && !(teachers || []).length ? (
            [0, 1, 2, 3].map((i) => (
              <div className="pd-skel-row" key={i}>
                <div className="pd-skel" style={{ height: 24 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 24 }} />
              </div>
            ))
          ) : (
            <>
              {rows.map((t) => <TeacherRow key={t.id} t={t} onOpen={onOpenTeacher} />)}
              {!rows.length && <div className="noresult">No teachers match your search.</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* =========================================================== 04 STUDENT */
function StudentRow({ s, saved, onOpen, onBookmark }) {
  const reveal = useReveal();
  return (
    <div
      className="srow"
      role="button"
      tabIndex={0}
      title="Open report card"
      onClick={() => onOpen(s)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s); }}
    >
      <span className={`rankbadge${s.rank && s.rank <= 3 ? ' top' : ''}`}>#{s.rank ?? '—'}</span>
      <span className="st-name">
        <span className="avatar">{initials(s.name)}</span>
        <span className="nm">{s.name}</span>
      </span>
      <span className="classchip">{s.className}</span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(s.avg)} style={{ width: reveal ? `${Math.min(100, pct(s.avg))}%` : 0 }} /></span>
        <span className="pc">{pct(s.avg)}%</span>
        <Trend d={s.trend} />
      </span>
      <button
        type="button"
        className={`bm${saved ? ' on' : ''}`}
        title="Save to folder"
        aria-label={`Save ${s.name} to folder`}
        onClick={(e) => { e.stopPropagation(); onBookmark(e, s); }}
      >
        <Bookmark strokeWidth={2} />
      </button>
    </div>
  );
}

export function SectionStudents({
  query, onQuery, rows, total, loading, loadingMore, onMore, onOpenReport,
  savedIds, onBookmark, listRef, minAvg, onMinAvg,
}) {
  const sentinelRef = useRef(null);
  const [secRef, secIn] = useInView();

  useEffect(() => {
    const el = sentinelRef.current;
    const scroller = listRef?.current;
    if (!el || !scroller || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) onMore();
    }, { root: scroller, rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore, listRef, rows.length]);

  const bandLabel = minAvg ? `${rows.length} STUDENT${rows.length === 1 ? '' : 'S'}` : null;

  return (
    <section className={`lvl lvl-4 rv${secIn ? ' in' : ''}`} id="studentSec" ref={secRef}>
      <SectionHead
        lvl={4}
        title="Student Level"
        sub="Every student in the school, ranked by their all-term average score."
        tag={bandLabel
          ? `${bandLabel} · CLICK FOR REPORT CARD`
          : total != null ? `${total} STUDENTS · CLICK FOR REPORT CARD` : 'CLICK A STUDENT FOR REPORT CARD'}
      />
      <RankTabs value={String(minAvg ?? 0)} onChange={(v) => onMinAvg(v === 'all' ? 0 : Number(v))} />
      <div className="searchbar fade">
        <Search strokeWidth={2} />
        <input
          type="text"
          value={query}
          placeholder="Search by student name or class — e.g. “Ananya” or “10-Sapphire”"
          autoComplete="off"
          onChange={(e) => onQuery(e.target.value)}
        />
        <span className="count">
          {total != null ? `${total} ${query || minAvg ? `MATCH${total === 1 ? '' : 'ES'}` : 'STUDENTS'}` : '…'}
        </span>
      </div>
      <div className="st-list-wrap fade">
        <div className="st-scroll" ref={listRef}>
          <div className="st-head">
            <span>RANK</span><span>STUDENT NAME</span><span>CLASS</span>
            <span className="r">ALL-TERM AVG</span><span>SAVE</span>
          </div>
          {loading && !rows.length ? (
            [0, 1, 2, 3, 4, 5].map((i) => (
              <div className="pd-skel-row" key={i}>
                <div className="pd-skel" style={{ height: 24 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 16 }} />
                <div className="pd-skel" style={{ height: 24 }} />
              </div>
            ))
          ) : (
            <>
              {rows.map((s) => (
                <StudentRow
                  key={s.id} s={s} saved={savedIds.has(s.id)}
                  onOpen={onOpenReport} onBookmark={onBookmark}
                />
              ))}
              {loadingMore && <div className="pd-note">Loading more…</div>}
              {!rows.length && !loading && <div className="noresult">No students match your search.</div>}
              <div ref={sentinelRef} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
