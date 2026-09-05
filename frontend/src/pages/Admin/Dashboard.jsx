import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, Building2, Library, GraduationCap, Palette, PenLine, Link2,
  Zap, Sprout, Plus, Check, KeyRound, ArrowRight,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, EASE, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { CountUp, Toast } from '../../components/ui.jsx';

const TABS = [
  { id: 'overview', label: 'Overview', Icon: TrendingUp },
  { id: 'schools', label: 'Schools', Icon: Building2 },
  { id: 'classes', label: 'Classes', Icon: Library },
  { id: 'students', label: 'Students', Icon: GraduationCap },
  { id: 'subjects', label: 'Subjects', Icon: Palette },
  { id: 'exams', label: 'Exams', Icon: PenLine },
  { id: 'assignments', label: 'Assignments', Icon: Link2 },
];

const grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const sectionOptions = ['A', 'B', 'C', 'D'];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState(null);
  const showToast = (m, t = 'success') => { setToast({ message: m, type: t }); setTimeout(() => setToast(null), 2600); };

  // shared data
  const [schools, setSchools] = useState([]);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [accounts, setAccounts] = useState([]);

  const refreshAll = useCallback(async () => {
    try {
      const [s, c, sub, acc] = await Promise.all([
        api.get('/admin/schools'),
        api.get('/admin/classes'),
        api.get('/admin/subjects'),
        api.get('/admin/accounts'),
      ]);
      setSchools(s.data); setClasses(c.data); setSubjects(sub.data); setAccounts(acc.data);
    } catch (e) { console.error(e); }
  }, []);
  useEffect(() => { refreshAll(); }, [refreshAll]);

  const isSchoolAdmin = user?.role === 'school_admin';
  const visibleTabs = TABS.filter(t => !(isSchoolAdmin && (t.id === 'schools' || t.id === 'assignments')));
  useEffect(() => {
    if (isSchoolAdmin && (tab === 'schools' || tab === 'assignments')) setTab('overview');
  }, [isSchoolAdmin, tab]);

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · School Administration</div>
          <h1>Admin Dashboard</h1>
          <div className="subtitle">Manage schools, classes, students, subjects, exams &amp; accounts</div>
        </div>
      </div>

      {/* Tab bar — Fetch-X pill tabs */}
      <div className="grade-tabs" style={{ marginBottom: 20 }}>
        {visibleTabs.map(t => {
          const TabIcon = t.Icon;
          return (
            <button key={t.id} className={`gtab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}>
              <span className="tab-icon"><TabIcon size={13} strokeWidth={2.4} /></span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="admin-tab-body">
        <AnimatePresence mode="wait">
          <motion.div key={tab}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: EASE }}>
            {tab === 'overview' && <Overview schools={schools} classes={classes} subjects={subjects} accounts={accounts} user={user} onDone={refreshAll} showToast={showToast} />}
            {tab === 'schools' && <SchoolsTab schools={schools} onDone={refreshAll} showToast={showToast} user={user} />}
            {tab === 'classes' && <ClassesTab schools={schools} classes={classes} accounts={accounts} onDone={refreshAll} showToast={showToast} user={user} />}
            {tab === 'students' && <StudentsTab schools={schools} classes={classes} onDone={refreshAll} showToast={showToast} user={user} />}
            {tab === 'subjects' && <SubjectsTab subjects={subjects} schools={schools} onDone={refreshAll} showToast={showToast} user={user} />}
            {tab === 'exams' && <ExamsTab schools={schools} onDone={refreshAll} showToast={showToast} user={user} />}
            {tab === 'assignments' && <AssignmentsTab schools={schools} classes={classes} accounts={accounts} onDone={refreshAll} showToast={showToast} user={user} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </Page>
  );
}

/* ── Overview ── */
function Overview({ schools, classes, subjects, accounts, user, onDone, showToast }) {
  const [seedingFull, setSeedingFull] = useState(false);
  const [seedingBasic, setSeedingBasic] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';

  const stats = [
    { label: 'Schools', value: schools.length, Icon: Building2, accent: 'a-indigo' },
    { label: 'Classes', value: classes.length, Icon: Library, accent: 'a-teal' },
    { label: 'Subjects', value: subjects.length, Icon: Palette, accent: 'a-amber' },
    { label: 'Accounts', value: accounts.length, Icon: KeyRound, accent: 'a-pink' },
  ];

  const seedFull = async () => {
    setSeedingFull(true);
    try {
      const r = await api.post('/admin/seed-full');
      const d = r.data || {};
      showToast(`Seeded ${d.schools || 0} schools, ${d.classes || 0} classes, ${d.students || 0} students, ${d.accounts || 0} accounts!`);
      onDone();
    } catch (e) {
      if (e.response?.status === 403) showToast('Only Super Admin can seed full data', 'error');
      else showToast('Failed to seed full data', 'error');
    } finally { setSeedingFull(false); }
  };

  const seedBasic = async () => {
    setSeedingBasic(true);
    try {
      const r = await api.post('/admin/seed');
      const d = r.data || {};
      showToast(d.schools ? `Seeded basic data (${d.schools} schools)` : 'Seeded basic data');
      onDone();
    } catch {
      showToast('Failed to seed basic data', 'error');
    } finally { setSeedingBasic(false); }
  };

  return (
    <>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 4 }}>
        <div className="card-stats cols-4">
          {stats.map(s => {
            const SIcon = s.Icon;
            return (
              <motion.div key={s.label} variants={staggerItem} className={`stat-cell ${s.accent}`}>
                <div className="ic"><SIcon size={16} strokeWidth={2.2} /></div>
                <div>
                  <div className="k">{s.label}</div>
                  <div className="v"><CountUp value={s.value} /></div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.4, ease: EASE }}
        className="card" style={{ padding: 26, marginTop: 24, textAlign: 'center' }}>
        <h3 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Zap size={18} color="var(--brand)" /> Quick Setup
        </h3>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          {isSuperAdmin && (
            <motion.button type="button" onClick={seedFull} disabled={seedingFull}
              whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              className="btn btn-primary"
              style={{ minWidth: 250, cursor: seedingFull ? 'wait' : 'pointer' }}>
              {seedingFull ? <><Spinner /> Seeding…</> : <><Sprout size={18} /> Seed Full Demo Data</>}
            </motion.button>
          )}
          <motion.button type="button" onClick={seedBasic} disabled={seedingBasic}
            whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
            className="btn btn-ghost"
            style={{ minWidth: 250, cursor: seedingBasic ? 'wait' : 'pointer' }}>
            {seedingBasic ? <><Spinner /> Seeding…</> : <><Sprout size={18} /> Seed Basic (Greenwood)</>}
          </motion.button>
        </div>
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--body-text)' }}>
          Quickly populate the database with realistic demo data across 3 schools.
        </div>
      </motion.div>
    </>
  );
}

/* ── Schools ── */
function SchoolsTab({ schools, onDone, showToast, user }) {
  const [name, setName] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await api.post('/admin/schools', { name }); setName(''); showToast('School created'); onDone(); }
    catch { showToast('Failed to create school', 'error'); }
  };
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <h3 className="section-title">Add School</h3>
        <form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="School name (e.g. Greenwood High)"
            value={name} onChange={e => setName(e.target.value)} required />
          <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Add School</button>
        </form>
      </div>
      <div className="admin-list">
        <AnimatePresence>
          {schools.map((s, i) => (
            <motion.div key={s.id} className="admin-list-item"
              initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }} transition={{ delay: i * 0.04, ease: EASE }} whileHover={{ scale: 1.02 }}>
              <span className="list-icon"><Building2 size={18} color="var(--accent)" /></span>
              <span style={{ fontWeight: 700 }}>{s.name}</span>
              <span className="list-id">#{s.id}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {!schools.length && <div className="empty-mini">No schools yet — add one above.</div>}
      </div>
    </motion.div>
  );
}

/* ── Classes ── */
function ClassesTab({ schools, classes, accounts, onDone, showToast, user }) {
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState('1');
  const [section, setSection] = useState('A');
  const teachers = accounts.filter(a => a.role === 'class_teacher');
  const isSchoolAdmin = user?.role === 'school_admin';

  useEffect(() => {
    if (isSchoolAdmin && user.school_id) { if (schoolId !== String(user.school_id)) setSchoolId(String(user.school_id)); return; }
    if (schools.length && !schoolId) setSchoolId(String(schools[0].id));
  }, [schools, schoolId, isSchoolAdmin, user]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/classes', { school_id: parseInt(schoolId), grade: parseInt(grade), section });
      showToast('Class created'); onDone();
    } catch { showToast('Failed to create class', 'error'); }
  };
  const assignTeacher = async (classId, userId) => {
    if (!userId) return;
    try { await api.post(`/admin/assign/class-teacher?class_id=${classId}`, { user_id: parseInt(userId) }); showToast('Teacher assigned'); onDone(); }
    catch { showToast('Assignment failed', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <h3 className="section-title">Add Class</h3>
        <form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="School"><select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={isSchoolAdmin}>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></Field>
          <Field label="Grade"><select className="input" value={grade} onChange={e => setGrade(e.target.value)}>
            {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
          </select></Field>
          <Field label="Section"><select className="input" value={section} onChange={e => setSection(e.target.value)}>
            {sectionOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select></Field>
          <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Add Class</button>
        </form>
      </div>
      <div className="admin-list">
        <AnimatePresence>
          {classes.map((c, i) => (
            <motion.div key={c.id} className="admin-list-item admin-list-item-row"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ delay: i * 0.03, ease: EASE }} whileHover={{ scale: 1.02 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="list-icon"><Library size={18} color="var(--accent)" /></span>
                <span style={{ fontWeight: 700 }}>{c.label}</span>
                <span className="pill-tag">
                  {schools.find(s => s.id === c.school_id)?.name || `School #${c.school_id}`}
                </span>
                {c.class_teacher && <span className="teach-pill"><b>{c.class_teacher.name}</b></span>}
              </div>
              <select className="input input-sm" defaultValue={c.class_teacher?.id || ''}
                onChange={e => assignTeacher(c.id, e.target.value)}>
                <option value="">Assign teacher…</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
              </select>
            </motion.div>
          ))}
        </AnimatePresence>
        {!classes.length && <div className="empty-mini">No classes yet — add one above.</div>}
      </div>
    </motion.div>
  );
}

