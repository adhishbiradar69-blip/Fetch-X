/* Class detail in-page view (#class=<id>) — designer v15 classDetailView:
   overview strip, score distribution, ATTENDANCE TREND with range tabs
   (v15), student comparison bars with per-subject metric tabs (v15),
   02-style subject cards, ranked student list and the weekly TIMETABLE
   (v15, new backend /timetable/class/{id}). */
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Bookmark, CalendarCheck2, ClipboardCheck, Search, School, Trophy, Users,
} from 'lucide-react';
import { fetchAttendanceSeriesScoped, fetchClassDetail } from './data';
import { Donut, Distro, BarChart, LineChart, Trend, useReveal } from './charts';
import { SectionHead, Chip, TeachPill } from './Sections';
import { ClassTimetable } from './Timetable';
import { ATT_TABS, initials, mean, pct } from './util';

function StatCell({ icon: Icon, k, v, of, sep }) {
  return (
    <div className={`stat-cell${sep ? ' sep' : ''}`}>
      <div className="ic"><Icon strokeWidth={1.8} /></div>
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}{of && <span className="of">/{of}</span>}</div>
      </div>
    </div>
  );
}

const SUBJ_SHORT = (n) => String(n).toUpperCase().slice(0, 8);

/* fetcher: where the class detail comes from — the principal endpoint or
   the class teacher's scoped /ct/class-dashboard (v15 CT console "My Class"). */
