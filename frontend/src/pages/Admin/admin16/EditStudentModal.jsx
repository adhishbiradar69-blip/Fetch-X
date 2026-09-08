/* STUDENT EDIT modal — designer "Edit Student" (admin.html openStudentEdit)
   on the live PUT /admin/students/{id}: STAFF-style .dm-head with .avatar-lg
   initials, STUDENT NAME, .edm-grid CLASS (GRADE) + SECTION selects
   (grade+section pair resolves to a class of the student's own school),
   DESCRIPTION & DETAILS (notes). Save → {ok, student{…}}. */
import { useEffect, useState } from 'react';
import { updateStudent, errOf, initialsOf } from './api';

const SECTIONS = ['Sapphire', 'Emerald', 'Ruby'];
const GRADES = Array.from({ length: 10 }, (_, i) => i + 1);

export default function EditStudentModal({ student, schoolName, onClose, onSaved }) {
  const [name, setName] = useState(student?.name || '');
  const [grade, setGrade] = useState(String(student?.grade ?? 1));
  const [section, setSection] = useState(student?.section || 'Sapphire');
  const [notes, setNotes] = useState(student?.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const resp = await updateStudent(student.id, {
        name: name.trim(),
        grade: Number(grade),
        section,
        notes,
      });
      onSaved(resp?.student || null);
    } catch (e) {
      setErr(errOf(e, 'Could not save the student.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-label="Edit Student">
        <div className="dm-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span className="avatar-lg">{initialsOf(student?.name)}</span>
            <div className="dm-tt">
              <h3>Edit Student</h3>
              <div className="dm-sub">{student?.name || '—'} · {schoolName}</div>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>
        <div className="dm-body">
          <div className="fld">
            <label>STUDENT NAME</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="edm-grid">
            <div className="fld">
              <label>CLASS (GRADE)</label>
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                {GRADES.map((g) => <option key={g} value={String(g)}>{g}</option>)}
              </select>
            </div>
            <div className="fld">
              <label>SECTION</label>
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                {SECTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="fld">
            <label>DESCRIPTION &amp; DETAILS</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Parent contact, address, Aadhaar / PAN, health notes — anything to keep on record…"
            />
          </div>
          {err && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
          <div className="edm-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
