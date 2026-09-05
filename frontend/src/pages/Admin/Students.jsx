import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Plus } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { Toast } from '../../components/ui.jsx';

export default function AdminStudents() {
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [classLabel, setClassLabel] = useState('');
  const [students, setStudents] = useState([]);
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (m, t = 'success') => { setToast({ message: m, type: t }); setTimeout(() => setToast(null), 2600); };

  useEffect(() => {
    api.get('/admin/classes').then(r => {
      setClasses(r.data);
      if (r.data.length) {
        const first = r.data.find(c => c.id === user?.assigned_class_id) || r.data[0];
        setClassId(String(first.id));
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const c = classes.find(c => String(c.id) === classId);
    setClassLabel(c ? c.label : '');
    if (classId) loadStudents();
  }, [classId, classes]);

  const loadStudents = async () => {
    try { const r = await api.get(`/admin/students/class/${classId}`); setStudents(r.data); } catch {}
  };

  const addStudent = async (e) => {
    e.preventDefault();
    if (!name.trim() || !classId) return;
    try {
      await api.post('/admin/students', { name, roll_no: rollNo, class_id: parseInt(classId) });
      setName(''); setRollNo(''); showToast('Student added'); loadStudents();
    } catch { showToast('Error adding student', 'error'); }
  };

  const exportCsv = () => {
    if (!students.length) { showToast('Nothing to export', 'error'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = 'Roll No,Name,Class\n';
    const body = students.map((s) => [s.roll_no ?? '', s.name, classLabel].map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(classLabel || 'class').replace(/\s+/g, '-').toLowerCase()}-students.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${students.length} students`);
  };

  if (loading) return <Page><div className="card" style={{ padding: 60, textAlign: 'center' }}>Loading…</div></Page>;

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · School Administration</div>
          <h1>Students</h1>
          <div className="subtitle">Manage students {classLabel ? `in ${classLabel}` : ''}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="section-title" style={{ margin: 0 }}>Add Student</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} title="Export this class's students to CSV">
            <Download size={15} strokeWidth={2.2} /> Export CSV
          </button>
        </div>
        <form onSubmit={addStudent} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="form-field-block">
            <span className="field-label">Class</span>
            <select className="input" value={classId} onChange={e => setClassId(e.target.value)}>
              {classes.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="form-field-block" style={{ flex: 1, minWidth: 220 }}>
            <span className="field-label">Full name</span>
            <input type="text" placeholder="Student name" value={name} onChange={e => setName(e.target.value)} className="input" required />
          </label>
          <label className="form-field-block" style={{ width: 140 }}>
            <span className="field-label">Roll No</span>
            <input type="text" value={rollNo} onChange={e => setRollNo(e.target.value)} className="input" />
          </label>
          <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Add Student</button>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>#</th>
              <th>Name</th>
              <th style={{ width: 140 }}>Roll No</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => (
              <motion.tr key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.025, 0.5) }}>
                <td style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600 }}>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td style={{ textAlign: 'center' }}>{s.roll_no || '—'}</td>
              </motion.tr>
            ))}
            {!students.length && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>No students in this class yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
