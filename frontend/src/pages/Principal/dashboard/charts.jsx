/* Hand-rolled SVG/DOM charts — exact ports of dashboard.html's render
   functions (donut / distro / line / bars / grouped bars / radar).
   No chart library: the prototype's geometry is the source of truth. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CIRC, ATT_RANGES, fmtDay, fmtMon, pct, prefersReducedMotion } from './util';

/* Double-rAF reveal flag — replays the prototype's enter animations.
   Jumps straight to the final state when the user prefers reduced motion. */
// eslint-disable-next-line react-refresh/only-export-components -- useReveal is the shared animation hook for every chart in this file; splitting it out would break the colocation
export function useReveal() {
  const [on, setOn] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (on) return undefined;
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setOn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [on]);
  return on;
}

/* IntersectionObserver scroll-reveal — flips true (once) when the element
   enters the viewport. Falls back to true when IO is unavailable or the
   user prefers reduced motion, so content is never hidden. Pairs with the
   `.lvl.rv` / `.lvl.rv.in` stagger CSS in dashboard.css. */
// eslint-disable-next-line react-refresh/only-export-components -- same colocation rationale as useReveal
export function useInView(margin = '0px 0px -10% 0px') {
  const ref = useRef(null);
  const [inView, setInView] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === 'undefined',
  );
  useEffect(() => {
    if (inView) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, margin]);
  return [ref, inView];
}

