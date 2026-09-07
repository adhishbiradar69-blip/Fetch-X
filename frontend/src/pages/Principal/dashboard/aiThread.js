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
  if (cache.persona !== persona) {
    cache = { msgs: loadThread(persona), loading: false, persona };
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
  cache = { ...cache, loading: true };
  emit();
  try {
    const res = await analyzeAs(persona, q, history);
    patchLast({ role: 'bot', content: res.answer, source: res.source, tools: res.tools_used || [] });
  } catch (err) {
    patchLast({ role: 'error', question: q, status: err?.response?.status });
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
