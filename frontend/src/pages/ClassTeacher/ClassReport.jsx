import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GraduationCap, BarChart3 } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { SkeletonPage } from '../../components/Skeleton.jsx';
import { CountUp } from '../../components/ui.jsx';

export default function ClassReport() {
  const { user } = useAuth();
  const classId = user?.assigned_class_id;
  const [report, setReport] = useState([]);
  const [classLabel, setClassLabel] = useState('your class');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) { setLoading(false); return; }
    Promise.all([
      api.get(`/academics/class/${classId}/report`),
      api.get('/attendance/teacher/classes'),
    ]).then(([r, c]) => {
      setReport(r.data);
      const found = c.data.find(c => c.id === classId);
      if (found) setClassLabel(found.label);
    }).catch(console.error).finally(() => setLoading(false));
  }, [classId]);

  if (loading) return <SkeletonPage eyebrowW={88} titleW={220} subW={340} stats={3} charts={0} rows={5} />;

  const avg = report.length ? (report.reduce((a, b) => a + b.average_score, 0) / report.length).toFixed(1) : 0;

  return (
    <Page>
      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Class Teacher</div>
          <h1>Class Report</h1>
          <div className="subtitle">Academic overview for {classLabel}</div>
        </div>
      </div>

      <motion.div variants={staggerContainer} initial="initial" animate="animate"
        className="card" style={{ marginTop: 6 }}>
        <div className="card-stats cols-2">
          <motion.div variants={staggerItem} className="stat-cell a-indigo">
            <div className="ic"><GraduationCap size={15} strokeWidth={2.2} /></div>
            <div>
              <div className="k">Total Students</div>
              <div className="v"><CountUp value={report.length} /></div>
            </div>
          </motion.div>
          <motion.div variants={staggerItem} className="stat-cell a-teal">
            <div className="ic"><BarChart3 size={15} strokeWidth={2.2} /></div>
            <div>
              <div className="k">Class Average</div>
              <div className="v"><CountUp value={avg} decimals={1} /><span className="of">%</span></div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th><th>Student</th>
              <th style={{ textAlign: 'center' }}>Exams</th>
              <th style={{ textAlign: 'center' }}>Average %</th>
              <th style={{ textAlign: 'center' }}>Grade</th>
            </tr>
          </thead>
          <tbody>
            {report.map((s, i) => {
              const score = s.average_score;
              const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D';
              const gradeCls = score >= 80 ? 'pill-grade-a' : score >= 60 ? 'pill-grade-b' : 'pill-grade-d';
              return (
                <motion.tr key={s.student_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td style={{ textAlign: 'center', color: 'var(--body-text)' }}>{s.exams}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: score >= 80 ? 'var(--teal)' : score >= 60 ? 'var(--amber)' : 'var(--danger)' }}>{score}%</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`pill ${gradeCls}`} style={{ minWidth: 50 }}>{grade}</span>
                  </td>
                </motion.tr>
              );
            })}
            {!report.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No report data yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
