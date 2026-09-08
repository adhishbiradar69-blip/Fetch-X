/* STAFF EDIT modal — designer "Edit Staff" (admin.html openStaffEdit) on the
   live /admin/staff PUT. Fields: STAFF NAME, SUBJECT (select from
   /admin/subjects), CLASS TEACHER OF ("— Not a class teacher —" + classes),
   CLASSES ASSIGNED (read-only — the backend owns the teaching load),
   DESCRIPTION & DETAILS (notes). Save always sends ct_class_id (a value or
   an explicit null = clear the post) and notes — the backend treats omitted
   keys as unchanged, and axios drops undefined keys, so subject_id is sent
   only when a subject is actually selected. */
import { useEffect, useState } from 'react';
import { updateStaff, errOf, initialsOf } from './api';

export default function EditStaffModal({ staff, schoolName, subjects, classes, onClose, onSaved }) {
  const [name, setName] = useState(staff?.name || '');
  const [subjectId, setSubjectId] = useState(staff?.subject_id != null ? String(staff.subject_id) : '');
  const [ctClassId, setCtClassId] = useState(staff?.ct_class_id != null ? String(staff.ct_class_id) : '');
  const [notes, setNotes] = useState(staff?.notes || '');
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
      const resp = await updateStaff(staff.id, {
        full_name: name.trim(),
        subject_id: subjectId ? Number(subjectId) : undefined,
        ct_class_id: ctClassId ? Number(ctClassId) : null,
        notes,
      });
      onSaved(resp?.teacher || null);
    } catch (e) {
      setErr(errOf(e, 'Could not save staff details.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-label="Edit Staff">
        <div className="dm-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span className="avatar-lg">{initialsOf(staff?.name)}</span>
            <div className="dm-tt">
              <h3>Edit Staff</h3>
              <div className="dm-sub">{staff?.name || '—'} · {schoolName}</div>
            </div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>
        <div className="dm-body">
          <div className="fld">
            <label>STAFF NAME</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="edm-grid">
            <div className="fld">
              <label>SUBJECT</label>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {!subjectId && <option value="">— No subject —</option>}
                {(subjects || []).map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="fld">
              <label>CLASS TEACHER OF</label>
              <select value={ctClassId} onChange={(e) => setCtClassId(e.target.value)}>
                <option value="">— Not a class teacher —</option>
                {(classes || []).map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.grade}-{c.section}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="fld">
            <label>CLASSES ASSIGNED</label>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', padding: '10px 0 2px' }}>
              {(staff?.classes_count ?? 0)} classes: {(staff?.classes_assigned || []).join(', ') || '—'}
            </div>
          </div>
          <div className="fld">
            <label>DESCRIPTION &amp; DETAILS</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Qualifications, emergency contact, Aadhaar / PAN — anything to keep on record…"
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
