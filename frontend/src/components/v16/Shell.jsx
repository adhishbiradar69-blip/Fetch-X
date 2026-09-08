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

export function TierBand({ tier = 'pr', lvl = 1, icon, eyebrow, copy, tag }) {
  return (
    <div className={`tier-band lvl-${lvl} tier-${tier}`}>
      <span className="tier-ic">{icon}</span>
      <div className="tier-tt">
        <div className="tier-eyebrow">{eyebrow}</div>
        <p>{copy}</p>
      </div>
      <span className="lvl-rule" />
      <span className="tier-tag">{tag}</span>
    </div>
  );
}

/* Tier wrapper. `extraClass` lets pages add scope classes (e.g. tier-ad). */
export function Tier({ tier = 'pr', first = true, active = true, extraClass = '', id, children }) {
  return (
    <div id={id} className={`tier tier-${tier}${first ? ' first' : ''}${active ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`}>
      {children}
    </div>
  );
}
