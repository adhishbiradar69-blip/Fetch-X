import { Page } from '../lib/motion.jsx';

/* Fetch-X loading skeletons — page-shaped placeholders that predict the real
   layout (eyebrow pill → Lora title → subtitle → KPI strip → content → table)
   using the shimmer primitives already defined in index.css
   (.skeleton-line / .skeleton-block + the shimmerSweep keyframes).

   Design notes:
   - KPI/table cards carry the signature offset-shadow card look so the load
     state feels like the design system rather than a grey void.
   - Every width is slightly irregular (i-rotated pseudo-randoms) so the
     skeleton doesn't look mechanically stamped.
   - aria-busy + role="status" give screen readers a proper loading signal. */

export function Sk({ w = '100%', h = 12, r = 6, style, className = '' }) {
  return (
    <div
      className={`skeleton-line ${className}`}
      style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }}
    />
  );
}

export function SkCard({ h = 120, r = 13, style, className = '', children }) {
  return (
    <div
      className={`skeleton-block ${className}`}
      style={{
        height: h, borderRadius: r, border: '1px solid var(--line)',
        boxShadow: '5px 6px 0 0 var(--shadow)', background: 'var(--surf)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* One KPI stat-cell placeholder (icon chip + label + value + delta). */
export function SkStat() {
  return (
    <div className="fx-sk-kpi">
      <Sk w={46} h={46} r={12} />
      <div className="fx-sk-kpi-txt">
        <Sk w="55%" h={9} r={5} />
        <Sk w="80%" h={20} r={7} style={{ marginTop: 9 }} />
        <Sk w="42%" h={8} r={5} style={{ marginTop: 8, opacity: 0.6 }} />
      </div>
    </div>
  );
}

/* One table-row placeholder (rank chip + name + two bars + pill). */
export function SkRow({ i = 0 }) {
  const w1 = 30 + ((i * 17) % 26);
  const w2 = 10 + ((i * 13) % 12);
  return (
    <div className="fx-sk-trow">
      <Sk w={26} h={26} r={8} />
      <Sk w={`${w1}%`} h={11} r={5} />
      <Sk w={`${w2}%`} h={11} r={5} style={{ opacity: 0.7 }} />
      <Sk w="14%" h={11} r={5} style={{ opacity: 0.7 }} />
      <Sk w={62} h={20} r={999} />
    </div>
  );
}

/* Page-shaped skeleton. `charts` renders chart-shaped blocks between the KPI
   strip and the table; pass `stats={0}` to hide the KPI strip. */
export function SkeletonPage({
  eyebrowW = 92, titleW = 264, subW = 352, stats = 4,
  charts = 1, rows = 5, children,
}) {
  return (
    <Page aria-busy="true">
      <div role="status" aria-label="Loading content" className="fx-sk-page">
        <div className="fx-sk-pagehead">
          <Sk w={eyebrowW} h={10} r={999} style={{ opacity: 0.8 }} />
          <Sk w={titleW} h={27} r={8} style={{ marginTop: 13 }} />
          <Sk w={subW} h={12} r={6} style={{ marginTop: 10, opacity: 0.65 }} />
        </div>

        {stats > 0 && (
          <div className="fx-sk-kpis" style={{ '--n': stats }}>
            {Array.from({ length: stats }).map((_, i) => <SkStat key={i} />)}
          </div>
        )}

        {children}

        {charts > 0 && (
          <div className="fx-sk-charts" style={{ '--n': charts }}>
            {Array.from({ length: charts }).map((_, i) => (
              <SkCard key={i} h={210}>
                <div className="fx-sk-chart-inner">
                  <Sk w="34%" h={12} r={6} />
                  <div className="fx-sk-bars">
                    {[52, 78, 40, 88, 62, 70, 46, 80].map((b, j) => (
                      <Sk key={j} w={14 + ((j * 7) % 10)} h={b} r={5}
                        style={{ alignSelf: 'flex-end', opacity: 0.55 + (j % 3) * 0.15 }} />
                    ))}
                  </div>
                </div>
              </SkCard>
            ))}
          </div>
        )}

        <SkCard h={54 + rows * 40}>
          <div className="fx-sk-table-inner">
            <Sk w="30%" h={13} r={6} />
            <div style={{ marginTop: 16 }}>
              {Array.from({ length: rows }).map((_, i) => <SkRow key={i} i={i} />)}
            </div>
          </div>
        </SkCard>
      </div>
    </Page>
  );
}
