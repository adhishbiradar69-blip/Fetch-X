import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Line, ComposedChart } from 'recharts';
import { GitCompare, Plus, X, Building2, Trophy } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { Toast } from '../../components/ui.jsx';

const COLORS = ['#4f7df3', '#34bfa1', '#f0a04b', '#8b5cf6', '#e85d75', '#0ea5e9'];
const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function ChairpersonCompare() {
  const [schools, setSchools] = useState([]);
  const [compare, setCompare] = useState(null);
  const [selected, setSelected] = useState([]);
  const [inspectData, setInspectData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    Promise.all([
      api.get('/chairperson/schools'),
      api.get('/chairperson/compare'),
    ]).then(([s, c]) => {
      setSchools(s.data);
      setCompare(c.data);
    }).catch(e => { console.error(e); showToast('Failed','error'); }).finally(()=>setLoading(false));
  }, []);

  const toggleSelect = (school) => {
    const exists = selected.find(s => s.id === school.school_id);
    if (exists) {
      setSelected(selected.filter(s => s.id !== school.school_id));
      setInspectData(null);
    } else if (selected.length < 4) {
      setSelected([...selected, { id: school.school_id, name: school.name, color: COLORS[selected.length % COLORS.length] }]);
    } else {
      showToast('Max 4 schools to compare', 'error');
    }
  };

  const runComparison = async () => {
    if (selected.length < 2) { showToast('Select at least 2 schools', 'error'); return; }
    setComparing(true);
    try {
      const results = await Promise.all(selected.map(s => api.get(`/chairperson/schools/${s.id}/inspect`)));
      setInspectData(results.map((r, i) => ({ ...r.data, color: selected[i].color })));
    } catch (e) { console.error(e); showToast('Comparison failed', 'error'); }
    setComparing(false);
  };

  if (loading) return <SkeletonPage eyebrowW={96} titleW={240} subW={400} stats={4} charts={0} rows={5} />;

  const subjectLeaders = compare?.subject_leaders || [];

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="page-header-pro">
        <div className="breadcrumb"><a href="/chairperson/dashboard">Dashboard</a> / Compare Schools</div>
        <h2>Cross-School Comparison</h2>
        <p>Select 2-4 schools to compare performance, subjects, and grades side-by-side</p>
      </div>

      <div className="filter-bar-premium">
        <span style={{fontSize:13,color:'var(--text-muted)'}}>{selected.length}/4 selected</span>
        <div style={{flex:1}}></div>
        <button className="btn btn-primary" disabled={selected.length < 2 || comparing} onClick={runComparison}>
          <GitCompare size={14} style={{marginRight:6}} /> {comparing ? 'Comparing…' : 'Compare'}
        </button>
      </div>

      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div className="filter-bar-premium" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>
            {selected.map(s => (
              <span key={s.id} className="pill-tag" style={{background:s.color+'20',color:s.color,padding:'6px 14px',fontSize:13}}>
                {s.name}
                <X size={12} style={{marginLeft:6,cursor:'pointer'}} onClick={()=>toggleSelect({school_id:s.id,name:s.name})} />
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {!inspectData && (
        <div className="chart-card-premium">
          <div className="chart-header-premium"><div className="chart-title-premium"><Building2 size={18} /> Select schools to compare</div></div>
          <div className="table-premium">
            <table>
              <thead><tr><th>School</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Average</th><th style={{textAlign:'center'}}>Attendance</th><th style={{textAlign:'center'}}>At-Risk</th><th style={{width:40}}></th></tr></thead>
              <tbody>
                {schools.map((s, i) => {
                  const sel = selected.find(x => x.id === s.school_id);
                  return (
                    <motion.tr key={s.school_id || i} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.04}} onClick={()=>toggleSelect(s)} style={{background:sel?sel.color+'10':'transparent'}}>
                      <td style={{fontWeight:600}}>{s.name}</td>
                      <td style={{textAlign:'center'}}>{s.students}</td>
                      <td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.average_pct||0)}}>{fmt(s.average_pct,1)}%</td>
                      <td style={{textAlign:'center'}}>{fmt(s.attendance_rate,1)}%</td>
                      <td style={{textAlign:'center'}}>{s.at_risk_count || '—'}</td>
                      <td>{sel ? <X size={14} color={sel.color} /> : <Plus size={14} color="var(--text-muted)" />}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {inspectData && (
        <ComparisonResults data={inspectData} onClear={()=>{setInspectData(null);setSelected([]);}} />
      )}
    </Page>
  );
}

function ComparisonResults({ data, onClear }) {
  const chartData = data.map(d => ({
    name: d.school?.name || d.name,
    avg: Math.round(d.school_average || d.average || 0),
    att: Math.round(d.attendance_rate || 0),
    atrisk: d.at_risk_count || 0,
    color: d.color,
  }));
  const radarData = (data[0]?.subjects || []).map((sub, i) => {
    const entry = { subject: sub.name };
    data.forEach(d => {
      const s = (d.subjects || []).find(x => x.name === sub.name);
      entry[d.school?.name || d.name] = s ? Math.round(s.average) : 0;
    });
    return entry;
  });
  return (
    <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h3 style={{fontSize:18,fontWeight:700}}>Comparison Results</h3>
        <button className="btn btn-secondary" onClick={onClear}><X size={14} style={{marginRight:6}} />Clear</button>
      </div>

      <div className="chart-card-premium" style={{marginBottom:24}}>
        <div className="chart-header-premium"><div className="chart-title-premium">Performance Comparison</div></div>
        <div style={{width:'100%',height:300}}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{top:10,right:10,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,210,230,0.3)" />
              <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--text-secondary)'}} />
              <YAxis domain={[0,100]} tick={{fontSize:12,fill:'var(--text-secondary)'}} />
              <Tooltip contentStyle={{borderRadius:12,fontSize:13}} />
              <Legend />
              <Bar dataKey="avg" name="Average %" radius={[8,8,0,0]}>
                {chartData.map((d,i)=><Cell key={i} fill={d.color} />)}
              </Bar>
              <Line dataKey="att" name="Attendance %" stroke="#f0a04b" strokeWidth={2} dot={{r:4}} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {radarData.length > 0 && (
        <div className="chart-card-premium" style={{marginBottom:24}}>
          <div className="chart-header-premium"><div className="chart-title-premium">Subject-wise Comparison</div></div>
          <div style={{width:'100%',height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(200,210,230,0.4)" />
                <PolarAngleAxis dataKey="subject" tick={{fontSize:10,fill:'var(--text-secondary)'}} />
                <PolarRadiusAxis domain={[0,100]} tick={{fontSize:10,fill:'var(--text-muted)'}} />
                {data.map((d,i) => <Radar key={i} dataKey={d.school?.name || d.name} stroke={d.color} fill={d.color} fillOpacity={0.1} strokeWidth={2} />)}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="compare-grid" style={{gridTemplateColumns:`repeat(${data.length}, 1fr)`}} className="two-col-charts">
        {data.map((d, i) => (
          <div key={i} className="compare-col" style={{borderTop:`3px solid ${d.color}`}}>
            <div className="compare-col-header">
              <div className="compare-col-title">{d.school?.name || d.name}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div className="kpi-tile"><div className="kpi-tile-label">Average</div><div className="kpi-tile-value" style={{color:gradeColor(d.school_average||d.average||0)}}>{fmt(d.school_average||d.average,1)}%</div></div>
              <div className="kpi-tile"><div className="kpi-tile-label">Attendance</div><div className="kpi-tile-value">{fmt(d.attendance_rate,1)}%</div></div>
              <div className="kpi-tile"><div className="kpi-tile-label">Students</div><div className="kpi-tile-value">{d.total_students||d.students||'—'}</div></div>
              <div className="kpi-tile"><div className="kpi-tile-label">Classes</div><div className="kpi-tile-value">{d.total_classes||d.classes||'—'}</div></div>
              <div className="kpi-tile"><div className="kpi-tile-label">At-Risk</div><div className="kpi-tile-value">{d.at_risk_count ?? 0}</div></div>
              <div style={{marginTop:8}}>
                <div className="kpi-tile-label" style={{marginBottom:6}}>Top performer</div>
                <div style={{fontSize:13,fontWeight:600,color:'#10b981'}}>{d.top_performer?.name || '—'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
