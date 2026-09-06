import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, X, Circle, FileText, Trash2, ChevronDown, Plus } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, EASE, SPRING, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { Toast } from '../../components/ui.jsx';

export default function TaskManager() {
  const { user } = useAuth();
  const classId = user?.assigned_class_id;

  const [tasks, setTasks] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [expandedTask, setExpandedTask] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [creating, setCreating] = useState(false);
  const showToast = (m, t = 'success') => { setToast({ message: m, type: t }); setTimeout(() => setToast(null), 2600); };

  useEffect(() => { if (classId) { fetchTasks(); fetchSubjects(); } }, [classId]);

  const fetchTasks = async () => {
    setLoading(true);
    try { const r = await api.get(`/tasks/class/${classId}`); setTasks(r.data); } catch (e) { console.error(e); }
    setLoading(false);
  };
  const fetchSubjects = async () => {
    try { const r = await api.get('/tasks/subjects'); setSubjects(r.data); if (r.data.length) setSelectedSubject(String(r.data[0].id)); } catch {}
  };

  const createTask = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim()) { showToast('Please enter a task name', 'error'); return; }
    if (!selectedSubject) { showToast('Please select a subject', 'error'); return; }
    setCreating(true);
    try {
      await api.post('/tasks/', { title: taskTitle, due_date: dueDate || null, class_id: classId, subject_id: parseInt(selectedSubject) });
      setTaskTitle(''); setDueDate(''); setShowForm(false); showToast('Task created!', 'success'); fetchTasks();
    } catch { showToast('Failed to create task', 'error'); }
    setCreating(false);
  };

  const toggleStatus = async (taskId, studentId, currentStatus) => {
    const next = currentStatus === 'completed' ? 'pending' : 'completed';
    try { await api.post('/tasks/status', { task_id: taskId, student_id: studentId, status: next }); fetchTasks(); }
    catch { showToast('Update failed', 'error'); }
  };
  const deleteTask = async (taskId) => {
    if (!confirm('Delete this task?')) return;
    try { await api.delete(`/tasks/${taskId}`); showToast('Task deleted', 'success'); fetchTasks(); if (expandedTask === taskId) setExpandedTask(null); }
    catch { showToast('Delete failed', 'error'); }
  };

  const getRate = (studs) => !studs.length ? 0 : Math.round(studs.filter(s => s.status === 'completed').length / studs.length * 100);
  const getStatusStyle = (status) => {
    if (status === 'completed') return { bg: '#d1fae5', color: '#047857', border: '#10b981', label: 'Done', Icon: Check };
    if (status === 'late') return { bg: '#fdeaea', color: '#b91c1c', border: '#ef4444', label: 'Late', Icon: X };
    return { bg: 'var(--chip)', color: 'var(--muted)', border: 'var(--line)', label: 'Pending', Icon: Circle };
  };

  if (!classId) return (
    <Page><div className="card" style={{ textAlign: 'center', padding: 60, marginTop: 40 }}>
      <AlertTriangle size={48} color="#d97706" style={{ marginBottom: 16 }} />
      <h3 style={{ fontSize: 20, fontWeight: 700 }}>No Class Assigned</h3>
      <p style={{ color: 'var(--body-text)' }}>Contact administrator.</p>
    </div></Page>
  );

  if (loading && !tasks.length && !showForm) return (
    <Page><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <p style={{ color: 'var(--body-text)' }}>Loading tasks...</p>
    </div></Page>
  );

  if (showForm) return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="pagehead"><div><div className="eyebrow">Fetch-X · Class Teacher</div><h1>Create New Task</h1><div className="subtitle">Set up an assignment for your class</div></div></div>
      <motion.div className="card form-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
        style={{ padding: 0, maxWidth: 720 }}>
        <div style={{ padding: '32px 36px', borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Task Details</h3>
          <div className="form-header-line" style={{ maxWidth: 80 }} />
        </div>
        <form onSubmit={createTask} style={{ padding: '32px 36px' }}>
          <div className="form-field" style={{ marginBottom: 24 }}>
            <label className="field-label">Task Name *</label>
            <input type="text" placeholder="e.g., Chapter 5 Exercise, Science Project..." value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)} className="input input-glow" style={{ fontSize: 16, padding: '14px 18px' }} required />
          </div>
          <div className="form-field" style={{ marginBottom: 24 }}>
            <label className="field-label">Subject *</label>
            {subjects.length === 0 ? (
              <p style={{ color: '#ef4444', fontSize: 14, fontWeight: 500 }}>No subjects found. Ask admin to configure subjects for this grade.</p>
            ) : (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {subjects.map((sub) => (
                  <motion.button key={sub.id} type="button" onClick={() => setSelectedSubject(String(sub.id))}
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    style={{ padding: '10px 20px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      background: selectedSubject === String(sub.id) ? sub.color : 'var(--surf)',
                      color: selectedSubject === String(sub.id) ? 'white' : 'var(--muted)',
                      boxShadow: selectedSubject === String(sub.id) ? '2px 3px 0 var(--shadow)' : 'none',
                      border: selectedSubject === String(sub.id) ? '1px solid transparent' : '1.5px solid var(--line)' }}>
                    {sub.name}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
          <div className="form-field" style={{ marginBottom: 32 }}>
            <label className="field-label">Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input input-glow" style={{ width: 'auto', fontSize: 15, padding: '12px 18px' }} />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Optional — leave blank if no deadline</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={() => { setTaskTitle(''); setDueDate(''); setShowForm(false); }} className="btn btn-secondary" style={{ padding: '12px 32px' }}>Cancel</button>
            <motion.button type="submit" className="btn btn-primary" disabled={creating} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} style={{ padding: '12px 32px' }}>
              {creating ? 'Creating...' : <><Check size={16} style={{ marginRight: 6, display: 'inline-flex', verticalAlign: '-2px' }} /> Create Task</>}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </Page>
  );

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="pagehead"><div><div className="eyebrow">Fetch-X · Class Teacher</div><h1>Tasks</h1><div className="subtitle">Assignments for your class</div></div></div>
      <div style={{ marginBottom: 28 }}>
        <motion.button onClick={() => setShowForm(true)} className="btn btn-primary" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} style={{ padding: '12px 28px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={16} /> New Task</motion.button>
      </div>

      {tasks.length === 0 ? (
        <motion.div className="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', padding: 60 }}>
          <motion.div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }} animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}><FileText size={48} color="var(--muted)" /></motion.div>
          <p style={{ color: 'var(--body-text)', fontWeight: 500 }}>No tasks yet. Create one above!</p>
        </motion.div>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {tasks.map(task => {
            const rate = getRate(task.students);
            const isExpanded = expandedTask === task.task_id;
            return (
              <motion.div key={task.task_id} variants={staggerItem} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <motion.div
                  onClick={() => setExpandedTask(isExpanded ? null : task.task_id)}
                  whileHover={{ backgroundColor: 'var(--hov)' }}
                  style={{ padding: '20px 24px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: `4px solid ${task.subject.color}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span className="teach-pill" style={{ background: `${task.subject.color}15`, color: task.subject.color, borderColor: 'transparent', textTransform: 'uppercase', letterSpacing: .5 }}>{task.subject.name}</span>
                      {task.due_date && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Due {task.due_date}</span>}
                    </div>
                    <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{task.title}</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <motion.div style={{ fontSize: 24, fontWeight: 800, color: rate === 100 ? 'var(--teal)' : task.subject.color }}
                        key={rate} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={SPRING}>{rate}%</motion.div>
                      <div className="stat-label" style={{ marginTop: 0 }}>Done</div>
                    </div>
                    <motion.button onClick={(e) => { e.stopPropagation(); deleteTask(task.task_id); }} whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
                      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={16} /></motion.button>
                    <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={SPRING} style={{ display: 'inline-flex', color: 'var(--muted)' }}><ChevronDown size={20} /></motion.span>
                  </div>
                </motion.div>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }} style={{ overflow: 'hidden' }}>
                      <div style={{ borderTop: '1px solid var(--line)', padding: '16px 24px 24px', background: 'var(--head)' }}>
                        <div className="table-wrap">
                          <table>
                            <thead><tr><th>Student</th><th style={{ width: 140, textAlign: 'center' }}>Status</th></tr></thead>
                            <tbody>
                              {task.students.map(s => {
                                const st = getStatusStyle(s.status);
                                const StatusIcon = st.Icon;
                                return (
                                  <tr key={s.id}>
                                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                                    <td style={{ textAlign: 'center' }}>
                                      <motion.button onClick={() => toggleStatus(task.task_id, s.id, s.status)} className="pill"
                                        whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.92 }}
                                        style={{ padding: '6px 18px', fontSize: 12, background: st.bg, color: st.color, border: `1.5px solid ${st.border}`, width: 110, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                                        <StatusIcon size={12} strokeWidth={3} /> {st.label}
                                      </motion.button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </Page>
  );
}
