/* Resizable AI right panel — the prototype's shell with a REAL backend:
   suggestion chips submit, the input sends, answers are rendered as
   markdown (now including real TABLES — both markdown tables and the
   backend's ```table blocks), ```chart blocks render real in-theme graphs,
   and failures get a graceful error card.

   The conversation lives in the shared aiThread store, so it carries over
   intact between this side panel and the dedicated full AI page
   (#ai view) — when the thread gets long, an inline chip offers the jump.
   Personas: 'principal' (Fetch-X AI) and 'vcp' (VCP AI, operations). */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronRight, Copy, Eraser, Maximize2, SendHorizontal, TrendingUp, Trophy, User } from 'lucide-react';
import { prefersReducedMotion } from './util';
import { SchoolLogo } from './DashSidebar';
import { BarChart, Distro, LineChart } from './charts';
import { AI_PERSONAS, aiAsk, aiClear, aiRetry, getAiSnapshot, subscribeAi, suggestFollowups } from './aiThread';

/* ---------- AI chart blocks — render the backend's chart payloads ------ */
export function AiChart({ spec }) {
  if (!spec || typeof spec !== 'object') return null;
  let body = null;
  if (spec.type === 'bar' && Array.isArray(spec.items)) {
    body = <BarChart items={spec.items.map((it) => ({ label: String(it.label ?? ''), val: Number(it.val) || 0, tip: it.tip }))} height={170} flat />;
  } else if (spec.type === 'distro' && Array.isArray(spec.bands)) {
    body = <Distro bands={spec.bands} total={spec.total || spec.bands.reduce((a, b) => a + (b.count || 0), 0)} />;
  } else if (spec.type === 'line' && Array.isArray(spec.points)) {
    body = <LineChart points={spec.points} height={170} />;
  } else if (spec.type === 'donut') {
    body = (
      <div style={{ display: 'grid', placeItems: 'center', padding: '8px 0 12px' }}>
        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--lvlD, var(--brand))' }}>
          {Number(spec.value) || 0}%
        </div>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: 'var(--muted)' }}>
          {(spec.title || '').toUpperCase()}
        </div>
      </div>
    );
  }
  if (!body) return null;
  return (
    <div className="card" style={{ margin: '10px 0', overflow: 'hidden' }}>
      {spec.title
        ? <div className="label" style={{ padding: '10px 14px 2px', fontSize: 9, fontWeight: 800, letterSpacing: '.09em', color: 'var(--muted)' }}>{spec.title}</div>
        : null}
      <div style={{ padding: '2px 14px 12px' }}>{body}</div>
    </div>
  );
}

/* ---------- AI table blocks — the backend's ```table payloads ---------- */
/* spec: { title, rows: [{col: val, ...}, ...] } — column order comes from
   the first row's keys. Rendered with the design kit's own CSS vars so it
   follows light/dark automatically. */
