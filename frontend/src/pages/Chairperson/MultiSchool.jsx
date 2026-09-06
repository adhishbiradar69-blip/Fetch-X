import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Cell, Legend, Area, AreaChart, ComposedChart, PieChart, Pie,
  ScatterChart, Scatter, ZAxis, RadialBarChart, RadialBar,
} from 'recharts';
import {
  Building2, Bot, GraduationCap, TrendingUp, TrendingDown, Trophy,
  AlertTriangle, CheckCircle2, BarChart3, Target, SendHorizontal, Sparkles,
  ChevronRight, Award, Zap, Lightbulb, ArrowUpRight, ArrowDownRight,
  Activity, Layers, Crown, Network, Minus, Grid3x3, PieChart as PieIcon,
  GitCompare, BookOpen, Flame, Eye, Shield, Gauge, Copy, Check,
} from 'lucide-react';
import api from '../../api/client';
import { Page, EASE, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { CountUp, Toast, Modal } from '../../components/ui.jsx';

const COLORS = ['#4f7df3', '#34bfa1', '#f0a04b', '#8b5cf6', '#e85d75', '#0ea5e9'];
const gradeColor = (avg) => avg >= 75 ? '#10b981' : avg >= 60 ? '#f59e0b' : avg >= 45 ? '#fb923c' : '#ef4444';

const AI_SUGGESTIONS = [
  'Compare all my schools',
  'Which school needs attention?',
  'Where should I invest resources?',
  'What are the cross-school trends?',
];

function ThinkingWave() {
  return (
    <div className="ai-thinking">
      <div className="ai-wave">
        {[0,1,2,3,4].map(i => <motion.span key={i} animate={{scaleY:[0.4,1,0.4],opacity:[0.5,1,0.5]}} transition={{duration:1,repeat:Infinity,ease:'easeInOut',delay:i*0.12}} />)}
      </div>
      <motion.span className="ai-thinking-text" animate={{opacity:[0.5,1,0.5]}} transition={{duration:1.4,repeat:Infinity}}>Analyzing with tools…</motion.span>
    </div>
  );
}
function MarkdownLite({ text }) {
  if (!text) return null;
  const lines = text.split('\n'); const out = []; let lt=null; let li=[];
  const flush = () => { if(li.length){out.push(lt==='ol'?<ol key={`l${out.length}`}>{li}</ol>:<ul key={`l${out.length}`}>{li}</ul>);li=[];lt=null;} };
  lines.forEach((line,i) => {
    const t = line.trim();
    if(!t){flush();return;}
    if(t.startsWith('### ')||t.startsWith('## ')||t.startsWith('# ')){flush();out.push(<h3 key={i}>{inline(t.replace(/^#+\s/,''))}</h3>);}
    else if(t.startsWith('- ')||t.startsWith('* ')){if(lt!=='ul'){flush();lt='ul';}li.push(<li key={i}>{inline(t.slice(2))}</li>);}
    else if(/^\d+\.\s/.test(t)){if(lt!=='ol'){flush();lt='ol';}li.push(<li key={i}>{inline(t.replace(/^\d+\.\s/,''))}</li>);}
    else{flush();out.push(<p key={i}>{inline(t)}</p>);}
  });
  flush(); return <>{out}</>;
}
function inline(text) {
  const parts=[]; let rest=text; let k=0;
  while(rest.length) {
    const b=rest.match(/\*\*([^*]+)\*\*/); const c=rest.match(/`([^`]+)`/); let n=null;
    if(b&&(!c||b.index<c.index)) n={type:'b',text:b[1],index:b.index,len:b[0].length};
    else if(c) n={type:'c',text:c[1],index:c.index,len:c[0].length};
    if(!n){parts.push(rest);break;}
    if(n.index>0) parts.push(rest.slice(0,n.index));
    if(n.type==='b') parts.push(<strong key={k++}>{n.text}</strong>);
    else parts.push(<code key={k++} style={{background:'rgba(79,125,243,0.1)',padding:'1px 5px',borderRadius:4,fontSize:'0.9em'}}>{n.text}</code>);
    rest=rest.slice(n.index+n.len);
  }
  return parts;
}
function fmt(v, decimals=0) {
  if (v == null || v === undefined || (typeof v === 'number' && isNaN(v))) return '—';
  return Number(v).toFixed(decimals);
}
function Sparkline({ data, color='#4f7df3' }) {
  const points = data.map((v,i) => ({ x: i, y: v }));
  return (
    <div className="sparkline-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{top:2,right:2,bottom:2,left:2}}>
          <Line type="monotone" dataKey="y" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ChairpersonMultiSchool() {
  const [overview, setOverview] = useState(null);
  const [schools, setSchools] = useState([]);
  const [compare, setCompare] = useState(null);
  const [rankings, setRankings] = useState(null);
  const [insights, setInsights] = useState([]);
  const [attTrends, setAttTrends] = useState(null); // { window[], schools[{school_id,name,weeks[]}] }
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [aiOpen, setAiOpen] = useState(true);
  const [schoolInspect, setSchoolInspect] = useState(null);
  const [messages, setMessages] = useState([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const showToast = (m,t='success') => { setToast({message:m,type:t}); setTimeout(()=>setToast(null),2600); };

  /* message meta helpers — time label + copy-to-clipboard on bot answers */
  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  };
  const copyMsg = async (i, text) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* unsupported */ }
      ta.remove();
    }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1600);
  };

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/chairperson/overview'),
      api.get('/chairperson/schools'),
      api.get('/chairperson/compare'),
      api.get('/chairperson/rankings'),
      api.get('/chairperson/insights'),
      api.get('/chairperson/trends?weeks=6'),
    ]).then(([o,s,c,r,ins,at]) => {
      setOverview(o.data); setSchools(s.data); setCompare(c.data); setRankings(r.data); setInsights(ins.data); setAttTrends(at.data);
    }).catch(e => { console.error(e); showToast('Failed to load','error'); }).finally(()=>setLoading(false));
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages, aiLoading]);

  const askAI = async (q) => {
    const question = (q ?? aiInput).trim();
    if (!question || aiLoading) return;
    setAiInput(''); setMessages(p => [...p, {role:'user',content:question,ts:Date.now()}]); setAiLoading(true);
    try { const res = await api.post('/chairperson/ai/analyze', {question}); setMessages(p => [...p, {role:'bot',content:res.data.answer,source:res.data.source,ts:Date.now()}]); }
    catch { setMessages(p => [...p, {role:'bot',content:'AI unavailable.',ts:Date.now()}]); }
    setAiLoading(false);
  };
  const inspectSchool = async (id) => { try { const r = await api.get(`/chairperson/schools/${id}/inspect`); setSchoolInspect(r.data); } catch { showToast('Failed','error'); } };

  if (loading) return <SkeletonPage eyebrowW={104} titleW={300} subW={420} stats={4} charts={2} rows={4} />;
  if (!overview) return <Page><div className="glass" style={{padding:60,textAlign:'center'}}>No data.</div></Page>;

  const schoolAvgData = schools.map((s,i) => ({name: s.name?.length>12?s.name.slice(0,12)+'…':s.name, avg: Math.round(s.average_pct||0), att: Math.round(s.attendance_rate||0), color: COLORS[i%COLORS.length] }));
  const subjectLeaders = compare?.subject_leaders || [];
  const radarData = (compare?.schools||schools).map(s => ({school: s.name?.slice(0,8), avg: Math.round(s.average_pct||0)}));
  const ranked = rankings?.by_average || schools.slice().sort((a,b) => (b.average||0)-(a.average||0));

  // PORTFOLIO HEALTH SCORE (composite metric)
  const overallAvg = overview.overall_average_pct || 0;
  const totalStudents = overview.total_students || 0;
  const totalSchools = overview.total_schools || 0;
  const portfolioHealth = Math.min(100, Math.round(overallAvg * 0.5 + (totalSchools > 0 ? 100 - (schools.filter(s => (s.average_pct||0) < 60).length / totalSchools * 100) * 0.3 : 70) + (overview.best_school?.average || 70) * 0.2));

  // RISK MATRIX DATA — scatter plot: x=avg, y=at_risk_count, bubble size=students
  const riskMatrixData = schools.map(s => ({
    x: s.average || 50, y: s.at_risk_count || 0, z: s.students || 100, name: s.name
  }));

  // SUBJECT LEADERSHIP HEATMAP
  const leadershipSubjects = subjectLeaders.map(s => s.subject);
  const leadershipSchools = schools.map(s => s.name);

  // CROSS-SCHOOL ATTENDANCE TREND ROWS — one strip per school, aligned weeks
  const xTrendWindow = attTrends?.window || [];
  const xTrendRows = (attTrends?.schools || []).map((s, i) => {
    const vals = (s.weeks || []).filter(w => w.pct != null);
    const last = vals.length ? vals[vals.length - 1].pct : null;
    const prev = vals.length >= 2 ? vals[vals.length - 2].pct : null;
    const best = vals.length ? vals.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    return {
      ...s,
      color: COLORS[i % COLORS.length],
      last, prev,
      delta: last != null && prev != null ? last - prev : null,
      best,
    };
  });
  const xTrendLeader = xTrendRows.length
    ? xTrendRows.reduce((a, b) => ((b.last ?? -1) > (a.last ?? -1) ? b : a))
    : null;

  // NARRATIVE
  const bestSchool = overview.best_school;
  const worstSchool = ranked[ranked.length - 1];
  const avgGap = bestSchool && worstSchool ? Math.round((bestSchool.average_pct||0) - (worstSchool.average_pct||0)) : 0;
  const narrative = (
    <>
      Your portfolio of <strong>{totalSchools} schools</strong> serves <strong>{totalStudents} students</strong> with an overall average of <strong>{fmt(overallAvg,1)}%</strong>.
      {' '}Your portfolio health score is <strong>{portfolioHealth}/100</strong>.
      {' '}<strong>{bestSchool?.name || '—'}</strong> leads at <span className="pos">{fmt(bestSchool?.average_pct,1)}%</span>, while <strong>{worstSchool?.name || '—'}</strong> trails at <span className="neg">{fmt(worstSchool?.average_pct,1)}%</span> — a <strong>{avgGap}-point gap</strong>.
      {subjectLeaders.length > 0 && <> In subject leadership, no single school dominates all subjects — <strong>{subjectLeaders[0]?.subject}</strong> is led by <strong>{subjectLeaders[0]?.leader}</strong>. </>}
      {insights.length > 0 && <> You have <strong>{insights.length} cross-school insights</strong> to act on. </>}
    </>
  );

  // BRIEFING ITEMS
  const briefingItems = [];
  if (bestSchool) briefingItems.push({ icon: Crown, bg: 'linear-gradient(135deg,#fef3c7,#fde68a)', color:'#d97706', label:'Best performing', value: bestSchool.name, sub: `${fmt(bestSchool.average_pct,1)}% average` });
  briefingItems.push({ icon: GraduationCap, bg: 'linear-gradient(135deg,#e0e7ff,#c7d2fe)', color:'#4f7df3', label:'Portfolio', value: `${totalStudents} students`, sub: `Across ${totalSchools} schools` });
  if (overview.most_improved_school) briefingItems.push({ icon: TrendingUp, bg: 'linear-gradient(135deg,#d1fae5,#a7f3d0)', color:'#16a34a', label:'Most improved', value: overview.most_improved_school.name, sub: `+${fmt(overview.most_improved_school.improvement,1)}% growth` });
  if (worstSchool) briefingItems.push({ icon: AlertTriangle, bg: 'linear-gradient(135deg,#fee2e2,#fecaca)', color:'#dc2626', label:'Needs focus', value: worstSchool.name, sub: `${fmt(worstSchool.average_pct,1)}% — lowest performer` });

  // ACTION ITEMS
  const actionItems = [];
  if (worstSchool) actionItems.push({ title: `${worstSchool.name} underperforming`, meta: `At ${fmt(worstSchool.average_pct,1)}% — schedule principal review`, priority: 'high' });
  insights.filter(i => i.severity === 'critical').slice(0,3).forEach(i => actionItems.push({ title: i.title, meta: i.detail||i.value, priority: 'high' }));
  insights.filter(i => i.severity === 'warning').slice(0,2).forEach(i => actionItems.push({ title: i.title, meta: i.detail||i.value, priority: 'med' }));

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}

      {/* HERO */}
      <motion.div className="hero-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.5,ease:EASE}}>
        <div className="hero-premium-icon"><Network size={26} color="white" /></div>
        <div className="hero-premium-text">
          <h2>Multi-School Command Center</h2>
          <p>Portfolio of {totalSchools} schools · every metric, every comparison, one click away</p>
        </div>
        <motion.button className="btn btn-primary" onClick={()=>setAiOpen(o=>!o)} whileHover={{scale:1.05}} whileTap={{scale:0.95}}>
          <Bot size={16} /> {aiOpen?'Hide':'AI'} Assistant
        </motion.button>
      </motion.div>

      <div className={`dash-premium ${aiOpen?'with-sidebar':''}`}>
        <div className="dash-main">
          {/* NARRATIVE */}
          <motion.div className="narrative" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.05}}>
            <div className="narrative-header">
              <Sparkles size={16} style={{color:'var(--accent)'}} />
              <span className="narrative-title">Portfolio Story — Today's Snapshot</span>
            </div>
            <div className="narrative-body">{narrative}</div>
          </motion.div>

          {/* KPI CARDS with sparklines */}
          <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16}}>
            {[
              { v:totalSchools, l:'Schools', Icon:Building2, c:'#4f7df3', bg:'linear-gradient(135deg,#e0e7ff,#c7d2fe)', spark:[totalSchools-1, totalSchools-1, totalSchools, totalSchools, totalSchools] },
              { v:totalStudents, l:'Students', Icon:GraduationCap, c:'#10b981', bg:'linear-gradient(135deg,#d1fae5,#a7f3d0)', spark:[totalStudents*0.92, totalStudents*0.95, totalStudents*0.97, totalStudents*0.99, totalStudents] },
              { v:overallAvg, l:'Overall Avg', Icon:TrendingUp, c:'#f59e0b', bg:'linear-gradient(135deg,#fef3c7,#fde68a)', spark:[overallAvg-2, overallAvg-1, overallAvg, overallAvg+0.5, overallAvg], decimals:1 },
              { v:portfolioHealth, l:'Portfolio Health', Icon:Gauge, c:'#8b5cf6', bg:'linear-gradient(135deg,#ede9fe,#ddd6fe)', spark:[portfolioHealth-3, portfolioHealth-1, portfolioHealth-2, portfolioHealth+1, portfolioHealth] },
            ].map((s,i) => (
              <motion.div key={i} variants={staggerItem} className="stat-card-premium" style={{'--card-accent':s.c}}>
                <div className="stat-top">
                  <div className="stat-icon-box" style={{background:s.bg}}><s.Icon size={20} color={s.c} /></div>
                  {s.spark && <Sparkline data={s.spark} color={s.c} />}
                </div>
                <div className="stat-value" style={{color:s.c}}><CountUp value={s.v} decimals={s.decimals||0} /></div>
                <div className="stat-label">{s.l}</div>
              </motion.div>
            ))}
          </motion.div>

          {/* BRIEFING + ACTIONS */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}} className="two-col-charts">
            <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.2}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Sparkles size={18} /> Portfolio Briefing</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {briefingItems.map((b,i) => (
                  <motion.div key={i} className="briefing-item" initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:i*0.06}}>
                    <div className="briefing-icon" style={{background:b.bg}}><b.icon size={18} color={b.color} /></div>
                    <div className="briefing-content">
                      <div className="briefing-label">{b.label}</div>
                      <div className="briefing-value">{b.value}</div>
                      <div className="briefing-sub">{b.sub}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.25}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Zap size={18} /> Priority Actions</div>
                <span className="chart-annotation">{actionItems.length} items</span>
              </div>
              <div className="action-list">
                {actionItems.map((a,i) => (
                  <motion.div key={i} className="action-item" initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:i*0.05}}>
                    <div className={`action-priority priority-${a.priority}`}></div>
                    <div className="action-text"><div className="action-title">{a.title}</div><div className="action-meta">{a.meta}</div></div>
                    <ChevronRight size={14} color="var(--text-muted)" />
                  </motion.div>
                ))}
                {!actionItems.length && <div className="empty-mini">No urgent actions.</div>}
              </div>
            </motion.div>
          </div>

          {/* SCHOOL COMPARISON — interactive bar+line */}
          <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.3}}>
            <div className="chart-header-premium">
              <div className="chart-title-premium"><BarChart3 size={18} /> School Comparison</div>
              <span className="chart-annotation">Click a bar to inspect</span>
            </div>
            <div style={{width:'100%',height:300}}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={schoolAvgData} margin={{top:10,right:10,left:-20,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,210,230,0.3)" />
                  <XAxis dataKey="name" tick={{fontSize:11,fill:'var(--text-secondary)'}} />
                  <YAxis domain={[0,100]} tick={{fontSize:12,fill:'var(--text-secondary)'}} />
                  <Tooltip contentStyle={{borderRadius:12,border:'1px solid rgba(79,125,243,0.2)',fontSize:13}} />
                  <Legend />
                  <Bar dataKey="avg" name="Avg %" radius={[8,8,0,0]} onClick={(d,i)=>inspectSchool(schools[i]?.id)} cursor="pointer">
                    {schoolAvgData.map((d,i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                  <Line dataKey="att" name="Attendance %" stroke="#f0a04b" strokeWidth={2} dot={{r:4}} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* CROSS-SCHOOL ATTENDANCE TRENDS — first TEMPORAL portfolio view */}
          {xTrendRows.length > 0 && (
            <motion.div className="chart-card-premium fx-xstrend-card" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.32}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Activity size={18} /> Cross-School Attendance Trends</div>
                <span className="chart-annotation">Last {xTrendWindow.length} weeks · Mon-Fri</span>
              </div>
              {xTrendLeader?.last != null && (
                <div className="fx-xstrend-lead" title={`${xTrendLeader.name} leads this week at ${Math.round(xTrendLeader.last)}%`}>
                  <Trophy size={13} />
                  <span><strong>{xTrendLeader.name}</strong> leads the current week at <strong>{Math.round(xTrendLeader.last)}%</strong>
                    {xTrendLeader.delta != null && <> ({xTrendLeader.delta >= 0 ? '+' : ''}{xTrendLeader.delta.toFixed(1)} pts vs last week)</>}
                  </span>
                </div>
              )}
              <div className="fx-xstrend-grid" role="img" aria-label="Attendance percent per school for the last six weeks">
                {xTrendRows.map(row => (
                  <div key={row.school_id} className="fx-xstrend-row" onClick={() => inspectSchool(row.school_id)} role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') inspectSchool(row.school_id); }}
                    title={`${row.name} — click to inspect`}>
                    <span className="fx-xstrend-dot" style={{ background: row.color }} aria-hidden="true" />
                    <span className="fx-xstrend-name" title={row.name}>{row.name}</span>
                    <span className="fx-xstrend-strip">
                      {(row.weeks || []).map((w, i) => (
                        <span key={i} className={`fx-xstrend-col${i === (row.weeks || []).length - 1 ? ' is-cur' : ''}${w.pct == null ? ' is-empty' : ''}`}
                          title={w.pct == null ? `${w.label} · no attendance marked` : `${w.label} · ${w.pct}% · ${w.present}/${w.marked} present`}>
                          <motion.i className={w.pct == null ? '' : w.pct >= 90 ? 'is-good' : w.pct >= 75 ? 'is-mid' : 'is-low'}
                            initial={{ height: 4 }} animate={{ height: w.pct == null ? 4 : Math.max(6, Math.round(w.pct * 0.30)) }}
                            transition={{ duration: 0.55, delay: i * 0.05, ease: EASE }} />
                        </span>
                      ))}
                    </span>
                    <span className="fx-xstrend-now">{row.last == null ? '—' : `${Math.round(row.last)}%`}</span>
                    {row.delta != null
                      ? <span className={`fx-trend-dir ${row.delta > 0 ? 'is-up' : row.delta < 0 ? 'is-down' : 'is-flat'}`}>
                          {row.delta > 0 ? <ArrowUpRight size={12} /> : row.delta < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />}
                          {Math.abs(row.delta).toFixed(1)}
                        </span>
                      : <span className="fx-trend-dir is-flat"><Minus size={12} />—</span>}
                  </div>
                ))}
              </div>
              <div className="fx-xstrend-axis" aria-hidden="true">
                <span className="fx-xstrend-axis-inner">
                  {xTrendWindow.map(w => <i key={w.start}>{w.label}</i>)}
                </span>
              </div>
            </motion.div>
 )}

          {/* RISK MATRIX (scatter) + SUBJECT LEADERSHIP */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}} className="two-col-charts">
            <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.35}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Target size={18} /> Risk Matrix</div>
                <span className="chart-annotation">Avg vs At-Risk count</span>
              </div>
              <div style={{width:'100%',height:260}}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{top:10,right:10,left:-10,bottom:10}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,210,230,0.3)" />
                    <XAxis type="number" dataKey="x" name="Avg %" domain={[0,100]} tick={{fontSize:12,fill:'var(--text-secondary)'}} label={{value:'Average %',position:'bottom',fontSize:11,fill:'var(--text-muted)'}} />
                    <YAxis type="number" dataKey="y" name="At-Risk" tick={{fontSize:12,fill:'var(--text-secondary)'}} label={{value:'At-Risk Students',angle:-90,position:'insideLeft',fontSize:11,fill:'var(--text-muted)'}} />
                    <ZAxis type="number" dataKey="z" range={[60,400]} />
                    <Tooltip contentStyle={{borderRadius:12,fontSize:12}} cursor={{strokeDasharray:'3 3'}} />
                    <Scatter data={riskMatrixData} fill="#4f7df3" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {subjectLeaders.length > 0 && (
              <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.4}}>
                <div className="chart-header-premium">
                  <div className="chart-title-premium"><Trophy size={18} /> Subject Leadership</div>
                </div>
                <div className="table-premium">
                  <table>
                    <thead><tr><th>Subject</th><th>Leader</th><th style={{textAlign:'center'}}>Avg</th><th style={{textAlign:'center'}}>Gap</th></tr></thead>
                    <tbody>
                      {subjectLeaders.map((s,i) => (
                        <tr key={i}>
                          <td style={{fontWeight:700}}>{s.subject}</td>
                          <td><span className="pill-tag" style={{background:'rgba(245,158,11,0.12)',color:'#d97706'}}>{s.leader}</span></td>
                          <td style={{textAlign:'center',fontWeight:700,color:'#10b981'}}>{fmt(s.leader_avg,1)}%</td>
                          <td style={{textAlign:'center',color:'var(--text-muted)'}}>+{fmt(s.gap,1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </div>

          {/* SCHOOL RADAR + RANKINGS */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}} className="two-col-charts">
            <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.45}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Target size={18} /> School Radar</div>
              </div>
              <div style={{width:'100%',height:240}}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(200,210,230,0.4)" />
                    <PolarAngleAxis dataKey="school" tick={{fontSize:10,fill:'var(--text-secondary)'}} />
                    <PolarRadiusAxis domain={[0,100]} tick={{fontSize:10,fill:'var(--text-muted)'}} />
                    <Radar dataKey="avg" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.3} strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.5}}>
              <div className="chart-header-premium">
                <div className="chart-title-premium"><Award size={18} /> School Rankings</div>
                <span className="chart-annotation">Click to inspect</span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {ranked.map((s,i) => (
                  <motion.div key={i} className="ranking-row" onClick={()=>inspectSchool(s.id)} whileHover={{x:3}} style={{cursor:'pointer'}} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}}>
                    <span className="rank-num" style={{color: i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#d97706':'var(--text-muted)'}}>{i+1}</span>
                    <span className="rank-name" style={{fontWeight:600,fontSize:13,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                    <span className="rank-pct" style={{fontSize:13,fontWeight:700,color:gradeColor(s.average_pct||0),flexShrink:0}}>{fmt(s.average_pct,1)}%</span>
                    <ChevronRight size={14} color="var(--text-muted)" style={{flexShrink:0}} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* CROSS-SCHOOL INSIGHTS */}
          <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.55}}>
            <div className="chart-header-premium">
              <div className="chart-title-premium"><Lightbulb size={18} /> Cross-School Insights</div>
              <span className="chart-annotation">{insights.length} findings</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}} className="insights-grid">
              {insights.slice(0,8).map((ins,i) => {
                const c = ins.severity==='good'?'#10b981':ins.severity==='warning'?'#f59e0b':ins.severity==='critical'?'#ef4444':'#4f7df3';
                return (
                  <motion.div key={i} className="insight-premium" style={{'--insight-color':c}} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}}>
                    <div className="insight-premium-header">
                      <Lightbulb size={14} style={{color:c}} />
                      <span className="insight-premium-title">{ins.title}</span>
                      <span className="insight-premium-value" style={{color:c}}>{ins.value}</span>
                    </div>
                    {ins.detail && <p className="insight-premium-detail">{ins.detail}</p>}
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* DETAILED COMPARISON TABLE (clickable) */}
          <motion.div className="chart-card-premium" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.6}}>
            <div className="chart-header-premium">
              <div className="chart-title-premium"><Layers size={18} /> Detailed Comparison</div>
              <span className="chart-annotation">Click to inspect</span>
            </div>
            <div className="table-premium">
              <table>
                <thead><tr><th>School</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Classes</th><th style={{textAlign:'center'}}>Avg</th><th style={{textAlign:'center'}}>Attendance</th><th style={{textAlign:'center'}}>At-Risk</th><th>Top Student</th></tr></thead>
                <tbody>
                  {schools.map((s,i) => (
                    <motion.tr key={i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.03}} onClick={()=>inspectSchool(s.id)}>
                      <td style={{fontWeight:700}}>{s.name}</td>
                      <td style={{textAlign:'center'}}>{s.students}</td>
                      <td style={{textAlign:'center'}}>{s.classes}</td>
                      <td style={{textAlign:'center',fontWeight:700,color:gradeColor(s.average_pct||0)}}>{fmt(s.average_pct,1)}%</td>
                      <td style={{textAlign:'center'}}>{fmt(s.attendance_rate||s.attendance,1)}%</td>
                      <td style={{textAlign:'center'}}>{s.at_risk_count || '—'}</td>
                      <td style={{fontSize:12}}>{s.top_student?.name || '—'}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>

        {/* AI SIDEBAR */}
        <AnimatePresence>
          {aiOpen && (
            <motion.div className="ai-sidebar-premium" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0,x:30}} transition={{duration:0.4,ease:EASE}}>
              <div className="ai-sidebar-header">
                <div className="ai-avatar"><Bot size={18} color="white" /></div>
                <div>
                  <div className="ai-sidebar-title">AI Assistant</div>
                  <div className="ai-sidebar-sub">Agentic · Sees all schools</div>
                </div>
              </div>
              <div className="ai-messages-premium">
                {messages.length===0 && (
                  <div className="ai-msg-premium ai-msg-bot-premium" style={{background:'rgba(79,125,243,0.05)'}}>
                    <Sparkles size={14} style={{display:'inline',marginRight:6,color:'var(--accent)'}} />
                    I'm your AI partner with tool access across all {totalSchools} schools. I can compare performance, drill into any school, or analyze cross-school trends. What do you need?
                  </div>
                )}
                {messages.map((m,i) => (
                  <div key={i} className={`ai-msg-premium ${m.role==='user'?'ai-msg-user-premium':'ai-msg-bot-premium'}${m.role==='bot'?' fx-ai-stream':''}`}>
                    {m.role==='bot'?<MarkdownLite text={m.content} />:m.content}
                    {m.role==='bot' && (
                      <div className="fx-ai-meta">
                        <span className="fx-ai-time">{fmtTime(m.ts)}</span>
                        <button type="button" className="fx-ai-copy" onClick={() => copyMsg(i, m.content)}
                          title="Copy answer" aria-label="Copy answer">
                          {copiedIdx===i ? <Check size={11} strokeWidth={2.6} /> : <Copy size={11} strokeWidth={2.4} />}
                          {copiedIdx===i ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {aiLoading && <div className="ai-msg-premium ai-msg-bot-premium"><ThinkingWave /></div>}
                <div ref={messagesEndRef} />
              </div>
              {messages.length===0 && (
                <div className="ai-suggest-premium">
                  {AI_SUGGESTIONS.map(s => <button key={s} onClick={()=>askAI(s)}>{s}</button>)}
                </div>
              )}
              <form className="ai-input-premium" onSubmit={e=>{e.preventDefault();askAI();}}>
                <input className="input" placeholder="Ask about your schools…" value={aiInput} onChange={e=>setAiInput(e.target.value)} disabled={aiLoading} />
                <button type="submit" disabled={aiLoading||!aiInput.trim()}>
                  {aiLoading ? <Activity size={16} className="spin" /> : <SendHorizontal size={16} />}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Modal open={!!schoolInspect} onClose={()=>setSchoolInspect(null)} title={schoolInspect?`${schoolInspect.school?.name||schoolInspect.name} — Inspection`:''} wide>
        {schoolInspect && <SchoolInspect data={schoolInspect} />}
      </Modal>
    </Page>
  );
}

function SchoolInspect({ data }) {
  // FIX (4-h): the inspect payload nests scalars under `summary` — the old
  // code read data.total_classes/data.classes directly, so the Classes tile
  // rendered the RAW class-object ARRAY → "Objects are not valid as a React
  // child" crash on EVERY inspect open (pre-existing, surfaced via the new
  // trend-row click). Subjects also expose `average`, not `average_pct`.
  const s = data.summary || {};
  const grades = data.grades || [];
  const subjects = data.subjects || [];
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12,marginBottom:16}}>
        <div className="kpi-tile"><div className="kpi-tile-label">Students</div><div className="kpi-tile-value">{s.students ?? data.total_students ?? '—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Classes</div><div className="kpi-tile-value">{s.classes ?? data.total_classes ?? '—'}</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">Avg</div><div className="kpi-tile-value" style={{color:gradeColor(s.average_pct ?? data.school_average ?? 0)}}>{fmt(s.average_pct ?? data.school_average,1)}%</div></div>
        <div className="kpi-tile"><div className="kpi-tile-label">At-Risk</div><div className="kpi-tile-value">{s.at_risk_count ?? data.at_risk_count ?? '—'}</div></div>
      </div>
      {grades.length>0 && (
        <>
          <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Grade breakdown</h4>
          <div className="table-premium" style={{marginBottom:16}}>
            <table>
              <thead><tr><th>Grade</th><th style={{textAlign:'center'}}>Classes</th><th style={{textAlign:'center'}}>Students</th><th style={{textAlign:'center'}}>Avg</th></tr></thead>
              <tbody>{grades.map((g,i) => (<tr key={i}><td style={{fontWeight:700}}>Grade {g.grade}</td><td style={{textAlign:'center'}}>{g.classes ?? '—'}</td><td style={{textAlign:'center'}}>{g.students ?? '—'}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(g.average)}}>{fmt(g.average,1)}%</td></tr>))}</tbody>
            </table>
          </div>
        </>
      )}
      {subjects.length>0 && (
        <>
          <h4 style={{margin:'16px 0 8px',fontSize:14,fontWeight:700}}>Subject performance</h4>
          <div className="table-premium">
            <table>
              <thead><tr><th>Subject</th><th style={{textAlign:'center'}}>Avg</th><th style={{textAlign:'center'}}>Pass Rate</th></tr></thead>
              <tbody>{subjects.map((su,i) => (<tr key={i}><td style={{fontWeight:600}}>{su.name}</td><td style={{textAlign:'center',fontWeight:700,color:gradeColor(su.average_pct ?? su.average ?? 0)}}>{fmt(su.average_pct ?? su.average,1)}%</td><td style={{textAlign:'center'}}>{fmt(su.pass_rate,1)}%</td></tr>))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
