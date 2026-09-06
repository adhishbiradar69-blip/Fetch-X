/* Resizable AI right panel — the prototype's shell with a REAL backend:
   suggestion chips submit, the input sends, answers are rendered as
   markdown with source / tools_used badges, ```chart blocks render real
   in-theme graphs, and failures get a graceful error card. Conversation
   memory: recent turns ride along so follow-up questions work.
   Wired to POST /principal/ai/analyze. */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, SendHorizontal, TrendingUp, Trophy, User } from 'lucide-react';
import { analyze } from './data';
import { prefersReducedMotion } from './util';
import { SchoolLogo } from './DashSidebar';
import { BarChart, Distro, LineChart } from './charts';

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

/* ---------- markdown renderer (ported from the legacy dashboard) ------ */
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

export function MarkdownLite({ text }) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const out = [];
  let lt = null;
  let li = [];
  const flush = () => {
    if (li.length) {
      out.push(lt === 'ol' ? <ol key={`l${out.length}`}>{li}</ol> : <ul key={`l${out.length}`}>{li}</ul>);
      li = [];
      lt = null;
    }
  };
  /* fenced blocks: ```chart → real graph, any other fence → pre */
  let fence = null; // null | { lang, lines: [] }
  lines.forEach((line, i) => {
    if (fence) {
      if (line.trim().startsWith('```')) {
        if (fence.lang === 'chart') {
          try {
            out.push(<AiChart key={`c${i}`} spec={JSON.parse(fence.lines.join('\n'))} />);
          } catch { /* ignore malformed chart JSON */ }
        } else {
          out.push(
            <pre key={`f${i}`} style={{
              background: 'var(--chip)', borderRadius: 10, padding: '10px 12px',
              fontSize: 11, overflowX: 'auto', margin: '8px 0',
            }}>{fence.lines.join('\n')}</pre>,
          );
        }
        fence = null;
      } else {
        fence.lines.push(line);
      }
      return;
    }
    const t = line.trim();
    if (t.startsWith('```')) {
      flush();
      fence = { lang: t.slice(3).trim().toLowerCase(), lines: [] };
      return;
    }
    if (!t) { flush(); return; }
    if (t.startsWith('### ') || t.startsWith('## ') || t.startsWith('# ')) {
      flush();
      out.push(<h3 key={i}>{inline(t.replace(/^#+\s/, ''))}</h3>);
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      if (lt !== 'ul') { flush(); lt = 'ul'; }
      li.push(<li key={i}>{inline(t.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(t)) {
      if (lt !== 'ol') { flush(); lt = 'ol'; }
      li.push(<li key={i}>{inline(t.replace(/^\d+\.\s/, ''))}</li>);
    } else {
      flush();
      out.push(<p key={i}>{inline(t)}</p>);
    }
  });
  flush();
  return <>{out}</>;
}

/* --------------------------------------------------------------------- */
const SUGGESTIONS = [
  { icon: User, text: 'Students needing attention' },
  { icon: Trophy, text: 'Top performers' },
  { icon: TrendingUp, text: 'Find patterns' },
];

const MIN_W = 210;
const MAX_W = 440;
const DEF_W = 238;

export default function AiPanel({ collapsed, onToggle, subtitle = 'Analysing the entire school' }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const orbRef = useRef(null);
  const msgsEndRef = useRef(null);
  const inputRef = useRef(null);
  const handleRef = useRef(null);
  const dragRef = useRef(null);

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

  /* ---- the real AI call (with conversation memory) ---- */
  const ask = async (q) => {
    const question = (q ?? input).trim();
    if (!question || loading) return;
    /* last few real turns ride along so follow-ups ("now compare the bottom
       two") keep their context */
    const history = msgs
      .filter((m) => m.role === 'user' || m.role === 'bot')
      .slice(-6)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
    setInput('');
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setLoading(true);
    if (!prefersReducedMotion()) {
      orbRef.current?.animate?.(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
        { duration: 400, easing: 'ease' },
      );
    }
    try {
      const res = await analyze(question, history);
      setMsgs((m) => [...m, {
        role: 'bot',
        content: res.answer,
        source: res.source,
        tools: res.tools_used || [],
      }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: 'error', question, status: err?.response?.status }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const retry = (question) => {
    setMsgs((m) => m.filter((x) => x.role !== 'error'));
    ask(question);
  };

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
            <span className="rb-eyebrow">FETCH-X AI</span>
            <button type="button" className="rb-collapse" onClick={onToggle} aria-label="Collapse AI panel">
              <ChevronRight strokeWidth={2.2} />
            </button>
          </div>

          <div className="ai-card">
            <div className="ai-avatar"><SchoolLogo /></div>
            <div>
              <div className="t">Fetch-X AI</div>
              <div className="s">{subtitle}</div>
            </div>
          </div>

          {msgs.length || loading ? (
            <div className="ai-msgs">
              {msgs.map((m, i) => {
                if (m.role === 'user') return <div className="ai-msg user" key={i}>{m.content}</div>;
                if (m.role === 'error') {
                  /* 403 means "not your role", not "backend down" — a retry
                     can never succeed, so it's hidden. */
                  const forbidden = m.status === 403;
                  return (
                    <div className="ai-err" key={i}>
                      <span>{forbidden
                        ? 'AI insights are available to principal and admin accounts.'
                        : 'The AI could not be reached. Check that the backend is running, then retry.'}</span>
                      {!forbidden && <button type="button" onClick={() => retry(m.question)}>RETRY</button>}
                    </div>
                  );
                }
                return (
                  <div className="ai-msg bot" key={i}>
                    <MarkdownLite text={m.content} />
                    {(m.source || m.tools?.length > 0) && (
                      <div className="ai-badges">
                        {m.source && <span className="ai-badge">{m.source}</span>}
                        {m.tools.map((t) => <span className="ai-badge tools" key={t}>{t}</span>)}
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
              <div ref={msgsEndRef} />
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
                <h3>Ask Fetch-X AI</h3>
                <p>Ask questions about performance, attendance, task completion, rankings, or patterns.</p>
              </div>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} type="button" className="sugg" onClick={() => ask(s.text)}>
                    <s.icon strokeWidth={1.8} />
                    {s.text}
                  </button>
                ))}
              </div>
            </>
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