export default function ClassDetail({ classId, classesAll, onBack, onOpenReport, savedIds, onBookmark, fetcher, embedded = false, backLabel = 'PRINCIPAL DASHBOARD' }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  /* v15: attendance trend + range, comparison metric */
  const [attRange, setAttRange] = useState('3M');
  const [attPoints, setAttPoints] = useState(null);
  const [barMetric, setBarMetric] = useState('overall');

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      setErr(null);
      setData(null);
      setFilter('');
      setBarMetric('overall');
      setAttRange('3M');
      setAttPoints(null);
      try {
        const d = await (fetcher || fetchClassDetail)(classId);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setErr(e);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher is a stable per-caller identity
  }, [classId]);

  /* attendance trend for THIS class (scoped series endpoint) */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setAttPoints(null);
      const days = { '30D': 30, '3M': 92, '6M': 183, '1Y': 365 }[attRange] || 92;
      await fetchAttendanceSeriesScoped({ scope: 'class', id: classId, days })
        .then((d) => { if (alive) setAttPoints(d.points || []); })
        .catch(() => { if (alive) setAttPoints([]); });
    };
    run();
    return () => { alive = false; };
  }, [classId, attRange]);

  const info = data?.info;
  const subjects = useMemo(() => data?.subjects || [], [data]);
  const students = useMemo(() => data?.students || [], [data]);
  const totalClasses = (classesAll || []).length;

  const tAvgs = useMemo(() => {
    if (!subjects.length) return {};
    return {
      t1: Math.round(mean(subjects.map((s) => s.t1))),
      t2: Math.round(mean(subjects.map((s) => s.t2))),
      t3: Math.round(mean(subjects.map((s) => s.t3))),
    };
  }, [subjects]);

  const marksAvg = info ? pct(info.avg) : 0;
  const attPct = info ? pct(info.attendance_pct) : 0;
  const taskPct = info ? pct(info.tasks_pct) : 0;
  const overall = info ? Math.round((marksAvg + taskPct + attPct) / 3) : 0;

  /* v15 comparison tabs: OVERALL + each subject of this class */
  const BAR_TABS = useMemo(() => {
    const tabs = { overall: 'OVERALL' };
    subjects.forEach((s, i) => { tabs[String(i)] = SUBJ_SHORT(s.name); });
    return tabs;
  }, [subjects]);

  const barItems = useMemo(() => {
    const idx = Number(barMetric);
    const sub = subjects[idx];
    return students
      .map((s) => {
        const v = (barMetric === 'overall' || !sub)
          ? pct(s.avg)
          : pct(s.subject_scores?.[sub.name] ?? s.avg);
        return { key: s.id, label: initials(s.name), tip: `${s.name} · ${v}% · class rank #${s.rank}`, val: v };
      })
      .sort((a, b) => b.val - a.val);
  }, [students, barMetric, subjects]);

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return students
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }, [students, filter]);

  const name = info?.name || '…';

  return (
    <div>
      {!embedded && (
        <div className="cd-head">
          <div>
            <button type="button" className="btn-back" onClick={onBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
              {backLabel}
            </button>
            <div className="eyebrow">SCHOOL INTELLIGENCE · CLASS LEVEL</div>
            <h1>Class {name}</h1>
            <div className="subtitle">Class-wide academic and operational performance.</div>
            {info?.ct_name && (
              <div style={{ marginTop: 10 }}>
                <TeachPill name={info.ct_name} tag={info.ct_subject ? `CT · ${info.ct_subject}` : 'CT'} title={`Class Teacher · ${info.ct_name}`} />
              </div>
            )}
          </div>
          <div className="bigrank">
            <span className="pill">{info ? `#${info.rank} / ${totalClasses || '—'}` : '…'}</span>
            <span className="sub">CLASS RANKING</span>
          </div>
        </div>
      )}

      {loading && <div className="pd-skel tall" />}
      {err && !loading && (
        <div className="card"><div className="pd-note">This class could not be loaded. It may not exist yet — try again after the data seed finishes.</div></div>
      )}

      {data && (
        <>
          <section className="lvl lvl-3 compact first">
            <SectionHead title="Class Overview" sub="Overall performance of this class across all terms." tag={`${info.students ?? students.length} STUDENTS`} />
            <div className="school-strip">
              <div className="card card-op fade">
                <div className="label">OVERALL PERFORMANCE (ALL TERMS)</div>
                <div className="op-stats">
                  <div className="op-stat" title={`(${marksAvg} marks + ${taskPct}% tasks + ${attPct}% attendance) ÷ 3 = ${overall}%`}>
                    <div className="k">ALL TERM<br />AVERAGE</div>
                    <Donut value={overall} variant="d-md" />
                  </div>
                  <div className="op-stat"><div className="k">TERM 1<br />OVERALL AVERAGE</div><div className="v">{tAvgs.t1 ?? '—'}%</div></div>
                  <div className="op-stat"><div className="k">TERM 2<br />OVERALL AVERAGE</div><div className="v">{tAvgs.t2 ?? '—'}%</div></div>
                  <div className="op-stat"><div className="k">TERM 3<br />OVERALL AVERAGE</div><div className="v">{tAvgs.t3 ?? '—'}%</div></div>
                </div>
              </div>
              <div className="card card-stats fade">
                <StatCell icon={Users} k="TOTAL STUDENTS" v={info.students ?? students.length} />
                <StatCell icon={BookOpen} k="TOTAL SUBJECTS" v={subjects.length || '—'} />
                <StatCell icon={Trophy} sep k="CLASS RANKING" v={`#${info.rank}`} of={totalClasses || undefined} />
                <StatCell icon={CalendarCheck2} k="ATTENDANCE (AVG)" v={`${attPct}%`} />
                <StatCell icon={ClipboardCheck} k="TASK COMPLETION (AVG)" v={`${taskPct}%`} />
                <StatCell icon={School} sep k="AVERAGE MARKS" v={`${marksAvg}%`} />
              </div>
            </div>

            <div className="card distro-card fade">
              <div className="label">
                {data.distribution
                  ? `SCORE DISTRIBUTION · CLASS ${name} · ${Number(data.distribution.total).toLocaleString('en-IN')} marks, all terms. Bar = share of marks`
                  : 'SCORE DISTRIBUTION'}
              </div>
              {data.distribution
                ? <Distro bands={data.distribution.bands} total={data.distribution.total} />
                : <div className="pd-note">No distribution data.</div>}
            </div>

            {/* v15: class attendance trend with range tabs */}
            <div className="card chart-card fade">
              <div className="chead">
                <span className="label">ATTENDANCE TREND · CLASS {name}{attRange ? ` · LAST ${ATT_TABS[attRange]}` : ''}</span>
                <div className="ctabs">
                  {Object.entries(ATT_TABS).map(([k, label]) => (
                    <button key={k} type="button" className={`gtab${k === attRange ? ' active' : ''}`} onClick={() => setAttRange(k)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="cbody">
                {attPoints
                  ? <LineChart points={attPoints} rangeKey={attRange} />
                  : <div className="pd-skel tall" />}
              </div>
            </div>

            {/* v15: student comparison with metric tabs */}
            <div className="card chart-card fade">
              <div className="chead">
                <span className="label">STUDENT COMPARISON · {BAR_TABS[String(barMetric)] || 'OVERALL'} · {students.length} STUDENTS</span>
                <div className="ctabs">
                  {Object.entries(BAR_TABS).map(([k, label]) => (
                    <button key={k} type="button" className={`gtab${String(barMetric) === k ? ' active' : ''}`} onClick={() => setBarMetric(k)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="cbody">
                <BarChart
                  items={barItems}
                  flat
                  topName={barItems[0]?.tip.split(' · ')[0]}
                  onClick={(i) => onOpenReport({ id: barItems[i].key })}
                />
              </div>
            </div>
          </section>

          <section className="lvl lvl-2 compact">
            <SectionHead title="Subject Level" sub="Each subject in this class, term by term." tag="RANKED WITHIN CLASS" />
            <div className="subject-grid">
              {subjects.map((s, i) => (
                <div className="card s-card fade" key={s.name || i}>
                  <div className="s-head">
                    <span className="s-name">{String(s.name).toUpperCase()}</span>
                    {s.hod && <span className="teach-pill" title={`Head of Department · ${s.hod}`}><b>{s.hod}</b></span>}
                    <span className={`rank-pill${i === 0 ? ' top' : ''}`}>#{i + 1}<span className="of30">/{subjects.length}</span></span>
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
                      <Trend d={pct(s.t3) - pct(s.t2)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="lvl lvl-4 compact">
            <SectionHead
              title="Students"
              sub={`${info.students ?? students.length} students, ranked within the class by all-term average.`}
              tag="CLICK A STUDENT FOR REPORT CARD"
            />
            <div className="searchbar">
              <Search strokeWidth={2} />
              <input
                type="text"
                value={filter}
                placeholder="Search students in this class…"
                autoComplete="off"
                onChange={(e) => setFilter(e.target.value)}
              />
              <span className="count">{filter ? `${list.length} MATCH${list.length === 1 ? '' : 'ES'}` : `${students.length} STUDENTS`}</span>
            </div>
            <div className="st-list-wrap">
              <div className="st-scroll" style={{ maxHeight: 420 }}>
                <div className="st-head">
                  <span>RANK</span><span>STUDENT NAME</span><span>ATTEN.</span>
                  <span className="r">ALL-TERM AVG</span><span>SAVE</span>
                </div>
                {list.map((s) => (
                  <StudentRow
                    key={s.id} s={s}
                    onOpen={() => onOpenReport({ id: s.id })}
                    saved={savedIds.has(s.id)}
                    onBookmark={onBookmark}
                  />
                ))}
                {!list.length && <div className="noresult">No students match your search.</div>}
              </div>
            </div>
          </section>

          {/* v15: the weekly timetable */}
          <section className="lvl lvl-3 compact">
            <SectionHead
              title="Timetable"
              sub={`Weekly schedule for Class ${name} — conflict-free across every teacher.`}
              tag="MON–SAT · 9 PERIODS"
            />
            <ClassTimetable classId={classId} />
          </section>
        </>
      )}
    </div>
  );
}

function StudentRow({ s, onOpen, saved, onBookmark }) {
  const reveal = useReveal();
  return (
    <div
      className="srow"
      role="button"
      tabIndex={0}
      title="Open report card"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <span className={`rankbadge${s.rank && s.rank <= 3 ? ' top' : ''}`}>#{s.rank ?? '—'}</span>
      <span className="st-name">
        <span className="avatar">{initials(s.name)}</span>
        <span className="nm">{s.name}</span>
      </span>
      <span className="classchip" title="Attendance">{pct(s.attendance_pct)}%</span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(s.avg)} style={{ width: reveal ? `${Math.min(100, pct(s.avg))}%` : 0 }} /></span>
        <span className="pc">{pct(s.avg)}%</span>
      </span>
      <button
        type="button"
        className={`bm${saved ? ' on' : ''}`}
        title="Save to folder"
        aria-label={`Save ${s.name} to folder`}
        onClick={(e) => { e.stopPropagation(); onBookmark(e, { id: s.id, name: s.name }); }}
      >
        <Bookmark strokeWidth={2} />
      </button>
    </div>
  );
}
