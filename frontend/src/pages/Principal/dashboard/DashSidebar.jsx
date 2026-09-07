/* DashSidebar — the designer v15 shell sidebar: level links with theme
   dots, Saved link with count, sign out, collapse with tooltips.

   Role-organized nav (dashboard(2).html "role-admin" concept, done with
   real roles): an account that ALSO holds a class-teacher post gets a second
   "CLASS TEACHER UI" group and switches modes in place; admin roles get an
   ADMINISTRATION group linking to the /admin management pages. The school
   logo slot reads /gnps-logo.png from public/ and falls back to the Fetch-X
   mark when the asset isn't provided. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, Bookmark, Briefcase, ChevronRight, GraduationCap, Home, LogOut,
  Presentation, Sparkles, Users,
} from 'lucide-react';

const ICONS = {
  schoolSec: Home,
  subjectSec: BookOpen,
  classSec: GraduationCap,
  studentSec: Users,
  teacherSec: Presentation,
  aiSec: Sparkles,
  ctHome: GraduationCap,
  ctAtt: BookOpen,
  ctTask: BookOpen,
  ctMarks: BookOpen,
  ctTeach: GraduationCap,
  ctMy: BookOpen,
  ctTT: BookOpen,
};

const LVL_OF = { schoolSec: 1, subjectSec: 2, classSec: 3, studentSec: 4, teacherSec: 6, saved: 5, aiSec: 7 };
const LVL_CT = { ctHome: 3, ctAtt: 2, ctTask: 2, ctMarks: 3, ctTeach: 2, ctMy: 6, ctTT: 2 };

const P_LINKS = [
  ['schoolSec', 'School Level'],
  ['subjectSec', 'Subject Level'],
  ['classSec', 'Class Level'],
  ['studentSec', 'Students Level'],
  ['teacherSec', 'Teachers Level'],
  ['aiSec', 'AI Analyst'],
];
const CT_LINKS = [
  ['ctHome', 'My Class'],
  ['ctAtt', 'Attendance'],
  ['ctTask', 'Task Completion'],
  ['ctMarks', 'Academic Marks'],
  ['ctTeach', 'Teaching Classes'],
  ['ctMy', 'My Report'],
  ['ctTT', 'Timetable'],
];
const ADMIN_LINKS = [
  ['/admin/dashboard', 'Dashboard', 'adminDashboard'],
  ['/admin/students', 'Students', 'adminStudents'],
  ['/admin/accounts', 'Accounts', 'adminAccounts'],
  ['/admin/extra-teachers', 'Subject Teachers', 'adminExtra'],
];

/* School logo with a graceful fallback — drop gnps-logo.png into public/
   and every slot picks it up. `box` (sidebar brand) renders the Fetch-X
   gradient tile when the asset is missing; otherwise the bare mark. */
export function SchoolLogo({ size = 20, box = false }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    const svg = (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size }}>
        <path d="M22 9.5L12 4 2 9.5l10 5.5 10-5.5z" />
        <path d="M6 12v4.5c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8V12" />
      </svg>
    );
    return box ? <span className="bx">{svg}</span> : svg;
  }
  return (
    <img
      className={box ? 'dsb-logo' : 'gnps-slot'}
      src="/gnps-logo.png"
      alt=""
      onError={() => setOk(false)}
    />
  );
}

function NavLink({ icon: Icon, label, lvl, active, onClick }) {
  return (
    <button
      type="button"
      data-lvl={lvl}
      data-tip={label}
      className={active ? 'active' : ''}
      style={{ '--nc': `var(--lvl-${lvl}-c, var(--lvlD))` }}
      onClick={onClick}
    >
      <Icon strokeWidth={1.8} />
      <span className="lbl">{label}</span>
    </button>
  );
}

export default function DashSidebar({
  active, onGo, onToggle, savedCount, userName, onSignOut, ct = false, ctLabel,
  mode = 'p', ctGroup = null, adminGroup = false, adminActive = null,
  savedHidden = false,
}) {
  const navigate = useNavigate();

  /* Standalone class-teacher console: one group, CT links. */
  if (ct) {
    return (
      <aside className="dsb">
        <BrandRow onToggle={onToggle} />
        <nav className="dsb-nav" aria-label="Class teacher sections">
          <div className="dsb-glabel">CLASS TEACHER UI · {ctLabel || ''}</div>
          {CT_LINKS.map(([key, label]) => (
            <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_CT[key]}
              active={active === key} onClick={() => onGo(key)} />
          ))}
        </nav>
        <FootRow userName={userName} onSignOut={onSignOut} />
      </aside>
    );
  }

  const dual = !!ctGroup;
  const principalActive = active;

  return (
    <aside className="dsb">
      <BrandRow onToggle={onToggle} />

      <nav className="dsb-nav" aria-label="Dashboard sections">
        <div className="dsb-glabel">PRINCIPAL UI</div>
        {P_LINKS.map(([key, label]) => (
          <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_OF[key]}
            active={mode === 'p' && principalActive === key} onClick={() => onGo(key)} />
        ))}

        {dual && (
          <>
            <div className="dsb-glabel" style={{ marginTop: 10 }}>
              CLASS TEACHER UI · {ctGroup.label || ''}
            </div>
            {CT_LINKS.map(([key, label]) => (
              <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_CT[key]}
                active={mode === 'ct' && ctGroup.active === key} onClick={() => onGo(key)} />
            ))}
          </>
        )}

        {adminGroup && (
          <>
            <div className="dsb-glabel" style={{ marginTop: 10 }}>ADMINISTRATION</div>
            {ADMIN_LINKS.map(([href, label, key]) => (
              <button
                key={href} type="button"
                data-tip={label}
                className={adminActive === key ? 'active' : ''}
                onClick={() => navigate(href)}
              >
                <Briefcase strokeWidth={1.8} />
                <span className="lbl">{label}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="dsb-foot">
        {/* Saved lives in the principal context only — hidden while the CT
            mode is active or on the standalone admin pages. */}
        {mode !== 'ct' && !savedHidden && (
          <button
            type="button"
            data-lvl="5" data-tip="Saved Students"
            className={principalActive === 'saved' && mode === 'p' ? 'dsb-saved active' : 'dsb-saved'}
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

function BrandRow({ onToggle }) {
  return (
    <div className="dsb-brand">
      <SchoolLogo box />
      <span className="nm">FETCH-<b>X</b></span>
      <button type="button" className="chev" onClick={onToggle} title="Collapse / expand" aria-label="Toggle sidebar">
        <ChevronRight strokeWidth={2} />
      </button>
    </div>
  );
}

function FootRow({ userName, onSignOut }) {
  return (
    <div className="dsb-foot">
      <button type="button" className="dsb-sout" onClick={onSignOut} title="Sign out">
        <LogOut strokeWidth={2} />
        <span className="lbl">{(userName || 'SIGN OUT').toUpperCase()} · SIGN OUT</span>
      </button>
    </div>
  );
}
