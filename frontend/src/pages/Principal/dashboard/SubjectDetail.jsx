/* SubjectDetail — designer v15 (#subject=<id>): the full subject page.
   Overview strip + mark distribution + ranked faculty + every student
   ranked by the subject score. Fed by the NEW backend
   GET /principal/subject-detail/{id}. */
import { useEffect, useMemo, useState } from 'react';
import { Bookmark, PersonStanding, School, Star, Trophy, Users } from 'lucide-react';
import { fetchSubjectDetail } from './data';
import { Donut, Distro, Trend, useReveal } from './charts';
import { SectionHead } from './Sections';
import { initials, pct } from './util';

const RANK_TABS = [['all', 'ALL'], ['90', '90+'], ['80', '80+'], ['70', '70+'], ['60', '60+'], ['50', '50+'], ['40', '40+']];

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

export default function SubjectDetail({ subjectId, onBack, onOpenReport, onOpenTeacher, savedIds, onBookmark }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const [minAvg, setMinAvg] = useState(0);
  const [q, setQ] = useState('');
  const reveal = useReveal();

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setData(null);
      setErr(false);
      setMinAvg(0);
      setQ('');
      await fetchSubjectDetail(subjectId)
        .then((d) => { if (alive) setData(d); })
        .catch(() => { if (alive) setErr(true); });
    };
    run();
    return () => { alive = false; };
  }, [subjectId]);

  const students = useMemo(() => {
    const list = data?.students || [];
    const ql = q.trim().toLowerCase();
    return list.filter((s) =>
      (minAvg === 0 || (s.score ?? 0) >= minAvg)
      && (!ql || s.name.toLowerCase().includes(ql) || s.class_name.toLowerCase().includes(ql)));
  }, [data, minAvg, q]);

  if (err) {
    return (
      <div>
        <button type="button" className="btn-back" onClick={onBack}>PRINCIPAL DASHBOARD</button>
        <div className="card"><div className="pd-note">This subject could not be loaded.</div></div>
      </div>
    );
  }
  if (!data) return <div className="pd-skel tall" />;

  const { subject, overview: ov, distribution, teachers } = data;
  const o = ov || {};

  return (
    <div>
      <div className="cd-head">
        <div>
          <button type="button" className="btn-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            PRINCIPAL DASHBOARD
          </button>
          <div className="eyebrow">SCHOOL INTELLIGENCE · SUBJECT LEVEL</div>
          <h1>{subject.name}</h1>
          <div className="subtitle">Subject-wide academic performance across every class and term.</div>
        </div>
        <div className="bigrank">
          <span className="pill">{o.avg != null ? `${pct(o.avg)}%` : '…'}</span>
          <span className="sub">SUBJECT AVERAGE</span>
        </div>
      </div>

      <section className="lvl lvl-2 compact first">
        <SectionHead
          title="Subject Overview"
          sub="Overall performance of this subject across all terms."
          tag={`${o.students ?? 0} STUDENTS · ${o.teachers ?? 0} TEACHERS`}
        />
        <div className="school-strip">
          <div className="card card-op fade">
            <div className="label">SUBJECT PERFORMANCE (ALL TERMS)</div>
            <div className="op-stats">
              <div className="op-stat">
                <div className="k">SUBJECT<br />AVERAGE</div>
                <Donut value={pct(o.avg)} variant="d-md" />
              </div>
              {['t1', 't2', 't3'].map((t, i) => (
                <div className="op-stat" key={t}>
                  <div className="k">TERM {i + 1}<br />AVERAGE</div>
                  <div className="v">{o.terms?.[t] != null ? `${pct(o.terms[t])}%` : '—'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card card-stats fade">
            <StatCell icon={PersonStanding} k="HEAD OF DEPARTMENT" v={o.hod || '—'} />
            <StatCell icon={Users} k="TOTAL TEACHERS" v={o.teachers ?? '—'} />
            <StatCell icon={Trophy} sep k="BEST CLASS" v={o.top_class || '—'} />
            <StatCell icon={School} k="STUDENTS STUDYING" v={o.students ?? '—'} />
            <StatCell icon={Star} k="TOP SCORE" v={o.top_score != null ? `${pct(o.top_score)}%` : '—'} />
            <StatCell icon={Trophy} sep k="SUBJECT AVERAGE" v={`${pct(o.avg)}%`} />
          </div>
        </div>
        <div className="card distro-card fade">
          <div className="label">
            {distribution
              ? `MARK DISTRIBUTION · ${String(subject.name).toUpperCase()} · ${Number(distribution.total).toLocaleString('en-IN')} students · bar = share of students`
              : 'MARK DISTRIBUTION'}
          </div>
          {distribution
            ? <Distro bands={distribution.bands} total={distribution.total} />
            : <div className="pd-note">No distribution data.</div>}
        </div>
      </section>

      <section className="lvl lvl-6 compact">
        <SectionHead
          title="Faculty"
          sub={`Every ${subject.name} teacher, ranked by class-subject average.`}
          tag={`${teachers.length} TEACHERS · CLICK FOR REPORT`}
        />
        <div className="st-list-wrap">
          <div className="st-scroll" style={{ maxHeight: 320 }}>
            <div className="st-head">
              <span>RANK</span><span>TEACHER NAME</span><span>CLASSES</span>
              <span className="r">SUBJECT AVG</span><span>REPORT</span>
            </div>
            {teachers.map((t) => (
              <div
                className="srow" key={t.id} role="button" tabIndex={0} title="Open teacher report"
                onClick={() => onOpenTeacher?.(t)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenTeacher?.(t); }}
              >
                <span className={`rankbadge${t.rank <= 3 ? ' top' : ''}`}>#{t.rank ?? '—'}</span>
                <span className="st-name">
                  <span className="avatar">{initials(t.name)}</span>
                  <span className="nm">{t.name}{t.is_hod ? ' · HOD' : ''}{t.ct_of ? ' · CT' : ''}</span>
                </span>
                <span className="classchip" title="classes taught">{t.classes} CLS</span>
                <span className="scorepill">
                  <span className="bar"><i data-w={pct(t.avg)} style={{ width: reveal ? `${Math.min(100, pct(t.avg))}%` : 0 }} /></span>
                  <span className="pc">{t.avg != null ? `${pct(t.avg)}%` : '—'}</span>
                  <Trend d={t.trend} />
                </span>
                <span className="tb" aria-hidden>→</span>
              </div>
            ))}
            {!teachers.length && <div className="noresult">No faculty found for this subject.</div>}
          </div>
        </div>
      </section>

      <section className="lvl lvl-4 compact">
        <SectionHead
          title="Students"
          sub={`Every student ranked by their ${subject.name} score.`}
          tag="CLICK A STUDENT FOR REPORT CARD"
        />
        <div className="rank-tabs fade">
          {RANK_TABS.map(([v, l]) => (
            <button key={v} type="button" className={`gtab${String(minAvg) === v ? ' active' : ''}`}
              onClick={() => setMinAvg(v === 'all' ? 0 : Number(v))}>{l}</button>
          ))}
        </div>
        <div className="searchbar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            type="text"
            value={q}
            placeholder="Search students by name or class…"
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="count">{q || minAvg ? `${students.length} MATCH${students.length === 1 ? '' : 'ES'}` : `${data.students.length} STUDENTS`}</span>
        </div>
        <div className="st-list-wrap">
          <div className="st-scroll" style={{ maxHeight: 420 }}>
            <div className="st-head">
              <span>RANK</span><span>STUDENT NAME</span><span>CLASS</span>
              <span className="r">SUBJECT AVG</span><span>SAVE</span>
            </div>
            {students.map((s) => (
              <div
                className="srow" key={s.id} role="button" tabIndex={0} title="Open report card"
                onClick={() => onOpenReport?.({ id: s.id })} onKeyDown={(e) => { if (e.key === 'Enter') onOpenReport?.({ id: s.id }); }}
              >
                <span className={`rankbadge${s.rank && s.rank <= 3 ? ' top' : ''}`}>#{s.rank ?? '—'}</span>
                <span className="st-name">
                  <span className="avatar">{initials(s.name)}</span>
                  <span className="nm">{s.name}</span>
                </span>
                <span className="classchip">{s.class_name}</span>
                <span className="scorepill">
                  <span className="bar"><i data-w={pct(s.score)} style={{ width: reveal ? `${Math.min(100, pct(s.score))}%` : 0 }} /></span>
                  <span className="pc">{s.score != null ? `${pct(s.score)}%` : '—'}</span>
                </span>
                <button
                  type="button" className={`bm${savedIds?.has(s.id) ? ' on' : ''}`} title="Save to folder"
                  aria-label={`Save ${s.name} to folder`}
                  onClick={(e) => { e.stopPropagation(); onBookmark?.(e, { id: s.id, name: s.name }); }}
                >
                  <Bookmark strokeWidth={2} />
                </button>
              </div>
            ))}
            {!students.length && <div className="noresult">No students match your search.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
