/* Timetable — designer v15: the weekly class grid (MON–SAT × 9 periods)
   and the personal teacher grid. Data comes from the NEW backend
   GET /timetable/class/{id} and /timetable/teacher/{id}. */
import { useEffect, useState } from 'react';
import { fetchClassTimetable, fetchTeacherTimetable } from './data';
import { useReveal } from './charts';

function Grid({ data, mode }) {
  const reveal = useReveal();
  if (!data) return null;
  const { days, grid } = data;
  return (
    <div className="tt-wrap" style={{ opacity: reveal ? 1 : 0, transition: 'opacity .5s ease' }}>
      <div className="tt-grid">
        <span className="tt-h" />
        {days.map((d) => <span className="tt-h" key={d}>{d}</span>)}
        {grid.map((row, p) => (
          <div style={{ display: 'contents' }} key={`p${p}`}>
            <span className="tt-p">P{p + 1}</span>
            {row.map((L, d) => {
              if (!L) return <span className="tt-c off" key={`c${p}-${d}`}>—</span>;
              if (mode === 'teacher') {
                return (
                  <span className={`tt-c spec${L.kind === 'event' ? ' event' : ''}`} key={`c${p}-${d}`}
                    title={`${L.name} · ${L.class || ''}`}>
                    <b>{L.class}</b><span>{L.name}</span>
                  </span>
                );
              }
              const cls = L.kind === 'event' ? ' event'
                : (L.kind === 'spec' || L.kind === 'act') ? ' spec'
                : L.kind === 'study' ? ' off' : '';
              return (
                <span className={`tt-c${cls}`} key={`c${p}-${d}`} title={`${L.name} · ${L.teacher}`}>
                  <b>{L.short}</b><span>{String(L.teacher || '').split(' ').slice(1).join(' ') || L.teacher}</span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Foot({ items }) {
  return (
    <div className="d-foot" style={{ margin: '10px 16px 0' }}>
      {items.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}
    </div>
  );
}

/* mode="class": fetch by class id (principal + CT console). */
export function ClassTimetable({ classId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setData(null);
      setErr(false);
      await fetchClassTimetable(classId)
        .then((d) => { if (alive) setData(d); })
        .catch(() => { if (alive) setErr(true); });
    };
    run();
    return () => { alive = false; };
  }, [classId]);

  if (err) return <div className="pd-note">Timetable could not be generated.</div>;
  if (!data) return <div className="pd-skel tall" />;
  const f = data.foot || {};
  return (
    <>
      <Grid data={data} mode="class" />
      <Foot items={[
        ['PERIODS / DAY', f.periods_per_day ?? 9],
        ['SATURDAY', f.saturday ?? 9],
        ['ACADEMIC / DAY', f.academic_per_day ?? 7],
        ['ACTIVITIES / DAY', f.activities_per_day ?? 2],
        ['TEACHER CONFLICTS', f.teacher_conflicts ?? 0],
        ['SELF-STUDY', f.self_study_slots ?? 0],
        ['MASS PE', f.mass_pe ?? 'WED P1'],
        ['MASS PT', f.mass_pt ?? 'SAT P1'],
        ['CCA', f.cca ?? 'SAT P7'],
      ]} />
    </>
  );
}

/* mode="teacher": fetch the caller's own grid. */
export function PersonalTimetable({ teacherId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setData(null);
      setErr(false);
      await fetchTeacherTimetable(teacherId)
        .then((d) => { if (alive) setData(d); })
        .catch(() => { if (alive) setErr(true); });
    };
    run();
    return () => { alive = false; };
  }, [teacherId]);

  if (err) return <div className="pd-note">Personal timetable could not be generated.</div>;
  if (!data) return <div className="pd-skel tall" />;
  const s = data.summary || {};
  return (
    <>
      <Grid data={data} mode="teacher" />
      <Foot items={[
        ['WEEKLY PERIODS', s.weekly_periods ?? 0],
        ['FREE PERIODS', s.free_periods ?? 0],
        ['SUBJECT', (s.subjects || []).join(', ') || '—'],
        ['CLASSES', (s.classes || []).length || 0],
      ]} />
    </>
  );
}
