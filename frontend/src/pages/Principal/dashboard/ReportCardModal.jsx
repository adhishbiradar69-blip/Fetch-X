/* Report card modal (.report kit) — band-themed, fed by real
   /principal/student-report data, with the prototype's PDF export
   (html2canvas + jsPDF, force-light capture, A4 slicing) and a
   window.print fallback.

   v16: term toggle (.rep-terms / .report.term-mode) — ALL TERM keeps the
   original composite view; TERM 1/2/3 re-bands the card and switches every
   subject surface to that term's marks (the API's `terms` + per-subject
   `marks.t{n}`). Tasks / attendance have no term dimension in the backend,
   so term mode keeps their all-term values with honest labels + tooltips. */
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen, Bookmark, CalendarCheck2, ClipboardCheck, Download, Printer, School, Trophy, X,
} from 'lucide-react';
import { printCardEl, printStamp } from './printCard';
import { fetchStudentReport } from './data';
import { Donut, GroupedBars, LineChart } from './charts';
import { ATT_RANGES, ATT_TABS, bandOf, initials, mean, pct } from './util';

const TERM_KEYS = ['t1', 't2', 't3'];

function RepStat({ label, chips, all, C }) {
  return (
    <div className="card rep-stat">
      <div className="label">{label}</div>
      <div className="rep-stat-body">
        <div className="chips">
          {chips.map(([t, n]) => (
            <div className="chip" key={t}><span className="t">{t}</span><span className="n" style={{ color: C }}>{n}</span></div>
          ))}
        </div>
        <div className="avg-wrap">
          <span className="avg-label">ALL TERM</span>
          <Donut value={all} variant="d-sm" />
        </div>
      </div>
    </div>
  );
}

