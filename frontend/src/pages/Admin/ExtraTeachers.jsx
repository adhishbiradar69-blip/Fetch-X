/* ExtraTeachers — ADMINISTRATION › "Subject Teachers": timetable-only
   staff. They cover academic subjects or activities (games / SUPW / …)
   when the regular faculty can't, and are deliberately excluded from
   every dashboard, ranking, and AI answer — they exist only in the
   generated timetables. Rendered inside AdminShell (provided by the
   route). Backend: /admin/extra-teachers CRUD. */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { Toast } from '../../components/ui';

const ACTIVITIES = [
  ['games', 'Games'],
  ['supw', 'SUPW'],
  ['drawing', 'Drawing'],
  ['library', 'Library'],
  ['music', 'Music'],
  ['craft', 'Craft'],
];

export default function ExtraTeachers() {
  const [rows, setRows] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('subject');       // 'subject' | 'activity'
  const [subjectId, setSubjectId] = useState('');
  const [activity, setActivity] = useState('games');
  const [maxDaily, setMaxDaily] = useState(7);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/extra-teachers')
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    load();
    api.get('/admin/subjects')
      .then((r) => { setSubjects(r.data || []); if (r.data?.length) setSubjectId(String(r.data[0].id)); })
      .catch(() => setSubjects([]));
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/admin/extra-teachers', {
        name: name.trim(),
        subject_id: kind === 'subject' ? Number(subjectId) : null,
        activity: kind === 'activity' ? activity : null,
        max_daily: Number(maxDaily) || 7,
      });
      setName('');
      setToast({ message: 'Subject teacher added — timetables regenerate automatically', type: 'success' });
      load();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || 'Could not add the teacher', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    try {
      await api.delete(`/admin/extra-teachers/${row.id}`);
      setRows((r) => (r || []).filter((x) => x.id !== row.id));
      setToast({ message: `${row.name} removed`, type: 'success' });
    } catch {
      setToast({ message: 'Could not remove the teacher', type: 'error' });
    }
  };

  const academic = (rows || []).filter((r) => r.subject_id);
  const activityRows = (rows || []).filter((r) => !r.subject_id && r.activity);
  const subjName = (id) => subjects.find((s) => s.id === id)?.name || `Subject #${id}`;

  const Row = ({ r, tag }) => (
    <div className="srow" style={{ gridTemplateColumns: '40px minmax(0,1fr) 170px 90px 44px', cursor: 'default' }}>
      <span className="avatar">{r.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
      <span className="st-name"><span className="nm" style={{ fontWeight: 700 }}>{r.name}</span></span>
      <span><span className="rank-pill" style={{ whiteSpace: 'normal' }}>{tag}</span></span>
      <span className="classchip">{r.max_daily}/day</span>
      <button type="button" className="bm" title="Remove" onClick={() => remove(r)} aria-label={`Remove ${r.name}`}>
        <Trash2 strokeWidth={1.8} />
      </button>
    </div>
  );

  return (
    <>
      <header className="pagehead">
        <div>
          <div className="eyebrow">Fetch-X · Administration</div>
          <h1>Subject Teachers</h1>
          <div className="subtitle">
            Timetable-only staff — they cover subjects and activities in the
            generated timetables but never appear in dashboards, rankings, or reports.
          </div>
        </div>
      </header>

      <div className="card" style={{ padding: '18px 20px', marginBottom: 18 }}>
        <form onSubmit={add} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 6, flex: '2 1 220px' }}>
            <span className="ct-toolbar label" style={{ padding: 0, border: 'none', boxShadow: 'none', background: 'transparent' }}>FULL NAME</span>
            <input className="input" placeholder="e.g. Ramesh Kumar" value={name}
              onChange={(e) => setName(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)' }}>COVERS</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="subject">A subject</option>
              <option value="activity">An activity</option>
            </select>
          </label>
          {kind === 'subject' ? (
            <label style={{ display: 'grid', gap: 6, flex: '1 1 160px' }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)' }}>SUBJECT</span>
              <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ) : (
            <label style={{ display: 'grid', gap: 6, flex: '1 1 160px' }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)' }}>ACTIVITY</span>
              <select className="input" value={activity} onChange={(e) => setActivity(e.target.value)}>
                {ACTIVITIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          )}
          <label style={{ display: 'grid', gap: 6, width: 110 }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)' }}>MAX / DAY</span>
            <input className="input" type="number" min={1} max={9} value={maxDaily}
              onChange={(e) => setMaxDaily(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            <Plus size={15} /> Add Teacher
          </button>
        </form>
      </div>

      {rows === null ? (
        <div className="pd-skel tall" />
      ) : (
        <>
          <div className="grade-label" style={{ marginTop: 6 }}>ACADEMIC COVERAGE · {academic.length}</div>
          <div className="st-list-wrap" style={{ marginBottom: 18 }}>
            {academic.length ? academic.map((r) => <Row key={r.id} r={r} tag={subjName(r.subject_id)} />)
              : <div className="noresult">No academic subject teachers yet — the timetable fills those gaps with self-study.</div>}
          </div>

          <div className="grade-label">ACTIVITY COVERAGE · {activityRows.length}</div>
          <div className="st-list-wrap">
            {activityRows.length ? activityRows.map((r) => (
              <Row key={r.id} r={r}
                tag={(ACTIVITIES.find(([k]) => k === r.activity) || [null, r.activity])[1]} />
            )) : (
              <div className="noresult">
                No activity teachers — activity periods currently run unsupervised
                (that's what keeps every teacher's ~2 free periods per day).
              </div>
            )}
          </div>
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
