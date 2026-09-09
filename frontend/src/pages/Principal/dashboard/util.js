/* Shared helpers for the Principal Dashboard port (dashboard.html). */

export const CIRC = +(2 * Math.PI * 42).toFixed(2);

export const mean = (a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export const initials = (n) =>
  String(n || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/* Percentage display: prototype shows integers everywhere. */
export const pct = (v) => Math.round(Number(v) || 0);

export const fmt1 = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/* Band system for report cards (designer's exact colors). */
export const BANDS = [
  { min: 90, c: '#0e9f6e', soft: '#e3f5ed', label: 'EXCELLENT' },
  { min: 70, c: '#d97706', soft: '#fcf0dd', label: 'GOOD' },
  { min: 0, c: '#dc2626', soft: '#fce8e8', label: 'NEEDS ATTENTION' },
];
export const bandOf = (v) => BANDS.find((b) => v >= b.min) || BANDS[BANDS.length - 1];

/* Trend arrow (Term 3 vs Term 2 semantics). d may be a float. */
export function trendInfo(d) {
  const n = Number(d) || 0;
  if (n > 0.05) return { dir: 'up', text: `▲${Math.round(n)}`, tip: `▲ vs previous term: +${fmt1(n)}` };
  if (n < -0.05) return { dir: 'down', text: `▼${Math.round(-n)}`, tip: `▼ vs previous term: ${fmt1(n)}` };
  return { dir: 'flat', text: '–', tip: 'vs previous term: no change' };
}

/* Median of an array (integers). */
export const median = (a) => {
  if (!a || !a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/* Attendance range tabs (prototype constants). */
export const ATT_TABS = { '30D': '30 DAYS', '3M': '3 MONTHS', '6M': '6 MONTHS', '1Y': '1 YEAR' };
export const ATT_RANGES = {
  '30D': { buckets: 30, txt: '30 DAYS', lab: 'day' },
  '3M': { buckets: 31, txt: '3 MONTHS', lab: 'day' },
  '6M': { buckets: 26, txt: '6 MONTHS', lab: 'month' },
  '1Y': { buckets: 12, txt: '1 YEAR', lab: 'month' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
};
export const fmtMon = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return MONTHS[dt.getMonth()];
};

/* Class-comparison metric tabs. */
export const CMP_METRICS = { avg: 'AVG', attendance: 'ATTENDANCE', tasks: 'TASKS' };

/* localStorage folders (designer's feature, Fetch-X storage key). */
const FOLDERS_KEY = 'fx-folders';

export function loadFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f) => f && typeof f === 'object' && Array.isArray(f.studentIds))
      .map((f) => ({
        id: String(f.id || `f${Date.now()}${Math.floor(Math.random() * 999)}`),
        name: String(f.name || 'Folder'),
        studentIds: f.studentIds.map(Number).filter((n) => Number.isFinite(n)),
      }));
  } catch {
    return [];
  }
}

export function saveFolders(folders) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* storage unavailable */
  }
}

/* v17 class bookmark folders — the same folder system the designer added
   for classes (prototype key `si-class-folders`). Each folder holds class
   ids; cards resolve live stats from the already-loaded class list. */
const CLASS_FOLDERS_KEY = 'fx-class-folders';

export function loadClassFolders() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLASS_FOLDERS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f) => f && typeof f === 'object' && Array.isArray(f.classIds))
      .map((f) => ({
        id: String(f.id || `c${Date.now()}${Math.floor(Math.random() * 999)}`),
        name: String(f.name || 'Folder'),
        classIds: f.classIds.map((x) => Number(x)).filter((n) => Number.isFinite(n)),
      }));
  } catch {
    return [];
  }
}

export function saveClassFolders(folders) {
  try {
    localStorage.setItem(CLASS_FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* storage unavailable */
  }
}

/* Escape a string for safe interpolation into title attributes. */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