/* ── Students ── */
function StudentsTab({ schools, classes, onDone, showToast, user }) {
  const [schoolId, setSchoolId] = useState('');
  const [classId, setClassId] = useState('');
  const [name, setName] = useState('');
  const [rollNo, setRollNo] = useState('');
  const [list, setList] = useState([]);
  const isSchoolAdmin = user?.role === 'school_admin';

  useEffect(() => {
    if (isSchoolAdmin && user.school_id) { if (schoolId !== String(user.school_id)) setSchoolId(String(user.school_id)); return; }
    if (schools.length && !schoolId) setSchoolId(String(schools[0].id));
  }, [schools, schoolId, isSchoolAdmin, user]);
  useEffect(() => {
    setClassId('');
    if (schoolId) {
      api.get(`/admin/classes/school/${schoolId}`).then(r => {
        if (r.data.length) setClassId(String(r.data[0].id));
      }).catch(() => {});
    }
  }, [schoolId]);
  useEffect(() => { if (classId) loadList(); }, [classId]);

  const loadList = async () => {
    try { const r = await api.get(`/admin/students/class/${classId}`); setList(r.data); } catch {}
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !classId) return;
    try {
      await api.post('/admin/students', { name, roll_no: rollNo, class_id: parseInt(classId) });
      setName(''); setRollNo(''); showToast('Student added'); loadList(); onDone();
    } catch { showToast('Failed to add student', 'error'); }
  };

  const myClasses = classes.filter(c => !schoolId || c.school_id === parseInt(schoolId));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <h3 className="section-title">Add Student</h3>
        <form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="School"><select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={isSchoolAdmin}>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></Field>
          <Field label="Class"><select className="input" value={classId} onChange={e => setClassId(e.target.value)}>
            {myClasses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></Field>
          <Field label="Full name"><input className="input" placeholder="Student name" value={name}
            onChange={e => setName(e.target.value)} required /></Field>
          <Field label="Roll No"><input className="input" style={{ width: 100 }} value={rollNo}
            onChange={e => setRollNo(e.target.value)} /></Field>
          <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Add Student</button>
        </form>
      </div>
      <div className="admin-list">
        <AnimatePresence>
          {list.map((s, i) => (
            <motion.div key={s.id} className="admin-list-item"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, ease: EASE }} whileHover={{ scale: 1.02 }}>
              <span className="list-icon"><GraduationCap size={18} color="var(--accent)" /></span>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span className="list-id">Roll #{s.roll_no || s.id}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        {!list.length && <div className="empty-mini">No students in this class yet.</div>}
      </div>
    </motion.div>
  );
}

