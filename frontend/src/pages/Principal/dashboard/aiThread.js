/* Shared AI conversation store — ONE thread per persona, shared by the
   resizable side panel (AiPanel) and the dedicated full AI page (AiPage).

   Why a module store: the panel and the page are separate mounts (the page
   replaces the panel in the v15 shell), but the conversation must survive
   the switch — "the convo got long, open the full view" only works if the
   thread carries over. Persists to localStorage so a reload keeps it too.

   Personas: 'principal' → /principal/ai/analyze (Fetch-X AI, strategy),
   'vcp' → /vice-principal/ai/analyze (VCP AI, day-to-day operations). */
import { analyzeAs } from './data';

export const AI_PERSONAS = {
  principal: {
    key: 'principal',
    name: 'Fetch-X AI',
    eyebrow: 'FETCH-X AI',
    subtitle: 'Analysing the entire school',
    blurb: 'Ask questions about performance, attendance, task completion, rankings, or patterns.',
  },
  vcp: {
    key: 'vcp',
    name: 'VCP AI',
    eyebrow: 'VCP AI · OPERATIONS',
    subtitle: "Vice-Principal's operations desk",
    blurb: 'Attendance, pending homework, exams, staffing gaps — the school’s day, by the numbers.',
  },
};

const LS_KEY = (persona) => `fx-ai-thread-${persona}`;

let cache = { msgs: [], loading: false, persona: 'principal' };
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
  /* hydrate each persona once. The old check (cache.persona !== persona)
     never fired for the DEFAULT persona — the module starts as 'principal',
     so a reload silently dropped the whole persisted thread. */
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

/* Ask the persona's endpoint. `history` rides along so follow-ups keep
   context (same contract as before). */
export async function aiAsk(question, persona = 'principal') {
  const q = (question || '').trim();
  if (!q || getAiSnapshot(persona).loading) return;
  const history = cache.msgs
    .filter((m) => m.role === 'user' || m.role === 'bot')
    .slice(-6)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  appendMsg({ role: 'user', content: q });
  /* placeholder the answer patches into — without it patchLast would
     REPLACE the user bubble and the thread (and the history sent with
     the NEXT question) would lose every question ever asked */
  appendMsg({ role: 'bot', pending: true });
  cache = { ...cache, loading: true };
  emit();
  try {
    const res = await analyzeAs(persona, q, history);
    patchLast({ role: 'bot', pending: false, content: res.answer, source: res.source, tools: res.tools_used || [] });
  } catch (err) {
    patchLast({ role: 'error', pending: false, question: q, status: err?.response?.status });
  } finally {
    cache = { ...cache, loading: false };
    emit();
  }
}

export function aiRetry(persona = 'principal') {
  const errs = cache.msgs.filter((m) => m.role === 'error');
  const last = errs[errs.length - 1];
  if (!last) return;
  cache = { ...cache, msgs: cache.msgs.filter((m) => m.role !== 'error') };
  persist();
  emit();
  aiAsk(last.question, persona);
}

export function aiClear(persona = 'principal') {
  if (getAiSnapshot(persona).persona !== persona) return;
  cache = { ...cache, msgs: [] };
  persist();
  emit();
}

/* ---------- follow-up suggestions (pure client-side) ------------------ */
/* After each answer the panel offers three "keep digging" chips. The
   backend already receives the last turns as history (see aiAsk), so a
   follow-up genuinely continues the analysis — this helper only decides
   WHICH next questions to whisper. Matching is a keyword heuristic over
   the last user message; each bank ends with a depth probe that always
   fits ("why / next steps / as a table"). */

const FOLLOWUPS = {
  principal: {
    attention: [
      'Draft an intervention plan for the worst one',
      'Show their attendance side by side',
      'Which teacher covers their weakest subject?',
    ],
    performers: [
      'Who deserves recognition this term?',
      'Are the top performers consistent across terms?',
      'Which class has the most top-10 students?',
    ],
    patterns: [
      'What is driving that pattern?',
      'Show the evidence as a table',
      'What should I do about it this month?',
    ],
    attendance: [
      'Which classes have the worst attendance?',
      'List the chronic absentees',
      'How does attendance affect marks here?',
    ],
    tasks: [
      'Which tasks have the most pending submissions?',
      'Which class is behind on every task?',
      'Who is repeatedly not submitting homework?',
    ],
    subjects: [
      'Analyze that subject across every grade',
      'Which teacher assignments cover it?',
      'Compare the top and bottom classes in it',
    ],
    classes: [
      'Give me a full drill-down of that class',
      'Compare it with the best class in the grade',
      'Show the class as a table',
    ],
    exams: [
      'Show the top and bottom 5 of that exam',
      'Are the marks fully entered?',
      'Compare this term’s exam average with the last',
    ],
    teachers: [
      'What is their teaching load?',
      'Is any grade-subject without a teacher?',
      'Where do extra teachers plug the gaps?',
    ],
    grades: [
      'Which grade is improving and which is declining?',
      'Compare all sections of that grade',
      'Show each grade as a table',
    ],
    default: [
      'Why is that happening?',
      'Show the evidence as a table',
      'What are the top 3 actions I should take?',
    ],
  },
  vcp: {
    attention: [
      'Draft today’s follow-up list for them',
      'Show their recent attendance',
      'Which of them need intervention this week?',
    ],
    performers: [
      'Which class do they come from?',
      'Are they consistent across terms?',
      'Who improved the most since the first exam?',
    ],
    patterns: [
      'What is driving that pattern?',
      'Show the evidence as a table',
      'Which section needs the most support this week?',
    ],
    attendance: [
      'Who was absent on the most recent marked day?',
      'List chronic absentees below 60%',
      'Is attendance trending up or down this month?',
    ],
    tasks: [
      'Which tasks are due soon with low completion?',
      'Which class is behind on every task?',
      'Show task completion per class as a table',
    ],
    subjects: [
      'Which grade-subject is weakest?',
      'Is any grade-subject without a teacher?',
      'Where do extra teachers plug the gaps?',
    ],
    classes: [
      'Which section needs the most support this week?',
      'Compare attendance per class as a table',
      'Are sections evenly balanced?',
    ],
    exams: [
      'Which students failed the most recent exam?',
      'Which grade’s marks are most complete?',
      'Compare this term’s exam averages with the last',
    ],
    teachers: [
      'Who are the HODs and what do they cover?',
      'Is any grade-subject without a teacher?',
      'Where do extra teachers plug the gaps?',
    ],
    grades: [
      'Which grade’s marks are most complete?',
      'Compare this term’s exam averages with the last',
      'Show attendance per class as a table',
    ],
    default: [
      'Why is that happening?',
      'Show the evidence as a table',
      'Give me today’s follow-up list',
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
  [['subject', 'mathematics', 'science', 'english'], 'subjects'],
  [['class ', 'section', 'drill-down', '9-emerald', 'grade'], 'classes'],
  [['exam', 'marks entered', 'test'], 'exams'],
  [['teacher', 'staffing', 'hod', 'load'], 'teachers'],
  [['grade', 'class size'], 'grades'],
];

export function suggestFollowups(persona, msgs) {
  const banks = FOLLOWUPS[persona] || FOLLOWUPS.principal;
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
