import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { GitCompare, Plus, X, Users, BookOpen, Search, RotateCcw } from 'lucide-react';
import api from '../../api/client';
import { Page } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { Toast } from '../../components/ui.jsx';

const COLORS = ['#4f7df3', '#34bfa1', '#f0a04b', '#8b5cf6', '#e85d75', '#0ea5e9'];
const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';
function fmt(v, d=0) { if (v==null||isNaN(v)) return '—'; return Number(v).toFixed(d); }

export default function PrincipalCompare() {
  const [mode, setMode] = useState('classes'); // 'classes' or 'students'
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState([]); // array of {id, name, ...}
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [toast, setToast] = useState(null);
  /* picker search: classes filter client-side; students ALSO search server-side
     (debounced) so any of the school's students is reachable — not just the
     top-N the picker preloads. */
  const [query, setQuery] = useState('');
  const [serverHits, setServerHits] = useState(null); // students found by server search
  const [searching, setSearching] = useState(false);
  const [totalStudents, setTotalStudents] = useState(0);
  const showToast = (m, t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  useEffect(() => {
    Promise.all([
      api.get('/principal/classes/compare'),
      api.get('/principal/students?page_size=200'),
    ]).then(([c, s]) => {
      setClasses(c.data);
      setStudents(s.data.students);
      setTotalStudents(s.data.total ?? s.data.students.length);
    }).catch(e => { console.error(e); showToast('Failed to load','error'); }).finally(()=>setLoading(false));
  }, []);

  /* debounced server search (students mode) — backend filters the WHOLE school.
     No sync setState here: staleness is handled at render time. */
  useEffect(() => {
    const q = query.trim();
    if (mode !== 'students' || q.length < 2) return undefined;
    const t = setTimeout(() => {
      setSearching(true);
      api.get(`/principal/students?search=${encodeURIComponent(q)}&page_size=200`)
        .then(r => setServerHits(r.data.students))
        .catch(() => setServerHits(null))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode]);

  const toggleSelect = (item) => {
    const exists = selected.find(s => s.id === item.id);
    if (exists) {
      setSelected(selected.filter(s => s.id !== item.id));
    } else if (selected.length < 4) {
      setSelected([...selected, { id: item.id, name: item.name, label: item.label || item.name, color: COLORS[selected.length % COLORS.length] }]);
    } else {
      showToast('Max 4 items to compare', 'error');
    }
  };

  const runComparison = async () => {
    if (selected.length < 2) { showToast('Select at least 2 to compare', 'error'); return; }
    setComparing(true);
    try {
      if (mode === 'classes') {
        const results = await Promise.all(selected.map(s => api.get(`/principal/classes/${s.id}/inspect`)));
        setCompareData(results.map((r, i) => ({ ...r.data, color: selected[i].color })));
      } else {
        const results = await Promise.all(selected.map(s => api.get(`/principal/students/${s.id}/profile`)));
        setCompareData(results.map((r, i) => ({ ...r.data, color: selected[i].color })));
      }
    } catch (e) { console.error(e); showToast('Comparison failed', 'error'); }
    setComparing(false);
  };

  if (loading) return <SkeletonPage eyebrowW={96} titleW={250} subW={400} stats={3} charts={1} rows={4} />;

  const q = query.trim().toLowerCase();
  /* students list: server hits (searches the WHOLE school) win only while a
     live query is active; otherwise the preloaded top-200, filtered client-side */
  const searchLive = mode === 'students' && query.trim().length >= 2;
  const studentPool = (searchLive && serverHits) ? serverHits : students;
  const items = (mode === 'classes'
    ? classes.map(c => ({id: c.class_id, name: c.label, label: c.label}))
    : studentPool.map(s => ({id: s.student_id, name: s.name, label: s.class_label})))
    .filter(it => !q || it.name.toLowerCase().includes(q) || (it.label || '').toLowerCase().includes(q));
  const shown = items.slice(0, 50);

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow"><a href="/principal/dashboard">Dashboard</a> / Compare</div>
          <h1>Comparison Tool</h1>
          <div className="subtitle">Select 2-4 {mode} to compare side-by-side with charts and tables</div>
        </div>
      </div>

      <div className="filter-bar-premium">
        <div style={{display:'flex',gap:6}}>
          <button className={`gtab ${mode==='classes'?'active':''}`} onClick={()=>{setMode('classes');setSelected([]);setCompareData(null);setQuery('');}}><BookOpen size={13} />Classes</button>
          <button className={`gtab ${mode==='students'?'active':''}`} onClick={()=>{setMode('students');setSelected([]);setCompareData(null);setQuery('');}}><Users size={13} />Students</button>
        </div>
        <div className="fx-picker-search" style={{flex:1, maxWidth:340, minWidth:160}}>
          <Search size={14} className="fx-picker-search-ic" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={mode === 'students' ? `Search all ${totalStudents} students…` : 'Search classes…'}
            aria-label={`Search ${mode} to compare`}
          />
          {query && (
            <button type="button" className="fx-picker-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <RotateCcw size={12} />
            </button>
          )}
          {searching && <span className="fx-picker-search-spin" />}
        </div>
        <div style={{flex:1}}></div>
        <span style={{fontSize:13,color:'var(--text-muted)'}}>
          {q ? `${items.length} match${items.length === 1 ? '' : 'es'} · ` : ''}{selected.length}/4 selected
        </span>
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
                <X size={12} style={{marginLeft:6,cursor:'pointer'}} onClick={()=>toggleSelect(s)} />
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {!compareData && (
        <div className="chart-card-premium">
          <div className="chart-header-premium">
            <div className="chart-title-premium">{mode === 'classes' ? <BookOpen size={18} /> : <Users size={18} />} Select {mode} to compare</div>
          </div>
          <div className="table-premium">
            <table>
              <thead><tr><th>{mode === 'classes' ? 'Class' : 'Student'}</th><th style={{textAlign:'center'}}>Average</th><th style={{textAlign:'center'}}>Status</th><th style={{width:40}}></th></tr></thead>
              <tbody>
                {shown.map((item, i) => {
                  const sel = selected.find(s => s.id === item.id);
                  const avg = mode === 'classes' ? (classes.find(c=>c.class_id===item.id)?.average_percentage || 0) : (studentPool.find(s=>s.student_id===item.id)?.average || 0);
                  return (
                    <motion.tr key={item.id} initial={{opacity:0}} animate={{opacity:1}} transition={{delay:i*0.02}} onClick={()=>toggleSelect(item)} style={{background:sel?sel.color+'10':'transparent'}}>
                      <td style={{fontWeight:600}}>{item.name}</td>
                      <td style={{textAlign:'center',fontWeight:700,color:gradeColor(avg)}}>{fmt(avg,1)}%</td>
                      <td style={{textAlign:'center'}}>{sel ? <span className="pill-tag" style={{background:sel.color+'20',color:sel.color}}>Selected</span> : <span style={{color:'var(--text-muted)'}}>Click to select</span>}</td>
                      <td>{sel ? <X size={14} color={sel.color} /> : <Plus size={14} color="var(--text-muted)" />}</td>
                    </motion.tr>
                  );
                })}
                {!shown.length && (
                  <tr><td colSpan={4} style={{textAlign:'center',padding:'36px 20px',color:'var(--text-muted)'}}>
                    No {mode} match “{query}” — try another spelling.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {items.length > 50 && (
            <div className="fx-picker-note">
              Showing first 50 of {items.length} matches — refine the search to narrow it down.
            </div>
          )}
        </div>
      )}

      {compareData && (
        <ComparisonResults data={compareData} mode={mode} onClear={()=>{setCompareData(null);setSelected([]);}} />
      )}
    </Page>
  );
}

function ComparisonResults({ data, mode, onClear }) {
  const chartData = data.map(d => ({
    name: mode === 'classes' ? d.label : d.name,
    avg: d.class_average || d.average || 0,
    att: d.attendance_rate || 0,
    color: d.color,
  }));
  const radarData = (data[0]?.subject_averages || data[0]?.subject_exam_grid || []).map((sub) => {
    const entry = { subject: sub.name };
    data.forEach(d => {
      if (mode === 'classes') {
        const s = (d.subject_averages || []).find(x => x.name === sub.name);
        entry[d.label] = s ? Math.round(s.average) : 0;
      } else {
        const s = (d.subject_exam_grid || []).find(x => x.name === sub.name);
        entry[d.name] = s ? Math.round(s.average) : 0;
      }
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
        <div className="chart-header-premium"><div className="chart-title-premium">Average Comparison</div></div>
        <div style={{width:'100%',height:280}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{top:10,right:10,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(143,146,171,0.28)" />
              <XAxis dataKey="name" tick={{fontSize:11,fill:'#8f92ab'}} />
              <YAxis domain={[0,100]} tick={{fontSize:12,fill:'#8f92ab'}} />
              <Tooltip contentStyle={{borderRadius:12,border:'1px solid var(--line)',background:'var(--surf)',fontSize:13}} />
              <Legend />
              <Bar dataKey="avg" name="Average %" radius={[8,8,0,0]}>
                {chartData.map((d,i)=><Cell key={i} fill={d.color} />)}
              </Bar>
              <Bar dataKey="att" name="Attendance %" radius={[8,8,0,0]} fill="#94a3b8" fillOpacity={0.5} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {radarData.length > 0 && (
        <div className="chart-card-premium" style={{marginBottom:24}}>
          <div className="chart-header-premium"><div className="chart-title-premium">Subject-wise Comparison</div></div>
          <div style={{width:'100%',height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(143,146,171,0.35)" />
                <PolarAngleAxis dataKey="subject" tick={{fontSize:10,fill:'#8f92ab'}} />
                <PolarRadiusAxis domain={[0,100]} tick={{fontSize:10,fill:'#8f92ab'}} />
                {data.map((d,i) => <Radar key={i} dataKey={mode==='classes'?d.label:d.name} stroke={d.color} fill={d.color} fillOpacity={0.1} strokeWidth={2} />)}
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="compare-grid" style={{gridTemplateColumns:`repeat(${data.length}, 1fr)`}}>
        {data.map((d, i) => (
          <div key={i} className="compare-col" style={{borderTop:`3px solid ${d.color}`}}>
            <div className="compare-col-header">
              <div className="compare-col-title">{mode === 'classes' ? d.label : d.name}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div className="kpi-tile"><div className="kpi-tile-label">Average</div><div className="kpi-tile-value" style={{color:gradeColor(d.class_average||d.average||0)}}>{fmt(d.class_average||d.average,1)}%</div></div>
              <div className="kpi-tile"><div className="kpi-tile-label">Attendance</div><div className="kpi-tile-value">{fmt(d.attendance_rate,1)}%</div></div>
              {mode === 'classes' && <div className="kpi-tile"><div className="kpi-tile-label">Students</div><div className="kpi-tile-value">{d.students_count ?? '—'}</div></div>}
              {mode === 'classes' && <div className="kpi-tile"><div className="kpi-tile-label">At Risk</div><div className="kpi-tile-value">{d.at_risk_count ?? 0}</div></div>}
              {mode === 'students' && <div className="kpi-tile"><div className="kpi-tile-label">Rank</div><div className="kpi-tile-value">#{d.rank_in_class ?? '—'}</div></div>}
              <div style={{marginTop:8}}>
                <div className="kpi-tile-label" style={{marginBottom:6}}>Top subject</div>
                <div style={{fontSize:13,fontWeight:600,color:'#10b981'}}>{mode==='classes' ? d.top_student?.name : d.strongest_subject?.name} ({fmt(mode==='classes'?d.top_student?.average:d.strongest_subject?.average,1)}%)</div>
              </div>
              <div style={{marginTop:4}}>
                <div className="kpi-tile-label" style={{marginBottom:6}}>Weak area</div>
                <div style={{fontSize:13,fontWeight:600,color:'#ef4444'}}>{mode==='classes' ? d.bottom_student?.name : d.weakest_subject?.name} ({fmt(mode==='classes'?d.bottom_student?.average:d.weakest_subject?.average,1)}%)</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