/* ------------------------------------------------ donut -------- */
export function Donut({ value, variant = 'd-md', title, style }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const reveal = useReveal();
  const reduced = prefersReducedMotion();
  const [shown, setShown] = useState(reduced ? v : 0);
  /* render-time adjust (endorsed pattern): snap to the final value when
     reduced motion is on, otherwise count up via requestAnimationFrame */
  if (reduced && shown !== v) setShown(v);

  useEffect(() => {
    if (reduced) return undefined;
    let raf;
    const t0 = performance.now() + 150;
    const dur = 1050;
    const tick = (now) => {
      const p = Math.min(1, Math.max(0, (now - t0) / dur));
      setShown(Math.round(v * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [v, reduced]);

  const off = (CIRC * (1 - v / 100)).toFixed(2);
  return (
    <span className={`donut ${variant}`} title={title} style={style} data-off={off}>
      <svg viewBox="0 0 100 100">
        <circle className="track" cx="50" cy="50" r="42" />
        <circle
          className="bar"
          cx="50"
          cy="50"
          r="42"
          strokeDasharray={CIRC}
          strokeDashoffset={reveal ? off : CIRC}
          data-off={off}
        />
      </svg>
      <span className="val" data-val={v}>{shown}%</span>
    </span>
  );
}

/* ------------------------------------------------ trend arrow --- */
export function Trend({ d }) {
  const n = Number(d) || 0;
  const cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
  const tip = n > 0.05 ? `▲ vs previous term: +${Math.round(n)}` :
    n < -0.05 ? `▼ vs previous term: ${Math.round(n)}` : 'vs previous term: no change';
  const text = n > 0.05 ? `▲${Math.round(n)}` : n < -0.05 ? `▼${Math.round(-n)}` : '–';
  return <span className={`trend ${cls}`} title={tip}>{text}</span>;
}

/* ------------------------------------------------ distro -------- */
const BAND_LABELS = { '<60': '<60', '60-69': '60–69', '70-79': '70–79', '80-89': '80–89', '90-100': '90+' };

export function Distro({ bands = [], total = 0 }) {
  const reveal = useReveal();
  const rows = bands.map((b) => {
    const n = b.count || 0;
    const share = total ? (n / total) * 100 : 0;
    return { label: BAND_LABELS[b.band] || b.band, n, share: Math.round(share * 10) / 10 };
  });
  const best = rows.reduce((m, r) => (r.n > (m?.n ?? -1) ? r : m), null);
  return (
    <div className="distro">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className="d-row"
          title={`${r.n} of ${total} students (${Math.round(r.share)}%) in ${r.label}%`}
        >
          <span className="d-l">{r.label}</span>
          <div className="d-track">
            <i
              data-w={r.share.toFixed(1)}
              style={{ width: reveal ? `${r.share}%` : 0, transitionDelay: `${i * 70}ms` }}
            />
          </div>
          <span className="d-n">{r.n.toLocaleString()}<em>· {Math.round(r.share)}%</em></span>
        </div>
      ))}
      <div className="d-foot">
        <span>TOTAL <b>{total.toLocaleString()}</b></span>
        {best && <span>BEST BAND <b>{best.label}%</b> ({best.n.toLocaleString()})</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------ line chart ---- */
const W = 600;

export function LineChart({ points = [], rangeKey = '3M', height: H = 190, rawPoints = null, trendLabel, countLabel }) {
  const reveal = useReveal();
  const plotRef = useRef(null);
  const [hov, setHov] = useState(null); // {i, xp, yp, w}

  const model = useMemo(() => {
    const N = points.length;
    if (!N) return null;
    const B = Math.max(2, Math.min(ATT_RANGES[rangeKey]?.buckets ?? 30, N));
    const vals = [];
    const spans = [];
    for (let i = 0; i < B; i++) {
      const a = Math.floor((i * N) / B);
      const b = Math.max(a + 1, Math.floor(((i + 1) * N) / B));
      let sum = 0;
      let c = 0;
      for (let j = a; j < b && j < N; j++) { sum += points[j].pct; c++; }
      vals.push(Math.round((sum / (c || 1)) * 10) / 10);
      spans.push([a, Math.max(a, b - 1)]);
    }
    const raw = Math.min(...vals);
    const rax = Math.max(...vals);
    const span = Math.max(6, rax - raw);
    const lo = Math.max(0, Math.floor(raw - span * 0.4));
    const hi = Math.min(100, Math.ceil(rax + span * 0.3));
    const y = (v) => H * (1 - (v - lo) / ((hi - lo) || 1));
    const x = (i) => (B > 1 ? (i / (B - 1)) * W : W / 2);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = `M${pts.join(' L')}`;
    const area = `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
    const marks = [hi, lo + ((hi - lo) * 2) / 3, lo + (hi - lo) / 3, lo].map((v) => Math.round(v));
    const useDay = (ATT_RANGES[rangeKey]?.lab ?? 'day') === 'day';
    const lab = (j) => (useDay ? fmtDay(points[j]?.date) : fmtMon(points[j]?.date));
    const xi = [...new Set([0, Math.floor((B - 1) / 3), Math.floor(((B - 1) * 2) / 3), B - 1])];
    const xls = xi.map((i) => lab(spans[i][1]));
    const avg = vals.reduce((a, b) => a + b, 0) / B;
    /* dashed overlay: when the caller supplies the RAW daily record, draw it
       bucketed as "DAILY RECORD"; otherwise compute a 7-day rolling mean of
       the main series so daily noise doesn't read as signal */
    let sline = null;
    let slineLabel = '7-DAY TREND';
    if (rawPoints && rawPoints.length) {
      const M = rawPoints.length;
      const svals = [];
      for (let i = 0; i < B; i++) {
        const a = Math.floor((i * M) / B);
        const b = Math.max(a + 1, Math.floor(((i + 1) * M) / B));
        let sum = 0;
        let c = 0;
        for (let j = a; j < b && j < M; j++) { sum += rawPoints[j].pct; c++; }
        svals.push(Math.round((sum / (c || 1)) * 10) / 10);
      }
      const spts = svals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      sline = `M${spts.join(' L')}`;
      slineLabel = 'DAILY RECORD';
    } else if (N >= 7) {
      const smoothRaw = points.map((_, i) => {
        const a0 = Math.max(0, i - 6);
        let s = 0;
        let c = 0;
        for (let j = a0; j <= i; j++) { s += points[j].pct; c++; }
        return s / c;
      });
      const svals = [];
      for (let i = 0; i < B; i++) {
        const a = Math.floor((i * N) / B);
        const b = Math.max(a + 1, Math.floor(((i + 1) * N) / B));
        let sum = 0;
        let c = 0;
        for (let j = a; j < b && j < N; j++) { sum += smoothRaw[j]; c++; }
        svals.push(Math.round((sum / (c || 1)) * 10) / 10);
      }
      const spts = svals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      sline = `M${spts.join(' L')}`;
    }
    return { B, vals, spans, y, x, line, area, marks, xls, raw, rax, avg, useDay, sline, slineLabel };
  }, [points, rangeKey, H, rawPoints]);

  if (!model) return <div className="pd-note">No attendance data.</div>;
  const { B, vals, y, x, line, area, marks, xls, raw, rax, avg, useDay, sline, slineLabel } = model;

  const onMove = (e) => {
    const el = plotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const i = Math.max(0, Math.min(B - 1, Math.round(rel * (B - 1))));
    setHov({ i, xp: rel * r.width, yp: y(vals[i]), w: r.width });
  };

  const rangeTxt = (i) => {
    const [a, b] = model.spans[i];
    const A = fmtDay(points[a]?.date);
    const Bd = fmtDay(points[b]?.date);
    return A === Bd ? A : `${A} – ${Bd}`;
  };

  return (
    <>
      <div className="lchart">
        <div className="ly" style={{ height: H }}>
          <span>{marks[0]}%</span><span>{marks[1]}%</span><span>{marks[2]}%</span><span>{marks[3]}%</span>
        </div>
        <div className="lmain">
          <div
            className="lplot"
            style={{ height: H }}
            ref={plotRef}
            onMouseMove={onMove}
            onMouseLeave={() => setHov(null)}
          >
            <div className="lgrid">
              {[0, 1, 2, 3].map((k) => <i key={k} style={{ top: `${(k / 3) * 100}%` }} />)}
            </div>
            <div className="lreveal" style={reveal ? { clipPath: 'inset(0 -2% 0 0)' } : undefined}>
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <path d={area} style={{ fill: 'var(--lvlD)', opacity: 0.08 }} />
                <path
                  d={line}
                  vectorEffect="non-scaling-stroke"
                  style={{ fill: 'none', stroke: 'var(--lvlD)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
                />
                {sline && (
                  <path
                    d={sline}
                    vectorEffect="non-scaling-stroke"
                    style={{ fill: 'none', stroke: 'var(--teal)', strokeWidth: 1.7, strokeDasharray: '5 4', strokeLinecap: 'round', opacity: 0.95 }}
                  />
                )}
              </svg>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ pointerEvents: 'none' }}>
              <line
                className={`lxhair${hov ? ' on' : ''}`}
                x1={hov ? x(hov.i).toFixed(1) : 0} y1="0"
                x2={hov ? x(hov.i).toFixed(1) : 0} y2={H}
              />
              <circle
                className={`ldot${hov ? ' on' : ''}`}
                r="4.5"
                cx={hov ? x(hov.i).toFixed(1) : -10}
                cy={hov ? y(vals[hov?.i ?? 0]).toFixed(1) : -10}
              />
            </svg>
            {hov && (
              <div className="ltip on" style={{ left: Math.max(40, Math.min(hov.w - 40, hov.xp)), top: Math.max(4, hov.yp - 48) }}>
                {rangeTxt(hov.i)}<b>{vals[hov.i]}%</b>
              </div>
            )}
          </div>
          <div className="lx">{xls.map((l, i) => <span key={`${l}${i}`}>{l}</span>)}</div>
        </div>
      </div>
      <div className="d-foot" style={{ marginTop: 10 }}>
        <span>NOW <b>{vals[B - 1]}%</b></span>
        <span>AVG <b>{avg.toFixed(1)}%</b></span>
        <span>LOW <b>{raw}%</b></span>
        <span>HIGH <b>{rax}%</b></span>
        <span>{countLabel || (useDay ? 'DAILY RECORDS' : 'WINDOW')} <b>{points.length}</b></span>
        {sline && <span className="trend-key"><i />{trendLabel || slineLabel}</span>}
      </div>
    </>
  );
}

/* ------------------------------------------------ bar chart ----- */
export function BarChart({ items = [], onClick, flat = false, topName, height: H = 210 }) {
  const reveal = useReveal();
  const N = items.length;
  if (!N) return <div className="pd-note">No data.</div>;
  const avg = items.reduce((a, b) => a + b.val, 0) / N;
  return (
    <>
      <div className="vwrap">
        <div className="vinner" style={{ minWidth: N * 27 + 30 }}>
          <div className="vplot" style={{ height: H }}>
            <div className="vgrid">
              {[0, 25, 50, 75, 100].map((v) => <i key={v} style={{ bottom: `${v}%` }} />)}
            </div>
            <div className="vbars">
              {items.map((it, i) => (
                <div
                  key={`${it.label}-${i}`}
                  className={`vbar${i === 0 ? ' top' : ''}${onClick ? ' clickable' : ''}`}
                  title={`${it.tip}${onClick ? ' — click to open' : ''}`}
                  onClick={onClick ? () => onClick(i) : undefined}
                  role={onClick ? 'button' : undefined}
                >
                  <i
                    data-h={it.val}
                    style={{ height: reveal ? `${Math.min(100, it.val)}%` : 0, transitionDelay: `${Math.min(i * 12, 240)}ms` }}
                  />
                  <span className="vval" style={{ bottom: `calc(${Math.min(100, it.val)}% + 7px)` }}>{pct(it.val)}%</span>
                </div>
              ))}
            </div>
            <div className="vavg" style={{ bottom: `${avg.toFixed(1)}%` }} title={`Average · ${Math.round(avg)}%`} />
            <span className="vtop" style={{ left: `${((0.5 / N) * 100).toFixed(2)}%`, bottom: `calc(${Math.min(100, items[0].val)}% + 6px)` }}>
              {pct(items[0].val)}%
            </span>
          </div>
          <div className={`vlabels${flat ? ' flat' : ''}`}>
            {items.map((it, i) => <span key={`l-${it.label}-${i}`}><b>{it.label}</b></span>)}
          </div>
        </div>
      </div>
      <div className="d-foot" style={{ marginTop: 10 }}>
        <span>COUNT <b>{N}</b></span>
        <span>AVG <b>{Math.round(avg)}%</b></span>
        <span>TOP <b>{topName || items[0].label}</b></span>
        <span>BEST <b>{pct(items[0].val)}%</b></span>
      </div>
    </>
  );
}

/* --------------------------------------- grouped double bars ---- */
export function GroupedBars({ items = [], onClick, height: H = 210 }) {
  const reveal = useReveal();
  const N = items.length;
  if (!N) return <div className="pd-note">No data.</div>;
  const avgA = items.reduce((a, b) => a + b.a, 0) / N;
  const avgB = items.reduce((a, b) => a + b.b, 0) / N;
  return (
    <>
      <div className="vwrap">
        <div className="vinner" style={{ minWidth: N * 62 + 30 }}>
          <div className="vplot" style={{ height: H }}>
            <div className="vgrid">
              {[0, 25, 50, 75, 100].map((v) => <i key={v} style={{ bottom: `${v}%` }} />)}
            </div>
            <div className="vpairs">
              {items.map((it, i) => (
                <div
                  className={`vpair${onClick ? ' clickable' : ''}`}
                  key={`${it.label}-${i}`}
                  title={`${it.tip}${onClick ? ' — click to open' : ''}`}
                  onClick={onClick ? () => onClick(i) : undefined}
                  role={onClick ? 'button' : undefined}
                  tabIndex={onClick ? 0 : undefined}
                  onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(i); } : undefined}
                >
                  <div className="vbar2 a">
                    <i data-h={it.a} style={{ height: reveal ? `${Math.min(100, it.a)}%` : 0, transitionDelay: `${Math.min(i * 40, 240)}ms` }} />
                    <span className="vval" style={{ bottom: `calc(${Math.min(100, it.a)}% + 6px)` }}>{pct(it.a)}</span>
                  </div>
                  <div className="vbar2 b">
                    <i data-h={it.b} style={{ height: reveal ? `${Math.min(100, it.b)}%` : 0, transitionDelay: `${Math.min(i * 40, 240)}ms` }} />
                    <span className="vval" style={{ bottom: `calc(${Math.min(100, it.b)}% + 6px)` }}>{pct(it.b)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="vlabels flat glabels">
            {items.map((it, i) => <span key={`g-${it.label}-${i}`}><b>{it.label}</b></span>)}
          </div>
        </div>
      </div>
      <div className="d-foot" style={{ marginTop: 10 }}>
        <span>SUBJECTS <b>{N}</b></span>
        <span>AVG MARKS <b>{Math.round(avgA)}%</b></span>
        <span>AVG TASKS <b>{Math.round(avgB)}%</b></span>
        <span>TOP <b>{items[0].label}</b></span>
      </div>
    </>
  );
}

/* ------------------------------------------------ radar --------- */
export function Radar({ labels = [], values = [], size = 260 }) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.355;
  const hole = size * 0.055;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(6, labels.length);
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const rp = (v) => hole + ((R - hole) * Math.min(100, Math.max(0, v))) / 100;
  const f = (n) => n.toFixed(1);

  const rings = [];
  for (let k = 5; k >= 1; k--) {
    const r = rp(k * 20);
    rings.push(
      <polygon
        key={k}
        points={labels.map((_, i) => pt(i, r).map(f).join(',')).join(' ')}
        fill="none" stroke="#c9c2f5" strokeWidth="1" strokeDasharray="3 4"
      />,
    );
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`}>
      {rings}
      {labels.map((_, i) => {
        const [a, b] = pt(i, hole);
        const [c, d] = pt(i, R);
        return <line key={`ax-${i}`} x1={f(a)} y1={f(b)} x2={f(c)} y2={f(d)} stroke="#c9c2f5" strokeWidth="1" strokeDasharray="2 4" />;
      })}
      <polygon
        points={labels.map((_, i) => pt(i, rp(values[i] || 0)).map(f).join(',')).join(' ')}
        fill="rgba(79,66,221,.10)" stroke="#4f42dd" strokeWidth="1.6" strokeLinejoin="round"
      />
      {labels.map((_, i) => {
        const [x, y] = pt(i, rp(values[i] || 0));
        return (
          <circle key={`dot-${i}`} cx={f(x)} cy={f(y)} r="3.4" fill="#4f42dd">
            <title>{labels[i]}: {Math.round(values[i] || 0)}%</title>
          </circle>
        );
      })}
      {labels.map((label, i) => {
        const [x, y] = pt(i, R + 17);
        const c = Math.cos(ang(i));
        const anchor = c > 0.1 ? 'start' : c < -0.1 ? 'end' : 'middle';
        const dy = Math.sin(ang(i)) < -0.1 ? -3 : Math.sin(ang(i)) > 0.1 ? 8 : 4;
        return (
          <text
            key={`lb-${i}`} x={f(x)} y={f(y + dy)} textAnchor={anchor}
            fontSize="11.5" fontWeight="600" style={{ fill: 'var(--ink)', opacity: 0.78 }}
            fontFamily="Inter,system-ui,sans-serif"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}
