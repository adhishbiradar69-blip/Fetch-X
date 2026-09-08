/* AiPage — the AI's own dedicated full page (dashboard #ai view).

   The side panel is great for quick questions, but long conversations
   deserve real estate: the page opens with the SAME shared thread (via
   aiThread store), a wider message column, and the PROMPT LIBRARY — a
   categorized catalogue of everything the AI can answer for this role.
   Clicking a library question asks it immediately.

   Personas: 'principal' (Fetch-X AI — strategy) and 'vcp' (VCP AI — the
   vice-principal's operations desk). The library swaps with the persona. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, Eraser, SendHorizontal } from 'lucide-react';
import { SchoolLogo } from './DashSidebar';
import { AiMessageList } from './AiPanel';
import { AI_PERSONAS, aiAsk, aiClear, getAiSnapshot, subscribeAi } from './aiThread';

/* The prompt library — "what can I ask?" as one tappable catalogue.
   Each entry maps to the backend's tool set, so every question below has a
   real data source behind it. */
const LIBRARY = {
  principal: [
    {
      group: 'School health',
      items: [
        'Give me a full school health summary',
        'Which grade is improving and which is declining?',
        'How does attendance affect performance here?',
        'Show the score distribution across the school',
        'Are we improving term over term?',
      ],
    },
    {
      group: 'Students',
      items: [
        'Which students need immediate attention?',
        'Who are the top 10 performers?',
        'Which students improved the most since the first exam?',
        'Show all students averaging between 35% and 50%',
        'Who is slipping below 60% attendance?',
      ],
    },
    {
      group: 'Subjects & classes',
      items: [
        'Which subject is our weakest and why?',
        'Analyze Mathematics across every grade',
        'Compare all sections of grade 8',
        'Give me a full drill-down of 9-Emerald',
        'Which class has the best and worst attendance?',
      ],
    },
    {
      group: 'Teachers & staffing',
      items: [
        'What is Priya Sharma’s teaching load?',
        'Who are the HODs and what do they cover?',
        'Is any grade-subject without a teacher?',
        'Where do extra teachers plug the gaps?',
        'Are class sizes evenly balanced?',
      ],
    },
    {
      group: 'Exams & homework',
      items: [
        'What exams exist and are marks fully entered?',
        'Show the top and bottom 5 of the latest grade 8 exam',
        'Which tasks have the most pending submissions?',
        'Show task completion per class as a table',
        'Show each grade as a table',
      ],
    },
    {
      group: 'Decisions',
      items: [
        'Where should I focus resources this month?',
        'Which students deserve recognition this term?',
        'What are the top 3 actions to raise the school average?',
        'Compare our two weakest classes and diagnose the gap',
        'Build me a parent-meeting briefing from the data',
      ],
    },
  ],
  vcp: [
    {
      group: 'Today',
      items: [
        'Who was absent on the most recent marked day?',
        'Which classes had the worst attendance recently?',
        'Give me today’s follow-up list',
        'Show attendance per class as a table',
        'Is attendance trending up or down this month?',
      ],
    },
    {
      group: 'Homework & tasks',
      items: [
        'Which tasks have the most pending submissions?',
        'Show task completion per class as a table',
        'Which class is behind on every task?',
        'Which tasks are due soon with low completion?',
        'Who is repeatedly not submitting homework?',
      ],
    },
    {
      group: 'Exams',
      items: [
        'What exams exist and are marks fully entered?',
        'Show the top and bottom 5 of the latest grade 8 exam',
        'Which grade’s marks are most complete?',
        'Compare this term’s exam averages with the last',
        'Which students failed the most recent exam?',
      ],
    },
    {
      group: 'Staffing & sections',
      items: [
        'Is any grade-subject without a teacher?',
        'Who are the HODs and what do they cover?',
        'Where do extra teachers plug the gaps?',
        'Are sections evenly balanced?',
        'Which section needs the most support this week?',
      ],
    },
    {
      group: 'Interventions',
      items: [
        'Which students need intervention this week?',
        'List chronic absentees below 60% attendance',
        'Show all students averaging between 35% and 50%',
        'Compare Ananya and Ira Reddy side by side',
        'Which class has the most at-risk students?',
      ],
    },
  ],
};

export default function AiPage({ persona = 'principal', onBack }) {
  const personaCfg = AI_PERSONAS[persona] || AI_PERSONAS.principal;
  const snap = useSyncExternalStore(subscribeAi, () => getAiSnapshot(persona));
  const msgs = snap.msgs;
  const loading = snap.loading;
  const [input, setInput] = useState('');
  const [libOpen, setLibOpen] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const library = LIBRARY[persona] || LIBRARY.principal;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, loading]);

  const ask = (q) => {
    const question = (q ?? input).trim();
    if (!question || loading) return;
    setInput('');
    aiAsk(question, persona);
    inputRef.current?.focus();
  };

  return (
    <div className="aip-root">
      <header className="aip-head">
        <button type="button" className="aip-back" onClick={onBack} aria-label="Back to dashboard">
          <ChevronLeft strokeWidth={2.2} />
        </button>
        <div className="ai-card" style={{ flex: 1, minWidth: 0 }}>
          <div className="ai-avatar"><SchoolLogo /></div>
          <div>
            <div className="t">{personaCfg.name}</div>
            <div className="s">{personaCfg.subtitle} · full view</div>
          </div>
        </div>
        <button type="button" className="aip-action" onClick={() => aiClear(persona)} disabled={!msgs.length}>
          <Eraser strokeWidth={2} />
          CLEAR
        </button>
      </header>

      <div className="aip-body">
        <aside className={`aip-lib${libOpen ? ' open' : ''}`}>
          <div className="aip-lib-title">WHAT {persona === 'vcp' ? 'THE VCP' : 'I'} CAN ANSWER</div>
          {library.map((g) => (
            <div className="aip-lib-group" key={g.group}>
              <div className="aip-lib-glabel">{g.group.toUpperCase()}</div>
              {g.items.map((q) => (
                <button key={q} type="button" className="aip-lib-q" disabled={loading} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="aip-main">
          <button
            type="button" className="aip-lib-toggle"
            onClick={() => setLibOpen((o) => !o)}
            aria-expanded={libOpen}
          >
            {libOpen ? 'HIDE TOPICS' : 'WHAT CAN I ASK?'}
          </button>
          {msgs.length || loading ? (
            <div className="ai-msgs aip-msgs">
              <AiMessageList msgs={msgs} loading={loading} persona={persona} endRef={endRef} onAsk={ask} />
            </div>
          ) : (
            <div className="ask-center aip-center">
              <div className="orb2">
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
          )}
        </div>
      </div>

      <div className="aip-input">
        <input
          ref={inputRef}
          value={input}
          placeholder={loading ? 'Thinking…' : `Ask ${personaCfg.name} anything about the school`}
          disabled={loading}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }}
        />
        <button type="button" className="send" disabled={loading || !input.trim()} onClick={() => ask()} aria-label="Send">
          <SendHorizontal strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
