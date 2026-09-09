/* CP-local resizable AI right panel (v17) — the Principal dashboard's
   AiPanel, re-bound to the CHAIRPERSON persona + POST /chairperson/ai/analyze.

   Why a CP-local variant: AiPanel reads its persona table + endpoint map
   from the Principal dashboard's aiThread.js / data.js (no 'chairperson'
   entry, and those files are owned by another task). This component keeps
   the exact same shell — drag-resize handle (210–440px), suggestion chips,
   markdown answers, error cards — while the thread lives in the CP-local
   aiThreadCp store. Markdown/table/chart rendering is REUSED from the
   principal panel (MarkdownLite is a pure presentational export). */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, ChevronRight, Copy, Eraser, SendHorizontal, TrendingUp, Trophy, User } from 'lucide-react';
import { prefersReducedMotion } from '../../Principal/dashboard/util';
import { SchoolLogo } from '../../Principal/dashboard/DashSidebar';
import { MarkdownLite } from '../../Principal/dashboard/AiPanel';
import { AI_PERSONAS, aiAsk, aiClear, aiRetry, getAiSnapshot, subscribeAi, suggestFollowups } from './aiThreadCp';

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

/* ---------- shared message list (CP panel) ----------------------------- */
function AiMessageList({ msgs, loading, persona, endRef, onAsk }) {
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
                ? 'The group AI is available to chairperson and admin accounts.'
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
/* the designer's exact three chips (chairperson.html suggestions block) */
const SUGGESTIONS = {
  chairperson: [
    { icon: User, text: 'Students needing attention' },
    { icon: Trophy, text: 'Top performers' },
    { icon: TrendingUp, text: 'Find patterns' },
  ],
};

const MIN_W = 210;
const MAX_W = 440;
const DEF_W = 238;

export default function AiPanelCp({
  collapsed, onToggle,
  persona = 'chairperson',
  subtitle,
}) {
  const personaCfg = AI_PERSONAS[persona] || AI_PERSONAS.chairperson;
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

          <div className="ask-input">
            <input
              ref={inputRef}
              value={input}
              placeholder={loading ? 'Thinking…' : 'Ask about your group'}
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
