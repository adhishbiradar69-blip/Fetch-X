import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { BookOpen, ChevronRight, Target, TrendingUp } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { Toast, Modal } from '../../components/ui.jsx';

const COLORS = ['#4f7df3', '#34bfa1', '#f0a04b', '#8b5cf6', '#e85d75', '#0ea5e9', '#fbbf24', '#10b981'];
const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function PrincipalSubjects() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [deepDive, setDeepDive] = useState(null);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    api.get('/principal/subjects/breakdown').then(r => setSubjects(r.data)).catch(e => { console.error(e); showToast('Failed','error'); }).finally(()=>setLoading(false));
  }, []);

  const viewSubject = async (id) => {
    try { const r = await api.get(`/principal/subjects/${id}/deep-dive`); setDeepDive(r.data); }
    catch { showToast('Failed','error'); }
  };

  if (loading) return <Page><div className="skeleton-card" style={{padding:80,textAlign:'center',color:'var(--text-muted)'}}>Loading subjects…</div></Page>;

  const subjectData = subjects.map((s, i) => ({ name: s.name, avg: Math.round(s.average), pass: Math.round(s.pass_rate), color: s.color || COLORS[i % COLORS.length], id: s.id }));

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / Subjects</div>
          <h1>Subject Analytics</h1>
          <div className="subtitle">Performance across all {subjects.length} subjects — click any subject for a deep dive</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,marginBottom:24}} className="two-col-charts">
        <div className="chart-card-premium">
          <div className="chart-header-premium"><div className="chart-title-premium"><Target size={18} /> Subject Averages</div></div>
          <div style={{width:'100%',height:280}}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subjectData} margin={{top:10,right:10,left:-20,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(143,146,171,0.28)" />
                <XAxis dataKey="name" tick={{fontSize:11,fill:'#8f92ab'}} />
                <YAxis domain={[0,100]} tick={{fontSize:12,fill:'#8f92ab'}} />
                <Tooltip contentStyle={{borderRadius:12,border:'1px solid var(--line)',background:'var(--surf)',fontSize:13}} />
                <Bar dataKey="avg" radius={[8,8,0,0]} onClick={(d)=>viewSubject(d.id)} cursor="pointer">
                  {subjectData.map((d,i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="chart-card-premium">
          <div className="chart-header-premium"><div className="chart-title-premium"><TrendingUp size={18} /> Subject Radar</div></div>
          <div style={{width:'100%',height:280}}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={subjectData.map(s => ({subject:s.name, avg:s.avg}))}>
                <PolarGrid stroke="rgba(143,146,171,0.35)" />
                <PolarAngleAxis dataKey="subject" tick={{fontSize:10,fill:'#8f92ab'}} />
                <PolarRadiusAxis domain={[0,100]} tick={{fontSize:10,fill:'#8f92ab'}} />
                <Radar dataKey="avg" stroke="#5b4fe9" fill="#5b4fe9" fillOpacity={0.3} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="table-premium">
        <table>
          <thead>
            <tr><th>Subject</th><th style={{textAlign:'center'}}>School Average</th><th style={{textAlign:'center'}}>Pass Rate</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Status</th><th style={{width:40}}></th></tr>
          </thead>
          <tbody>
            {subjectData.map((s, i) => (
              <motion.tr key={s.id || i} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.04}} onClick={()=>viewSubject(s.id)}>
                <td style={{fontWeight:600}}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                    <span style={{width:10,height:10,borderRadius:'50%',background:s.color}} />
                    {s.name}
                  </span>
                </td>
                <td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.avg)}}>{s.avg}%</td>
                <td style={{textAlign:'center'}}>{s.pass}%</td>
                <td style={{textAlign:'center',color:'var(--muted)'}}>—</td>
                <td style={{textAlign:'center'}}>{s.avg >= 70 ? <span className="pill-tag" style={{background:'rgba(16,185,129,.14)',color:'#0b7a5c'}}>Strong</span> : s.avg >= 50 ? <span className="pill-tag" style={{background:'rgba(180,95,4,.16)',color:'#b45f04'}}>Average</span> : <span className="pill-tag" style={{background:'rgba(220,38,38,.14)',color:'#ef4444'}}>Weak</span>}</td>
                <td><ChevronRight size={14} color="var(--text-muted)" /></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!deepDive} onClose={()=>setDeepDive(null)} title={deepDive?`${deepDive.subject.name} — Deep Dive`:''} wide>
        {deepDive && <SubjectDeepDiveView data={deepDive} />}
      </Modal>
    </Page>
  );
}

function SubjectDeepDiveView({ data }) {
  const grades = data.grade_breakdown || [];
  const classes = data.class_breakdown || [];
  const top = data.top_students || [];
  const bottom = data.bottom_students || [];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div className="kpi-tile"><div className="kpi-tile-label">School Average</div><div className="kpi-tile-value" style={{color:gradeColor(data.school_average||0)}}>{fmt(data.school_average,1)}%</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Grades</div><div className="kpi-tile-value">{grades.length}</div></div>
      </div>
      <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Grade-wise performance</h4>
      <div className="table-premium" style={{marginBottom:16}}>
        <table>
          <thead><tr><th>Grade</th><th style={{textAlign:'center'}}>Classes</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Average</th></tr></thead>
          <tbody>
            {grades.map((g,i) => <tr key={i}><td style={{fontWeight:700}}>Grade {g.grade}</td><td style={{textAlign:'center'}}>{g.classes}</td><td style={{textAlign:'center'}}>{g.students}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(g.average)}}>{fmt(g.average,1)}%</td></tr>)}
          </tbody>
        </table>
      </div>
      <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Class breakdown (sorted by average)</h4>
      <div className="table-premium" style={{marginBottom:16}}>
        <table>
          <thead><tr><th>Class</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Average</th></tr></thead>
          <tbody>
            {classes.map((c,i) => <tr key={i}><td style={{fontWeight:600}}>{c.label}</td><td style={{textAlign:'center'}}>{c.student_count}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(c.average)}}>{fmt(c.average,1)}%</td></tr>)}
          </tbody>
        </table>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <div>
          <h4 style={{margin:'0 0 8px',fontSize:14,fontWeight:700,color:'#10b981'}}>Top performers</h4>
          <div className="table-premium">
            <table><thead><tr><th>Student</th><th>Class</th><th style={{textAlign:'center'}}>Avg</th></tr></thead>
              <tbody>{top.map((s,i)=><tr key={i}><td style={{fontWeight:600}}>{s.name}</td><td style={{fontSize:12}}>{s.class_label}</td><td style={{textAlign:'center',fontWeight:700,color:'#10b981'}}>{fmt(s.average,1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div>
          <h4 style={{margin:'0 0 8px',fontSize:14,fontWeight:700,color:'#ef4444'}}>Needs support</h4>
          <div className="table-premium">
            <table><thead><tr><th>Student</th><th>Class</th><th style={{textAlign:'center'}}>Avg</th></tr></thead>
              <tbody>{bottom.map((s,i)=><tr key={i}><td style={{fontWeight:600}}>{s.name}</td><td style={{fontSize:12}}>{s.class_label}</td><td style={{textAlign:'center',fontWeight:700,color:'#ef4444'}}>{fmt(s.average,1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
