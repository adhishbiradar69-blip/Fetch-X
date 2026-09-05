import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCheck, Briefcase, Target, Users, User, Trash2, Check, Plus } from 'lucide-react';
import api from '../../api/client';
import { Page, EASE, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { CountUp, Toast } from '../../components/ui.jsx';

const ROLES = [
  { id: 'class_teacher', label: 'Class Teacher', accent: 'a-indigo', Icon: UserCheck, desc: 'Teaches & marks one class' },
  { id: 'principal', label: 'Principal', accent: 'a-teal', Icon: Briefcase, desc: 'Manages one school' },
  { id: 'chairperson', label: 'Chairperson', accent: 'a-amber', Icon: Target, desc: 'Oversees multiple schools' },
  { id: 'parent', label: 'Parent', accent: 'a-pink', Icon: Users, desc: 'Views their child\'s progress' },
];

export default function AccountCreation() {
  const [toast, setToast] = useState(null);
  const showToast = (m, t = 'success') => { setToast({ message: m, type: t }); setTimeout(() => setToast(null), 2600); };

  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const [role, setRole] = useState('class_teacher');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [schoolIds, setSchoolIds] = useState([]);

  const refresh = async () => {
    try {
      const [s, c, acc] = await Promise.all([
        api.get('/admin/schools'), api.get('/admin/classes'), api.get('/admin/accounts'),
      ]);
      setSchools(s.data); setClasses(c.data); setAccounts(acc.data);
    } catch (e) { console.error(e); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (schools.length && !schoolId) setSchoolId(String(schools[0].id)); }, [schools, schoolId]);
  useEffect(() => {
    const myClasses = classes.filter(c => !schoolId || c.school_id === parseInt(schoolId));
    if (myClasses.length && !classId) setClassId(String(myClasses[0].id));
  }, [schoolId, classes, classId]);
  useEffect(() => {
    if (role === 'parent' && classId) {
      api.get(`/admin/students/class/${classId}`).then(r => {
        setStudents(r.data);
        if (r.data.length && !studentId) setStudentId(String(r.data[0].id));
      }).catch(() => setStudents([]));
    }
  }, [role, classId, studentId]);

  const toggleSchool = (id) => {
    const sid = Number(id);
    setSchoolIds(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email || !password) { showToast('Email and password are required', 'error'); return; }
    const payload = { email, password, full_name: fullName || undefined, role };
    if (role === 'class_teacher') payload.assigned_class_id = parseInt(classId);
    if (role === 'principal') payload.school_id = parseInt(schoolId);
    if (role === 'chairperson') payload.school_ids = schoolIds;
    if (role === 'parent') payload.student_id = parseInt(studentId);
    try {
      await api.post('/admin/accounts', payload);
      setEmail(''); setFullName(''); setPassword(''); setSchoolIds([]);
      showToast('Account created'); refresh();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to create account', 'error');
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this account?')) return;
    try { await api.delete(`/admin/accounts/${id}`); showToast('Account deleted'); refresh(); }
    catch { showToast('Failed', 'error'); }
  };

  const myClasses = classes.filter(c => !schoolId || c.school_id === parseInt(schoolId));

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Access Control</div>
          <h1>Account Creation</h1>
          <div className="subtitle">Create role-based accounts — no public registration</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24 }} className="accounts-grid">
        {/* Create form */}
        <div className="card" style={{ padding: 24 }}>
          {/* Role picker */}
          <h3 className="section-title" style={{ marginBottom: 16 }}>Role</h3>
          <div className="role-picker">
            {ROLES.map(r => {
              const RoleIcon = r.Icon;
              return (
                <motion.button key={r.id} type="button" className={`role-card ${role === r.id ? 'active' : ''}`}
                  whileHover={{ y: -3 }} whileTap={{ scale: 0.97 }}
                  onClick={() => setRole(r.id)}>
                  <span className="role-icon"><RoleIcon size={22} /></span>
                  <span className="role-name">{r.label}</span>
                  <span className="role-desc">{r.desc}</span>
                </motion.button>
              );
            })}
          </div>

          <form onSubmit={submit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Full name"
                value={fullName} onChange={e => setFullName(e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 180 }} type="email" placeholder="Email"
                value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <input className="input" type="password" placeholder="Password"
              value={password} onChange={e => setPassword(e.target.value)} required />

            <AnimatePresence mode="wait">
              <motion.div key={role} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
                {role === 'class_teacher' && (
                  <div className="assign-block">
                    <label className="field-label">Assign class</label>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)}>
                        {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <select className="input" value={classId} onChange={e => setClassId(e.target.value)}>
                        {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                {role === 'principal' && (
                  <div className="assign-block">
                    <label className="field-label">Assign school</label>
                    <select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)}>
                      {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                {role === 'chairperson' && (
                  <div className="assign-block">
                    <label className="field-label">Select schools to oversee</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {schools.map(s => {
                        const on = schoolIds.includes(s.id);
                        return (
                          <motion.button key={s.id} type="button" className={`chip ${on ? 'chip-on' : ''}`}
                            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                            onClick={() => toggleSchool(s.id)}>
                            {on && <Check size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} />} {s.name}
                          </motion.button>
                        );
                      })}
                      {!schools.length && <span className="empty-mini">Add schools first.</span>}
                    </div>
                  </div>
                )}
                {role === 'parent' && (
                  <div className="assign-block">
                    <label className="field-label">Link to child</label>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)}>
                        {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <select className="input" value={classId} onChange={e => setClassId(e.target.value)}>
                        {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <select className="input" value={studentId} onChange={e => setStudentId(e.target.value)}>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', padding: '12px 32px' }}>
              <Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Create {ROLES.find(r => r.id === role).label} Account
            </button>
          </form>
        </div>

        {/* Accounts list */}
        <div className="card" style={{ padding: 24, maxHeight: '70vh', overflowY: 'auto' }} >
          <h3 className="section-title">Accounts ({accounts.length})</h3>
          <motion.div variants={staggerContainer} initial="initial" animate="animate">
            <AnimatePresence>
              {accounts.map(a => {
                const r = ROLES.find(x => x.id === a.role);
                const AccIcon = r?.Icon || User;
                return (
                  <motion.div key={a.id} className="account-row" variants={staggerItem}
                    exit={{ opacity: 0, x: 20 }}>
                    <div className="account-info">
                      <span className="account-avatar">
                        <AccIcon size={18} />
                      </span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{a.full_name || a.email}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.email}</div>
                      </div>
                    </div>
                    <div className="account-meta">
                      <span className="pill-tag" style={{ textTransform: 'capitalize' }}>
                        {a.role.replace('_', ' ')}
                      </span>
                      <button className="icon-del" onClick={() => del(a.id)} title="Delete"><Trash2 size={16} /></button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {!accounts.length && <div className="empty-mini">No accounts yet.</div>}
          </motion.div>
        </div>
      </div>

      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 24 }}>
        <div className="card-stats cols-4">
          {ROLES.map(r => {
            const count = accounts.filter(a => a.role === r.id).length;
            const RoleIcon = r.Icon;
            return (
              <motion.div key={r.id} variants={staggerItem} className={`stat-cell ${r.accent}`}>
                <div className="ic"><RoleIcon size={15} strokeWidth={2.2} /></div>
                <div>
                  <div className="k">{r.label}s</div>
                  <div className="v"><CountUp value={count} /></div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </Page>
  );
}
