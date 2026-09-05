import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Award, TrendingUp, ChevronRight, Trophy } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { Toast, Modal } from '../../components/ui.jsx';

const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function ChairpersonRankings() {
  const [rankings, setRankings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [schoolInspect, setSchoolInspect] = useState(null);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    api.get('/chairperson/rankings').then(r => setRankings(r.data)).catch(e => { console.error(e); showToast('Failed','error'); }).finally(()=>setLoading(false));
  }, []);

  const inspectSchool = async (id) => {
    try { const r = await api.get(`/chairperson/schools/${id}/inspect`); setSchoolInspect(r.data); }
    catch { showToast('Failed','error'); }
  };

  if (loading) return <SkeletonPage eyebrowW={96} titleW={230} subW={380} stats={2} charts={0} rows={7} />;
  if (!rankings) return <Page><div className="empty-state-pro"><h3>No data</h3><p>Seed data first.</p></div></Page>;

  const byAvg = rankings.by_average || [];
  const byAtt = rankings.by_attendance || [];

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="page-header-pro">
        <div className="breadcrumb"><a href="/chairperson/dashboard">Dashboard</a> / Rankings</div>
        <h2>School Rankings</h2>
        <p>Compare all schools by performance and attendance metrics</p>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}} className="two-col-charts">
        <div className="chart-card-premium">
          <div className="chart-header-premium"><div className="chart-title-premium"><Trophy size={18} /> By Academic Average</div></div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {byAvg.map((s, i) => (
              <motion.div key={s.school_id || i} className="ranking-row" onClick={()=>inspectSchool(s.school_id)} whileHover={{x:3}} style={{cursor:'pointer'}} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
                <span className="rank-num" style={{color: i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#d97706':'var(--text-muted)'}}>{i+1}</span>
                <span className="rank-name" style={{fontWeight:600,fontSize:13,flex:1}}>{s.name}</span>
                <span className="rank-pct" style={{fontSize:14,fontWeight:700,color:gradeColor(s.average_pct||0)}}>{fmt(s.average_pct,1)}%</span>
                <ChevronRight size={14} color="var(--text-muted)" />
              </motion.div>
            ))}
          </div>
        </div>

        <div className="chart-card-premium">
          <div className="chart-header-premium"><div className="chart-title-premium"><TrendingUp size={18} /> By Attendance</div></div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {byAtt.map((s, i) => (
              <motion.div key={s.school_id || i} className="ranking-row" onClick={()=>inspectSchool(s.school_id)} whileHover={{x:3}} style={{cursor:'pointer'}} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
                <span className="rank-num" style={{color: i===0?'#10b981':i===1?'#94a3b8':i===2?'#0d9488':'var(--text-muted)'}}>{i+1}</span>
                <span className="rank-name" style={{fontWeight:600,fontSize:13,flex:1}}>{s.name}</span>
                <span className="rank-pct" style={{fontSize:14,fontWeight:700,color:s.attendance_rate>=70?'#10b981':s.attendance_rate>=50?'#f59e0b':'#ef4444'}}>{fmt(s.attendance_rate,1)}%</span>
                <ChevronRight size={14} color="var(--text-muted)" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      <Modal open={!!schoolInspect} onClose={()=>setSchoolInspect(null)} title={schoolInspect?`${schoolInspect.school?.name||schoolInspect.name} — Inspection`:''} wide>
        {schoolInspect && <SchoolInspectView data={schoolInspect} />}
      </Modal>
    </Page>
  );
}

function SchoolInspectView({ data }) {
  const grades = data.grades || [];
  const subjects = data.subjects || [];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,marginBottom:16}}>
        <div className="kpi-tile"><div className="kpi-tile-label">Students</div><div className="kpi-tile-value">{data.total_students||data.students||'—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Classes</div><div className="kpi-tile-value">{data.total_classes||data.classes||'—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Average</div><div className="kpi-tile-value" style={{color:gradeColor(data.school_average||data.average||0)}}>{fmt(data.school_average||data.average,1)}%</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">At-Risk</div><div className="kpi-tile-value">{data.at_risk_count ?? '—'}</div></div>
      </div>
      {grades.length > 0 && (
        <>
          <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Grade breakdown</h4>
          <div className="table-premium" style={{marginBottom:16}}>
            <table>
              <thead><tr><th>Grade</th><th style={{textAlign:'center'}}>Classes</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Average</th></tr></thead>
              <tbody>{grades.map((g,i)=><tr key={i}><td style={{fontWeight:700}}>Grade {g.grade}</td><td style={{textAlign:'center'}}>{g.classes ?? '—'}</td><td style={{textAlign:'center'}}>{g.students ?? '—'}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(g.average)}}>{fmt(g.average,1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {subjects.length > 0 && (
        <>
          <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Subject performance</h4>
          <div className="table-premium">
            <table>
              <thead><tr><th>Subject</th><th style={{textAlign:'center'}}>Average</th><th style={{textAlign:'center'}}>Pass Rate</th></tr></thead>
              <tbody>{subjects.map((s,i)=><tr key={i}><td style={{fontWeight:600}}>{s.name}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.average)}}>{fmt(s.average,1)}%</td><td style={{textAlign:'center'}}>{fmt(s.pass_rate,1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