export default function ReportCardModal({ studentId, onClose, totalStudents, saved, onBookmark }) {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(false);
  const [attRange, setAttRange] = useState('3M');
  const [term, setTerm] = useState('all'); // 'all' | '0' | '1' | '2' (v16)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const cardRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setRep(null);
      setErr(false);
      setAttRange('3M');
      setTerm('all');
      if (studentId == null) return;
      try {
        const r = await fetchStudentReport(studentId);
        if (alive) setRep(r);
      } catch {
        if (alive) setErr(true);
      }
    };
    run();
    return () => { alive = false; };
  }, [studentId]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [rep]);

  if (studentId == null) return null;

  const isAll = term === 'all';
  const ti = isAll ? -1 : Number(term); // 0 | 1 | 2
  const tKey = isAll ? null : TERM_KEYS[ti];
  const termVal = !isAll && rep ? pct(rep.terms?.[tKey]) : null;
  const g = rep ? bandOf(isAll ? rep.derived.overall : termVal) : null;
  const C = g?.c;
  const bands = rep?.band || g?.label;

  const marksTerms = rep?.terms ? [pct(rep.terms.t1), pct(rep.terms.t2), pct(rep.terms.t3)] : [];
  const perTerm = rep ? [0, 1, 2].map((i) => {
    const tK = TERM_KEYS[i];
    const m = Math.round(mean(rep.subjects.map((s) => s.marks?.[tK] ?? 0)));
    return { m, t: Math.round(mean(rep.subjects.map((s) => pct(s.tasks_pct)))) };
  }) : [];

  const barItems = rep
    ? rep.subjects
        .map((x) => {
          const a = isAll ? pct(x.marksAvg) : pct(x.marks?.[tKey]);
          const b = pct(x.tasksAvg); // all-term — tasks are not term-scoped
          return {
            label: String(x.name).toUpperCase(),
            tip: isAll
              ? `${x.name} · marks ${a}% · tasks ${b}%`
              : `${x.name} · Term ${ti + 1}: marks ${a}% · tasks ${b}% (all-term)`,
            a,
            b,
          };
        })
        .sort((x, y) => (y.a + y.b) - (x.a + x.b))
    : [];

  const ranked = rep ? [...rep.subjects].sort((a, b) => b.marksAvg - a.marksAvg) : [];
  const rankOf = (name) => ranked.findIndex((s) => s.name === name) + 1;

  /* v16 term mode: per-term subject rank (dense, ties share a rank) */
  const termRank = {};
  if (rep && !isAll) {
    let prev = null;
    let rk = 0;
    [...rep.subjects]
      .sort((a, b) => pct(b.marks?.[tKey]) - pct(a.marks?.[tKey])
        || String(a.name).localeCompare(String(b.name)))
      .forEach((x) => {
        const v = pct(x.marks?.[tKey]);
        if (v !== prev) { rk += 1; prev = v; }
        termRank[x.name] = rk;
      });
  }

  /* ---- PDF export (prototype approach: freeze, force light, A4 slice) -- */
  const exportPdf = async () => {
    const card = cardRef.current;
    if (!card || pdfBusy) return;
    setPdfBusy(true);
    /* freeze every animated element at its final state */
    card.querySelectorAll('.donut .bar').forEach((b) => {
      if (b.dataset.off) b.style.strokeDashoffset = b.dataset.off;
    });
    card.querySelectorAll('.lreveal').forEach((r) => {
      r.style.transition = 'none';
      r.style.clipPath = 'inset(0 -2% 0 0)';
    });
    card.querySelectorAll('.vbar i, .vbar2 i, .scorepill .bar i, .d-track i').forEach((b) => {
      b.style.transition = 'none';
    });
    card.querySelectorAll('.ltip, .lxhair, .ldot').forEach((el) => el.classList.remove('on'));
    try {
      await document.fonts.ready;
    } catch { /* font API unavailable */ }
    await new Promise((r) => setTimeout(r, 400));
    try {
      const [hc, jp] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const html2canvas = hc.default;
      const { jsPDF } = jp;
      card.classList.add('force-light');
      const canvas = await html2canvas(card, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, imageTimeout: 0,
      });
      card.classList.remove('force-light');
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const iw = pw - 10;
      const sliceHpx = Math.floor((canvas.width * (ph - 10)) / iw);
      let y = 0;
      let first = true;
      while (y < canvas.height) {
        const sh = Math.min(sliceHpx, canvas.height - y);
        const sl = document.createElement('canvas');
        sl.width = canvas.width;
        sl.height = sh;
        const ctx = sl.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sl.width, sl.height);
        ctx.drawImage(canvas, 0, y, canvas.width, sh, 0, 0, canvas.width, sh);
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(sl.toDataURL('image/jpeg', 0.92), 'JPEG', 5, 5, iw, (sh * iw) / canvas.width);
        y += sh;
      }
      const nm = (rep?.student?.name || 'student').replace(/\s+/g, '-');
      pdf.save(`Report-${nm}-${rep?.student?.class_name || ''}${isAll ? '' : `-T${ti + 1}`}.pdf`);
    } catch (pdfErr) {
      card.classList.remove('force-light');
      console.warn(
        '[ReportCard] PDF export failed — falling back to browser print.'
        + ' If the error mentions "Failed to resolve import", run `npm install` inside frontend/'
        + ' (html2canvas + jspdf must be installed).',
        pdfErr,
      );
      try { window.print(); } catch { /* print blocked */ }
    }
    setPdfBusy(false);
  };

  /* browser-print path (styles/print.css scopes the sheet to this card;
     printCardEl freezes charts + stamps the letterhead) */
  const printReport = async () => {
    if (printBusy || pdfBusy || !cardRef.current || !rep) return;
    setPrintBusy(true);
    await printCardEl(
      cardRef.current,
      `STUDENT REPORT · ${String(rep.student?.name || '—').toUpperCase()}`
      + ` · CLASS ${rep.student?.class_name || '—'}`
      + ` · ${isAll ? 'ALL TERM' : `TERM ${ti + 1}`}`
      + ` · GENERATED ${printStamp()}`,
    );
    setPrintBusy(false);
  };

  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`report${isAll ? '' : ' term-mode'}`}
        ref={cardRef}
        style={g ? { '--lvlD': C, '--lvlSoft': g.soft, '--donut': C, '--bar': C } : undefined}
      >
        {!rep && !err && (
          <div className="pd-note" style={{ padding: 60 }}>Building report card…</div>
        )}
        {err && !rep && (
          <div className="pd-note" style={{ padding: 60 }}>
            This report could not be loaded. The student may not have marks yet.
            <div style={{ marginTop: 12 }}><button type="button" className="gtab" onClick={onClose}>CLOSE</button></div>
          </div>
        )}

        {rep && g && (
          <>
            <div className="rep-head">
              <div className="rep-id">
                <span className="avatar big" style={{ background: g.soft, color: C }}>{initials(rep.student?.name)}</span>
                <div>
                  <div className="eyebrow">STUDENT REPORT CARD · CLASS {rep.student?.class_name || '—'}</div>
                  <h2>{rep.student?.name || '—'}</h2>
                </div>
              </div>
              <div className="rep-ranks">
                <span className="grade-pill" style={{ background: g.soft, color: C }}>
                  {isAll
                    ? `${pct(rep.derived.overall)}% · ${bands || g.label}`
                    : `TERM ${ti + 1} · ${termVal}% · ${g.label}`}
                </span>
                <div className="bigrank">
                  <span className="pill" style={{ background: C }}>
                    #{rep.ranks?.in_school ?? '—'}{totalStudents ? ` / ${totalStudents}` : ''}
                  </span>
                  <span className="sub">SCHOOL RANK</span>
                </div>
                <div className="bigrank">
                  <span className="pill" style={{ background: g.soft, color: C }}>#{rep.ranks?.in_class ?? '—'}</span>
                  <span className="sub">CLASS RANK</span>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  className={`btn-close bm${saved ? ' on' : ''}`}
                  title="Save to folder"
                  onClick={(e) => onBookmark(e, { id: rep.student?.id, name: rep.student?.name })}
                >
                  <Bookmark strokeWidth={2} />
                </button>
                <button type="button" className="btn-close" title="Download as PDF" disabled={pdfBusy} onClick={exportPdf}>
                  <Download strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="btn-close"
                  title="Print report"
                  disabled={printBusy || pdfBusy}
                  onClick={printReport}
                >
                  <Printer strokeWidth={2} />
                </button>
                <button type="button" className="btn-close" title="Close report" disabled={pdfBusy || printBusy} onClick={onClose}>
                  <X strokeWidth={2.4} />
                </button>
              </div>
            </div>

            {/* v16 term toggle — ALL TERM / TERM 1 / TERM 2 / TERM 3 */}
            <div className="rep-terms" role="tablist" aria-label="Report term">
              {['all', '0', '1', '2'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`gtab${term === k ? ' active' : ''}`}
                  onClick={() => setTerm(k)}
                >
                  {k === 'all' ? 'ALL TERM' : `TERM ${Number(k) + 1}`}
                </button>
              ))}
            </div>

            <div className="school-strip">
              {isAll ? (
                <div className="card card-op">
                  <div className="label">OVERALL PERFORMANCE (ALL TERMS)</div>
                  <div className="op-stats">
                    <div
                      className="op-stat"
                      title={`(${pct(rep.derived.marks)} marks + ${pct(rep.derived.tasks)}% tasks + ${pct(rep.derived.attendance)}% attendance) ÷ 3 = ${pct(rep.derived.overall)}%`}
                    >
                      <div className="k">ALL TERM<br />AVERAGE</div>
                      <Donut value={rep.derived.overall} variant="d-md" />
                    </div>
                    {marksTerms.map((v, i) => (
                      <div className="op-stat" key={i}>
                        <div className="k">TERM {i + 1}<br />AVERAGE</div>
                        <div className="v">{v}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card card-op">
                  <div className="label">TERM {ti + 1} BREAKDOWN</div>
                  <div className="op-stats">
                    <div
                      className="op-stat"
                      title={`Term ${ti + 1} marks average — ${termVal}% across all subjects (tasks & attendance are reported all-term)`}
                    >
                      <div className="k">TERM {ti + 1}<br />AVERAGE</div>
                      <Donut value={termVal} variant="d-md" />
                    </div>
                    <div className="op-stat"><div className="k">MARKS<br />AVERAGE</div><div className="v">{termVal}%</div></div>
                    <div className="op-stat" title="All-term value — task completion is not term-scoped"><div className="k">TASK<br />COMPLETION</div><div className="v">{pct(rep.derived.tasks)}%</div></div>
                    <div className="op-stat" title="All-term value — attendance is not term-scoped"><div className="k">ATTENDANCE</div><div className="v">{pct(rep.derived.attendance)}%</div></div>
                  </div>
                </div>
              )}
              <div className="card card-stats">
                <div className="stat-cell">
                  <div className="ic"><Trophy strokeWidth={1.8} /></div>
                  <div><div className="k">SCHOOL RANK</div><div className="v">#{rep.ranks?.in_school ?? '—'}<span className="of">/{totalStudents || '—'}</span></div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><School strokeWidth={1.8} /></div>
                  <div><div className="k">CLASS</div><div className="v">{rep.student?.class_name || '—'}</div></div>
                </div>
                <div className="stat-cell sep">
                  <div className="ic"><Trophy strokeWidth={1.8} /></div>
                  <div><div className="k">CLASS RANK</div><div className="v">#{rep.ranks?.in_class ?? '—'}</div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><CalendarCheck2 strokeWidth={1.8} /></div>
                  <div><div className="k">ATTENDANCE (AVG)</div><div className="v">{pct(rep.derived.attendance)}%</div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><ClipboardCheck strokeWidth={1.8} /></div>
                  <div><div className="k">TASK COMPLETION (AVG)</div><div className="v">{pct(rep.derived.tasks)}%</div></div>
                </div>
                <div className="stat-cell sep">
                  <div className="ic"><BookOpen strokeWidth={1.8} /></div>
                  <div><div className="k">{isAll ? 'AVERAGE MARKS' : `MARKS (T${ti + 1})`}</div><div className="v">{isAll ? `${pct(rep.derived.marks)}%` : `${termVal}%`}</div></div>
                </div>
              </div>
            </div>

            <div className="rep-charts">
              <div className="card chart-card">
                <div className="chead">
                  <span className="label">ATTENDANCE TREND · {String(rep.student?.name || '').toUpperCase()} · LAST {ATT_RANGES[attRange].txt}</span>
                  <div className="ctabs">
                    {Object.entries(ATT_TABS).map(([k, label]) => (
                      <button key={k} type="button" className={`gtab${k === attRange ? ' active' : ''}`} onClick={() => setAttRange(k)}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="cbody">
                  <LineChart points={(rep.attendance_series || []).map((p) => ({ date: p.date, pct: p.pct }))} rawPoints={(rep.attendance_raw || []).map((p) => ({ date: p.date, pct: p.pct }))} rangeKey={attRange} height={120} />
                </div>
              </div>
              <div className="card chart-card">
                <div className="chead">
                  <span className="label">
                    {isAll ? 'SUBJECT COMPARISON · MARKS vs TASKS' : `SUBJECT COMPARISON · TERM ${ti + 1} · MARKS vs TASKS`}
                  </span>
                  <span className="blwrap">
                    <span className="bl"><i /></span>MARKS
                    <span className="bl b"><i /></span>TASKS
                  </span>
                </div>
                <div className="cbody"><GroupedBars items={barItems} height={120} /></div>
              </div>
            </div>

            {isAll && (
            <div className="rep-trio">
              <RepStat
                label="OVERALL (ALL TERMS)"
                chips={marksTerms.map((v, i) => [`T${i + 1}`, `${v}%`])}
                all={rep.derived.overall}
                C={C}
              />
              <RepStat
                label="MARKS (ALL TERMS)"
                chips={perTerm.map((p, i) => [`T${i + 1}`, `${p.m}%`])}
                all={rep.derived.marks}
                C={C}
              />
              <RepStat
                label="TASK COMPLETION (ALL TERMS)"
                chips={perTerm.map((p, i) => [`T${i + 1}`, `${p.t}%`])}
                all={rep.derived.tasks}
                C={C}
              />
            </div>
            )}

            <div className="rep-sub">
              <h3>Subject Level</h3>
              <span>{isAll ? 'MARKS & TASK COMPLETION · RANKED BY MARKS' : `TERM ${ti + 1} · RANKED BY TERM MARKS`}</span>
              <i />
            </div>
            <div className="subject-grid">
              {rep.subjects.map((x) => (isAll ? (
                <div className="card s-card" key={x.name}>
                  <div className="s-head">
                    <span className="s-name">{String(x.name).toUpperCase()}</span>
                    <span className={`rank-pill${rankOf(x.name) === 1 ? ' top' : ''}`}>
                      #{rankOf(x.name)}<span className="of30">/{rep.subjects.length}</span>
                    </span>
                  </div>
                  <div className="rep-rows">
                    <div className="rep-row">
                      <span className="rl">MARKS</span>
                      <div className="chips">
                        {TERM_KEYS.map((t) => (
                          <div className="chip" key={t}>
                            <span className="t">{t.toUpperCase()}</span>
                            <span className="n" style={{ color: C }}>{pct(x.marks?.[t])}</span>
                          </div>
                        ))}
                      </div>
                      <span className="avg-wrap">
                        <span className="avg-label">AVG</span>
                        <Donut value={x.marksAvg} variant="d-xs" />
                      </span>
                    </div>
                    <div className="rep-row">
                      <span className="rl">TASKS</span>
                      <div className="chips">
                        <div className="chip">
                          <span className="t">ALL</span>
                          <span className="n" style={{ color: C }}>{pct(x.tasksAvg)}</span>
                        </div>
                      </div>
                      <span className="avg-wrap">
                        <span className="avg-label">AVG</span>
                        <Donut value={x.tasksAvg} variant="d-xs" />
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card s-card" key={x.name}>
                  <div className="s-head">
                    <span className="s-name">{String(x.name).toUpperCase()}</span>
                    <span className={`rank-pill${termRank[x.name] === 1 ? ' top' : ''}`}>
                      #{termRank[x.name]}<span className="of30">/{rep.subjects.length}</span>
                    </span>
                  </div>
                  <div className="s-body">
                    <div className="chips">
                      <div className="chip"><span className="t">MARK</span><span className="n" style={{ color: C }}>{pct(x.marks?.[tKey])}</span></div>
                      <div className="chip"><span className="t">TASKS</span><span className="n" style={{ color: C }}>{pct(x.tasksAvg)}</span></div>
                    </div>
                    <div className="avg-wrap">
                      <span className="avg-label">MARK</span>
                      <Donut value={pct(x.marks?.[tKey])} variant="d-md" />
                    </div>
                  </div>
                </div>
              )))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