export function AiTable({ spec }) {
  if (!spec || !Array.isArray(spec.rows) || !spec.rows.length) return null;
  const cols = Object.keys(spec.rows[0]);
  return (
    <div className="card" style={{ margin: '10px 0', overflow: 'hidden' }}>
      {spec.title
        ? <div className="label" style={{ padding: '10px 14px 2px', fontSize: 9, fontWeight: 800, letterSpacing: '.09em', color: 'var(--muted)' }}>{spec.title}</div>
        : null}
      <div style={{ padding: '2px 14px 12px', overflowX: 'auto' }}>
        <table className="ai-table">
          <thead>
            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {spec.rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c}>{r[c] ?? '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- markdown renderer (tables + charts + code fences) ---------- */
function inline(text) {
  const parts = [];
  let rest = text;
  let k = 0;
  while (rest.length) {
    const b = rest.match(/\*\*([^*]+)\*\*/);
    const c = rest.match(/`([^`]+)`/);
    let n = null;
    if (b && (!c || b.index < c.index)) n = { type: 'b', text: b[1], index: b.index, len: b[0].length };
    else if (c) n = { type: 'c', text: c[1], index: c.index, len: c[0].length };
    if (!n) { parts.push(rest); break; }
    if (n.index > 0) parts.push(rest.slice(0, n.index));
    if (n.type === 'b') parts.push(<strong key={k++}>{n.text}</strong>);
    else parts.push(<code key={k++}>{n.text}</code>);
    rest = rest.slice(n.index + n.len);
  }
  return parts;
}

/* markdown table cells: | a | b | (with a |---|---| separator row) */
const isPipeRow = (t) => t.startsWith('|') && t.endsWith('|');
const isSepRow = (t) => /^\|?[\s:|-]+\|?$/.test(t) && t.includes('-');
const splitRow = (t) => t.slice(1, -1).split('|').map((c) => c.trim());

function MdTable({ rows }) {
  const [head, ...body] = rows;
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table className="ai-table">
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
        <tbody>
          {body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownLite({ text }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const out = [];
  let lt = null;
  let li = [];
  let olStart = 0; /* first number of the current ol run — nested bullets split
                      an ol into several <ol> blocks; carry the numbering so
                      items 2..n don't all render as "1." (HTML restarts at 1) */
  const flush = () => {
    if (li.length) {
      out.push(lt === 'ol'
        ? <ol key={`l${out.length}`} start={olStart > 1 ? olStart : undefined}>{li}</ol>
        : <ul key={`l${out.length}`}>{li}</ul>);
      li = [];
      lt = null;
      olStart = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    /* --- fenced blocks: ```chart → graph, ```table → grid, else pre --- */
    if (line.trim().startsWith('```')) {
      flush();
      const lang = line.trim().slice(3).trim().toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      if (lang === 'chart' || lang === 'table') {
        let spec = null;
        try { spec = JSON.parse(buf.join('\n')); } catch { /* malformed */ }
        if (spec) {
          out.push(lang === 'chart'
            ? <AiChart key={`c${i}`} spec={spec} />
            : <AiTable key={`t${i}`} spec={spec} />);
        }
      } else {
        out.push(
          <pre key={`f${i}`} style={{
            background: 'var(--chip)', borderRadius: 10, padding: '10px 12px',
            fontSize: 11, overflowX: 'auto', margin: '8px 0',
          }}>{buf.join('\n')}</pre>,
        );
      }
      continue;
    }
    /* --- markdown tables (| a | b | + separator) ----------------------- */
    const t = line.trim();
    if (isPipeRow(t) && i + 1 < lines.length && isSepRow(lines[i + 1].trim())) {
      flush();
      const rows = [splitRow(t)];
      i += 2; // skip the separator
      while (i < lines.length && isPipeRow(lines[i].trim())) { rows.push(splitRow(lines[i].trim())); i++; }
      i--;
      out.push(<MdTable key={`mt${i}`} rows={rows} />);
      continue;
    }
    if (!t) { flush(); continue; }
    if (t.startsWith('### ') || t.startsWith('## ') || t.startsWith('# ')) {
      flush();
      out.push(<h3 key={i}>{inline(t.replace(/^#+\s/, ''))}</h3>);
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      if (lt !== 'ul') { flush(); lt = 'ul'; }
      li.push(<li key={i}>{inline(t.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(t)) {
      const num = parseInt(t.match(/^(\d+)\./)[1], 10);
      if (lt !== 'ol') { flush(); lt = 'ol'; }
      if (!li.length) olStart = num; /* opening item of a run sets the start */
      li.push(<li key={i}>{inline(t.replace(/^\d+\.\s/, ''))}</li>);
    } else if (/^(---|___|\*\*\*)$/.test(t)) {
      flush();
      out.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '10px 0' }} />);
    } else {
      flush();
      out.push(<p key={i}>{inline(t)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

/* ---------- per-message COPY (clipboard + COPIED feedback) ------------- */
function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard API unavailable (http/permissions) — last-resort path */
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* give up silently */ }
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <button
      type="button" className={`ai-copy${done ? ' ok' : ''}`}
      onClick={copy}
      title="Copy this answer"
      aria-label={done ? 'Copied' : 'Copy this answer'}
    >
      {done ? <Check strokeWidth={2.4} /> : <Copy strokeWidth={2} />}
      <span aria-live="polite">{done ? 'COPIED' : 'COPY'}</span>
    </button>
  );
}

/* ---------- shared message list (side panel + full page both use it) --- */
export function AiMessageList({ msgs, loading, persona, endRef, onAsk }) {
  /* chips only after the LAST answer — older messages stay quiet */
  const lastBotIdx = (() => {
    if (loading) return -1;
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'bot') return i;
    return -1;
  })();
  const followups = onAsk && lastBotIdx === msgs.length - 1
    ? suggestFollowups(persona, msgs)
    : [];
  return (
    <>
      {msgs.map((m, i) => {
        if (m.role === 'bot' && m.pending) return null; /* placeholder — the loading wave speaks for it */
        if (m.role === 'user') return <div className="ai-msg user" key={i}>{m.content}</div>;
        if (m.role === 'error') {
          /* 403 means "not your role", not "backend down" — a retry
             can never succeed, so it's hidden. */
          const forbidden = m.status === 403;
          return (
            <div className="ai-err" key={i}>
              <span>{forbidden
                ? 'AI insights are available to principal, vice-principal and admin accounts.'
                : 'The AI could not be reached. Check that the backend is running, then retry.'}</span>
              {!forbidden && <button type="button" onClick={() => aiRetry(persona)}>RETRY</button>}
            </div>
          );
        }
        return (
          <div className="ai-msg bot" key={i}>
            <MarkdownLite text={m.content} />
            {(m.source || m.tools?.length > 0 || !loading) && (
              <div className="ai-badges">
                {m.source && <span className="ai-badge">{m.source}</span>}
                {(m.tools || []).map((t) => <span className="ai-badge tools" key={t}>{t}</span>)}
                {!loading && <CopyBtn text={m.content} />}
              </div>
            )}
            {i === lastBotIdx && followups.length > 0 && (
              <div className="ai-follow">
                <span className="ai-follow-label">KEEP DIGGING</span>
                <div className="ai-follow-chips">
                  {followups.map((f, k) => (
                    <button
                      key={f} type="button" className="sugg"
                      style={{ animationDelay: `${k * 0.06}s` }}
                      onClick={() => onAsk(f)}
                    >
                      <ChevronRight strokeWidth={2.2} />
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {loading && (
        <div className="ai-msg bot">
          <div className="ai-thinking">
            <div className="ai-wave">
              {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ animation: `aiWave 1s ease-in-out ${i * 0.12}s infinite` }} />)}
            </div>
            <span className="ai-thinking-text">Analysing with tools…</span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </>
  );
}

/* --------------------------------------------------------------------- */
const SUGGESTIONS = {
  principal: [
    { icon: User, text: 'Students needing attention' },
    { icon: Trophy, text: 'Top performers' },
    { icon: TrendingUp, text: 'Find patterns' },
  ],
  vcp: [
    { icon: User, text: 'Who was absent on the most recent marked day?' },
    { icon: TrendingUp, text: 'Which classes have the most pending homework?' },
    { icon: Trophy, text: 'Show teacher coverage gaps' },
  ],
};

/* the thread is "long" once it holds this many messages → offer the page */
const LONG_THREAD_AT = 8;

const MIN_W = 210;
const MAX_W = 440;
const DEF_W = 238;

export default function AiPanel({
  collapsed, onToggle, onExpand,
  persona = 'principal',
  subtitle,
}) {
  const personaCfg = AI_PERSONAS[persona] || AI_PERSONAS.principal;
  const snap = useSyncExternalStore(subscribeAi, () => getAiSnapshot(persona));
  const msgs = snap.msgs;
  const loading = snap.loading;
  const [input, setInput] = useState('');
  const orbRef = useRef(null);
  const msgsEndRef = useRef(null);
  const inputRef = useRef(null);
  const handleRef = useRef(null);
  const dragRef = useRef(null);
  const sub = subtitle || personaCfg.subtitle;

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, loading]);

  /* ---- drag to resize (prototype behavior, clamped 210–440) ---- */
  const onPointerDown = (e) => {
    if (window.matchMedia('(max-width:1150px)').matches) return;
    e.preventDefault();
    const bar = handleRef.current?.nextElementSibling;
    dragRef.current = { x: e.clientX, w: bar ? bar.offsetWidth : DEF_W };
    handleRef.current?.setPointerCapture?.(e.pointerId);
    document.body.classList.add('resizing');
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const w = Math.max(MIN_W, Math.min(MAX_W, d.w + (d.x - e.clientX)));
    document.documentElement.style.setProperty('--aiw', `${w}px`);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.body.classList.remove('resizing');
    try {
      const w = getComputedStyle(document.documentElement).getPropertyValue('--aiw').trim();
      localStorage.setItem('fx-aiw', w);
    } catch { /* storage unavailable */ }
  };
  const resetWidth = () => {
    if (collapsed) {
      onToggle();
      return;
    }
    document.documentElement.style.setProperty('--aiw', `${DEF_W}px`);
    try { localStorage.setItem('fx-aiw', String(DEF_W)); } catch { /* ignore */ }
  };
  useEffect(() => {
    try {
      const w = localStorage.getItem('fx-aiw');
      if (w) document.documentElement.style.setProperty('--aiw', w);
    } catch { /* ignore */ }
  }, []);

  const ask = (q) => {
    const question = (q ?? input).trim();
    if (!question || loading) return;
    setInput('');
    if (!prefersReducedMotion()) {
      orbRef.current?.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 400, easing: 'ease' },
      );
    }
    aiAsk(question, persona);
    inputRef.current?.focus();
  };

  /* only offer the full page where one exists (the dashboard passes
     onExpand; the standalone CT console doesn't) */
  const longThread = msgs.length >= LONG_THREAD_AT && !!onExpand;

  return (
    <>
      <div
        ref={handleRef}
        className="ai-handle"
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={resetWidth}
      >
        <span className="grip" />
      </div>
      <aside className="rightbar">
        <div className="rightpanel">
          <div className="rb-top">
            <span className="rb-eyebrow">{personaCfg.eyebrow}</span>
            {!!msgs.length && !loading && (
              <button
                type="button" className="rb-collapse" onClick={() => aiClear(persona)}
                title="Clear this conversation" aria-label="Clear this conversation"
              >
                <Eraser strokeWidth={2.2} />
              </button>
            )}
            {onExpand && (
              <button
                type="button" className="rb-collapse" onClick={onExpand}
                title="Open the full AI page" aria-label="Open the full AI page"
              >
                <Maximize2 strokeWidth={2.2} />
              </button>
            )}
            <button type="button" className="rb-collapse" onClick={onToggle} aria-label="Collapse AI panel">
              <ChevronRight strokeWidth={2.2} />
            </button>
          </div>

          <div className="ai-card">
            <div className="ai-avatar"><SchoolLogo /></div>
            <div>
              <div className="t">{personaCfg.name}</div>
              <div className="s">{sub}</div>
            </div>
          </div>

          {msgs.length || loading ? (
            <div className="ai-msgs">
              <AiMessageList msgs={msgs} loading={loading} persona={persona} endRef={msgsEndRef} onAsk={ask} />
            </div>
          ) : (
            <>
              <div className="ask-center">
                <div className="orb2" ref={orbRef}>
                  <span
                    style={{
                      width: 38, height: 38, background: '#fff', borderRadius: '50%',
                      padding: 4, display: 'grid', placeItems: 'center',
                      boxShadow: '0 4px 12px -4px rgba(0,0,0,.35)',
                    }}
                  >
                    <SchoolLogo />
                  </span>
                </div>
                <h3>Ask {personaCfg.name}</h3>
                <p>{personaCfg.blurb}</p>
              </div>
              <div className="suggestions">
                {SUGGESTIONS[persona]?.map((s) => (
                  <button key={s.text} type="button" className="sugg" onClick={() => ask(s.text)}>
                    <s.icon strokeWidth={1.8} />
                    {s.text}
                  </button>
                ))}
              </div>
            </>
          )}

          {longThread && (
            <button type="button" className="ai-expand-chip" onClick={onExpand}>
              <Maximize2 strokeWidth={2} />
              Long conversation — open the full AI page
            </button>
          )}

          <div className="ask-input">
            <input
              ref={inputRef}
              value={input}
              placeholder={loading ? 'Thinking…' : 'Ask about your school'}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }}
            />
            <button type="button" className="send" disabled={loading || !input.trim()} onClick={() => ask()} aria-label="Send">
              <SendHorizontal strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
