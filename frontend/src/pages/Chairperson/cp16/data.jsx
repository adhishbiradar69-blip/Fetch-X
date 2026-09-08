/* Fetch-X — v16 Chairperson data layer (Task 3-a).
   Small fetchers written against the shared axios client (Task 2-c backend
   contract); the page files never import the Principal dashboard's data.js.

   GET /chairperson/v16/bundle
     → { group:{overall,t1,t2,t3,attendance_rate,tasks_rate,marks_avg,
                students,schools,distribution,attendance_series{30D,3M,6M,1Y}},
         schools:[{id,name,color,overall,t1,t2,t3,attendance,tasks,marks,
                   principal,students,org_rank,distribution,attendance_series,
                   subjects[{name,avg,t[3],hod,rank}],
                   grades[{grade,avg,t[3],att,task,marks,overall,sections,
                           grank_in_school,xrank_across,students_top10}]}] }
   GET /chairperson/v16/students|teachers — server-side paginated org ranks. */
import api from '../../../api/client';

const get = (url, config) => api.get(url, config).then((r) => r.data);

export const fetchCpBundle = () => get('/chairperson/v16/bundle');

/* → { students:[{id,name,class,school,avg,org_rank}], total, page, page_size } */
export async function fetchCpStudents({ search = '', page = 1, pageSize = 50, minAvg = 0 } = {}) {
  const d = await get('/chairperson/v16/students', {
    params: {
      search: search || undefined,
      page,
      page_size: pageSize,
      min_avg: minAvg || undefined,
    },
  });
  return {
    students: d.students || [],
    total: d.total ?? 0,
    page: d.page ?? page,
    pageSize: d.page_size ?? pageSize,
  };
}

/* → { teachers:[{id,name,school,subject,avg,is_hod,is_ct,org_rank}], total, ... } */
export async function fetchCpTeachers({ search = '', page = 1, pageSize = 50, minAvg = 0 } = {}) {
  const d = await get('/chairperson/v16/teachers', {
    params: {
      search: search || undefined,
      page,
      page_size: pageSize,
      min_avg: minAvg || undefined,
    },
  });
  return {
    teachers: d.teachers || [],
    total: d.total ?? 0,
    page: d.page ?? page,
    pageSize: d.page_size ?? pageSize,
  };
}

/* ───────────────────────── derive helpers ─────────────────────────── */

/* The designer's combined OVERALL — (marks + tasks + attendance) ÷ 3.
   The API's `overall`/`marks` carry the all-term marks average only; every
   place the prototype shows a composite donut/row this helper is used. */
export const compositeOverall = (marks, tasks, attendance) =>
  Math.round(((Number(marks) || 0) + (Number(tasks) || 0) + (Number(attendance) || 0)) / 3);

/* hex → rgba() soft tint (designer `rgba()` helper) */
export function rgbaSoft(hex, a = 0.13) {
  let h = String(hex || '#4f42dd').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

/* sum of a distribution band list — the shares behind the bars */
export const distroTotal = (bands) =>
  (bands || []).reduce((s, b) => s + (Number(b.count) || 0), 0);

/* designer ACAD_SHORT chip codes for the teachers level subject chip */
const SUBJ_SHORT = {
  Mathematics: 'MATH',
  Science: 'SCI',
  English: 'ENG',
  Hindi: 'HINDI',
  'Social Studies': 'SOCIAL',
  Social: 'SOCIAL',
  'Computer Science': 'COMP',
  Computer: 'COMP',
  'Physical Education': 'PE',
};
export const subjectShort = (name) => SUBJ_SHORT[name] || String(name || '—').toUpperCase();

/* "1,234" — the designer formats counts with toLocaleString */
export const num = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-IN') : '—');

/* designer svgs used by the CP rows (moved here from bits.jsx so every
   component file keeps exporting only components — react-refresh rule) */
export const PERSON_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5" /></svg>
);
export const BM_SVG = (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M6 3h12v18l-6-4.5L6 21z" /></svg>
);
export const ARR_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
);
