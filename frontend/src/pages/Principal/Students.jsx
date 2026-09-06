import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, ChevronRight, AlertTriangle, Filter, Users, Download } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { Toast, Modal } from '../../components/ui.jsx';

const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function PrincipalStudents() {
  const [students, setStudents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [sortBy, setSortBy] = useState('average');
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState(null);
  const [profile, setProfile] = useState(null);
  const limit = 25;

  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset: page * limit, sort: sortBy, order: 'desc' });
      if (search) params.set('search', search);
      if (gradeFilter) params.set('grade', gradeFilter);
      const r = await api.get(`/principal/students?${params}`);
      setStudents(r.data.students);
      setTotal(r.data.total);
    } catch (e) { console.error(e); showToast('Failed to load students', 'error'); }
    setLoading(false);
  }, [page, sortBy, search, gradeFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, gradeFilter, sortBy]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      /* pull the whole filtered set in pages of 200 (backend cap) */
      const PAGE = 200;
      const base = new URLSearchParams({ limit: PAGE, offset: 0, sort: sortBy, order: 'desc' });
      if (search) base.set('search', search);
      if (gradeFilter) base.set('grade', gradeFilter);
      const rows = [];
      let totalCount = 0;
      for (let offset = 0; offset === 0 || offset < totalCount; offset += PAGE) {
        base.set('offset', String(offset));
        const r = await api.get(`/principal/students?${base}`);
        totalCount = r.data.total ?? 0;
        rows.push(...(r.data.students || []));
        if (offset >= 9 * PAGE) break; /* hard cap: 10 pages / 2 000 rows */
      }
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = 'Rank,Name,Class,Average %,Attendance %,Trend\n';
      const body = rows.map((s) => [
        s.rank_in_school ?? s.rank ?? '', s.name, s.class_name ?? s.class_label ?? '',
        s.avg ?? s.average ?? '', s.attendance_pct ?? s.attendance_rate ?? '', s.trend ?? '',
      ].map(esc).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `students-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${rows.length} students to CSV`);
    } catch (e) { console.error(e); showToast('Export failed', 'error'); }
    setExporting(false);
  };

  const viewStudent = async (id) => {
    try { const r = await api.get(`/principal/students/${id}/profile`); setProfile(r.data); }
    catch { showToast('Failed to load profile', 'error'); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / Students Explorer</div>
          <h1>Students Explorer</h1>
          <div className="subtitle">Search, filter, and inspect every student in the school — {total} total</div>
        </div>
      </div>

      <div className="filter-bar-premium">
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" style={{ paddingLeft: 38 }} placeholder="Search by name…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <select className="input" value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}>
          <option value="">All grades</option>
          {[1,2,3,4,5,6,7,8,9,10].map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <select className="input" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="average">Sort: Average (high to low)</option>
          <option value="name">Sort: Name (A to Z)</option>
        </select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={exporting} title="Export the full filtered list to CSV">
          <Download size={15} strokeWidth={2.2} />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <div className="table-premium">
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Student</th>
              <th>Class</th>
              <th style={{ textAlign: 'center' }}>Roll</th>
              <th style={{ textAlign: 'center' }}>Average</th>
              <th style={{ textAlign: 'center' }}>Attendance</th>
              <th style={{ textAlign: 'center' }}>Status</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => (
              <motion.tr key={s.student_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }} onClick={()=>viewStudent(s.student_id)}>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{page * limit + i + 1}</td>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td style={{ fontSize: 13 }}>{s.class_label}</td>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{s.roll_no || '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: gradeColor(s.average) }}>{fmt(s.average, 1)}%</td>
                <td style={{ textAlign: 'center' }}>{fmt(s.attendance_rate, 0)}%</td>
                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                  {s.at_risk ? (
                    <span className="pill-tag" style={{ background: 'rgba(220,38,38,.14)', color: '#ef4444' }}>
                      <AlertTriangle size={10} style={{ marginRight: 3 }} /> At Risk
                    </span>
                  ) : (
                    <span className="pill-tag" style={{ background: 'rgba(16,185,129,.14)', color: '#0b7a5c' }}>On Track</span>
                  )}
                </td>
                <td><ChevronRight size={14} color="var(--text-muted)" /></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" disabled={page === 0} onClick={()=>setPage(p=>p-1)}>Previous</button>
          <span style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
          <button className="btn btn-secondary" disabled={page >= totalPages - 1} onClick={()=>setPage(p=>p+1)}>Next</button>
        </div>
      )}

      <Modal open={!!profile} onClose={()=>setProfile(null)} title={profile ? `${profile.name} — Student Profile` : ''} wide>
        {profile && <StudentProfileView data={profile} />}
      </Modal>
    </Page>
  );
}

function StudentProfileView({ data }) {
  const grid = data.subject_exam_grid || [];
  const trend = data.improvement_trend || {};
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div className="kpi-tile"><div className="kpi-tile-label">Average</div><div className="kpi-tile-value" style={{ color: gradeColor(data.average || 0) }}>{fmt(data.average, 1)}%</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Rank in Class</div><div className="kpi-tile-value">#{data.rank_in_class ?? '—'}<span style={{fontSize:12,color:'var(--text-muted)'}}>/{data.class_size}</span></div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Rank in Grade</div><div className="kpi-tile-value">#{data.rank_in_grade ?? '—'}<span style={{fontSize:12,color:'var(--text-muted)'}}>/{data.grade_size}</span></div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Attendance</div><div className="kpi-tile-value">{fmt(data.attendance_rate, 1)}%</div></div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        {data.class_label} · Roll <strong>{data.roll_no || '—'}</strong> · Strongest: <strong>{data.strongest_subject?.name || '—'}</strong> ({fmt(data.strongest_subject?.average,1)}%) · Weakest: <strong>{data.weakest_subject?.name || '—'}</strong> ({fmt(data.weakest_subject?.average,1)}%)
      </p>
      {trend.delta != null && (
        <div className="kpi-tile" style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <div className="kpi-tile-label" style={{ marginRight: 8 }}>Trend:</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: trend.delta > 0 ? '#10b981' : trend.delta < 0 ? '#ef4444' : '#8a92a8' }}>
            {fmt(trend.first_exam_average,1)}% → {fmt(trend.last_exam_average,1)}% ({trend.delta > 0 ? '+' : ''}{fmt(trend.delta,1)}%)
          </div>
        </div>
      )}
      {grid.length > 0 && (
        <div className="table-premium">
          <table>
            <thead><tr><th>Subject</th><th>Exam</th><th style={{textAlign:'center'}}>Max</th><th style={{textAlign:'center'}}>%</th><th style={{textAlign:'center'}}>Subject Avg</th></tr></thead>
            <tbody>
              {grid.flatMap((sub, si) => {
                const scores = sub.scores || [];
                return scores.map((sc, j) => (
                  <tr key={`${si}-${j}`}>
                    {j === 0 ? <td rowSpan={scores.length} style={{ fontWeight: 600, verticalAlign: 'top' }}>{sub.name}</td> : null}
                    <td style={{ fontSize: 12 }}>{sc.exam_name}</td>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{sc.max_score}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: gradeColor(sc.percentage || 0) }}>{fmt(sc.percentage, 1)}%</td>
                    {j === 0 ? <td rowSpan={scores.length} style={{ textAlign: 'center', fontWeight: 700, verticalAlign: 'top', color: gradeColor(sub.average || 0) }}>{fmt(sub.average, 1)}%</td> : null}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
