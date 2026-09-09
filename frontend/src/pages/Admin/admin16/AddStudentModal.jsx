/* ADD STUDENT modals (v17) — designer admin.html openAddStudentModal /
   openAddBulkModal on the live POST /admin/students ({name, class_id} →
   {id, name, class_id}; roll_no stays blank until assigned). Both are
   class-scoped, opened from the roster header's .dm-act cluster:
   · AddStudentModal — one STUDENT NAME field, "Add to class".
   · AddBulkModal  — one-name-per-line textarea, sequential createStudent
     per line with a live "Adding N…" progress label and a 60-per-batch
     cap (the backend has no bulk endpoint — this is the honest loop). */
import { useEffect, useRef, useState } from 'react';
import { createStudent, errOf } from './api';

const BULK_CAP = 60;

export default function AddStudentModal({ cls, schoolName, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) { inputRef.current?.focus(); return; }
    setSaving(true);
    setErr(null);
    try {
      const resp = await createStudent({ name: name.trim(), class_id: cls.id });
      onCreated([resp]);
    } catch (e) {
      setErr(errOf(e, 'Could not add the student.'));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-label="Add Student">
        <div className="dm-head">
          <div className="dm-tt">
            <h3>Add Student</h3>
            <div className="dm-sub">Class {cls ? `${cls.grade}-${cls.section}` : '—'} · {schoolName}</div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>
        <div className="dm-body">
          <div className="fld">
            <label>STUDENT NAME</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              placeholder="e.g. Aarav Sharma"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            />
          </div>
          {err && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: 12, fontSize: 13 }}
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Adding…' : 'Add to class'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddBulkModal({ cls, schoolName, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0); // created so far — drives the progress label
  const [err, setErr] = useState(null);
  const taRef = useRef(null);

  useEffect(() => { taRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const save = async () => {
    if (busy) return;
    const names = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!names.length) { taRef.current?.focus(); return; }
    if (names.length > BULK_CAP) {
      setErr(`Batch limit is ${BULK_CAP} students per add — this list has ${names.length}. Split it into smaller batches.`);
      return;
    }
    setBusy(true);
    setErr(null);
    setDone(0);
    const created = [];
    const failed = [];
    let lastErr = null;
    for (let i = 0; i < names.length; i++) {
      setDone(i);
      try {
        created.push(await createStudent({ name: names[i], class_id: cls.id }));
      } catch (e) {
        failed.push(names[i]);
        lastErr = e;
      }
    }
    if (!created.length) {
      /* nothing landed — keep the list on screen so nothing is retyped */
      setErr(`None of the ${names.length} students could be added. ${errOf(lastErr, 'The server refused the batch — try again.')}`);
      setBusy(false);
      return;
    }
    onCreated(created, failed);
  };

  return (
    <div className="modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-label="Add Bulk Students">
        <div className="dm-head">
          <div className="dm-tt">
            <h3>Add Bulk Students</h3>
            <div className="dm-sub">One name per line — Class {cls ? `${cls.grade}-${cls.section}` : '—'} · {schoolName}</div>
          </div>
          <button type="button" className="btn-close" onClick={onClose} disabled={busy} aria-label="Close">✕</button>
        </div>
        <div className="dm-body">
          <div className="fld">
            <label>STUDENT NAMES (one per line · max {BULK_CAP})</label>
            <textarea
              ref={taRef}
              value={text}
              placeholder={'Aarav Sharma\nAnanya Verma\nIshaan Reddy'}
              style={{ minHeight: 140, lineHeight: 1.6 }}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
          </div>
          {err && <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 10 }}>{err}</div>}
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: 12, fontSize: 13 }}
            onClick={save}
            disabled={busy}
          >
            {busy ? `Adding ${done + 1}…` : 'Add all to class'}
          </button>
        </div>
      </div>
    </div>
  );
}
