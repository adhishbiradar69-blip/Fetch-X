/* DashSidebar — the designer v15 shell sidebar, upgraded to v16:
   • 48px school logo block (.school-logo) above the brand row
   • nav groups carry a .dsb-glabel with a colored .g-dot (tier color)
   • sign-out reads "{ROLE} · SIGN OUT" (role, not user name)

   Role-organized nav (dashboard(2).html "role-admin" concept, done with
   real roles): an account that ALSO holds a class-teacher post gets a second
   "CLASS TEACHER" group and switches modes in place; admin roles get an
   ADMIN group linking to the /admin management pages. The school logo slot
   reads /gnps-logo.png from public/ and hides itself when the asset isn't
   provided (designer onerror behavior).

   v16 generic groups API (used by the principal / chairperson / admin /
   developer builds — any page can pass `groups`):
     groups = [{
       key, label, dot, active,          // dot = css color, label = CAPS text
       links: [{ key, label, lvl, icon } | { key, label, href, icon }],
     }]
   `activeGroup` selects which group's links render as active. */
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
  /* v16 groups */
  cpGroup: Briefcase,
  cpSchools: Home,
  cpGrades: GraduationCap,
  adDash: Home,
  adClasses: GraduationCap,
  adStaff: Presentation,
  adStudents: Users,
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

/* 48px school logo block — v16 sidebar top. Hides itself when the asset is
   missing (designer `onerror` behavior). */
export function SchoolLogoBlock() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="school-logo" title="Guru Nanak Group of Schools">
      <img src="/gnps-logo.png" alt="GNPS Group" onError={() => setOk(false)} />
    </div>
  );
}

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

function NavLink({ icon: Icon, label, lvl, active, onClick, iconEl }) {
  return (
    <button
      type="button"
      data-lvl={lvl}
      data-tip={label}
      className={active ? 'active' : ''}
      style={{ '--nc': `var(--lvl-${lvl}-c, var(--lvlD))` }}
      onClick={onClick}
    >
      {iconEl || (Icon ? <Icon strokeWidth={1.8} /> : null)}
      <span className="lbl">{label}</span>
    </button>
  );
}

/* v16 group label: colored g-dot + caps label, clickable (developer build
   uses label clicks to switch tiers). */
function GroupLabel({ label, dot, active, onClick }) {
  return (
    <div
      type="button"
      className={`dsb-glabel${active ? ' active-tier' : ''}`}
      style={{ '--tD': dot || 'var(--lvlD, #5b4fe9)', marginTop: 0 }}
      data-tip={label}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      <span className="g-dot" />
      <span className="glabel-txt">{label}</span>
    </div>
  );
}

export default function DashSidebar({
  active, onGo, onToggle, savedCount, userName, onSignOut, ct = false, ctLabel,
  mode = 'p', ctGroup = null, adminGroup = false, adminActive = null,
  savedHidden = false,
  /* ---- v16 ---- */
  logo = true,              // 48px .school-logo block above the brand row
  roleLabel = null,         // "{ROLE} · SIGN OUT" prefix (defaults to userName)
  schoolLabel = null,       // v17: appended to the PRINCIPAL group label
  groups = null,            // generic v16 groups (see header)
  activeGroup = null,       // key of the active group
  onGroupClick = null,      // group-label click (developer build tier switch)
}) {
  const navigate = useNavigate();

  const foot = (showSaved) => (
    <div className="dsb-foot">
      {showSaved && (
        <button
          type="button"
          data-lvl="5" data-tip="Saved Students"
          className={active === 'saved' && mode !== 'ct' ? 'dsb-saved active' : 'dsb-saved'}
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
        <span className="lbl">{(roleLabel || userName || 'SIGN OUT').toUpperCase()} · SIGN OUT</span>
      </button>
    </div>
  );

  /* Standalone class-teacher console: one group, CT links. */
  if (ct) {
    return (
      <aside className="dsb">
        {logo && <SchoolLogoBlock />}
        <BrandRow onToggle={onToggle} />
        <nav className="dsb-nav" aria-label="Class teacher sections">
          <GroupLabel label={`CLASS TEACHER · ${ctLabel || ''}`.trim()} dot="#b45f04" active />
          {CT_LINKS.map(([key, label]) => (
            <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_CT[key]}
              active={active === key} onClick={() => onGo(key)} />
          ))}
        </nav>
        {foot(false)}
      </aside>
    );
  }

  /* ---- v16 generic groups (chairperson / admin / developer builds) ---- */
  if (groups) {
    return (
      <aside className="dsb">
        {logo && <SchoolLogoBlock />}
        <BrandRow onToggle={onToggle} />
        <nav className="dsb-nav" aria-label="Dashboard sections">
          {groups.map((g, gi) => (
            <div key={g.key} style={gi > 0 ? { marginTop: 10, borderTop: '1px dashed var(--line)', paddingTop: 12 } : undefined}>
              <GroupLabel
                label={g.label}
                dot={g.dot}
                active={g.key === activeGroup}
                onClick={() => (onGroupClick ? onGroupClick(g.key) : g.onLabelClick?.())}
              />
              {g.links.map((l) => (
                <NavLink
                  key={l.key}
                  /* l.icon may be a designer SVG ELEMENT (not a component) —
                     route it through iconEl; fall back to the component map */
                  icon={l.icon ? undefined : (ICONS[l.key] || Home)}
                  iconEl={l.icon || null}
                  label={l.label}
                  lvl={l.lvl}
                  active={g.key === activeGroup && active === l.key}
                  onClick={() => (l.href ? navigate(l.href) : onGo(l.key))}
                />
              ))}
            </div>
          ))}
        </nav>
        {foot(!savedHidden)}
      </aside>
    );
  }

  const dual = !!ctGroup;
  const principalActive = active;

  return (
    <aside className="dsb">
      {logo && <SchoolLogoBlock />}
      <BrandRow onToggle={onToggle} />

      <nav className="dsb-nav" aria-label="Dashboard sections">
        <GroupLabel label={`PRINCIPAL${schoolLabel ? ` · ${schoolLabel}` : ''}`} dot="#0e7490" active={mode === 'p'} />
        {P_LINKS.map(([key, label]) => (
          <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_OF[key]}
            active={mode === 'p' && principalActive === key} onClick={() => onGo(key)} />
        ))}

        {dual && (
          <>
            <div style={{ marginTop: 10, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
              <GroupLabel label={`CLASS TEACHER · ${ctGroup.label || ''}`} dot="#b45f04" active={mode === 'ct'} onClick={() => onGo('ctHome')} />
              {CT_LINKS.map(([key, label]) => (
                <NavLink key={key} icon={ICONS[key]} label={label} lvl={LVL_CT[key]}
                  active={mode === 'ct' && ctGroup.active === key} onClick={() => onGo(key)} />
              ))}
            </div>
          </>
        )}

        {adminGroup && (
          <>
            <div style={{ marginTop: 10, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
              <GroupLabel label="ADMIN" dot="#c2255c" active={false} />
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
            </div>
          </>
        )}
      </nav>

      {foot(mode !== 'ct' && !savedHidden)}
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
