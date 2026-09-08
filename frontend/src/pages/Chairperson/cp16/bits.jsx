/* Fetch-X — v16 Chairperson shared bits (Task 3-a).
   Small building blocks reused by the page + CP modals. Markup mirrors
   chairperson.html 1:1 (class names from the designer so v16.css applies);
   charts / hooks / util come from the Principal dashboard's shared modules
   (imported, never edited). */
import { Bookmark } from 'lucide-react';
import { Donut, LineChart, Trend, useReveal } from '../../Principal/dashboard/charts';
import { ATT_TABS, initials, pct } from '../../Principal/dashboard/util';
import { Chip, TeachPill } from '../../Principal/dashboard/Sections';
import { ARR_SVG, subjectShort } from './data';

/* ------------------------------------------------------------- small bits */
export function CpStatCell({ icon: Icon, k, v, of, sep, title }) {
  return (
    <div className={`stat-cell${sep ? ' sep' : ''}`} title={title}>
      <div className="ic"><Icon strokeWidth={1.8} /></div>
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}{of != null && <span className="of">/{of}</span>}</div>
      </div>
    </div>
  );
}

export function CpdSkel({ h = 96, style }) {
  return <div className="pd-skel block" style={{ height: h, ...style }} />;
}

/* Skeleton rows for the org lists (principal's pd-skel-row pattern) */
export function CpdSkelRows({ n = 6 }) {
  return Array.from({ length: n }, (_, i) => (
    <div className="pd-skel-row" key={i}>
      <div className="pd-skel" style={{ height: 24 }} />
      <div className="pd-skel" style={{ height: 16 }} />
      <div className="pd-skel" style={{ height: 16 }} />
      <div className="pd-skel" style={{ height: 16 }} />
      <div className="pd-skel" style={{ height: 24 }} />
    </div>
  ));
}

/* ---------------------------------------------- attendance trend card --- */
/* card.chart-card with the designer's chead/ctabs/cbody + range tabs.
   `series` = the {30D,3M,6M,1Y} slice for one scope. */
