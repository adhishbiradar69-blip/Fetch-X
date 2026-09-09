/* CP-local AI conversation store (v17) — one thread for the chairperson
   persona, shared by the CP side panel (AiPanelCp) across views.

   Why a copy instead of the Principal dashboard's aiThread.js: that module
   binds `analyzeAs` to the AI_ENDPOINTS table in the Principal's data.js,
   which has no 'chairperson' entry (and is owned by another task). This
   store is identical in behaviour — same localStorage persistence, same
   history contract — but talks to POST /chairperson/ai/analyze
   ({question, history} → {answer, source, tools_used}), whose response
   shape matches the panel exactly. */
import api from '../../../api/client';

export const AI_PERSONAS = {
  chairperson: {
    key: 'chairperson',
    name: 'Fetch-X AI',
    eyebrow: 'FETCH-X AI · GROUP',
    subtitle: 'Analysing the entire group',
    blurb: 'Ask about performance, attendance, task completion, rankings, or patterns across your schools.',
  },
};

const analyzeChairperson = (question, history = []) =>
  api.post('/chairperson/ai/analyze', { question, history }).then((r) => r.data);

const LS_KEY = (persona) => `fx-ai-thread-${persona}`;

let cache = { msgs: [], loading: false, persona: 'chairperson' };
const hydrated = new Set(); /* personas pulled from localStorage at least once */
const subs = new Set();

function emit() { subs.forEach((fn) => fn(cache)); }

function loadThread(persona) {
  try {
    const raw = localStorage.getItem(LS_KEY(persona));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* storage unavailable */ }
  return [];
}

function persist() {
  try { localStorage.setItem(LS_KEY(cache.persona), JSON.stringify(cache.msgs.slice(-80))); } catch { /* ignore */ }
}

export function getAiSnapshot(persona) {
  /* hydrate each persona once (same fix as the principal store — a reload
     must not silently drop the persisted thread) */
  if (!hydrated.has(persona)) {
    hydrated.add(persona);
    if (cache.persona !== persona) cache = { msgs: loadThread(persona), loading: false, persona };
    else cache = { ...cache, msgs: loadThread(persona) };
  }
  return cache;
}

export function subscribeAi(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function appendMsg(msg) {
  cache = { ...cache, msgs: [...cache.msgs, msg] };
  persist();
  emit();
}

function patchLast(patch) {
  cache = { ...cache, msgs: cache.msgs.map((m, i) => (i === cache.msgs.length - 1 ? { ...m, ...patch } : m)) };
  persist();
  emit();
}

/* Ask the chairperson AI. `history` rides along so follow-ups keep context
   (last 6 turns, same contract as the other personas). */
export async function aiAsk(question, persona = 'chairperson') {
  const q = (question || '').trim();
  if (!q || getAiSnapshot(persona).loading) return;
  const history = cache.msgs
    .filter((m) => m.role === 'user' || m.role === 'bot')
    .slice(-6)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  appendMsg({ role: 'user', content: q });
  /* placeholder the answer patches into — without it patchLast would
     REPLACE the user bubble and the thread would lose every question */
  appendMsg({ role: 'bot', pending: true });
  cache = { ...cache, loading: true };
  emit();
  try {
    const res = await analyzeChairperson(q, history);
    patchLast({ role: 'bot', pending: false, content: res.answer, source: res.source, tools: res.tools_used || [] });
  } catch (err) {
    patchLast({ role: 'error', pending: false, question: q, status: err?.response?.status });
  } finally {
    cache = { ...cache, loading: false };
    emit();
  }
}

export function aiRetry(persona = 'chairperson') {
  const errs = cache.msgs.filter((m) => m.role === 'error');
  const last = errs[errs.length - 1];
  if (!last) return;
  cache = { ...cache, msgs: cache.msgs.filter((m) => m.role !== 'error') };
  persist();
  emit();
  aiAsk(last.question, persona);
}

export function aiClear(persona = 'chairperson') {
  if (getAiSnapshot(persona).persona !== persona) return;
  cache = { ...cache, msgs: [] };
  persist();
  emit();
}

/* ---------- follow-up suggestions (pure client-side) ------------------ */
/* Group-oversight flavour: the chairperson asks across branches, so the
   banks push cross-school comparisons and portfolio-level actions. */

const FOLLOWUPS = {
  chairperson: {
    attention: [
      'Which school has the most at-risk students?',
      'Draft an intervention plan for the weakest branch',
      'Show the weakest subjects per school as a table',
    ],
    performers: [
      'Which school deserves recognition this term?',
      'Are the top performers spread across branches?',
      'Which grade leads the whole group?',
    ],
    patterns: [
      'What is driving that pattern?',
      'Show the evidence as a table',
      'Which branch should I invest in first?',
    ],
    attendance: [
      'Which school has the worst attendance?',
      'Is attendance trending up or down anywhere?',
      'How does attendance correlate with marks across schools?',
    ],
    tasks: [
      'Which school completes the fewest tasks?',
      'Which classes group-wide are behind on tasks?',
      'Show task completion per school as a table',
    ],
    schools: [
      'Compare the two weakest branches',
      'Which branch improved most since the first exam?',
      'Show every school as a table',
    ],
    teachers: [
      'Which school has the strongest faculty?',
      'Where are the staffing gaps group-wide?',
      'Which HOD should mentor another branch?',
    ],
    default: [
      'Why is that happening?',
      'Show the evidence as a table',
      'What are the top 3 group-wide actions?',
    ],
  },
};

/* keyword → bank, checked in order (first hit wins) */
const FOLLOWUP_HINTS = [
  [['attention', 'at-risk', 'at risk', 'risk', 'weak student', 'failing', 'struggl', 'below 60', 'intervention'], 'attention'],
  [['top performer', 'top 10', 'best student', 'recognition', 'rank'], 'performers'],
  [['pattern', 'trend', 'improving', 'declining', 'term over term'], 'patterns'],
  [['attendance', 'absent', 'absentee'], 'attendance'],
  [['task', 'homework', 'submission', 'pending'], 'tasks'],
  [['school', 'branch', 'portfolio', 'campus'], 'schools'],
  [['teacher', 'staffing', 'hod', 'faculty', 'load'], 'teachers'],
];

export function suggestFollowups(persona, msgs) {
  const banks = FOLLOWUPS[persona] || FOLLOWUPS.chairperson;
  if (!Array.isArray(msgs) || !msgs.length) return [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  if (!lastUser) return [];
  const q = String(lastUser.content || '').toLowerCase();
  let bank = banks.default;
  for (const [needles, name] of FOLLOWUP_HINTS) {
    if (needles.some((n) => q.includes(n))) { bank = banks[name] || banks.default; break; }
  }
  /* an already-asked question never comes back as its own follow-up */
  const asked = new Set(msgs.filter((m) => m.role === 'user').map((m) => String(m.content || '').toLowerCase()));
  return bank.filter((f) => !asked.has(f.toLowerCase())).slice(0, 3);
}
