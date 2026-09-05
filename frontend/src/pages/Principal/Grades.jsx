import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BarChart3, ChevronRight, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { Toast, Modal } from '../../components/ui.jsx';

const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function PrincipalGrades() {
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [gradeInspect, setGradeInspect] = useState(null);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    api.get('/principal/trends').then(r => setTrends(r.data)).catch(e => { console.error(e); showToast('Failed to load','error'); }).finally(()=>setLoading(false));
  }, []);

  const inspectGrade = async (grade) => {
    try { const r = await api.get(`/principal/grades/${grade}/inspect`); setGradeInspect({...r.data, grade}); }
    catch { showToast('Failed','error'); }
  };

  if (loading) return <SkeletonPage eyebrowW={88} titleW={230} subW={370} stats={3} charts={1} rows={4} />;
  if (!trends) return <Page><div className="empty-state-pro"><h3>No data</h3><p>Seed data first.</p></div></Page>;

  const gradeData = (trends.by_grade || []).map(g => ({ grade: `G${g.grade}`, gradeNum: g.grade, avg: g.average, students: g.students }));

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / Grades</div>
          <h1>Grade Overview</h1>
          <div className="subtitle">Performance breakdown across all {gradeData.length} grades — click any bar to inspect</div>
        </div>
      </div>

      <div className="chart-card-premium">
        <div className="chart-header-premium">
          <div className="chart-title-premium"><BarChart3 size={18} /> Grade Performance Distribution</div>
          <span className="chart-annotation">Click to inspect</span>
        </div>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gradeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(143,146,171,0.28)" />
              <XAxis dataKey="grade" tick={{ fontSize: 12, fill: '#8f92ab' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#8f92ab' }} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surf)', fontSize: 13 }} />
              <Bar dataKey="avg" radius={[8, 8, 0, 0]} onClick={(d) => inspectGrade(d.gradeNum)} cursor="pointer">
                {gradeData.map((d, i) => <Cell key={i} fill={gradeColor(d.avg)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-premium">
        <table>
          <thead>
            <tr><th>Grade</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Average</th><th style={{textAlign:'center'}}>Status</th><th style={{width:40}}></th></tr>
          </thead>
          <tbody>
            {gradeData.map((g, i) => (
              <motion.tr key={i} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.04}} onClick={()=>inspectGrade(g.gradeNum)}>
                <td style={{ fontWeight: 700 }}>Grade {g.gradeNum}</td>
                <td style={{ textAlign: 'center' }}>{g.students}</td>
                <td style={{ textAlign: 'center', fontWeight: 700, color: gradeColor(g.avg) }}>{fmt(g.avg, 1)}%</td>
                <td style={{ textAlign: 'center' }}>
                  {g.avg >= 70 ? <span className="pill-tag" style={{background:'rgba(16,185,129,.14)',color:'#0b7a5c'}}>Strong</span> : g.avg >= 50 ? <span className="pill-tag" style={{background:'rgba(180,95,4,.16)',color:'#b45f04'}}>Average</span> : <span className="pill-tag" style={{background:'rgba(220,38,38,.14)',color:'#ef4444'}}>Needs Focus</span>}
                </td>
                <td><ChevronRight size={14} color="var(--text-muted)" /></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!gradeInspect} onClose={()=>setGradeInspect(null)} title={gradeInspect?`Grade ${gradeInspect.grade} — Inspection`:''} wide>
        {gradeInspect && <GradeInspectView data={gradeInspect} />}
      </Modal>
    </Page>
  );
}

function GradeInspectView({ data }) {
  const sections = data.sections || [];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
        <div className="kpi-tile"><div className="kpi-tile-label">Sections</div><div className="kpi-tile-value">{data.sections_count ?? sections.length}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Students</div><div className="kpi-tile-value">{data.total_students ?? '—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Grade Avg</div><div className="kpi-tile-value" style={{color:gradeColor(data.grade_average||0)}}>{fmt(data.grade_average,1)}%</div></div>
      </div>
      <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Sections</h4>
      <div className="table-premium">
        <table>
          <thead><tr><th>Section</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Avg</th><th style={{textAlign:'center'}}>Attendance</th><th style={{textAlign:'center'}}>At Risk</th><th>Top Student</th><th>Weakest Subject</th></tr></thead>
          <tbody>
            {sections.map((s,i) => (
              <tr key={i}>
                <td style={{fontWeight:700}}>{s.label || `Grade ${s.grade}-${s.section}`}</td>
                <td style={{textAlign:'center'}}>{s.students ?? '—'}</td>
                <td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.average||0)}}>{fmt(s.average,1)}%</td>
                <td style={{textAlign:'center'}}>{fmt(s.attendance_rate,1)}%</td>
                <td style={{textAlign:'center',fontWeight:700,color:(s.at_risk_count||0)>0?'#ef4444':'var(--text-muted)'}}>{s.at_risk_count ?? 0}</td>
                <td style={{fontSize:12}}>{s.top_student?.name || '—'} <span style={{color:'var(--text-muted)'}}>({fmt(s.top_student?.average,1)}%)</span></td>
                <td style={{fontSize:12}}>{s.weakest_subject?.name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
