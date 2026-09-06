/* DashSidebar — the designer v15 shell sidebar: level links with theme
   dots, Saved link with count, sign out, collapse with tooltips. */
import {
  BookOpen, Bookmark, ChevronRight, GraduationCap, Home, LogOut, Presentation, Users,
} from 'lucide-react';

const ICONS = {
  schoolSec: Home,
  subjectSec: BookOpen,
  classSec: GraduationCap,
  studentSec: Users,
  teacherSec: Presentation,
};

const LVL_OF = { schoolSec: 1, subjectSec: 2, classSec: 3, studentSec: 4, teacherSec: 6, saved: 5 };

export default function DashSidebar({
  active, onGo, onToggle, savedCount, userName, onSignOut, ct = false, ctLabel,
}) {
  const pLinks = [
    ['schoolSec', 'School Level'],
    ['subjectSec', 'Subject Level'],
    ['classSec', 'Class Level'],
    ['studentSec', 'Students Level'],
    ['teacherSec', 'Teachers Level'],
  ];
  const ctLinks = [
    ['ctHome', 'My Class'],
    ['ctAtt', 'Attendance'],
    ['ctTask', 'Task Completion'],
    ['ctMarks', 'Academic Marks'],
    ['ctTeach', 'Teaching Classes'],
    ['ctMy', 'My Report'],
    ['ctTT', 'Timetable'],
  ];
  const links = ct ? ctLinks : pLinks;
  const LVL_CT = { ctHome: 3, ctAtt: 2, ctTask: 2, ctMarks: 3, ctTeach: 2, ctMy: 6, ctTT: 2 };

  return (
    <aside className="dsb">
      <div className="dsb-brand">
        <span className="bx">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
            <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
          </svg>
        </span>
        <span className="nm">FETCH-<b>X</b></span>
        <button type="button" className="chev" onClick={onToggle} title="Collapse / expand" aria-label="Toggle sidebar">
          <ChevronRight strokeWidth={2} />
        </button>
      </div>

      <nav className="dsb-nav" aria-label="Dashboard sections">
        <div className="dsb-glabel">{ct ? `CLASS TEACHER UI · ${ctLabel || ''}` : 'PRINCIPAL UI'}</div>
        {links.map(([key, label]) => {
          const Icon = ICONS[key] || GraduationCap;
          const lvl = ct ? LVL_CT[key] : LVL_OF[key];
          return (
            <button
              key={key} type="button"
              data-lvl={lvl}
              data-tip={label}
              className={active === key ? 'active' : ''}
              style={{ '--nc': `var(--lvl-${lvl}-c, var(--lvlD))` }}
              onClick={() => onGo(key)}
            >
              <Icon strokeWidth={1.8} />
              <span className="lbl">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="dsb-foot">
        {!ct && (
          <button
            type="button"
            data-lvl="5" data-tip="Saved Students"
            className={active === 'saved' ? 'dsb-saved active' : 'dsb-saved'}
            style={{ '--nc': 'var(--lvl-5-c, #0e7490)', position: 'relative' }}
            onClick={() => onGo('saved')}
          >
            <Bookmark strokeWidth={2} />
            <span className="lbl">Saved</span>
            <span className="scount" style={{ background: 'var(--nc, #0e7490)' }}>{savedCount}</span>
          </button>
        )}
        <button type="button" className="dsb-sout" onClick={onSignOut} title="Sign out">
          <LogOut strokeWidth={2} />
          <span className="lbl">{(userName || 'SIGN OUT').toUpperCase()} · SIGN OUT</span>
        </button>
      </div>
    </aside>
  );
}