export function AttCard({ label, series, range, onRange, loading }) {
  const points = (series || {})[range] || [];
  return (
    <div className="card chart-card fade">
      <div className="chead">
        <span className="label">{label}</span>
        <div className="ctabs">
          {Object.entries(ATT_TABS).map(([k, lab]) => (
            <button key={k} type="button" className={`gtab${k === range ? ' active' : ''}`} onClick={() => onRange?.(k)}>{lab}</button>
          ))}
        </div>
      </div>
      <div className="cbody">
        {loading && !points.length ? <CpdSkel h={190} /> : <LineChart points={points} rangeKey={range} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------- score distro card ---
   Local port of the designer distroHTML (charts.jsx's Distro is the
   principal build; this one keeps the designer's band labels and an honest
   "recorded marks" tooltip — the API bands count marks, not students). */
const BAND_LBL = { '<60': '<60', '60-69': '60–69', '70-79': '70–79', '80-89': '80–89', '90+': '90+' };

export function DistroCard({ label, bands, total, loading }) {
  const reveal = useReveal();
  const rows = (bands || []).map((b) => ({
    label: BAND_LBL[b.band] || b.band,
    n: b.count || 0,
    share: total ? ((b.count || 0) / total) * 100 : 0,
  }));
  const best = rows.reduce((m, r) => (r.n > (m?.n ?? -1) ? r : m), null);
  return (
    <div className="card distro-card fade">
      <div className="label">{label}</div>
      {loading || !bands ? (
        <div style={{ padding: '4px 16px 20px' }}><CpdSkel h={110} /></div>
      ) : (
        <div className="distro">
          {rows.map((r, i) => (
            <div key={r.label} className="d-row" title={`${r.n.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} recorded marks (${Math.round(r.share)}%) in ${r.label}%`}>
              <span className="d-l">{r.label}</span>
              <div className="d-track">
                <i data-w={r.share.toFixed(1)} style={{ width: reveal ? `${r.share}%` : 0, transitionDelay: `${i * 70}ms` }} />
              </div>
              <span className="d-n">{r.n.toLocaleString('en-IN')}<em>· {Math.round(r.share)}%</em></span>
            </div>
          ))}
          <div className="d-foot">
            <span>TOTAL <b>{total.toLocaleString('en-IN')}</b></span>
            {best && <span>BEST BAND <b>{best.label}%</b> ({best.n.toLocaleString('en-IN')})</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------- subject level grid ----- */
/* .subject-grid of .s-card — school modal + grade modal bodies. Donuts ride
   the report's --lvlD (school color) like the designer's default donuts. */
export function SubjectGridBlock({ subjects, nSubjects }) {
  return (
    <div className="subject-grid">
      {(subjects || []).map((s) => (
        <div className="card s-card fade" key={s.name} title={`${s.name} · average ${pct(s.avg)}% · rank #${s.rank ?? '—'}/${nSubjects} in school`}>
          <div className="s-head">
            <span className="s-name">{String(s.name).toUpperCase()}</span>
            <TeachPill name={s.hod} tag="HOD" title={`Head of Department · ${s.hod || '—'}`} />
            <span className={`rank-pill${s.rank === 1 ? ' top' : ''}`}>#{s.rank ?? '—'}<span className="of30">/{nSubjects}</span></span>
          </div>
          <div className="s-body">
            <div className="chips">
              <Chip t="T1" n={pct(s.t?.[0])} />
              <Chip t="T2" n={pct(s.t?.[1])} />
              <Chip t="T3" n={pct(s.t?.[2])} />
            </div>
            <div className="avg-wrap">
              <span className="avg-label">AVERAGE</span>
              <Donut value={s.avg} variant="d-md" />
              <Trend d={pct(s.t?.[2]) - pct(s.t?.[1])} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- org list rows -- */
/* .srow.org-stu — organisation-ranked student (chairperson.html stuRowOrg).
   The v16/students contract carries no per-term trend, so the scorepill is
   bar + pct only (no invented arrows). */
export function OrgStudentRow({ s, colorOf, saved, onOpen, onBookmark }) {
  const reveal = useReveal();
  const c = colorOf(s.school) || {};
  return (
    <div
      className="srow org-stu"
      role="button"
      tabIndex={0}
      title="Open report card"
      onClick={() => onOpen(s)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s); }}
    >
      <span className={`rankbadge${s.org_rank <= 3 ? ' top' : ''}`}>#{s.org_rank ?? '—'}</span>
      <span className="st-name">
        <span className="avatar">{initials(s.name)}</span>
        <span className="nm">{s.name}</span>
      </span>
      <span className="schchip" style={{ '--sc': c.color, '--scSoft': c.soft }} title={s.school}>{s.school}</span>
      <span className="classchip hd-cls">{s.class}</span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(s.avg)} style={{ width: reveal ? `${Math.min(100, pct(s.avg))}%` : 0 }} /></span>
        <span className="pc">{pct(s.avg)}%</span>
      </span>
      <button
        type="button"
        className={`bm${saved ? ' on' : ''}`}
        title="Save to folder"
        aria-label={`Save ${s.name} to folder`}
        onClick={(e) => { e.stopPropagation(); onBookmark(e, s); }}
      >
        <Bookmark strokeWidth={2} />
      </button>
    </div>
  );
}

/* .srow.org-tch — organisation-ranked teacher (chairperson.html tchRowOrg) */
export function OrgTeacherRow({ t, colorOf, onOpen }) {
  const reveal = useReveal();
  const c = colorOf(t.school) || {};
  return (
    <div
      className="srow org-tch"
      role="button"
      tabIndex={0}
      title="Open teacher report"
      onClick={() => onOpen(t)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}
    >
      <span className={`rankbadge${t.org_rank <= 3 ? ' top' : ''}`}>#{t.org_rank ?? '—'}</span>
      <span className="st-name">
        <span className="avatar">{initials(t.name)}</span>
        <span className="nm">{t.name}{t.is_hod ? ' · HOD' : ''}{t.is_ct ? ' · CT' : ''}</span>
      </span>
      <span className="schchip" style={{ '--sc': c.color, '--scSoft': c.soft }} title={t.school}>{t.school}</span>
      <span className="classchip hd-sub" title={t.subject}>{subjectShort(t.subject)}</span>
      <span className="scorepill">
        <span className="bar"><i data-w={pct(t.avg)} style={{ width: reveal ? `${Math.min(100, pct(t.avg))}%` : 0 }} /></span>
        <span className="pc">{t.avg != null ? `${pct(t.avg)}%` : '—'}</span>
      </span>
      <button
        type="button"
        className="tb"
        title="Open teacher report"
        aria-label={`Open report for ${t.name}`}
        onClick={(e) => { e.stopPropagation(); onOpen(t); }}
      >
        {ARR_SVG}
      </button>
    </div>
  );
}

/* ------------------------------------------------------- bookmark pop --- */
/* .bm-pop folder popover (designer bmPop) — portaled to document.body */
export function BmPopover({ pop, newName, onNewName, folders, onToggle, onCreate }) {
  if (!pop) return null;
  return (
    <div className="bm-pop open" style={{ left: pop.left, top: pop.top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="bmp-t">SAVE · {String(pop.student.name || '').toUpperCase()}</div>
      <div>
        {folders.length ? folders.map((f) => (
          <label className="bmopt" key={f.id}>
            <input
              type="checkbox"
              checked={f.studentIds.includes(pop.student.id)}
              onChange={() => onToggle(f.id, pop.student.id)}
            />
            <i className="bx" />
            <span>{f.name}</span>
            <em>{f.studentIds.length}</em>
          </label>
        )) : <div className="bmp-empty">No folders yet — create one below.</div>}
      </div>
      <div className="bmp-new">
        <input
          placeholder="New folder name"
          value={newName}
          onChange={(e) => onNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreate(); } }}
        />
        <button type="button" onClick={onCreate} aria-label="Create folder and save">
          +
        </button>
      </div>
    </div>
  );
}
