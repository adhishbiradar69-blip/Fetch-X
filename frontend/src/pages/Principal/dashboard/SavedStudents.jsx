/* Saved Students in-page view (#saved) — folders CRUD in localStorage
   (`fx-folders`), per-folder student cards, remove + open report card.
   Student details are resolved through cached /principal/student-report
   calls so folder cards always show real, live data. */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fetchStudentReport } from './data';
import { SectionHead } from './Sections';
import { initials } from './util';

export default function SavedStudents({
  folders, onCreate, onDeleteFolder, onRemoveStudent, onBack, onOpenReport, savedCount,
}) {
  const [name, setName] = useState('');
  const [cache, setCache] = useState({}); // id → {report} | {err}

  const allIds = [...new Set(folders.flatMap((f) => f.studentIds))];

  useEffect(() => {
    let alive = true;
    const missing = allIds.filter((id) => cache[id] === undefined);
    if (!missing.length) return undefined;
    Promise.all(
      missing.map((id) =>
        fetchStudentReport(id)
          .then((r) => [id, { report: r }])
          .catch(() => [id, { err: true }]),
      ),
    ).then((pairs) => {
      if (!alive) return;
      setCache((c) => ({ ...c, ...Object.fromEntries(pairs) }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache intentionally excluded: refill only for ids not yet cached
  }, [allIds.join('|')]);

  const create = () => {
    if (onCreate(name.trim())) setName('');
  };

  return (
    <div>
      <div className="cd-head">
        <div>
          <button type="button" className="btn-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            PRINCIPAL DASHBOARD
          </button>
          <div className="eyebrow">SCHOOL INTELLIGENCE · SAVED</div>
          <h1>Saved Students</h1>
          <div className="subtitle">Your own folders — students are copied here, their classes stay untouched.</div>
        </div>
      </div>

      <section className="lvl lvl-5 compact first">
        <SectionHead
          title="Folders"
          sub="Bookmark any student with the save icon, then organise them into folders."
          tag={`${savedCount} SAVED`}
        />
        <div className="fav-head">
          <input
            type="text"
            value={name}
            placeholder="New folder name — e.g. “Olympiad shortlist”"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
          />
          <button type="button" className="btn-back" style={{ marginBottom: 0 }} onClick={create}>+ CREATE FOLDER</button>
        </div>

        {!folders.length && (
          <div className="fav-empty">No folders yet — create one above, then tap the bookmark icon on any student.</div>
        )}

        {folders.map((f) => {
          const kids = f.studentIds.map((id) => ({ id, entry: cache[id] }));
          return (
            <div className="fav-folder" key={f.id}>
              <div className="ff-head">
                <h3>{f.name}</h3>
                <span className="ff-count">{kids.length}</span>
                <button type="button" className="ff-del" title="Delete folder" onClick={() => onDeleteFolder(f.id)}>
                  <X size={12} strokeWidth={2.4} />
                </button>
              </div>
              {kids.length ? (
                <div className="ff-grid">
                  {kids.map(({ id, entry }) => {
                    if (!entry) {
                      return (
                        <div className="fav-card" key={id} style={{ opacity: 0.6 }}>
                          <span className="avatar">{initials('?')}</span>
                          <span className="fi"><span className="fn">Loading…</span><span className="fc">fetching report</span></span>
                        </div>
                      );
                    }
                    if (entry.err) {
                      return (
                        <div className="fav-card" key={id} style={{ opacity: 0.6 }}>
                          <span className="avatar">?</span>
                          <span className="fi"><span className="fn">Unavailable</span><span className="fc">report could not be loaded</span></span>
                        </div>
                      );
                    }
                    const r = entry.report;
                    const stu = r.student || {};
                    return (
                      <div
                        className="fav-card"
                        key={id}
                        role="button"
                        tabIndex={0}
                        title="Open report card"
                        onClick={() => onOpenReport({ id })}
                        onKeyDown={(e) => { if (e.key === 'Enter') onOpenReport({ id }); }}
                      >
                        <span className="avatar">{initials(stu.name)}</span>
                        <span className="fi">
                          <span className="fn">{stu.name || `Student ${id}`}</span>
                          <span className="fc">Class {stu.class_name || '—'}{r.ranks?.in_school ? ` · Rank #${r.ranks.in_school}` : ''}</span>
                        </span>
                        <span className="fa">{r.derived?.overall ?? '—'}%</span>
                        <button
                          type="button"
                          className="fav-x"
                          title="Remove from folder"
                          onClick={(e) => { e.stopPropagation(); onRemoveStudent(f.id, id); }}
                        >
                          <X size={12} strokeWidth={2.4} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="fav-empty">Empty — bookmark students to add them here.</div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
