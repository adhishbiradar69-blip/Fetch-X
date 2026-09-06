import { useRef, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, SearchX, Library, BarChart3, Check, Calendar } from 'lucide-react';
import api from '../../api/client';
import { Page, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { CountUp } from '../../components/ui.jsx';

export default function ParentChildView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
  const reportRef = useRef(null);

  useEffect(() => {
    api.get('/parent/child').then(r => setData(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <SkeletonPage eyebrowW={80} titleW={200} subW={320} stats={3} charts={1} rows={4} />;
  if (!data) return (
    <Page>
      <div className="card" style={{ padding: 60, textAlign: 'center' }}>
        <SearchX size={48} color="var(--muted)" style={{ marginBottom: 16 }} />
        <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Child Linked</h3>
        <p style={{ color: 'var(--body-text)' }}>Contact the administrator to link your child to this account.</p>
      </div>
    </Page>
  );

  const child = data.student;
  const cls = data.class;
  const avg = data.average_percentage || 0;

  /* A4 report download — captures the page content force-light and slices
     it across PDF pages (same proven pattern as the principal report card) */
  const downloadPdf = async () => {
    const card = reportRef.current;
    if (!card || pdfBusy) return;
    setPdfBusy(true);
    try { await document.fonts.ready; } catch { /* font API unavailable */ }
    await new Promise((r) => setTimeout(r, 350));
    try {
      const [hc, jp] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await hc.default(card, {
        scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, imageTimeout: 0,
      });
      card.classList.remove('force-light');
      const { jsPDF } = jp;
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
        ctx.fillRect(0, 0, sl.width, sh);
        ctx.drawImage(canvas, 0, y, canvas.width, sh, 0, 0, canvas.width, sh);
        if (!first) pdf.addPage();
        first = false;
        pdf.addImage(sl.toDataURL('image/jpeg', 0.92), 'JPEG', 5, 5, iw, (sh * iw) / canvas.width);
        y += sh;
      }
      const nm = String(child.name || 'child').replace(/\s+/g, '-');
      pdf.save(`Report-${nm}-${cls?.label || ''}.pdf`);
    } catch (pdfErr) {
      card.classList.remove('force-light');
      console.warn(
        '[ChildReport] PDF export failed — falling back to browser print.'
        + ' If the error mentions "Failed to resolve import", run `npm install` inside frontend/'
        + ' (html2canvas + jspdf must be installed).',
        pdfErr,
      );
      try { window.print(); } catch { /* print blocked */ }
    }
    setPdfBusy(false);
  };

  return (
    <Page>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Parent Portal</div>
          <h1>My Child</h1>
          <div className="subtitle">Performance overview for {child.name}{cls ? ` · ${cls.label}` : ''}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={downloadPdf}
          disabled={pdfBusy}
          title="Download a PDF copy of this report"
        >
          <Download size={15} strokeWidth={2.2} />
          {pdfBusy ? 'Building PDF…' : 'Download Report (PDF)'}
        </button>
      </div>

      <div ref={reportRef}>

      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 6 }}>
        <div className="card-stats cols-4">
          {[
            { v: data.marks.length, l: 'Exams recorded', Icon: Library, accent: 'a-indigo' },
            { v: avg, l: 'Average score', Icon: BarChart3, accent: 'a-teal', suffix: '%' },
            { v: data.attendance.rate, l: 'Attendance', Icon: Check, accent: 'a-amber', suffix: '%' },
            { v: data.attendance.present, l: 'Days present', Icon: Calendar, accent: 'a-pink' },
          ].map((s, i) => {
            const SIcon = s.Icon;
            return (
              <motion.div key={i} variants={staggerItem} className={`stat-cell ${s.accent}`}>
                <div className="ic"><SIcon size={15} strokeWidth={2.2} /></div>
                <div>
                  <div className="k">{s.l}</div>
                  <div className="v"><CountUp value={s.v} decimals={s.v % 1 ? 1 : 0} />{s.suffix && <span className="of">{s.suffix}</span>}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, marginBottom: 18 }}>Marks Breakdown</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Exam</th>
                <th>Subject</th>
                <th style={{ textAlign: 'center' }}>Score</th>
                <th style={{ textAlign: 'center' }}>Max</th>
                <th style={{ textAlign: 'center' }}>Percentage</th>
              </tr>
            </thead>
            <tbody>
              {data.marks.map((m, i) => {
                const pct = m.percentage;
                const gradeCls = pct >= 80 ? 'pill-grade-a' : pct >= 60 ? 'pill-grade-b' : 'pill-grade-d';
                return (
                  <motion.tr key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <td style={{ fontWeight: 600 }}>{m.exam}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.subject_color }} />
                        {m.subject}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{m.score}</td>
                    <td style={{ textAlign: 'center', color: 'var(--muted)' }}>{m.max}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`pill ${gradeCls}`} style={{ minWidth: 52 }}>{pct}%</span>
                    </td>
                  </motion.tr>
                );
              })}
              {!data.marks.length && (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No marks recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </Page>
  );
}
