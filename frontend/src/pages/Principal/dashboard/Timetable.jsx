/* Timetable — designer v15: the weekly class grid (MON–SAT × 9 periods)
   and the personal teacher grid. Data comes from the NEW backend
   GET /timetable/class/{id} and GET /timetable/teacher/{id}.

   v16 export round: both grids gained the shared .tt-tools row —
     • EXPORT CSV  → the grid as a PERIOD × DAY sheet (RFC-4180, BOM'd)
     • PRINT       → styles/print.css scopes the paper to .tt-print-scope
                     (light tokens, letterhead via data-print-meta) */
import { useEffect, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { fetchClassTimetable, fetchTeacherTimetable } from './data';
import { useReveal } from './charts';
import { csvStamp, downloadCsv } from '../../../lib/csv';
import { printStamp } from './printCard';

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

/* ---------- export tools (shared by class + personal grids) ----------- */

const cellText = (L, mode) => {
  if (!L) return '—';
  if (mode === 'teacher') return [L.class, L.name].filter(Boolean).join(' · ') || L.name;
  return [L.short, L.teacher].filter(Boolean).join(' · ');
};

/* the grid as a CSV sheet — one row per period, one column per day */
function buildTimetableCsv(data, mode) {
  const { days, grid } = data;
  return {
    headers: ['PERIOD', ...days.map((d) => String(d).toUpperCase())],
    rows: grid.map((row, p) => [`P${p + 1}`, ...row.map((L) => cellText(L, mode))]),
  };
}

/* browser-print path — print.css scopes the paper to .tt-print-scope
   (body.fx-print-tt), mirrors the modal print flow in printCard.js */
function useTimetablePrint() {
  const scopeRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const print = async (label) => {
    const scope = scopeRef.current;
    if (!scope || busy) return;
    setBusy(true);
    try { await document.fonts.ready; } catch { /* font API unavailable */ }
    await new Promise((r) => setTimeout(r, 200));
    scope.setAttribute('data-print-meta', `TIMETABLE · ${String(label).toUpperCase()} · GENERATED ${printStamp()}`);
    document.body.classList.add('fx-print-tt');
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      document.body.classList.remove('fx-print-tt');
      scope.removeAttribute('data-print-meta');
      window.removeEventListener('afterprint', cleanup);
      setBusy(false);
    };
    /* afterprint is the happy path; the timer is the safety net for
       cancelled dialogs / headless quirks (same as printCardEl) */
    window.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 20000);
    try { window.print(); } catch { cleanup(); }
  };
  return { scopeRef, print, busy };
}

function TimetableTools({ data, mode, label, filename, onPrint, printBusy }) {
  if (!data) return null;
  const exportCsv = () => {
    const { headers, rows } = buildTimetableCsv(data, mode);
    downloadCsv(`fetchx-timetable-${filename}-${csvStamp()}.csv`, headers, rows);
  };
  return (
    <div className="tt-tools">
      <button type="button" className="exe" onClick={exportCsv} title="Download the grid as a CSV sheet">
        <Download strokeWidth={2.4} aria-hidden="true" /><span>EXPORT CSV</span>
      </button>
      <button
        type="button" className="exe" onClick={() => onPrint(label)}
        disabled={printBusy} title="Print this timetable"
      >
        <Printer strokeWidth={2.4} aria-hidden="true" /><span>PRINT</span>
      </button>
    </div>
  );
}

/* mode="class": fetch by class id (principal + CT console). */
export function ClassTimetable({ classId, label }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const { scopeRef, print, busy } = useTimetablePrint();

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
    <div className="tt-print-scope" ref={scopeRef}>
      <TimetableTools
        data={data} mode="class" label={label || 'Class timetable'} filename="class"
        onPrint={print} printBusy={busy}
      />
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
    </div>
  );
}

/* mode="teacher": fetch the caller's own grid. */
export function PersonalTimetable({ teacherId, label }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);
  const { scopeRef, print, busy } = useTimetablePrint();

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
    <div className="tt-print-scope" ref={scopeRef}>
      <TimetableTools
        data={data} mode="teacher" label={label || 'Personal timetable'} filename="my"
        onPrint={print} printBusy={busy}
      />
      <Grid data={data} mode="teacher" />
      <Foot items={[
        ['WEEKLY PERIODS', s.weekly_periods ?? 0],
        ['FREE PERIODS', s.free_periods ?? 0],
        ['SUBJECT', (s.subjects || []).join(', ') || '—'],
        ['CLASSES', (s.classes || []).length || 0],
      ]} />
    </div>
  );
}
