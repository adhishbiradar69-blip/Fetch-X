import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, FileText, BarChart3, Pencil, ClipboardList, Save, Loader2, AlertTriangle, Download, ArrowDownToLine, Eraser } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Page, EASE, staggerContainer, staggerItem } from '../../lib/motion.jsx';
import { CountUp, Toast, Modal, SuccessBurst } from '../../components/ui.jsx';

function MarkInput({ value, onChange, onKeyDown, onPaste, onFocus, inputRef, subjectColor, max, invalid }) {
  return (
    <input ref={inputRef} type="number" min="0" max={max} step="0.5"
      value={value === '' || value === null || value === undefined ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? '' : parseFloat(e.target.value))}
      onKeyDown={onKeyDown} onPaste={onPaste} onFocus={onFocus}
      className={`mark-input${invalid ? ' mark-invalid' : ''}`} style={{ '--subject-color': subjectColor || 'var(--brand)' }} />
  );
}

export default function MarksBoard() {
  const { user } = useAuth();
  const classId = user?.assigned_class_id;

  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedExam, setSelectedExam] = useState(() => {
    try { return sessionStorage.getItem(`fx-marks-exam-${classId}`) || ''; } catch { return ''; }
  });
  const [examData, setExamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [marksLoading, setMarksLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [burst, setBurst] = useState(false);
  const [draft, setDraft] = useState({});
  const [focusedCell, setFocusedCell] = useState(null); // { sid, subId } → row/col highlight in the entry grid

  const inputRefs = useRef({});
  const toastTimer = useRef(null);
  const showToast = useCallback((m, t = 'success') => {
    setToast({ message: m, type: t });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => toastTimer.current && clearTimeout(toastTimer.current), []);
  const [loadError, setLoadError] = useState(false);

  /* remember the chosen exam for this class across visits (per tab session) */
  useEffect(() => { try { if (selectedExam) sessionStorage.setItem(`fx-marks-exam-${classId}`, selectedExam); } catch { /* private mode */ } }, [selectedExam, classId]);

  useEffect(() => { if (classId) init(); }, [classId]);

  const init = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Only load exams first (the marks response carries students + subjects).
      // NOTE: we deliberately do NOT call /attendance/class/{id} here because it
      // requires a `date` param; students come from the marks response instead.
      const exRes = await api.get(`/academics/class/${classId}/exams`);
      setExams(exRes.data);
      if (exRes.data.length) {
        setSelectedExam(prev => (prev && exRes.data.some(e => String(e.id) === String(prev))) ? prev : String(exRes.data[0].id));
      }
    } catch (e) {
      console.error(e);
      setLoadError(true); // distinguish "no exams" from "request failed" (M2)
    }
    setLoading(false);
  };

  useEffect(() => { if (classId && selectedExam) fetchMarks(); }, [selectedExam, classId]);

  const fetchMarks = async () => {
    setMarksLoading(true);
    // stale-response guard: switching exams quickly must never render the
    // previous exam's marks (M3)
    const reqExam = selectedExam;
    try {
      const res = await api.get(`/academics/class/${classId}/marks?exam_id=${reqExam}`);
      if (String(reqExam) !== String(selectedExam)) return; // a newer exam was picked
      setExamData(res.data);
      setSubjects(res.data.subjects);
      setStudents(res.data.students.map(s => ({ id: s.id, name: s.name })));
    } catch (e) { console.error(e); showToast('Failed to load marks for this exam', 'error'); }
    setMarksLoading(false);
  };

  const openModal = () => {
    const d = {};
    students.forEach(s => subjects.forEach(sub => {
      const v = examData?.students.find(st => st.id === s.id)?.marks?.[String(sub.id)];
      d[`${s.id}-${sub.id}`] = v !== null && v !== undefined ? v : '';
    }));
    setDraft(d); setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setFocusedCell(null); inputRefs.current = {}; };

  const handleMarkChange = (sid, subId, v) => setDraft(p => ({ ...p, [`${sid}-${subId}`]: v }));

  /* Paste a whole column of marks (e.g. copied from Excel/Sheets) into a subject.
     First value lands in the pasted cell, the rest fill that subject down the roster. */
  const handlePaste = (si, sub, e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text) return;
    const vals = text.split(/[\r\n\t;]+/).map(t => t.trim()).filter(Boolean);
    if (!vals.length) return;
    e.preventDefault();
    let n = 0;
    const updates = {};
    for (let i = 0; i < vals.length && si + i < students.length; i++) {
      const v = parseFloat(vals[i]);
      if (isNaN(v)) continue;
      updates[`${students[si + i].id}-${sub.id}`] = v; n++;
    }
    if (n) {
      setDraft(prev => ({ ...prev, ...updates }));
      showToast(`Pasted ${n} mark${n === 1 ? '' : 's'} into ${sub.name}`, 'success');
    }
  };

  const cellValue = (s, sub) => draft[`${s.id}-${sub.id}`];
  const isBad = (v) => v !== '' && v !== null && v !== undefined && (isNaN(v) || v < 0 || v > maxScore);
  const isEmpty = (v) => v === '' || v === null || v === undefined;

  /* ── per-column tools (MarksBoard Pro) ──
     Fill down: take the first valid mark in the column and copy it into every
     empty cell of that subject (classic spreadsheet fill-down, demo-friendly).
     Clear: reset every cell of that subject. */
  const fillDown = (sub) => {
    const seed = students.map(s => cellValue(s, sub)).find(v => !isEmpty(v) && !isBad(v));
    if (seed === undefined) { showToast(`${sub.name} has no valid mark to fill from`, 'error'); return; }
    // compute updates + count OUTSIDE the updater — setDraft updaters must stay
    // pure (StrictMode re-invokes them, which corrupts side-effect counters)
    const updates = {};
    let n = 0;
    students.forEach(s => {
      const k = `${s.id}-${sub.id}`;
      if (isEmpty(draft[k])) { updates[k] = seed; n++; }
    });
    if (n) setDraft(prev => ({ ...prev, ...updates }));
    showToast(n ? `Filled ${n} empty cell${n === 1 ? '' : 's'} in ${sub.name} with ${seed}` : `${sub.name} has no empty cells`, n ? 'success' : 'error');
  };

  const clearColumn = (sub) => {
    const updates = {};
    let n = 0;
    students.forEach(s => {
      const k = `${s.id}-${sub.id}`;
      if (!isEmpty(draft[k])) { updates[k] = ''; n++; }
    });
    if (n) setDraft(prev => ({ ...prev, ...updates }));
    showToast(n ? `Cleared ${n} mark${n === 1 ? '' : 's'} from ${sub.name}` : `${sub.name} is already empty`, n ? 'success' : 'error');
  };

  const colStats = (sub) => {
    let filled = 0, invalid = 0;
    students.forEach(s => {
      const v = cellValue(s, sub);
      if (!isEmpty(v)) filled++;
      if (isBad(v)) invalid++;
    });
    return { filled, invalid };
  };

  const cellKey = (e, si, ssi) => {
    const nS = subjects[ssi + 1]; const nStu = students[si + 1];
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nS) inputRefs.current[`${students[si].id}-${nS.id}`]?.focus();
      else if (nStu) inputRefs.current[`${nStu.id}-${subjects[0].id}`]?.focus();
    } else if (e.key === 'ArrowRight' && subjects[ssi + 1]) { e.preventDefault(); inputRefs.current[`${students[si].id}-${subjects[ssi + 1].id}`]?.focus(); }
    else if (e.key === 'ArrowLeft' && subjects[ssi - 1]) { e.preventDefault(); inputRefs.current[`${students[si].id}-${subjects[ssi - 1].id}`]?.focus(); }
    else if (e.key === 'ArrowDown' && nStu) { e.preventDefault(); inputRefs.current[`${nStu.id}-${subjects[ssi].id}`]?.focus(); }
    else if (e.key === 'ArrowUp' && students[si - 1]) { e.preventDefault(); inputRefs.current[`${students[si - 1].id}-${subjects[ssi].id}`]?.focus(); }
  };

  const saveMarks = async () => {
    const badCount = students.reduce((n, s) => n + subjects.filter(sub => isBad(cellValue(s, sub))).length, 0);
    if (badCount > 0) { showToast(`${badCount} invalid value${badCount === 1 ? '' : 's'} — marks must be between 0 and ${maxScore}`, 'error'); return; }
    setSaving(true);
    const marks = [];
    students.forEach(s => subjects.forEach(sub => {
      const v = draft[`${s.id}-${sub.id}`];
      if (v !== '' && v !== null && v !== undefined) marks.push({ student_id: s.id, subject_id: sub.id, score: parseFloat(v) });
    }));
    try {
      await api.post('/academics/marks/bulk', { class_id: classId, exam_id: parseInt(selectedExam), marks });
      showToast('Marks saved successfully!', 'success');
      setBurst(true); setTimeout(() => setBurst(false), 900);
      closeModal(); fetchMarks();
    } catch (e) { showToast(e.response?.data?.detail || 'Failed to save marks', 'error'); }
    setSaving(false);
  };

  const studentAvg = (s) => {
    if (!examData) return null;
    const vals = Object.values(examData.students.find(st => st.id === s.id)?.marks || {}).filter(v => v !== null && v !== undefined);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };
  const classAvg = () => {
    if (!examData || !examData.students.length) return 0;
    let t = 0, c = 0;
    examData.students.forEach(s => Object.values(s.marks).forEach(v => { if (v !== null && v !== undefined) { t += v; c++; } }));
    return c ? (t / c).toFixed(1) : 0;
  };

  /* download the selected exam's sheet as CSV (name · one column per subject · average) */
  const exportCsv = () => {
    if (!examData || !examData.students.length) { showToast('Nothing to export', 'error'); return; }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Student', ...subjects.map(sub => sub.name), 'Average'].map(esc).join(',') + '\n';
    const body = examData.students.map(st => {
      const vals = subjects.map(sub => st.marks?.[String(sub.id)] ?? '');
      const nums = vals.filter(v => v !== '' && v !== null && v !== undefined);
      const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '';
      return [st.name, ...vals, avg].map(esc).join(',');
    }).join('\n');
    const url = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `marks-${(examData.exam_name || 'exam').replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${examData.students.length} students`);
  };

  if (!classId) return <NoClass />;
  if (loading) return <Page><SkeletonMarks /></Page>;

  const maxScore = examData?.max_score || 100;

  /* entry-grid completion stats (derived from the draft, only meaningful while the modal is open) */
  const cellsTotal = students.length * subjects.length;
  const cellsFilled = students.reduce((n, s) => n + subjects.filter(sub => { const v = draft[`${s.id}-${sub.id}`]; return v !== '' && v !== null && v !== undefined; }).length, 0);
  const cellsInvalid = students.reduce((n, s) => n + subjects.filter(sub => isBad(draft[`${s.id}-${sub.id}`])).length, 0);
  const pctFilled = cellsTotal ? Math.round((cellsFilled / cellsTotal) * 100) : 0;

  return (
    <Page>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <SuccessBurst show={burst} />

      <div className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Class Teacher</div>
          <h1>Marks</h1>
          <div className="subtitle">Enter and view exam marks for your class</div>
        </div>
      </div>

      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card" style={{ marginTop: 6 }}>
        <div className="card-stats cols-4">
          {[{ v: students.length, l: 'Total Students', Icon: Users, accent: 'a-indigo' },
            { v: exams.length, l: 'Exams Configured', Icon: FileText, accent: 'a-amber' },
            { v: classAvg(), l: 'Class Average', Icon: BarChart3, accent: 'a-teal', suffix: '%' }].map((s, i) => {
          const SIcon = s.Icon;
          return (
            <motion.div key={i} variants={staggerItem} className={`stat-cell ${s.accent}`}>
              <div className="ic"><SIcon size={15} strokeWidth={2.2} /></div>
              <div>
                <div className="k">{s.l}</div>
                <div className="v"><CountUp value={s.v} decimals={s.v % 1 ? 1 : 0} />{s.suffix && <span className="of">{s.suffix}</span>}</div>
              </div>
            </motion.div>
          );
        })}
        </div>
      </motion.div>

      <div className="card controls-bar" style={{ padding: 18, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label className="filter-label" style={{ fontSize: 12 }}>Exam</label>
          <select value={selectedExam} onChange={e => setSelectedExam(e.target.value)} className="input" style={{ width: 'auto', minWidth: 200 }}>
            <option value="">Select an exam…</option>
            {exams.map(ex => <option key={ex.id} value={ex.id}>{ex.name} (/{ex.max_score})</option>)}
          </select>
          {examData && <span className="filter-label" style={{ fontSize: 10, background: 'var(--lav)', color: 'var(--brand)', padding: '4px 10px', borderRadius: 999 }}>MAX {maxScore}</span>}
        </div>
        {loadError ? (
          <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Couldn't load exams.
            <button onClick={init} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}>Retry</button>
          </span>
        ) : exams.length === 0 ? (
          <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>No exams configured for this grade. Ask admin to create one.</span>
        ) : selectedExam && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={exportCsv} className="btn btn-ghost" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Download this exam's marks sheet as CSV">
              <Download size={14} /> Export CSV
            </button>
            <button onClick={openModal} className="btn btn-primary" style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pencil size={14} /> Enter / Edit Marks
            </button>
          </div>
        )}
      </div>

      {loadError ? (
        <div className="card" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><FileText size={40} color="#ef4444" /></div>
          <p style={{ color: 'var(--body-text)', fontSize: 15, marginBottom: 8 }}>Couldn't reach the server to load exams.</p>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Check your connection, then try again.</p>
          <button onClick={init} className="btn btn-primary" style={{ fontSize: 13 }}>Retry</button>
        </div>
      ) : !exams.length ? (
        <div className="card" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><FileText size={40} color="var(--muted)" /></div>
          <p style={{ color: 'var(--body-text)', fontSize: 15, marginBottom: 8 }}>No exams configured for this class's grade.</p>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>An admin must create an exam (Admin → Exams tab) and configure subjects for the grade (Admin → Subjects tab) first.</p>
        </div>
      ) : !selectedExam ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><ClipboardList size={32} color="var(--muted)" /></div>
          <p style={{ color: 'var(--body-text)', fontSize: 15 }}>Select an exam from the dropdown above.</p>
        </div>
      ) : examData && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 50, textAlign: 'center' }}>#</th>
                <th>Student Name</th>
                {subjects.map(sub => (
                  <th key={sub.id} style={{ textAlign: 'center', minWidth: 90 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sub.color || 'var(--brand)', display: 'inline-block' }} />
                      {sub.name}
                    </span>
                  </th>
                ))}
                <th style={{ textAlign: 'center', width: 80 }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr><td colSpan={subjects.length + 3} style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--muted)' }}>
                  No students in this class yet.
                </td></tr>
              )}
              {students.map((s, i) => {
                const stData = examData.students.find(st => st.id === s.id);
                const avg = studentAvg(s);
                return (
                  <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.02, 0.4) }}>
                    <td style={{ textAlign: 'center', color: 'var(--muted)', fontWeight: 600, fontSize: 13 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600, fontSize: 15 }}>{s.name}</td>
                    {subjects.map(sub => {
                      const mark = stData?.marks?.[String(sub.id)];
                      return (
                        <td key={sub.id} style={{ textAlign: 'center' }}>
                          {mark !== null && mark !== undefined
                            ? <span className="mark-display" style={{ color: sub.color || 'var(--brand)' }}>{mark}</span>
                            : <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>
                      {avg !== null
                        ? <span className={`mark-avg-badge ${parseFloat(avg) >= (maxScore * 0.6) ? 'mark-pass' : 'mark-fail'}`}>{avg}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} onClose={closeModal} title={`Enter Marks — ${examData?.exam_name || ''} (max ${maxScore})`} wide>
        <div className="marks-grid-wrap">
          <table className="marks-grid-table">
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surf)', minWidth: 160 }}>Student</th>
                {subjects.map(sub => {
                  const cs = colStats(sub);
                  return (
                    <th key={sub.id} className="fx-col-head" style={{ textAlign: 'center', minWidth: 96 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: sub.color || 'var(--brand)' }} />
                        {sub.name}
                      </span>
                      <span className={`fx-col-count${cs.invalid ? ' has-invalid' : ''}`} title={`${cs.filled}/${students.length} entered${cs.invalid ? ` · ${cs.invalid} invalid` : ''}`}>
                        {cs.filled}/{students.length}{cs.invalid ? ` · ${cs.invalid}!` : ''}
                      </span>
                      <span className="fx-col-tools">
                        <button type="button" className="fx-col-tool" title={`Fill empty cells in ${sub.name} from its first valid mark`}
                          onClick={() => fillDown(sub)} aria-label={`Fill down ${sub.name}`}>
                          <ArrowDownToLine size={11} strokeWidth={2.6} />
                        </button>
                        <button type="button" className="fx-col-tool fx-col-tool-clear" title={`Clear all marks for ${sub.name}`}
                          onClick={() => clearColumn(sub)} aria-label={`Clear ${sub.name}`}>
                          <Eraser size={11} strokeWidth={2.6} />
                        </button>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {students.map((s, si) => (
                <tr key={s.id} className={focusedCell?.sid === s.id ? 'row-active' : undefined}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--surf)', fontWeight: 600, fontSize: 14, padding: '10px 14px' }}>{s.name}</td>
                  {subjects.map((sub, ssi) => {
                    const key = `${s.id}-${sub.id}`;
                    return (
                      <td key={sub.id} className={focusedCell?.subId === sub.id ? 'col-active' : undefined} style={{ padding: 6 }}>
                        <MarkInput value={draft[key]} onChange={v => handleMarkChange(s.id, sub.id, v)}
                          onKeyDown={e => cellKey(e, si, ssi)}
                          onPaste={e => handlePaste(si, sub, e)}
                          onFocus={() => setFocusedCell({ sid: s.id, subId: sub.id })}
                          inputRef={el => { if (el) inputRefs.current[key] = el; }} subjectColor={sub.color} max={maxScore}
                          invalid={isBad(draft[key])} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="marks-progress" aria-live="polite">
          <div className="marks-progress-bar"><span style={{ width: `${pctFilled}%` }} /></div>
          <div className="marks-progress-label">
            <strong>{cellsFilled}/{cellsTotal}</strong> entered · {pctFilled}%
            {cellsInvalid > 0 && <span className="marks-progress-err"> · {cellsInvalid} invalid</span>}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          Tip: <strong>Enter</strong> or <strong>→</strong> moves next, <strong>↑↓</strong> move rows — paste a column from a spreadsheet, or hover a subject header for <strong>fill-down / clear</strong> tools
        </div>
        <div className="modal-footer">
          <button onClick={closeModal} className="btn btn-secondary">Cancel</button>
          <button onClick={saveMarks} disabled={saving} className="btn btn-primary">
            {saving ? (<><span className="spin-icon" style={{ marginRight: 8, display: 'inline-flex' }}><Loader2 size={16} /></span>Saving...</>) : <><Save size={16} style={{ marginRight: 6, display: 'inline-flex', verticalAlign: '-2px' }} /> Save Marks</>}
          </button>
        </div>
      </Modal>
    </Page>
  );
}

function NoClass() {
  return (
    <Page>
      <div className="card" style={{ textAlign: 'center', padding: 60, marginTop: 40 }}>
        <AlertTriangle size={48} color="#d97706" style={{ marginBottom: 16 }} />
        <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No Class Assigned</h3>
        <p style={{ color: 'var(--body-text)' }}>Please contact the administrator to assign you a class.</p>
      </div>
    </Page>
  );
}

function SkeletonMarks() {
  return (
    <div>
      <div className="pagehead"><div><div className="eyebrow">Fetch-X · Class Teacher</div><h1>Marks</h1><div className="subtitle">Loading…</div></div></div>
      <div className="card" style={{ marginTop: 6 }}><div className="card-stats cols-4">{[0, 1, 2].map(i => (
        <div key={i} className="stat-cell" style={{ opacity: 0.5 }}>
          <div className="skeleton-block" style={{ width: 31, height: 31, borderRadius: 9 }} />
          <div>
            <div className="skeleton-block" style={{ width: 60, height: 10, borderRadius: 4, marginBottom: 6 }} />
            <div className="skeleton-block" style={{ width: 40, height: 16, borderRadius: 5 }} />
          </div>
        </div>))}
      </div></div>
    </div>
  );
}