/* ── Subjects + grade config ── */
function SubjectsTab({ subjects, schools, onDone, showToast, user }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState('1');
  const [gradeFrom, setGradeFrom] = useState('1');
  const [gradeTo, setGradeTo] = useState('5');
  const [gradeSubs, setGradeSubs] = useState([]);
  const isSchoolAdmin = user?.role === 'school_admin';

  useEffect(() => {
    if (isSchoolAdmin && user.school_id) { if (schoolId !== String(user.school_id)) setSchoolId(String(user.school_id)); return; }
    if (schools.length && !schoolId) setSchoolId(String(schools[0].id));
  }, [schools, schoolId, isSchoolAdmin, user]);
  const loadGradeSubs = async () => {
    if (!schoolId) return;
    try { const r = await api.get(`/admin/grade-subjects/${schoolId}/${grade}`); setGradeSubs(r.data); } catch {}
  };
  useEffect(() => { loadGradeSubs(); }, [schoolId, grade]);

  const createSubject = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { await api.post('/admin/subjects', { name, color }); setName(''); showToast('Subject created'); onDone(); }
    catch { showToast('Failed', 'error'); }
  };
  const toggleGradeSubject = async (subId, on) => {
    try {
      if (on) await api.post('/admin/grade-subjects', { school_id: parseInt(schoolId), grade: parseInt(grade), subject_id: subId });
      else await api.delete(`/admin/grade-subjects?school_id=${schoolId}&grade=${grade}&subject_id=${subId}`);
      loadGradeSubs();
    } catch { showToast('Failed', 'error'); }
  };
  const applyRange = async () => {
    const gf = parseInt(gradeFrom), gt = parseInt(gradeTo);
    if (!schoolId) { showToast('Pick a school first', 'error'); return; }
    if (!gradeSubs.length) { showToast('Toggle some subjects for the selected grade first', 'error'); return; }
    if (gf > gt) { showToast('From grade must be ≤ To grade', 'error'); return; }
    try {
      await api.post('/admin/grade-subjects/range', {
        school_id: parseInt(schoolId), grade_from: gf, grade_to: gt,
        subject_ids: gradeSubs.map(s => s.id),
      });
      showToast(`Applied to grades ${gf}-${gt}`);
    } catch { showToast('Failed to apply range', 'error'); }
  };

  const gradeSubIds = new Set(gradeSubs.map(s => s.id));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }} className="subjects-grid">
        <div className="card" style={{ padding: 22 }}>
          <h3 className="section-title">Create Subject</h3>
          <form onSubmit={createSubject} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="input" placeholder="Subject name" value={name} onChange={e => setName(e.target.value)} required />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: 48, height: 40, border: 'none', borderRadius: 8, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{color}</span>
            </div>
            <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Add Subject</button>
          </form>
          <div style={{ marginTop: 20 }}>
            {subjects.map((s, i) => (
              <motion.div key={s.id} className="admin-list-item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }} whileHover={{ scale: 1.02 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: s.color }} />
                <span style={{ fontWeight: 600 }}>{s.name}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 22 }}>
          <h3 className="section-title">Subjects per Grade</h3>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={isSchoolAdmin}>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="input" value={grade} onChange={e => setGrade(e.target.value)} style={{ width: 120 }}>
              {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
          </div>
          <div className="assign-block" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Apply subjects to grade range:</span>
            <select className="input input-sm" value={gradeFrom} onChange={e => setGradeFrom(e.target.value)} style={{ width: 90 }}>
              {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
            <ArrowRight size={15} color="var(--brand)" />
            <select className="input input-sm" value={gradeTo} onChange={e => setGradeTo(e.target.value)} style={{ width: 90 }}>
              {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select>
            <motion.button type="button" className="btn btn-primary" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} onClick={applyRange}>Apply</motion.button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {subjects.map(s => {
              const on = gradeSubIds.has(s.id);
              return (
                <motion.label key={s.id} className="grade-sub-row" whileHover={{ x: 3, scale: 1.02 }} style={{ borderLeft: `3px solid ${s.color}` }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <input type="checkbox" checked={on} onChange={e => toggleGradeSubject(s.id, e.target.checked)} />
                </motion.label>
              );
            })}
            {!subjects.length && <div className="empty-mini">Create subjects first.</div>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Exams ── */
function ExamsTab({ schools, onDone, showToast, user }) {
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState('1');
  const [gradeFrom, setGradeFrom] = useState('1');
  const [gradeTo, setGradeTo] = useState('5');
  const [useRange, setUseRange] = useState(false);
  const [name, setName] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  const [term, setTerm] = useState('Term 1');
  const [list, setList] = useState([]);
  const isSchoolAdmin = user?.role === 'school_admin';

  useEffect(() => {
    if (isSchoolAdmin && user.school_id) { if (schoolId !== String(user.school_id)) setSchoolId(String(user.school_id)); return; }
    if (schools.length && !schoolId) setSchoolId(String(schools[0].id));
  }, [schools, schoolId, isSchoolAdmin, user]);
  const load = async () => {
    if (!schoolId) return;
    try { const r = await api.get(`/admin/exams?school_id=${schoolId}&grade=${grade}`); setList(r.data); } catch {}
  };
  useEffect(() => { load(); }, [schoolId, grade]);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      if (useRange) {
        const gf = parseInt(gradeFrom), gt = parseInt(gradeTo);
        if (gf > gt) { showToast('From grade must be ≤ To grade', 'error'); return; }
        const r = await api.post('/admin/exams/range', {
          school_id: parseInt(schoolId), grade_from: gf, grade_to: gt,
          name, max_score: parseInt(maxScore), term,
        });
        const n = r.data?.created ?? (gt - gf + 1);
        setName(''); showToast(`Created exam for grades ${gf}-${gt} (${n} exams)`);
      } else {
        await api.post('/admin/exams', { school_id: parseInt(schoolId), grade: parseInt(grade), name, max_score: parseInt(maxScore), term });
        setName(''); showToast('Exam created');
      }
      load(); onDone();
    } catch { showToast('Failed', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="card" style={{ padding: 22, marginBottom: 24 }}>
        <h3 className="section-title">Create Exam</h3>
        <form onSubmit={submit} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="School"><select className="input" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={isSchoolAdmin}>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></Field>
          {useRange ? (
            <>
              <Field label="Grade from"><select className="input" value={gradeFrom} onChange={e => setGradeFrom(e.target.value)}>
                {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
              </select></Field>
              <Field label="Grade to"><select className="input" value={gradeTo} onChange={e => setGradeTo(e.target.value)}>
                {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
              </select></Field>
            </>
          ) : (
            <Field label="Grade"><select className="input" value={grade} onChange={e => setGrade(e.target.value)}>
              {grades.map(g => <option key={g} value={g}>Grade {g}</option>)}
            </select></Field>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--body-text)', paddingBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={useRange} onChange={e => setUseRange(e.target.checked)} style={{ accentColor: '#5b4fe9' }} />
            Create for grade range
          </label>
          <Field label="Exam name"><input className="input" placeholder="e.g. Midterm" value={name} onChange={e => setName(e.target.value)} required /></Field>
          <Field label="Max score"><input type="number" min="1" className="input" style={{ width: 110 }} value={maxScore} onChange={e => setMaxScore(e.target.value)} /></Field>
          <Field label="Term"><input className="input" style={{ width: 130 }} value={term} onChange={e => setTerm(e.target.value)} /></Field>
          <button type="submit" className="btn btn-primary"><Plus size={16} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Create Exam</button>
        </form>
      </div>
      <div className="admin-list">
        <AnimatePresence>
          {list.map((e, i) => (
            <motion.div key={e.id} className="admin-list-item"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, ease: EASE }} whileHover={{ scale: 1.02 }}>
              <span className="list-icon"><PenLine size={18} color="var(--accent)" /></span>
              <span style={{ fontWeight: 700 }}>{e.name}</span>
              <span className="pill-tag">Grade {e.grade}</span>
              <span className="pill-tag">Max {e.max_score}</span>
              {e.term && <span className="list-id">{e.term}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
        {!list.length && <div className="empty-mini">No exams for this grade yet.</div>}
      </div>
    </motion.div>
  );
}

/* ── Assignments ── */
function AssignmentsTab({ schools, classes, accounts, onDone, showToast, user }) {
  const principals = accounts.filter(a => a.role === 'principal');
  const chairpersons = accounts.filter(a => a.role === 'chairperson');

  const assignPrincipal = async (userId, schoolId) => {
    if (!userId || !schoolId) return;
    try { await api.post(`/admin/assign/principal?school_id=${schoolId}`, { user_id: parseInt(userId) }); showToast('Principal assigned'); onDone(); }
    catch { showToast('Failed', 'error'); }
  };
  const toggleChairSchool = async (userId, schoolId, add) => {
    try {
      const acc = accounts.find(a => a.id === userId);
      const ids = new Set(acc?.school_ids || []);
      if (add) ids.add(schoolId); else ids.delete(schoolId);
      await api.post(`/admin/assign/chairperson?school_ids=${[...ids].join(',')}`, { user_id: userId });
      onDone();
    } catch { showToast('Failed', 'error'); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gap: 24, gridTemplateColumns: '1fr 1fr' }} className="assign-grid">
      <div className="card" style={{ padding: 22 }}>
        <h3 className="section-title">Assign Principal → School</h3>
        <div className="admin-list">
          {schools.map(s => {
            const assigned = principals.find(p => p.school_id === s.id);
            return (
              <motion.div key={s.id} className="admin-list-item admin-list-item-row" whileHover={{ scale: 1.02 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="list-icon"><Building2 size={18} color="var(--accent)" /></span><span style={{ fontWeight: 600 }}>{s.name}</span>
                </div>
                <select className="input input-sm" defaultValue={assigned?.id || ''}
                  onChange={e => assignPrincipal(e.target.value, s.id)}>
                  <option value="">{assigned ? assigned.full_name || assigned.email : 'Assign principal…'}</option>
                  {principals.filter(p => !assigned || p.id !== assigned.id).map(p =>
                    <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                </select>
              </motion.div>
            );
          })}
          {!schools.length && <div className="empty-mini">Add schools first.</div>}
        </div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h3 className="section-title">Assign Chairperson → Schools</h3>
        {!chairpersons.length
          ? <div className="empty-mini">No chairperson accounts yet. Create one in Accounts.</div>
          : chairpersons.map(ch => (
            <div key={ch.id} style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{ch.full_name || ch.email}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {schools.map(s => {
                  const on = (ch.school_ids || []).includes(s.id);
                  return (
                    <motion.button key={s.id} type="button" className={`chip ${on ? 'chip-on' : ''}`}
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={() => toggleChairSchool(ch.id, s.id, !on)}>
                      {on && <Check size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} />} {s.name}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </motion.div>
  );
}

/* ── helpers ── */
function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

/* Small spinning loader for inline use (e.g. on loading buttons). */
function Spinner() {
  return (
    <motion.span
      style={{
        display: 'inline-block', width: 16, height: 16, borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.35)', borderTopColor: '#fff',
        boxSizing: 'border-box', verticalAlign: 'middle',
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
    />
  );
}
