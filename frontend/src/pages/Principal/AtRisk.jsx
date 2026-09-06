import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, Download, Target, Users } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { Toast, Modal } from '../../components/ui.jsx';

const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function PrincipalAtRisk() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [profile, setProfile] = useState(null);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    api.get('/principal/at-risk').then(r => setStudents(r.data)).catch(e => { console.error(e); showToast('Failed','error'); }).finally(()=>setLoading(false));
  }, []);

  const viewStudent = async (id) => {
    try { const r = await api.get(`/principal/students/${id}/profile`); setProfile(r.data); }
    catch { showToast('Failed','error'); }
  };

  // categorize
  const critical = students.filter(s => s.average < 40);
  const moderate = students.filter(s => s.average >= 40 && s.average < 50);
  const attendanceRisk = students.filter(s => s.attendance_rate < 60 && s.average >= 50);

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / At-Risk Center</div>
          <h1>At-Risk Intervention Center</h1>
          <div className="subtitle">{students.length} students need attention — prioritize by severity below</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:24}} className="two-col-charts">
        <motion.div className="card fx-risk-card" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.1}}>
          <div className="chart-title-premium" style={{marginBottom:10}}><AlertTriangle size={16} color="#ef4444" /> <span className="kpi-tile-label">Critical</span></div>
          <div className="fx-risk-num" style={{color:'#ef4444'}}>{critical.length}</div>
          <div className="stat-label">Below 40% average</div>
          <p className="fx-risk-note">Immediate intervention required. Schedule parent meetings this week.</p>
        </motion.div>
        <motion.div className="card fx-risk-card" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.15}}>
          <div className="chart-title-premium" style={{marginBottom:10}}><Target size={16} color="#b45f04" /> <span className="kpi-tile-label">Moderate</span></div>
          <div className="fx-risk-num" style={{color:'#b45f04'}}>{moderate.length}</div>
          <div className="stat-label">40-50% average</div>
          <p className="fx-risk-note">Monitor closely. Provide extra support and tutoring.</p>
        </motion.div>
        <motion.div className="card fx-risk-card" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.2}}>
          <div className="chart-title-premium" style={{marginBottom:10}}><Users size={16} color="#8b5cf6" /> <span className="kpi-tile-label">Attendance Risk</span></div>
          <div className="fx-risk-num" style={{color:'#8b5cf6'}}>{attendanceRisk.length}</div>
          <div className="stat-label">Below 60% attendance</div>
          <p className="fx-risk-note">Performing academically but missing school. Investigate absences.</p>
        </motion.div>
      </div>

      <div className="chart-card-premium">
        <div className="chart-header-premium">
          <div className="chart-title-premium"><AlertTriangle size={18} /> All At-Risk Students</div>
          <span className="chart-annotation">{students.length} total</span>
        </div>
        <div className="table-premium">
          <table>
            <thead>
              <tr><th>Student</th><th>Class</th><th style={{textAlign:'center'}}>Average</th><th style={{textAlign:'center'}}>Attendance</th><th>Weak Subject</th><th style={{textAlign:'center'}}>Severity</th><th style={{width:40}}></th></tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const sev = s.average < 40 ? {label:'Critical',color:'#ef4444',bg:'rgba(220,38,38,.14)'} : s.average < 50 ? {label:'Moderate',color:'#b45f04',bg:'rgba(180,95,4,.16)'} : {label:'Attendance',color:'#8b5cf6',bg:'rgba(139,92,246,.14)'};
                return (
                  <motion.tr key={s.student_id||i} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.02}} onClick={()=>viewStudent(s.student_id)}>
                    <td style={{fontWeight:600}}>{s.name}</td>
                    <td style={{fontSize:13}}>{s.class_label || s.label}</td>
                    <td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.average)}}>{fmt(s.average,1)}%</td>
                    <td style={{textAlign:'center',color:s.attendance_rate<60?'#ef4444':'var(--body-text)'}}>{fmt(s.attendance_rate,0)}%</td>
                    <td style={{fontSize:13,color:'var(--body-text)'}}>{s.weakest_subject?.name || '—'}</td>
                    <td style={{textAlign:'center'}}><span className="pill-tag" style={{background:sev.bg,color:sev.color}}>{sev.label}</span></td>
                    <td><ChevronRight size={14} color="var(--text-muted)" /></td>
                  </motion.tr>
                );
              })}
              {!loading && !students.length && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '44px 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <span className="pill-tag" style={{ background: 'rgba(14,159,110,.14)', color: '#0e9f6e', fontWeight: 800, letterSpacing: '.06em' }}>ALL CLEAR</span>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>No students need attention right now</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 420 }}>
                        Nobody is below the 50% average or 60% attendance thresholds. The list fills in automatically as soon as a student needs support.
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,marginBottom:16}}>
        <div className="kpi-tile"><div className="kpi-tile-label">Average</div><div className="kpi-tile-value" style={{color:gradeColor(data.average||0)}}>{fmt(data.average,1)}%</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Rank in Class</div><div className="kpi-tile-value">#{data.rank_in_class ?? '—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Rank in Grade</div><div className="kpi-tile-value">#{data.rank_in_grade ?? '—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Attendance</div><div className="kpi-tile-value">{fmt(data.attendance_rate,1)}%</div></div>
      </div>
      <p style={{fontSize:13,color:'var(--body-text)',marginBottom:16}}>
        {data.class_label} · Strongest: <strong>{data.strongest_subject?.name || '—'}</strong> ({fmt(data.strongest_subject?.average,1)}%) · Weakest: <strong>{data.weakest_subject?.name || '—'}</strong> ({fmt(data.weakest_subject?.average,1)}%)
      </p>
      {grid.length > 0 && (
        <div className="table-premium">
          <table>
            <thead><tr><th>Subject</th><th>Exam</th><th style={{textAlign:'center'}}>%</th><th style={{textAlign:'center'}}>Subject Avg</th></tr></thead>
            <tbody>
              {grid.flatMap((sub, si) => (sub.scores||[]).map((sc, j) => (
                <tr key={`${si}-${j}`}>
                  {j === 0 ? <td rowSpan={(sub.scores||[]).length} style={{fontWeight:600,verticalAlign:'top'}}>{sub.name}</td> : null}
                  <td style={{fontSize:12}}>{sc.exam_name}</td>
                  <td style={{textAlign:'center',fontWeight:700,color:gradeColor(sc.percentage||0)}}>{fmt(sc.percentage,1)}%</td>
                  {j === 0 ? <td rowSpan={(sub.scores||[]).length} style={{textAlign:'center',fontWeight:700,verticalAlign:'top',color:gradeColor(sub.average||0)}}>{fmt(sub.average,1)}%</td> : null}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
