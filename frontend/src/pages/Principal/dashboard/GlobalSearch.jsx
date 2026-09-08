/* Global search (pagehead) — students come from the server, classes and
   teachers from the already-loaded lists. Ctrl K / "/" focus is wired by
   the page; this component handles the dropdown, keyboard nav and actions. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchStudents } from './data';
import { initials, pct } from './util';

export default function GlobalSearch({
  inputRef, classesAll = [], teachers = [], subjects = [], onOpenClass, onOpenStudent, onOpenTeacher, onOpenSubject,
  placeholder = 'Search students, classes, subjects, teachers…',
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [resolvedQ, setResolvedQ] = useState(''); // guards against stale results
  const [lastQl, setLastQl] = useState('');
  const popRef = useRef(null);
  const wrapRef = useRef(null);

  const query = q.trim();
  const ql = query.toLowerCase();

  /* reset the highlighted row when the query changes (render-phase adjust) */
  if (ql !== lastQl) {
    setLastQl(ql);
    setActive(-1);
  }

  /* debounced server search (state changes only in async paths / handlers) */
  useEffect(() => {
    if (!query) return undefined;
    const t = setTimeout(() => {
      fetchStudents({ search: query, page: 1, pageSize: 8 })
        .then((d) => { setStudents(d.students); setResolvedQ(query); })
        .catch(() => { setStudents([]); setResolvedQ(query); })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const classes = useMemo(
    () => classesAll
      .filter((c) => !ql || c.name.toLowerCase().includes(ql) || String(c.grade) === ql)
      .slice(0, 4),
    [classesAll, ql],
  );

  const visibleStudents = useMemo(
    () => (resolvedQ === query ? students : []),
    [resolvedQ, query, students],
  );
  const classRows = useMemo(() => classes.map((c, i) => ({ c, me: i })), [classes]);
  const teacherRows = useMemo(
    () => teachers
      .filter((t) => !ql
        || String(t.name).toLowerCase().includes(ql)
        || String(t.subject).toLowerCase().includes(ql))
      .slice(0, 4)
      .map((t, i) => ({ t, me: classes.length + i })),
    [teachers, ql, classes.length],
  );
  const studentRows = useMemo(
    () => visibleStudents.map((s, i) => ({ s, me: classes.length + teacherRows.length + i })),
    [visibleStudents, classes.length, teacherRows.length],
  );
  const subjectRows = useMemo(
    () => (subjects || [])
      .filter((s) => !ql || String(s.name).toLowerCase().includes(ql))
      .slice(0, 4)
      .map((s, i) => ({ s, me: classes.length + teacherRows.length + studentRows.length + i })),
    [subjects, ql, classes.length, teacherRows.length, studentRows.length],
  );

  const flat = useMemo(() => [
    ...classRows.map(({ c }) => ({ kind: 'class', c })),
    ...subjectRows.map(({ s }) => ({ kind: 'subject', s })),
    ...teacherRows.map(({ t }) => ({ kind: 'teacher', t })),
    ...studentRows.map(({ s }) => ({ kind: 'student', s })),
  ], [classRows, subjectRows, teacherRows, studentRows]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openPop = () => { if (query) setOpen(true); };

  const choose = (item) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    if (item.kind === 'class') onOpenClass(item.c.id);
    else if (item.kind === 'subject') onOpenSubject?.(item.s);
    else if (item.kind === 'teacher') onOpenTeacher(item.t);
    else onOpenStudent(item.s);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      if (active >= 0 && flat[active]) { e.preventDefault(); choose(flat[active]); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="pagehead-mid gsearch" ref={wrapRef}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          openPop();
          if (v.trim()) setLoading(true); else setLoading(false);
        }}
        onFocus={openPop}
        onKeyDown={onKeyDown}
      />
      <kbd className="gsk">Ctrl K</kbd>
      {open && query ? (
        <div className="gs-pop open" ref={popRef}>
          {!classes.length && !visibleStudents.length && !subjectRows.length && !loading ? (
            <div className="gs-empty">No matches for “{query}”</div>
          ) : null}
          {classes.length ? <div className="gs-sec">CLASSES</div> : null}
          {classRows.map(({ c, me }) => (
            <div
              key={`c${c.id}`}
              className="gs-item"
              style={me === active ? { background: 'var(--hov)' } : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose({ kind: 'class', c }); }}
              onMouseEnter={() => setActive(me)}
            >
              <span className="gi">◆</span>
              {c.name}
              <span className="gs">{pct(c.avg)}%{c.rank ? ` · rank #${c.rank}` : ''}</span>
            </div>
          ))}
          {visibleStudents.length || teacherRows.length ? <div className="gs-sec">PEOPLE</div> : null}
          {teacherRows.map(({ t, me }) => (
            <div
              key={`t${t.id}`}
              className="gs-item"
              style={me === active ? { background: 'var(--hov)' } : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose({ kind: 'teacher', t }); }}
              onMouseEnter={() => setActive(me)}
            >
              <span className="avatar">{initials(t.name)}</span>
              {t.name}
              <span className="gs">{t.subject} · #{t.rank}</span>
            </div>
          ))}
          {studentRows.map(({ s, me }) => (
            <div
              key={`s${s.id}`}
              className="gs-item"
              style={me === active ? { background: 'var(--hov)' } : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose({ kind: 'student', s }); }}
              onMouseEnter={() => setActive(me)}
            >
              <span className="avatar">{initials(s.name)}</span>
              {s.name}
              <span className="gs">{s.className} · {pct(s.avg)}%</span>
            </div>
          ))}
          {subjectRows.length ? <div className="gs-sec">SUBJECTS</div> : null}
          {subjectRows.map(({ s, me }) => (
            <div
              key={`sub${s.id ?? s.name}`}
              className="gs-item"
              style={me === active ? { background: 'var(--hov)' } : undefined}
              onMouseDown={(e) => { e.preventDefault(); choose({ kind: 'subject', s }); }}
              onMouseEnter={() => setActive(me)}
            >
              <span className="gi">▣</span>
              {s.name}
              <span className="gs">{pct(s.avg)}%</span>
            </div>
          ))}
          {loading ? <div className="gs-empty">Searching…</div> : null}
        </div>
      ) : null}
    </div>
  );
}
