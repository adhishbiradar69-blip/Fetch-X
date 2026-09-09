/* v16 shared shell pieces — ported 1:1 from the Sep 7 designer files.
   PageHead  = .pagehead > .ph-tt.tier-{tier} + optional search + actions
   TierBand  = .tier-band.lvl-{lvl} (icon + eyebrow + copy + rule + tag)
   Tier      = .tier.tier-{tier}.first.active wrapper

   Class names keep the designer's so the v16.css layer applies untouched. */

export function PageHead({ tier = 'pr', eyebrow, title, subtitle, searchSlot, actions }) {
  return (
    <header className="pagehead">
      <div className={`ph-tt tier-${tier}`}>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <div className="subtitle">{subtitle}</div>
      </div>
      {searchSlot}
      <div className="pagehead-actions">{actions}</div>
    </header>
  );
}

/* TierBand — v17 adds a collapse chevron on the band itself: clicking
   toggles `.collapsed` on the parent `.tier`, hiding every `.lvl` section
   below (prototype lines 665-673 + INIT 3011-3015). Kept opt-in via
   `collapsible` so existing pages render exactly as before. */
export function TierBand({ tier = 'pr', lvl = 1, icon, eyebrow, copy, tag, collapsible = false, collapsed = false, onToggleCollapse }) {
  const chev = (
    <button
      type="button"
      className="tier-chev"
      aria-label={collapsed ? 'Expand section' : 'Collapse section'}
      aria-expanded={!collapsed}
      onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
      style={collapsible ? undefined : { display: 'none' }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
    </button>
  );
  const band = (
    <div
      className={`tier-band lvl-${lvl} tier-${tier}${collapsible ? ' collapsible' : ''}`}
      onClick={collapsible ? onToggleCollapse : undefined}
      role={collapsible ? 'button' : undefined}
      tabIndex={collapsible ? 0 : undefined}
      onKeyDown={collapsible ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapse?.(); } } : undefined}
      title={collapsible ? (collapsed ? 'Expand all sections' : 'Hide all sections') : undefined}
    >
      <span className="tier-ic">{icon}</span>
      <div className="tier-tt">
        <div className="tier-eyebrow">{eyebrow}</div>
        <p>{copy}</p>
      </div>
      <span className="lvl-rule" />
      <span className="tier-tag">{tag}</span>
      {chev}
    </div>
  );
  return band;
}

/* Tier wrapper. `extraClass` lets pages add scope classes (e.g. tier-ad). */
export function Tier({ tier = 'pr', first = true, active = true, extraClass = '', id, children }) {
  return (
    <div id={id} className={`tier tier-${tier}${first ? ' first' : ''}${active ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`}>
      {children}
    </div>
  );
}
