/* Teacher report modal (v5 designer update) — band-themed faculty report
   fed by real /principal/teacher-report data. Mirrors the prototype's
   teacher report: identity strip, term averages, exam-trend line chart,
   class comparison double-bars (click to open class), trio stats,
   class grid and the ranked student cohort (hidden from PDF export).
   Reuses the .report kit so both report modals look identical.

   v16: term toggle (.rep-terms / .report.term-mode) — ALL TERM keeps the
   composite view; TERM 1/2/3 aggregates are computed CLIENT-SIDE (series
   points carry `term`, classes carry t1/t2/t3) and the card re-bands to the
   term average. Students cohort stays all-term (the payload has no
   per-term student scores). */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award, Bookmark, ClipboardCheck, Download, Printer, School, Trophy, UserCheck, Users, X,
} from 'lucide-react';
import { printCardEl, printStamp } from './printCard';
import { fetchTeacherReport } from './data';
import { BarChart, Donut, GroupedBars, LineChart, Trend } from './charts';
import { bandOf, initials, mean, pct } from './util';

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

/* fetcher: principal's report endpoint, or the CT console's self-report. */
export default function TeacherReportModal({ teacherId, onClose, onOpenClass, onBookmark, onOpenReport, totalClasses, fetcher }) {
  const [rep, setRep] = useState(null);
  const [err, setErr] = useState(false);
  const [kidQ, setKidQ] = useState('');
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
      setKidQ('');
      setTerm('all');
      if (teacherId == null) return;
      try {
        const r = await (fetcher || fetchTeacherReport)(teacherId);
        if (alive) setRep(r);
      } catch {
        if (alive) setErr(true);
      }
    };
    run();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetcher is a stable per-caller identity
  }, [teacherId]);

  useEffect(() => { closeRef.current?.focus(); }, [rep]);

  /* all hooks run unconditionally — the early return happens below */
  const classes = useMemo(() => rep?.classes || [], [rep]);
  const sortedByAvg = useMemo(
    () => [...classes].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1)),
    [classes],
  );
  const barItems = useMemo(
    () => classes
      .map((c) => ({
        key: c.id,
        label: c.name,
        tip: `Class ${c.name} · ${c.avg != null ? `${pct(c.avg)}%` : 'no marks yet'} subject avg · tasks ${pct(c.tasks_pct)}%${c.rank ? ` · overall rank #${c.rank}` : ''}`,
        a: c.avg != null ? pct(c.avg) : 0,
        b: pct(c.tasks_pct),
      }))
      .sort((x, y) => (y.a + y.b) - (x.a + x.b)),
    [classes],
  );

  const ql = kidQ.trim().toLowerCase();
  const kidRows = useMemo(() => {
    const list = rep?.students || [];
    if (!ql) return list;
    return list.filter((s) => s.name.toLowerCase().includes(ql) || s.class_name.toLowerCase().includes(ql));
  }, [rep, ql]);

  /* ---- v16 term mode: per-term aggregates computed CLIENT-SIDE ----------
     series points carry `term` (1/2/3); classes carry t1/t2/t3 columns. */
  const termAvgT = useMemo(() => {
    if (!rep || term === 'all') return null;
    const idx = Number(term); // 0 | 1 | 2
    const pts = (rep.series || [])
      .filter((p) => Number(p.term) === idx + 1)
      .map((p) => p.pct)
      .filter(Number.isFinite);
    if (pts.length) return Math.round(mean(pts));
    const vals = (rep.classes || [])
      .map((c) => c[TERM_KEYS[idx]])
      .filter(Number.isFinite);
    return vals.length ? Math.round(mean(vals)) : null;
  }, [rep, term]);

  const termBarItems = useMemo(() => {
    if (!rep || term === 'all') return [];
    const idx = Number(term);
    const k = TERM_KEYS[idx];
    return (rep.classes || [])
      .filter((c) => c[k] != null)
      .map((c) => ({
        key: c.id,
        label: c.name,
        tip: `Class ${c.name} · Term ${idx + 1}: ${pct(c[k])}% ${String(rep.teacher?.subject || '').toLowerCase()} avg · click to open`,
        val: pct(c[k]),
      }))
      .sort((a, b) => b.val - a.val);
  }, [rep, term]);

  if (teacherId == null) return null;

  const t = rep?.teacher;
  const isAll = term === 'all';
  const ti = isAll ? -1 : Number(term); // 0 | 1 | 2
  const tKey = isAll ? null : TERM_KEYS[ti];
  /* term band falls back to the all-term average when a term has no marks */
  const shownAvg = isAll ? t?.avg : (termAvgT ?? t?.avg ?? null);
  const g = shownAvg != null ? bandOf(pct(shownAvg)) : null;
  const C = g?.c;

  const best = sortedByAvg[0];
  const focus = sortedByAvg.length > 1 ? sortedByAvg[sortedByAvg.length - 1] : null;
  const termSorted = !isAll
    ? [...classes].filter((c) => c[tKey] != null).sort((a, b) => b[tKey] - a[tKey])
    : [];
  const termBest = termSorted.length ? termSorted[0] : null;
  const termFocus = termSorted.length ? termSorted[termSorted.length - 1] : null;

  const chipsOf = (c) => [
    ['T1', c?.t1 != null ? `${pct(c.t1)}%` : '—'],
    ['T2', c?.t2 != null ? `${pct(c.t2)}%` : '—'],
    ['T3', c?.t3 != null ? `${pct(c.t3)}%` : '—'],
  ];
  /* v16 term-mode chips: the term value + the (all-term) task completion */
  const chipTerm = (c) => [
    [`T${ti + 1}`, c?.[tKey] != null ? `${pct(c[tKey])}%` : '—'],
    ['TASK', c?.tasks_pct != null ? `${pct(c.tasks_pct)}%` : '—'],
  ];

  /* ---- PDF export (same pipeline as the report card, skips students) --- */
  const exportPdf = async () => {
    const card = cardRef.current;
    if (!card || pdfBusy) return;
    setPdfBusy(true);
    card.querySelectorAll('.donut .bar').forEach((b) => {
      if (b.dataset.off) b.style.strokeDashoffset = b.dataset.off;
    });
    card.querySelectorAll('.lreveal').forEach((r) => {
      r.style.transition = 'none';
      r.style.clipPath = 'inset(0 -2% 0 0)';
    });
    card.querySelectorAll('.vbar i, .vbar2 i, .scorepill .bar i').forEach((b) => {
      b.style.transition = 'none';
    });
    card.querySelectorAll('.ltip, .lxhair, .ldot').forEach((el) => el.classList.remove('on'));
    const skips = [...card.querySelectorAll('.pdf-skip')];
    skips.forEach((el) => { el.dataset.od = el.style.display; el.style.display = 'none'; });
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
      const nm = (t?.name || 'teacher').replace(/\s+/g, '-');
      pdf.save(`Teacher-Report-${nm}-${t?.subject || ''}${isAll ? '' : `-T${ti + 1}`}.pdf`);
    } catch (pdfErr) {
      card.classList.remove('force-light');
      console.warn(
        '[TeacherReport] PDF export failed — falling back to browser print.'
        + ' If the error mentions "Failed to resolve import", run `npm install` inside frontend/'
        + ' (html2canvas + jspdf must be installed).',
        pdfErr,
      );
      try { window.print(); } catch { /* print blocked */ }
    } finally {
      skips.forEach((el) => { el.style.display = el.dataset.od || ''; });
    }
    setPdfBusy(false);
  };

  const openClass = (id) => {
    onClose();
    onOpenClass(id);
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
          <div className="pd-note" style={{ padding: 60 }}>Building teacher report…</div>
        )}
        {err && !rep && (
          <div className="pd-note" style={{ padding: 60 }}>
            This report could not be loaded. The teacher may not have any class assignments yet.
            <div style={{ marginTop: 12 }}><button type="button" className="gtab" onClick={onClose}>CLOSE</button></div>
          </div>
        )}

        {rep && g && (
          <>
            <div className="rep-head">
              <div className="rep-id">
                <span className="avatar big" style={{ background: g.soft, color: C }}>{initials(t.name)}</span>
                <div>
                  <div className="eyebrow">
                    TEACHER REPORT · {String(t.subject || '').toUpperCase()}{t.is_hod ? ' · HEAD OF DEPARTMENT' : ''}
                  </div>
                  <h2>{t.name}</h2>
                </div>
              </div>
              <div className="rep-ranks">
                <span className="grade-pill" style={{ background: g.soft, color: C }}>
                  {isAll
                    ? (t.avg != null ? `${pct(t.avg)}% · ${g.label}` : 'NO MARKS YET')
                    : (termAvgT != null ? `TERM ${ti + 1} · ${termAvgT}% · ${g.label}` : `TERM ${ti + 1} · NO MARKS YET`)}
                </span>
                <div className="bigrank">
                  <span className="pill" style={{ background: C }}>
                    #{t.rank ?? '—'} / {t.of ?? '—'}
                  </span>
                  <span className="sub">FACULTY RANK</span>
                </div>
                <button type="button" className="btn-close" title="Download as PDF (skips students list)" disabled={pdfBusy} onClick={exportPdf}>
                  <Download strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="btn-close"
                  title="Print report"
                  disabled={printBusy || pdfBusy}
                  onClick={async () => {
                    if (printBusy || pdfBusy || !cardRef.current || !rep) return;
                    setPrintBusy(true);
                    await printCardEl(
                      cardRef.current,
                      `FACULTY REPORT · ${String(t.name || '—').toUpperCase()}`
                      + ` · ${String(t.subject || '—').toUpperCase()}`
                      + ` · ${isAll ? 'ALL TERM' : `TERM ${ti + 1}`}`
                      + ` · GENERATED ${printStamp()}`,
                    );
                    setPrintBusy(false);
                  }}
                >
                  <Printer strokeWidth={2} />
                </button>
                <button ref={closeRef} type="button" className="btn-close" title="Close report" disabled={pdfBusy || printBusy} onClick={onClose}>
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
                  <div className="label">TEACHING PERFORMANCE (ALL TERMS)</div>
                  <div className="op-stats">
                    <div
                      className="op-stat"
                      title={`Average ${t.subject} scores across the ${t.classes} classes taught`}
                    >
                      <div className="k">ALL TERM<br />AVERAGE</div>
                      <Donut value={t.avg ?? 0} variant="d-md" />
                    </div>
                    {['t1', 't2', 't3'].map((k, i) => (
                      <div className="op-stat" key={k}>
                        <div className="k">TERM {i + 1}<br />CLASS AVG</div>
                        <div className="v">{t[k] != null ? `${pct(t[k])}%` : '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card card-op">
                  <div className="label">TERM {ti + 1} PERFORMANCE</div>
                  <div className="op-stats">
                    <div
                      className="op-stat"
                      title={`Average ${t.subject} scores across the ${classes.length} classes taught in Term ${ti + 1}`}
                    >
                      <div className="k">TERM {ti + 1}<br />CLASS AVG</div>
                      <Donut value={termAvgT ?? 0} variant="d-md" />
                    </div>
                    <div className="op-stat">
                      <div className="k">TOP CLASS<br />TERM {ti + 1}</div>
                      <div className="v" style={{ fontSize: 12 }}>{termBest ? `${termBest.name} · ${pct(termBest[tKey])}%` : '—'}</div>
                    </div>
                    <div className="op-stat">
                      <div className="k">NEEDS FOCUS<br />TERM {ti + 1}</div>
                      <div className="v" style={{ fontSize: 12 }}>{termFocus ? `${termFocus.name} · ${pct(termFocus[tKey])}%` : '—'}</div>
                    </div>
                    <div className="op-stat">
                      <div className="k">CLASSES<br />TAUGHT</div>
                      <div className="v">{classes.length}</div>
                    </div>
                  </div>
                </div>
              )}
              <div className="card card-stats">
                <div className="stat-cell">
                  <div className="ic"><School strokeWidth={1.8} /></div>
                  <div><div className="k">CLASSES TAUGHT</div><div className="v">{t.classes}</div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><Users strokeWidth={1.8} /></div>
                  <div><div className="k">STUDENTS TAUGHT</div><div className="v">{t.students}</div></div>
                </div>
                <div className="stat-cell sep">
                  <div className="ic"><Trophy strokeWidth={1.8} /></div>
                  <div><div className="k">FACULTY RANK</div><div className="v">#{t.rank ?? '—'}<span className="of">/{t.of ?? '—'}</span></div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><ClipboardCheck strokeWidth={1.8} /></div>
                  <div><div className="k">TASK COMPLETION (AVG)</div><div className="v">{pct(t.tasks_avg)}%</div></div>
                </div>
                <div className="stat-cell">
                  <div className="ic"><Award strokeWidth={1.8} /></div>
                  <div><div className="k">BEST CLASS</div><div className="v" style={{ fontSize: 12 }}>{best ? best.name : '—'}</div></div>
                </div>
                <div className="stat-cell sep">
                  <div className="ic"><UserCheck strokeWidth={1.8} /></div>
                  <div><div className="k">ROLE</div><div className="v" style={{ fontSize: 12 }}>{rep.role}</div></div>
                </div>
              </div>
            </div>

            <div className="rep-charts">
              <div className="card chart-card">
                <div className="chead">
                  <span className="label">SUBJECT TREND · {String(t.subject || '').toUpperCase()} · {rep.series.length} EXAMS</span>
                </div>
                <div className="cbody">
                  {rep.series.length
                    ? <LineChart points={rep.series.map((p) => ({ date: p.label, pct: p.pct }))} rangeKey="3M" height={120} countLabel="EXAMS" trendLabel="SMOOTHED" />
                    : <div className="pd-note">No exam marks recorded for this subject yet.</div>}
                </div>
              </div>
              <div className="card chart-card">
                <div className="chead">
                  <span className="label">
                    {isAll
                      ? `CLASS COMPARISON · ${String(t.subject || '').toUpperCase()} vs TASKS · ${classes.length} CLASSES · CLICK TO OPEN`
                      : `CLASS COMPARISON · ${String(t.subject || '').toUpperCase()} · TERM ${ti + 1} · ${termBarItems.length} CLASSES · CLICK A BAR TO OPEN`}
                  </span>
                  {isAll && (
                    <span className="blwrap">
                      <span className="bl"><i /></span>SUBJECT AVG
                      <span className="bl b"><i /></span>TASKS
                    </span>
                  )}
                </div>
                <div className="cbody">
                  {isAll
                    ? <GroupedBars items={barItems} height={120} onClick={(i) => openClass(barItems[i].key)} />
                    : <BarChart items={termBarItems} height={120} onClick={(i) => openClass(termBarItems[i].key)} />}
                </div>
              </div>
            </div>

            {isAll && (
            <div className="rep-trio">
              <RepStat
                label="CLASS AVERAGE (TERMS)"
                chips={chipsOf(t)}
                all={t.avg ?? 0}
                C={C}
              />
              <RepStat
                label={`TOP CLASS · ${(best?.name || '—').toUpperCase()}`}
                chips={chipsOf(best)}
                all={best?.avg ?? 0}
                C={C}
              />
              <RepStat
                label={`NEEDS FOCUS · ${(focus?.name || '—').toUpperCase()}`}
                chips={chipsOf(focus)}
                all={focus?.avg ?? 0}
                C={C}
              />
            </div>
            )}

            <div className="rep-sub">
              <h3>Class Level</h3>
              <span>{isAll
                ? `${String(t.subject || '').toUpperCase()} · TERM SCORES + TASK COMPLETION · CLICK A CLASS TO OPEN`
                : `${String(t.subject || '').toUpperCase()} · TERM ${ti + 1} · CLICK A CLASS TO OPEN`}</span>
              <i />
            </div>
            <div className="subject-grid">
              {classes.map((c) => (
                <div
                  className="card s-card clickable"
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  title={`Open ${c.name} dashboard`}
                  onClick={() => openClass(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openClass(c.id); }}
                >
                  <div className="s-head">
                    <span className="s-name">{String(c.name).toUpperCase()}</span>
                    <span className="teach-pill" title={`Class Teacher · ${c.ct_name || '—'}`}>
                      <UserCheck strokeWidth={2} /><b>{c.ct_name || '—'}</b><em>CT</em>
                    </span>
                    <span className={`rank-pill${c.rank != null && c.rank <= 3 ? ' top' : ''}`}>
                      #{c.rank ?? '—'}{totalClasses ? <span className="of30">/{totalClasses}</span> : null}
                    </span>
                  </div>
                  <div className="s-body">
                    <div className="chips">
                      {(isAll ? [...chipsOf(c), ['TASK', `${pct(c.tasks_pct)}%`]] : chipTerm(c))
                        .map(([k2, v]) => <div className="chip" key={k2}><span className="t">{k2}</span><span className="n">{v}</span></div>)}
                    </div>
                    <div className="avg-wrap">
                      <span className="avg-label">{isAll ? 'AVG' : `T${ti + 1}`}</span>
                      <Donut value={isAll ? (c.avg ?? 0) : (c[tKey] != null ? pct(c[tKey]) : 0)} variant="d-xs" />
                      <Trend d={c.t3 != null && c.t2 != null ? c.t3 - c.t2 : 0} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pdf-skip">
              <div className="rep-sub">
                <h3>Students</h3>
                <span>{(rep.students || []).length} STUDENTS ACROSS {classes.length} CLASSES · RANKED BY {String(t.subject || '').toUpperCase()} SCORE</span>
                <i />
              </div>
              <div className="searchbar">
                <input
                  type="text"
                  value={kidQ}
                  placeholder={`Search students taught by ${t.name?.split(' ')[0] || 'this teacher'}…`}
                  autoComplete="off"
                  onChange={(e) => setKidQ(e.target.value)}
                />
                <span className="count">
                  {`${kidRows.length} ${ql ? `MATCH${kidRows.length === 1 ? '' : 'ES'}` : 'STUDENTS'}`}
                </span>
              </div>
              <div className="st-list-wrap">
                <div className="st-scroll">
                  <div className="st-head">
                    <span>RANK</span><span>STUDENT NAME</span><span>CLASS</span>
                    <span className="r">SUBJECT AVG</span><span>SAVE</span>
                  </div>
                  {kidRows.map((s) => (
                    <div
                      className="srow"
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      title="Open report card"
                      onClick={() => { onClose(); onOpenReport(s); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { onClose(); onOpenReport(s); } }}
                    >
                      <span className={`rankbadge${s.rank != null && s.rank <= 3 ? ' top' : ''}`}>#{s.rank ?? '—'}</span>
                      <span className="st-name">
                        <span className="avatar">{initials(s.name)}</span>
                        <span className="nm">{s.name}</span>
                      </span>
                      <span className="classchip">{s.class_name}</span>
                      <span className="scorepill">
                        <span className="bar"><i data-w={pct(s.score)} style={{ width: s.score != null ? `${Math.min(100, pct(s.score))}%` : 0 }} /></span>
                        <span className="pc">{s.score != null ? `${pct(s.score)}%` : '—'}</span>
                      </span>
                      <button
                        type="button"
                        className="bm"
                        title="Save to folder"
                        aria-label={`Save ${s.name} to folder`}
                        onClick={(e) => { e.stopPropagation(); onBookmark(e, s); }}
                      >
                        <Bookmark strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                  {!kidRows.length && <div className="noresult">No students match your search.</div>}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
